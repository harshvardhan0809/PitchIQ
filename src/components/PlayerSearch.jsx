import { PlayerAvatar } from './PlayerAvatar'

function SearchResult({ player, active, onSelect }) {
  return (
    <li>
      <button
        className={`search-result ${active ? 'active' : ''}`}
        type="button"
        onClick={() => onSelect(player.id)}
      >
        <PlayerAvatar initials={player.initials} photoUrl={player.photoUrl} size="small" />
        <span className="search-result-text">
          <strong>{player.name}</strong>
          <small>{player.team} · {player.position}</small>
        </span>
        {player.availability && player.availability.code !== 'available' && (
          <span className={`availability-badge ${player.availability.code}`}>
            {player.availability.label}
          </span>
        )}
      </button>
    </li>
  )
}

export function PlayerSearch({
  query,
  onQueryChange,
  results,
  selectedId,
  onSelect,
  competitionName,
}) {
  const { status, data, error } = results
  const players = data ?? []
  const showResults = query.trim().length > 0

  return (
    <div className="search">
      <label className="search-field" htmlFor="player-search">
        <span className="search-icon" aria-hidden="true">&#128269;</span>
        <input
          id="player-search"
          type="search"
          value={query}
          autoComplete="off"
          placeholder={`Search a ${competitionName} player`}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      {showResults && (
        <div className="search-results" role="region" aria-live="polite" aria-busy={status === 'loading'}>
          {status === 'loading' && <p className="search-state">Searching…</p>}

          {status === 'error' && <p className="search-state error">{error.message}</p>}

          {status === 'ready' && players.length === 0 && (
            <p className="search-state">
              No {competitionName} player matches “{query.trim()}”. Squad lists only cover
              clubs in this competition.
            </p>
          )}

          {status === 'ready' && players.length > 0 && (
            <ul className="search-result-list">
              {players.map((player) => (
                <SearchResult
                  active={player.id === selectedId}
                  key={player.id}
                  onSelect={onSelect}
                  player={player}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
