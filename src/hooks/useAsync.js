import { useCallback, useEffect, useState } from 'react'

const IDLE = { status: 'idle', data: null, error: null, reload: () => {} }
const LOADING = { status: 'loading', data: null, error: null }

/**
 * Runs `fetcher(...args)` whenever the arguments change.
 *
 * Two properties keep this honest. The fetcher is a stable module-level
 * function and the arguments are serialized, so the effect's dependencies are
 * plain values rather than a closure that changes identity every render. And
 * loading is *derived* — if the settled result does not carry the current
 * argument key, the request for those arguments is still outstanding.
 *
 * That derivation is the fix for a real bug: an earlier version shared one
 * mutable `status` between the search and the dashboard, so a search that
 * resolved to the already-selected player left the page stuck on "loading"
 * with nothing left to flip it back. Here a stuck state is not expressible.
 */
export function useAsync(fetcher, args = [], { enabled = true, refreshKey = 0 } = {}) {
  const argsKey = JSON.stringify(args)
  // A manual reload nonce lets an error's "Try again" re-run the same request.
  const [reloadTick, setReloadTick] = useState(0)
  const scope = `${refreshKey}|${reloadTick}`
  const requestKey = `${argsKey}|${scope}`

  const [settled, setSettled] = useState({ key: null, status: 'idle', data: null, error: null })
  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false

    Promise.resolve()
      .then(() => fetcher(...JSON.parse(argsKey)))
      .then((data) => {
        if (!cancelled) setSettled({ key: `${argsKey}|${scope}`, status: 'ready', data, error: null })
      })
      .catch((error) => {
        if (!cancelled) setSettled({ key: `${argsKey}|${scope}`, status: 'error', data: null, error })
      })

    return () => {
      cancelled = true
    }
  }, [fetcher, argsKey, scope, enabled])

  if (!enabled) return { ...IDLE, reload }
  if (settled.key !== requestKey) return { ...LOADING, reload }
  return { status: settled.status, data: settled.data, error: settled.error, reload }
}

/** Debounce a rapidly changing value, e.g. search input. */
export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debounced
}
