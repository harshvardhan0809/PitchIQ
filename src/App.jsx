import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { useAuth } from './lib/auth'

// Split the heavier surfaces so the landing page loads fast.
const ProductPage = lazy(() => import('./pages/ProductPage')
  .then((module) => ({ default: module.ProductPage })))
const PricingPage = lazy(() => import('./pages/PricingPage')
  .then((module) => ({ default: module.PricingPage })))

function RouteFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#080b09', color: '#93a49b' }}>
      Loading…
    </div>
  )
}

/**
 * Gate a route behind sign-in. Waits for the session check to finish before
 * deciding, so a signed-in user refreshing the page isn't bounced to /login.
 */
function RequireAuth({ children }) {
  const { ready, signedIn } = useAuth()
  const location = useLocation()

  if (!ready) return <RouteFallback />
  if (!signedIn) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  return children
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        {/* The product requires an account. */}
        <Route path="/app" element={<RequireAuth><ProductPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
