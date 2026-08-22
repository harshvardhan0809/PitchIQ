import { useEffect, useRef, useState } from 'react'

/**
 * ScrambleText — reveals a string by resolving randomised glyphs into the real
 * characters, left to right. A premium "computing" beat for a headline or a
 * feature title. Starts already scrambled (same length) so there's no layout
 * jump, then locks in over `duration`.
 *
 *   trigger: 'inview' (default) | 'mount'
 *   loop:    when true, holds the resolved text for `loopPause` ms, then
 *            re-scrambles and resolves again, forever — a "live status" beat.
 * Respects reduced-motion (renders the final text immediately) and keeps the
 * real text available to screen readers via aria-label.
 */
const GLYPHS = '!<>-_\\/[]{}=+*^?#§$%&'
const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const randGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0]
const scrambleAll = (text) => text.replace(/[^\s]/g, () => randGlyph())

export function ScrambleText({ text, as: Tag = 'span', className = '', duration = 900, delay = 0, trigger = 'inview', loop = false, loopPause = 1600 }) {
  const [display, setDisplay] = useState(() => (reduced() ? text : scrambleAll(text)))
  const ref = useRef(null)
  const started = useRef(false)

  useEffect(() => {
    if (reduced()) return undefined // initial state already holds the final text
    const el = ref.current
    const chars = [...text]
    let raf = 0
    let timer = 0
    let cancelled = false

    const animate = (startDelay) => {
      const start = performance.now() + startDelay
      const step = (now) => {
        if (cancelled) return
        const p = Math.max(0, Math.min(1, (now - start) / duration))
        const reveal = Math.floor(p * chars.length)
        let out = ''
        for (let i = 0; i < chars.length; i += 1) {
          if (/\s/.test(chars[i])) out += chars[i]
          else if (i < reveal) out += chars[i]
          else out += randGlyph()
        }
        setDisplay(out)
        if (p < 1) { raf = requestAnimationFrame(step); return }
        setDisplay(text)
        // Loop: hold the resolved text, then dissolve back into glyphs and run again.
        if (loop) timer = window.setTimeout(() => { if (!cancelled) animate(0) }, loopPause)
      }
      raf = requestAnimationFrame(step)
    }

    const run = () => {
      if (started.current) return
      started.current = true
      animate(delay)
    }

    // Cleanup resets `started` so a StrictMode remount (or a prop change) can
    // restart the animation cleanly, and stops any pending frame/timer.
    const stop = () => {
      cancelled = true
      started.current = false
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }

    if (trigger === 'mount' || typeof IntersectionObserver === 'undefined' || !el) {
      run()
      return stop
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { run(); io.disconnect() }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => { stop(); io.disconnect() }
  }, [text, duration, delay, trigger, loop, loopPause])

  return <Tag ref={ref} className={className} aria-label={text}>{display}</Tag>
}
