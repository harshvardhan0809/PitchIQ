import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { useAuth } from './lib/auth'
import { useIsAdmin } from './hooks/useIsAdmin'

// Split the heavier surfaces so the landing page loads fast.
const ProductPage = lazy(() => import('./pages/ProductPage')
  .then((module) => ({ default: module.ProductPage })))
const PricingPage = lazy(() => import('./pages/PricingPage')
  .then((module) => ({ default: module.PricingPage })))
const AdminPage = lazy(() => import('./pages/AdminPage')
  .then((module) => ({ default: module.AdminPage })))

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

/**
 * Gate the admin console. To a non-admin the route is invisible: once we know
 * they're not an admin we send them to the app, so /admin gives no hint an admin
 * area exists. The server enforces admin-only on the data regardless.
 */
function RequireAdmin({ children }) {
  const { ready, signedIn } = useAuth()
  const isAdmin = useIsAdmin()
  const location = useLocation()

  if (!ready) return <RouteFallback />
  if (!signedIn) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  if (isAdmin === null) return <RouteFallback /> // still verifying
  if (!isAdmin) return <Navigate to="/app" replace />
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
        {/* Admin console — hidden from non-admins (they're bounced to /app). */}
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
