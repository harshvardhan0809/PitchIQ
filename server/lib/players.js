import { HttpError } from './http.js'
import { getCompetition } from './competitions.js'
import {
  availabilityOf,
  fullName,
  indexBy,
  playerPhotoUrl,
  teamCrestUrl,
} from './providers/fpl.js'
import { initials, normalizeName, samePerson, toIso, toNumber } from './format.js'

const RESULT_LIMIT = 10
const RECENT_MATCH_LIMIT = 5

/* ------------------------------------------------------------------ search */

function relevance(name, term) {
  const normalized = normalizeName(name)
  if (normalized.startsWith(term)) return 0
  const startsToken = name
    .split(/[\s-]+/)
    .map(normalizeName)
    .some((token) => token.startsWith(term))
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

function toFplSearchResult(element, team, positionType) {
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

function toFootballDataSearchResult(player, team, competition) {
  return {
    id: `fd:${competition.code}:${team.id}:${player.id}`,
    name: player.name,
    initials: initials(player.name),
    team: team.name,
    position: player.position || 'Player',
    photoUrl: null,
    availability: null,
  }
}

async function searchFootballData({ footballData, competition, term, season }) {
  const teams = await footballData.getTeams(competition.code, season)
  const players = teams.flatMap((team) => (
    (team.squad ?? []).map((player) => toFootballDataSearchResult(player, team, competition))
  ))
  if (!term) return players.slice(0, RESULT_LIMIT)
  return rankMatches(players, term)
}

/**
 * With no search term, lead with the competition's leading scorers rather than
 * an arbitrary slice of the squad list — the same players the front page
 * highlights, so the two views agree.
 */
async function defaultFplResults({ footballData, competition, catalog, season }) {
  try {
    const scorers = await footballData.getScorers(competition.code, { season, limit: RESULT_LIMIT })
    const byName = new Map(catalog.map((player) => [normalizeName(player.name), player]))
    const featured = scorers
      .map((scorer) => byName.get(normalizeName(scorer.player?.name)))
      .filter(Boolean)
    if (featured.length > 0) return featured.slice(0, RESULT_LIMIT)
  } catch {
    // Fall through to the catalog ordering below.
  }

  return [...catalog]
    .sort((left, right) => right.totalPoints - left.totalPoints)
    .slice(0, RESULT_LIMIT)
    .map(withoutRanking)
}

/** The ranking key is an internal sort aid, not part of the search payload. */
function withoutRanking(player) {
  const copy = { ...player }
  delete copy.totalPoints
  return copy
}

export async function searchPlayers({ query, competition, footballData, fpl, season }) {
  const term = String(query ?? '').trim()

  if (!competition.supportsFpl) {
    return searchFootballData({ footballData, competition, term, season })
  }

  const bootstrap = await fpl.getBootstrap()
  const teamsById = indexBy(bootstrap.teams, 'id')
  const typesById = indexBy(bootstrap.element_types, 'id')
  const catalog = (bootstrap.elements ?? []).map((element) => ({
    ...toFplSearchResult(element, teamsById.get(element.team), typesById.get(element.element_type)),
    totalPoints: toNumber(element.total_points, 0),
  }))

  if (!term) {
    return defaultFplResults({ footballData, competition, catalog, season })
  }

  return rankMatches(catalog, term).map(withoutRanking)
}

/* --------------------------------------------------------------- dashboard */

function resultFor(match, teamId) {
  const isHome = match.homeTeam?.id === teamId
  const own = toNumber(isHome ? match.score?.fullTime?.home : match.score?.fullTime?.away)
  const other = toNumber(isHome ? match.score?.fullTime?.away : match.score?.fullTime?.home)
  if (own === null || other === null) return null
  if (own > other) return 'W'
  if (own < other) return 'L'
  return 'D'
}

function toRecentMatch(match, teamId, playerStats) {
  const isHome = match.homeTeam?.id === teamId
  return {
    id: String(match.id),
    opponent: (isHome ? match.awayTeam?.name : match.homeTeam?.name) ?? 'Unknown club',
    opponentCrest: (isHome ? match.awayTeam?.crest : match.homeTeam?.crest) ?? null,
    utcDate: toIso(match.utcDate),
    homeScore: toNumber(match.score?.fullTime?.home),
    awayScore: toNumber(match.score?.fullTime?.away),
    result: resultFor(match, teamId),
    home: isHome,
    playerStats,
  }
}

/**
 * FPL history and Football-Data results are joined on the calendar day plus the
 * scoreline, which is unique enough within a single club's season.
 */
function fplHistoryKey(entry) {
  return [
    String(entry.kickoff_time ?? '').slice(0, 10),
    entry.team_h_score,
    entry.team_a_score,
    Boolean(entry.was_home),
  ].join('|')
}

function footballDataHistoryKey(match, teamId) {
  return [
    String(match.utcDate ?? '').slice(0, 10),
    match.score?.fullTime?.home,
    match.score?.fullTime?.away,
    match.homeTeam?.id === teamId,
  ].join('|')
}

/**
 * Only the values FPL actually reports. Earlier revisions padded this with
 * shots/on-target derived from goals and assists, which put wrong numbers
 * behind right-sounding labels.
 */
function toPlayerStats(entry) {
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

/**
 * Season-long totals for the player. In season these come from the campaign in
 * progress; before a ball is kicked, `history_past` still describes the last
 * completed one, which is more useful than a column of zeroes.
 */
function toSeasonTotals(element, elementSummary, seasonLabelText, seasonUnderway) {
  const liveMinutes = toNumber(element.minutes, 0)
  // Before the first gameweek completes, bootstrap still carries last season's
  // totals, so non-zero minutes there are not evidence of current-season play.
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

function toUpcomingFixture({ id, homeTeam, awayTeam, utcDate, venue, isHome }) {
  return { id, homeTeam, awayTeam, utcDate, venue: venue ?? null, isHome }
}

function upcomingFromFootballData(matches, teamId) {
  const now = Date.now()
  return matches
    .filter((match) => match.status !== 'FINISHED' && match.utcDate && new Date(match.utcDate).getTime() >= now)
    .sort((left, right) => new Date(left.utcDate) - new Date(right.utcDate))
    .map((match) => toUpcomingFixture({
      id: `fd:${match.id}`,
      homeTeam: match.homeTeam?.name ?? 'To be confirmed',
      awayTeam: match.awayTeam?.name ?? 'To be confirmed',
      utcDate: toIso(match.utcDate),
      venue: match.venue,
      isHome: match.homeTeam?.id === teamId,
    }))
}

function upcomingFromFpl(fixtures, fplTeamId, teamsById) {
  const now = Date.now()
  return (fixtures ?? [])
    .filter((fixture) => !fixture.finished && (fixture.team_h === fplTeamId || fixture.team_a === fplTeamId))
    .filter((fixture) => fixture.kickoff_time && new Date(fixture.kickoff_time).getTime() >= now)
    .sort((left, right) => new Date(left.kickoff_time) - new Date(right.kickoff_time))
    .map((fixture) => toUpcomingFixture({
      id: `fpl:${fixture.id}`,
      homeTeam: teamsById.get(fixture.team_h)?.name ?? 'To be confirmed',
      awayTeam: teamsById.get(fixture.team_a)?.name ?? 'To be confirmed',
      utcDate: toIso(fixture.kickoff_time),
      venue: null,
      isHome: fixture.team_h === fplTeamId,
    }))
}

/**
 * The two providers spell clubs differently ("Liverpool" vs "Liverpool FC"), so
 * a fixture present in both must be matched on normalized names — otherwise the
 * same game is listed twice.
 */
function mergeFixtures(primary, secondary, limit = 5) {
  const seen = new Set()
  const merged = []

  for (const fixture of [...primary, ...secondary]) {
    const key = [
      String(fixture.utcDate ?? '').slice(0, 13),
      ...[fixture.homeTeam, fixture.awayTeam].map(normalizeName).sort(),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(fixture)
    if (merged.length >= limit) break
  }

  return merged
}

/**
 * A transparent form heuristic: recent points per available point, nudged for
 * home advantage. It deliberately ignores opponent strength, and the UI labels
 * it as an estimate rather than a probability.
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

function buildNextFixture(upcoming, recentMatches, competition, teamName) {
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
    // Sent explicitly so the client never has to compare club names across providers.
    selectedTeamSide: upcoming.isHome ? 'home' : 'away',
    prediction: estimateOutcome(recentMatches, upcoming.isHome),
    advice: `Estimated from this club's recent ${competition.name} results and home advantage. Not betting advice.`,
  }
}

function summarize(recentMatches) {
  const decided = recentMatches.filter((match) => match.result !== null)
  const teamGoals = recentMatches.reduce((total, match) => {
    const own = match.home ? match.homeScore : match.awayScore
    return total + (own ?? 0)
  }, 0)
  const playerGoals = recentMatches.reduce((total, match) => total + (match.playerStats?.goals ?? 0), 0)
  const playerAssists = recentMatches.reduce((total, match) => total + (match.playerStats?.assists ?? 0), 0)
  const playerMinutes = recentMatches.reduce((total, match) => total + (match.playerStats?.minutes ?? 0), 0)
  const hasPlayerStats = recentMatches.some((match) => match.playerStats !== null)

  return {
    matches: recentMatches.length,
    wins: decided.filter((match) => match.result === 'W').length,
    draws: decided.filter((match) => match.result === 'D').length,
    losses: decided.filter((match) => match.result === 'L').length,
    teamGoals,
    player: hasPlayerStats
      ? { goals: playerGoals, assists: playerAssists, minutes: playerMinutes }
      : null,
  }
}

function mostRecentPlayed(matches) {
  return matches
    .filter((match) => match.score?.fullTime?.home !== null && match.score?.fullTime?.home !== undefined)
    .sort((left, right) => new Date(right.utcDate) - new Date(left.utcDate))
    .slice(0, RECENT_MATCH_LIMIT)
}

/**
 * Recent results plus the forward schedule. Before a season kicks off the
 * current campaign has no results at all, so fall back to the previous one and
 * report which season the form actually describes.
 */
async function loadTeamContext(footballData, competitionCode, teamId, season) {
  const [finished, scheduled] = await Promise.all([
    footballData.getTeamMatches(teamId, { competitions: competitionCode, status: 'FINISHED', season, limit: 20 }),
    footballData.getTeamMatches(teamId, { competitions: competitionCode, season, limit: 40 }),
  ])

  let played = mostRecentPlayed(finished)
  let formSeason = season
  let isPreviousSeason = false

  if (played.length === 0 && Number.isFinite(season)) {
    const previous = await footballData.getTeamMatches(teamId, {
      competitions: competitionCode,
      status: 'FINISHED',
      season: season - 1,
      limit: 20,
    })
    played = mostRecentPlayed(previous)
    if (played.length > 0) {
      formSeason = season - 1
      isPreviousSeason = true
    }
  }

  return { played, scheduled, season, formSeason, isPreviousSeason }
}

async function footballDataDashboard({ identity, footballData, competition, season }) {
  const [, , rawTeamId, rawPlayerId] = identity.split(':')
  const teamId = Number(rawTeamId)
  const playerId = Number(rawPlayerId)
  if (!Number.isFinite(teamId) || !Number.isFinite(playerId)) {
    throw new HttpError('That player reference is not valid.', 400)
  }

  const teams = await footballData.getTeams(competition.code, season)
  const team = teams.find((entry) => entry.id === teamId)
  const player = team?.squad?.find((entry) => entry.id === playerId)
  if (!team || !player) {
    throw new HttpError('That player is not in the current squad list for this competition.', 404)
  }

  const context = await loadTeamContext(footballData, competition.code, team.id, season)
  const recentMatches = context.played.map((match) => toRecentMatch(match, team.id, null))
  const upcomingFixtures = mergeFixtures(upcomingFromFootballData(context.scheduled, team.id), [])

  return {
    id: identity,
    name: player.name,
    initials: initials(player.name),
    photoUrl: null,
    team: team.name,
    teamCrestUrl: team.crest ?? null,
    shirtNumber: player.shirtNumber ?? null,
    position: player.position || 'Player',
    nationality: player.nationality ?? null,
    availability: null,
    competition: { code: competition.code, name: competition.name, seasonLabel: seasonLabelFor(season) },
    formPeriod: {
      seasonLabel: seasonLabelFor(context.formSeason),
      isPreviousSeason: context.isPreviousSeason,
    },
    hasPlayerMatchStats: false,
    seasonTotals: null,
    metricsNote: `${competition.name} data comes from Football-Data.org, which publishes squads and team results but not per-player match metrics. Minutes, goals and xG per match are Premier League only.`,
    summary: summarize(recentMatches),
    form: recentMatches.map((match) => match.result).filter(Boolean),
    recentMatches,
    upcomingFixtures,
    nextFixture: buildNextFixture(upcomingFixtures[0], recentMatches, competition, team.name),
  }
}

function seasonLabelFor(season) {
  if (!Number.isFinite(season)) return 'Current season'
  return `${season}/${String((season + 1) % 100).padStart(2, '0')}`
}

async function fplDashboard({ identity, footballData, fpl, competition, season }) {
  const playerId = Number(identity.slice('fpl:'.length))
  if (!Number.isFinite(playerId)) {
    throw new HttpError('That player reference is not valid.', 400)
  }

  const bootstrap = await fpl.getBootstrap()
  const element = (bootstrap.elements ?? []).find((entry) => entry.id === playerId)
  if (!element) throw new HttpError('That player is not in the Fantasy Premier League squad list.', 404)

  const fplTeam = (bootstrap.teams ?? []).find((entry) => entry.id === element.team)
  if (!fplTeam) throw new HttpError('No club could be resolved for that player.', 502)

  const positionType = (bootstrap.element_types ?? []).find((entry) => entry.id === element.element_type)
  const teams = await footballData.getTeams(competition.code, season)
  const byKey = new Map()
  teams.forEach((team) => {
    [team.name, team.shortName, team.tla].forEach((label) => {
      const key = normalizeName(label)
      if (key) byKey.set(key, team)
    })
  })

  const fdTeam = [fplTeam.name, fplTeam.short_name]
    .map((label) => byKey.get(normalizeName(label)))
    .find(Boolean)
  if (!fdTeam) {
    throw new HttpError(
      `${fplTeam.name} could not be matched to a Football-Data.org club in ${competition.name}.`,
      502,
    )
  }

  const [context, elementSummary, fplFixtures] = await Promise.all([
    loadTeamContext(footballData, competition.code, fdTeam.id, season),
    fpl.getElementSummary(playerId),
    fpl.getFixtures(),
  ])

  const historyByKey = new Map()
  ;(elementSummary.history ?? []).forEach((entry) => {
    if (entry.kickoff_time) historyByKey.set(fplHistoryKey(entry), entry)
  })

  const recentMatches = context.played.map((match) => toRecentMatch(
    match,
    fdTeam.id,
    toPlayerStats(historyByKey.get(footballDataHistoryKey(match, fdTeam.id))),
  ))

  const upcomingFixtures = mergeFixtures(
    upcomingFromFpl(fplFixtures, fplTeam.id, indexBy(bootstrap.teams, 'id')),
    upcomingFromFootballData(context.scheduled, fdTeam.id),
  )

  const name = fullName(element)
  // FPL leaves squad_number null for essentially every player; Football-Data
  // carries it on the squad entry, which we already have loaded.
  const squadEntry = (fdTeam.squad ?? []).find((entry) => samePerson(entry.name, name))

  return {
    id: `fpl:${element.id}`,
    name,
    initials: initials(name),
    photoUrl: playerPhotoUrl(element.code),
    team: fdTeam.name,
    teamCrestUrl: teamCrestUrl(fplTeam.code) ?? fdTeam.crest ?? null,
    shirtNumber: element.squad_number ?? squadEntry?.shirtNumber ?? null,
    position: positionType?.singular_name ?? 'Player',
    nationality: squadEntry?.nationality ?? null,
    availability: availabilityOf(element),
    competition: { code: competition.code, name: competition.name, seasonLabel: seasonLabelFor(season) },
    formPeriod: {
      seasonLabel: seasonLabelFor(context.formSeason),
      isPreviousSeason: context.isPreviousSeason,
    },
    hasPlayerMatchStats: recentMatches.some((match) => match.playerStats !== null),
    seasonTotals: toSeasonTotals(
      element,
      elementSummary,
      seasonLabelFor(season),
      (bootstrap.events ?? []).some((event) => event.finished),
    ),
    metricsNote: 'Per-match minutes, goals, assists and xG come from the Fantasy Premier League API. Team possession is not available on the free tier.',
    summary: summarize(recentMatches),
    form: recentMatches.map((match) => match.result).filter(Boolean),
    recentMatches,
    upcomingFixtures,
    nextFixture: buildNextFixture(upcomingFixtures[0], recentMatches, competition, fdTeam.name),
  }
}

export async function getPlayerDashboard({ identity, competition, footballData, fpl, season }) {
  if (identity.startsWith('fd:')) {
    // The identity encodes the competition it was built for; honour it so a
    // stale league selection cannot silently resolve against the wrong squad.
    const [, encodedCode] = identity.split(':')
    const resolved = encodedCode ? getCompetition(encodedCode) : competition
    return footballDataDashboard({ identity, footballData, competition: resolved, season })
  }
  if (identity.startsWith('fpl:')) {
    if (!competition.supportsFpl) {
      throw new HttpError('Fantasy Premier League players can only be viewed under the Premier League.', 400)
    }
    return fplDashboard({ identity, footballData, fpl, competition, season })
  }
  throw new HttpError('Unrecognised player reference.', 400)
}
