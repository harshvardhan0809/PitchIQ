import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MarketingNav, MarketingFooter } from '../components/MarketingNav'
import { useAuth, PLAN_NAMES } from '../lib/auth'
import { planMeets } from '../lib/plan'
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
    desc: 'The full edge, every gameweek.',
    features: [
      { text: 'Everything in Free', on: true },
      { text: 'Full ranked captain board', on: true },
      { text: 'AI transfer advisor', on: true },
      { text: 'Differential finder', on: true },
      { text: 'Predicted points & price radar', on: true },
      { text: 'Weekly briefing', on: true },
    ],
  },
  {
    id: 'elite', name: 'Elite', price: 12,
    desc: 'For managers who plan ahead.',
    features: [
      { text: 'Everything in Pro', on: true },
      { text: 'Team analyzer & score', on: true },
      { text: 'Wildcard planner', on: true },
      { text: 'Chip strategy', on: true },
      { text: 'Team optimizer', on: true },
      { text: 'Priority updates', on: true },
    ],
  },
]

function CheckoutModal({ tier, onClose }) {
  const { redeemCode } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setMessage(null)
    try {
      const result = await redeemCode(code)
      if (result.upgraded) {
        setMessage({ tone: 'good', text: `You're on ${PLAN_NAMES[result.plan]}! Redirecting…` })
        setTimeout(() => navigate('/app'), 900)
      } else if (result.alreadyEntitled) {
        setMessage({ tone: 'good', text: 'Your current plan already includes this.' })
      } else {
        setMessage({ tone: 'bad', text: 'That access code was not recognised.' })
      }
    } catch (error) {
      setMessage({ tone: 'bad', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Checkout" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Upgrade to {tier.name}</h3>
        <p className="modal-sub">Activate {tier.name} on your account.</p>
        <div className="modal-summary">
          <span className="plan">PitchIQ {tier.name}</span>
          <span className="amt">£{tier.price}/mo</span>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-field">
            <label htmlFor="checkout-code">Access code</label>
            <input id="checkout-code" value={code} autoComplete="off" placeholder="Try PITCHIQ-PRO"
              onChange={(e) => setCode(e.target.value)} />
          </div>
          <button type="submit" className="mkt-btn mkt-btn-primary auth-submit" disabled={busy}>
            {busy ? 'Activating…' : `Activate ${tier.name}`}
          </button>
        </form>
        {message && <p className={`auth-msg ${message.tone}`}>{message.text}</p>}
        <p className="modal-note">
          Card checkout arrives with Stripe. For now, an access code activates your plan —
          it writes the entitlement to your account, exactly as a real payment will.
        </p>
        <button type="button" className="modal-close" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

export function PricingPage() {
  const { plan, signedIn } = useAuth()
  const navigate = useNavigate()
  const [checkout, setCheckout] = useState(null)

  function handleCta(tier) {
    if (tier.id === 'free') { navigate('/app'); return }
    if (!signedIn) { navigate(`/login?next=/pricing`); return }
    if (planMeets(plan, tier.id)) { navigate('/app'); return }
    setCheckout(tier)
  }

  function ctaLabel(tier) {
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
                    disabled={current}
                    onClick={() => handleCta(tier)}
                  >
                    {ctaLabel(tier)}
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <MarketingFooter />
      </div>

      {checkout && <CheckoutModal tier={checkout} onClose={() => setCheckout(null)} />}
    </div>
  )
}
