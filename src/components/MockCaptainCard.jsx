import { useEffect, useState } from 'react'

/**
 * The brand's signature "captain card" mock, shared by the landing hero and the
 * login split so both surfaces read as one product. With `animate`, the score
 * values count up on mount for a touch of life (skipped under reduced-motion).
 */
const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function useCountUp(to, { duration = 1100, decimals = 0, enabled = true } = {}) {
  const animating = enabled && !prefersReducedMotion()
  // Start at the target when not animating, so no setState is needed up front.
  const [value, setValue] = useState(() => (animating ? 0 : to))

  useEffect(() => {
    if (!animating) return undefined
    let raf
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      setValue(to * (1 - Math.pow(1 - t, 3))) // easeOutCubic, driven by rAF (async)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, duration, animating])

  return value.toFixed(decimals)
}

function Score({ to, label, suffix = '', decimals = 0, animate }) {
  const value = useCountUp(to, { decimals, enabled: animate })
  return (
    <div className="mock-score">
      <div className="v">{value}{suffix}</div>
      <div className="l">{label}</div>
    </div>
  )
}

export function MockCaptainCard({ animate = false }) {
  return (
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
        <Score to={6.8} label="xPts" decimals={1} animate={animate} />
        <Score to={92} label="Confidence" suffix="%" animate={animate} />
        <Score to={9.1} label="Captain score" decimals={1} animate={animate} />
      </div>
      <ul className="mock-reasons">
        <li>Home vs Bournemouth — favourable fixture (2/5)</li>
        <li>0.94 expected goal involvements per 90</li>
        <li>Nailed starter — 33 starts last season</li>
      </ul>
    </div>
  )
}
