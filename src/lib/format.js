/**
 * All date formatting happens here, in the browser, so times render in the
 * reader's own timezone. The API only ever sends ISO strings.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatKickoff(value) {
  const date = toDate(value)
  if (!date) return 'Date to be confirmed'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatTime(value) {
  const date = toDate(value)
  if (!date) return '--:--'
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function formatShortDate(value) {
  const date = toDate(value)
  if (!date) return '--'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date)
}

export function formatDayHeading(value) {
  const date = toDate(value)
  if (!date) return 'Date to be confirmed'

  const startOfDay = (input) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime()
  const dayDelta = Math.round((startOfDay(date) - startOfDay(new Date())) / DAY_MS)
  if (dayDelta === 0) return 'Today'
  if (dayDelta === 1) return 'Tomorrow'
  if (dayDelta === -1) return 'Yesterday'

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

/** "in 4 weeks" / "3 days ago", for framing a round that is not close to now. */
export function formatRelative(value) {
  const date = toDate(value)
  if (!date) return null

  const deltaDays = Math.round((date.getTime() - Date.now()) / DAY_MS)
  if (Math.abs(deltaDays) < 1) return null

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(deltaDays) < 7) return relative.format(deltaDays, 'day')
  if (Math.abs(deltaDays) < 30) return relative.format(Math.round(deltaDays / 7), 'week')
  return relative.format(Math.round(deltaDays / 30), 'month')
}

export function formatScoreline(match) {
  if (!match.hasScore) return null
  return `${match.homeTeam.score ?? 0} - ${match.awayTeam.score ?? 0}`
}
