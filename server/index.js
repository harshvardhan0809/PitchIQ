import { createServer } from 'node:http'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
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
import { getPriceWatch } from './lib/intelligence/priceWatch.js'
import { getLeagueWarRoom } from './lib/intelligence/league.js'
import { getManagerAnalysis } from './lib/intelligence/manager.js'
import { parseLeagueId } from './lib/providers/fpl.js'
import { parseEntryId } from './lib/providers/fpl.js'
import { RazorpayClient } from './lib/providers/razorpay.js'
import { featureMeta, isEntitled, PLAN_ORDER } from './lib/entitlements.js'
import { SupabaseAuth } from './lib/supabaseAuth.js'
import { DEFAULT_SETTINGS, sanitizeSettings, withDefaults } from './lib/settings.js'

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
const SERVER_BUILD = '2026-08-02-billing-confirm'

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

// --- App settings (admin-tuned) --------------------------------------------
// The last-known settings are held in-process and refreshed from Supabase on a
// short TTL, so the hot path (/api/config on every app load) doesn't hit the DB
// each time. `persisted` records whether the app_settings table actually
// answered, so the admin console can warn when changes are memory-only.
const settingsState = { value: DEFAULT_SETTINGS, persisted: false, fetchedAt: 0 }
const SETTINGS_TTL_MS = 10 * 1000

async function loadSettings({ force = false } = {}) {
  const fresh = Date.now() - settingsState.fetchedAt < SETTINGS_TTL_MS
  if (!force && fresh) return settingsState.value
  try {
    const { present, value } = await supabaseAuth.getAppSettings()
    // `present` reflects the table existing (a durable store), even before the
    // first row is written. Only overwrite our in-memory copy when a row exists.
    if (value) settingsState.value = withDefaults(value)
    settingsState.persisted = present
  } catch {
    settingsState.persisted = false
  }
  settingsState.fetchedAt = Date.now()
  return settingsState.value
}

/** Admin write path: sanitize over the current values, persist, cache. */
async function persistSettings(patch) {
  const base = await loadSettings({ force: true })
  const next = sanitizeSettings(patch, base)
  let persisted
  try {
    await supabaseAuth.saveAppSettings(next)
    persisted = true
  } catch (error) {
    // Re-throw only if we truly have no way to store it; otherwise keep it in
    // memory so a table-less dev setup still works for the current process.
    if (!supabaseAuth.canManage) throw error
    persisted = false
  }
  settingsState.value = next
  settingsState.persisted = persisted
  settingsState.fetchedAt = Date.now()
  return { settings: next, persisted }
}

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

/**
 * Read the raw request body as a string, with a hard size cap.
 *
 * Under a plain Node server the body arrives as an unconsumed stream. Under a
 * serverless host (Vercel) the runtime may have already buffered and parsed it
 * onto `request.body` — in which case the stream is spent and listening for
 * 'data'/'end' would hang. So prefer an already-buffered body when present, and
 * only fall back to reading the stream. For a pre-parsed object we re-serialise;
 * that is fine for the JSON POST routes, and the webhook route disables body
 * parsing (see api/[...path].js) so it still gets the exact bytes it must hash.
 */
function readRawBody(request, limit = 16384) {
  const buffered = request.body
  if (buffered !== undefined && buffered !== null) {
    let raw
    if (typeof buffered === 'string') raw = buffered
    else if (Buffer.isBuffer(buffered)) raw = buffered.toString('utf8')
    else raw = JSON.stringify(buffered)
    if (Buffer.byteLength(raw) > limit) throw new HttpError('Request body too large.', 413)
    return Promise.resolve(raw)
  }

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
  // A serverless host may hand us the already-parsed object directly.
  const buffered = request.body
  if (buffered && typeof buffered === 'object' && !Buffer.isBuffer(buffered)) {
    return buffered
  }
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

/** Admin: save the app-wide settings (ad cadence, banner, features, defaults). */
async function handleAdminSaveSettings(request) {
  await requireAdmin(request)
  const body = await readJsonBody(request)
  const { settings, persisted } = await persistSettings(body)
  return { settings, persisted }
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
 * Confirm a just-completed checkout without waiting on the webhook. The server
 * fetches the subscription straight from Razorpay (authoritative — the browser
 * is never trusted), checks it belongs to the signed-in user, and grants Pro if
 * the mandate is authorized/active. The webhook still handles later renewals and
 * cancellations; this only removes the "webhook can't reach localhost" gap so a
 * paid user gets access immediately.
 */
async function handleBillingConfirm(request) {
  const user = await supabaseAuth.getUser(bearerToken(request))
  if (!user) throw new HttpError('Please sign in.', 401)
  const body = await readJsonBody(request)
  const subscriptionId = String(body.subscriptionId ?? '').trim()
  if (!subscriptionId) throw new HttpError('A subscription id is required.', 400)

  const subscription = await razorpay.getSubscription(subscriptionId)
  // A user may only confirm their OWN subscription — the id in Razorpay's notes
  // must match the caller, so nobody can activate off someone else's payment.
  if (subscription?.notes?.userId && subscription.notes.userId !== user.id) {
    throw new HttpError('That subscription belongs to a different account.', 403)
  }

  const active = razorpay.isActiveStatus(subscription?.status)
  if (active) {
    await supabaseAuth.setPlan(user.id, 'pro')
    return { activated: true, plan: 'pro', status: subscription.status }
  }
  return { activated: false, plan: user.plan, status: subscription?.status ?? 'unknown' }
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

/**
 * Price Watch gates by count, not by hiding a hero: the free tier sees the top
 * few risers and fallers (the daily-habit hook), while Pro sees the full boards.
 */
function gatePriceWatch(result, plan) {
  const meta = featureMeta('price-predictor')
  const unlocked = isEntitled(plan, 'price-predictor')
  const FREE_PER_SIDE = 3
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
    totalManagers: result.totalManagers,
  }
  if (unlocked) {
    return { ...base, locked: false, risers: result.risers, fallers: result.fallers, lockedCount: 0 }
  }
  const hidden = Math.max(0, result.risers.length - FREE_PER_SIDE)
    + Math.max(0, result.fallers.length - FREE_PER_SIDE)
  return {
    ...base,
    locked: true,
    risers: result.risers.slice(0, FREE_PER_SIDE),
    fallers: result.fallers.slice(0, FREE_PER_SIDE),
    lockedCount: hidden,
  }
}

/**
 * War Room gates the strategy layer: everyone sees the standings table and their
 * exact gap to overtake (the free, shareable hook), while the rival captains,
 * league template and your differentials — the competitive edge — are Pro. The
 * deep intel is only computed for Pro callers (see the route), so free requests
 * stay a single cheap standings fetch.
 */
function gateLeague(result, plan) {
  const meta = featureMeta('mini-league')
  const unlocked = isEntitled(plan, 'mini-league')
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
    league: result.league,
    event: result.event,
    you: result.you,
    standings: result.standings,
  }
  if (unlocked) {
    return {
      ...base,
      locked: false,
      captains: result.captains,
      template: result.template,
      yourDifferentials: result.yourDifferentials,
      deepCount: result.deepCount,
    }
  }
  return {
    ...base,
    locked: true,
    captains: [],
    template: [],
    yourDifferentials: [],
    lockedCount: Math.min(12, result.standings.length),
  }
}

/**
 * Manager's Mindset gates the depth: everyone sees the team, its mentality
 * archetype and what that means (the shareable read); the trait breakdown and
 * how the mindset shapes the next match are the Pro payoff.
 */
function gateManager(result, plan) {
  const meta = featureMeta('manager-mindset')
  const unlocked = isEntitled(plan, 'manager-mindset')
  const base = {
    feature: meta.key,
    featureName: meta.name,
    requiredPlan: meta.requiredPlan,
    plan,
    gameweek: result.gameweek,
    gameweekName: result.gameweekName,
    phase: result.phase,
    generatedAt: result.generatedAt,
    dataDepth: result.dataDepth,
    teams: result.teams,
    team: result.team,
  }
  if (unlocked) {
    return { ...base, locked: false, profile: result.profile, nextMatch: result.nextMatch }
  }
  // Free: the archetype read only — traits, ratings, record and next-match locked.
  const { archetype, mentality, effect } = result.profile
  return {
    ...base,
    locked: true,
    profile: { archetype, mentality, effect, ratings: null, traits: [], record: null },
    nextMatch: null,
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
    // Public app configuration the running app reads on load: ad cadence & copy,
    // the announcement banner, feature visibility and the Manager default club.
    // No secrets — every field is admin-tuned presentation.
    pattern: /^\/api\/config$/,
    cacheControl: 'no-store',
    handle: async () => {
      const settings = await loadSettings()
      return { build: SERVER_BUILD, ...settings }
    },
  },
  {
    // Admin: the editable settings plus diagnostics for the console.
    pattern: /^\/api\/admin\/settings$/,
    cacheControl: 'no-store',
    handle: async (_match, _url, request) => {
      await requireAdmin(request)
      const settings = await loadSettings({ force: true })
      return {
        settings,
        diagnostics: {
          serverBuild: SERVER_BUILD,
          settingsPersisted: settingsState.persisted,
          supabaseConfigured: supabaseAuth.configured,
          supabaseManage: supabaseAuth.canManage,
          billingConfigured: razorpay.configured,
          adminEmails: adminEmails.length,
          liveData: true,
          cacheEntries: cache.size,
        },
      }
    },
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
    // Price Change Predictor — tonight's likely risers and fallers from live
    // transfer momentum. Premium with a free preview of the top few each way.
    // No-store because the payload is gated to the caller's plan.
    pattern: /^\/api\/intel\/prices$/,
    cacheControl: 'no-store',
    handle: async (_match, url, request) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      if (!competition.supportsFpl) {
        throw new HttpError('The Price Change Predictor is available for the Premier League only.', 400)
      }
      const plan = await planOf(request)
      const result = await getPriceWatch({ fpl, limit: 15 })
      return gatePriceWatch(result, plan)
    },
  },
  {
    // Mini-League War Room — standings + your gap to overtake (free), plus rival
    // captains, the league template and your differentials (Pro). PL-only,
    // no-store because the payload is gated to the caller's plan.
    pattern: /^\/api\/intel\/league$/,
    cacheControl: 'no-store',
    handle: async (_match, url, request) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      if (!competition.supportsFpl) {
        throw new HttpError('The Mini-League War Room is available for the Premier League only.', 400)
      }
      const leagueId = parseLeagueId(url.searchParams.get('id'))
      const entryParam = url.searchParams.get('entry')
      const entryId = entryParam ? parseEntryId(entryParam) : null
      const plan = await planOf(request)
      const deep = isEntitled(plan, 'mini-league')
      const result = await getLeagueWarRoom({ fpl, leagueId, entryId, deep })
      return gateLeague(result, plan)
    },
  },
  {
    // Manager's Mindset — a club's tactical mentality read from its on-pitch
    // behaviour, and how it shapes the next fixture. Premium, PL only, no-store
    // because the payload is gated to the caller's plan.
    pattern: /^\/api\/intel\/manager$/,
    cacheControl: 'no-store',
    handle: async (_match, url, request) => {
      const competition = getCompetition(url.searchParams.get('league') ?? defaultCompetition)
      if (!competition.supportsFpl) {
        throw new HttpError('Manager analysis is available for the Premier League only.', 400)
      }
      const teamParam = url.searchParams.get('team')
      const teamId = teamParam && /^\d{1,3}$/.test(teamParam) ? Number(teamParam) : null
      const plan = await planOf(request)
      const { managerDefaultTeam } = await loadSettings()
      const result = await getManagerAnalysis({ fpl, teamId, defaultTeamShort: managerDefaultTeam })
      return gateManager(result, plan)
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
  '/api/admin/settings': handleAdminSaveSettings,
  '/api/billing/subscribe': handleSubscribe,
  '/api/billing/confirm': handleBillingConfirm,
  '/api/profile': handleUpdateProfile,
}

/**
 * The single request handler for every route. Exported so a serverless host
 * (Vercel) can invoke it directly with its (req, res); locally it is wrapped in
 * a long-running node:http server below.
 */
export async function handleRequest(request, response) {
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
}

/** True only when this file is the process entry point (local `npm run api`). */
function isEntryPoint() {
  try {
    return Boolean(process.argv[1])
      && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

// Local development: wrap the handler in a long-running server. On a serverless
// host the file is imported (not the entry point), so nothing listens — the
// platform calls handleRequest per request instead.
if (isEntryPoint()) {
  const server = createServer(handleRequest)
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
}
