import { demoDashboards, demoSearchResults, demoSpotlight } from '../data/demoData'
import { demoPlayerDashboard } from '../data/demoPlayer'

const dataMode = import.meta.env.VITE_DATA_MODE ?? 'demo'
export const usesLiveData = dataMode === 'live'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

// PitchIQ is Premier League only — powered end to end by the FPL API.
export const leagueOptions = [
  { code: 'PL', name: 'Premier League', country: 'England' },
]

/** An error that keeps the HTTP status so callers can react to 429 specifically. */
export class ApiError extends Error {
  constructor(message, status, retryAfter) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

function delay(value, ms = 140) {
  return new Promise((resolve) => { window.setTimeout(() => resolve(value), ms) })
}

async function request(path) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`)
  } catch {
    throw new ApiError('Could not reach the PitchIQ API. Check that the server is running.', 0)
  }

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(
      body?.error ?? `The request failed (status ${response.status}).`,
      response.status,
      body?.retryAfter ?? null,
    )
  }

  return body
}

export async function fetchSpotlight(league = 'PL') {
  if (!usesLiveData) return delay(demoSpotlight(league))
  return request(`/api/spotlight?league=${encodeURIComponent(league)}`)
}

export async function searchPlayers(query = '', league = 'PL') {
  if (!usesLiveData) return delay(demoSearchResults(query, league))

  const body = await request(
    `/api/players/search?q=${encodeURIComponent(query)}&league=${encodeURIComponent(league)}`,
  )
  return body.players ?? []
}

/**
 * `ref` is either an `fpl:{id}` string (search / live cards) or a player object
 * carrying at least a name (intel cards, which pass their own data). In demo mode
 * we prefer a hand-authored dashboard, else synthesise one from the object so a
 * click on any name opens a full report. Live mode always needs the fpl id.
 */
export async function getPlayerDashboard(ref, league = 'PL') {
  const id = typeof ref === 'string' ? ref : ref?.id

  if (!usesLiveData) {
    const authored = id ? demoDashboards[id] : null
    return delay(authored ?? demoPlayerDashboard(typeof ref === 'object' && ref ? ref : { id }))
  }

  if (!id) throw new ApiError('Unrecognised player reference.', 400)
  return request(`/api/players/${encodeURIComponent(id)}/dashboard?league=${encodeURIComponent(league)}`)
}