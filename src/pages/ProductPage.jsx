import { lazy, Suspense, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  fetchSpotlight,
  getPlayerDashboard,
  leagueOptions,
  searchPlayers,
  usesLiveData,
} from '../services/footballApi'
import { useAsync, useDebounced } from '../hooks/useAsync'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { MatchdayPanel } from '../components/MatchdayPanel'
import { PlayersToWatch } from '../components/PlayersToWatch'
import { PlayerSearch } from '../components/PlayerSearch'
import { PlayerDashboard } from '../components/PlayerDashboard'
import { AccountMenu } from '../components/AccountMenu'
import { useAuth, PLAN_NAMES } from '../lib/auth'
import '../App.css'

// The intelligence view (and its Supabase auth dependency) is code-split so the
// free matchday experience keeps a small initial bundle; it loads on demand.
const CaptainPicks = lazy(() => import('../components/intel/CaptainPicks')
  .then((module) => ({ default: module.CaptainPicks })))

const VIEWS = [
  { id: 'matchday', label: 'Matchday' },
  { id: 'captain', label: 'Captain AI', premium: true },
]

function Loading({ label }) {
  return (
    <div className="loading-panel" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  )
}

function Failure({ error, onRetry }) {
  const isRateLimited = error.status === 429
  return (
    <div className="panel error-panel" role="alert">
      <h2>{isRateLimited ? 'Too many requests just now' : 'That did not load'}</h2>
      <p>{error.message}</p>
      {isRateLimited && error.retryAfter && (
        <p className="muted">The free provider tier resets in about {error.retryAfter} seconds.</p>
      )}
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  )
}

export function ProductPage() {
  const { plan, signedIn } = useAuth()
  const [view, setView] = useState('matchday')
  const [league, setLeague] = useState('PL')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  const debouncedQuery = useDebounced(query)

  const retry = useCallback(() => setReloadToken((token) => token + 1), [])

  const spotlight = useAsync(fetchSpotlight, [league], { refreshKey: reloadToken })

  const results = useAsync(searchPlayers, [debouncedQuery, league], {
    enabled: debouncedQuery.trim().length > 0,
  })

  const dashboard = useAsync(getPlayerDashboard, [selectedId, league], {
    enabled: Boolean(selectedId),
    refreshKey: reloadToken,
  })

  function handleLeagueChange(code) {
    setLeague(code)
    setSelectedId(null)
    setQuery('')
  }

  function handleSelect(id) {
    setSelectedId(id)
    setQuery('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const competitionName = spotlight.data?.competition?.name
    ?? leagueOptions.find((option) => option.code === league)?.name
    ?? 'Premier League'

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span className="brand-text">
            <strong>PitchIQ</strong>
            <small>Match &amp; player intelligence</small>
          </span>
        </Link>

        <nav className="primary-nav" aria-label="Sections">
          {VIEWS.map((item) => (
            <button
              aria-current={item.id === view ? 'page' : undefined}
              className={`nav-link ${item.id === view ? 'active' : ''}`}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              {item.label}
              {item.premium && <span className="nav-pro">PRO</span>}
            </button>
          ))}
          <Link className="nav-link" to="/pricing">Pricing</Link>
        </nav>

        <span className={`mode-badge ${usesLiveData ? 'live' : ''}`}>
          {usesLiveData ? 'Live data' : 'Demo data'}
        </span>

        {signedIn && plan !== 'free'
          ? <span className={`plan-badge ${plan}`}>{PLAN_NAMES[plan]}</span>
          : <Link className="upgrade-pill" to="/pricing">Upgrade to Pro</Link>}

        <AccountMenu />
      </header>

      <main id="main">
        {view === 'captain' ? (
          <ErrorBoundary>
            <Suspense fallback={<Loading label="Loading Captain AI…" />}>
              <CaptainPicks league="PL" />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <>
            <nav className="league-tabs" aria-label="Competition">
              {leagueOptions.map((option) => (
                <button
                  aria-current={option.code === league ? 'true' : undefined}
                  className={`league-tab ${option.code === league ? 'active' : ''}`}
                  key={option.code}
                  onClick={() => handleLeagueChange(option.code)}
                  type="button"
                >
                  {option.name}
                </button>
              ))}
            </nav>

            <div className="search-bar">
              <PlayerSearch
                competitionName={competitionName}
                onQueryChange={setQuery}
                onSelect={handleSelect}
                query={query}
                results={results}
                selectedId={selectedId}
              />
            </div>

            <ErrorBoundary>
              {selectedId ? (
                <>
                  {dashboard.status === 'loading' && <Loading label="Loading player report…" />}
                  {dashboard.status === 'error' && <Failure error={dashboard.error} onRetry={retry} />}
                  {dashboard.status === 'ready' && dashboard.data && (
                    <PlayerDashboard dashboard={dashboard.data} onBack={() => setSelectedId(null)} />
                  )}
                </>
              ) : (
                <>
                  {spotlight.status === 'loading' && <Loading label={`Loading ${competitionName}…`} />}
                  {spotlight.status === 'error' && <Failure error={spotlight.error} onRetry={retry} />}
                  {spotlight.status === 'ready' && spotlight.data && (
                    <>
                      <MatchdayPanel
                        competitionName={spotlight.data.competition.name}
                        matches={spotlight.data.matches}
                      />
                      <PlayersToWatch
                        onSelect={handleSelect}
                        playersToWatch={spotlight.data.playersToWatch}
                      />
                    </>
                  )}
                </>
              )}
            </ErrorBoundary>
          </>
        )}
      </main>

      <footer>
        <p>
          {usesLiveData
            ? 'Live data from Football-Data.org and the unofficial Fantasy Premier League API.'
            : 'Showing bundled sample data. Set VITE_DATA_MODE=live to use the provider APIs.'}
        </p>
        <p className="muted">Form estimates are calculated locally and are not betting advice.</p>
      </footer>
    </div>
  )
}
