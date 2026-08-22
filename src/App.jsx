import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { useAuth } from './lib/auth'
import { useIsAdmin } from './hooks/useIsAdmin'
import { useAppConfig } from './lib/appConfigContext'
import { TargetCursor } from './components/TargetCursor'
import { MaintenanceScreen } from './components/MaintenanceScreen'

// While maintenance is on, only these paths stay reachable for non-admins, so an
// admin can still sign in and lift the lockout from the console.
const MAINTENANCE_OPEN_PATHS = new Set(['/login', '/reset-password', '/admin'])

// Split the heavier surfaces so the landing page loads fast.
const ProductPage = lazy(() => import('./pages/ProductPage')
  .then((module) => ({ default: module.ProductPage })))
const PricingPage = lazy(() => import('./pages/PricingPage')
  .then((module) => ({ default: module.PricingPage })))
const AdminPage = lazy(() => import('./pages/AdminPage')
  .then((module) => ({ default: module.AdminPage })))
const AccountPage = lazy(() => import('./pages/AccountPage')
  .then((module) => ({ default: module.AccountPage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage')
  .then((module) => ({ default: module.ResetPasswordPage })))

function RouteFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0a0a0b', color: '#9b9b9f' }}>
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

/**
 * Maintenance lockout. When an admin switches maintenance on, everyone but an
 * admin gets the full-screen notice — except on the sign-in/admin paths, which
 * stay open so an admin can authenticate and lift it. This is only the visible
 * half: the server independently fails every data endpoint closed during
 * maintenance, so the lockout holds even if this screen is bypassed.
 */
function MaintenanceGate({ children }) {
  const { maintenance } = useAppConfig()
  const isAdmin = useIsAdmin()
  const location = useLocation()

  const locked = Boolean(maintenance?.enabled)
    && isAdmin !== true
    && !MAINTENANCE_OPEN_PATHS.has(location.pathname)

  if (locked) return <MaintenanceScreen message={maintenance?.message} />
  return children
}

export default function App() {
  return (
    <>
      <TargetCursor />
      <MaintenanceGate>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Password-reset landing from the emailed recovery link. */}
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        {/* The product requires an account. */}
        <Route path="/app" element={<RequireAuth><ProductPage /></RequireAuth>} />
        {/* Account settings — profile + password, sign-in required. */}
        <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
        {/* Admin console — hidden from non-admins (they're bounced to /app). */}
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </MaintenanceGate>
    </>
  )
}
