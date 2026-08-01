import { lazy, Suspense, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  fetchSpotlight,
  leagueOptions,
  searchPlayers,
  usesLiveData,
} from '../services/footballApi'
import { useAsync, useDebounced } from '../hooks/useAsync'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { MatchdayPanel } from '../components/MatchdayPanel'
import { PlayersToWatch } from '../components/PlayersToWatch'
import { PlayerSearch } from '../components/PlayerSearch'
import { AccountMenu } from '../components/AccountMenu'
import { useAuth, PLAN_NAMES } from '../lib/auth'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { PlayerViewProvider, usePlayerView } from '../lib/playerView'
import '../App.css'

// The intelligence views are code-split so the free matchday experience keeps a
// small initial bundle; they load on demand.
const CaptainPicks = lazy(() => import('../components/intel/CaptainPicks')
  .then((module) => ({ default: module.CaptainPicks })))
const Differentials = lazy(() => import('../components/intel/Differentials')
  .then((module) => ({ default: module.Differentials })))
const SquadAnalyzer = lazy(() => import('../components/intel/SquadAnalyzer')
  .then((module) => ({ default: module.SquadAnalyzer })))
const WeeklyBriefing = lazy(() => import('../components/intel/WeeklyBriefing')
  .then((module) => ({ default: module.WeeklyBriefing })))
const PriceWatch = lazy(() => import('../components/intel/PriceWatch')
  .then((module) => ({ default: module.PriceWatch })))
const LeagueWarRoom = lazy(() => import('../components/intel/LeagueWarRoom')
  .then((module) => ({ default: module.LeagueWarRoom })))

const VIEWS = [
  { id: 'matchday', label: 'Matchday' },
  { id: 'briefing', label: 'Briefing', premium: true },
  { id: 'prices', label: 'Price Watch', premium: true },
  { id: 'league', label: 'War Room', premium: true },
  { id: 'squad', label: 'My Team', premium: true },
  { id: 'captain', label: 'Captain AI', premium: true },
  { id: 'differentials', label: 'Differentials', premium: true },
]

const INTEL_VIEWS = {
  briefing: { Component: WeeklyBriefing, loading: 'Loading Briefing…' },
  prices: { Component: PriceWatch, loading: 'Loading Price Watch…' },
  league: { Component: LeagueWarRoom, loading: 'Loading War Room…' },
  squad: { Component: SquadAnalyzer, loading: 'Loading My Team…' },
  captain: { Component: CaptainPicks, loading: 'Loading Captain AI…' },
  differentials: { Component: Differentials, loading: 'Loading Differentials…' },
}

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

// The provider makes the player report reachable from every view; the body reads
// its opener so search results, matchday and the intel boards all share one
// dashboard overlay.
export function ProductPage() {
  return (
    <PlayerViewProvider>
      <ProductBody />
    </PlayerViewProvider>
  )
}

function ProductBody() {
  const { openPlayer } = usePlayerView()
  const { plan, signedIn } = useAuth()
  const isAdmin = useIsAdmin()
  const [view, setView] = useState('matchday')
  const league = 'PL' // PitchIQ is Premier League only.
  const [query, setQuery] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const debouncedQuery = useDebounced(query)

  const retry = useCallback(() => setReloadToken((token) => token + 1), [])

  const spotlight = useAsync(fetchSpotlight, [league], { refreshKey: reloadToken })

  const results = useAsync(searchPlayers, [debouncedQuery, league], {
    enabled: debouncedQuery.trim().length > 0,
  })

  function handleSelect(id) {
    setQuery('')
    openPlayer(id)
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
          {isAdmin && <Link className="nav-link" to="/admin">Admin</Link>}
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
        {INTEL_VIEWS[view] ? (
          (() => {
            const { Component, loading } = INTEL_VIEWS[view]
            return (
              <ErrorBoundary>
                <Suspense fallback={<Loading label={loading} />}>
                  <Component league="PL" />
                </Suspense>
              </ErrorBoundary>
            )
          })()
        ) : (
          <>
            <div className="search-bar">
              <PlayerSearch
                competitionName={competitionName}
                onQueryChange={setQuery}
                onSelect={handleSelect}
                query={query}
                results={results}
                selectedId={null}
              />
            </div>

            <ErrorBoundary>
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
