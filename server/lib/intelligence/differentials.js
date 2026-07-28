import { buildProjections } from './projections.js'

/**
 * Differentials — low-owned players the projection model rates highly. These are
 * the picks that win mini-leagues: if a <15%-owned player returns, you gain on
 * almost everyone. A thin view over the same engine as the captain board.
 */
function verdictFor(projection) {
  if (projection.ownership < 5) return 'Deep differential'
  if (projection.expectedPoints >= 5) return 'High-upside pick'
  if (projection.next && projection.next.difficulty <= 2) return 'Fixture-led punt'
  return 'Under the radar'
}

function toCard(projection, rank) {
  return {
    rank,
    id: projection.id,
    name: projection.name,
    webName: projection.webName,
    photoUrl: projection.photoUrl,
    position: projection.position,
    team: projection.team,
    teamShort: projection.teamShort,
    price: projection.price,
    ownership: projection.ownership,
    expectedPoints: projection.expectedPoints,
    captainScore: projection.captainScore,
    confidence: projection.confidence,
    next: projection.next,
    availability: projection.availability,
    flags: projection.flags,
    reasons: projection.reasons,
    verdict: verdictFor(projection),
  }
}

export function rankDifferentials(projection, { maxOwnership = 15, minExpected = 3, limit = 12 } = {}) {
  return projection.players
    .filter((player) => player.ownership > 0 && player.ownership <= maxOwnership)
    .filter((player) => player.playProb >= 0.5 && player.next)
    .filter((player) => player.availability.status !== 'i' && player.availability.status !== 's')
    .filter((player) => player.expectedPoints >= minExpected)
    .sort((left, right) => right.expectedPoints - left.expectedPoints)
    .slice(0, limit)
    .map((player, index) => toCard(player, index + 1))
}

export async function getDifferentials({ fpl, limit = 12 }) {
  const projection = await buildProjections({ fpl })
  return {
    gameweek: projection.gameweek,
    gameweekName: projection.gameweekName,
    deadline: projection.deadline,
    phase: projection.phase,
    generatedAt: projection.generatedAt,
    board: rankDifferentials(projection, { limit }),
  }
}
