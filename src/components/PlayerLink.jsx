import { usePlayerView } from '../lib/playerViewContext'
import { usesLiveData } from '../services/footballApi'

/**
 * A player's name rendered as a link into their stats report. Pass the card's own
 * `player` object; the name shown is `children`.
 *
 * Live data needs an `fpl:{id}` reference to fetch the real report. Demo mode
 * builds a report from the card's own fields, so it only needs a name — which
 * means every sample card is clickable too, letting you preview the flow.
 */
export function PlayerLink({ player, className = '', children }) {
  const { openPlayer } = usePlayerView()
  const id = player?.id ?? null
  const name = player?.webName ?? player?.name ?? (typeof children === 'string' ? children : null)

  const canOpen = usesLiveData
    ? Boolean(id && String(id).startsWith('fpl:'))
    : Boolean(name || id)

  if (!canOpen) return <span className={className}>{children}</span>

  return (
    <button
      type="button"
      className={`player-link ${className}`.trim()}
      onClick={() => openPlayer({
        id,
        name,
        team: player?.teamShort ?? player?.team ?? null,
        position: player?.position ?? null,
        photoUrl: player?.photoUrl ?? null,
      })}
    >
      {children}
    </button>
  )
}
