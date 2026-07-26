/**
 * Supabase client, created lazily.
 *
 * `supabaseConfigured` is known synchronously from the env, so the UI can decide
 * immediately whether real auth is available. The client itself (and the ~57 KB
 * SDK) is imported dynamically on first use, so it stays out of the initial
 * bundle even though the account menu lives in the global top bar.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

let clientPromise = null

export function loadSupabase() {
  if (!supabaseConfigured) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => (
      createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    ))
  }
  return clientPromise
}
