/**
 * App-wide settings: the values an admin can tune from the console (ad cadence &
 * copy, a site announcement banner, which feature tiles are shown, the default
 * club for Manager's Mindset).
 *
 * The source of truth is a single `app_settings` row in Supabase (see
 * supabase/schema.sql). This module owns the *shape*: the defaults every reader
 * falls back to, and a strict sanitizer so a bad admin payload can never poison
 * the live app. Nothing here is secret — the whole thing ships to the browser via
 * /api/config.
 */

// The feature tiles an admin may hide from the app's navigation. Matchday is the
// free home surface and is intentionally not toggleable.
export const TOGGLEABLE_FEATURES = ['squad', 'captain', 'briefing', 'prices', 'league', 'manager', 'differentials']

export const ANNOUNCEMENT_TONES = ['info', 'success', 'warning']

export const DEFAULT_SETTINGS = {
  ads: {
    // The Pro upsell shown to free users while they browse.
    enabled: true,
    firstDelaySec: 10, // how long after opening the app the first ad appears
    minIntervalSec: 420, // 7 min — floor of the gap between repeats
    maxIntervalSec: 480, // 8 min — ceiling of that gap
    headline: "You're seeing a fraction of the edge",
    subtext: 'Free gives you the matchday and a taste of each tool. Pro unlocks the whole engine — the calls that actually win your mini-league.',
    ctaLabel: 'Upgrade to Pro →',
  },
  announcement: {
    // A dismissible strip across the top of the app for every user.
    enabled: false,
    text: '',
    tone: 'info',
  },
  // The club Manager's Mindset opens on when no team is chosen (short name).
  managerDefaultTeam: 'MUN',
  // Every toggleable feature defaults to visible.
  features: Object.fromEntries(TOGGLEABLE_FEATURES.map((key) => [key, true])),
}

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

const cleanText = (value, max, fallback = '') => {
  if (typeof value !== 'string') return fallback
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

/**
 * Merge an untrusted partial patch over a base (the current settings), coercing
 * every field into range. Only known keys survive; anything else is dropped.
 */
export function sanitizeSettings(patch, base = DEFAULT_SETTINGS) {
  const input = patch && typeof patch === 'object' ? patch : {}

  const adsIn = input.ads && typeof input.ads === 'object' ? input.ads : {}
  const firstDelaySec = clampInt(adsIn.firstDelaySec ?? base.ads.firstDelaySec, 3, 120, base.ads.firstDelaySec)
  const minIntervalSec = clampInt(adsIn.minIntervalSec ?? base.ads.minIntervalSec, 30, 3600, base.ads.minIntervalSec)
  // The ceiling can never sit below the floor.
  const maxIntervalSec = clampInt(adsIn.maxIntervalSec ?? base.ads.maxIntervalSec, minIntervalSec, 7200, Math.max(minIntervalSec, base.ads.maxIntervalSec))

  const annIn = input.announcement && typeof input.announcement === 'object' ? input.announcement : {}
  const tone = ANNOUNCEMENT_TONES.includes(annIn.tone) ? annIn.tone : base.announcement.tone

  const featIn = input.features && typeof input.features === 'object' ? input.features : {}
  const features = Object.fromEntries(
    TOGGLEABLE_FEATURES.map((key) => [key, asBool(featIn[key], base.features?.[key] ?? true)]),
  )

  return {
    ads: {
      enabled: asBool(adsIn.enabled, base.ads.enabled),
      firstDelaySec,
      minIntervalSec,
      maxIntervalSec,
      headline: cleanText(adsIn.headline ?? base.ads.headline, 90, DEFAULT_SETTINGS.ads.headline) || DEFAULT_SETTINGS.ads.headline,
      subtext: cleanText(adsIn.subtext ?? base.ads.subtext, 240, DEFAULT_SETTINGS.ads.subtext) || DEFAULT_SETTINGS.ads.subtext,
      ctaLabel: cleanText(adsIn.ctaLabel ?? base.ads.ctaLabel, 40, DEFAULT_SETTINGS.ads.ctaLabel) || DEFAULT_SETTINGS.ads.ctaLabel,
    },
    announcement: {
      enabled: asBool(annIn.enabled, base.announcement.enabled),
      text: cleanText(annIn.text ?? base.announcement.text, 200),
      tone,
    },
    managerDefaultTeam: (cleanText(input.managerDefaultTeam ?? base.managerDefaultTeam, 4).toUpperCase() || DEFAULT_SETTINGS.managerDefaultTeam),
    features,
  }
}

/** Fill any missing branch of a stored blob with the defaults. */
export function withDefaults(stored) {
  return sanitizeSettings(stored ?? {}, DEFAULT_SETTINGS)
}
