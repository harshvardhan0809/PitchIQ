import { createHmac, timingSafeEqual } from 'node:crypto'

import { HttpError } from '../http.js'

/**
 * Razorpay Subscriptions client — the real billing seam behind the Pro upgrade.
 *
 * Dependency-free: it calls Razorpay's REST API with Basic auth (key id + key
 * secret) via fetch, and verifies webhook signatures with Node's built-in
 * crypto. The price and currency live in the Razorpay *Plan* (created in the
 * dashboard); this code only references a plan id, so switching or adding a
 * currency never touches the code.
 *
 * Flow:
 *   1. subscribe  → create a subscription for the signed-in user, tagged with
 *      their userId in `notes`, and hand the id to Razorpay Checkout.
 *   2. webhook    → Razorpay calls back on activation/charge/cancel; the handler
 *      verifies the signature and flips the user's plan. The webhook — never the
 *      browser — is the source of truth for entitlement.
 */
const API_BASE = 'https://api.razorpay.com/v1'

// Which subscription states mean the user should have Pro, and which revoke it.
const ACTIVATING_EVENTS = new Set(['subscription.activated', 'subscription.charged', 'subscription.resumed'])
const REVOKING_EVENTS = new Set([
  'subscription.cancelled', 'subscription.halted', 'subscription.completed',
  'subscription.expired', 'subscription.paused',
])

// Subscription *statuses* (from the Subscriptions API) that mean the mandate is
// authorized and the user should hold Pro. Checked when confirming a checkout
// directly, so entitlement doesn't have to wait on a webhook (which can't reach
// localhost, and needs dashboard setup in production).
const ACTIVE_STATUSES = new Set(['authenticated', 'active', 'charged', 'resumed'])

export class RazorpayClient {
  constructor({ keyId, keySecret, webhookSecret, planId } = {}) {
    this.keyId = keyId ?? ''
    this.keySecret = keySecret ?? ''
    this.webhookSecret = webhookSecret ?? ''
    this.planId = planId ?? ''
  }

  /** Enough config to create subscriptions and drive checkout. */
  get configured() {
    return Boolean(this.keyId && this.keySecret && this.planId)
  }

  /** Enough config to trust incoming webhooks. */
  get webhookReady() {
    return Boolean(this.webhookSecret)
  }

  get authHeader() {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`
  }

  /**
   * Create a subscription for a user. `notes.userId` is what the webhook reads
   * to know whose plan to flip, so it must always be set.
   */
  async createSubscription({ userId, email, totalCount = 120 }) {
    if (!this.configured) throw new HttpError('Billing is not configured on this server.', 503)
    if (!userId) throw new HttpError('A user is required to start a subscription.', 400)

    let response
    try {
      response = await fetch(`${API_BASE}/subscriptions`, {
        method: 'POST',
        headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: this.planId,
          total_count: totalCount, // billing cycles; renews until cancelled
          quantity: 1,
          customer_notify: 1,
          notes: { userId, email: email ?? '' },
        }),
      })
    } catch {
      throw new HttpError('Could not reach the payment provider.', 502)
    }

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const message = body?.error?.description ?? 'Could not start the subscription.'
      throw new HttpError(message, response.status >= 500 ? 502 : 400)
    }
    return body // { id, status, short_url, ... }
  }

  /** Fetch a subscription's current state from Razorpay (server-to-server). */
  async getSubscription(subscriptionId) {
    if (!this.configured) throw new HttpError('Billing is not configured on this server.', 503)
    if (!subscriptionId) throw new HttpError('A subscription id is required.', 400)
    let response
    try {
      response = await fetch(`${API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        headers: { Authorization: this.authHeader },
      })
    } catch {
      throw new HttpError('Could not reach the payment provider.', 502)
    }
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const message = body?.error?.description ?? 'Could not look up the subscription.'
      throw new HttpError(message, response.status >= 500 ? 502 : 400)
    }
    return body // { id, status, notes, ... }
  }

  /** Whether a subscription status means the user should currently hold Pro. */
  isActiveStatus(status) {
    return ACTIVE_STATUSES.has(String(status ?? '').toLowerCase())
  }

  /**
   * Verify the signature Checkout returns to the browser on a successful
   * subscription authorization. For subscriptions Razorpay signs
   * `payment_id|subscription_id` with the key secret. A valid signature proves
   * the payment is genuine, so Pro can be granted instantly — no webhook needed.
   */
  verifySubscriptionPayment({ paymentId, subscriptionId, signature }) {
    if (!this.configured || !paymentId || !subscriptionId || !signature) return false
    const expected = createHmac('sha256', this.keySecret).update(`${paymentId}|${subscriptionId}`).digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(String(signature), 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /**
   * Verify a webhook came from Razorpay: HMAC-SHA256 of the raw body with the
   * webhook secret must equal the X-Razorpay-Signature header. Constant-time
   * compare so a mismatch can't be timed.
   */
  verifyWebhook(rawBody, signature) {
    if (!this.webhookReady || !signature) return false
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(String(signature), 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /**
   * Interpret a verified webhook payload into an entitlement decision:
   * { userId, plan } to apply, or null if the event is not one we act on.
   */
  planChangeFor(event) {
    const type = event?.event
    const subscription = event?.payload?.subscription?.entity
    const userId = subscription?.notes?.userId
    if (!type || !userId) return null
    if (ACTIVATING_EVENTS.has(type)) return { userId, plan: 'pro' }
    if (REVOKING_EVENTS.has(type)) return { userId, plan: 'free' }
    return null
  }
}
