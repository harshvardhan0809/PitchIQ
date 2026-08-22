import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { MockCaptainCard } from '../components/MockCaptainCard'
import '../styles/marketing.css'

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/app'

  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  // Already signed in? Go straight to the app.
  useEffect(() => {
    if (auth.signedIn) navigate(next, { replace: true })
  }, [auth.signedIn, navigate, next])

  async function run(action, { redirect = true } = {}) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await action()
      if (result?.needsConfirmation) {
        setMessage({ tone: 'good', text: 'Account created — check your email to confirm, then sign in.' })
      } else if (result?.magicLinkSent) {
        setMessage({ tone: 'good', text: 'Magic link sent. Check your email to finish signing in.' })
      } else if (result?.resetSent) {
        setMessage({ tone: 'good', text: 'If that email has an account, a password-reset link is on its way.' })
      } else if (redirect) {
        navigate(next, { replace: true })
      }
    } catch (error) {
      setMessage({ tone: 'bad', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  function submit(event) {
    event.preventDefault()
    run(() => (mode === 'signup'
      ? auth.signUp(email, password)
      : auth.signInWithPassword(email, password)))
  }

  return (
    <div className="mkt">
      <div className="auth-shell auth-split">
        <aside className="auth-aside">
          <Link className="mkt-brand auth-aside-brand" to="/">
            <img className="mkt-mark" src="/OptiXI.png" alt="" width="34" height="34" />
            <strong>OptiXI</strong>
          </Link>
          <h2 className="auth-aside-title">
            Stop guessing. <span className="grad">Win your mini-league.</span>
          </h2>
          <p className="auth-aside-sub">
            The FPL decision engine — who to captain, who to buy, who to bench, with the reasoning behind every call.
          </p>
          <div className="hero-visual">
            <MockCaptainCard animate />
          </div>
          <ul className="auth-points">
            <li>Free forever plan — no card required</li>
            <li>AI captain picks, differentials &amp; price radar</li>
            <li>Your team, analysed before every deadline</li>
          </ul>
        </aside>

        <div className="auth-card">
          <Link className="auth-brand" to="/">
            <img className="mkt-mark" src="/OptiXI.png" alt="" width="34" height="34" />
            <strong>OptiXI</strong>
          </Link>

          <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth-sub">
            {mode === 'signup' ? 'Start free — no card required.' : 'Sign in to your OptiXI account.'}
          </p>

          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" data-active={mode === 'signin'} onClick={() => { setMode('signin'); setMessage(null) }}>
              Sign in
            </button>
            <button type="button" role="tab" data-active={mode === 'signup'} onClick={() => { setMode('signup'); setMessage(null) }}>
              Create account
            </button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} autoComplete="email" required
                placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
            </div>

            {auth.configured && (
              <div className="auth-field">
                <div className="auth-field-top">
                  <label htmlFor="password">Password</label>
                  {mode === 'signin' && (
                    <button type="button" className="auth-forgot" disabled={busy}
                      onClick={() => run(() => auth.sendPasswordReset(email), { redirect: false })}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <input id="password" type="password" value={password}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                  onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}

            <button type="submit" className="mkt-btn mkt-btn-primary auth-submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {auth.configured ? (
            <div className="auth-alt">
              <button type="button" className="auth-link" disabled={busy}
                onClick={() => run(() => auth.signInWithMagicLink(email), { redirect: false })}>
                Email me a magic link instead
              </button>
              <div className="auth-divider">or</div>
              <button type="button" className="mkt-btn mkt-btn-ghost auth-oauth" disabled={busy}
                onClick={() => run(auth.signInWithGoogle, { redirect: false })}>
                Continue with Google
              </button>
            </div>
          ) : (
            <p className="auth-foot">
              Demo mode — set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> for real accounts.
            </p>
          )}

          {message && <p className={`auth-msg ${message.tone}`}>{message.text}</p>}

          <p className="auth-foot">
            <Link to="/">← Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
