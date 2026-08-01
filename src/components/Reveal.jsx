import { useEffect, useRef, useState } from 'react'

/**
 * Reveals its children with a fade-up the first time they scroll into view.
 * Pass `delay` (ms) to stagger siblings. The actual motion lives in `.reveal`
 * CSS, which no-ops under reduced-motion.
 */
export function Reveal({ children, className = '', delay = 0, as: Tag = 'div' }) {
  const ref = useRef(null)
  // Show immediately where IntersectionObserver isn't available (e.g. SSR).
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (shown) return undefined
    const el = ref.current
    if (!el) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      // Fires when the element scrolls into view — an async event, not a render.
      if (entry.isIntersecting) { setShown(true); observer.disconnect() }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })

    observer.observe(el)
    return () => observer.disconnect()
  }, [shown])

  return (
    <Tag
      ref={ref}
      className={`reveal ${shown ? 'is-visible' : ''} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}
