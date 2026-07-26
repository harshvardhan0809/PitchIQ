import { useEffect, useRef, useState } from 'react'
import { useAuth, PLAN_NAMES } from '../lib/auth'

/**
 * Global account control for the top bar — visible on every page, so signing in
 * is always one click away. Backed by Supabase when configured, or a local demo
 * sign-in otherwise. Opens on the custom `pitchiq-open-account` event too, which
 * is how the premium upgrade prompt brings the user here.
 */
export function AccountMenu() {
  const auth = useAuth()
  const { user, plan, signedIn, configured } = auth

  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const ref = useRef(null)

  const isPremium = plan === 'pro' || plan === 'elite'

  // Open when another part of the app asks (e.g. the "Unlock Pro" CTA).
  useEffect(() => {
    const openMe = () => setOpen(true)
    window.addEventListener('pitchiq-open-account', openMe)
    return () => window.removeEventListener('pitchiq-open-account', openMe)
  }, [])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined
    const onClick = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function run(action) {
    setBusy(true); setMessage(null)
    try { return await action() } catch (error) { setMessage({ tone: 'bad', text: error.message }); return null } finally { setBusy(false) }
  }

  async function handlePassword(create) {
    const result = await run(() => (create ? auth.signUp(email, password) : auth.signInWithPassword(email, password)))
    if (result?.needsConfirmation) setMessage({ tone: 'good', text: 'Check your email to confirm, then sign in.' })
    else if (result && !configured) setOpen(false)
  }

  async function handleMagicLink() {
    const result = await run(() => auth.signInWithMagicLink(email))
    if (result?.magicLinkSent) setMessage({ tone: 'good', text: 'Magic link sent — check your email.' })
    else if (result && !configured) setOpen(false)
  }

  async function handleRedeem(event) {
    event.preventDefault()
    const result = await run(() => auth.redeemCode(code))
    if (result?.upgraded) { setCode(''); setMessage({ tone: 'good', text: `Upgraded to ${PLAN_NAMES[result.plan]}.` }) }
    else if (result?.alreadyEntitled) setMessage({ tone: 'good', text: 'Your plan already includes this.' })
    else if (result?.codeRejected) setMessage({ tone: 'bad', text: 'That access code was not recognised.' })
  }

  return (
    <div className="acct" ref={ref}>
      <button type="button" className="acct-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {signedIn ? (
          <>
            <span className={`acct-dot ${isPremium ? 'premium' : ''}`} aria-hidden="true" />
            <span className="acct-name">{user.email}</span>
            <span className={`acct-plan ${isPremium ? 'premium' : ''}`}>{PLAN_NAMES[plan]}</span>
          </>
        ) : (
          'Sign in'
        )}
      </button>

      {open && (
        <div className="acct-pop" role="dialog" aria-label="Account">
          {signedIn ? (
            <>
              <p className="acct-head">Signed in as <b>{user.email}</b></p>
              <p className="acct-planline">Plan: <b>{PLAN_NAMES[plan]}</b></p>
              {!isPremium && (
                <form className="acct-form" onSubmit={handleRedeem}>
                  <label htmlFor="acct-code">Have an access code?</label>
                  <input id="acct-code" value={code} autoComplete="off" placeholder="Try PITCHIQ-PRO"
                    onChange={(e) => setCode(e.target.value)} />
                  <button type="submit" className="acct-primary" disabled={busy}>{busy ? 'Checking…' : 'Unlock Pro'}</button>
                </form>
              )}
              <button type="button" className="acct-signout" onClick={() => run(auth.signOut).then(() => setOpen(false))}>
                Sign out
              </button>
            </>
          ) : (
            <div className="acct-form">
              <label htmlFor="acct-email">Email</label>
              <input id="acct-email" type="email" value={email} autoComplete="email" placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)} />

              {configured ? (
                <>
                  <label htmlFor="acct-password">Password</label>
                  <input id="acct-password" type="password" value={password} autoComplete="current-password" placeholder="••••••••"
                    onChange={(e) => setPassword(e.target.value)} />
                  <div className="acct-row">
                    <button type="button" className="acct-primary" disabled={busy} onClick={() => handlePassword(false)}>Sign in</button>
                    <button type="button" className="acct-secondary" disabled={busy} onClick={() => handlePassword(true)}>Create account</button>
                  </div>
                  <button type="button" className="acct-link" disabled={busy} onClick={handleMagicLink}>Email me a magic link</button>
                  <div className="acct-divider"><span>or</span></div>
                  <button type="button" className="acct-oauth" disabled={busy} onClick={() => run(auth.signInWithGoogle)}>Continue with Google</button>
                </>
              ) : (
                <>
                  <button type="button" className="acct-primary" disabled={busy} onClick={() => handlePassword(false)}>Continue</button>
                  <p className="acct-hint">Demo sign-in — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for real accounts.</p>
                </>
              )}
            </div>
          )}
          {message && <p className={`acct-msg ${message.tone}`}>{message.text}</p>}
        </div>
      )}
    </div>
  )
}
