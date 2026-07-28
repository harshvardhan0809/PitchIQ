import { HttpError } from './http.js'

/**
 * Server-side Supabase identity + entitlement.
 *
 * Identity: a token is validated by asking Supabase who it belongs to
 * (`GET /auth/v1/user`). That validation is cached briefly (it doesn't change).
 *
 * Entitlement: the plan is read *live* from the `public.subscriptions` table on
 * every request (via the service role, which bypasses RLS). Because it is never
 * cached and never carried inside the token, an admin change or a billing
 * webhook is authoritative on the very next request — no stale-session lag. If
 * the table is not present yet (pre-migration) or a user has no row, it falls
 * back to the plan stored in the token's `app_metadata`.
 *
 * Writes go to the subscriptions table first and also mirror into app_metadata
 * so the fallback stays correct during the migration.
 */
const normalizePlan = (value) => (value === 'pro' || value === 'elite' ? 'pro' : 'free')

export class SupabaseAuth {
  constructor({ url, anonKey, serviceKey, cache, ttlMs = 60 * 1000 } = {}) {
    this.url = (url ?? '').replace(/\/$/, '')
    this.anonKey = anonKey ?? ''
    this.serviceKey = serviceKey ?? ''
    this.cache = cache
    this.ttlMs = ttlMs
    this.restUrl = `${this.url}/rest/v1`
  }

  get configured() {
    return Boolean(this.url && this.anonKey)
  }

  get canManage() {
    return Boolean(this.url && this.serviceKey)
  }

  restHeaders(extra = {}) {
    return { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, ...extra }
  }

  /** Validate an access token → { id, email, metaPlan } or null. Cached. */
  async validateToken(token) {
    let response
    try {
      response = await fetch(`${this.url}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: this.anonKey },
      })
    } catch {
      throw new HttpError('Could not reach the authentication service.', 502)
    }
    // An invalid or expired token is not an error — it's simply not signed in.
    if (response.status === 401 || response.status === 403) return null
    if (!response.ok) throw new HttpError('Could not validate the session.', 502)

    const user = await response.json()
    return {
      id: user.id,
      email: user.email ?? null,
      metaPlan: normalizePlan(user.app_metadata?.plan),
    }
  }

  /** Validate a token and resolve the user with their *current* plan, or null. */
  async getUser(token) {
    if (!this.configured || !token) return null
    const identity = await this.cache.resolve(
      `supabase:id:${token}`,
      this.ttlMs,
      () => this.validateToken(token),
    )
    if (!identity?.id) return null
    const tablePlan = await this.getSubscriptionPlan(identity.id)
    return { id: identity.id, email: identity.email, plan: tablePlan ?? identity.metaPlan }
  }

  /** Drop a cached token validation (identity only; the plan is never cached). */
  forget(token) {
    if (token) this.cache.delete(`supabase:id:${token}`)
  }

  // --- subscriptions (live entitlement) --------------------------------------

  /** The user's plan from the subscriptions table, or null if unavailable. */
  async getSubscriptionPlan(userId) {
    if (!this.canManage) return null
    let response
    try {
      response = await fetch(
        `${this.restUrl}/subscriptions?user_id=eq.${userId}&select=plan`,
        { headers: this.restHeaders() },
      )
    } catch {
      return null
    }
    if (!response.ok) return null // table missing / error → caller falls back
    const rows = await response.json().catch(() => null)
    const plan = rows?.[0]?.plan
    return plan ? normalizePlan(plan) : null
  }

  /** Every user_id → plan in the subscriptions table (for the admin console). */
  async listSubscriptionPlans() {
    if (!this.canManage) return new Map()
    let response
    try {
      response = await fetch(`${this.restUrl}/subscriptions?select=user_id,plan`, { headers: this.restHeaders() })
    } catch {
      return new Map()
    }
    if (!response.ok) return new Map()
    const rows = await response.json().catch(() => [])
    return new Map(rows.map((row) => [row.user_id, normalizePlan(row.plan)]))
  }

  async upsertSubscription(userId, { plan, status }) {
    const response = await fetch(`${this.restUrl}/subscriptions`, {
      method: 'POST',
      headers: this.restHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ user_id: userId, plan, status, updated_at: new Date().toISOString() }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new HttpError(`Could not update the subscription.${detail ? ` ${detail}` : ''}`, 502)
    }
  }

  /**
   * Set a user's plan. Writes the subscriptions table (the source of truth) and
   * mirrors into app_metadata so the fallback stays correct. If the table isn't
   * there yet, app_metadata alone still works (old behaviour).
   */
  async setPlan(userId, plan) {
    if (!this.canManage) {
      throw new HttpError('This server is not configured to change plans (missing service role key).', 503)
    }
    const status = plan === 'free' ? 'inactive' : 'active'
    let wroteTable = false
    try {
      await this.upsertSubscription(userId, { plan, status })
      wroteTable = true
    } catch {
      // Table may not exist yet — fall back to app_metadata only.
    }
    try {
      await this.setAppMetadataPlan(userId, plan)
    } catch (error) {
      if (!wroteTable) throw error // nothing persisted anywhere
    }
    return { plan, viaTable: wroteTable }
  }

  /** Legacy plan store: the user's app_metadata (fallback + migration mirror). */
  async setAppMetadataPlan(userId, plan) {
    let response
    try {
      response = await fetch(`${this.url}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_metadata: { plan } }),
      })
    } catch {
      throw new HttpError('Could not reach the authentication service.', 502)
    }
    if (!response.ok) throw new HttpError('Could not update the plan.', 502)
  }

  // --- profiles --------------------------------------------------------------

  /** The user's profile row (fpl team id, settings), or null. */
  async getProfile(userId) {
    if (!this.canManage) return null
    let response
    try {
      response = await fetch(
        `${this.restUrl}/profiles?id=eq.${userId}&select=fpl_team_id,display_name,favorite_team`,
        { headers: this.restHeaders() },
      )
    } catch {
      return null
    }
    if (!response.ok) return null
    const rows = await response.json().catch(() => null)
    return rows?.[0] ?? null
  }

  /** Create/update the user's profile row. */
  async upsertProfile(userId, email, fields) {
    if (!this.canManage) throw new HttpError('Profiles are not available on this server.', 503)
    const response = await fetch(`${this.restUrl}/profiles`, {
      method: 'POST',
      headers: this.restHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify({ id: userId, email, ...fields, updated_at: new Date().toISOString() }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new HttpError(`Could not save your profile.${detail ? ` ${detail}` : ''}`, 502)
    }
    const rows = await response.json().catch(() => null)
    return rows?.[0] ?? null
  }

  // --- admin -----------------------------------------------------------------

  /** List all users via the admin API (service role required). */
  async listUsers({ page = 1, perPage = 200 } = {}) {
    if (!this.canManage) {
      throw new HttpError('This server is not configured to manage users (missing service role key).', 503)
    }
    let response
    try {
      response = await fetch(`${this.url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
        headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey },
      })
    } catch {
      throw new HttpError('Could not reach the authentication service.', 502)
    }
    if (!response.ok) throw new HttpError('Could not list users.', 502)
    const body = await response.json()
    return body.users ?? []
  }
}
