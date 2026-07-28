import { buildProjections } from './projections.js'
import { HttpError } from '../http.js'

/**
 * Squad analysis — the personalised view. Given a manager's public FPL team ID
 * we run their actual 15 players through the projection engine and answer the
 * three questions every manager asks before a deadline:
 *
 *   1. How many points is my team projected to score?
 *   2. Who should wear the armband — and is my current captain the right one?
 *   3. Which of my players is the weak link, and who can I realistically buy
 *      to replace them (within my bank and the 3-per-club limit)?
 *
 * Everything is a read over the same cached projection, so connecting a team
 * costs one bootstrap + fixtures fetch plus two tiny per-manager calls.
 */

const STARTER_SLOTS = 11
const SQUAD_MAX_PER_CLUB = 3
// Only recommend a swap that clears a real margin — churn for +0.2 xPts is noise.
const MIN_SWAP_GAIN = 0.8

/** Shape one squad member from its projection plus the manager's pick metadata. */
function toSquadCard(projection, pick) {
  return {
    id: projection.id,
    elementId: projection.elementId,
    name: projection.name,
    webName: projection.webName,
    photoUrl: projection.photoUrl,
    position: projection.position,
    teamId: projection.teamId,
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
    isCaptain: pick.is_captain,
    isViceCaptain: pick.is_vice_captain,
    onBench: pick.position > STARTER_SLOTS,
    slot: pick.position,
  }
}

/** Why a starter is flagged as a weak link — the most damning reason first. */
function weaknessReason(card) {
  if (card.availability.status !== 'a') {
    return card.availability.news || `${card.availability.label} — may not feature`
  }
  if (card.flags.rotationRisk) return 'Rotation risk — minutes not nailed on'
  if (card.next && card.next.difficulty >= 4) {
    return `Tough fixture — ${card.next.home ? 'home vs' : 'away at'} ${card.next.opponent} (${card.next.difficulty}/5)`
  }
  return `Low projection — ${card.expectedPoints} xPts this week`
}

/**
 * Find the best legal replacement for a starter: same position, affordable with
 * the manager's bank, not already owned, and not breaking the 3-per-club cap.
 * Returns the single highest-xPts upgrade, or null if none clears the margin.
 */
function bestReplacement(out, { pool, ownedIds, clubCounts, bank }) {
  const budget = out.price + bank
  // Removing `out` frees one slot in their club before we add the newcomer.
  const clubAllowance = (teamId) => {
    const current = clubCounts.get(teamId) ?? 0
    return teamId === out.teamId ? current - 1 : current
  }

  let best = null
  for (const candidate of pool) {
    if (candidate.position !== out.position) continue
    if (ownedIds.has(candidate.elementId)) continue
    if (candidate.price > budget) continue
    if (candidate.playProb < 0.5) continue
    if (clubAllowance(candidate.teamId) >= SQUAD_MAX_PER_CLUB) continue
    const gain = candidate.expectedPoints - out.expectedPoints
    if (gain < MIN_SWAP_GAIN) continue
    if (!best || candidate.expectedPoints > best.expectedPoints) best = candidate
  }
  return best
}

function transferCard(out, replacement) {
  const gain = Number((replacement.expectedPoints - out.expectedPoints).toFixed(1))
  const spend = Number((replacement.price - out.price).toFixed(1))
  return {
    out: {
      id: out.id,
      name: out.name,
      webName: out.webName,
      position: out.position,
      teamShort: out.teamShort,
      price: out.price,
      expectedPoints: out.expectedPoints,
      next: out.next,
    },
    in: {
      id: replacement.id,
      name: replacement.name,
      webName: replacement.webName,
      photoUrl: replacement.photoUrl,
      position: replacement.position,
      teamShort: replacement.teamShort,
      price: replacement.price,
      ownership: replacement.ownership,
      expectedPoints: replacement.expectedPoints,
      confidence: replacement.confidence,
      next: replacement.next,
      flags: replacement.flags,
    },
    gain,
    // Positive = costs money, negative = frees funds.
    spend,
    reason: weaknessReason(out),
  }
}

export async function getSquadAnalysis({ fpl, entryId }) {
  const [projection, entry] = await Promise.all([
    buildProjections({ fpl }),
    fpl.getEntry(entryId).catch((error) => {
      if (error instanceof HttpError && error.status === 404) {
        throw new HttpError('No FPL team with that ID. Check the number in your team’s URL.', 404)
      }
      throw error
    }),
  ])

  const event = entry.current_event
  if (!event) {
    throw new HttpError('That team has not picked a squad yet — come back once the season is under way.', 409)
  }

  const picksData = await fpl.getEntryPicks(entryId, event).catch((error) => {
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError('Could not read that team’s squad for the current gameweek.', 404)
    }
    throw error
  })

  const byId = new Map(projection.players.map((player) => [player.elementId, player]))
  const picks = picksData.picks ?? []

  const squad = picks
    .map((pick) => {
      const proj = byId.get(pick.element)
      return proj ? toSquadCard(proj, pick) : null
    })
    .filter(Boolean)

  const starters = squad.filter((card) => !card.onBench).sort((a, b) => a.slot - b.slot)
  const bench = squad.filter((card) => card.onBench).sort((a, b) => a.slot - b.slot)

  // Projected gameweek score: every starter, with the captain counted twice
  // (or tripled under a Triple Captain chip).
  const captainMultiplier = picksData.active_chip === '3xc' ? 3 : 2
  const currentCaptain = starters.find((card) => card.isCaptain) ?? null
  const projectedPoints = starters.reduce((total, card) => {
    const factor = card.isCaptain ? captainMultiplier : 1
    return total + card.expectedPoints * factor
  }, 0)

  // The armband should go to the highest-ceiling starter available to play.
  const recommendedCaptain = [...starters]
    .filter((card) => card.availability.status !== 'i' && card.availability.status !== 's')
    .sort((a, b) => b.captainScore - a.captainScore)[0] ?? null
  const captainAdvice = recommendedCaptain && currentCaptain
    && recommendedCaptain.elementId === currentCaptain.elementId ? 'keep' : 'switch'

  // Weak links: the three lowest-projected or doubtful starters.
  const weakLinks = [...starters]
    .sort((a, b) => a.expectedPoints - b.expectedPoints)
    .slice(0, 3)
    .map((card) => ({ ...pickWeakFields(card), reason: weaknessReason(card) }))

  // Transfer suggestions: the best legal upgrade for each weak link, de-duped
  // by incoming player and ranked by points gained.
  const ownedIds = new Set(squad.map((card) => card.elementId))
  const clubCounts = new Map()
  for (const card of squad) clubCounts.set(card.teamId, (clubCounts.get(card.teamId) ?? 0) + 1)
  const bank = (picksData.entry_history?.bank ?? 0) / 10

  const suggestions = []
  const usedIn = new Set()
  for (const out of [...starters].sort((a, b) => a.expectedPoints - b.expectedPoints)) {
    const replacement = bestReplacement(out, { pool: projection.players, ownedIds, clubCounts, bank })
    if (!replacement || usedIn.has(replacement.elementId)) continue
    usedIn.add(replacement.elementId)
    suggestions.push(transferCard(out, replacement))
  }
  suggestions.sort((a, b) => b.gain - a.gain)

  return {
    gameweek: projection.gameweek,
    gameweekName: projection.gameweekName,
    deadline: projection.deadline,
    phase: projection.phase,
    generatedAt: projection.generatedAt,
    entry: {
      id: entry.id,
      teamName: entry.name,
      managerName: `${entry.player_first_name ?? ''} ${entry.player_last_name ?? ''}`.trim() || 'Manager',
      overallPoints: entry.summary_overall_points ?? null,
      overallRank: entry.summary_overall_rank ?? null,
      bank: Number(bank.toFixed(1)),
      teamValue: Number(((picksData.entry_history?.value ?? 0) / 10).toFixed(1)),
      activeChip: picksData.active_chip ?? null,
    },
    squad: {
      projectedPoints: Number(projectedPoints.toFixed(1)),
      captainMultiplier,
      starters,
      bench,
      currentCaptain: currentCaptain ? pickWeakFields(currentCaptain) : null,
      recommendedCaptain: recommendedCaptain ? pickWeakFields(recommendedCaptain) : null,
      captainAdvice,
    },
    weakLinks,
    transfers: suggestions.slice(0, 5),
  }
}

/** The compact card fields the captain/weak-link summaries need. */
function pickWeakFields(card) {
  return {
    id: card.id,
    name: card.name,
    webName: card.webName,
    photoUrl: card.photoUrl,
    position: card.position,
    teamShort: card.teamShort,
    price: card.price,
    expectedPoints: card.expectedPoints,
    captainScore: card.captainScore,
    confidence: card.confidence,
    next: card.next,
    availability: card.availability,
    flags: card.flags,
  }
}
