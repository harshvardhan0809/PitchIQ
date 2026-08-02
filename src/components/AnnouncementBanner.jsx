import { useAppConfig } from '../lib/appConfigContext'

/**
 * A bold, always-on announcement strip an admin can switch on (admin console →
 * Site). The message scrolls continuously as a marquee and can't be dismissed —
 * it stays until the admin turns it off. Motion is disabled for users who prefer
 * reduced motion (the CSS pauses it and centres the text instead).
 */
const TONE_ICON = { info: '📣', success: '✅', warning: '⚠️' }

export function AnnouncementBanner() {
  const { announcement } = useAppConfig()
  const message = announcement.enabled ? announcement.text.trim() : ''
  if (!message) return null

  const icon = TONE_ICON[announcement.tone] ?? TONE_ICON.info
  // One "group" repeats the message enough times to span a wide screen; two
  // identical groups let the track loop seamlessly at translateX(-50%).
  const group = Array.from({ length: 4 }, (_, i) => (
    <span className="app-note-item" key={i}>
      <span className="app-note-ic" aria-hidden="true">{icon}</span>
      {message}
      <span className="app-note-sep" aria-hidden="true">✦</span>
    </span>
  ))

  return (
    <div className={`app-note tone-${announcement.tone}`} role="status" aria-label={message}>
      <div className="app-note-viewport">
        <div className="app-note-track" aria-hidden="true">
          {group}
          {group}
        </div>
      </div>
      {/* Screen-reader copy: the marquee itself is aria-hidden. */}
      <span className="app-note-sr">{message}</span>
    </div>
  )
}
