import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'

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

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/app" element={<ProductPage />} />
        {/* Unknown paths fall back to the landing page. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
