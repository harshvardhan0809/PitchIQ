import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MarketingNav, MarketingFooter } from '../components/MarketingNav'
import { useAuth, refreshSession, getPlan } from '../lib/auth'
import { planMeets } from '../lib/plan'
import { createSubscription, openCheckout, confirmSubscription } from '../services/billingApi'
import '../styles/marketing.css'

const TIERS = [
  {
    id: 'free', name: 'Free', price: 0,
    desc: 'Follow the season and try the engine.',
    features: [
      { text: 'Live matchday & fixtures', on: true },
      { text: 'Players to watch', on: true },
      { text: 'Player reports & form', on: true },
      { text: 'Top captain pick', on: true },
      { text: 'Full captain board', on: false },
      { text: 'Transfers & differentials', on: false },
    ],
  },
  {
    id: 'pro', name: 'Pro', price: 5, featured: true,
    desc: 'Every feature, every gameweek. One simple upgrade.',
    features: [
      { text: 'Everything in Free', on: true },
      { text: 'Full ranked captain board', on: true },
      { text: 'AI transfer advisor', on: true },
      { text: 'Differential finder', on: true },
      { text: 'My Team squad analyzer', on: true },
      { text: 'Predicted points & price radar', on: true },
      { text: 'Weekly briefing & everything we add', on: true },
    ],
  },
]

// After checkout the plan is flipped by the webhook, which can lag a moment.
// Refresh the session a few times until Pro shows, then continue.
async function waitForPro(attempts = 6, delayMs = 1500) {
  for (let index = 0; index < attempts; index += 1) {
    if (getPlan() !== 'free') return true
    await refreshSession()
    if (getPlan() !== 'free') return true
    await new Promise((resolve) => { setTimeout(resolve, delayMs) })
  }
  return getPlan() !== 'free'
}

export function PricingPage() {
  const { plan, signedIn, user } = useAuth()
  const navigate = useNavigate()
  const [busyTier, setBusyTier] = useState(null)
  const [flow, setFlow] = useState(null) // { tone, text }

  async function startCheckout(tier) {
    setBusyTier(tier.id)
    setFlow(null)
    try {
      const subscription = await createSubscription()
      if (subscription.alreadyPro) { navigate('/app'); return }
      const checkout = await openCheckout({
        subscriptionId: subscription.subscriptionId,
        keyId: subscription.keyId,
        email: user?.email,
      })
      setFlow({ tone: 'good', text: 'Payment received — activating your Pro access…' })
      // Confirm directly with Razorpay so activation doesn't depend on the webhook
      // reaching this server (it can't on localhost). The signed Checkout payload
      // lets the server grant Pro instantly; refresh the session to pick it up.
      try {
        const result = await confirmSubscription({
          subscriptionId: subscription.subscriptionId,
          paymentId: checkout?.paymentId,
          signature: checkout?.signature,
        })
        if (result?.activated) {
          await refreshSession()
          if (getPlan() !== 'free') { navigate('/app'); return }
        }
      } catch { /* fall back to webhook + polling below */ }
      const activated = await waitForPro()
      if (!activated) {
        setFlow({ tone: 'bad', text: 'Payment went through, but activation is still pending. Make sure the API server is running the latest build, then refresh — or contact support if it persists.' })
        return
      }
      navigate('/app')
    } catch (error) {
      // Billing not live yet → let them know rather than failing silently.
      if (error.status === 503) {
        setFlow({ tone: 'bad', text: 'Checkout is being set up — please try again shortly.' })
        return
      }
      // A user closing the payment window is not an error worth shouting about.
      if (error.message && !/closed/i.test(error.message)) {
        setFlow({ tone: 'bad', text: error.message })
      }
    } finally {
      setBusyTier(null)
    }
  }

  function handleCta(tier) {
    if (tier.id === 'free') { navigate('/app'); return }
    if (!signedIn) { navigate(`/login?next=/pricing`); return }
    if (planMeets(plan, tier.id)) { navigate('/app'); return }
    startCheckout(tier)
  }

  function ctaLabel(tier) {
    if (busyTier === tier.id) return 'Opening checkout…'
    if (tier.id === 'free') return 'Open app'
    if (signedIn && plan === tier.id) return 'Current plan'
    if (signedIn && planMeets(plan, tier.id)) return 'Included'
    return signedIn ? `Get ${tier.name}` : `Start ${tier.name}`
  }

  return (
    <div className="mkt">
      <div className="mkt-wrap">
        <MarketingNav />

        <section className="mkt-section" style={{ paddingTop: '32px' }}>
          <div className="mkt-section-head">
            <p className="mkt-kicker">Pricing</p>
            <h2>Simple plans. Real advantage.</h2>
            <p>Start free. Upgrade when you want the full decision engine. Cancel anytime.</p>
          </div>

          <div className="price-grid">
            {TIERS.map((tier) => {
              const current = signedIn && plan === tier.id
              return (
                <div className={`price-card ${tier.featured ? 'featured' : ''}`} key={tier.id}>
                  {tier.featured && <span className="price-badge">Most popular</span>}
                  <p className="price-name">{tier.name}</p>
                  <div className="price-tag">
                    <span className="amt">£{tier.price}</span>
                    <span className="per">{tier.price === 0 ? 'forever' : '/ month'}</span>
                  </div>
                  <p className="price-desc">{tier.desc}</p>
                  <ul className="price-features">
                    {tier.features.map((feature) => (
                      <li className={feature.on ? '' : 'off'} key={feature.text}>{feature.text}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={`mkt-btn price-cta ${tier.featured ? 'mkt-btn-primary' : 'mkt-btn-ghost'}`}
                    disabled={current || busyTier === tier.id}
                    onClick={() => handleCta(tier)}
                  >
                    {ctaLabel(tier)}
                  </button>
                </div>
              )
            })}
          </div>

          {flow && <p className={`auth-msg ${flow.tone}`} style={{ textAlign: 'center', marginTop: '18px' }}>{flow.text}</p>}
        </section>

        <MarketingFooter />
      </div>
    </div>
  )
}
