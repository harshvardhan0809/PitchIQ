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
      // Preserve 404 so callers can distinguish "no such resource" (e.g. an
      // unknown team ID) from a genuine upstream failure.
      if (upstream.status === 404) {
        throw new HttpError('Fantasy Premier League resource not found.', 404)
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

  /**
   * Fixtures for a single gameweek on a short TTL — the live match center polls
   * this while matches are in play. The `?event=` query gives it a distinct cache
   * key from getFixtures(), so the live feed stays fresh (30s) without shortening
   * the general 5-minute fixtures cache.
   */
  getLiveFixtures(event) {
    return this.request(`fixtures/?event=${encodeURIComponent(event)}`, 30 * 1000)
  }

  getElementSummary(playerId) {
    return this.request(`element-summary/${playerId}/`, 15 * MINUTE)
  }

  /** A manager's public entry (team name, current gameweek, bank, value). */
  getEntry(entryId) {
    return this.request(`entry/${entryId}/`, 5 * MINUTE)
  }

  /** A manager's saved picks for a gameweek: the 15-man squad and captaincy. */
  getEntryPicks(entryId, event) {
    return this.request(`entry/${entryId}/event/${event}/picks/`, 5 * MINUTE)
  }

  /** A classic mini-league's standings (page 1 = top 50). Public, no auth. */
  getLeagueStandings(leagueId, page = 1) {
    return this.request(`leagues-classic/${leagueId}/standings/?page_standings=${page}`, 2 * MINUTE)
  }
}

/**
 * Classic league IDs are the digits in the league URL. Validate before it hits
 * the upstream path so a malformed id fails fast rather than as an opaque 404.
 */
export function parseLeagueId(value) {
  const digits = String(value ?? '').trim()
  if (!/^\d{1,12}$/.test(digits)) {
    throw new HttpError('Enter your league ID — the number in the league’s URL.', 400)
  }
  return Number(digits)
}

/**
 * FPL team IDs are the digits in the manager's team URL. Validate before it
 * reaches the upstream path so a malformed id fails fast with a clear message
 * rather than as an opaque 404 or a path-injection attempt.
 */
export function parseEntryId(value) {
  const digits = String(value ?? '').trim()
  if (!/^\d{1,9}$/.test(digits)) {
    throw new HttpError('Enter your FPL team ID — the number in your team’s URL.', 400)
  }
  return Number(digits)
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
