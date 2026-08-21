import { useMemo, useState } from 'react'

import { TeamCrest } from './TeamCrest'
import { useAsync } from '../hooks/useAsync'
import { fetchMatchXg } from '../services/footballApi'
import { formatDayHeading, formatRelative, formatScoreline, formatTime } from '../lib/format'

const csTone = (pct) => (pct >= 45 ? 'good' : pct <= 20 ? 'bad' : 'neutral')

/**
 * The expected-goals read for one match, shown when its card is expanded. Every
 * number is the model's (FPL attack/defence strength) — projected before kickoff,
 * and graded against the real score once the match is done.
 */
function MatchXgDetail({ status, xg }) {
  if (status === 'loading' || status === 'idle') {
    return <div className="mx-detail mx-detail-state">Loading expected goals…</div>
  }
  if (status === 'error') {
    return <div className="mx-detail mx-detail-state">Couldn’t load the xG read for this match.</div>
  }
  if (!xg) {
    return <div className="mx-detail mx-detail-state">No expected-goals read is published for this match yet.</div>
  }

  const { home, away, totalXg, bttsPct, started, finished } = xg
  const total = Math.max(0.1, home.xg + away.xg)
  const homePct = Math.round((home.xg / total) * 100)
  const goals = finished ? (home.score ?? 0) + (away.score ?? 0) : null
  const verdictTone = finished ? (Math.abs(goals - totalXg) <= 1 ? 'good' : Math.abs(goals - totalXg) <= 2 ? 'neutral' : 'bad') : null

  return (
    <div className="mx-detail">
      <div className="mx-xg-row">
        <span className="mx-xg-side home">
          <b className="mx-xg-val">{home.xg}</b>
          <small className="mx-xg-team">{home.shortName}</small>
        </span>
        <div className="mx-bar" role="img" aria-label={`Expected goals ${home.shortName} ${home.xg}, ${away.shortName} ${away.xg}`}>
          <span className="mx-fill home" style={{ width: `${homePct}%` }} />
          <span className="mx-fill away" style={{ width: `${100 - homePct}%` }} />
        </div>
        <span className="mx-xg-side away">
          <b className="mx-xg-val">{away.xg}</b>
          <small className="mx-xg-team">{away.shortName}</small>
        </span>
      </div>
      <p className="mx-cap">{started ? 'projected expected goals' : 'expected goals'} · {home.shortName} vs {away.shortName}</p>

      <div className="mx-metrics">
        <div className={`mx-metric tone-${csTone(home.cleanSheetPct)}`}>
          <span className="mx-metric-val">{home.cleanSheetPct}<small>%</small></span>
          <span className="mx-metric-lbl">{home.shortName} clean sheet</span>
        </div>
        <div className="mx-metric">
          <span className="mx-metric-val">{totalXg}<small>xG</small></span>
          <span className="mx-metric-lbl">Total goals</span>
        </div>
        <div className={`mx-metric tone-${csTone(away.cleanSheetPct)}`}>
          <span className="mx-metric-val">{away.cleanSheetPct}<small>%</small></span>
          <span className="mx-metric-lbl">{away.shortName} clean sheet</span>
        </div>
      </div>

      {finished ? (
        <p className={`mx-verdict tone-${verdictTone}`}>
          Projected <b>{totalXg}</b> xG · actually <b>{goals}</b> {goals === 1 ? 'goal' : 'goals'}
        </p>
      ) : (
        <p className="mx-btts">Both teams to score <b>{bttsPct}%</b></p>
      )}
    </div>
  )
}

function MatchCard({ match, isOpen, onToggle, xgStatus, xg }) {
  const scoreline = formatScoreline(match)
  const isLive = match.state === 'live'

  return (
    <li className={`match-card state-${match.state} ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="match-card-btn"
        onClick={() => onToggle(match.id)}
        aria-expanded={isOpen}
        aria-label={`${match.homeTeam.shortName} versus ${match.awayTeam.shortName} — show expected goals`}
      >
        <div className="match-card-status">
          {isLive && <span className="live-dot" aria-hidden="true" />}
          <span className={`match-status-label ${isLive ? 'live' : ''}`}>
            {isLive ? 'Live' : match.state === 'finished' ? 'FT' : formatTime(match.utcDate)}
          </span>
        </div>

        <div className="match-card-teams">
          {[match.homeTeam, match.awayTeam].map((side, index) => (
            <div className="match-card-team" key={`${match.id}-${index === 0 ? 'home' : 'away'}`}>
              <TeamCrest src={side.crest} name={side.name} />
              <span className="match-card-name">{side.shortName}</span>
              {scoreline !== null && <span className="match-card-score">{side.score ?? 0}</span>}
            </div>
          ))}
        </div>

        <span className={`match-card-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden="true">xG</span>
      </button>

      {match.state === 'off' && <p className="match-card-note">{match.status.toLowerCase()}</p>}
      {isOpen && <MatchXgDetail status={xgStatus} xg={xg} />}
    </li>
  )
}

/**
 * Groups the round by calendar day, because a matchday is usually spread over a
 * weekend and "Saturday / Sunday" is how people actually read a fixture list.
 *
 * The key must be the *local* day, not the UTC one: a 19:00 UTC kickoff is the
 * following day east of Greenwich, and keying on UTC there splits one local
 * evening into two groups that both render the same heading.
 */
function localDayKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function groupByDay(matches) {
  const groups = new Map()
  for (const match of matches) {
    const key = localDayKey(match.utcDate)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(match)
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

export function MatchdayPanel({ matches, competitionName, league = 'PL' }) {
  const hasMatches = matches.items.length > 0
  const relative = formatRelative(matches.firstKickoff)

  // Click a match to reveal its expected-goals read. The xG payload is only
  // fetched once a user actually opens a match (latched on), then reused.
  const [openId, setOpenId] = useState(null)
  const [wantXg, setWantXg] = useState(false)
  const xg = useAsync(fetchMatchXg, [league], { enabled: wantXg })
  const xgById = useMemo(
    () => new Map((xg.data?.matches ?? []).map((entry) => [entry.id, entry])),
    [xg.data],
  )

  const toggle = (id) => {
    setWantXg(true)
    setOpenId((prev) => (prev === id ? null : id))
  }

  return (
    <section className="panel matchday-panel" id="matches" aria-labelledby="matchday-heading">
      <header className="panel-header">
        <div>
          <p className="eyebrow">{competitionName}</p>
          <h2 id="matchday-heading">{matches.heading}</h2>
        </div>
        <p className="panel-note">
          {matches.note}
          {relative && matches.state === 'upcoming' ? ` Starts ${relative}.` : ''}
        </p>
      </header>

      {matches.isPreviousSeason && (
        <p className="callout">
          The new season has not started yet, so this shows the last completed round.
        </p>
      )}

      {hasMatches ? (
        <>
          <p className="match-hint">Tap a match for its expected-goals &amp; clean-sheet read.</p>
          {groupByDay(matches.items).map(([day, dayMatches]) => (
            <div className="match-day-group" key={day}>
              <h3 className="match-day-heading">{formatDayHeading(dayMatches[0].utcDate)}</h3>
              <ul className="match-grid">
                {dayMatches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    isOpen={openId === match.id}
                    onToggle={toggle}
                    xgStatus={xg.status}
                    xg={xgById.get(match.id) ?? null}
                  />
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <p className="empty">No fixtures are published for this competition right now.</p>
      )}
    </section>
  )
}
