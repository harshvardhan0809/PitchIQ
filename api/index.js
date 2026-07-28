import { handleRequest } from '../server/index.js'

/**
 * Single serverless entry for every `/api/*` request. `vercel.json` rewrites all
 * of `/api/(.*)` here, so this one function handles every route regardless of
 * depth (`/api/intel/differentials`, `/api/players/123/dashboard`, …). The
 * original request path survives on `request.url`, which is what the shared
 * router matches on.
 *
 * `bodyParser: false` keeps the raw request stream intact so the Razorpay
 * webhook can verify its HMAC over the exact bytes Razorpay sent. `maxDuration`
 * gives the heaviest call (projections after a cold cache) headroom.
 */
export const config = {
  maxDuration: 30,
  api: { bodyParser: false },
}

export default function handler(request, response) {
  return handleRequest(request, response)
}
