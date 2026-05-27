import { demoPlayers } from '../data/demoPlayers'

const dataMode = import.meta.env.VITE_DATA_MODE ?? 'demo'
export const usesLiveData = dataMode === 'live'

function wait(value) {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), 120)
  })
}

async function readResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.error ?? fallbackMessage)
  }
  return data
}

export async function searchPlayers(query = '') {
  if (usesLiveData) {
    const response = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`)
    return readResponse(response, 'Unable to search players from live providers.')
  }

  const term = query.trim().toLowerCase()
  const matches = demoPlayers
    .filter((player) => {
      if (!term) return true
      return `${player.name} ${player.team} ${player.position}`.toLowerCase().includes(term)
    })
    .map(({ id, name, initials, team, position, photoUrl }) => (
      { id, name, initials, team, position, photoUrl }
    ))

  return wait(matches)
}

export async function getPlayerDashboard(id) {
  if (usesLiveData) {
    const response = await fetch(`/api/players/${encodeURIComponent(id)}/dashboard`)
    return readResponse(response, 'Unable to load this player report from live providers.')
  }

  const player = demoPlayers.find((entry) => entry.id === id)
  if (!player) {
    throw new Error('Player not found in the demo dataset.')
  }
  return wait(player)
}
