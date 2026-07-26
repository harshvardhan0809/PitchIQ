const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

/**
 * An error that carries the HTTP status the client should receive. Upstream
 * failures keep their own status so a rate limit stays a 429 instead of being
 * flattened into a generic 500.
 */
export class HttpError extends Error {
  constructor(message, status = 500, options = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.retryAfter = options.retryAfter
  }
}

/**
 * Resolve the value for Access-Control-Allow-Origin. An empty allow list keeps
 * the proxy open (handy in development); a configured list echoes back only
 * origins that are on it.
 */
export function resolveOrigin(requestOrigin, allowList) {
  if (allowList.length === 0) return '*'
  if (requestOrigin && allowList.includes(requestOrigin)) return requestOrigin
  return allowList[0]
}

export function json(response, status, body, options = {}) {
  const headers = {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': options.origin ?? '*',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': options.cacheControl ?? 'no-store',
    Vary: 'Origin',
  }
  if (options.retryAfter) headers['Retry-After'] = String(options.retryAfter)

  response.writeHead(status, headers)
  response.end(JSON.stringify(body))
}

export function preflight(response, origin) {
  response.writeHead(204, { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' })
  response.end()
}

/** Extract a bearer token from the Authorization header, if present. */
export function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec((request.headers.authorization ?? '').trim())
  return match ? match[1] : null
}
