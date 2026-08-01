import { Link } from 'react-router-dom'
import { MarketingNav, MarketingFooter } from '../components/MarketingNav'
import { MockCaptainCard } from '../components/MockCaptainCard'
import { Reveal } from '../components/Reveal'
import '../styles/marketing.css'

const FEATURES = [
  { icon: '🧠', title: 'AI Captain Picks', body: 'Every captain candidate ranked by projected points and ceiling — with the fixture, form and minutes reasoning behind each call.', live: true },
  { icon: '🔁', title: 'Transfer Advisor', body: 'Who to buy and sell, scored on expected points, fixture swing and price risk. Immediate gains and long-term value.', live: false },
  { icon: '💎', title: 'Differentials', body: 'Low-owned players our model rates highly — the picks that win mini-leagues when they hit.', live: false },
  { icon: '📅', title: 'Weekly Briefing', body: 'A plain-English gameweek plan: captain, transfers to make, who to bench, and the differential to watch.', live: false },
  { icon: '📈', title: 'Predicted Points', body: 'A transparent projection for every player, updated before each deadline — the engine everything else is built on.', live: false },
  { icon: '💰', title: 'Price-Rise Radar', body: 'Get ahead of the market: which players are about to rise or fall in price, so you transfer at the right time.', live: false },
]

const STEPS = [
  { title: 'Follow the matchday', body: 'Live fixtures, form and the players to watch across the top five leagues — free, no account needed.' },
  { title: 'Ask the engine', body: 'Open Captain AI for a ranked board of who to captain, with the reasoning and a confidence score for each.' },
  { title: 'Make your move', body: 'Go Pro to unlock the full board, transfers, differentials and a weekly plan built around your team.' },
]

export function LandingPage() {
  return (
    <div className="mkt">
      <div className="mkt-wrap">
        <MarketingNav />

        <section className="hero">
          <div>
            <span className="hero-eyebrow"><span className="dot" />The FPL decision engine</span>
            <h1>Stop guessing. <span className="grad">Start winning your mini-league.</span></h1>
            <p className="hero-sub">
              PitchIQ turns fantasy football data into decisions — who to captain, who to buy,
              who to bench — with the reasoning behind every call. Not another stats site.
            </p>
            <div className="hero-cta">
              <Link className="mkt-btn mkt-btn-primary" to="/login?mode=signup">Start free →</Link>
              <Link className="mkt-btn mkt-btn-ghost" to="/app">See it live</Link>
            </div>
            <p className="hero-note">Free forever plan · No card required · Premier League intelligence</p>
          </div>

          <div className="hero-visual">
            <MockCaptainCard animate />
          </div>
        </section>

        <section className="mkt-section">
          <Reveal className="mkt-section-head">
            <p className="mkt-kicker">What you get</p>
            <h2>Answers, not spreadsheets</h2>
            <p>Every screen answers one question: what should I do with my team this week?</p>
          </Reveal>
          <div className="feature-grid">
            {FEATURES.map((feature, index) => (
              <Reveal className="feature" key={feature.title} delay={index * 70}>
                <div className="feature-ic" aria-hidden="true">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                {!feature.live && <span className="soon">Coming soon</span>}
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mkt-section">
          <Reveal className="mkt-section-head">
            <p className="mkt-kicker">How it works</p>
            <h2>From data to decision in three steps</h2>
          </Reveal>
          <div className="steps">
            {STEPS.map((step, index) => (
              <Reveal className="step" key={step.title} delay={index * 90}>
                <div className="step-n">0{index + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mkt-section">
          <Reveal className="cta-band">
            <h2>Win your league this season</h2>
            <p>Start free in seconds. Upgrade to Pro when you want the full edge.</p>
            <div className="hero-cta" style={{ justifyContent: 'center' }}>
              <Link className="mkt-btn mkt-btn-primary" to="/login?mode=signup">Create free account</Link>
              <Link className="mkt-btn mkt-btn-ghost" to="/pricing">See plans</Link>
            </div>
          </Reveal>
        </section>

        <MarketingFooter />
      </div>
    </div>
  )
}
