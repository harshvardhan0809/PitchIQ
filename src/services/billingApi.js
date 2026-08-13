import { getFreshAccessToken } from '../lib/auth'
import { ApiError, usesLiveData } from './footballApi'

/**
 * Billing client. It asks the server to create a Razorpay subscription, then
 * opens Razorpay Checkout so the user authorizes the mandate. It never grants
 * access itself — the server's webhook flips the plan to Pro after payment.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? ''
const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/** Ask the server to open a subscription for the signed-in user. */
export async function createSubscription() {
  if (!usesLiveData) throw new ApiError('Subscriptions need the live API server (npm run api).', 0)
  const token = await getFreshAccessToken()
  let response
  try {
    response = await fetch(`${API_BASE}/api/billing/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && token !== 'demo' ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    throw new ApiError('Could not reach the server. Make sure the API is running (npm run api).', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(body?.error ?? 'Could not start checkout.', response.status)
  return body
}

/**
 * Ask the server to confirm a completed checkout directly with Razorpay and
 * grant Pro if the mandate is active — no webhook round-trip needed. Returns
 * { activated, plan, status }. Safe to call even if the webhook also fires.
 */
export async function confirmSubscription(subscriptionId) {
  if (!usesLiveData) throw new ApiError('Subscriptions need the live API server (npm run api).', 0)
  const token = await getFreshAccessToken()
  let response
  try {
    response = await fetch(`${API_BASE}/api/billing/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && token !== 'demo' ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ subscriptionId }),
    })
  } catch {
    throw new ApiError('Could not reach the server to confirm your subscription.', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(body?.error ?? 'Could not confirm the subscription.', response.status)
  return body
}

// Load Razorpay Checkout once, lazily, and reuse it.
let checkoutPromise = null
function loadCheckout() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(window.Razorpay)
  if (checkoutPromise) return checkoutPromise
  checkoutPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.async = true
    script.onload = () => resolve(window.Razorpay)
    script.onerror = () => { checkoutPromise = null; reject(new ApiError('Could not load the payment window.', 0)) }
    document.body.appendChild(script)
  })
  return checkoutPromise
}

/**
 * Open Razorpay Checkout for a subscription. Resolves when the user completes
 * the authorization; entitlement itself is granted server-side by the webhook,
 * so the caller should then refresh the session to pick up the new plan.
 */
export async function openCheckout({ subscriptionId, keyId, email }) {
  const Razorpay = await loadCheckout()
  return new Promise((resolve, reject) => {
    const checkout = new Razorpay({
      key: keyId,
      subscription_id: subscriptionId,
      name: 'PitchIQ',
      description: 'PitchIQ Pro subscription',
      prefill: { email: email ?? '' },
      theme: { color: '#24d67f' },
      handler: () => resolve({ completed: true }),
      modal: { ondismiss: () => reject(new ApiError('Checkout closed before payment.', 0)) },
    })
    checkout.on('payment.failed', (event) => {
      reject(new ApiError(event?.error?.description ?? 'Payment failed. Please try again.', 0))
    })
    checkout.open()
  })
}
