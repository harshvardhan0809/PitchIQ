import { Link } from 'react-router-dom'
import { MarketingNav, MarketingFooter } from '../components/MarketingNav'
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
            <div className="mock-card">
              <p className="mock-tag">★ Top armband · Gameweek 1</p>
              <div className="mock-player">
                <span className="mock-face">EH</span>
                <div>
                  <strong>Erling Haaland</strong>
                  <span>Man City · FWD · £15.0</span>
                </div>
              </div>
              <div className="mock-scores">
                <div className="mock-score"><div className="v">6.8</div><div className="l">xPts</div></div>
                <div className="mock-score"><div className="v">92%</div><div className="l">Confidence</div></div>
                <div className="mock-score"><div className="v">9.1</div><div className="l">Captain score</div></div>
              </div>
              <ul className="mock-reasons">
                <li>Home vs Bournemouth — favourable fixture (2/5)</li>
                <li>0.94 expected goal involvements per 90</li>
                <li>Nailed starter — 33 starts last season</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mkt-section">
          <div className="mkt-section-head">
            <p className="mkt-kicker">What you get</p>
            <h2>Answers, not spreadsheets</h2>
            <p>Every screen answers one question: what should I do with my team this week?</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <div className="feature" key={feature.title}>
                <div className="feature-ic" aria-hidden="true">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                {!feature.live && <span className="soon">Coming soon</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="mkt-section">
          <div className="mkt-section-head">
            <p className="mkt-kicker">How it works</p>
            <h2>From data to decision in three steps</h2>
          </div>
          <div className="steps">
            {STEPS.map((step, index) => (
              <div className="step" key={step.title}>
                <div className="step-n">0{index + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mkt-section">
          <div className="cta-band">
            <h2>Win your league this season</h2>
            <p>Start free in seconds. Upgrade to Pro when you want the full edge.</p>
            <div className="hero-cta" style={{ justifyContent: 'center' }}>
              <Link className="mkt-btn mkt-btn-primary" to="/login?mode=signup">Create free account</Link>
              <Link className="mkt-btn mkt-btn-ghost" to="/pricing">See plans</Link>
            </div>
          </div>
        </section>

        <MarketingFooter />
      </div>
    </div>
  )
}
