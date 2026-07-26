import { toNumber } from '../format.js'
import { indexBy, fullName, playerPhotoUrl } from '../providers/fpl.js'
import {
  attackMultiplier,
  cleanSheetProbability,
  fixtureRunScore,
  teamFixtures,
} from './fixtureDifficulty.js'

/**
 * The projection engine. It turns the raw FPL bootstrap into one projection per
 * player: expected points for the next gameweek, a captain score, a confidence
 * level, and the human-readable reasons behind them.
 *
 * Design principles:
 *  - Transparent, not a black box. Every number decomposes into appearance,
 *    attacking, clean-sheet and bonus components, each explainable to the user.
 *  - Phase-adaptive. In-season it uses live per-90 underlying numbers; in the
 *    pre-season (when FPL zeroes those) it derives rates from last season's
 *    totals and leans on FPL's own ep_next and points-per-game as anchors.
 *  - One computation, many views. Captains, transfers, differentials and the
 *    weekly briefing are all filters and sorts over this same output, so the
 *    whole platform costs a single cached bootstrap + fixtures fetch.
 */

// FPL scoring by position (singular_name_short: GKP/DEF/MID/FWD).
const GOAL_POINTS = { GKP: 6, DEF: 6, MID: 5, FWD: 4 }
const CLEAN_SHEET_POINTS = { GKP: 4, DEF: 4, MID: 1, FWD: 0 }
const ASSIST_POINTS = 3

const AVAILABILITY_LABELS = {
  a: 'Available',
  d: 'Doubtful',
  i: 'Injured',
  s: 'Suspended',
  u: 'Unavailable',
  n: 'Not in squad',
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/** Per-90 rate from a season total, guarding against zero minutes. */
function per90(total, minutes) {
  const played = toNumber(minutes, 0)
  if (played <= 0) return 0
  return (toNumber(total, 0) / played) * 90
}

/** Probability the player is available to feature, from FPL status + news. */
function availabilityFactor(element) {
  const chance = element.chance_of_playing_next_round
  switch (element.status) {
    case 'a': return chance == null ? 1 : Math.max(0.1, chance / 100)
    case 'd': return chance == null ? 0.6 : chance / 100
    default: return chance == null ? 0 : chance / 100 // i / s / u / n
  }
}

/**
 * How reliably the player starts, inferred from last season's workload. A high
 * total-minutes count and a high minutes-per-start both signal a nailed starter
 * rather than a rotation option. Unknown history (a new signing) sits neutral.
 */
function nailedness(element) {
  const minutes = toNumber(element.minutes, 0)
  const starts = toNumber(element.starts, 0)
  if (minutes === 0) return 0.5

  const minutesPerStart = starts > 0 ? minutes / starts : minutes / Math.max(1, Math.round(minutes / 90))
  const volume = Math.min(1, minutes / 2200)
  const depth = Math.min(1, minutesPerStart / 80)
  return clamp(0.55 * volume + 0.45 * depth, 0.2, 1)
}

function availabilityInfo(element) {
  return {
    status: element.status ?? 'a',
    label: AVAILABILITY_LABELS[element.status] ?? 'Available',
    chance: element.chance_of_playing_next_round ?? null,
    news: element.news?.trim() ? element.news.trim() : null,
  }
}

function buildReasons(element, ctx) {
  const { next, xgi90, nail, ownership, xPts, phase } = ctx
  const reasons = []

  if (next) {
    const tone = next.difficulty <= 2 ? 'favourable' : next.difficulty >= 4 ? 'tough' : 'even'
    reasons.push({
      kind: 'fixture',
      tone: next.difficulty <= 2 ? 'good' : next.difficulty >= 4 ? 'bad' : 'neutral',
      text: `${next.home ? 'Home vs' : 'Away at'} ${next.opponent} — ${tone} fixture (${next.difficulty}/5)`,
    })
  }
  if (xgi90 > 0.4) {
    reasons.push({
      kind: 'underlying',
      tone: 'good',
      text: `${xgi90.toFixed(2)} expected goal involvements per 90 ${phase === 'active' ? 'this season' : 'last season'}`,
    })
  }
  if (nail >= 0.7) {
    reasons.push({
      kind: 'minutes',
      tone: 'good',
      text: `Nailed starter — ${toNumber(element.starts, 0)} starts, ${toNumber(element.minutes, 0)} minutes last season`,
    })
  } else if (nail < 0.55) {
    reasons.push({ kind: 'minutes', tone: 'bad', text: 'Rotation risk — limited minutes history' })
  }
  if (ownership < 10 && xPts >= 3.5) {
    reasons.push({ kind: 'ownership', tone: 'good', text: `Differential — only ${ownership.toFixed(1)}% owned` })
  } else if (ownership > 40) {
    reasons.push({ kind: 'ownership', tone: 'neutral', text: `Template pick — ${ownership.toFixed(1)}% owned` })
  }
  if (element.status && element.status !== 'a') {
    reasons.push({
      kind: 'risk',
      tone: 'bad',
      text: element.news?.trim() || `${AVAILABILITY_LABELS[element.status] ?? 'Availability doubt'}`,
    })
  }
  return reasons
}

export function projectPlayer(element, ctx) {
  const { typesById, teamsById, fixtures, phase } = ctx
  const position = typesById.get(element.element_type)?.singular_name_short ?? 'MID'
  const team = teamsById.get(element.team)

  const fixtureRun = teamFixtures(element.team, fixtures, teamsById, ctx.horizon ?? 5)
  const next = fixtureRun[0] ?? null

  const availability = availabilityFactor(element)
  const nail = nailedness(element)
  const playProb = clamp(availability * nail, 0, 1)
  const starterProb = clamp(availability * Math.min(1, nail * 1.05), 0, 1)

  // Underlying attacking rate per 90, phase-adaptive: prefer live per-90 fields,
  // fall back to last season's totals when the season hasn't produced them yet.
  const xg90 = toNumber(element.expected_goals_per_90, 0) > 0
    ? toNumber(element.expected_goals_per_90)
    : per90(element.expected_goals, element.minutes)
  const xa90 = toNumber(element.expected_assists_per_90, 0) > 0
    ? toNumber(element.expected_assists_per_90)
    : per90(element.expected_assists, element.minutes)
  const xgi90 = xg90 + xa90

  const fixtureMult = next ? attackMultiplier(next.difficulty) : 1
  const csProb = next ? cleanSheetProbability(next.difficulty, next.home) : 0.3

  // Expected-points components for the next gameweek.
  const appearance = playProb * (nail >= 0.6 ? 2 : 1)
  // 0.9 damp: not all of a per-90 rate converts to returns in a one-match sample.
  const attacking = (xg90 * GOAL_POINTS[position] + xa90 * ASSIST_POINTS) * playProb * fixtureMult * 0.9
  const cleanSheet = CLEAN_SHEET_POINTS[position] > 0 ? csProb * CLEAN_SHEET_POINTS[position] * starterProb : 0
  const bonusRate = Math.min(1.2, toNumber(element.bonus, 0) / Math.max(1, toNumber(element.starts, 1)))
  const bonus = bonusRate * playProb * 0.6

  const modelPoints = appearance + attacking + cleanSheet + bonus

  // Anchor the model against FPL's own projection and last season's scoring rate
  // so a single noisy component can't produce a silly number.
  const epNext = toNumber(element.ep_next, 0)
  const ppg = toNumber(element.points_per_game, 0) * playProb
  const anchors = [[modelPoints, 0.5]]
  if (epNext > 0) anchors.push([epNext, 0.3])
  if (ppg > 0) anchors.push([ppg, 0.2])
  const weightSum = anchors.reduce((total, [, weight]) => total + weight, 0)
  let xPts = anchors.reduce((total, [value, weight]) => total + value * weight, 0) / weightSum

  // Recent form nudges the projection once the season is under way.
  const form = toNumber(element.form, 0)
  const rawPpg = toNumber(element.points_per_game, 0)
  if (form > 0 && rawPpg > 0) {
    xPts *= clamp(0.8 + (form / rawPpg) * 0.2, 0.8, 1.3)
  }
  xPts = Math.max(0, xPts)

  // Captaincy rewards ceiling, not just expected value — an explosive attacker
  // with a home fixture is a better armband than a steady defender on equal xPts.
  const ceiling = 1
    + Math.min(0.6, xgi90 * (position === 'FWD' || position === 'MID' ? 0.5 : 0.15))
    + (next?.home ? 0.05 : 0)
  const captainScore = xPts * ceiling

  const dataConfidence = toNumber(element.minutes, 0) > 0 ? 1 : 0.4
  const confidence = Math.round(100 * clamp(
    0.35 + 0.4 * playProb + 0.15 * (next ? 1 : 0) + 0.1 * dataConfidence,
    0,
    1,
  ))

  const ownership = toNumber(element.selected_by_percent, 0)
  const name = fullName(element)

  const reasons = buildReasons(element, { next, xgi90, nail, ownership, xPts, phase })

  return {
    id: `fpl:${element.id}`,
    elementId: element.id,
    name,
    webName: element.web_name ?? name,
    photoUrl: playerPhotoUrl(element.code),
    position,
    team: team?.name ?? 'Unknown',
    teamShort: team?.short_name ?? '—',
    price: toNumber(element.now_cost, 0) / 10,
    ownership,
    availability: availabilityInfo(element),
    next,
    fixtureRun,
    fixtureScore: fixtureRunScore(fixtureRun),
    xgi90: Number(xgi90.toFixed(2)),
    expectedPoints: Number(xPts.toFixed(1)),
    captainScore: Number(captainScore.toFixed(2)),
    confidence,
    playProb: Number(playProb.toFixed(2)),
    flags: {
      differential: ownership < 10 && xPts >= 3.5,
      template: ownership > 40,
      rotationRisk: nail < 0.55,
      doubt: (element.status ?? 'a') !== 'a',
    },
    reasons,
  }
}

/**
 * Project every player from a single cached bootstrap + fixtures fetch. Returns
 * the projections plus the gameweek context the views label themselves with.
 */
export async function buildProjections({ fpl, horizon = 5 }) {
  const [bootstrap, fixtures] = await Promise.all([fpl.getBootstrap(), fpl.getFixtures()])

  const typesById = indexBy(bootstrap.element_types, 'id')
  const teamsById = indexBy(bootstrap.teams, 'id')
  const events = bootstrap.events ?? []
  const nextEvent = events.find((event) => event.is_next)
    ?? events.find((event) => event.is_current)
    ?? null
  const phase = events.some((event) => event.finished) ? 'active' : 'pre'

  const ctx = { typesById, teamsById, fixtures, phase, horizon }
  const players = (bootstrap.elements ?? []).map((element) => projectPlayer(element, ctx))

  return {
    gameweek: nextEvent?.id ?? null,
    gameweekName: nextEvent?.name ?? null,
    deadline: nextEvent?.deadline_time ?? null,
    phase,
    generatedAt: new Date().toISOString(),
    players,
  }
}
