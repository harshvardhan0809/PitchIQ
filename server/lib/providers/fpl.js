import { HttpError } from '../http.js'
import { NoopLimiter } from '../rateLimiter.js'

const MINUTE = 60 * 1000

/** FPL exposes availability as a single letter on each element. */
const AVAILABILITY = {
  a: { code: 'available', label: 'Available' },
  d: { code: 'doubtful', label: 'Doubtful' },
  i: { code: 'injured', label: 'Injured' },
  s: { code: 'suspended', label: 'Suspended' },
  u: { code: 'unavailable', label: 'Unavailable' },
  n: { code: 'unavailable', label: 'Not in squad' },
}

export class FplClient {
  constructor({ baseUrl, cache, limiter = new NoopLimiter() }) {
    this.baseUrl = baseUrl
    this.cache = cache
    this.limiter = limiter
  }

  async request(endpoint, ttl) {
    const url = `${this.baseUrl}/${endpoint}`
    return this.cache.resolve(url, ttl, () => this.limiter.schedule(async () => {
      let upstream
      try {
        upstream = await fetch(url)
      } catch {
        throw new HttpError('Could not reach the Fantasy Premier League API.', 502)
      }
      if (upstream.status === 429) {
        throw new HttpError('Fantasy Premier League API rate limit reached.', 429, { retryAfter: 60 })
      }
      if (!upstream.ok) {
        throw new HttpError(`Fantasy Premier League request failed (status ${upstream.status}).`, 502)
      }
      return upstream.json()
    }))
  }

  getBootstrap() {
    return this.request('bootstrap-static/', 5 * MINUTE)
  }

  getFixtures() {
    return this.request('fixtures/', 5 * MINUTE)
  }

  getElementSummary(playerId) {
    return this.request(`element-summary/${playerId}/`, 15 * MINUTE)
  }
}

export function playerPhotoUrl(code) {
  return code ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${code}.png` : null
}

export function teamCrestUrl(code) {
  return code ? `https://resources.premierleague.com/premierleague/badges/70/t${code}.png` : null
}

export function fullName(element) {
  // web_name is the display name FPL itself uses; the long form is the fallback.
  const long = `${element.first_name ?? ''} ${element.second_name ?? ''}`.trim()
  return long || element.web_name || 'Unknown player'
}

export function availabilityOf(element) {
  const mapped = AVAILABILITY[element.status] ?? AVAILABILITY.a
  return {
    ...mapped,
    // FPL embeds markup-free prose here; pass it through only when it says something.
    note: element.news?.trim() ? element.news.trim() : null,
    chanceOfPlaying: element.chance_of_playing_next_round ?? null,
  }
}

/**
 * The gameweek the app should treat as "now": the one in progress, else the
 * next one due. Between seasons both can be absent.
 */
export function currentGameweek(bootstrap) {
  const events = bootstrap.events ?? []
  const current = events.find((event) => event.is_current)
  const next = events.find((event) => event.is_next)
  return { current: current ?? null, next: next ?? null }
}

export function indexBy(items, key) {
  return new Map((items ?? []).map((item) => [item[key], item]))
}
