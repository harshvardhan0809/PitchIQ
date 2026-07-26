/**
 * Strip accents and punctuation so names coming from two providers can be
 * compared. "Bruno Guimarães" and "Bruno Guimaraes" must collapse to one key.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Tokens of a name, normalized, with empties dropped. */
export function nameTokens(value) {
  return String(value ?? '')
    .split(/[\s-]+/)
    .map(normalizeName)
    .filter(Boolean)
}

export function initials(name) {
  const tokens = String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return '?'
  return tokens
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

/**
 * Two names refer to the same player when one's token set is contained in the
 * other's. Providers disagree on how much of a full name they include
 * ("Bruno Fernandes" vs "Bruno Borges Fernandes"), so exact equality is too
 * strict and a substring check is too loose.
 */
export function samePerson(left, right) {
  const a = new Set(nameTokens(left))
  const b = new Set(nameTokens(right))
  if (a.size === 0 || b.size === 0) return false
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const token of small) {
    if (!large.has(token)) return false
  }
  return true
}

/** Round-trip safe ISO string, or null when the input is unusable. */
export function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Absent values stay absent. Plain `Number()` turns null and '' into 0, which
 * would render an unplayed fixture as a 0-0 draw.
 */
export function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
