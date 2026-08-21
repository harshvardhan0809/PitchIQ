import { useEffect, useRef } from 'react'

/**
 * OptiXI Target Cursor — a focus reticle that follows the pointer and snaps to
 * frame interactive elements (player rows, buttons, links, GW chips, FDR pills).
 * A precise centre dot leads; four corner brackets trail and expand to the
 * hovered target's box with a slight magnetic pull.
 *
 * Purely enhancement: it mounts only on a fine pointer that can hover and when
 * reduced-motion is off, so touch, mobile and reduced-motion users keep the
 * native cursor untouched. All motion is transform/opacity driven in a single
 * rAF loop (no React state, no per-frame re-render).
 */
const TARGET_SELECTOR =
  'a, button, [role="button"], .player-row, .gw-chip, .fdr, .exp-card, .tgw-row, .board-row, [data-cursor-target]'

export function TargetCursor() {
  const rootRef = useRef(null)

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!fine.matches || reduce.matches) return undefined

    const root = rootRef.current
    if (!root) return undefined
    const dot = root.querySelector('.oxi-cursor-dot')
    const frame = root.querySelector('.oxi-cursor-frame')

    const doc = document.documentElement
    doc.classList.add('oxi-cursor-on')
    root.style.opacity = '0' // reveal on first move

    const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const dotPos = { ...pointer }
    let target = null
    let raf = 0
    let visible = false
    let angle = 0 // ever-increasing idle spin
    let spin = 0 // applied rotation, eased

    const lerp = (a, b, t) => a + (b - a) * t

    const onMove = (event) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      if (!visible) { visible = true; root.style.opacity = '1' }
      const el = event.target instanceof Element ? event.target.closest(TARGET_SELECTOR) : null
      target = el && !el.hasAttribute('disabled') ? el : null
    }

    const onDown = () => root.classList.add('is-down')
    const onUp = () => root.classList.remove('is-down')
    const onLeave = () => { visible = false; root.style.opacity = '0'; target = null }

    const tick = () => {
      // The dot tracks closely; the frame eases behind for a trailing feel.
      dotPos.x = lerp(dotPos.x, pointer.x, 0.35)
      dotPos.y = lerp(dotPos.y, pointer.y, 0.35)
      angle += 0.85 // idle reticle rotation (unbounded, so no wrap jumps)

      if (target) {
        const rect = target.getBoundingClientRect()
        const pad = 6
        // No magnetism: the dot stays exactly on the pointer. Only the frame
        // snaps to the hovered element's box.
        // The reticle rotation eases to the nearest aligned angle (locks square).
        spin = lerp(spin, Math.round(spin / 360) * 360, 0.18)
        dot.style.transform = `translate3d(${dotPos.x}px, ${dotPos.y}px, 0) translate(-50%, -50%)`
        frame.style.transform = `translate3d(${rect.left - pad}px, ${rect.top - pad}px, 0) rotate(${spin}deg)`
        frame.style.width = `${rect.width + pad * 2}px`
        frame.style.height = `${rect.height + pad * 2}px`
        root.classList.add('is-target')
      } else {
        // Idle: the reticle spins continuously, chasing the running angle.
        spin = lerp(spin, angle, 0.12)
        dot.style.transform = `translate3d(${dotPos.x}px, ${dotPos.y}px, 0) translate(-50%, -50%)`
        frame.style.transform = `translate3d(${dotPos.x}px, ${dotPos.y}px, 0) translate(-50%, -50%) rotate(${spin}deg)`
        frame.style.width = '34px'
        frame.style.height = '34px'
        root.classList.remove('is-target')
      }
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    document.addEventListener('mouseleave', onLeave)
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onLeave)
      doc.classList.remove('oxi-cursor-on')
    }
  }, [])

  return (
    <div ref={rootRef} className="oxi-cursor" aria-hidden="true">
      <span className="oxi-cursor-frame">
        <i className="c tl" /><i className="c tr" /><i className="c br" /><i className="c bl" />
      </span>
      <span className="oxi-cursor-dot" />
    </div>
  )
}
