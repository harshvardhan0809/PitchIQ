import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function loadEnvFile() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env')
  if (!existsSync(envPath)) return

  readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return

      const separator = trimmed.indexOf('=')
      if (separator === -1) return

      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim()
      if (key && process.env[key] === undefined) {
        process.env[key] = value
      }
    })
}

loadEnvFile()

const port = Number(process.env.API_PORT ?? 3001)
const host = process.env.API_HOST ?? '127.0.0.1'
const footballDataKey = process.env.FOOTBALL_DATA_API_KEY ?? ''
const footballDataBaseUrl = process.env.FOOTBALL_DATA_BASE_URL ?? 'https://api.football-data.org/v4'
const competitionCode = process.env.FOOTBALL_DATA_COMPETITION ?? 'PL'
const seasonLabel = process.env.FOOTBALL_DATA_SEASON_LABEL ?? '2025-2026'
const fplBaseUrl = process.env.FPL_BASE_URL ?? 'https://fantasy.premierleague.com/api'
const cache = new Map()
const featuredPlayers = [
  ['Mohamed Salah', 'Liverpool', 'Right Winger'],
  ['Erling Haaland', 'Manchester City', 'Forward'],
  ['Bruno Fernandes', 'Manchester United', 'Midfielder'],
  ['Bukayo Saka', 'Arsenal', 'Right Winger'],
  ['Cole Palmer', 'Chelsea', 'Midfielder'],
  ['Alexander Isak', 'Newcastle United', 'Forward'],
  ['Ollie Watkins', 'Aston Villa', 'Forward'],
  ['Virgil van Dijk', 'Liverpool', 'Centre-Back'],
  ['Alexis Mac Allister', 'Liverpool', 'Midfielder'],
  ['Alisson Becker', 'Liverpool', 'Goalkeeper'],
  ['Phil Foden', 'Manchester City', 'Midfielder'],
  ['Bernardo Silva', 'Manchester City', 'Midfielder'],
  ['Rodri', 'Manchester City', 'Midfielder'],
  ['Ruben Dias', 'Manchester City', 'Centre-Back'],
  ['Kevin De Bruyne', 'Manchester City', 'Midfielder'],
  ['William Saliba', 'Arsenal', 'Centre-Back'],
  ['Martin Odegaard', 'Arsenal', 'Midfielder'],
  ['Declan Rice', 'Arsenal', 'Midfielder'],
  ['Gabriel Martinelli', 'Arsenal', 'Winger'],
  ['Kai Havertz', 'Arsenal', 'Forward'],
  ['Enzo Fernandez', 'Chelsea', 'Midfielder'],
  ['Moises Caicedo', 'Chelsea', 'Midfielder'],
  ['Reece James', 'Chelsea', 'Right-Back'],
  ['Alejandro Garnacho', 'Manchester United', 'Winger'],
  ['Amad Diallo', 'Manchester United', 'Winger'],
  ['Kobbie Mainoo', 'Manchester United', 'Midfielder'],
  ['Bryan Mbeumo', 'Manchester United', 'Forward'],
  ['Sandro Tonali', 'Newcastle United', 'Midfielder'],
  ['Anthony Gordon', 'Newcastle United', 'Winger'],
  ['Morgan Rogers', 'Aston Villa', 'Midfielder'],
  ['Emiliano Martinez', 'Aston Villa', 'Goalkeeper'],
  ['Dominik Szoboszlai', 'Liverpool', 'Midfielder'],
  ['Andrew Robertson', 'Liverpool', 'Left-Back'],
  ['Trent Alexander-Arnold', 'Liverpool', 'Right-Back'],
  ['Son Heung-min', 'Tottenham Hotspur', 'Forward'],
  ['James Maddison', 'Tottenham Hotspur', 'Midfielder'],
  ['Cristian Romero', 'Tottenham Hotspur', 'Centre-Back'],
  ['Jarrod Bowen', 'West Ham United', 'Forward'],
  ['Lucas Paqueta', 'West Ham United', 'Midfielder'],
  ['Eberechi Eze', 'Crystal Palace', 'Midfielder'],
  ['Jean-Philippe Mateta', 'Crystal Palace', 'Forward'],
  ['Jordan Pickford', 'Everton', 'Goalkeeper'],
  ['Antoine Semenyo', 'Bournemouth', 'Forward'],
  ['Bruno Guimaraes', 'Newcastle United', 'Midfielder'],
  ['Joao Pedro', 'Chelsea', 'Forward'],
  ['Liam Delap', 'Chelsea', 'Forward'],
  ['Matheus Cunha', 'Manchester United', 'Forward'],
  ['Benjamin Sesko', 'Manchester United', 'Forward'],
  ['Viktor Gyokeres', 'Arsenal', 'Forward'],
]

function json(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

function initials(name) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(dateString))
}

function formatFixtureDate(event) {
  const timestamp = event.utcDate ?? `${event.dateEvent}T${event.strTime ?? '00:00:00'}`
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function fplPlayerPhotoUrl(code) {
  if (!code) return null
  return `https://resources.premierleague.com/premierleague/photos/players/250x250/p${code}.png`
}

function fplTeamCrestUrl(code) {
  if (!code) return null
  return `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`
}

function historyKey(entry) {
  const day = entry.kickoff_time?.slice(0, 10)
  return `${day}|${entry.team_h_score}|${entry.team_a_score}|${entry.was_home}`
}

function matchHistoryKey(event, fdTeamId) {
  const day = event.utcDate?.slice(0, 10)
  const home = event.homeTeam?.id === fdTeamId
  return `${day}|${event.score?.fullTime?.home}|${event.score?.fullTime?.away}|${home}`
}

function ensureFootballDataKey() {
  if (!footballDataKey) {
    throw new Error('Missing FOOTBALL_DATA_API_KEY. Add it in your .env to enable live mode.')
  }
}

async function getCachedJson(base, endpoint, options = {}) {
  const {
    params = {},
    headers = {},
    ttl = 60 * 60 * 1000,
    errorLabel = 'Provider request failed',
  } = options

  const url = new URL(`${base}/${endpoint}`)
  Object.entries(params).forEach(([name, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(name, value)
  })

  const key = url.toString()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const upstream = await fetch(url, { headers })
  if (!upstream.ok) {
    throw new Error(`${errorLabel} (status ${upstream.status}).`)
  }

  const data = await upstream.json()
  cache.set(key, { data, expiresAt: Date.now() + ttl })
  return data
}

function toSearchPlayer(player, team, position) {
  const name = `${player.first_name} ${player.second_name}`.trim()
  return {
    id: `fpl:${player.id}`,
    name,
    initials: initials(name),
    team: team?.name || 'Team unavailable',
    position: position?.singular_name || 'Player',
    photoUrl: fplPlayerPhotoUrl(player.code),
  }
}

async function getFplBootstrap() {
  return getCachedJson(fplBaseUrl, 'bootstrap-static/', {
    ttl: 5 * 60 * 1000,
    errorLabel: 'FPL request failed',
  })
}

async function getFplFixtures() {
  return getCachedJson(fplBaseUrl, 'fixtures/', {
    ttl: 5 * 60 * 1000,
    errorLabel: 'FPL fixtures request failed',
  })
}

async function getFplElementSummary(playerId) {
  return getCachedJson(fplBaseUrl, `element-summary/${playerId}/`, {
    ttl: 15 * 60 * 1000,
    errorLabel: 'FPL element summary request failed',
  })
}

function buildUpcomingFromFpl(fplTeamId, teamsById, fixtures) {
  const now = Date.now()
  return (fixtures ?? [])
    .filter((fixture) => !fixture.finished && (fixture.team_h === fplTeamId || fixture.team_a === fplTeamId))
    .filter((fixture) => fixture.kickoff_time && new Date(fixture.kickoff_time).getTime() >= now)
    .sort((left, right) => new Date(left.kickoff_time) - new Date(right.kickoff_time))
    .map((fixture) => {
      const isHome = fixture.team_h === fplTeamId
      const homeTeam = teamsById.get(fixture.team_h)
      const awayTeam = teamsById.get(fixture.team_a)
      return {
        id: `fpl-fixture:${fixture.id}`,
        homeTeam: homeTeam?.name ?? 'Home',
        awayTeam: awayTeam?.name ?? 'Away',
        date: formatFixtureDate({ utcDate: fixture.kickoff_time }),
        venue: isHome ? 'Home fixture' : 'Away fixture',
        isHome,
      }
    })
}

function buildUpcomingFromFootballData(fdTeamId, matches) {
  const now = Date.now()
  return (matches ?? [])
    .filter((match) => match.status !== 'FINISHED' && match.utcDate && new Date(match.utcDate).getTime() >= now)
    .sort((left, right) => new Date(left.utcDate) - new Date(right.utcDate))
    .map((match) => ({
      id: String(match.id),
      homeTeam: match.homeTeam?.name ?? 'Home',
      awayTeam: match.awayTeam?.name ?? 'Away',
      date: formatFixtureDate(match),
      venue: match.venue || 'Venue TBC',
      isHome: match.homeTeam?.id === fdTeamId,
    }))
}

function mergeUpcomingFixtures(primary, secondary, limit = 5) {
  const seen = new Set()
  const merged = []

  for (const fixture of [...primary, ...secondary]) {
    const key = `${fixture.date}|${fixture.homeTeam}|${fixture.awayTeam}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(fixture)
    if (merged.length >= limit) break
  }

  return merged
}

function playerMatchStats(historyEntry) {
  const minutes = historyEntry?.minutes ?? 0
  const goals = historyEntry?.goals_scored ?? 0
  const assists = historyEntry?.assists ?? 0
  const expectedGoals = historyEntry?.expected_goals ?? '0.00'

  return {
    minutes,
    goals,
    assists,
    expectedGoals,
    shots: goals,
    onTarget: assists,
    possession: `${expectedGoals} xG`,
  }
}

function resultForEvent(event, fdTeamId) {
  const isHome = event.homeTeam?.id === fdTeamId
  const own = Number(isHome ? event.score?.fullTime?.home : event.score?.fullTime?.away)
  const other = Number(isHome ? event.score?.fullTime?.away : event.score?.fullTime?.home)
  if (!Number.isFinite(own) || !Number.isFinite(other)) return '-'
  if (own > other) return 'W'
  if (own < other) return 'L'
  return 'D'
}

async function footballDataApi(endpoint, params = {}, ttl = 60 * 60 * 1000) {
  ensureFootballDataKey()
  return getCachedJson(footballDataBaseUrl, endpoint, {
    params,
    ttl,
    headers: { 'X-Auth-Token': footballDataKey },
    errorLabel: 'Football-Data.org request failed',
  })
}

async function getCompetitionTeamIndex() {
  const response = await footballDataApi(`competitions/${competitionCode}/teams`, {}, 6 * 60 * 60 * 1000)
  const byKey = new Map()
  ;(response.teams ?? []).forEach((team) => {
    const keys = [team.name, team.shortName, team.tla].map(normalizeName).filter(Boolean)
    keys.forEach((key) => byKey.set(key, team))
  })
  return byKey
}

function mapFplTeamToFootballData(fplTeam, competitionTeamsByKey) {
  const lookupKeys = [fplTeam.short_name, fplTeam.name].map(normalizeName).filter(Boolean)
  for (const key of lookupKeys) {
    const team = competitionTeamsByKey.get(key)
    if (team) return team
  }
  return null
}

function rankedMatches(players, term) {
  const lowerTerm = term.toLowerCase()
  function relevance(player) {
    const lowerName = player.name.toLowerCase()
    const tokenStarts = lowerName.split(' ').some((part) => part.startsWith(lowerTerm))
    if (lowerName.startsWith(lowerTerm)) return 0
    if (tokenStarts) return 1
    return 2
  }

  return players
    .filter((player) => player.name.toLowerCase().includes(lowerTerm))
    .sort((left, right) => {
      const relevanceDifference = relevance(left) - relevance(right)
      return relevanceDifference || left.name.localeCompare(right.name)
    })
    .slice(0, 10)
}

async function searchLivePlayers(search) {
  const term = search.trim()
  const bootstrap = await getFplBootstrap()
  const teamsById = new Map((bootstrap.teams ?? []).map((team) => [team.id, team]))
  const typesById = new Map((bootstrap.element_types ?? []).map((type) => [type.id, type]))
  const liveCatalog = (bootstrap.elements ?? []).map((player) => (
    toSearchPlayer(player, teamsById.get(player.team), typesById.get(player.element_type))
  ))
  if (term.length === 0) {
    const featuredByName = new Set(featuredPlayers.map(([name]) => name.toLowerCase()))
    const featured = liveCatalog.filter((player) => featuredByName.has(player.name.toLowerCase()))
    return (featured.length > 0 ? featured : liveCatalog).slice(0, 10)
  }

  const catalogResults = rankedMatches(liveCatalog, term)
  return catalogResults.slice(0, 10)
}

function estimateProbability(recentMatches, selectedTeamIsHome) {
  if (recentMatches.length === 0) return null

  const points = recentMatches.reduce((total, match) => {
    if (match.result === 'W') return total + 3
    if (match.result === 'D') return total + 1
    return total
  }, 0)
  const formStrength = points / (recentMatches.length * 3)
  const selectedChance = Math.round(27 + formStrength * 42 + (selectedTeamIsHome ? 5 : 0))
  const drawChance = Math.round(30 - formStrength * 9)
  const opponentChance = 100 - selectedChance - drawChance

  return selectedTeamIsHome
    ? { home: selectedChance, draw: drawChance, away: opponentChance }
    : { home: opponentChance, draw: drawChance, away: selectedChance }
}

async function getLiveDashboard(identity) {
  const playerId = Number(identity.replace('fpl:', ''))
  if (!Number.isFinite(playerId)) throw new Error('Invalid player id.')

  const bootstrap = await getFplBootstrap()
  const player = (bootstrap.elements ?? []).find((entry) => entry.id === playerId)
  if (!player) throw new Error('Player not found in FPL.')

  const team = (bootstrap.teams ?? []).find((entry) => entry.id === player.team)
  if (!team) throw new Error('No current team mapping was found for this player.')

  const positionType = (bootstrap.element_types ?? []).find((entry) => entry.id === player.element_type)
  const competitionTeamsByKey = await getCompetitionTeamIndex()
  const mappedCompetitionTeam = mapFplTeamToFootballData(team, competitionTeamsByKey)
  if (!mappedCompetitionTeam) {
    throw new Error(`Could not map ${team.name} to Football-Data.org team id for ${competitionCode}.`)
  }

  const fdTeamId = mappedCompetitionTeam.id
  const fdTeamName = mappedCompetitionTeam.name
  const teamsById = new Map((bootstrap.teams ?? []).map((entry) => [entry.id, entry]))
  const [finishedResponse, allMatchesResponse, elementSummary, fplFixtures] = await Promise.all([
    footballDataApi(`teams/${fdTeamId}/matches`, { competitions: competitionCode, status: 'FINISHED' }, 30 * 60 * 1000),
    footballDataApi(`teams/${fdTeamId}/matches`, { competitions: competitionCode, limit: 40 }, 30 * 60 * 1000),
    getFplElementSummary(playerId),
    getFplFixtures(),
  ])

  const historyByKey = new Map()
  ;(elementSummary.history ?? []).forEach((entry) => {
    if (entry.kickoff_time) historyByKey.set(historyKey(entry), entry)
  })

  const availableEvents = (finishedResponse.matches ?? [])
    .filter((match) => match.score?.fullTime?.home !== null && match.score?.fullTime?.away !== null)
    .sort((left, right) => new Date(right.utcDate) - new Date(left.utcDate))
    .slice(0, 5)

  const recentMatches = availableEvents.map((event) => {
    const home = event.homeTeam?.id === fdTeamId
    const homeScore = event.score?.fullTime?.home ?? '-'
    const awayScore = event.score?.fullTime?.away ?? '-'
    const stats = playerMatchStats(historyByKey.get(matchHistoryKey(event, fdTeamId)))
    return {
      id: String(event.id),
      opponent: home ? event.awayTeam?.name : event.homeTeam?.name,
      date: formatDate(event.utcDate),
      score: `${homeScore} - ${awayScore}`,
      result: resultForEvent(event, fdTeamId),
      home,
      ...stats,
    }
  })

  const upcomingFixtures = mergeUpcomingFixtures(
    buildUpcomingFromFpl(team.id, teamsById, fplFixtures),
    buildUpcomingFromFootballData(fdTeamId, allMatchesResponse.matches),
  )
  const upcoming = upcomingFixtures[0] ?? null
  const selectedTeamIsHome = upcoming?.isHome ?? false
  const prediction = upcoming ? estimateProbability(recentMatches, selectedTeamIsHome) : null
  const seasonComplete = upcomingFixtures.length === 0
  const wins = recentMatches.filter((match) => match.result === 'W').length
  const draws = recentMatches.filter((match) => match.result === 'D').length
  const scored = availableEvents.reduce((total, event) => (
    total + Number(event.homeTeam?.id === fdTeamId ? event.score?.fullTime?.home : event.score?.fullTime?.away)
  ), 0)
  const playerName = `${player.first_name} ${player.second_name}`.trim()

  return {
    id: `fpl:${player.id}`,
    name: playerName,
    initials: initials(playerName),
    photoUrl: fplPlayerPhotoUrl(player.code),
    teamCrestUrl: fplTeamCrestUrl(team.code),
    team: fdTeamName,
    number: player.squad_number || '-',
    position: positionType?.singular_name || 'Player',
    competition: `${competitionCode} · ${seasonLabel}`,
    season: seasonLabel,
    seasonComplete,
    summary: {
      matches: recentMatches.length,
      wins,
      draws,
      goals: scored,
    },
    form: recentMatches.map((match) => match.result).filter((result) => result !== '-'),
    recentMatches,
    upcomingFixtures,
    nextFixture: upcoming
      ? {
          homeTeam: upcoming.homeTeam,
          awayTeam: upcoming.awayTeam,
          date: upcoming.date,
          venue: upcoming.venue || 'Venue TBC',
          prediction,
          advice: 'Form estimate calculated from Football-Data.org team results and home advantage.',
        }
      : {
          homeTeam: fdTeamName,
          awayTeam: seasonComplete ? 'Season complete' : 'Fixture pending',
          date: seasonComplete
            ? 'No upcoming Premier League fixtures are published yet'
            : 'Upcoming schedule not available from current feeds',
          venue: '',
          prediction: null,
          advice: seasonComplete
            ? 'The current season has finished. New fixtures will appear when the next schedule is released.'
            : '',
        },
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    })
    return response.end()
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (url.pathname === '/api/health') {
      return json(response, 200, {
        live: true,
        providers: ['FPL unofficial API', 'Football-Data.org'],
        competition: competitionCode,
        season: seasonLabel,
        footballDataConfigured: Boolean(footballDataKey),
        freeTier: true,
      })
    }

    if (url.pathname === '/api/players/search') {
      return json(response, 200, await searchLivePlayers(url.searchParams.get('q') ?? ''))
    }

    const dashboardMatch = url.pathname.match(/^\/api\/players\/([^/]+)\/dashboard$/)
    if (dashboardMatch) {
      return json(response, 200, await getLiveDashboard(decodeURIComponent(dashboardMatch[1])))
    }

    return json(response, 404, { error: 'Route not found.' })
  } catch (error) {
    return json(response, 500, { error: error.message })
  }
})

server.listen(port, host, () => {
  console.log(`PitchIQ dual-provider proxy listening on http://${host}:${port}`)
  if (!footballDataKey) {
    console.warn('Warning: FOOTBALL_DATA_API_KEY is missing. Player search works, but dashboards will fail.')
  } else {
    console.log(`Football-Data.org configured for competition ${competitionCode}.`)
  }
})
