import { buildProjections } from './projections.js'

/**
 * The captain board: the players most worth the armband this gameweek, ranked
 * by captain score (expected points weighted by ceiling). This is a thin view
 * over the projection engine — filter to realistic starters, sort, shape.
 */

function toCaptainCard(projection, rank) {
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
    // A short verdict the UI can lead with, generated from the projection.
    verdict: verdictFor(projection, rank),
  }
}

function verdictFor(projection, rank) {
  if (rank === 1) return 'Top armband this week'
  if (projection.flags.differential) return 'Differential captain'
  if (projection.confidence >= 70) return 'Safe, high-floor option'
  if (projection.next && projection.next.difficulty <= 2) return 'Fixture-led pick'
  return 'Punt with upside'
}

export function rankCaptains(projection, { limit = 12 } = {}) {
  return projection.players
    // Must be a realistic starter with a fixture to captain into.
    .filter((player) => player.playProb >= 0.45 && player.next)
    .filter((player) => player.availability.status !== 'i' && player.availability.status !== 's')
    .sort((left, right) => right.captainScore - left.captainScore)
    .slice(0, limit)
    .map((player, index) => toCaptainCard(player, index + 1))
}

export async function getCaptainBoard({ fpl, limit = 12 }) {
  const projection = await buildProjections({ fpl })
  return {
    gameweek: projection.gameweek,
    gameweekName: projection.gameweekName,
    deadline: projection.deadline,
    phase: projection.phase,
    generatedAt: projection.generatedAt,
    board: rankCaptains(projection, { limit }),
  }
}
