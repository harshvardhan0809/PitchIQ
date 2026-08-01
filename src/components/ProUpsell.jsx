import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../lib/auth'

/**
 * A Pro upsell "ad" for free users. It appears ~10 seconds after they open the
 * app, then again every 7–8 minutes while they browse. Pro users never see it;
 * the moment a user upgrades it disappears. Dismissing it just resets the timer.
 *
 * Mounted inside the product page, so it only runs while someone is using the app.
 */
const FIRST_DELAY_MS = 10_000
const SEEN_KEY = 'pitchiq-pro-ad-seen'
// A fresh 7–8 minute gap each time, so it doesn't feel metronomic.
const nextGapMs = () => 420_000 + Math.floor(Math.random() * 60_000)

const PERKS = [
  'Full Captain AI board — every pick ranked, not just one',
  'Differentials, Price Watch risers & the Weekly Briefing',
  'Your team analysed: the transfers that raise your score',
  'Mini-League War Room — spy on your rivals’ captains',
]

export function ProUpsell() {
  const { plan, signedIn } = useAuth()
  const eligible = signedIn && plan === 'free'
  const [open, setOpen] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!eligible) return undefined
    // First open of the session waits 10s; later mounts wait a full interval so
    // navigating around the app doesn't re-trigger the 10s pop each time.
    let seen = false
    try { seen = Boolean(window.sessionStorage.getItem(SEEN_KEY)) } catch { /* private mode */ }
    timerRef.current = window.setTimeout(() => setOpen(true), seen ? nextGapMs() : FIRST_DELAY_MS)
    return () => window.clearTimeout(timerRef.current)
  }, [eligible])

  const dismiss = useCallback(() => {
    setOpen(false)
    try { window.sessionStorage.setItem(SEEN_KEY, '1') } catch { /* private mode */ }
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setOpen(true), nextGapMs())
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (!eligible || !open) return null

  return (
    <div
      className="pro-ad-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-ad-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss() }}
    >
      <div className="pro-ad">
        <button className="pro-ad-close" type="button" onClick={dismiss} aria-label="Dismiss">×</button>

        <span className="pro-ad-badge">PitchIQ Pro</span>
        <h3 id="pro-ad-title" className="pro-ad-title">You&apos;re seeing a fraction of the edge</h3>
        <p className="pro-ad-sub">
          Free gives you the matchday and a taste of each tool. Pro unlocks the whole engine —
          the calls that actually win your mini-league.
        </p>

        <ul className="pro-ad-perks">
          {PERKS.map((perk) => <li key={perk}>{perk}</li>)}
        </ul>

        <div className="pro-ad-cta">
          <Link className="pro-ad-btn" to="/pricing" onClick={dismiss}>Upgrade to Pro →</Link>
          <button type="button" className="pro-ad-later" onClick={dismiss}>Maybe later</button>
        </div>
        <p className="pro-ad-note">From ₹399/mo · cancel anytime</p>
      </div>
    </div>
  )
}
