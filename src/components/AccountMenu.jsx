import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, PLAN_NAMES } from '../lib/auth'

/**
 * Account control for the app top bar. The app requires sign-in, so this is
 * reached only by authenticated users — it shows the account, the plan, an
 * upgrade path, and sign-out. All actual authentication happens on /login.
 */
export function AccountMenu() {
  const { user, plan, signedIn, signOut } = useAuth()

  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const isPremium = plan !== 'free'

  useEffect(() => {
    const openMe = () => setOpen(true)
    window.addEventListener('pitchiq-open-account', openMe)
    return () => window.removeEventListener('pitchiq-open-account', openMe)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onClick = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!signedIn) {
    return <Link className="acct-trigger" to="/login">Sign in</Link>
  }

  return (
    <div className="acct" ref={ref}>
      <button type="button" className={`acct-trigger plan-${plan}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`acct-dot ${isPremium ? 'premium' : ''}`} aria-hidden="true" />
        <span className="acct-name">{user.email}</span>
        <span className={`acct-plan ${isPremium ? 'premium' : ''}`}>{PLAN_NAMES[plan]}</span>
      </button>

      {open && (
        <div className="acct-pop" role="dialog" aria-label="Account">
          <p className="acct-head">Signed in as <b>{user.email}</b></p>
          <p className="acct-planline">Plan: <b>{PLAN_NAMES[plan]}</b></p>

          {isPremium ? (
            <p className="acct-note">You have full access to premium intelligence.</p>
          ) : (
            <Link className="acct-primary acct-upgrade" to="/pricing" onClick={() => setOpen(false)}>
              Upgrade to Pro →
            </Link>
          )}

          <button type="button" className="acct-signout" onClick={() => signOut().then(() => setOpen(false))}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
