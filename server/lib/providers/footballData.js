import { HttpError } from '../http.js'
import { NoopLimiter } from '../rateLimiter.js'

const HOUR = 60 * 60 * 1000

export class FootballDataClient {
  constructor({ apiKey, baseUrl, cache, limiter = new NoopLimiter() }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.cache = cache
    this.limiter = limiter
  }

  get configured() {
    return Boolean(this.apiKey)
  }

  requireKey() {
    if (!this.configured) {
      throw new HttpError(
        'This server has no FOOTBALL_DATA_API_KEY configured, so live competition data is unavailable.',
        503,
      )
    }
  }

  async request(endpoint, params = {}, ttl = HOUR) {
    this.requireKey()

    const url = new URL(`${this.baseUrl}/${endpoint}`)
    Object.entries(params).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(name, value)
      }
    })

    // The limiter sits inside cache.resolve, so it only ever meters genuine
    // upstream calls — cache hits and coalesced duplicates never reach it.
    return this.cache.resolve(url.toString(), ttl, () => this.limiter.schedule(async () => {
      let upstream
      try {
        upstream = await fetch(url, { headers: { 'X-Auth-Token': this.apiKey } })
      } catch {
        throw new HttpError('Could not reach Football-Data.org.', 502)
      }

      if (upstream.status === 429) {
        const retryAfter = Number(upstream.headers.get('Retry-After')) || 60
        throw new HttpError(
          'Football-Data.org rate limit reached. Free-tier keys allow a limited number of requests per minute.',
          429,
          { retryAfter },
        )
      }
      if (upstream.status === 403) {
        throw new HttpError('This Football-Data.org plan does not include the requested resource.', 403)
      }
      if (upstream.status === 404) {
        throw new HttpError('Football-Data.org has no record for that resource.', 404)
      }
      if (!upstream.ok) {
        throw new HttpError(`Football-Data.org request failed (status ${upstream.status}).`, 502)
      }

      return upstream.json()
    }))
  }

  /**
   * The competition record carries the authoritative current season, which is
   * what lets the rest of the app label seasons instead of hardcoding them.
   */
  async getCompetitionMeta(code) {
    return this.request(`competitions/${code}`, {}, 6 * HOUR)
  }

  async getTeams(code, season) {
    const response = await this.request(`competitions/${code}/teams`, { season }, 6 * HOUR)
    return response.teams ?? []
  }

  async getCompetitionMatches(code, params = {}, ttl = 15 * 60 * 1000) {
    const response = await this.request(`competitions/${code}/matches`, params, ttl)
    return response.matches ?? []
  }

  async getTeamMatches(teamId, params = {}, ttl = 30 * 60 * 1000) {
    const response = await this.request(`teams/${teamId}/matches`, params, ttl)
    return response.matches ?? []
  }

  async getScorers(code, { season, limit = 12, ttl = HOUR } = {}) {
    const response = await this.request(`competitions/${code}/scorers`, { season, limit }, ttl)
    return response.scorers ?? []
  }
}
