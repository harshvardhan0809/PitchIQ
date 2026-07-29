import { getPlan, getFreshAccessToken } from '../lib/auth'
import { ApiError, usesLiveData } from './footballApi'
import { demoCaptainBoard, demoDifferentials, demoSquad, demoBriefing, demoPriceWatch } from '../data/demoIntelligence'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

function delay(value, ms = 160) {
  return new Promise((resolve) => { window.setTimeout(() => resolve(value), ms) })
}

/**
 * Fetch a premium intelligence board. The signed session token travels as a
 * bearer credential so the server decides how much to return; in demo mode a
 * bundled board stands in, gated by the locally-simulated plan so both tiers
 * are visible offline.
 */
async function fetchBoard(path, demoFactory) {
  if (!usesLiveData) {
    return delay(demoFactory(getPlan()))
  }

  const token = await getFreshAccessToken()
  // 'demo' is the offline sentinel, never a real credential to send upstream.
  const authHeader = token && token !== 'demo' ? { Authorization: `Bearer ${token}` } : {}
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: authHeader })
  } catch {
    throw new ApiError('Could not reach the intelligence engine.', 0)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(body?.error ?? 'The intelligence engine could not respond.', response.status, body?.retryAfter ?? null)
  }
  return body
}

export function fetchCaptainPicks(league = 'PL') {
  return fetchBoard(`/api/intel/captains?league=${encodeURIComponent(league)}`, demoCaptainBoard)
}

export function fetchDifferentials(league = 'PL') {
  return fetchBoard(`/api/intel/differentials?league=${encodeURIComponent(league)}`, demoDifferentials)
}

export function fetchBriefing(league = 'PL') {
  return fetchBoard(`/api/intel/briefing?league=${encodeURIComponent(league)}`, demoBriefing)
}

export function fetchPriceWatch(league = 'PL') {
  return fetchBoard(`/api/intel/prices?league=${encodeURIComponent(league)}`, demoPriceWatch)
}

/**
 * Analyse a connected FPL team. Unlike the boards this is keyed by the manager's
 * team ID; the same bearer token decides whether the transfer suggestions come
 * back. In demo mode a bundled squad stands in for any non-empty id.
 */
export function fetchSquad(entryId, league = 'PL') {
  const id = String(entryId ?? '').trim()
  if (!id) return Promise.reject(new ApiError('Enter your FPL team ID to analyse your squad.', 400))
  if (!usesLiveData) return delay(demoSquad(getPlan()))

  const path = `/api/intel/squad?league=${encodeURIComponent(league)}&entry=${encodeURIComponent(id)}`
  return fetchBoard(path, () => demoSquad(getPlan()))
}
