import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../lib/auth'
import '../styles/marketing.css'

/**
 * Landing page for the password-reset email link. Supabase's detectSessionInUrl
 * turns the emailed recovery token into a temporary session, so a signed-in
 * state here means the link is valid and the user may set a new password.
 */
export function ResetPasswordPage() {
  const { ready, signedIn, configured, completePasswordReset } = useAuth()
  const navigate = useNavigate()

  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [done, setDone] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setMessage(null)
    if (next !== confirm) { setMessage({ tone: 'bad', text: 'The passwords do not match.' }); return }
    setBusy(true)
    try {
      await completePasswordReset(next)
      setDone(true)
      setMessage({ tone: 'good', text: 'Password updated. You can head into the app.' })
    } catch (error) {
      setMessage({ tone: 'bad', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  function body() {
    if (!configured) {
      return <p className="auth-sub">Password reset needs a live account (Supabase) and isn’t available in demo mode.</p>
    }
    if (done) {
      return (
        <>
          <p className="auth-msg good">Your password has been changed.</p>
          <button type="button" className="mkt-btn mkt-btn-primary auth-submit" onClick={() => navigate('/app', { replace: true })}>
            Continue to OptiXI →
          </button>
        </>
      )
    }
    if (!ready) {
      return <p className="auth-sub">Verifying your reset link…</p>
    }
    if (!signedIn) {
      return (
        <>
          <p className="auth-msg bad">This reset link is invalid or has expired.</p>
          <Link className="mkt-btn mkt-btn-ghost auth-submit" to="/login">Request a new link</Link>
        </>
      )
    }
    return (
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" required minLength={6}
            placeholder="At least 6 characters" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="auth-field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" required minLength={6}
            placeholder="Re-enter your new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button type="submit" className="mkt-btn mkt-btn-primary auth-submit" disabled={busy}>
          {busy ? 'Updating…' : 'Set new password'}
        </button>
      </form>
    )
  }

  return (
    <div className="mkt">
      <div className="auth-shell">
        <div className="auth-card">
          <Link className="auth-brand" to="/">
            <span className="mkt-mark">P</span>
            <strong>OptiXI</strong>
          </Link>

          <h1>Reset your password</h1>
          <p className="auth-sub">Choose a new password for your account.</p>

          {body()}

          {message && !done && <p className={`auth-msg ${message.tone}`}>{message.text}</p>}

          <p className="auth-foot">
            <Link to="/login">← Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
