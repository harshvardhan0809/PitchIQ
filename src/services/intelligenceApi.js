import { getPlan, getAccessToken } from '../lib/auth'
import { ApiError, usesLiveData } from './footballApi'
import { demoCaptainBoard } from '../data/demoIntelligence'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

function delay(value, ms = 160) {
  return new Promise((resolve) => { window.setTimeout(() => resolve(value), ms) })
}

/**
 * Fetch the captain board. The signed session token travels as a bearer
 * credential so the server decides how much to return; in demo mode a bundled
 * board stands in, gated by the locally-simulated plan so both tiers are
 * visible offline.
 */
export async function fetchCaptainPicks(league = 'PL') {
  if (!usesLiveData) {
    return delay(demoCaptainBoard(getPlan()))
  }

  const token = getAccessToken()
  // 'demo' is the offline sentinel, never a real credential to send upstream.
  const authHeader = token && token !== 'demo' ? { Authorization: `Bearer ${token}` } : {}
  let response
  try {
    response = await fetch(`${API_BASE}/api/intel/captains?league=${encodeURIComponent(league)}`, {
      headers: authHeader,
    })
  } catch {
    throw new ApiError('Could not reach the intelligence engine.', 0)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(body?.error ?? 'The captain engine could not respond.', response.status, body?.retryAfter ?? null)
  }
  return body
}
