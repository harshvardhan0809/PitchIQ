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
import { FormPicks } from '../components/FormPicks'
import { PlayerSearch } from '../components/PlayerSearch'
import { AccountMenu } from '../components/AccountMenu'
import { ProUpsell } from '../components/ProUpsell'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { SideMenu } from '../components/SideMenu'
import { useAuth, PLAN_NAMES } from '../lib/auth'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { PlayerViewProvider } from '../lib/playerView'
import { usePlayerView } from '../lib/playerViewContext'
import { AppConfigProvider } from '../lib/appConfig'
import { useAppConfig } from '../lib/appConfigContext'
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
const ManagerMindset = lazy(() => import('../components/intel/ManagerMindset')
  .then((module) => ({ default: module.ManagerMindset })))

// Ordered top-to-bottom by how central each surface is to a weekly decision:
// the free matchday home first, then your own team, the flagship captain call,
// the digest that ties it together, the daily market check, the mini-league
// edge, and finally the advanced differential hunt.
const VIEWS = [
  { id: 'matchday', label: 'Matchday', icon: '⚽', hint: 'Fixtures & players to watch' },
  { id: 'squad', label: 'My Team', premium: true, icon: '🧩', hint: 'Your squad, projected & fixed' },
  { id: 'captain', label: 'Captain AI', premium: true, icon: '🧠', hint: 'Who to give the armband' },
  { id: 'briefing', label: 'Weekly Briefing', premium: true, icon: '📅', hint: 'Your gameweek in a minute' },
  { id: 'prices', label: 'Price Watch', premium: true, icon: '💰', hint: 'Tonight’s risers & fallers' },
  { id: 'league', label: 'War Room', premium: true, icon: '⚔️', hint: 'Spy on your mini-league' },
  { id: 'manager', label: 'Manager Mindset', premium: true, icon: '🎯', hint: 'The gaffer’s game plan' },
  { id: 'differentials', label: 'Differentials', premium: true, icon: '💎', hint: 'Low-owned, high-upside picks' },
]

const INTEL_VIEWS = {
  briefing: { Component: WeeklyBriefing, loading: 'Loading Briefing…' },
  prices: { Component: PriceWatch, loading: 'Loading Price Watch…' },
  league: { Component: LeagueWarRoom, loading: 'Loading War Room…' },
  manager: { Component: ManagerMindset, loading: 'Loading Manager Mindset…' },
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
    <AppConfigProvider>
      <PlayerViewProvider>
        <ProductBody />
      </PlayerViewProvider>
    </AppConfigProvider>
  )
}

function ProductBody() {
  const { openPlayer } = usePlayerView()
  const { plan, signedIn } = useAuth()
  const { features } = useAppConfig()
  const isAdmin = useIsAdmin()
  const [view, setView] = useState('matchday')
  const [menuOpen, setMenuOpen] = useState(false)

  // Matchday is always available; any premium tile an admin has switched off in
  // the console drops out of the navigation.
  const visibleViews = VIEWS.filter((item) => item.id === 'matchday' || features[item.id] !== false)
  // If the current view was just hidden, fall back to the matchday home.
  const currentView = visibleViews.some((item) => item.id === view) ? view : 'matchday'
  const activeView = visibleViews.find((item) => item.id === currentView) ?? visibleViews[0]
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
      <AnnouncementBanner />
      <header className="topbar">
        <button
          className="menu-btn"
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Link className="brand" to="/">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span className="brand-text">
            <strong>PitchIQ</strong>
            <small>Match &amp; player intelligence</small>
          </span>
        </Link>

        <span className="topbar-current" aria-hidden="true">
          <span className="tc-ic">{activeView.icon}</span>
          <span className="tc-label">{activeView.label}</span>
        </span>

        <span className={`mode-badge ${usesLiveData ? 'live' : ''}`}>
          {usesLiveData ? 'Live data' : 'Demo data'}
        </span>

        {signedIn && plan !== 'free'
          ? <span className={`plan-badge ${plan}`}>{PLAN_NAMES[plan]}</span>
          : <Link className="upgrade-pill" to="/pricing">Upgrade to Pro</Link>}

        <AccountMenu />
      </header>

      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        views={visibleViews}
        activeView={currentView}
        onSelectView={setView}
        isAdmin={isAdmin}
      />

      <main id="main">
        {INTEL_VIEWS[currentView] ? (
          (() => {
            const { Component, loading } = INTEL_VIEWS[currentView]
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
                  <FormPicks formPicks={spotlight.data.formPicks} />
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

      <ProUpsell />
    </div>
  )
}
