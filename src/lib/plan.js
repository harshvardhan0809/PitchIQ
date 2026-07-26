/**
 * Pure plan helpers shared by UI. The active plan itself now lives in the
 * signed session (see ./auth.js) rather than in a client-settable value.
 */
export const PLAN_LABELS = { free: 'Free', pro: 'Pro', elite: 'Elite' }

const RANK = { free: 0, pro: 1, elite: 2 }

export function planMeets(plan, required) {
  return (RANK[plan] ?? 0) >= (RANK[required] ?? 0)
}
