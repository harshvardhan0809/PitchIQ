import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/** Shared top nav for the marketing pages (landing, pricing). */
export function MarketingNav() {
  const { signedIn } = useAuth()
  return (
    <nav className="mkt-nav">
      <Link className="mkt-brand" to="/">
        <img className="mkt-mark" src="/OptiXI.png" alt="" width="34" height="34" />
        <strong>OptiXI</strong>
      </Link>
      <div className="mkt-nav-links">
        <Link to="/pricing">Pricing</Link>
        <Link to="/app">Matchday</Link>
        {signedIn ? (
          <Link className="mkt-btn mkt-btn-primary mkt-btn-sm" to="/app">Open app</Link>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link className="mkt-btn mkt-btn-primary mkt-btn-sm" to="/login?mode=signup">Start free</Link>
          </>
        )}
      </div>
    </nav>
  )
}

export function MarketingFooter() {
  return (
    <footer className="mkt-footer">
      <span>© {new Date().getFullYear()} OptiXI · Fantasy football intelligence</span>
      <span>
        <Link to="/pricing">Pricing</Link> · <Link to="/login">Log in</Link> · <Link to="/app">Open app</Link>
      </span>
    </footer>
  )
}
