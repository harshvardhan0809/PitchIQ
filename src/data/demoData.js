/**
 * Offline dataset used when VITE_DATA_MODE is not "live".
 *
 * It mirrors the exact shapes the API returns so the UI has one contract to
 * render, and its dates are generated relative to now so the demo never looks
 * like a stale snapshot.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function isoIn(days, hour = 15, minute = 0) {
  const date = new Date(Date.now() + days * DAY_MS)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

const CREST = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="%2316884a"/></svg>',
)

function team(name, shortName, tla, score = null) {
  return { id: tla, name, shortName, tla, crest: CREST, score }
}

function match(id, home, away, kickoff, state, scores) {
  return {
    id,
    utcDate: kickoff,
    status: state === 'finished' ? 'FINISHED' : state === 'live' ? 'IN_PLAY' : 'SCHEDULED',
    state,
    matchday: 12,
    hasScore: Boolean(scores),
    homeTeam: team(...home, scores?.[0] ?? null),
    awayTeam: team(...away, scores?.[1] ?? null),
    venue: null,
  }
}

const DEMO_MATCHES = [
  match('d1', ['Manchester City', 'Man City', 'MCI'], ['Chelsea', 'Chelsea', 'CHE'], isoIn(0, 15, 0), 'live', [2, 1]),
  match('d2', ['Liverpool', 'Liverpool', 'LIV'], ['Arsenal', 'Arsenal', 'ARS'], isoIn(0, 17, 30), 'scheduled', null),
  match('d3', ['Aston Villa', 'Aston Villa', 'AVL'], ['Newcastle United', 'Newcastle', 'NEW'], isoIn(0, 20, 0), 'scheduled', null),
  match('d4', ['Brighton', 'Brighton', 'BHA'], ['Everton', 'Everton', 'EVE'], isoIn(1, 14, 0), 'scheduled', null),
  match('d5', ['Tottenham Hotspur', 'Spurs', 'TOT'], ['West Ham United', 'West Ham', 'WHU'], isoIn(1, 16, 30), 'scheduled', null),
]

function watchCard(id, name, initialsText, teamName, teamShort, position, stats, availability = null) {
  return {
    id,
    searchId: id,
    name,
    initials: initialsText,
    photoUrl: null,
    team: teamName,
    teamShort,
    teamCrestUrl: CREST,
    position,
    nationality: null,
    availability,
    stats,
  }
}

const DEMO_WATCH = [
  watchCard('demo:haaland', 'Erling Haaland', 'EH', 'Manchester City', 'Man City', 'Forward', [
    { label: 'Goals', value: 14 }, { label: 'Assists', value: 3 },
    { label: 'Apps', value: 12 }, { label: 'xG', value: '12.4' }, { label: 'Mins', value: 1042 },
  ]),
  watchCard('demo:saka', 'Bukayo Saka', 'BS', 'Arsenal', 'Arsenal', 'Midfielder', [
    { label: 'Goals', value: 8 }, { label: 'Assists', value: 7 },
    { label: 'Apps', value: 12 }, { label: 'xG', value: '6.9' }, { label: 'Mins', value: 998 },
  ], { code: 'doubtful', label: 'Doubtful', note: 'Knock picked up in training, assessed daily.', chanceOfPlaying: 75 }),
  watchCard('demo:palmer', 'Cole Palmer', 'CP', 'Chelsea', 'Chelsea', 'Midfielder', [
    { label: 'Goals', value: 9 }, { label: 'Assists', value: 5 },
    { label: 'Apps', value: 11 }, { label: 'xG', value: '7.8' }, { label: 'Mins', value: 945 },
  ]),
  watchCard('demo:isak', 'Alexander Isak', 'AI', 'Newcastle United', 'Newcastle', 'Forward', [
    { label: 'Goals', value: 7 }, { label: 'Assists', value: 2 },
    { label: 'Apps', value: 10 }, { label: 'xG', value: '6.1' }, { label: 'Mins', value: 812 },
  ], { code: 'injured', label: 'Injured', note: 'Hamstring strain, expected back in two weeks.', chanceOfPlaying: 0 }),
]

function recent(id, opponent, days, homeScore, awayScore, isHome, playerStats) {
  const own = isHome ? homeScore : awayScore
  const other = isHome ? awayScore : homeScore
  return {
    id,
    opponent,
    opponentCrest: CREST,
    utcDate: isoIn(-days),
    homeScore,
    awayScore,
    result: own > other ? 'W' : own < other ? 'L' : 'D',
    home: isHome,
    playerStats,
  }
}

function dashboard({ id, name, initials, teamName, position, shirtNumber, recentMatches, upcoming, seasonTotals }) {
  const decided = recentMatches.filter((entry) => entry.result !== null)
  const teamGoals = recentMatches.reduce((total, entry) => (
    total + (entry.home ? entry.homeScore : entry.awayScore)
  ), 0)
  const hasPlayerStats = recentMatches.some((entry) => entry.playerStats !== null)

  return {
    id,
    name,
    initials,
    photoUrl: null,
    team: teamName,
    teamCrestUrl: CREST,
    shirtNumber,
    position,
    nationality: null,
    availability: null,
    competition: { code: 'PL', name: 'Premier League', seasonLabel: 'Demo season' },
    formPeriod: { seasonLabel: 'Demo season', isPreviousSeason: false },
    hasPlayerMatchStats: hasPlayerStats,
    seasonTotals,
    metricsNote: 'Sample data bundled with the app. Set VITE_DATA_MODE=live to use the provider APIs.',
    summary: {
      matches: recentMatches.length,
      wins: decided.filter((entry) => entry.result === 'W').length,
      draws: decided.filter((entry) => entry.result === 'D').length,
      losses: decided.filter((entry) => entry.result === 'L').length,
      teamGoals,
      player: hasPlayerStats
        ? {
            goals: recentMatches.reduce((total, entry) => total + (entry.playerStats?.goals ?? 0), 0),
            assists: recentMatches.reduce((total, entry) => total + (entry.playerStats?.assists ?? 0), 0),
            minutes: recentMatches.reduce((total, entry) => total + (entry.playerStats?.minutes ?? 0), 0),
          }
        : null,
    },
    form: recentMatches.map((entry) => entry.result).filter(Boolean),
    recentMatches,
    upcomingFixtures: upcoming,
    nextFixture: {
      available: true,
      homeTeam: upcoming[0].homeTeam,
      awayTeam: upcoming[0].awayTeam,
      utcDate: upcoming[0].utcDate,
      venue: upcoming[0].venue,
      selectedTeamSide: upcoming[0].isHome ? 'home' : 'away',
      prediction: { home: 54, draw: 24, away: 22, sampleSize: decided.length },
      advice: 'Sample estimate from the bundled demo results. Not betting advice.',
    },
  }
}

const playerStats = (minutes, goals, assists, xg) => ({
  minutes, goals, assists, expectedGoals: xg, bonus: goals * 2, points: goals * 4 + assists * 3,
})

export const demoDashboards = {
  'demo:haaland': dashboard({
    id: 'demo:haaland',
    name: 'Erling Haaland',
    initials: 'EH',
    teamName: 'Manchester City',
    position: 'Forward',
    shirtNumber: 9,
    seasonTotals: {
      seasonLabel: 'Demo season', isPreviousSeason: false, appearances: 12,
      minutes: 1042, goals: 14, assists: 3, expectedGoals: 12.4, expectedAssists: 2.1, points: 98,
    },
    recentMatches: [
      recent('m1', 'Arsenal', 5, 2, 1, true, playerStats(90, 2, 0, '1.44')),
      recent('m2', 'Newcastle United', 12, 0, 3, false, playerStats(88, 1, 1, '0.92')),
      recent('m3', 'Brighton', 19, 1, 1, true, playerStats(90, 1, 0, '0.71')),
      recent('m4', 'Tottenham Hotspur', 26, 0, 2, false, playerStats(75, 0, 1, '0.38')),
      recent('m5', 'Liverpool', 33, 1, 2, true, playerStats(90, 1, 0, '1.05')),
    ],
    upcoming: [
      { id: 'u1', homeTeam: 'Manchester City', awayTeam: 'Chelsea', utcDate: isoIn(3, 17, 30), venue: 'Etihad Stadium', isHome: true },
      { id: 'u2', homeTeam: 'Bournemouth', awayTeam: 'Manchester City', utcDate: isoIn(10, 15, 0), venue: 'Vitality Stadium', isHome: false },
    ],
  }),
  'demo:saka': dashboard({
    id: 'demo:saka',
    name: 'Bukayo Saka',
    initials: 'BS',
    teamName: 'Arsenal',
    position: 'Midfielder',
    shirtNumber: 7,
    seasonTotals: {
      seasonLabel: 'Demo season', isPreviousSeason: false, appearances: 12,
      minutes: 998, goals: 8, assists: 7, expectedGoals: 6.9, expectedAssists: 5.4, points: 86,
    },
    recentMatches: [
      recent('m1', 'Manchester City', 5, 1, 2, false, playerStats(90, 1, 0, '0.55')),
      recent('m2', 'Everton', 12, 3, 0, true, playerStats(72, 1, 2, '0.81')),
      recent('m3', 'West Ham United', 19, 2, 2, false, playerStats(90, 0, 1, '0.34')),
      recent('m4', 'Fulham', 26, 2, 0, true, playerStats(85, 1, 1, '0.62')),
      recent('m5', 'Crystal Palace', 33, 1, 0, false, playerStats(90, 0, 0, '0.29')),
    ],
    upcoming: [
      { id: 'u1', homeTeam: 'Liverpool', awayTeam: 'Arsenal', utcDate: isoIn(0, 17, 30), venue: 'Anfield', isHome: false },
      { id: 'u2', homeTeam: 'Arsenal', awayTeam: 'Brighton', utcDate: isoIn(7, 15, 0), venue: 'Emirates Stadium', isHome: true },
    ],
  }),
  'demo:palmer': dashboard({
    id: 'demo:palmer',
    name: 'Cole Palmer',
    initials: 'CP',
    teamName: 'Chelsea',
    position: 'Midfielder',
    shirtNumber: 10,
    seasonTotals: {
      seasonLabel: 'Demo season', isPreviousSeason: false, appearances: 11,
      minutes: 945, goals: 9, assists: 5, expectedGoals: 7.8, expectedAssists: 4.2, points: 81,
    },
    recentMatches: [
      recent('m1', 'Brentford', 4, 2, 1, true, playerStats(90, 1, 1, '0.77')),
      recent('m2', 'Wolves', 11, 1, 1, false, playerStats(90, 1, 0, '0.68')),
      recent('m3', 'Nottingham Forest', 18, 3, 1, true, playerStats(80, 2, 0, '1.12')),
      recent('m4', 'Aston Villa', 25, 0, 1, false, playerStats(90, 0, 0, '0.41')),
      recent('m5', 'Southampton', 32, 4, 0, true, playerStats(70, 1, 2, '0.95')),
    ],
    upcoming: [
      { id: 'u1', homeTeam: 'Manchester City', awayTeam: 'Chelsea', utcDate: isoIn(3, 17, 30), venue: 'Etihad Stadium', isHome: false },
      { id: 'u2', homeTeam: 'Chelsea', awayTeam: 'Everton', utcDate: isoIn(9, 15, 0), venue: 'Stamford Bridge', isHome: true },
    ],
  }),
  'demo:isak': dashboard({
    id: 'demo:isak',
    name: 'Alexander Isak',
    initials: 'AI',
    teamName: 'Newcastle United',
    position: 'Forward',
    shirtNumber: 14,
    seasonTotals: {
      seasonLabel: 'Demo season', isPreviousSeason: false, appearances: 10,
      minutes: 812, goals: 7, assists: 2, expectedGoals: 6.1, expectedAssists: 1.5, points: 64,
    },
    recentMatches: [
      recent('m1', 'Aston Villa', 6, 1, 1, false, playerStats(90, 1, 0, '0.83')),
      recent('m2', 'Manchester City', 13, 0, 3, true, playerStats(90, 0, 0, '0.22')),
      recent('m3', 'Leicester City', 20, 2, 0, true, playerStats(78, 1, 1, '0.74')),
      recent('m4', 'Ipswich Town', 27, 1, 2, false, playerStats(90, 2, 0, '1.31')),
      recent('m5', 'Brighton', 34, 1, 1, true, playerStats(64, 0, 1, '0.28')),
    ],
    upcoming: [
      { id: 'u1', homeTeam: 'Aston Villa', awayTeam: 'Newcastle United', utcDate: isoIn(0, 20, 0), venue: 'Villa Park', isHome: false },
      { id: 'u2', homeTeam: 'Newcastle United', awayTeam: 'Fulham', utcDate: isoIn(8, 15, 0), venue: "St James' Park", isHome: true },
    ],
  }),
}

// --- Team of the Gameweek (demo) -------------------------------------------
function pick(id, name, team, teamShort, position, opp, home, difficulty, form, output, ownership) {
  const parts = name.split(' ')
  return {
    id,
    searchId: id,
    name,
    webName: parts[parts.length - 1],
    initials: parts.map((word) => word[0]).slice(0, 2).join('').toUpperCase(),
    photoUrl: null,
    team,
    teamShort,
    teamCrestUrl: CREST,
    position,
    opponentShort: opp,
    home,
    difficulty,
    fixture: `${home ? 'vs' : '@'} ${opp}`,
    form,
    output,
    ownership,
    availability: { code: 'available', label: 'Available' },
  }
}

export function demoFormPicks() {
  const groups = [
    {
      key: 'GKP', label: 'Goalkeepers', icon: '🧤', picks: [
        pick('demo:raya', 'David Raya', 'Arsenal', 'ARS', 'GKP', 'BUR', true, 2, 5.4, 5.1, 28.3),
        pick('demo:sanchez', 'Robert Sánchez', 'Chelsea', 'CHE', 'GKP', 'EVE', true, 2, 4.6, 4.7, 14.1),
        pick('demo:pope', 'Nick Pope', 'Newcastle', 'NEW', 'GKP', 'BHA', false, 3, 4.2, 4.3, 9.7),
      ],
    },
    {
      key: 'DEF', label: 'Defenders', icon: '🛡️', picks: [
        pick('demo:gabriel', 'Gabriel', 'Arsenal', 'ARS', 'DEF', 'BUR', true, 2, 5.9, 6.2, 34.5),
        pick('demo:vvd', 'Virgil van Dijk', 'Liverpool', 'LIV', 'DEF', 'WOL', true, 2, 5.1, 5.6, 21.8),
        pick('demo:trippier', 'Kieran Trippier', 'Newcastle', 'NEW', 'DEF', 'BHA', false, 3, 4.8, 5.0, 12.4),
        pick('demo:gvardiol', 'Joško Gvardiol', 'Man City', 'MCI', 'DEF', 'CHE', true, 3, 4.5, 4.9, 18.0),
        pick('demo:hall', 'Lewis Hall', 'Newcastle', 'NEW', 'DEF', 'BHA', false, 3, 4.3, 4.6, 7.2),
      ],
    },
    {
      key: 'MID', label: 'Midfielders', icon: '🎯', picks: [
        pick('demo:palmer', 'Cole Palmer', 'Chelsea', 'CHE', 'MID', 'EVE', true, 2, 7.8, 7.4, 46.2),
        pick('demo:saka', 'Bukayo Saka', 'Arsenal', 'ARS', 'MID', 'BUR', true, 2, 6.9, 6.8, 41.0),
        pick('demo:mbeumo', 'Bryan Mbeumo', 'Man Utd', 'MUN', 'MID', 'FUL', true, 2, 6.4, 6.1, 29.5),
        pick('demo:son', 'Son Heung-min', 'Spurs', 'TOT', 'MID', 'WHU', false, 3, 5.7, 5.8, 22.1),
        pick('demo:gordon', 'Anthony Gordon', 'Newcastle', 'NEW', 'MID', 'BHA', false, 3, 5.2, 5.4, 15.6),
      ],
    },
    {
      key: 'FWD', label: 'Forwards', icon: '⚡', picks: [
        pick('demo:haaland', 'Erling Haaland', 'Man City', 'MCI', 'FWD', 'CHE', true, 3, 8.1, 8.6, 62.4),
        pick('demo:isak', 'Alexander Isak', 'Newcastle', 'NEW', 'FWD', 'BHA', false, 3, 6.6, 6.3, 27.9),
        pick('demo:watkins', 'Ollie Watkins', 'Aston Villa', 'AVL', 'FWD', 'NFO', true, 2, 6.1, 6.0, 24.3),
        pick('demo:woltemade', 'Nick Woltemade', 'Newcastle', 'NEW', 'FWD', 'BHA', false, 3, 5.5, 5.2, 11.0),
        pick('demo:wissa', 'Yoane Wissa', 'Brentford', 'BRE', 'FWD', 'CRY', true, 3, 5.0, 4.9, 13.7),
      ],
    },
  ]
  const best = { ...groups[3].picks[0], tag: 'Star of the Gameweek' } // Haaland
  return {
    heading: 'Team of the Gameweek',
    subheading: 'Projected output for Matchday 12, fixture by fixture',
    gameweek: 12,
    best,
    groups,
  }
}

// --- Match xG & clean sheets (demo) ----------------------------------------
function xgSide(name, shortName, xg, cs, score = null) {
  return { id: shortName, name, shortName, crest: CREST, xg, cleanSheetPct: cs, score }
}
function xgMatch(id, home, away, totalXg, btts, state = {}) {
  const { started = false, finished = false } = state
  return { id, kickoff: null, started, finished, home, away, totalXg, bttsPct: btts }
}

export function demoMatchXg() {
  return {
    gameweek: 12,
    gameweekName: 'Matchday 12',
    dataDepth: 'in-season',
    generatedAt: new Date().toISOString(),
    matches: [
      // A finished match (real score in) and a live one, to show the model-vs-actual read.
      xgMatch('d1', xgSide('Manchester City', 'MCI', 2.4, 58, 3), xgSide('Chelsea', 'CHE', 1.1, 22, 1), 3.5, 52, { started: true, finished: true }),
      xgMatch('d2', xgSide('Liverpool', 'LIV', 2.1, 55, 1), xgSide('Arsenal', 'ARS', 1.3, 26, 1), 3.4, 57, { started: true }),
      xgMatch('d3', xgSide('Aston Villa', 'AVL', 1.6, 33), xgSide('Newcastle United', 'NEW', 1.4, 30), 3.0, 61),
      xgMatch('d4', xgSide('Brighton', 'BHA', 1.5, 31), xgSide('Everton', 'EVE', 0.9, 18), 2.4, 45),
      xgMatch('d5', xgSide('Tottenham Hotspur', 'TOT', 1.9, 40), xgSide('West Ham United', 'WHU', 1.2, 22), 3.1, 55),
    ],
  }
}

// --- Live match center (demo) ----------------------------------------------
// Mirrors the live demo fixture (d1: Man City vs Chelsea, 2–1, 67') so the
// click-to-expand live feed can be seen offline.
export function demoLive() {
  return {
    generatedAt: new Date().toISOString(),
    event: 12,
    gameweekName: 'Matchday 12',
    anyLive: true,
    matches: [
      {
        id: 'd1', started: true, live: true, finished: false, minute: 67,
        homeScore: 2, awayScore: 1,
        events: [
          { key: 'd1:goal:hh1:1', type: 'goal', side: 'home', playerId: 'hh1', name: 'Haaland', position: 'FWD', teamShort: 'MCI', count: 2 },
          { key: 'd1:goal:aa1:1', type: 'goal', side: 'away', playerId: 'aa1', name: 'Palmer', position: 'MID', teamShort: 'CHE', count: 1 },
          { key: 'd1:assist:hh2:1', type: 'assist', side: 'home', playerId: 'hh2', name: 'Foden', position: 'MID', teamShort: 'MCI', count: 1 },
          { key: 'd1:yellow:aa2:1', type: 'yellow', side: 'away', playerId: 'aa2', name: 'Caicedo', position: 'MID', teamShort: 'CHE', count: 1 },
        ],
      },
    ],
  }
}

// --- Expert View (demo) -----------------------------------------------------
// The two video ids below are long-standing, permanently-available uploads used
// purely to demonstrate the hover-to-play preview offline; live mode shows real
// FPL YouTube clips from the admin-configured channel feeds.
export function demoExpert() {
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString()
  const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  return {
    enabled: true,
    generatedAt: new Date().toISOString(),
    sources: ['Fantasy Football Scout', 'r/FantasyPL', "Let's Talk FPL"],
    articles: [
      {
        id: 'demo-1',
        type: 'article',
        title: 'Scout Picks: the captain call for the double gameweek',
        url: 'https://www.fantasyfootballscout.co.uk/',
        source: 'Fantasy Football Scout',
        publishedAt: hoursAgo(2),
        excerpt: 'Two premium options stand out for the armband this week, with a differential shout for the brave. Here is how the fixtures and underlying numbers stack up.',
        image: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=640&q=60&auto=format&fit=crop',
        videoId: null,
      },
      {
        id: 'demo-v1',
        type: 'video',
        title: 'Gameweek team selection & captaincy — full walkthrough',
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        source: "Let's Talk FPL",
        publishedAt: hoursAgo(5),
        excerpt: 'Building the team from the back, where the value is this week, and the captain decision that could swing your mini-league.',
        image: ytThumb('jNQXAC9IVRw'),
        videoId: 'jNQXAC9IVRw',
      },
      {
        id: 'demo-2',
        type: 'article',
        title: 'Wildcard drafts: who is nailing the mid-price midfield?',
        url: 'https://www.reddit.com/r/FantasyPL/',
        source: 'r/FantasyPL',
        publishedAt: hoursAgo(9),
        excerpt: 'The community shares the £6.5m enablers letting them load up on premiums up front. A thread full of drafts and the reasoning behind each pick.',
        image: null,
        videoId: null,
      },
      {
        id: 'demo-v2',
        type: 'video',
        title: 'Differentials under 10% ownership that could explode',
        url: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
        source: "Let's Talk FPL",
        publishedAt: hoursAgo(14),
        excerpt: 'Five low-owned picks with the fixtures and underlying numbers to make a real rank push over the next month.',
        image: ytThumb('9bZkp7q19f0'),
        videoId: '9bZkp7q19f0',
      },
      {
        id: 'demo-3',
        type: 'article',
        title: 'Set-and-forget defenders for the run of green fixtures',
        url: 'https://www.fantasyfootballscout.co.uk/',
        source: 'Fantasy Football Scout',
        publishedAt: hoursAgo(26),
        excerpt: 'A look at the backlines with the kindest schedule over the next five, and which full-backs offer the attacking returns to justify a long-term hold.',
        image: 'https://images.unsplash.com/photo-1560272564-c83b66b1ad12?w=640&q=60&auto=format&fit=crop',
        videoId: null,
      },
      {
        id: 'demo-4',
        type: 'article',
        title: 'Price rise watch: three players on the brink tonight',
        url: 'https://www.reddit.com/r/FantasyPL/',
        source: 'r/FantasyPL',
        publishedAt: hoursAgo(31),
        excerpt: 'Transfer momentum is surging on a handful of forwards. If you were planning the move, the community consensus is not to wait past the deadline.',
        image: null,
        videoId: null,
      },
    ],
  }
}

export function demoSpotlight(league = 'PL') {
  const option = { PL: 'Premier League', PD: 'La Liga', SA: 'Serie A', BL1: 'Bundesliga', FL1: 'Ligue 1' }
  return {
    competition: {
      code: league,
      name: option[league] ?? 'Premier League',
      country: null,
      emblem: null,
      seasonLabel: 'Demo season',
      currentMatchday: 12,
      supportsFpl: league === 'PL',
    },
    matches: {
      state: 'today',
      heading: 'Playing today',
      note: 'Matchday 12.',
      firstKickoff: DEMO_MATCHES[0].utcDate,
      matchday: 12,
      seasonStartYear: null,
      isPreviousSeason: false,
      items: DEMO_MATCHES,
    },
    playersToWatch: {
      heading: 'Players to watch',
      subheading: 'Leading scorers, demo season',
      seasonStartYear: null,
      isPreviousSeason: false,
      items: DEMO_WATCH,
    },
    formPicks: demoFormPicks(),
  }
}

export function demoSearchResults(query = '') {
  const term = query.trim().toLowerCase()
  return Object.values(demoDashboards)
    .filter((entry) => !term || `${entry.name} ${entry.team} ${entry.position}`.toLowerCase().includes(term))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      initials: entry.initials,
      team: entry.team,
      position: entry.position,
      photoUrl: entry.photoUrl,
      availability: entry.availability,
    }))
}
