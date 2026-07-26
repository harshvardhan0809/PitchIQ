import { HttpError } from './http.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sliding-window rate limiter with a bounded wait.
 *
 * Metered providers (Football-Data's free tier is 10 requests/minute) reject
 * bursts outright. This spreads calls instead: a burst *waits* for a slot
 * rather than being turned into a 429. Only when the backlog would push a call
 * past `maxWaitMs` does it give up — and then it raises a 429 the client can
 * retry, which is strictly better than the provider doing so unpredictably.
 *
 * Slots are reserved synchronously (no await between deciding a run time and
 * recording it), so a burst of concurrent callers serialises correctly onto the
 * window without racing. The reserved list is capped at `limit`, so memory is
 * bounded regardless of traffic.
 */
export class RateLimiter {
  constructor({ limit, intervalMs, maxWaitMs = Infinity, label = 'provider' } = {}) {
    this.limit = limit
    this.intervalMs = intervalMs
    this.maxWaitMs = maxWaitMs
    this.label = label
    this.reserved = [] // sorted run times of the last up-to-`limit` calls
  }

  /** Reserve the next slot and return how long to wait before using it. */
  reserve() {
    const now = Date.now()
    let runAt = now
    if (this.reserved.length >= this.limit) {
      // The oldest of the last `limit` calls must leave the window first.
      runAt = Math.max(now, this.reserved[0] + this.intervalMs)
    }

    const wait = runAt - now
    if (wait > this.maxWaitMs) {
      throw new HttpError(
        `The ${this.label} is busy right now. Please retry in a moment.`,
        429,
        { retryAfter: Math.ceil(wait / 1000) },
      )
    }

    this.reserved.push(runAt)
    this.reserved.sort((left, right) => left - right)
    if (this.reserved.length > this.limit) this.reserved.shift()
    return wait
  }

  /** Run `task` no sooner than its scheduled slot allows. */
  async schedule(task) {
    const wait = this.reserve()
    if (wait > 0) await delay(wait)
    return task()
  }
}

/** A limiter that never delays — for providers without a meaningful cap. */
export class NoopLimiter {
  schedule(task) {
    return task()
  }
}
