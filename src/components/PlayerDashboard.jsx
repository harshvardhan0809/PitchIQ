import { PlayerAvatar } from './PlayerAvatar'
import { TeamCrest } from './TeamCrest'
import { formatKickoff, formatShortDate } from '../lib/format'

function StatTile({ label, value, hint }) {
  return (
    <div className="stat-tile">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
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

function MatchRow({ match }) {
  const stats = match.playerStats
  return (
    <li className="match-row">
      <span className={`result result-${(match.result ?? 'none').toLowerCase()}`}>
        {match.result ?? '–'}
      </span>
      <div className="match-row-detail">
        <strong>
          <TeamCrest src={match.opponentCrest} name={match.opponent} size={18} />
          {match.home ? 'vs' : 'at'} {match.opponent}
        </strong>
        <small>
          {formatShortDate(match.utcDate)} · {match.homeScore ?? '–'}–{match.awayScore ?? '–'}
        </small>
      </div>
      {stats ? (
        <div className="match-row-metrics">
          <span><strong>{stats.minutes}</strong> min</span>
          <span><strong>{stats.goals}</strong> G</span>
          <span><strong>{stats.assists}</strong> A</span>
          {stats.expectedGoals !== null && <span><strong>{stats.expectedGoals}</strong> xG</span>}
        </div>
      ) : (
        <div className="match-row-metrics muted">
          <span>Club result</span>
        </div>
      )}
    </li>
  )
}

function SeasonTotals({ totals }) {
  if (!totals) return null
  return (
    <div className="season-totals">
      <p className="eyebrow">
        {totals.seasonLabel} totals
        {totals.isPreviousSeason ? ' · last completed season' : ''}
      </p>
      <div className="stat-grid">
        <StatTile label="Goals" value={totals.goals} />
        <StatTile label="Assists" value={totals.assists} />
        <StatTile label="Minutes" value={totals.minutes} />
        {totals.expectedGoals !== null && <StatTile label="xG" value={totals.expectedGoals.toFixed(1)} />}
      </div>
    </div>
  )
}

export function PlayerDashboard({ dashboard, onBack }) {
  const { nextFixture, summary, formPeriod } = dashboard
  const prediction = nextFixture.prediction

  return (
    <section className="player-view" aria-label={`${dashboard.name} report`}>
      <button className="back-button" type="button" onClick={onBack}>
        &larr; Back to {dashboard.competition.name}
      </button>

      <div className="dashboard">
        <aside className="panel profile-panel">
          <div className="profile-head">
            <PlayerAvatar initials={dashboard.initials} photoUrl={dashboard.photoUrl} size="xlarge" />
            <div>
              <p className="eyebrow">{dashboard.position}</p>
              <h2>{dashboard.name}</h2>
              <p className="team-line">
                <TeamCrest src={dashboard.teamCrestUrl} name={dashboard.team} size={20} />
                <span>
                  {dashboard.team}
                  {dashboard.shirtNumber ? ` · #${dashboard.shirtNumber}` : ''}
                </span>
              </p>
              {dashboard.nationality && <p className="nationality">{dashboard.nationality}</p>}
            </div>
          </div>

          {dashboard.availability && dashboard.availability.code !== 'available' && (
            <p className={`availability-notice ${dashboard.availability.code}`}>
              <strong>{dashboard.availability.label}.</strong>{' '}
              {dashboard.availability.note ?? 'No further detail published.'}
            </p>
          )}

          <SeasonTotals totals={dashboard.seasonTotals} />

          {dashboard.form.length > 0 && (
            <div className="form-strip">
              <span>
                Club form
                {formPeriod?.isPreviousSeason ? ` · ${formPeriod.seasonLabel}` : ''}
              </span>
              <div>
                {dashboard.form.map((result, index) => (
                  <strong className={`result-${result.toLowerCase()}`} key={`${result}-${index}`}>
                    {result}
                  </strong>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="panel matches-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Club results</p>
              <h2>Recent matches</h2>
            </div>
            <p className="panel-note">{dashboard.competition.name}</p>
          </header>

          {formPeriod?.isPreviousSeason && (
            <p className="callout">
              The current season has no completed matches yet, so this is the {formPeriod.seasonLabel} run-in.
            </p>
          )}

          {/* Say plainly whose numbers these are, rather than labelling club goals as the player's. */}
          <p className="metrics-note">
            {dashboard.hasPlayerMatchStats
              ? dashboard.metricsNote
              : `${dashboard.metricsNote} The rows below are club results, not individual returns.`}
          </p>

          {dashboard.recentMatches.length > 0 ? (
            <ul className="match-list">
              {dashboard.recentMatches.map((match) => <MatchRow key={match.id} match={match} />)}
            </ul>
          ) : (
            <p className="empty">No completed matches are available for this club.</p>
          )}

          <div className="stat-grid club-summary">
            <StatTile label="Matches" value={summary.matches} hint="shown above" />
            <StatTile label="Club wins" value={summary.wins} />
            <StatTile label="Club draws" value={summary.draws} />
            <StatTile label="Club goals" value={summary.teamGoals} hint="team total" />
          </div>
        </section>

        <aside className="side-stack">
          <section className="panel upcoming-panel" id="upcoming">
            <p className="eyebrow">Upcoming</p>
            <h2>Next fixtures</h2>
            {dashboard.upcomingFixtures.length > 0 ? (
              <ul className="upcoming-list">
                {dashboard.upcomingFixtures.map((fixture) => (
                  <li className="upcoming-row" key={fixture.id}>
                    <span className={`fixture-side ${fixture.isHome ? 'home' : 'away'}`}>
                      {fixture.isHome ? 'H' : 'A'}
                    </span>
                    <div>
                      <strong>{fixture.homeTeam} v {fixture.awayTeam}</strong>
                      <small>
                        {formatKickoff(fixture.utcDate)}
                        {fixture.venue ? ` · ${fixture.venue}` : ''}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No upcoming fixtures have been published for this club.</p>
            )}
          </section>

          <section className="panel prediction-panel" id="estimate">
            <p className="eyebrow">Next fixture estimate</p>
            {nextFixture.available ? (
              <>
                <h2>{nextFixture.homeTeam} <span>v</span> {nextFixture.awayTeam}</h2>
                <p className="fixture-meta">
                  {formatKickoff(nextFixture.utcDate)}
                  {nextFixture.venue ? ` · ${nextFixture.venue}` : ''}
                </p>
                {prediction ? (
                  <>
                    <ProbabilityBar
                      highlighted={nextFixture.selectedTeamSide === 'home'}
                      label={nextFixture.homeTeam}
                      value={prediction.home}
                    />
                    <ProbabilityBar label="Draw" value={prediction.draw} />
                    <ProbabilityBar
                      highlighted={nextFixture.selectedTeamSide === 'away'}
                      label={nextFixture.awayTeam}
                      value={prediction.away}
                    />
                    <p className="insight">
                      {nextFixture.advice} Based on {prediction.sampleSize} recent
                      {prediction.sampleSize === 1 ? ' result' : ' results'}, ignoring opponent strength.
                    </p>
                  </>
                ) : (
                  <p className="empty">Not enough completed results to form an estimate.</p>
                )}
              </>
            ) : (
              <p className="empty">{nextFixture.advice}</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  )
}
