import { toNumber } from '../format.js'
import { fullName, indexBy, playerPhotoUrl, teamCrestUrl } from '../providers/fpl.js'

/**
 * Price Change Predictor.
 *
 * FPL nudges a player's price up or down based on how many managers transfer
 * them in vs out during the current gameweek. The exact threshold is a closely
 * guarded, floating figure — so rather than pretend to know it, we model the one
 * thing that genuinely drives it: transfer *momentum*, the net transfers this
 * gameweek expressed as a share of the entire manager base (`total_players`).
 * The bigger that share, the closer the player is to a change. We surface that as
 * a confidence % and an honest likelihood label, never a guarantee.
 *
 * Cheap: one cached bootstrap fetch — no fixtures, no projection engine.
 */

// Net-transfer share of the whole player base that tends to precede a change.
// A deliberate, transparent approximation of FPL's hidden threshold; tune here.
const TARGET_MOMENTUM_PCT = 0.6

// Ignore the long tail of near-static players so the boards stay signal, not noise.
const MIN_MOMENTUM_PCT = 0.05

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function likelihoodFor(confidence, changedThisGw) {
  if (changedThisGw) return 'Changed today'
  if (confidence >= 80) return 'Very likely'
  if (confidence >= 55) return 'Likely'
  if (confidence >= 30) return 'Possible'
  return 'Watch'
}

function toItem(element, ctx) {
  const { typesById, teamsById, totalManagers } = ctx
  const transfersIn = toNumber(element.transfers_in_event, 0)
  const transfersOut = toNumber(element.transfers_out_event, 0)
  const netTransfers = transfersIn - transfersOut

  const momentumPct = totalManagers > 0 ? (netTransfers / totalManagers) * 100 : 0
  const progress = Math.abs(momentumPct) / TARGET_MOMENTUM_PCT
  // A change already banked this gameweek is strong evidence the momentum is real.
  const changeThisGw = toNumber(element.cost_change_event, 0) / 10
  const confidence = clamp(Math.round(progress * 100) + (changeThisGw !== 0 ? 15 : 0), 1, 99)

  const team = teamsById.get(element.team)
  const name = fullName(element)
  return {
    id: `fpl:${element.id}`,
    elementId: element.id,
    name,
    webName: element.web_name ?? name,
    photoUrl: playerPhotoUrl(element.code),
    position: typesById.get(element.element_type)?.singular_name_short ?? 'MID',
    team: team?.name ?? 'Unknown',
    teamShort: team?.short_name ?? '—',
    teamCrestUrl: team?.code ? teamCrestUrl(team.code) : null,
    price: toNumber(element.now_cost, 0) / 10,
    ownership: toNumber(element.selected_by_percent, 0),
    transfersIn,
    transfersOut,
    netTransfers,
    momentum: Number(momentumPct.toFixed(3)),
    direction: netTransfers >= 0 ? 'rise' : 'fall',
    confidence,
    likelihood: likelihoodFor(confidence, changeThisGw !== 0),
    changedThisGw: Number(changeThisGw.toFixed(1)),
  }
}

export async function getPriceWatch({ fpl, limit = 12 }) {
  const bootstrap = await fpl.getBootstrap()
  const typesById = indexBy(bootstrap.element_types, 'id')
  const teamsById = indexBy(bootstrap.teams, 'id')
  const totalManagers = toNumber(bootstrap.total_players, 0)

  const events = bootstrap.events ?? []
  const focus = events.find((event) => event.is_current)
    ?? events.find((event) => event.is_next)
    ?? null
  const phase = events.some((event) => event.finished) ? 'active' : 'pre'

  const ctx = { typesById, teamsById, totalManagers }
  const scored = (bootstrap.elements ?? [])
    .map((element) => toItem(element, ctx))
    .filter((item) => Math.abs(item.momentum) >= MIN_MOMENTUM_PCT)

  const byConfidence = (left, right) => right.confidence - left.confidence
  const risers = scored.filter((item) => item.direction === 'rise').sort(byConfidence).slice(0, limit)
  const fallers = scored.filter((item) => item.direction === 'fall').sort(byConfidence).slice(0, limit)

  return {
    gameweek: focus?.id ?? null,
    gameweekName: focus?.name ?? null,
    deadline: focus?.deadline_time ?? null,
    phase,
    generatedAt: new Date().toISOString(),
    totalManagers,
    risers,
    fallers,
  }
}
