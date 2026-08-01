import { createContext, useContext } from 'react'

/**
 * The "open a player report" context, split from the provider component so the
 * hook can be imported without tripping React Fast Refresh's component-only rule.
 */
export const PlayerViewContext = createContext({ openPlayer: () => {} })

export function usePlayerView() {
  return useContext(PlayerViewContext)
}
