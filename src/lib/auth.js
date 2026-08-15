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
const CHANGE_EVENT = 'pitchiq-auth-change'
const DEMO_KEY = 'pitchiq_demo_auth'
const API_BASE = import.meta.env.VITE_API_URL ?? ''
export const PLAN_NAMES = { free: 'Free', pro: 'Pro' }

// Two tiers now; a legacy 'elite' session maps to 'pro' so access is preserved.
const normalizePlan = (value) => (value === 'pro' || value === 'elite' ? 'pro' : 'free')

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
    user: user ? { id: user.id, email: user.email, createdAt: user.created_at ?? null } : null,
    plan: normalizePlan(user?.app_metadata?.plan),
    token: session?.access_token ?? null,
    ready: true,
  }
}

export function getPlan() { return snapshot.plan }
export function getAccessToken() { return snapshot.token }

/**
 * Return a *valid* access token for an authenticated request. Reading the cached
 * snapshot can hand back a token that expired while the tab sat idle; asking
 * Supabase for the session refreshes it if needed. This is what gated fetches
 * use, so a Pro user is never locked out by a stale token that simply needed a
 * refresh. Falls back to the snapshot token (demo/offline) if anything fails.
 */
export async function getFreshAccessToken() {
  if (!supabaseConfigured) return snapshot.token
  try {
    const supabase = await loadSupabase()
    if (!supabase) return snapshot.token
    const { data } = await supabase.auth.getSession()
    const session = data?.session ?? null
    if (session) {
      // Sync only the token, not the plan. The server reads the plan live from
      // its own store, so the token needn't carry it; deriving plan from a token
      // that briefly lags a change would fight setLocalPlan. Plan updates come
      // from login/refresh (onAuthStateChange) and setLocalPlan instead.
      if (session.access_token !== snapshot.token) {
        publish({
          ...snapshot,
          token: session.access_token,
          user: snapshot.user ?? (session.user ? { id: session.user.id, email: session.user.email } : null),
          ready: true,
        })
      }
      return session.access_token
    }
  } catch { /* fall back to whatever we have */ }
  return snapshot.token
}

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
      .then(async ({ data }) => {
        if (!data.session) { publish(fromSession(null)); return }
        // The persisted session's token carries the app_metadata from when it was
        // minted, so a plan written server-side afterwards (e.g. a Pro upgrade)
        // would not show until the token next refreshed. Refresh on load so a
        // returning user always sees their current plan, not a stale one.
        try {
          const { data: refreshed, error } = await supabase.auth.refreshSession()
          publish(fromSession(error ? data.session : (refreshed.session ?? data.session)))
        } catch {
          publish(fromSession(data.session))
        }
        // Token app_metadata is not authoritative for the plan — ask the server.
        refreshPlanFromServer()
      })
      .catch(() => publish({ ...snapshot, ready: true }))
    supabase.auth.onAuthStateChange((_event, session) => {
      publish(fromSession(session))
      if (session) refreshPlanFromServer()
    })
  })
} else {
  const demo = readDemo()
  if (demo?.user) snapshot = { user: demo.user, plan: normalizePlan(demo.user.plan), token: 'demo', ready: true }
}

// --- actions ---------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 6

// Validate credentials in one place so *every* entry point (login page, account
// menu, anywhere) enforces them — a form that forgets `required` can't slip an
// empty password through.
function assertCredentials(email, password) {
  if (!EMAIL_RE.test(String(email ?? '').trim())) throw new Error('Enter a valid email address.')
  if (!password || password.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`)
  }
}

export async function signUp(email, password) {
  if (!supabaseConfigured) return demoSignIn(email)
  assertCredentials(email, password)
  const supabase = await loadSupabase()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  return { needsConfirmation: !data.session }
}

export async function signInWithPassword(email, password) {
  if (!supabaseConfigured) return demoSignIn(email)
  assertCredentials(email, password)
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
  if (!EMAIL_RE.test(String(email ?? '').trim())) throw new Error('Enter a valid email address.')
  const supabase = await loadSupabase()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Magic links sign in EXISTING accounts only — they must not create a
    // password-less account. New users sign up with a password first.
    options: { emailRedirectTo: postAuthRedirect(), shouldCreateUser: false },
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

/**
 * Update the locally-known plan without touching the token. The server reads the
 * real plan from its own store (the subscriptions table), so gated views only
 * need the client to re-render and re-fetch — no token refresh, which avoids the
 * refresh-token rotation that made repeated changes flaky.
 */
export function setLocalPlan(plan) {
  publish({ ...snapshot, plan: normalizePlan(plan) })
}

/**
 * Pull the latest session so a plan just written server-side (e.g. by the
 * billing webhook after checkout) is reflected in the app. Safe to call
 * repeatedly; a no-op in demo mode.
 */
export async function refreshSession() {
  if (!supabaseConfigured) return getPlan()
  const supabase = await loadSupabase()
  try {
    const { data } = await supabase.auth.refreshSession()
    if (data?.session) publish(fromSession(data.session))
  } catch { /* keep the current snapshot */ }
  // The plan is authoritative on the server, not in the token — sync it too.
  return refreshPlanFromServer()
}

/**
 * Sync the displayed plan with the server's AUTHORITATIVE entitlement. The server
 * reads the live subscriptions table (GET /api/auth/me), so this — not the JWT's
 * app_metadata — is the source of truth for what the UI shows. Security is
 * unaffected: every gated API call is re-checked server-side regardless of what
 * the client believes. A no-op in demo/offline mode.
 */
export async function refreshPlanFromServer() {
  if (!supabaseConfigured) return getPlan()
  const token = await getFreshAccessToken()
  if (!token || token === 'demo') return getPlan()
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const body = await res.json().catch(() => null)
      if (body?.user?.plan) setLocalPlan(body.user.plan)
    }
  } catch { /* keep the current snapshot */ }
  return getPlan()
}

export async function signOut() {
  if (!supabaseConfigured) { writeDemo(null); demoPublish(null); return }
  const supabase = await loadSupabase()
  await supabase.auth.signOut()
}

/**
 * Send a password-reset email. Supabase mails a recovery link that returns to
 * /reset-password with a temporary session, where the user sets a new password.
 * Always resolves the same way whether or not the email exists, so this can't be
 * used to probe which addresses have accounts.
 */
export async function sendPasswordReset(email) {
  if (!supabaseConfigured) throw new Error('Password reset requires an account.')
  if (!EMAIL_RE.test(String(email ?? '').trim())) throw new Error('Enter a valid email address.')
  const supabase = await loadSupabase()
  const { error } = await supabase.auth.resetPasswordForEmail(String(email).trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw new Error(error.message)
  return { resetSent: true }
}

/**
 * Set a new password during a reset. Runs on /reset-password, where the recovery
 * link has already established a temporary session, so it only needs the new
 * password (no current-password check — the emailed link is the proof).
 */
export async function completePasswordReset(newPassword) {
  if (!supabaseConfigured) throw new Error('Password reset requires an account.')
  if (!newPassword || newPassword.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`)
  }
  const supabase = await loadSupabase()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
  return {}
}

/**
 * Change the signed-in user's password. The current password is re-verified
 * first (Supabase's updateUser alone doesn't check it), so a walked-away session
 * can't be used to silently reset the password.
 */
export async function changePassword(currentPassword, newPassword) {
  if (!supabaseConfigured) throw new Error('Changing your password requires an account.')
  const email = snapshot.user?.email
  if (!email) throw new Error('Please sign in again to change your password.')
  if (!newPassword || newPassword.length < MIN_PASSWORD) {
    throw new Error(`New password must be at least ${MIN_PASSWORD} characters.`)
  }
  if (currentPassword === newPassword) throw new Error('Choose a password different from your current one.')

  const supabase = await loadSupabase()
  // Re-authenticate to confirm the current password before allowing the change.
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) throw new Error('Your current password is incorrect.')

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
  return {}
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
    changePassword,
    sendPasswordReset,
    completePasswordReset,
  }
}
