/**
 * Plan entitlements — the revenue backbone.
 *
 * One catalogue of premium features, each tagged with the plan that unlocks it,
 * so every gated endpoint checks access the same way and the pricing page can be
 * generated from the same source of truth the server enforces.
 *
 * NOTE ON BILLING: the plan is currently read from a request header as a
 * pre-billing stub so both sides of every paywall can be demonstrated. In
 * production this MUST be replaced by a verified entitlement — a signed session
 * or a Stripe customer/subscription lookup — resolved server-side. The gating
 * shape below does not change when that lands; only `resolvePlan` does.
 */

export const PLAN_ORDER = ['free', 'pro', 'elite']
const RANK = { free: 0, pro: 1, elite: 2 }

export const PLANS = {
  free: { id: 'free', name: 'Free', priceMonthly: 0 },
  pro: { id: 'pro', name: 'Pro', priceMonthly: 5 },
  elite: { id: 'elite', name: 'Elite', priceMonthly: 12 },
}

/**
 * Every premium capability. `minPlan` is the lowest plan that unlocks it;
 * `freePreview` means the free tier gets a limited taste (e.g. the single top
 * captain pick) that drives the upgrade.
 */
export const FEATURES = {
  'captain-picks': { name: 'AI Captain Picks', minPlan: 'pro', freePreview: true },
  'transfer-advisor': { name: 'AI Transfer Advisor', minPlan: 'pro', freePreview: true },
  differentials: { name: 'Differential Finder', minPlan: 'pro', freePreview: true },
  'predicted-points': { name: 'Predicted Points', minPlan: 'pro', freePreview: false },
  'price-predictor': { name: 'Price Rise Predictor', minPlan: 'pro', freePreview: false },
  'weekly-briefing': { name: 'Weekly Briefing', minPlan: 'pro', freePreview: true },
  'team-analyzer': { name: 'Team Analyzer', minPlan: 'elite', freePreview: false },
  'wildcard-planner': { name: 'Wildcard Planner', minPlan: 'elite', freePreview: false },
  'chip-strategy': { name: 'Chip Strategy', minPlan: 'elite', freePreview: false },
  'team-optimizer': { name: 'Team Optimizer', minPlan: 'elite', freePreview: false },
}

/**
 * Decide which plan a set of sign-in credentials earns.
 *
 * This is the single "who is entitled" seam. Today it recognises access codes
 * (a license/promo key) and a configured list of Pro emails — the stand-in for
 * payment. In production this is replaced by a Stripe subscription lookup; the
 * token issued from the result does not change shape, so nothing downstream
 * moves. An access code is checked first so a paying user can always upgrade an
 * existing account.
 */
export function planForCredentials(email, code, { proCodes = [], eliteCodes = [], proEmails = [] } = {}) {
  const normalizedCode = String(code ?? '').trim().toUpperCase()
  if (normalizedCode && eliteCodes.includes(normalizedCode)) return 'elite'
  if (normalizedCode && proCodes.includes(normalizedCode)) return 'pro'

  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  if (normalizedEmail && proEmails.includes(normalizedEmail)) return 'pro'

  return 'free'
}

export function isEntitled(plan, featureKey) {
  const feature = FEATURES[featureKey]
  if (!feature) return true
  return RANK[plan] >= RANK[feature.minPlan]
}

export function featureMeta(featureKey) {
  const feature = FEATURES[featureKey]
  if (!feature) return null
  return { key: featureKey, name: feature.name, requiredPlan: feature.minPlan, freePreview: Boolean(feature.freePreview) }
}
