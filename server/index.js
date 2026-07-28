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
} from './lib/competitions.js'
import { FootballDataClient } from './lib/providers/footballData.js'
import { FplClient } from './lib/providers/fpl.js'
import { getSpotlight } from './lib/spotlight.js'
import { getPlayerDashboard, searchPlayers } from './lib/players.js'
import { getCaptainBoard } from './lib/intelligence/captains.js'
import { getDifferentials } from './lib/intelligence/differentials.js'
import { getBriefing } from './lib/intelligence/briefing.js'
import { getSquadAnalysis } from './lib/intelligence/squad.js'
import { parseEntryId } from './lib/providers/fpl.js'
import { RazorpayClient } from './lib/providers/razorpay.js'
import { featureMeta, isEntitled, PLAN_ORDER } from './lib/entitlements.js'
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

// Identifies the running code so a stale `node server/index.js` is detectable
// at /api/health and in the startup log. Bump on behaviour changes.
const SERVER_BUILD = '2026-07-27-subscriptions-tables'

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

// Billing. Razorpay owns payment; a verified webhook is the only thing that
// flips a user to Pro (the browser is never trusted for entitlement). The plan's
// price and currency live in the Razorpay Plan, so switching them never touches
// this code.
const razorpay = new RazorpayClient({
  keyId: process.env.RAZORPAY_KEY_ID,
  keySecret: process.env.RAZORPAY_KEY_SECRET,
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  planId: process.env.RAZORPAY_PLAN_ID,
})

// Who may use the admin console. Membership is by email (server-side only), not
// by plan, so an admin can never accidentally revoke their own access by editing
// a subscription.
const adminEmails = (process.env.ADMIN_EMAILS ?? '')
  .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
const isAdminEmail = (email) => Boolean(email) && adminEmails.includes(email.toLowerCase())

/** The caller's plan, from a Supabase-validated token. Anything else is free. */
async function planOf(request) {
  const user = await supabaseAuth.getUser(bearerToken(request))
  return user?.plan ?? 'free'
}

/** Read the raw request body as a string, with a hard size cap. */
function readRawBody(request, limit = 16384) {
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
    request.on('end', () => resolve(raw))
    request.on('error', () => reject(new HttpError('Could not read the request body.', 400)))
  })
}

/** Read a small JSON body from a POST, with a hard size cap. */
async function readJsonBody(request, limit = 4096) {
  const raw = await readRawBody(request, limit)
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new HttpError('Request body must be valid JSON.', 400)
  }
}

/** Resolve the caller and require that they are a configured admin. */
async function requireAdmin(request) {
  const user = await supabaseAuth.getUser(bearerToken(request))
  if (!user) throw new HttpError('Please sign in.', 401)
  if (!isAdminEmail(user.email)) throw new HttpError('Admin access is required for this action.', 403)
  return user
}

const normalizePlanValue = (value) => (PLAN_ORDER.includes(value) ? value : 'free')

/** Admin: the full user list with each subscription, for the console. */
async function handleAdminUsers(request) {
  await requireAdmin(request)
  const [users, planMap] = await Promise.all([
    supabaseAuth.listUsers(),
    supabaseAuth.listSubscriptionPlans(),
  ])
  return {
    users: users.map((user) => ({
      id: user.id,
      email: user.email ?? null,
      // Prefer the subscriptions table; fall back to app_metadata pre-migration.
      plan: planMap.get(user.id) ?? normalizePlanValue(user.app_metadata?.plan),
      confirmed: Boolean(user.email_confirmed_at),
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
    })),
  }
}

/** The signed-in user's profile (FPL team id + settings). */
async function handleGetProfile(request) {
  const user = await supabaseAuth.getUser(bearerToken(request))
  if (!user) throw new HttpError('Please sign in.', 401)
  const profile = await supabaseAuth.getProfile(user.id)
  return {
    fplTeamId: profile?.fpl_team_id ?? null,
    displayName: profile?.display_name ?? null,
    favoriteTeam: profile?.favorite_team ?? null,
  }
}

/** Update the signed-in user's own profile. Only the provided fields change. */
async function handleUpdateProfile(request) {
  const user = await supabaseAuth.getUser(bearerToken(request))
  if (!user) throw new HttpError('Please sign in.', 401)
  const body = await readJsonBody(request)

  const fields = {}
  if ('fplTeamId' in body) {
    const raw = String(body.fplTeamId ?? '').trim()
    if (raw === '') fields.fpl_team_id = null
    else if (/^\d{1,9}$/.test(raw)) fields.fpl_team_id = Number(raw)
    else throw new HttpError('FPL team ID must be the number from your team URL.', 400)
  }
  if ('displayName' in body) fields.display_name = String(body.displayName ?? '').slice(0, 80).trim() || null
  if ('favoriteTeam' in body) fields.favorite_team = String(body.favoriteTeam ?? '').slice(0, 8).trim().toUpperCase() || null

  const saved = await supabaseAuth.upsertProfile(user.id, user.email, fields)
  return {
    fplTeamId: saved?.fpl_team_id ?? null,
    displayName: saved?.display_name ?? null,
    favoriteTeam: saved?.favorite_team ?? null,
  }
}

/** Admin: manually set any user's subscription (upgrade or downgrade). */
async function handleAdminSetPlan(request) {
  await requireAdmin(request)
  const body = await readJsonBody(request)
  const plan = String(body.plan ?? '').toLowerCase()
  if (!body.userId) throw new HttpError('A userId is required.', 400)
  if (!PLAN_ORDER.includes(plan)) throw new HttpError('Unknown plan. Use free or pro.', 400)
  await supabaseAuth.setPlan(body.userId, plan)
  return { updated: true, userId: body.userId, plan }
}

/**
 * Start a Razorpay subscription for the signed-in user. Returns the id Razorpay
 * Checkout needs plus the public key id; entitlement is granted later, by the
 * webhook, not by whatever the browser reports back.
 */
async function handleSubscribe(request) {
  const user = await supabaseAuth.getUser(bearerToken(request))
  if (!user) throw new HttpError('Please sign in before subscribing.', 401)
  if (isEntitled(user.plan, 'captain-picks')) {
    return { alreadyPro: true, plan: user.plan }
  }
  const subscription = await razorpay.createSubscription({ userId: user.id, email: user.email })
  return {
    subscriptionId: subscription.id,
    keyId: razorpay.keyId,
    status: subscription.status,
    shortUrl: subscription.short_url ?? null,
  }
}

/**
 * Razorpay webhook. The signature is verified over the RAW body (a re-serialized
 * JSON would not match), then the mapped plan change is written. Always answers
 * 200 on a verified event so Razorpay does not needlessly retry.
 */
async function handleBillingWebhook(rawBody, signature) {
  if (!razorpay.verifyWebhook(rawBody, signature)) {
    throw new HttpError('Invalid webhook signature.', 400)
  }
  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    throw new HttpError('Webhook body was not valid JSON.', 400)
  }
  const change = razorpay.planChangeFor(event)
  if (change) {
    await supabaseAuth.setPlan(change.userId, change.plan)
  }
  return { received: true }
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

/**
 * Squad analysis gates differently from a board: the score, captain advice and
 * weak links are shown to everyone (diagnose the problem for free), while the
 * transfer suggestions — the fix — are the Pro payoff.
 */
function gateSquad(result, plan) {
  const meta = featureMeta('transfer-advisor')
  const unlocked = isEntitled(plan, 'transfer-advisor')
  const transferCount = result.transfers.length
  return {
    ...result,
    feature: meta.key,
    featureName: meta.name,
    requiredPlan: meta.requiredPlan,
    plan,
    locked: !unlocked,
    transferCount,
    transfers: unlocked ? result.transfers : [],
  }
}

/**
 * The briefing shows its headline to everyone plus the first section as a free
 * taste; the rest of the digest is the Pro payoff.
 */
function gateBriefing(result, plan) {
  const meta = featureMeta('weekly-briefing')
  const unlocked = isEntitled(plan, 'weekly-briefing')
  return {
    feature: meta.key,
    featureName: meta.name,
    requiredPlan: meta.requiredPlan,
    plan,
    gameweek: result.gameweek,
    gameweekName: result.gameweekName,
    deadline: result.deadline,
    phase: result.phase,
    generatedAt: result.generatedAt,
    headline: result.headline,
    locked: !unlocked,
    sections: unlocked ? result.sections : result.sections.slice(0, 1),
    lockedCount: unlocked ? 0 : Math.max(0, result.sections.length - 1),
  }
}

const routes = [
  {
    pattern: /^\/api\/health$/,
    cacheControl: 'public, max-age=30',
    handle: async () => ({
      status: 'ok',
      live: true,
      // Bump when server behaviour changes so a stale running process is obvious.
      build: SERVER_BUILD,
      planStore: 'subscriptions-table (live) + app_metadata fallback',
      providers: ['Football-Data.org', 'Fantasy Premier League (unofficial)'],
      footballDataConfigured: footballData.configured,
      billingConfigured: razorpay.configured,
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
    // Matchday — Premier League, straight from the FPL API.
    pattern: /^\/api\/spotlight$/,
    cacheControl: 'public, max-age=60',
    handle: async () => getSpotlight({ fpl }),
  },
  {
    // Player search — Premier League squad from the FPL API.
    pattern: /^\/api\/players\/search$/,
    cacheControl: 'public, max-age=60',
    handle: async (_match, url) => {
      const players = await searchPlayers({ query: url.searchParams.get('q') ?? '', fpl })
      return { competition: 'PL', players }
    },
  },
  {
    // Player report — Premier League, from the FPL API.
    pattern: /^\/api\/players\/([^/]+)\/dashboard$/,
    cacheControl: 'public, max-age=120',
    handle: async (match) => getPlayerDashboard({ identity: decodeURIComponent(match[1]), fpl }),
  },
  {
    // Captain intelligence. FPL-backed, so Premier League only. Premium feature
    // with a free preview of the single top pick. No-store: the response is
    // gated to the caller's plan, so it must never be cached and replayed after
    // an entitlement change (the projection itself is cached server-side).
    pattern: /^\/api\/intel\/captains$/,
    cacheControl: 'no-store',
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
    // Differentials — low-owned, high-projection picks. Premium, PL only.
    // No-store for the same reason as captains: the payload is plan-gated.
    pattern: /^\/api\/intel\/differentials$/,
    cacheControl: 'no-store',
    handle: async (_match, url, request) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      if (!competition.supportsFpl) {
        throw new HttpError('Differentials are available for the Premier League only.', 400)
      }
      const plan = await planOf(request)
      const result = await getDifferentials({ fpl, limit: 12 })
      return gateBoard(result, plan, 'differentials')
    },
  },
  {
    // Weekly Briefing — the plain-English gameweek digest. Premium, PL only.
    // No-store because the payload is gated to the caller's plan.
    pattern: /^\/api\/intel\/briefing$/,
    cacheControl: 'no-store',
    handle: async (_match, url, request) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      if (!competition.supportsFpl) {
        throw new HttpError('The Weekly Briefing is available for the Premier League only.', 400)
      }
      const plan = await planOf(request)
      const result = await getBriefing({ fpl })
      return gateBriefing(result, plan)
    },
  },
  {
    // Squad analysis for a connected FPL team. The projected score, captain
    // advice and weak links are free (the retention hook); the transfer fixes
    // are the Pro payoff. PL-only, no-store because it is personal to the caller.
    pattern: /^\/api\/intel\/squad$/,
    cacheControl: 'no-store',
    handle: async (_match, url, request) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      if (!competition.supportsFpl) {
        throw new HttpError('Team analysis is available for the Premier League only.', 400)
      }
      const entryId = parseEntryId(url.searchParams.get('entry'))
      const plan = await planOf(request)
      const result = await getSquadAnalysis({ fpl, entryId })
      return gateSquad(result, plan)
    },
  },
  {
    // Validate the current Supabase session and report the plan the server sees.
    pattern: /^\/api\/auth\/me$/,
    cacheControl: 'no-store',
    handle: async (_match, _url, request) => {
      const user = await supabaseAuth.getUser(bearerToken(request))
      if (!user) return { authenticated: false, user: null, isAdmin: false }
      return {
        authenticated: true,
        user: { id: user.id, email: user.email, plan: user.plan },
        isAdmin: isAdminEmail(user.email),
      }
    },
  },
  {
    // Admin console: every registered user with their subscription. Admin-gated.
    pattern: /^\/api\/admin\/users$/,
    cacheControl: 'no-store',
    handle: async (_match, _url, request) => handleAdminUsers(request),
  },
  {
    // The signed-in user's own profile (FPL team id + settings).
    pattern: /^\/api\/profile$/,
    cacheControl: 'no-store',
    handle: async (_match, _url, request) => handleGetProfile(request),
  },
]

// The write (POST) endpoints, dispatched by exact path. The Razorpay webhook is
// handled separately because it must verify a signature over the raw body.
const POST_ROUTES = {
  '/api/admin/users/plan': handleAdminSetPlan,
  '/api/billing/subscribe': handleSubscribe,
  '/api/profile': handleUpdateProfile,
}

const server = createServer(async (request, response) => {
  const origin = resolveOrigin(request.headers.origin, allowList)

  if (request.method === 'OPTIONS') return preflight(response, origin)

  let url
  try {
    url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
  } catch {
    return json(response, 400, { error: 'Malformed request URL.' }, { origin })
  }

  // The Razorpay webhook: server-to-server, signed, verified over the raw body.
  if (request.method === 'POST' && url.pathname === '/api/billing/webhook') {
    try {
      const rawBody = await readRawBody(request)
      const signature = request.headers['x-razorpay-signature']
      return json(response, 200, await handleBillingWebhook(rawBody, signature), { origin })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Webhook handling failed.'
      if (status === 500) console.error('Webhook error:', error)
      return json(response, status, { error: message }, { origin })
    }
  }

  // The write endpoints. Everything else is read-only GET.
  if (request.method === 'POST') {
    const handler = POST_ROUTES[url.pathname]
    if (!handler) return json(response, 404, { error: 'Route not found.' }, { origin })
    try {
      return json(response, 200, await handler(request), { origin })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'That request failed.'
      if (status === 500) console.error(`POST ${url.pathname} error:`, error)
      return json(response, status, { error: message }, { origin })
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(response, 405, { error: 'Only GET and the POST write endpoints are supported.' }, { origin })
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
  console.log(`PitchIQ proxy listening on http://${host}:${port} (build ${SERVER_BUILD})`)
  console.log(allowList.length > 0 ? `CORS restricted to: ${allowList.join(', ')}` : 'CORS open (set ALLOWED_ORIGINS to restrict)')
  if (!footballData.configured) {
    console.warn('Warning: FOOTBALL_DATA_API_KEY is not set. Live competition endpoints will return 503.')
  }
  if (!supabaseAuth.configured) {
    console.warn('Warning: SUPABASE_URL / SUPABASE_ANON_KEY are not set. Accounts are disabled and every request is treated as the free tier.')
  } else if (!supabaseAuth.canManage) {
    console.warn('Warning: SUPABASE_SERVICE_ROLE_KEY is not set. Sign-in works, but plan upgrades will fail until it is provided.')
  }
  if (!razorpay.configured) {
    console.warn('Warning: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_PLAN_ID are not set. Card & UPI checkout is disabled; grant Pro from the /admin console until they are provided.')
  } else if (!razorpay.webhookReady) {
    console.warn('Warning: RAZORPAY_WEBHOOK_SECRET is not set. Checkout can open, but subscriptions will not activate Pro until the webhook secret is provided.')
  }
})
