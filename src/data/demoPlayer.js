/**
 * Synthesises a believable player report from the little we know about a demo
 * card (name, team, position). It exists so that in demo mode a click on ANY
 * player name — a captain pick, a price riser, a War Room chip — opens a full,
 * realistic-looking dashboard, exactly as the live app would. Numbers are seeded
 * from the name so the same player always shows the same figures (stable, not
 * flickering) while still differing player to player.
 */
const CLUBS = ['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'Tottenham', 'Newcastle',
  'Brighton', 'Aston Villa', 'West Ham', 'Everton', 'Brentford', 'Fulham']

const POSITION_LABEL = { GKP: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' }

function seededRng(seedText) {
  let seed = 0
  for (const ch of String(seedText || 'player')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  return () => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return seed / 2 ** 32
  }
}

const pickFrom = (rng, list) => list[Math.floor(rng() * list.length)]
const between = (rng, lo, hi) => Math.round(lo + rng() * (hi - lo))

const DAY = 86_400_000

export function demoPlayerDashboard(info = {}) {
  const name = info.name || 'Sample Player'
  const rng = seededRng(name)
  const shortPos = info.position && POSITION_LABEL[info.position] ? info.position
    : pickFrom(rng, ['DEF', 'MID', 'MID', 'FWD'])
  const team = info.team || pickFrom(rng, CLUBS)
  // How attacking the returns should look, by position.
  const attack = shortPos === 'FWD' ? 1 : shortPos === 'MID' ? 0.7 : shortPos === 'DEF' ? 0.25 : 0.05
  const now = Date.now()

  const recentMatches = Array.from({ length: 5 }, (_, i) => {
    const home = rng() > 0.5
    const own = between(rng, 0, 3)
    const other = between(rng, 0, 3)
    const result = own > other ? 'W' : own < other ? 'L' : 'D'
    const goals = rng() < attack * 0.5 ? between(rng, 0, shortPos === 'FWD' ? 2 : 1) : 0
    const assists = rng() < attack * 0.4 ? between(rng, 0, 1) : 0
    return {
      id: `demo:m:${i}`,
      opponent: pickFrom(rng, CLUBS),
      opponentCrest: null,
      utcDate: new Date(now - (i + 1) * 7 * DAY).toISOString(),
      homeScore: home ? own : other,
      awayScore: home ? other : own,
      result,
      home,
      playerStats: {
        minutes: between(rng, 45, 90),
        goals,
        assists,
        expectedGoals: (goals * 0.7 + rng() * 0.4).toFixed(2),
        bonus: between(rng, 0, 3),
        points: between(rng, 1, 13),
      },
    }
  })

  const upcomingFixtures = Array.from({ length: 3 }, (_, i) => {
    const isHome = rng() > 0.5
    const opponent = pickFrom(rng, CLUBS)
    return {
      id: `demo:u:${i}`,
      homeTeam: isHome ? team : opponent,
      awayTeam: isHome ? opponent : team,
      utcDate: new Date(now + (i + 1) * 7 * DAY).toISOString(),
      venue: null,
      isHome,
    }
  })

  const playerGoals = recentMatches.reduce((total, m) => total + m.playerStats.goals, 0)
  const playerAssists = recentMatches.reduce((total, m) => total + m.playerStats.assists, 0)
  const next = upcomingFixtures[0]
  const selectedIsHome = next.isHome

  return {
    id: info.id || `demo:${name}`,
    name,
    initials: name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
    photoUrl: info.photoUrl || null,
    team,
    teamCrestUrl: info.teamCrestUrl || null,
    shirtNumber: between(rng, 1, 30),
    position: POSITION_LABEL[shortPos] || shortPos,
    nationality: null,
    availability: { code: 'available', label: 'Available', note: null },
    competition: { code: 'PL', name: 'Premier League', seasonLabel: '2024/25' },
    formPeriod: { seasonLabel: '2024/25', isPreviousSeason: false },
    hasPlayerMatchStats: true,
    seasonTotals: {
      seasonLabel: '2024/25',
      isPreviousSeason: false,
      appearances: between(rng, 20, 38),
      minutes: between(rng, 1500, 3200),
      goals: between(rng, 0, Math.round(attack * 22)),
      assists: between(rng, 0, Math.round(attack * 14)),
      expectedGoals: Number((attack * 15 * rng()).toFixed(1)),
      expectedAssists: Number((attack * 10 * rng()).toFixed(1)),
      points: between(rng, 60, 240),
    },
    metricsNote: 'Sample data — a demo player report to show the layout. Connect live data for real numbers.',
    summary: {
      matches: 5,
      wins: recentMatches.filter((m) => m.result === 'W').length,
      draws: recentMatches.filter((m) => m.result === 'D').length,
      losses: recentMatches.filter((m) => m.result === 'L').length,
      teamGoals: recentMatches.reduce((total, m) => total + (m.home ? m.homeScore : m.awayScore), 0),
      player: {
        goals: playerGoals,
        assists: playerAssists,
        minutes: recentMatches.reduce((total, m) => total + m.playerStats.minutes, 0),
      },
    },
    form: recentMatches.map((m) => m.result),
    recentMatches,
    upcomingFixtures,
    nextFixture: {
      available: true,
      homeTeam: next.homeTeam,
      awayTeam: next.awayTeam,
      utcDate: next.utcDate,
      venue: null,
      selectedTeamSide: selectedIsHome ? 'home' : 'away',
      prediction: { home: selectedIsHome ? 48 : 27, draw: 25, away: selectedIsHome ? 27 : 48, sampleSize: 5 },
      advice: 'Sample estimate from this demo player’s recent form. Not betting advice.',
    },
  }
}
