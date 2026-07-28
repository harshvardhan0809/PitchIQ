import { handleRequest } from '../server/index.js'

/**
 * Vercel catch-all for every `/api/*` request. Vercel runs this per request with
 * a Node (req, res) pair, which is what the shared handler expects.
 *
 * `bodyParser: false` keeps the raw request stream intact so the Razorpay
 * webhook can verify its HMAC over the exact bytes Razorpay sent; the JSON POST
 * routes read the stream themselves too. `maxDuration` gives the heaviest call
 * (projections after a cold cache) headroom over the default.
 */
export const config = {
  maxDuration: 30,
  api: { bodyParser: false },
}

export default function handler(request, response) {
  return handleRequest(request, response)
}
