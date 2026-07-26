export const COMPETITIONS = {
  PL: { code: 'PL', name: 'Premier League', shortName: 'Premier League', country: 'England', supportsFpl: true },
  PD: { code: 'PD', name: 'La Liga', shortName: 'La Liga', country: 'Spain', supportsFpl: false },
  SA: { code: 'SA', name: 'Serie A', shortName: 'Serie A', country: 'Italy', supportsFpl: false },
  BL1: { code: 'BL1', name: 'Bundesliga', shortName: 'Bundesliga', country: 'Germany', supportsFpl: false },
  FL1: { code: 'FL1', name: 'Ligue 1', shortName: 'Ligue 1', country: 'France', supportsFpl: false },
}

export const DEFAULT_COMPETITION = 'PL'

export function getCompetition(code) {
  const normalized = String(code ?? '').toUpperCase()
  return COMPETITIONS[normalized] ?? COMPETITIONS[DEFAULT_COMPETITION]
}

export function isKnownCompetition(code) {
  return Boolean(COMPETITIONS[String(code ?? '').toUpperCase()])
}

/**
 * Football-Data identifies a season by its starting year. Derive a display
 * label from that rather than hardcoding one, so labels don't go stale when
 * the calendar rolls over.
 */
export function seasonLabel(season) {
  const startYear = Number(String(season?.startDate ?? '').slice(0, 4))
  if (!Number.isFinite(startYear)) return 'Season'
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
}

export function seasonStartYear(season) {
  const startYear = Number(String(season?.startDate ?? '').slice(0, 4))
  return Number.isFinite(startYear) ? startYear : null
}

/**
 * Where the current season sits relative to now:
 *   'pre'    — published but not yet kicked off (fixtures exist, no results)
 *   'active' — in progress (results and possibly live matches)
 *   'post'   — finished (all results in, immutable)
 *   'unknown'— no usable dates
 *
 * This lets callers pick both the right season to query and a safe cache TTL:
 * pre/post data is static and can be held for hours, active data cannot.
 */
export function seasonPhase(season, now = Date.now()) {
  const start = Date.parse(season?.startDate ?? '')
  const end = Date.parse(season?.endDate ?? '')
  if (Number.isNaN(start) || Number.isNaN(end)) return 'unknown'
  if (now < start) return 'pre'
  // Give the end date its full day before calling the season over.
  if (now > end + 24 * 60 * 60 * 1000) return 'post'
  return 'active'
}
