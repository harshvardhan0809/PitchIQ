import { useEffect, useState } from 'react'
import { loadSupabase, supabaseConfigured } from './supabaseClient'

/**
 * Auth for the app.
 *
 * When Supabase is configured it owns identity: it manages the session (with
 * automatic token refresh) and issues the access token the API sends as a bearer
 * credential. The plan lives in the user's `app_metadata` — only the server's
 * service role can write it — so it travels inside Supabase's signed token and a
 * free user cannot self-upgrade.
 *
 * When Supabase is NOT configured the same surface is simulated locally so the
 * app runs offline and the demo remains explorable. That path is clearly a
 * simulation, not a security boundary.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? ''
const CHANGE_EVENT = 'pitchiq-auth-change'
const DEMO_KEY = 'pitchiq_demo_auth'
const DEMO_CODES = { 'PITCHIQ-PRO': 'pro', 'PITCHIQ-ELITE': 'elite' }
export const PLAN_NAMES = { free: 'Free', pro: 'Pro', elite: 'Elite' }

const normalizePlan = (value) => (value === 'pro' || value === 'elite' ? value : 'free')

// A single source of truth kept fresh by Supabase auth events (or demo writes);
// synchronous getters read from it so the API client needs no async plumbing.
// `ready` flips true once the initial session check completes, so route guards
// don't bounce a signed-in user before their session is restored.
let snapshot = { user: null, plan: 'free', token: null, ready: !supabaseConfigured }

function publish(next) {
  snapshot = next
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

function fromSession(session) {
  const user = session?.user ?? null
  return {
    user: user ? { id: user.id, email: user.email } : null,
    plan: normalizePlan(user?.app_metadata?.plan),
    token: session?.access_token ?? null,
    ready: true,
  }
}

export function getPlan() { return snapshot.plan }
export function getAccessToken() { return snapshot.token }

// --- demo (no Supabase) ----------------------------------------------------
function readDemo() {
  try { return JSON.parse(window.localStorage.getItem(DEMO_KEY)) || null } catch { return null }
}
function writeDemo(session) {
  try {
    if (session) window.localStorage.setItem(DEMO_KEY, JSON.stringify(session))
    else window.localStorage.removeItem(DEMO_KEY)
  } catch { /* ignore private-mode storage errors */ }
}
function demoPublish(user) {
  publish({ user, plan: user ? normalizePlan(user.plan) : 'free', token: user ? 'demo' : null, ready: true })
}

// --- initialisation --------------------------------------------------------
if (supabaseConfigured) {
  loadSupabase().then((supabase) => {
    if (!supabase) { publish({ ...snapshot, ready: true }); return }
    supabase.auth.getSession()
      .then(({ data }) => publish(fromSession(data.session)))
      .catch(() => publish({ ...snapshot, ready: true }))
    supabase.auth.onAuthStateChange((_event, session) => publish(fromSession(session)))
  })
} else {
  const demo = readDemo()
  if (demo?.user) snapshot = { user: demo.user, plan: normalizePlan(demo.user.plan), token: 'demo', ready: true }
}

// --- actions ---------------------------------------------------------------
export async function signUp(email, password) {
  if (!supabaseConfigured) return demoSignIn(email)
  const supabase = await loadSupabase()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  return { needsConfirmation: !data.session }
}

export async function signInWithPassword(email, password) {
  if (!supabaseConfigured) return demoSignIn(email)
  const supabase = await loadSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return {}
}

// After an email link or OAuth round-trip, land the user inside the app, not
// back on the marketing home page. Computed lazily so module load never touches
// window.
const postAuthRedirect = () => `${window.location.origin}/app`

export async function signInWithMagicLink(email) {
  if (!supabaseConfigured) return demoSignIn(email)
  const supabase = await loadSupabase()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: postAuthRedirect() },
  })
  if (error) throw new Error(error.message)
  return { magicLinkSent: true }
}

export async function signInWithGoogle() {
  if (!supabaseConfigured) throw new Error('Google sign-in requires Supabase to be configured.')
  const supabase = await loadSupabase()
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: postAuthRedirect() },
  })
  if (error) throw new Error(error.message)
  return {}
}

export async function signOut() {
  if (!supabaseConfigured) { writeDemo(null); demoPublish(null); return }
  const supabase = await loadSupabase()
  await supabase.auth.signOut()
}

export async function redeemCode(code) {
  if (!supabaseConfigured) {
    const plan = DEMO_CODES[String(code ?? '').trim().toUpperCase()] ?? 'free'
    if (plan === 'free') return { upgraded: false, codeRejected: true }
    const user = { ...(snapshot.user ?? { email: 'demo@local' }), plan }
    writeDemo({ user }); demoPublish(user)
    return { upgraded: true, plan }
  }

  if (!snapshot.token) throw new Error('Please sign in before upgrading.')

  let response
  try {
    response = await fetch(`${API_BASE}/api/auth/upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${snapshot.token}` },
      body: JSON.stringify({ code }),
    })
  } catch {
    throw new Error('Could not reach the server. Make sure the API is running (npm run api).')
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? 'Upgrade failed.')

  // The plan is now written to the account. Refresh the token so it carries the
  // new app_metadata, then publish using the plan the server just confirmed —
  // authoritative, and immune to any token-claim propagation lag.
  if (body.upgraded) {
    const supabase = await loadSupabase()
    await supabase.auth.refreshSession().catch(() => {})
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    publish({
      user: session?.user ? { id: session.user.id, email: session.user.email } : snapshot.user,
      plan: normalizePlan(body.plan),
      token: session?.access_token ?? snapshot.token,
      ready: true,
    })
  }
  return body
}

function demoSignIn(email) {
  const user = { email, plan: 'free' }
  writeDemo({ user }); demoPublish(user)
  return {}
}

// --- hook ------------------------------------------------------------------
export function useAuth() {
  const [snap, setSnap] = useState(snapshot)

  useEffect(() => {
    const sync = () => setSnap(snapshot)
    sync() // catch any change between module init and mount
    window.addEventListener(CHANGE_EVENT, sync)
    return () => window.removeEventListener(CHANGE_EVENT, sync)
  }, [])

  return {
    user: snap.user,
    plan: snap.plan,
    planName: PLAN_NAMES[snap.plan],
    signedIn: Boolean(snap.user),
    ready: snap.ready,
    configured: supabaseConfigured,
    signUp,
    signInWithPassword,
    signInWithMagicLink,
    signInWithGoogle,
    signOut,
    redeemCode,
  }
}
