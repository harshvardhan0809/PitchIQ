import { HttpError } from './http.js'
import {
  availabilityOf,
  fullName,
  indexBy,
  playerPhotoUrl,
  teamCrestUrl,
} from './providers/fpl.js'
import { initials, normalizeName, toIso, toNumber } from './format.js'

/**
 * Player search and the player report — Premier League only, powered entirely
 * by the Fantasy Premier League API (squad, per-match history, fixtures). No
 * other provider is involved.
 */
const RESULT_LIMIT = 10
const RECENT_MATCH_LIMIT = 5

/* ------------------------------------------------------------------ search */

function relevance(name, term) {
  const normalized = normalizeName(name)
  if (normalized.startsWith(term)) return 0
  const startsToken = name.split(/[\s-]+/).map(normalizeName).some((token) => token.startsWith(term))
  return startsToken ? 1 : 2
}

function rankMatches(players, rawTerm) {
  const term = normalizeName(rawTerm)
  return players
    .filter((player) => normalizeName(player.name).includes(term))
    .sort((left, right) => (
      relevance(left.name, term) - relevance(right.name, term)
      || left.name.localeCompare(right.name)
    ))
    .slice(0, RESULT_LIMIT)
}

function toSearchResult(element, team, positionType) {
  const name = fullName(element)
  return {
    id: `fpl:${element.id}`,
    name,
    initials: initials(name),
    team: team?.name ?? 'Unknown club',
    position: positionType?.singular_name ?? 'Player',
    photoUrl: playerPhotoUrl(element.code),
    availability: availabilityOf(element),
  }
}

function stripSort(player) {
  const copy = { ...player }
  delete copy.totalPoints
  delete copy.form
  return copy
}

export async function searchPlayers({ query, fpl }) {
  const term = String(query ?? '').trim()
  const bootstrap = await fpl.getBootstrap()
  const teamsById = indexBy(bootstrap.teams, 'id')
  const typesById = indexBy(bootstrap.element_types, 'id')

  const catalog = (bootstrap.elements ?? []).map((element) => ({
    ...toSearchResult(element, teamsById.get(element.team), typesById.get(element.element_type)),
    totalPoints: toNumber(element.total_points, 0),
    form: toNumber(element.form, 0),
  }))

  // No term → lead with the most productive players (last season's points, then
  // current form), so the default list is genuinely "players to watch".
  if (!term) {
    return [...catalog]
      .sort((left, right) => (right.totalPoints - left.totalPoints) || (right.form - left.form))
      .slice(0, RESULT_LIMIT)
      .map(stripSort)
  }
  return rankMatches(catalog, term).map(stripSort)
}

/* --------------------------------------------------------------- dashboard */

function seasonLabelFromEvents(events) {
  const first = (events ?? []).find((event) => event.deadline_time)?.deadline_time
  const year = first ? Number(String(first).slice(0, 4)) : NaN
  return Number.isFinite(year) ? `${year}/${String((year + 1) % 100).padStart(2, '0')}` : 'Current season'
}

/** Only the values FPL actually reports per match. */
function playerStatsFrom(entry) {
  if (!entry) return null
  const expectedGoals = toNumber(entry.expected_goals)
  return {
    minutes: toNumber(entry.minutes, 0),
    goals: toNumber(entry.goals_scored, 0),
    assists: toNumber(entry.assists, 0),
    expectedGoals: expectedGoals === null ? null : expectedGoals.toFixed(2),
    bonus: toNumber(entry.bonus, 0),
    points: toNumber(entry.total_points, 0),
  }
}

function recentFromHistory(entry, teamsById, fixtureState) {
  const opponent = teamsById.get(entry.opponent_team)
  const own = entry.was_home ? entry.team_h_score : entry.team_a_score
  const other = entry.was_home ? entry.team_a_score : entry.team_h_score
  // FPL history carries the *live* score while a match is in progress, so only
  // grade a result once the fixture has actually finished — otherwise a 2–0 at
  // half-time would show as a completed win.
  const state = fixtureState?.get(entry.fixture)
  const live = Boolean(state?.started && !state?.finished)
  let result = null
  if (!live && own !== null && own !== undefined && other !== null && other !== undefined) {
    result = own > other ? 'W' : own < other ? 'L' : 'D'
  }
  return {
    id: `fpl:${entry.fixture}`,
    opponent: opponent?.name ?? 'Unknown club',
    opponentCrest: opponent?.code ? teamCrestUrl(opponent.code) : null,
    utcDate: toIso(entry.kickoff_time),
    homeScore: toNumber(entry.team_h_score, null),
    awayScore: toNumber(entry.team_a_score, null),
    result,
    live,
    home: Boolean(entry.was_home),
    playerStats: playerStatsFrom(entry),
  }
}

function upcomingFromSummary(fixtures, teamsById) {
  const now = Date.now()
  return (fixtures ?? [])
    .filter((fixture) => fixture.kickoff_time && new Date(fixture.kickoff_time).getTime() >= now)
    .slice(0, 5)
    .map((fixture) => ({
      id: `fpl:${fixture.id}`,
      homeTeam: teamsById.get(fixture.team_h)?.name ?? 'To be confirmed',
      awayTeam: teamsById.get(fixture.team_a)?.name ?? 'To be confirmed',
      utcDate: toIso(fixture.kickoff_time),
      venue: null,
      isHome: Boolean(fixture.is_home),
    }))
}

/**
 * A transparent form heuristic: recent points per available point, nudged for
 * home advantage. Labelled in the UI as an estimate, not a probability.
 */
function estimateOutcome(recentMatches, selectedTeamIsHome) {
  const decided = recentMatches.filter((match) => match.result !== null)
  if (decided.length === 0) return null

  const points = decided.reduce((total, match) => (
    total + (match.result === 'W' ? 3 : match.result === 'D' ? 1 : 0)
  ), 0)
  const formStrength = points / (decided.length * 3)
  const selected = Math.round(27 + formStrength * 42 + (selectedTeamIsHome ? 5 : 0))
  const draw = Math.round(30 - formStrength * 9)
  const opponent = 100 - selected - draw

  return {
    home: selectedTeamIsHome ? selected : opponent,
    draw,
    away: selectedTeamIsHome ? opponent : selected,
    sampleSize: decided.length,
  }
}

function buildNextFixture(upcoming, recentMatches, teamName) {
  if (!upcoming) {
    return {
      available: false,
      homeTeam: teamName,
      awayTeam: null,
      utcDate: null,
      venue: null,
      selectedTeamSide: null,
      prediction: null,
      advice: 'No upcoming fixture has been published for this club yet.',
    }
  }
  return {
    available: true,
    homeTeam: upcoming.homeTeam,
    awayTeam: upcoming.awayTeam,
    utcDate: upcoming.utcDate,
    venue: upcoming.venue,
    selectedTeamSide: upcoming.isHome ? 'home' : 'away',
    prediction: estimateOutcome(recentMatches, upcoming.isHome),
    advice: "Estimated from this club's recent Premier League results and home advantage. Not betting advice.",
  }
}

function summarize(recentMatches) {
  const decided = recentMatches.filter((match) => match.result !== null)
  // Only completed matches count toward the totals — a live match isn't final.
  const teamGoals = decided.reduce((total, match) => {
    const own = match.home ? match.homeScore : match.awayScore
    return total + (own ?? 0)
  }, 0)
  const hasPlayerStats = recentMatches.some((match) => match.playerStats !== null)
  return {
    matches: recentMatches.length,
    wins: decided.filter((match) => match.result === 'W').length,
    draws: decided.filter((match) => match.result === 'D').length,
    losses: decided.filter((match) => match.result === 'L').length,
    teamGoals,
    player: hasPlayerStats
      ? {
        goals: recentMatches.reduce((total, match) => total + (match.playerStats?.goals ?? 0), 0),
        assists: recentMatches.reduce((total, match) => total + (match.playerStats?.assists ?? 0), 0),
        minutes: recentMatches.reduce((total, match) => total + (match.playerStats?.minutes ?? 0), 0),
      }
      : null,
  }
}

/**
 * Season-long totals. In season these come from the campaign in progress; before
 * a ball is kicked, `history_past` still describes the last completed one, which
 * is more useful than a column of zeroes.
 */
function seasonTotals(element, elementSummary, seasonLabelText, seasonUnderway) {
  const liveMinutes = toNumber(element.minutes, 0)
  if (seasonUnderway && liveMinutes > 0) {
    return {
      seasonLabel: seasonLabelText,
      isPreviousSeason: false,
      appearances: toNumber(element.starts, null),
      minutes: liveMinutes,
      goals: toNumber(element.goals_scored, 0),
      assists: toNumber(element.assists, 0),
      expectedGoals: toNumber(element.expected_goals),
      expectedAssists: toNumber(element.expected_assists),
      points: toNumber(element.total_points, 0),
    }
  }

  const past = (elementSummary.history_past ?? []).at(-1)
  if (!past) return null
  return {
    seasonLabel: past.season_name ?? 'Previous season',
    isPreviousSeason: true,
    appearances: toNumber(past.starts, null),
    minutes: toNumber(past.minutes, 0),
    goals: toNumber(past.goals_scored, 0),
    assists: toNumber(past.assists, 0),
    expectedGoals: toNumber(past.expected_goals),
    expectedAssists: toNumber(past.expected_assists),
    points: toNumber(past.total_points, 0),
  }
}

export async function getPlayerDashboard({ identity, fpl }) {
  if (!identity.startsWith('fpl:')) throw new HttpError('Unrecognised player reference.', 400)
  const playerId = Number(identity.slice('fpl:'.length))
  if (!Number.isFinite(playerId)) throw new HttpError('That player reference is not valid.', 400)

  const bootstrap = await fpl.getBootstrap()
  const element = (bootstrap.elements ?? []).find((entry) => entry.id === playerId)
  if (!element) throw new HttpError('That player is not in the Fantasy Premier League squad.', 404)

  const teamsById = indexBy(bootstrap.teams, 'id')
  const team = teamsById.get(element.team)
  const positionType = (bootstrap.element_types ?? []).find((entry) => entry.id === element.element_type)
  const seasonUnderway = (bootstrap.events ?? []).some((event) => event.finished)
  const seasonLabelText = seasonLabelFromEvents(bootstrap.events)
  // The live match a player could feature in is in the current gameweek — pull
  // that on the short (8s) TTL so a finishing match flips out of "live" quickly;
  // any older match not in this map is, by definition, already finished.
  const currentEvent = (bootstrap.events ?? []).find((event) => event.is_current)
    ?? (bootstrap.events ?? []).find((event) => event.is_next)

  const [summary, fixtures] = await Promise.all([
    fpl.getElementSummary(playerId),
    currentEvent ? fpl.getLiveFixtures(currentEvent.id) : Promise.resolve([]),
  ])
  // Which fixtures have actually finished, so an in-progress match isn't graded.
  const fixtureState = new Map((fixtures ?? []).map((fixture) => [fixture.id, {
    started: Boolean(fixture.started),
    finished: Boolean(fixture.finished || fixture.finished_provisional),
  }]))

  const played = (summary.history ?? [])
    .filter((entry) => entry.team_h_score !== null && entry.team_h_score !== undefined)
    .slice(-RECENT_MATCH_LIMIT)
    .reverse()
  const recentMatches = played.map((entry) => recentFromHistory(entry, teamsById, fixtureState))
  const upcomingFixtures = upcomingFromSummary(summary.fixtures, teamsById)
  const name = fullName(element)

  return {
    id: `fpl:${element.id}`,
    name,
    initials: initials(name),
    photoUrl: playerPhotoUrl(element.code),
    team: team?.name ?? 'Unknown club',
    teamCrestUrl: team?.code ? teamCrestUrl(team.code) : null,
    shirtNumber: element.squad_number ?? null,
    position: positionType?.singular_name ?? 'Player',
    nationality: null,
    availability: availabilityOf(element),
    competition: { code: 'PL', name: 'Premier League', seasonLabel: seasonLabelText },
    formPeriod: { seasonLabel: seasonLabelText, isPreviousSeason: recentMatches.length === 0 },
    hasPlayerMatchStats: recentMatches.some((match) => match.playerStats !== null),
    seasonTotals: seasonTotals(element, summary, seasonLabelText, seasonUnderway),
    metricsNote: 'Per-match minutes, goals, assists and xG come from the Fantasy Premier League API.',
    summary: summarize(recentMatches),
    form: recentMatches.map((match) => match.result).filter(Boolean),
    recentMatches,
    upcomingFixtures,
    nextFixture: buildNextFixture(upcomingFixtures[0], recentMatches, team?.name ?? 'This club'),
  }
}
