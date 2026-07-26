import { seasonLabel, seasonPhase, seasonStartYear } from './competitions.js'
import { availabilityOf, fullName, indexBy, playerPhotoUrl } from './providers/fpl.js'
import { initials, normalizeName, samePerson, toIso, toNumber } from './format.js'

const HOUR = 60 * 60 * 1000
// Static data (pre-season fixtures, a finished season's scorers) barely changes,
// so it can be cached for hours; an in-progress round can carry live scores.
const STATIC_TTL = 6 * HOUR
const LIVE_TTL = 5 * 60 * 1000

/** Football-Data groups scorers by squad section; these read better as positions. */
const SECTION_POSITIONS = {
  Offence: 'Forward',
  Midfield: 'Midfielder',
  Defence: 'Defender',
  Goalkeeper: 'Goalkeeper',
}

const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED'])
const FINISHED_STATUSES = new Set(['FINISHED', 'AWARDED'])
const OFF_STATUSES = new Set(['POSTPONED', 'SUSPENDED', 'CANCELLED'])

function dayKey(value) {
  return String(value ?? '').slice(0, 10)
}

function matchState(match) {
  if (LIVE_STATUSES.has(match.status)) return 'live'
  if (FINISHED_STATUSES.has(match.status)) return 'finished'
  if (OFF_STATUSES.has(match.status)) return 'off'
  return 'scheduled'
}

function toTeamSide(team, score) {
  return {
    id: team?.id ?? null,
    name: team?.name ?? 'To be confirmed',
    shortName: team?.shortName ?? team?.name ?? 'TBC',
    tla: team?.tla ?? null,
    crest: team?.crest ?? null,
    score: toNumber(score),
  }
}

function toMatch(match) {
  const state = matchState(match)
  const full = match.score?.fullTime ?? {}
  return {
    id: String(match.id),
    utcDate: toIso(match.utcDate),
    status: match.status,
    state,
    matchday: match.matchday ?? null,
    // A finished match without a stored score is a data gap, not a 0-0.
    hasScore: state !== 'scheduled' && full.home !== null && full.home !== undefined,
    homeTeam: toTeamSide(match.homeTeam, full.home),
    awayTeam: toTeamSide(match.awayTeam, full.away),
    venue: match.venue ?? null,
  }
}

/**
 * Choose the matchday the front page should lead with. In season that is
 * whatever is live or playing today; outside it, the next round due, and
 * failing that the last one played. Returns null when the competition has no
 * usable fixtures at all.
 */
function pickFocus(matches) {
  const usable = matches.filter((match) => match.matchday !== null && match.utcDate)
  if (usable.length === 0) return null

  const live = usable.filter((match) => match.state === 'live')
  if (live.length > 0) return { matchday: live[0].matchday, reason: 'live' }

  const today = dayKey(new Date().toISOString())
  const todays = usable.filter((match) => dayKey(match.utcDate) === today)
  if (todays.length > 0) return { matchday: todays[0].matchday, reason: 'today' }

  const now = Date.now()
  const upcoming = usable
    .filter((match) => match.state === 'scheduled' && new Date(match.utcDate).getTime() >= now)
    .sort((left, right) => new Date(left.utcDate) - new Date(right.utcDate))
  if (upcoming.length > 0) return { matchday: upcoming[0].matchday, reason: 'upcoming' }

  const played = usable
    .filter((match) => match.state === 'finished')
    .sort((left, right) => new Date(right.utcDate) - new Date(left.utcDate))
  if (played.length > 0) return { matchday: played[0].matchday, reason: 'recent' }

  return null
}

function describeFocus(reason, matchday, matches) {
  const kickoff = matches
    .map((match) => match.utcDate)
    .filter(Boolean)
    .sort()[0]

  switch (reason) {
    case 'live':
      return { heading: 'Live now', note: `Matchday ${matchday} is in progress.` }
    case 'today':
      return { heading: 'Playing today', note: `Matchday ${matchday}.` }
    case 'upcoming':
      return { heading: `Matchday ${matchday}`, note: 'Next round of fixtures.', kickoff }
    case 'recent':
      return { heading: `Matchday ${matchday}`, note: 'Most recent completed round.' }
    default:
      return { heading: 'Fixtures', note: '' }
  }
}

/**
 * Find the focus round from a single fetch of the whole season.
 *
 * One `?season=` query returns every fixture — finished, live and scheduled —
 * so the focus round and its complete set of matches are both derived in
 * memory. This replaces the earlier windowed + status + re-query sequence
 * (up to three metered calls) with one. The previous-season fallback only runs
 * in the rare case where the current season has no published fixtures at all.
 */
async function findFocusMatches(footballData, code, currentYear, ttl) {
  let season = currentYear
  let all = currentYear !== null
    ? (await footballData.getCompetitionMatches(code, { season: currentYear }, ttl)).map(toMatch)
    : []
  let focus = pickFocus(all)

  if (!focus && currentYear !== null) {
    season = currentYear - 1
    all = (await footballData.getCompetitionMatches(code, { season }, STATIC_TTL)).map(toMatch)
    focus = pickFocus(all)
  }

  if (!focus) return { focus: null, matches: [], season }

  const matches = all
    .filter((match) => match.matchday === focus.matchday)
    .sort((left, right) => String(left.utcDate).localeCompare(String(right.utcDate)))

  return { focus, matches, season }
}

function scorerStats(scorer) {
  return [
    { label: 'Goals', value: toNumber(scorer.goals, 0) },
    { label: 'Assists', value: toNumber(scorer.assists, 0) },
    { label: 'Apps', value: toNumber(scorer.playedMatches, 0) },
  ]
}

/**
 * Premier League scorers gain the detail FPL publishes and Football-Data does
 * not: a portrait, expected goals, minutes, and current availability.
 */
/**
 * Several squad members can be name-compatible with one scorer — "João Pedro"
 * is a subset of both "João Pedro Junqueira de Jesus" and any other João Pedro
 * on the books. Taking the first match picked a reserve defender with no
 * minutes, so score the candidates and keep the strongest: an exact name wins,
 * then a matching club, then whoever actually played.
 */
function bestFplMatch(entry, elements, teamsById) {
  const target = normalizeName(entry.name)
  const clubKeys = [entry.team, entry.teamShort].map(normalizeName).filter(Boolean)

  let best = null
  let bestScore = -Infinity

  for (const candidate of elements) {
    const candidateName = fullName(candidate)
    if (!samePerson(candidateName, entry.name)) continue

    const team = teamsById.get(candidate.team)
    const candidateClubs = [team?.name, team?.short_name].map(normalizeName).filter(Boolean)

    let score = 0
    if (normalizeName(candidateName) === target) score += 1000
    if (candidateClubs.some((club) => clubKeys.some((key) => key.includes(club) || club.includes(key)))) {
      score += 500
    }
    score += Math.min(toNumber(candidate.minutes, 0), 5000) / 100

    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

function enrichWithFpl(entry, elements, typesById, teamsById) {
  const element = bestFplMatch(entry, elements, teamsById)
  if (!element) return entry

  const expectedGoals = toNumber(element.expected_goals)
  const minutes = toNumber(element.minutes)

  return {
    ...entry,
    photoUrl: playerPhotoUrl(element.code) ?? entry.photoUrl,
    // Selecting a card should open the richer FPL dashboard, not the sparse one.
    searchId: `fpl:${element.id}`,
    availability: availabilityOf(element),
    position: typesById.get(element.element_type)?.singular_name ?? entry.position,
    stats: [
      ...entry.stats,
      ...(expectedGoals !== null ? [{ label: 'xG', value: expectedGoals.toFixed(1) }] : []),
      ...(minutes !== null ? [{ label: 'Mins', value: minutes }] : []),
    ],
  }
}

/**
 * Leading scorers, choosing the season from the phase so it costs one call.
 * Pre-season the current campaign has no goals, so go straight to the completed
 * one; only if an active season somehow returns nothing (the first days, before
 * anyone has scored) do we spend a second call on the fallback.
 */
async function loadScorers(footballData, competition, currentYear, phase) {
  const wantsPrevious = phase === 'pre'
  const ttl = phase === 'active' ? HOUR : STATIC_TTL
  const firstSeason = wantsPrevious && currentYear !== null ? currentYear - 1 : currentYear

  let usedYear = firstSeason
  let isFallback = wantsPrevious
  let scorers = firstSeason !== null
    ? await footballData.getScorers(competition.code, { season: firstSeason, limit: 10, ttl })
    : []

  if (scorers.length === 0 && !wantsPrevious && currentYear !== null) {
    usedYear = currentYear - 1
    scorers = await footballData.getScorers(competition.code, { season: usedYear, limit: 10, ttl: STATIC_TTL })
    isFallback = scorers.length > 0
  }

  return { scorers, usedYear, isFallback }
}

async function buildPlayersToWatch({ footballData, fpl, competition, currentYear, phase }) {
  const { scorers, usedYear, isFallback } = await loadScorers(footballData, competition, currentYear, phase)

  let entries = scorers.map((scorer) => ({
    id: `fd:${competition.code}:${scorer.team?.id}:${scorer.player?.id}`,
    searchId: null,
    name: scorer.player?.name ?? 'Unknown player',
    initials: initials(scorer.player?.name),
    photoUrl: null,
    team: scorer.team?.name ?? 'Unknown club',
    teamShort: scorer.team?.shortName ?? scorer.team?.tla ?? null,
    teamCrestUrl: scorer.team?.crest ?? null,
    position: scorer.player?.position
      ?? SECTION_POSITIONS[scorer.player?.section]
      ?? scorer.player?.section
      ?? null,
    nationality: scorer.player?.nationality ?? null,
    availability: null,
    stats: scorerStats(scorer),
  }))

  if (competition.supportsFpl && entries.length > 0) {
    try {
      const bootstrap = await fpl.getBootstrap()
      const typesById = indexBy(bootstrap.element_types, 'id')
      const teamsById = indexBy(bootstrap.teams, 'id')
      entries = entries.map((entry) => enrichWithFpl(entry, bootstrap.elements ?? [], typesById, teamsById))
    } catch {
      // FPL is unofficial and unreliable; its extras are a bonus, not a requirement.
    }
  }

  return {
    heading: 'Players to watch',
    subheading: isFallback
      ? `Leading scorers, ${seasonLabelForYear(usedYear)} (the new season has not started)`
      : `Leading scorers, ${seasonLabelForYear(usedYear)}`,
    seasonStartYear: usedYear,
    isPreviousSeason: isFallback,
    items: entries,
  }
}

function seasonLabelForYear(year) {
  if (!Number.isFinite(year)) return 'current season'
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`
}

export async function getSpotlight({ competition, footballData, fpl }) {
  const meta = await footballData.getCompetitionMeta(competition.code)
  const currentSeason = meta.currentSeason ?? null
  const currentYear = seasonStartYear(currentSeason)
  const phase = seasonPhase(currentSeason)
  // Only an in-progress round can change under us; everything else is static.
  const matchesTtl = phase === 'active' ? LIVE_TTL : STATIC_TTL

  const [matchResult, playersToWatch] = await Promise.all([
    findFocusMatches(footballData, competition.code, currentYear, matchesTtl),
    buildPlayersToWatch({ footballData, fpl, competition, currentYear, phase }),
  ])

  const { focus, matches, season } = matchResult
  const described = focus
    ? describeFocus(focus.reason, focus.matchday, matches)
    : { heading: 'No fixtures published', note: 'This competition has no scheduled or completed matches available.' }

  return {
    competition: {
      code: competition.code,
      name: competition.name,
      country: competition.country,
      emblem: meta.emblem ?? null,
      seasonLabel: seasonLabel(currentSeason),
      currentMatchday: currentSeason?.currentMatchday ?? null,
      supportsFpl: competition.supportsFpl,
    },
    matches: {
      state: focus?.reason ?? 'none',
      heading: described.heading,
      note: described.note,
      firstKickoff: described.kickoff ?? null,
      matchday: focus?.matchday ?? null,
      seasonStartYear: season,
      isPreviousSeason: season !== null && season !== seasonStartYear(currentSeason),
      items: matches,
    },
    playersToWatch,
  }
}
