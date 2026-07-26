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

export function demoCaptainBoard(plan = 'free') {
  const base = {
    feature: 'captain-picks',
    featureName: 'AI Captain Picks',
    requiredPlan: 'pro',
    plan,
    gameweek: 12,
    gameweekName: 'Gameweek 12',
    deadline: null,
    phase: 'demo',
    generatedAt: new Date().toISOString(),
  }
  const unlocked = plan === 'pro' || plan === 'elite'
  if (unlocked) return { ...base, locked: false, topPick: BOARD[0], board: BOARD }
  return { ...base, locked: true, topPick: BOARD[0], board: BOARD.slice(0, 1), lockedCount: BOARD.length - 1 }
}
