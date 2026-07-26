/**
 * TTL cache with a hard entry cap and single-flight request coalescing.
 *
 * The entry cap matters because the proxy runs as a long-lived process and
 * caches one entry per player summary; without it the map only ever grows.
 * Coalescing matters because the providers are metered — a burst of identical
 * requests on a cold cache should cost one upstream call, not N.
 */
export class TtlCache {
  constructor({ maxEntries = 500 } = {}) {
    this.maxEntries = maxEntries
    this.entries = new Map()
    this.inFlight = new Map()
  }

  get(key) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Refresh recency so the eviction below drops genuinely cold entries.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key, value, ttl) {
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: Date.now() + ttl })
    this.evict()
  }

  /** Forget one entry — used to invalidate a cached session after a plan change. */
  delete(key) {
    this.entries.delete(key)
  }

  evict() {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
    // Map iteration is insertion-ordered, so the front is the least recently used.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
  }

  /** Return the cached value, or run `produce` once for all concurrent callers. */
  async resolve(key, ttl, produce) {
    const cached = this.get(key)
    if (cached !== undefined) return cached

    const pending = this.inFlight.get(key)
    if (pending) return pending

    const promise = (async () => {
      const value = await produce()
      this.set(key, value, ttl)
      return value
    })()

    this.inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(key)
    }
  }

  get size() {
    return this.entries.size
  }
}
