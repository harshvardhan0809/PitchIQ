import { usePlayerView } from '../lib/playerView'

/**
 * A player's name rendered as a link into their stats report. Clickable whenever
 * we have an `fpl:{id}` reference (live data); with sample/demo cards that lack
 * one it degrades to plain text, so it is safe to use everywhere.
 */
export function PlayerLink({ id, elementId, className = '', children }) {
  const { openPlayer } = usePlayerView()
  const identity = id && String(id).startsWith('fpl:')
    ? id
    : (elementId != null ? `fpl:${elementId}` : null)

  if (!identity) return <span className={className}>{children}</span>

  return (
    <button type="button" className={`player-link ${className}`.trim()} onClick={() => openPlayer(identity)}>
      {children}
    </button>
  )
}
