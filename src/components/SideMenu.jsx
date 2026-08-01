import { useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * Slide-in navigation drawer. All the feature sections live here (ordered by
 * ranking) rather than crowding the top bar, which keeps the header clean and
 * makes the whole app usable on a phone. Opened by the ☰ button in the top bar.
 */
export function SideMenu({ open, onClose, views, activeView, onSelectView, isAdmin }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="side-menu-scrim"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <aside className="side-menu" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="side-menu-head">
          <span className="side-menu-brand">
            <span className="brand-mark" aria-hidden="true">P</span>
            <strong>PitchIQ</strong>
          </span>
          <button className="side-menu-close" type="button" onClick={onClose} aria-label="Close menu">×</button>
        </div>

        <nav className="side-nav" aria-label="Sections">
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`side-nav-item ${item.id === activeView ? 'active' : ''}`}
              aria-current={item.id === activeView ? 'page' : undefined}
              onClick={() => { onSelectView(item.id); onClose() }}
            >
              <span className="side-nav-ic" aria-hidden="true">{item.icon}</span>
              <span className="side-nav-text">
                <span className="side-nav-label">
                  {item.label}
                  {item.premium && <span className="side-nav-pro">PRO</span>}
                </span>
                {item.hint && <span className="side-nav-hint">{item.hint}</span>}
              </span>
            </button>
          ))}
        </nav>

        <div className="side-menu-foot">
          <Link to="/pricing" className="side-foot-link" onClick={onClose}>Pricing &amp; plans</Link>
          {isAdmin && <Link to="/admin" className="side-foot-link" onClick={onClose}>Admin console</Link>}
        </div>
      </aside>
    </div>
  )
}
