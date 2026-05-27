import { useEffect, useMemo, useState } from 'react'
import { getPlayerDashboard, searchPlayers, usesLiveData } from './services/footballApi'
import './App.css'

function StatTile({ label, value }) {
  return (
    <div className="stat-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function ProbabilityBar({ label, value, highlighted }) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className={`probability-row ${highlighted ? 'highlighted' : ''}`}>
      <div className="probability-label">
        <span>{label}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function PlayerAvatar({ initials, photoUrl, small = false }) {
  const [failed, setFailed] = useState(false)
  const className = `avatar ${small ? 'small' : ''} ${photoUrl && !failed ? 'photo' : ''}`

  if (photoUrl && !failed) {
    return (
      <span className={className}>
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    )
  }

  return <span className={className}>{initials}</span>
}

function SearchResult({ player, active, onSelect }) {
  return (
    <button
      className={`search-result ${active ? 'active' : ''}`}
      type="button"
      onClick={() => onSelect(player)}
    >
      <PlayerAvatar
        initials={player.initials}
        photoUrl={player.photoUrl}
        small
      />
      <span>
        <strong>{player.name}</strong>
        <small>
          {player.team} · {player.position}
        </small>
      </span>
    </button>
  )
}

function MatchRow({ match, liveMetrics }) {
  const metrics = liveMetrics
    ? [
        { label: 'Min', value: match.minutes ?? 0 },
        { label: 'G+A', value: (match.goals ?? 0) + (match.assists ?? 0) },
        { label: 'xG', value: match.expectedGoals ?? '0.00' },
      ]
    : [
        { label: 'Shots', value: match.shots },
        { label: 'On target', value: match.onTarget },
        { label: 'Possession', value: match.possession },
      ]

  return (
    <article className="match-row">
      <div className="match-opponent">
        <span className={`result ${match.result.toLowerCase()}`}>{match.result}</span>
        <div>
          <strong>{match.home ? 'vs' : '@'} {match.opponent}</strong>
          <small>{match.date} · {match.score}</small>
        </div>
      </div>
      <div className="match-metrics">
        {metrics.map((metric) => (
          <span key={metric.label}>
            <strong>{metric.value}</strong> {metric.label}
          </span>
        ))}
      </div>
    </article>
  )
}

function UpcomingFixtureRow({ fixture }) {
  return (
    <div className="upcoming-row">
      <span className={`fixture-side ${fixture.isHome ? 'home' : 'away'}`}>
        {fixture.isHome ? 'Home' : 'Away'}
      </span>
      <div>
        <strong>{fixture.homeTeam} vs {fixture.awayTeam}</strong>
        <small>{fixture.date}{fixture.venue ? ` · ${fixture.venue}` : ''}</small>
      </div>
    </div>
  )
}

function App() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let active = true

    async function loadResults() {
      try {
        const players = await searchPlayers(debouncedQuery)
        if (!active) return
        setResults(players)
        setSelectedId((currentId) => (
          players.some((player) => player.id === currentId)
            ? currentId
            : players[0]?.id ?? null
        ))
        if (players.length === 0) {
          setDashboard(null)
          setStatus('ready')
        } else {
          setStatus('loading')
        }
      } catch (requestError) {
        if (!active) return
        setError(requestError.message)
        setStatus('error')
      }
    }

    loadResults()
    return () => {
      active = false
    }
  }, [debouncedQuery])

  useEffect(() => {
    if (!selectedId) return undefined

    let active = true

    getPlayerDashboard(selectedId)
      .then((data) => {
        if (!active) return
        setDashboard(data)
        setStatus('ready')
      })
      .catch((requestError) => {
        if (!active) return
        setError(requestError.message)
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [selectedId])

  const selectedInResults = useMemo(
    () => results.find((player) => player.id === selectedId),
    [results, selectedId],
  )

  const displayPhoto = dashboard?.photoUrl ?? selectedInResults?.photoUrl

  function handleSelect(player) {
    setStatus('loading')
    setError('')
    setSelectedId(player.id)
  }

  function handleSearchChange(event) {
    setQuery(event.target.value)
    setStatus('loading')
    setError('')
  }

  return (
    <div className="app" id="top">
      <header className="topbar">
        <div className="brand" aria-label="PitchIQ home">
          <span className="brand-mark">P</span>
          <span>
            <strong>PitchIQ</strong>
            <small>PLAYER INTELLIGENCE</small>
          </span>
        </div>
        <nav aria-label="Main navigation">
          <a className="active" href="#top">Players</a>
          <a href="#matches">Matches</a>
          <a href="#upcoming">Upcoming</a>
          <a href="#prediction">Estimate</a>
        </nav>
        <span className="mode-badge">{usesLiveData ? 'Live API' : 'Demo data'}</span>
      </header>

      <main>
        <section className="hero-panel">
          <div>
            <p className="eyebrow">FREE LIVE FOOTBALL DATA</p>
            <h1>Players, fixtures and form in one view.</h1>
            <p className="intro">
              Find a player, follow their current club results, and inspect a
              transparent form-based outlook for the next listed fixture.
            </p>
          </div>
          <form className="search" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="player-search">Find a player</label>
            <div className="search-field">
              <span aria-hidden="true">&#128269;</span>
              <input
                id="player-search"
                type="search"
                value={query}
                placeholder="Search Haaland, Salah, Yamal..."
                onChange={handleSearchChange}
              />
            </div>
            <div className="search-results">
              {results.map((player) => (
                <SearchResult
                  active={player.id === selectedId}
                  key={player.id}
                  onSelect={handleSelect}
                  player={player}
                />
              ))}
              {results.length === 0 && status !== 'loading' && (
                <p className="empty">No players found.</p>
              )}
            </div>
            {results.length > 0 && (
              <p className="search-hint">
                Showing up to 10 players. Live details load on selection.
              </p>
            )}
          </form>
        </section>

        {status === 'error' && <p className="error-panel">{error}</p>}
        {status === 'loading' && <p className="loading-panel">Loading player report...</p>}

        {status === 'ready' && dashboard && (
          <section className="dashboard" aria-live="polite">
            <aside className="player-profile">
              <div className="profile-head">
                <PlayerAvatar
                  initials={dashboard.initials}
                  photoUrl={displayPhoto}
                />
                <div>
                  <p className="eyebrow">{dashboard.position}</p>
                  <h2>{dashboard.name}</h2>
                  <p className="team-line">
                    {dashboard.teamCrestUrl && (
                      <img
                        className="team-crest"
                        src={dashboard.teamCrestUrl}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <span>{dashboard.team} · #{dashboard.number}</span>
                  </p>
                </div>
              </div>
              <p className="season-label">{dashboard.season} available fixture data</p>
              <div className="stat-grid">
                <StatTile label="Matches shown" value={dashboard.summary.matches} />
                <StatTile label="Team wins" value={dashboard.summary.wins} />
                <StatTile label="Team draws" value={dashboard.summary.draws} />
                <StatTile label="Goals scored" value={dashboard.summary.goals} />
              </div>
              <div className="form-strip">
                <span>Recent form</span>
                {dashboard.form.map((result, index) => (
                  <strong className={result.toLowerCase()} key={`${result}-${index}`}>
                    {result}
                  </strong>
                ))}
              </div>
            </aside>

            <section className="matches-panel" id="matches">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">AVAILABLE CLUB RESULTS</p>
                  <h2>Recent listed matches</h2>
                </div>
                <span className="competition">{dashboard.competition}</span>
              </div>
              {usesLiveData && (
                <p className="metrics-note">
                  Player match stats (minutes, goals, xG) from FPL. Team possession is not provided on the free tier.
                </p>
              )}
              <div className="match-list">
                {dashboard.recentMatches.map((match) => (
                  <MatchRow key={match.id} liveMetrics={usesLiveData} match={match} />
                ))}
              </div>
            </section>

            <aside className="side-stack">
              <section className="upcoming-panel" id="upcoming">
                <p className="eyebrow">UPCOMING FIXTURES</p>
                <h2>Next on the calendar</h2>
                {dashboard.upcomingFixtures?.length > 0 ? (
                  <div className="upcoming-list">
                    {dashboard.upcomingFixtures.map((fixture) => (
                      <UpcomingFixtureRow fixture={fixture} key={fixture.id} />
                    ))}
                  </div>
                ) : (
                  <p className="empty upcoming-empty">
                    {dashboard.seasonComplete
                      ? 'The Premier League season has finished. New fixtures will appear when the next schedule is published.'
                      : 'No upcoming fixtures are listed for this team right now.'}
                  </p>
                )}
              </section>

              <section className="prediction-panel" id="prediction">
                <p className="eyebrow">NEXT FIXTURE FORM ESTIMATE</p>
                <h2>{dashboard.nextFixture.homeTeam} <span>vs</span> {dashboard.nextFixture.awayTeam}</h2>
                <p className="fixture-meta">
                  {dashboard.nextFixture.date}
                  {dashboard.nextFixture.venue ? ` · ${dashboard.nextFixture.venue}` : ''}
                </p>
                {dashboard.nextFixture.prediction ? (
                  <>
                    <ProbabilityBar
                      highlighted={dashboard.team === dashboard.nextFixture.homeTeam}
                      label={dashboard.nextFixture.homeTeam}
                      value={dashboard.nextFixture.prediction.home}
                    />
                    <ProbabilityBar
                      label="Draw"
                      value={dashboard.nextFixture.prediction.draw}
                    />
                    <ProbabilityBar
                      highlighted={dashboard.team === dashboard.nextFixture.awayTeam}
                      label={dashboard.nextFixture.awayTeam}
                      value={dashboard.nextFixture.prediction.away}
                    />
                    <p className="insight">{dashboard.nextFixture.advice}</p>
                  </>
                ) : (
                  <p className="empty">
                    {dashboard.nextFixture.advice || 'No upcoming fixture available to estimate.'}
                  </p>
                )}
                <small className="disclaimer">
                  {usesLiveData
                    ? 'Calculated locally from Football-Data.org team results; this is not betting advice.'
                    : 'Sample form estimate calculated from recent result data.'}
                </small>
              </section>
            </aside>
          </section>
        )}
      </main>

      <footer>
        Showing {usesLiveData ? 'live data' : 'sample data'} for{' '}
        <strong>{selectedInResults?.name ?? dashboard?.name ?? 'players'}</strong>.
        {!usesLiveData && ' Set VITE_DATA_MODE=live to request live provider data.'}
      </footer>
    </div>
  )
}

export default App
