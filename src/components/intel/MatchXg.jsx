import { useAsync } from '../../hooks/useAsync'
import { fetchMatchXg } from '../../services/footballApi'
import { TeamCrest } from '../TeamCrest'
import '../../styles/intel.css'

/**
 * Match xG & Clean Sheets: every fixture in the focus gameweek with each side's
 * expected goals and clean-sheet chance, plus the total-goals and both-teams-to-
 * score reads. A free, match-level view — no login or team needed.
 */
const csTone = (pct) => (pct >= 45 ? 'good' : pct <= 20 ? 'bad' : 'neutral')

function Side({ team, align }) {
  return (
    <div className={`mxg-side mxg-side-${align}`}>
      <TeamCrest src={team.crest} name={team.name} size={26} />
      <span className="mxg-team">{team.shortName}</span>
    </div>
  )
}

function Metric({ label, value, suffix, tone }) {
  return (
    <div className={`mxg-metric ${tone ? `tone-${tone}` : ''}`}>
      <span className="mxg-metric-val">{value}<small>{suffix}</small></span>
      <span className="mxg-metric-lbl">{label}</span>
    </div>
  )
}

function MatchCard({ match }) {
  const { home, away } = match
  // Share the xG bar proportionally between the two sides.
  const total = Math.max(0.1, home.xg + away.xg)
  const homePct = Math.round((home.xg / total) * 100)

  return (
    <li className="mxg-card">
      <div className="mxg-head">
        <Side team={home} align="home" />
        <span className="mxg-vs">vs</span>
        <Side team={away} align="away" />
      </div>

      <div className="mxg-xg-row">
        <span className="mxg-xg-val">{home.xg}</span>
        <div className="mxg-xg-bar" role="img" aria-label={`Expected goals ${home.shortName} ${home.xg}, ${away.shortName} ${away.xg}`}>
          <span className="mxg-xg-fill home" style={{ width: `${homePct}%` }} />
          <span className="mxg-xg-fill away" style={{ width: `${100 - homePct}%` }} />
        </div>
        <span className="mxg-xg-val">{away.xg}</span>
      </div>
      <p className="mxg-xg-cap">expected goals</p>

      <div className="mxg-metrics">
        <Metric label={`${home.shortName} clean sheet`} value={home.cleanSheetPct} suffix="%" tone={csTone(home.cleanSheetPct)} />
        <Metric label="Total goals" value={match.totalXg} suffix="xG" />
        <Metric label={`${away.shortName} clean sheet`} value={away.cleanSheetPct} suffix="%" tone={csTone(away.cleanSheetPct)} />
      </div>

      <p className="mxg-btts">Both teams to score <b>{match.bttsPct}%</b></p>
    </li>
  )
}

function Skeleton() {
  return (
    <div className="intel-skeleton" aria-hidden="true">
      <div className="sk hero" />
      {[0, 1, 2].map((index) => <div className="sk row" key={index} />)}
    </div>
  )
}

export function MatchXg({ league = 'PL' }) {
  const { status, data, error, reload } = useAsync(fetchMatchXg, [league])

  return (
    <div className="intel mxg">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">Match xG &amp; Clean Sheets</p>
          <h1 className="intel-title">Expected goals, every match</h1>
          <p className="intel-sub">
            A model read of each fixture: how many goals each side is expected to create, and how likely they are to keep
            a clean sheet — built from FPL attack &amp; defence strength.
          </p>
          {data?.gameweekName && (
            <p className="intel-gw">
              <b>{data.gameweekName}</b>
              {data.dataDepth === 'pre-season' && ' · pre-season read from squad strength'}
            </p>
          )}
        </div>
      </header>

      {status === 'loading' && <Skeleton />}

      {status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'Could not load match projections.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {status === 'ready' && data && (
        data.matches.length === 0 ? (
          <p className="sq-idle">No fixtures scheduled for this gameweek yet.</p>
        ) : (
          <ul className="mxg-grid">
            {data.matches.map((match) => <MatchCard key={match.id} match={match} />)}
          </ul>
        )
      )}
    </div>
  )
}
