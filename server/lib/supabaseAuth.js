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

  /**
   * Validate a token and resolve the user with their *effective* plan, or null.
   *
   * Effective Pro requires all of: a subscriptions row owned by this user, plan
   * 'pro', status 'active', and (if known) an entitlement period that has not
   * expired. This is the single authoritative entitlement check — computed fresh
   * on every request from server-owned data, never from the token or client. The
   * legacy app_metadata plan is used ONLY when no row exists (pre-migration).
   */
  async getUser(token) {
    if (!this.configured || !token) return null
    const identity = await this.cache.resolve(
      `supabase:id:${token}`,
      this.ttlMs,
      () => this.validateToken(token),
    )
    if (!identity?.id) return null
    const row = await this.getSubscriptionRow(identity.id)
    const plan = row ? (this.isRowEntitled(row) ? 'pro' : 'free') : identity.metaPlan
    return { id: identity.id, email: identity.email, plan }
  }

  /** The authoritative Pro test for a subscriptions row: pro + active + unexpired. */
  isRowEntitled(row) {
    if (!row || normalizePlan(row.plan) !== 'pro') return false
    if (row.status && row.status !== 'active') return false
    if (row.current_period_end) {
      const end = new Date(row.current_period_end).getTime()
      if (Number.isFinite(end) && end <= Date.now()) return false // entitlement lapsed
    }
    return true
  }

  /**
   * The full subscriptions row for a user (entitlement fields), or null. Degrades
   * gracefully if the `last_event_at` column hasn't been migrated yet, so the
   * entitlement read never breaks purely because the migration hasn't run.
   */
  async getSubscriptionRow(userId) {
    if (!this.canManage) return null
    const select = (cols) => fetch(
      `${this.restUrl}/subscriptions?user_id=eq.${userId}&select=${cols}`,
      { headers: this.restHeaders() },
    )
    let response
    try {
      response = await select('plan,status,current_period_end,provider_subscription_id,last_event_at')
      if (response.status === 400) response = await select('plan,status,current_period_end,provider_subscription_id')
    } catch {
      return null
    }
    if (!response.ok) return null
    const rows = await response.json().catch(() => null)
    return rows?.[0] ?? null
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

  /**
   * Upsert a subscriptions row. Only the fields provided are written (Postgres
   * ON CONFLICT DO UPDATE touches just those columns), so callers can update a
   * single field without clobbering the rest.
   */
  async upsertSubscription(userId, { plan, status, provider, providerSubscriptionId, currentPeriodEnd, eventAt } = {}) {
    const body = { user_id: userId, updated_at: new Date().toISOString() }
    if (plan !== undefined) body.plan = plan
    if (status !== undefined) body.status = status
    if (provider !== undefined) body.provider = provider
    if (providerSubscriptionId !== undefined) body.provider_subscription_id = providerSubscriptionId
    if (currentPeriodEnd !== undefined) body.current_period_end = currentPeriodEnd
    if (eventAt !== undefined) body.last_event_at = eventAt
    const response = await fetch(`${this.restUrl}/subscriptions`, {
      method: 'POST',
      headers: this.restHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(body),
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
      // A manual/admin change is a comp with no provider expiry, so clear
      // current_period_end (else a stale past expiry would keep it non-entitled).
      // eventAt=now so a genuinely older provider event can't overwrite this.
      await this.upsertSubscription(userId, { plan, status, currentPeriodEnd: null, eventAt: new Date().toISOString() })
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

  // --- webhook idempotency, ordering & reconciliation ------------------------

  /**
   * Record a provider event id. Returns true if this is the first time we've seen
   * it, false if it's a duplicate (primary-key conflict). If the ledger table is
   * missing we fail OPEN (return true) — writes downstream are still idempotent
   * and ordering-guarded, so a missing ledger degrades dedup, not correctness.
   */
  async recordBillingEvent(eventId, type, createdAtIso) {
    if (!this.canManage || !eventId) return true
    let response
    try {
      response = await fetch(`${this.restUrl}/billing_events`, {
        method: 'POST',
        headers: this.restHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ event_id: eventId, event_type: type ?? null, event_created_at: createdAtIso ?? null }),
      })
    } catch {
      return true
    }
    if (response.status === 409) return false // already processed
    return true
  }

  /**
   * Apply an entitlement change ONLY if it is newer than the last event applied
   * to that row. The `last_event_at` filter makes ordering atomic in the DB, so a
   * replayed or out-of-order older event cannot overwrite a newer state. Returns
   * whether a row was actually updated.
   */
  async patchSubscriptionIfNewer(userId, fields, eventAtIso) {
    if (!this.canManage) return { applied: false }
    const guard = `or=(last_event_at.is.null,last_event_at.lt.${encodeURIComponent(eventAtIso)})`
    const body = { ...fields, last_event_at: eventAtIso, updated_at: new Date().toISOString() }
    let response
    try {
      response = await fetch(`${this.restUrl}/subscriptions?user_id=eq.${userId}&${guard}`, {
        method: 'PATCH',
        headers: this.restHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(body),
      })
    } catch {
      return { applied: false }
    }
    if (response.status === 400) {
      // Pre-migration (no last_event_at column): apply unordered so the webhook
      // still functions. The ordering guard activates once the migration runs.
      await this.upsertSubscription(userId, fields)
      return { applied: true, ordered: false }
    }
    if (!response.ok) return { applied: false }
    const rows = await response.json().catch(() => [])
    return { applied: Array.isArray(rows) && rows.length > 0 }
  }

  /** Every row currently marked pro, for reconciliation against the provider. */
  async listProSubscriptions() {
    if (!this.canManage) return []
    let response
    try {
      response = await fetch(
        `${this.restUrl}/subscriptions?plan=eq.pro&select=user_id,status,current_period_end,provider_subscription_id`,
        { headers: this.restHeaders() },
      )
    } catch {
      return []
    }
    if (!response.ok) return []
    return (await response.json().catch(() => [])) ?? []
  }

  /** Resolve the owning user for a provider subscription id (webhook fallback). */
  async findUserByProviderSubscriptionId(subscriptionId) {
    if (!this.canManage || !subscriptionId) return null
    let response
    try {
      response = await fetch(
        `${this.restUrl}/subscriptions?provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=user_id`,
        { headers: this.restHeaders() },
      )
    } catch {
      return null
    }
    if (!response.ok) return null
    const rows = await response.json().catch(() => null)
    return rows?.[0]?.user_id ?? null
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

  // --- app settings (admin-tuned, app-wide) ----------------------------------
  // Stored as a single JSONB row (key='app') in public.app_settings. If the
  // table is not present yet, reads return null and writes report it clearly so
  // the admin console can tell the user to run the migration.

  /**
   * Read the settings blob. Returns { present, value } where `present` means the
   * app_settings table exists and is reachable (a durable store) — independent of
   * whether a row has been written yet. `value` is the stored blob or null.
   */
  async getAppSettings() {
    if (!this.canManage) return { present: false, value: null }
    let response
    try {
      response = await fetch(
        `${this.restUrl}/app_settings?key=eq.app&select=value`,
        { headers: this.restHeaders() },
      )
    } catch {
      return { present: false, value: null }
    }
    // A 200 (even with an empty array) proves the table is there; a 404/40x means
    // it hasn't been created, so the caller should treat storage as unavailable.
    if (!response.ok) return { present: false, value: null }
    const rows = await response.json().catch(() => null)
    return { present: true, value: rows?.[0]?.value ?? null }
  }

  /** Persist the settings blob. Throws (502) if the table isn't there yet. */
  async saveAppSettings(value) {
    if (!this.canManage) {
      throw new HttpError('This server cannot store settings (missing service role key).', 503)
    }
    const response = await fetch(`${this.restUrl}/app_settings`, {
      method: 'POST',
      headers: this.restHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ key: 'app', value, updated_at: new Date().toISOString() }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new HttpError(`Could not save settings. Run the app_settings migration in Supabase.${detail ? ` ${detail}` : ''}`, 502)
    }
  }

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
