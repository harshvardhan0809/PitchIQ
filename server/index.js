import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HttpError, bearerToken, json, preflight, resolveOrigin } from './lib/http.js'
import { TtlCache } from './lib/cache.js'
import { RateLimiter } from './lib/rateLimiter.js'
import {
  COMPETITIONS,
  DEFAULT_COMPETITION,
  getCompetition,
  isKnownCompetition,
  seasonLabel,
  seasonStartYear,
} from './lib/competitions.js'
import { FootballDataClient } from './lib/providers/footballData.js'
import { FplClient } from './lib/providers/fpl.js'
import { getSpotlight } from './lib/spotlight.js'
import { getPlayerDashboard, searchPlayers } from './lib/players.js'
import { getCaptainBoard } from './lib/intelligence/captains.js'
import { featureMeta, isEntitled, planForCredentials, PLAN_ORDER } from './lib/entitlements.js'
import { SupabaseAuth } from './lib/supabaseAuth.js'

/**
 * Minimal .env reader for `node server/index.js` without a flag. Values are
 * unquoted so `KEY="value"` does not keep its quotes, and existing environment
 * variables always win.
 */
function loadEnvFile() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env')
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2')
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile()

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)
const host = process.env.API_HOST ?? '0.0.0.0'
const allowList = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// Honour a configured default league, but never let a typo silently redirect
// every request to a competition the caller did not ask for.
const configuredDefault = process.env.FOOTBALL_DATA_COMPETITION
const defaultCompetition = isKnownCompetition(configuredDefault)
  ? configuredDefault.toUpperCase()
  : DEFAULT_COMPETITION

if (configuredDefault && !isKnownCompetition(configuredDefault)) {
  console.warn(`Ignoring unknown FOOTBALL_DATA_COMPETITION "${configuredDefault}"; using ${DEFAULT_COMPETITION}.`)
}

const cache = new TtlCache({ maxEntries: Number(process.env.CACHE_MAX_ENTRIES ?? 400) })

// Football-Data's free tier is 10 requests/minute; stay a request under it and
// let a short burst wait rather than trip the limit. FPL is unofficial with no
// published cap, so meter it loosely just to stay polite.
const footballDataLimiter = new RateLimiter({
  limit: Number(process.env.FOOTBALL_DATA_RATE_LIMIT ?? 8),
  intervalMs: 60 * 1000,
  maxWaitMs: Number(process.env.FOOTBALL_DATA_MAX_WAIT_MS ?? 10000),
  label: 'football data service',
})

const fplLimiter = new RateLimiter({
  limit: Number(process.env.FPL_RATE_LIMIT ?? 30),
  intervalMs: 60 * 1000,
  maxWaitMs: Number(process.env.FPL_MAX_WAIT_MS ?? 15000),
  label: 'Fantasy Premier League service',
})

const footballData = new FootballDataClient({
  apiKey: process.env.FOOTBALL_DATA_API_KEY ?? '',
  baseUrl: process.env.FOOTBALL_DATA_BASE_URL ?? 'https://api.football-data.org/v4',
  cache,
  limiter: footballDataLimiter,
})

const fpl = new FplClient({
  baseUrl: process.env.FPL_BASE_URL ?? 'https://fantasy.premierleague.com/api',
  cache,
  limiter: fplLimiter,
})

// --- Authentication & entitlements -----------------------------------------
// Supabase owns identity; this proxy validates its tokens and reads the plan.
const supabaseAuth = new SupabaseAuth({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  cache,
})

// Which credentials earn which plan. Access codes stand in for Stripe until
// billing is wired; defaults exist only so the split is testable out of the box
// and must be replaced in production.
const parseList = (value, fallback = '') => (value ?? fallback)
  .split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
const entitlementConfig = {
  proCodes: parseList(process.env.PRO_ACCESS_CODES, 'PITCHIQ-PRO'),
  eliteCodes: parseList(process.env.ELITE_ACCESS_CODES, 'PITCHIQ-ELITE'),
  proEmails: (process.env.PRO_EMAILS ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
}

/** The caller's plan, from a Supabase-validated token. Anything else is free. */
async function planOf(request) {
  const user = await supabaseAuth.getUser(bearerToken(request))
  return user?.plan ?? 'free'
}

/** Read a small JSON body from a POST, with a hard size cap. */
function readJsonBody(request, limit = 4096) {
  return new Promise((resolve, reject) => {
    let raw = ''
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError('Request body too large.', 413))
        request.destroy()
        return
      }
      raw += chunk
    })
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new HttpError('Request body must be valid JSON.', 400))
      }
    })
    request.on('error', () => reject(new HttpError('Could not read the request body.', 400)))
  })
}

/**
 * Redeem an access code to upgrade the signed-in user. Identity comes from the
 * Supabase token; the code decides the plan (the Stripe stand-in); and the new
 * plan is written to the user's app_metadata via the service role, so it is
 * carried by every future token. The client refreshes its session to see it.
 */
async function handleUpgrade(request) {
  const token = bearerToken(request)
  const user = await supabaseAuth.getUser(token)
  if (!user) throw new HttpError('Please sign in before upgrading.', 401)

  const body = await readJsonBody(request)
  const plan = planForCredentials(user.email, body.code, entitlementConfig)
  if (plan === 'free') {
    return {
      upgraded: false,
      plan: user.plan,
      codeRejected: Boolean(String(body.code ?? '').trim()),
    }
  }

  // Never downgrade: a lower-tier code from a higher-tier member is a no-op.
  if (PLAN_ORDER.indexOf(plan) <= PLAN_ORDER.indexOf(user.plan)) {
    return { upgraded: false, plan: user.plan, alreadyEntitled: true }
  }

  await supabaseAuth.setPlan(user.id, plan)
  supabaseAuth.forget(token) // so a re-read reflects the change immediately
  return { upgraded: true, plan }
}

/**
 * Every route needs the season Football-Data considers current, and asking for
 * it is a cached call, so resolve it once per request in one place.
 */
async function resolveSeason(competition) {
  try {
    const meta = await footballData.getCompetitionMeta(competition.code)
    return {
      season: seasonStartYear(meta.currentSeason),
      label: seasonLabel(meta.currentSeason),
    }
  } catch (error) {
    if (error instanceof HttpError && error.status >= 500) return { season: null, label: 'Current season' }
    throw error
  }
}

/**
 * Shape a premium payload for the caller's plan. Entitled callers get the full
 * board; free callers get the single flagship pick plus a locked-count so the UI
 * can present a genuine taste and a clear upgrade path — value first, paywall
 * second.
 */
function gateBoard(result, plan, featureKey) {
  const meta = featureMeta(featureKey)
  const unlocked = isEntitled(plan, featureKey)
  const base = {
    feature: meta.key,
    featureName: meta.name,
    requiredPlan: meta.requiredPlan,
    plan,
    gameweek: result.gameweek,
    gameweekName: result.gameweekName,
    deadline: result.deadline,
    phase: result.phase,
    generatedAt: result.generatedAt,
  }
  if (unlocked) {
    return { ...base, locked: false, topPick: result.board[0] ?? null, board: result.board }
  }
  return {
    ...base,
    locked: true,
    topPick: result.board[0] ?? null,
    board: result.board.slice(0, 1),
    lockedCount: Math.max(0, result.board.length - 1),
  }
}

const routes = [
  {
    pattern: /^\/api\/health$/,
    cacheControl: 'public, max-age=30',
    handle: async () => ({
      status: 'ok',
      live: true,
      providers: ['Football-Data.org', 'Fantasy Premier League (unofficial)'],
      footballDataConfigured: footballData.configured,
      defaultCompetition,
      competitions: Object.values(COMPETITIONS).map(({ code, name, country, supportsFpl }) => ({
        code,
        name,
        country,
        supportsFpl,
      })),
      cacheEntries: cache.size,
    }),
  },
  {
    pattern: /^\/api\/spotlight$/,
    cacheControl: 'public, max-age=60',
    handle: async (_match, url) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      return getSpotlight({ competition, footballData, fpl })
    },
  },
  {
    pattern: /^\/api\/players\/search$/,
    cacheControl: 'public, max-age=60',
    handle: async (_match, url) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      const { season } = await resolveSeason(competition)
      const players = await searchPlayers({
        query: url.searchParams.get('q') ?? '',
        competition,
        footballData,
        fpl,
        season,
      })
      return { competition: competition.code, players }
    },
  },
  {
    pattern: /^\/api\/players\/([^/]+)\/dashboard$/,
    cacheControl: 'public, max-age=120',
    handle: async (match, url) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      const { season } = await resolveSeason(competition)
      return getPlayerDashboard({
        identity: decodeURIComponent(match[1]),
        competition,
        footballData,
        fpl,
        season,
      })
    },
  },
  {
    // Captain intelligence. FPL-backed, so Premier League only. Premium feature
    // with a free preview of the single top pick.
    pattern: /^\/api\/intel\/captains$/,
    cacheControl: 'public, max-age=300',
    handle: async (_match, url, request) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      if (!competition.supportsFpl) {
        throw new HttpError('Captain intelligence is available for the Premier League only.', 400)
      }
      const plan = await planOf(request)
      const result = await getCaptainBoard({ fpl, limit: 12 })
      return gateBoard(result, plan, 'captain-picks')
    },
  },
  {
    // Validate the current Supabase session and report the plan the server sees.
    pattern: /^\/api\/auth\/me$/,
    cacheControl: 'no-store',
    handle: async (_match, _url, request) => {
      const user = await supabaseAuth.getUser(bearerToken(request))
      if (!user) return { authenticated: false, user: null }
      return { authenticated: true, user: { id: user.id, email: user.email, plan: user.plan } }
    },
  },
]

const server = createServer(async (request, response) => {
  const origin = resolveOrigin(request.headers.origin, allowList)

  if (request.method === 'OPTIONS') return preflight(response, origin)

  let url
  try {
    url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
  } catch {
    return json(response, 400, { error: 'Malformed request URL.' }, { origin })
  }

  // Plan upgrade is the one write endpoint; everything else is read-only GET.
  if (request.method === 'POST' && url.pathname === '/api/auth/upgrade') {
    try {
      return json(response, 200, await handleUpgrade(request), { origin })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Upgrade failed.'
      if (status === 500) console.error('Upgrade error:', error)
      return json(response, status, { error: message }, { origin })
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(response, 405, { error: 'Only GET and the upgrade endpoint are supported.' }, { origin })
  }

  const route = routes
    .map((candidate) => ({ candidate, match: candidate.pattern.exec(url.pathname) }))
    .find(({ match }) => match !== null)

  if (!route) return json(response, 404, { error: 'Route not found.' }, { origin })

  try {
    const body = await route.candidate.handle(route.match, url, request)
    return json(response, 200, body, { origin, cacheControl: route.candidate.cacheControl })
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        response,
        error.status,
        { error: error.message, retryAfter: error.retryAfter ?? null },
        { origin, retryAfter: error.retryAfter },
      )
    }
    // Anything unmapped is a bug in this server; log it and stay vague outward.
    console.error(`Unhandled error on ${url.pathname}:`, error)
    return json(response, 500, { error: 'Something went wrong handling that request.' }, { origin })
  }
})

server.listen(port, host, () => {
  console.log(`PitchIQ proxy listening on http://${host}:${port}`)
  console.log(allowList.length > 0 ? `CORS restricted to: ${allowList.join(', ')}` : 'CORS open (set ALLOWED_ORIGINS to restrict)')
  if (!footballData.configured) {
    console.warn('Warning: FOOTBALL_DATA_API_KEY is not set. Live competition endpoints will return 503.')
  }
  if (!supabaseAuth.configured) {
    console.warn('Warning: SUPABASE_URL / SUPABASE_ANON_KEY are not set. Accounts are disabled and every request is treated as the free tier.')
  } else if (!supabaseAuth.canManage) {
    console.warn('Warning: SUPABASE_SERVICE_ROLE_KEY is not set. Sign-in works, but plan upgrades will fail until it is provided.')
  }
})
