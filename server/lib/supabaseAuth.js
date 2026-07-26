import { HttpError } from './http.js'

/**
 * Server-side Supabase identity + entitlement.
 *
 * Supabase owns login and issues the access token; this class is how the proxy
 * trusts it. A token is validated by asking Supabase who it belongs to
 * (`GET /auth/v1/user`), and the plan is read from that user's `app_metadata` —
 * a field only the service role can write, so a signed-in free user still can't
 * make themselves Pro. Validations are cached briefly (keyed by token) so a
 * burst of requests from one user doesn't hit Supabase every time.
 *
 * The plan is *written* with the service-role key when a user redeems a code
 * (the stand-in for Stripe). Swapping in Stripe later means changing only who
 * decides the plan, not this file's shape.
 */
const PLANS = new Set(['pro', 'elite'])
const normalizePlan = (value) => (PLANS.has(value) ? value : 'free')

export class SupabaseAuth {
  constructor({ url, anonKey, serviceKey, cache, ttlMs = 60 * 1000 } = {}) {
    this.url = (url ?? '').replace(/\/$/, '')
    this.anonKey = anonKey ?? ''
    this.serviceKey = serviceKey ?? ''
    this.cache = cache
    this.ttlMs = ttlMs
  }

  get configured() {
    return Boolean(this.url && this.anonKey)
  }

  get canManage() {
    return Boolean(this.url && this.serviceKey)
  }

  /** Validate a user access token → { id, email, plan } or null. */
  async getUser(token) {
    if (!this.configured || !token) return null

    return this.cache.resolve(`supabase:user:${token}`, this.ttlMs, async () => {
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
        plan: normalizePlan(user.app_metadata?.plan),
      }
    })
  }

  /** Drop a cached validation so a plan change is seen immediately. */
  forget(token) {
    if (token) this.cache.delete(`supabase:user:${token}`)
  }

  /** Write the plan onto a user via the admin API (service role required). */
  async setPlan(userId, plan) {
    if (!this.canManage) {
      throw new HttpError('This server is not configured to change plans (missing service role key).', 503)
    }
    let response
    try {
      response = await fetch(`${this.url}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.serviceKey}`,
          apikey: this.serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ app_metadata: { plan } }),
      })
    } catch {
      throw new HttpError('Could not reach the authentication service.', 502)
    }
    if (!response.ok) throw new HttpError('Could not update the plan.', 502)
    return response.json()
  }
}
