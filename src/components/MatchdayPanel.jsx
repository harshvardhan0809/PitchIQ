import { TeamCrest } from './TeamCrest'
import { formatDayHeading, formatRelative, formatScoreline, formatTime } from '../lib/format'

function MatchCard({ match }) {
  const scoreline = formatScoreline(match)
  const isLive = match.state === 'live'

  return (
    <li className={`match-card state-${match.state}`}>
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

      {match.state === 'off' && <p className="match-card-note">{match.status.toLowerCase()}</p>}
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

export function MatchdayPanel({ matches, competitionName }) {
  const hasMatches = matches.items.length > 0
  const relative = formatRelative(matches.firstKickoff)

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
        groupByDay(matches.items).map(([day, dayMatches]) => (
          <div className="match-day-group" key={day}>
            <h3 className="match-day-heading">{formatDayHeading(dayMatches[0].utcDate)}</h3>
            <ul className="match-grid">
              {dayMatches.map((match) => <MatchCard key={match.id} match={match} />)}
            </ul>
          </div>
        ))
      ) : (
        <p className="empty">No fixtures are published for this competition right now.</p>
      )}
    </section>
  )
}
