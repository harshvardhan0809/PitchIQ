import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../lib/auth'
import { useAppConfig } from '../lib/appConfigContext'

/**
 * A Pro upsell "ad" for free users. Its timing and copy are admin-tuned (see the
 * admin console → Ads): it first appears after `firstDelaySec`, then repeats on a
 * random gap between `minIntervalSec` and `maxIntervalSec`. Pro users never see
 * it; the moment a user upgrades it disappears. Dismissing it resets the timer.
 *
 * Mounted inside the product page, so it only runs while someone is using the app.
 */
const SEEN_KEY = 'pitchiq-pro-ad-seen'

const PERKS = [
  'Full Captain AI board — every pick ranked, not just one',
  'Differentials, Price Watch risers & the Weekly Briefing',
  'Your team analysed: the transfers that raise your score',
  'Mini-League War Room — spy on your rivals’ captains',
]

export function ProUpsell() {
  const { plan, signedIn } = useAuth()
  const { ads } = useAppConfig()
  const eligible = signedIn && plan === 'free' && ads.enabled
  const [open, setOpen] = useState(false)
  const timerRef = useRef(null)

  // A fresh gap in the admin-set [min, max] window each time, so it never feels
  // metronomic. Kept in a ref-free closure keyed off the current config values.
  const firstDelayMs = Math.max(0, ads.firstDelaySec) * 1000
  const minGapMs = Math.max(1, ads.minIntervalSec) * 1000
  const spanMs = Math.max(0, ads.maxIntervalSec - ads.minIntervalSec) * 1000

  useEffect(() => {
    if (!eligible) return undefined
    const nextGapMs = () => minGapMs + Math.floor(Math.random() * (spanMs + 1))
    // First open of the session waits `firstDelaySec`; later mounts wait a full
    // interval so navigating around the app doesn't re-trigger the first pop.
    let seen = false
    try { seen = Boolean(window.sessionStorage.getItem(SEEN_KEY)) } catch { /* private mode */ }
    timerRef.current = window.setTimeout(() => setOpen(true), seen ? nextGapMs() : firstDelayMs)
    return () => window.clearTimeout(timerRef.current)
  }, [eligible, firstDelayMs, minGapMs, spanMs])

  const dismiss = useCallback(() => {
    setOpen(false)
    try { window.sessionStorage.setItem(SEEN_KEY, '1') } catch { /* private mode */ }
    window.clearTimeout(timerRef.current)
    const gap = minGapMs + Math.floor(Math.random() * (spanMs + 1))
    timerRef.current = window.setTimeout(() => setOpen(true), gap)
  }, [minGapMs, spanMs])

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

        <span className="pro-ad-badge">OptiXI Pro</span>
        <h3 id="pro-ad-title" className="pro-ad-title">{ads.headline}</h3>
        <p className="pro-ad-sub">{ads.subtext}</p>

        <ul className="pro-ad-perks">
          {PERKS.map((perk) => <li key={perk}>{perk}</li>)}
        </ul>

        <div className="pro-ad-cta">
          <Link className="pro-ad-btn" to="/pricing" onClick={dismiss}>{ads.ctaLabel}</Link>
          <button type="button" className="pro-ad-later" onClick={dismiss}>Maybe later</button>
        </div>
        <p className="pro-ad-note">From ₹399/mo · cancel anytime</p>
      </div>
    </div>
  )
}
