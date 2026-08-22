import { usesLiveData } from './footballApi'

/**
 * Public app configuration (ad cadence & copy, announcement banner, feature
 * visibility, Manager default club). Read on app load and by the admin console.
 * These are presentation values, not secrets. On failure or in demo mode we fall
 * back to sensible defaults so the app never blocks on this call.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? ''

export const DEFAULT_CONFIG = {
  ads: {
    enabled: true,
    firstDelaySec: 10,
    minIntervalSec: 420,
    maxIntervalSec: 480,
    headline: "You're seeing a fraction of the edge",
    subtext: 'Free gives you the matchday and a taste of each tool. Pro unlocks the whole engine — the calls that actually win your mini-league.',
    ctaLabel: 'Upgrade to Pro →',
  },
  announcement: { enabled: false, text: '', tone: 'info' },
  maintenance: { enabled: false, message: '' },
  managerDefaultTeam: 'MUN',
  features: {
    matchxg: true, expert: true,
    squad: true, captain: true, briefing: true, prices: true, league: true, manager: true, differentials: true,
  },
}

export async function fetchAppConfig() {
  if (!usesLiveData) return DEFAULT_CONFIG
  try {
    const response = await fetch(`${API_BASE}/api/config`)
    if (!response.ok) return DEFAULT_CONFIG
    const body = await response.json()
    // Merge defensively so a partial or older server payload still yields a whole
    // config the UI can rely on.
    return {
      ...DEFAULT_CONFIG,
      ...body,
      ads: { ...DEFAULT_CONFIG.ads, ...(body.ads ?? {}) },
      announcement: { ...DEFAULT_CONFIG.announcement, ...(body.announcement ?? {}) },
      maintenance: { ...DEFAULT_CONFIG.maintenance, ...(body.maintenance ?? {}) },
      features: { ...DEFAULT_CONFIG.features, ...(body.features ?? {}) },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}
