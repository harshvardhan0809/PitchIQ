import { getFreshAccessToken } from '../lib/auth'
import { ApiError, usesLiveData } from './footballApi'

/**
 * The signed-in user's profile (FPL team id + settings), stored server-side so
 * it follows them across devices. Degrades quietly to null when there's no live
 * API or no session, so callers can fall back to local storage.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function request(path, { method = 'GET', json } = {}) {
  if (!usesLiveData) return null
  const token = await getFreshAccessToken()
  if (!token || token === 'demo') return null

  const headers = {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
  }
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(json ? { body: JSON.stringify(json) } : {}),
    })
  } catch {
    throw new ApiError('Could not reach the server.', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(body?.error ?? 'That request failed.', response.status)
  return body
}

export function getProfile() {
  return request('/api/profile')
}

export function saveProfile(fields) {
  return request('/api/profile', { method: 'POST', json: fields })
}
