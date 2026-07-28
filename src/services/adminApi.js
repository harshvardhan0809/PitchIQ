import { getFreshAccessToken } from '../lib/auth'
import { ApiError, usesLiveData } from './footballApi'

/**
 * Admin console client. Every call carries the signed session token; the server
 * independently verifies the caller is a configured admin, so this file holds no
 * privilege of its own — the service-role key never leaves the server.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function request(path, { method = 'GET', json } = {}) {
  if (!usesLiveData) {
    throw new ApiError('The admin console needs the live API server (npm run api).', 0)
  }
  const token = await getFreshAccessToken()
  const headers = {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token && token !== 'demo' ? { Authorization: `Bearer ${token}` } : {}),
  }
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(json ? { body: JSON.stringify(json) } : {}),
    })
  } catch {
    throw new ApiError('Could not reach the server. Make sure the API is running (npm run api).', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(body?.error ?? 'That request failed.', response.status)
  }
  return body
}

/** Whether the signed-in user is an admin, per the server. */
export function fetchMe() {
  return request('/api/auth/me')
}

/** Every registered user with their current subscription. */
export function fetchAdminUsers() {
  return request('/api/admin/users')
}

/** Manually set a user's subscription (upgrade or downgrade). */
export function setUserPlan(userId, plan) {
  return request('/api/admin/users/plan', { method: 'POST', json: { userId, plan } })
}
