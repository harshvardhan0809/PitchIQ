import { PlayerAvatar } from './PlayerAvatar'
import { TeamCrest } from './TeamCrest'

/** Only availability worth interrupting the reader for gets a badge. */
function AvailabilityBadge({ availability }) {
  if (!availability || availability.code === 'available') return null
  return <span className={`availability-badge ${availability.code}`}>{availability.label}</span>
}

function WatchCard({ player, onSelect }) {
  const selectable = Boolean(player.searchId)

  const content = (
    <>
      <div className="watch-card-head">
        <PlayerAvatar initials={player.initials} photoUrl={player.photoUrl} size="large" />
        <div className="watch-card-identity">
          <strong className="watch-card-name">{player.name}</strong>
          <span className="watch-card-team">
            <TeamCrest src={player.teamCrestUrl} name={player.team} size={16} />
            {player.teamShort ?? player.team}
            {player.position ? ` · ${player.position}` : ''}
          </span>
          <AvailabilityBadge availability={player.availability} />
        </div>
      </div>

      <dl className="watch-card-stats">
        {player.stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>

      {player.availability?.note && (
        <p className="watch-card-news">{player.availability.note}</p>
      )}
    </>
  )

  if (!selectable) {
    return <li className="watch-card is-static">{content}</li>
  }

  return (
    <li className="watch-card">
      <button type="button" onClick={() => onSelect(player.searchId)} aria-label={`Open the ${player.name} report`}>
        {content}
      </button>
    </li>
  )
}

export function PlayersToWatch({ playersToWatch, onSelect }) {
  return (
    <section className="panel watch-panel" id="players" aria-labelledby="watch-heading">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Form and output</p>
          <h2 id="watch-heading">{playersToWatch.heading}</h2>
        </div>
        <p className="panel-note">{playersToWatch.subheading}</p>
      </header>

      {playersToWatch.items.length > 0 ? (
        <ul className="watch-grid">
          {playersToWatch.items.map((player) => (
            <WatchCard key={player.id} onSelect={onSelect} player={player} />
          ))}
        </ul>
      ) : (
        <p className="empty">No scoring data has been published for this competition yet.</p>
      )}
    </section>
  )
}
