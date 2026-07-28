import { buildProjections } from './projections.js'

/**
 * The Weekly Briefing: a short, readable digest of the gameweek generated from
 * the same projection engine as every other view. It answers, in plain English,
 * "what should I be thinking about before the deadline?" — the captain, a
 * differential, the best value, and who to be wary of.
 *
 * The narrative is composed deterministically from the model (no external LLM),
 * so it costs nothing beyond the one cached projection and stays explainable.
 */

function briefPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    webName: player.webName,
    photoUrl: player.photoUrl,
    position: player.position,
    team: player.team,
    teamShort: player.teamShort,
    price: player.price,
    ownership: player.ownership,
    expectedPoints: player.expectedPoints,
    next: player.next,
  }
}

/** "a favourable tie home to BOU" — a readable fixture phrase. */
function fixturePhrase(next) {
  if (!next) return 'no fixture this week'
  const where = next.home ? `home to ${next.opponent}` : `away at ${next.opponent}`
  const kind = next.difficulty <= 2 ? 'a favourable' : next.difficulty >= 4 ? 'a tough' : 'an even'
  return `${kind} tie ${where}`
}

/** Realistic starters with a fixture to project into. */
function playingPool(players) {
  const starters = players.filter((player) => (
    player.playProb >= 0.5
    && player.next
    && player.availability.status !== 'i'
    && player.availability.status !== 's'
  ))
  return starters.length ? starters : players.filter((player) => player.next)
}

function captainSection(pool) {
  const pick = [...pool].sort((a, b) => b.captainScore - a.captainScore)[0]
  if (!pick) return null
  return {
    id: 'captain',
    title: 'Captain of the week',
    tone: 'good',
    body: `${pick.name} (${pick.teamShort}) is the standout armband — ${fixturePhrase(pick.next)}, `
      + `projecting a game-high ${pick.expectedPoints} points. The safest route to a big score.`,
    player: briefPlayer(pick),
  }
}

function differentialSection(pool) {
  const pick = [...pool]
    .filter((player) => player.ownership <= 12 && player.expectedPoints >= 3.5)
    .sort((a, b) => b.expectedPoints - a.expectedPoints)[0]
  if (!pick) return null
  return {
    id: 'differential',
    title: 'Differential to watch',
    tone: 'good',
    body: `${pick.name} (${pick.teamShort}) sits in just ${pick.ownership.toFixed(1)}% of teams but projects `
      + `${pick.expectedPoints} points ${fixturePhrase(pick.next)} — a cheap way to gain ground on your mini-league.`,
    player: briefPlayer(pick),
  }
}

function valueSection(pool) {
  const pick = [...pool]
    .filter((player) => player.expectedPoints >= 3 && player.price > 0)
    .sort((a, b) => (b.expectedPoints / b.price) - (a.expectedPoints / a.price))[0]
  if (!pick) return null
  return {
    id: 'value',
    title: 'Best value',
    tone: 'neutral',
    body: `${pick.name} (${pick.teamShort}) at £${pick.price.toFixed(1)}m is the pick for points per million — `
      + `${pick.expectedPoints} projected with ${fixturePhrase(pick.next)}. Frees budget for a premium elsewhere.`,
    player: briefPlayer(pick),
  }
}

function watchSection(players) {
  const pick = players
    .filter((player) => player.ownership >= 20 && (player.flags.doubt || (player.next && player.next.difficulty >= 4)))
    .sort((a, b) => b.ownership - a.ownership)[0]
  if (!pick) return null
  const reason = pick.flags.doubt
    ? (pick.availability.news || `${pick.availability.label.toLowerCase()} and a doubt to start`)
    : `${fixturePhrase(pick.next)}`
  return {
    id: 'watch',
    title: 'Watch out',
    tone: 'bad',
    body: `${pick.name} (${pick.teamShort}) is owned by ${pick.ownership.toFixed(1)}% but faces ${reason}. `
      + `Worth a check before the deadline — a captain or a bench slot could hinge on it.`,
    player: briefPlayer(pick),
  }
}

export async function getBriefing({ fpl }) {
  const projection = await buildProjections({ fpl })
  const pool = playingPool(projection.players)

  const sections = [
    captainSection(pool),
    differentialSection(pool),
    valueSection(pool),
    watchSection(projection.players),
  ].filter(Boolean)

  const captain = sections.find((section) => section.id === 'captain')
  const label = projection.gameweekName ?? 'the gameweek'
  const headline = captain
    ? `${captain.player.name} leads the armband picks for ${label}.`
    : `Your ${label} briefing.`

  return {
    gameweek: projection.gameweek,
    gameweekName: projection.gameweekName,
    deadline: projection.deadline,
    phase: projection.phase,
    generatedAt: projection.generatedAt,
    headline,
    sections,
  }
}
