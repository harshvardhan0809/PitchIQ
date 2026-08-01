/**
 * Offline captain board for demo mode. Mirrors the /api/intel/captains shape,
 * including the same free/pro gating, so the premium UI and its paywall are
 * fully explorable with no token and no network.
 */

function card(rank, name, teamShort, position, price, xPts, cap, confidence, ownership, next, reasons, flags = {}) {
  return {
    rank,
    id: `demo:${rank}`,
    name,
    webName: name.split(' ').slice(-1)[0],
    photoUrl: null,
    position,
    team: teamShort,
    teamShort,
    price,
    ownership,
    expectedPoints: xPts,
    captainScore: cap,
    confidence,
    next,
    availability: { status: 'a', label: 'Available', chance: null, news: null },
    flags: { differential: false, template: false, rotationRisk: false, doubt: false, ...flags },
    reasons,
    verdict: rank === 1 ? 'Top armband this week' : flags.differential ? 'Differential captain' : 'Safe, high-floor option',
  }
}

const BOARD = [
  card(1, 'Erling Haaland', 'MCI', 'FWD', 15.0, 6.8, 9.1, 92, 61.4,
    { home: true, opponent: 'BOU', difficulty: 2 },
    [
      { kind: 'fixture', tone: 'good', text: 'Home vs BOU — favourable fixture (2/5)' },
      { kind: 'underlying', tone: 'good', text: '0.94 expected goal involvements per 90' },
      { kind: 'minutes', tone: 'good', text: 'Nailed starter — 33 starts last season' },
      { kind: 'ownership', tone: 'neutral', text: 'Template pick — 61.4% owned' },
    ], { template: true }),
  card(2, 'Mohamed Salah', 'LIV', 'MID', 12.5, 6.1, 8.2, 90, 48.2,
    { home: true, opponent: 'BHA', difficulty: 2 },
    [
      { kind: 'fixture', tone: 'good', text: 'Home vs BHA — favourable fixture (2/5)' },
      { kind: 'underlying', tone: 'good', text: '0.81 expected goal involvements per 90' },
      { kind: 'minutes', tone: 'good', text: 'Nailed starter — 36 starts last season' },
    ]),
  card(3, 'Cole Palmer', 'CHE', 'MID', 10.5, 5.4, 7.3, 84, 34.0,
    { home: false, opponent: 'CRY', difficulty: 3 },
    [
      { kind: 'fixture', tone: 'neutral', text: 'Away at CRY — even fixture (3/5)' },
      { kind: 'underlying', tone: 'good', text: '0.72 expected goal involvements per 90' },
    ]),
  card(4, 'Bukayo Saka', 'ARS', 'MID', 10.0, 5.1, 6.9, 82, 29.5,
    { home: true, opponent: 'WOL', difficulty: 2 },
    [
      { kind: 'fixture', tone: 'good', text: 'Home vs WOL — favourable fixture (2/5)' },
      { kind: 'underlying', tone: 'good', text: '0.68 expected goal involvements per 90' },
    ]),
  card(5, 'Alexander Isak', 'NEW', 'FWD', 10.5, 4.9, 6.5, 79, 22.1,
    { home: true, opponent: 'AVL', difficulty: 3 },
    [
      { kind: 'fixture', tone: 'neutral', text: 'Home vs AVL — even fixture (3/5)' },
      { kind: 'underlying', tone: 'good', text: '0.64 expected goal involvements per 90' },
    ]),
  card(6, 'Bryan Mbeumo', 'MUN', 'MID', 8.0, 4.6, 6.0, 80, 18.7,
    { home: false, opponent: 'FUL', difficulty: 3 },
    [
      { kind: 'fixture', tone: 'neutral', text: 'Away at FUL — even fixture (3/5)' },
      { kind: 'minutes', tone: 'good', text: 'Nailed starter — 38 starts last season' },
    ]),
  card(7, 'Morgan Gibbs-White', 'NFO', 'MID', 7.5, 4.3, 5.6, 78, 8.4,
    { home: true, opponent: 'SOU', difficulty: 2 },
    [
      { kind: 'fixture', tone: 'good', text: 'Home vs SOU — favourable fixture (2/5)' },
      { kind: 'ownership', tone: 'good', text: 'Differential — only 8.4% owned' },
    ], { differential: true }),
  card(8, 'Jarrod Bowen', 'WHU', 'MID', 7.5, 4.0, 5.2, 74, 6.1,
    { home: false, opponent: 'BUR', difficulty: 2 },
    [
      { kind: 'fixture', tone: 'good', text: 'Away at BUR — favourable fixture (2/5)' },
      { kind: 'ownership', tone: 'good', text: 'Differential — only 6.1% owned' },
    ], { differential: true }),
]

function gate(board, base, plan) {
  const unlocked = plan !== 'free'
  if (unlocked) return { ...base, locked: false, topPick: board[0], board }
  return { ...base, locked: true, topPick: board[0], board: board.slice(0, 1), lockedCount: board.length - 1 }
}

const DEMO_META = { gameweek: 12, gameweekName: 'Gameweek 12', deadline: null, phase: 'demo', generatedAt: null }

export function demoCaptainBoard(plan = 'free') {
  const base = { ...DEMO_META, generatedAt: new Date().toISOString(), feature: 'captain-picks', featureName: 'AI Captain Picks', requiredPlan: 'pro', plan }
  return gate(BOARD, base, plan)
}

// Differentials: low-owned, ranked by upside. Reuses the same card shape.
const DIFF_BOARD = BOARD
  .filter((card) => card.ownership <= 20)
  .map((card, index) => ({
    ...card,
    rank: index + 1,
    flags: { ...card.flags, differential: true },
    verdict: card.ownership < 8 ? 'Deep differential' : 'Under the radar',
  }))

export function demoDifferentials(plan = 'free') {
  const base = { ...DEMO_META, generatedAt: new Date().toISOString(), feature: 'differentials', featureName: 'Differential Finder', requiredPlan: 'pro', plan }
  return gate(DIFF_BOARD, base, plan)
}

// Weekly Briefing: a narrative digest. Sections gated after the first taste.
function briefPlayerFrom(card) {
  return { id: card.id, name: card.name, webName: card.webName, photoUrl: card.photoUrl, position: card.position, team: card.team, teamShort: card.teamShort, price: card.price, ownership: card.ownership, expectedPoints: card.expectedPoints, next: card.next }
}
const BRIEFING_SECTIONS = [
  { id: 'captain', title: 'Captain of the week', tone: 'good', player: briefPlayerFrom(BOARD[0]),
    body: 'Erling Haaland (MCI) is the standout armband — a favourable tie home to BOU, projecting a game-high 6.8 points. The safest route to a big score.' },
  { id: 'differential', title: 'Differential to watch', tone: 'good', player: briefPlayerFrom(BOARD[6]),
    body: 'Morgan Gibbs-White (NFO) sits in just 8.4% of teams but projects 4.3 points home to SOU — a cheap way to gain ground on your mini-league.' },
  { id: 'value', title: 'Best value', tone: 'neutral', player: briefPlayerFrom(BOARD[5]),
    body: 'Bryan Mbeumo (MUN) at £8.0m is the pick for points per million — 4.6 projected with an even tie away at FUL. Frees budget for a premium elsewhere.' },
  { id: 'watch', title: 'Watch out', tone: 'bad', player: briefPlayerFrom(BOARD[1]),
    body: 'Mohamed Salah (LIV) is owned by 48.2% but rotation and fixture swings can bite — check the team news before you set your captain.' },
]

export function demoBriefing(plan = 'free') {
  const unlocked = plan !== 'free'
  return {
    ...DEMO_META,
    generatedAt: new Date().toISOString(),
    feature: 'weekly-briefing', featureName: 'Weekly Briefing', requiredPlan: 'pro', plan,
    headline: 'Erling Haaland leads the armband picks for Gameweek 12.',
    locked: !unlocked,
    sections: unlocked ? BRIEFING_SECTIONS : BRIEFING_SECTIONS.slice(0, 1),
    lockedCount: unlocked ? 0 : BRIEFING_SECTIONS.length - 1,
  }
}

// Price Change Predictor: sample risers/fallers so the view and its paywall are
// explorable offline. Mirrors the /api/intel/prices shape and its free/pro gate.
function priceItem(webName, teamShort, position, price, ownership, net, confidence, likelihood, changedThisGw = 0) {
  return {
    id: `demo:pw:${webName}`,
    elementId: 0,
    name: webName,
    webName,
    photoUrl: null,
    position,
    team: teamShort,
    teamShort,
    teamCrestUrl: null,
    price,
    ownership,
    transfersIn: net > 0 ? net + 8000 : 6000,
    transfersOut: net > 0 ? 8000 : Math.abs(net) + 6000,
    netTransfers: net,
    momentum: Number(((net / 9_400_000) * 100).toFixed(3)),
    direction: net >= 0 ? 'rise' : 'fall',
    confidence,
    likelihood,
    changedThisGw,
  }
}

const PW_RISERS = [
  priceItem('Palmer', 'CHE', 'MID', 6.4, 41.2, 214000, 99, 'Very likely'),
  priceItem('Mbeumo', 'MUN', 'MID', 7.1, 24.8, 132000, 82, 'Very likely'),
  priceItem('Gordon', 'NEW', 'MID', 6.3, 15.1, 61000, 64, 'Likely'),
  priceItem('Wood', 'NFO', 'FWD', 7.0, 19.6, 44000, 47, 'Possible'),
  priceItem('Rogers', 'AVL', 'MID', 5.6, 9.2, 38000, 41, 'Possible'),
  priceItem('Mateta', 'CRY', 'FWD', 7.4, 12.3, 29000, 33, 'Possible'),
]

const PW_FALLERS = [
  priceItem('Núñez', 'LIV', 'FWD', 7.4, 11.8, -158000, 96, 'Very likely'),
  priceItem('Havertz', 'ARS', 'FWD', 7.9, 18.4, -97000, 78, 'Likely'),
  priceItem('Sels', 'NFO', 'GKP', 5.2, 22.1, -54000, 58, 'Likely', -0.1),
  priceItem('Kluivert', 'BOU', 'MID', 6.1, 8.7, -33000, 36, 'Possible'),
  priceItem('Muniz', 'FUL', 'FWD', 6.3, 6.4, -24000, 29, 'Watch'),
]

export function demoPriceWatch(plan = 'free') {
  const unlocked = plan !== 'free'
  const FREE_PER_SIDE = 3
  const hidden = Math.max(0, PW_RISERS.length - FREE_PER_SIDE) + Math.max(0, PW_FALLERS.length - FREE_PER_SIDE)
  return {
    ...DEMO_META,
    generatedAt: new Date().toISOString(),
    feature: 'price-predictor', featureName: 'Price Rise Predictor', requiredPlan: 'pro', plan,
    totalManagers: 9_400_000,
    locked: !unlocked,
    risers: unlocked ? PW_RISERS : PW_RISERS.slice(0, FREE_PER_SIDE),
    fallers: unlocked ? PW_FALLERS : PW_FALLERS.slice(0, FREE_PER_SIDE),
    lockedCount: unlocked ? 0 : hidden,
  }
}

// Mini-League War Room: a plausible 10-team classic league so the standings,
// overtake math and the Pro strategy layer are explorable offline.
function standingRow(rank, lastRank, entryId, teamName, managerName, total, eventTotal, captain, isYou = false) {
  const movement = !lastRank ? 'same' : rank < lastRank ? 'up' : rank > lastRank ? 'down' : 'same'
  return { rank, lastRank, movement, entryId, teamName, managerName, total, eventTotal, isYou, captain }
}

const cap = (webName, teamShort, position = 'MID') => ({ webName, teamShort, position })

const WR_STANDINGS = [
  standingRow(1, 2, 100, 'Kloppites', 'Raj Mehta', 1284, 62, cap('Haaland', 'MCI', 'FWD')),
  standingRow(2, 1, 200, 'Your FC', 'You', 1271, 58, cap('Palmer', 'CHE'), true),
  standingRow(3, 3, 300, 'Sam United', 'Sam Byrne', 1240, 44, cap('Haaland', 'MCI', 'FWD')),
  standingRow(4, 6, 400, 'Ctrl Alt Defeat', 'Priya N', 1226, 71, cap('Haaland', 'MCI', 'FWD')),
  standingRow(5, 4, 500, 'Xhaka Khan', 'Dev P', 1219, 50, cap('Saka', 'ARS')),
  standingRow(6, 5, 600, 'Bench Warmers', 'Amir K', 1205, 47, cap('Haaland', 'MCI', 'FWD')),
  standingRow(7, 7, 700, 'Salah Good', 'Nina R', 1188, 41, cap('Isak', 'NEW', 'FWD')),
  standingRow(8, 9, 800, 'Toney Baloney', 'Leo M', 1170, 55, cap('Palmer', 'CHE')),
  standingRow(9, 8, 900, 'Son of Anarchy', 'Kate L', 1155, 39, cap('Haaland', 'MCI', 'FWD')),
  standingRow(10, 10, 1000, 'Vardy Party', 'Omar S', 1131, 43, cap('Saka', 'ARS')),
]

const WR_CAPTAINS = [
  { ...cap('Haaland', 'MCI', 'FWD'), count: 5, pct: 50 },
  { ...cap('Palmer', 'CHE'), count: 2, pct: 20 },
  { ...cap('Saka', 'ARS'), count: 2, pct: 20 },
  { ...cap('Isak', 'NEW', 'FWD'), count: 1, pct: 10 },
]

const WR_TEMPLATE = [
  { ...cap('Saka', 'ARS'), count: 9, pct: 90 },
  { ...cap('Haaland', 'MCI', 'FWD'), count: 8, pct: 80 },
  { ...cap('Palmer', 'CHE'), count: 6, pct: 60 },
  { ...cap('Gabriel', 'ARS', 'DEF'), count: 5, pct: 50 },
  { ...cap('Mbeumo', 'MUN'), count: 4, pct: 40 },
  { ...cap('Isak', 'NEW', 'FWD'), count: 4, pct: 40 },
]

const WR_DIFFERENTIALS = [
  { ...cap('Gibbs-White', 'NFO'), owners: 1 },
  { ...cap('Rogers', 'AVL'), owners: 2 },
]

export function demoLeague(plan = 'free') {
  const unlocked = plan !== 'free'
  const you = WR_STANDINGS.find((row) => row.isYou)
  const above = WR_STANDINGS.find((row) => row.rank === you.rank - 1)
  const leader = WR_STANDINGS.find((row) => row.rank === 1)
  return {
    ...DEMO_META,
    generatedAt: new Date().toISOString(),
    feature: 'mini-league', featureName: 'Mini-League War Room', requiredPlan: 'pro', plan,
    league: { id: 123456, name: 'The Office FPL', size: WR_STANDINGS.length, hasNext: false },
    event: { id: 12, name: 'Gameweek 12', finished: true },
    you: {
      rank: you.rank, total: you.total, eventTotal: you.eventTotal, teamName: you.teamName,
      toOvertake: { points: (above.total - you.total) + 1, targetName: above.teamName },
      leaderGap: leader.total - you.total,
    },
    standings: unlocked ? WR_STANDINGS : WR_STANDINGS.map((row) => ({ ...row, captain: null })),
    locked: !unlocked,
    captains: unlocked ? WR_CAPTAINS : [],
    template: unlocked ? WR_TEMPLATE : [],
    yourDifferentials: unlocked ? WR_DIFFERENTIALS : [],
    deepCount: unlocked ? WR_STANDINGS.length : 0,
    lockedCount: unlocked ? 0 : WR_STANDINGS.length,
  }
}

/**
 * Offline squad analysis. A plausible 15-man team so the "My Team" view and its
 * Pro paywall are explorable with no FPL account and no network.
 */
function member(slot, name, teamShort, position, price, xPts, confidence, next, opts = {}) {
  return {
    id: `demo:sq:${slot}`,
    elementId: slot,
    name,
    webName: name.split(' ').slice(-1)[0],
    photoUrl: null,
    position,
    teamShort,
    team: teamShort,
    price,
    ownership: opts.ownership ?? 20,
    expectedPoints: xPts,
    captainScore: opts.captainScore ?? Number((xPts * 1.3).toFixed(2)),
    confidence,
    next,
    availability: opts.availability ?? { status: 'a', label: 'Available', chance: null, news: null },
    flags: { differential: false, template: false, rotationRisk: false, doubt: false, ...opts.flags },
    reasons: opts.reasons ?? [],
    isCaptain: Boolean(opts.isCaptain),
    isViceCaptain: Boolean(opts.isViceCaptain),
    onBench: slot > 11,
    slot,
  }
}

const fx = (home, opponent, difficulty) => ({ home, opponent, difficulty })

const SQUAD = [
  member(1, 'Jordan Pickford', 'EVE', 'GKP', 5.5, 3.6, 68, fx(true, 'IPS', 2)),
  member(2, 'Trent Alexander-Arnold', 'LIV', 'DEF', 7.0, 5.2, 78, fx(true, 'BHA', 2)),
  member(3, 'William Saliba', 'ARS', 'DEF', 6.0, 4.6, 76, fx(true, 'WOL', 2)),
  member(4, 'Pedro Porro', 'TOT', 'DEF', 5.5, 4.1, 70, fx(false, 'MCI', 4)),
  member(5, 'Mohamed Salah', 'LIV', 'MID', 12.5, 6.1, 90, fx(true, 'BHA', 2), { ownership: 48.2, captainScore: 8.2, isViceCaptain: true }),
  member(6, 'Cole Palmer', 'CHE', 'MID', 10.5, 5.4, 84, fx(false, 'CRY', 3), { ownership: 34.0, captainScore: 7.3, isCaptain: true }),
  member(7, 'Bukayo Saka', 'ARS', 'MID', 10.0, 5.1, 82, fx(true, 'WOL', 2), { ownership: 29.5, captainScore: 6.9 }),
  member(8, 'Morgan Gibbs-White', 'NFO', 'MID', 7.5, 3.1, 58, fx(false, 'MCI', 5), {
    ownership: 8.4, flags: { rotationRisk: true }, reasons: [],
  }),
  member(9, 'Erling Haaland', 'MCI', 'FWD', 15.0, 6.8, 92, fx(true, 'BOU', 2), { ownership: 61.4, captainScore: 9.1 }),
  member(10, 'Alexander Isak', 'NEW', 'FWD', 10.5, 4.9, 79, fx(true, 'AVL', 3), { ownership: 22.1 }),
  member(11, 'Ollie Watkins', 'AVL', 'FWD', 9.0, 2.8, 55, fx(false, 'NEW', 4), {
    ownership: 18.0, availability: { status: 'd', label: 'Doubtful', chance: 50, news: 'Knock - 50% chance of playing' }, flags: { doubt: true },
  }),
  // Bench
  member(12, 'Mark Flekken', 'BRE', 'GKP', 4.5, 2.9, 60, fx(true, 'LEI', 3)),
  member(13, 'Rico Lewis', 'MCI', 'DEF', 5.0, 3.2, 62, fx(true, 'BOU', 2)),
  member(14, 'Jacob Murphy', 'NEW', 'MID', 5.5, 3.0, 64, fx(true, 'AVL', 3)),
  member(15, 'Yoane Wissa', 'BRE', 'FWD', 6.0, 3.4, 66, fx(true, 'LEI', 3)),
]

const SQUAD_TRANSFERS = [
  {
    out: { id: 'demo:sq:8', name: 'Morgan Gibbs-White', webName: 'Gibbs-White', position: 'MID', teamShort: 'NFO', price: 7.5, expectedPoints: 3.1, next: fx(false, 'MCI', 5) },
    in: { id: 'demo:in:1', name: 'Bryan Mbeumo', webName: 'Mbeumo', photoUrl: null, position: 'MID', teamShort: 'BRE', price: 8.0, ownership: 18.7, expectedPoints: 5.3, confidence: 80, next: fx(false, 'LEI', 2), flags: {} },
    gain: 2.2, spend: 0.5, reason: 'Tough fixture — away at MCI (5/5)',
  },
  {
    out: { id: 'demo:sq:11', name: 'Ollie Watkins', webName: 'Watkins', position: 'FWD', teamShort: 'AVL', price: 9.0, expectedPoints: 2.8, next: fx(false, 'NEW', 4) },
    in: { id: 'demo:in:2', name: 'Chris Wood', webName: 'Wood', photoUrl: null, position: 'FWD', teamShort: 'NFO', price: 7.0, ownership: 24.3, expectedPoints: 4.7, confidence: 77, next: fx(true, 'SOU', 2), flags: {} },
    gain: 1.9, spend: -2.0, reason: 'Doubtful — 50% chance of playing',
  },
  {
    out: { id: 'demo:sq:4', name: 'Pedro Porro', webName: 'Porro', position: 'DEF', teamShort: 'TOT', price: 5.5, expectedPoints: 4.1, next: fx(false, 'MCI', 4) },
    in: { id: 'demo:in:3', name: 'Antonee Robinson', webName: 'Robinson', photoUrl: null, position: 'DEF', teamShort: 'FUL', price: 5.0, ownership: 26.1, expectedPoints: 5.0, confidence: 74, next: fx(true, 'WHU', 2), flags: {} },
    gain: 0.9, spend: -0.5, reason: 'Tough fixture — away at MCI (4/5)',
  },
]

function summaryCard(m) {
  return {
    id: m.id, name: m.name, webName: m.webName, photoUrl: m.photoUrl, position: m.position,
    teamShort: m.teamShort, price: m.price, expectedPoints: m.expectedPoints, captainScore: m.captainScore,
    confidence: m.confidence, next: m.next, availability: m.availability, flags: m.flags,
  }
}

export function demoSquad(plan = 'free') {
  const unlocked = plan !== 'free'
  const starters = SQUAD.filter((m) => !m.onBench)
  const bench = SQUAD.filter((m) => m.onBench)
  const current = starters.find((m) => m.isCaptain)
  const recommended = [...starters].sort((a, b) => b.captainScore - a.captainScore)[0]
  const projectedPoints = starters.reduce((total, m) => total + m.expectedPoints * (m.isCaptain ? 2 : 1), 0)
  const weakLinks = [...starters]
    .sort((a, b) => a.expectedPoints - b.expectedPoints)
    .slice(0, 3)
    .map((m) => ({ ...summaryCard(m), reason: m.availability.status !== 'a' ? m.availability.news : (m.flags.rotationRisk ? 'Rotation risk — minutes not nailed on' : `Tough fixture — ${m.next.home ? 'home vs' : 'away at'} ${m.next.opponent} (${m.next.difficulty}/5)`) }))

  return {
    ...DEMO_META,
    generatedAt: new Date().toISOString(),
    entry: {
      id: 1234567, teamName: 'Sample XI', managerName: 'Demo Manager',
      overallPoints: 812, overallRank: 341552, bank: 1.5, teamValue: 101.2, activeChip: null,
    },
    squad: {
      projectedPoints: Number(projectedPoints.toFixed(1)),
      captainMultiplier: 2,
      starters,
      bench,
      currentCaptain: current ? summaryCard(current) : null,
      recommendedCaptain: recommended ? summaryCard(recommended) : null,
      captainAdvice: current && recommended && current.id === recommended.id ? 'keep' : 'switch',
    },
    weakLinks,
    feature: 'transfer-advisor',
    featureName: 'AI Transfer Advisor',
    requiredPlan: 'pro',
    plan,
    locked: !unlocked,
    transferCount: SQUAD_TRANSFERS.length,
    transfers: unlocked ? SQUAD_TRANSFERS : [],
  }
}
