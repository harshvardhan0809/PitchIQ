import { useCallback, useEffect, useState } from 'react'

import { useAsync } from '../hooks/useAsync'
import { getPlayerDashboard } from '../services/footballApi'
import { PlayerDashboard } from '../components/PlayerDashboard'
import { PlayerViewContext } from './playerViewContext'

/**
 * App-wide "open a player" service. Any component can call `openPlayer(identity)`
 * to bring up that player's full stats report in an overlay on top of the current
 * view — so a name in the War Room, a price riser, a captain pick or a squad row
 * all lead to the same dashboard, and closing returns you exactly where you were.
 * `identity` is the `fpl:{id}` reference the search dashboard already uses.
 */
function PlayerModal({ identity, onClose }) {
  const { status, data, error, reload } = useAsync(getPlayerDashboard, [identity, 'PL'])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div
      className="player-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="player-modal">
        <button className="player-modal-close" type="button" onClick={onClose} aria-label="Close player report">×</button>

        {status === 'loading' && (
          <div className="player-modal-state" role="status">
            <span className="spinner" aria-hidden="true" />
            Loading player report…
          </div>
        )}

        {status === 'error' && (
          <div className="player-modal-state" role="alert">
            <p>{error?.message ?? 'Could not load that player.'}</p>
            <button type="button" onClick={reload}>Try again</button>
          </div>
        )}

        {status === 'ready' && data && <PlayerDashboard dashboard={data} onBack={onClose} />}
      </div>
    </div>
  )
}

export function PlayerViewProvider({ children }) {
  const [identity, setIdentity] = useState(null)
  // Accept a bare `fpl:{id}` string (search / matchday) or a player object with
  // display fields (intel cards) — the latter lets demo mode build a report.
  const openPlayer = useCallback((ref) => {
    if (!ref) return
    setIdentity(typeof ref === 'string' ? { id: ref } : ref)
  }, [])
  const close = useCallback(() => setIdentity(null), [])

  return (
    <PlayerViewContext.Provider value={{ openPlayer }}>
      {children}
      {identity && <PlayerModal identity={identity} onClose={close} />}
    </PlayerViewContext.Provider>
  )
}
