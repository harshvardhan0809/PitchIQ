import { PlayerAvatar } from './PlayerAvatar'
import { TeamCrest } from './TeamCrest'
import { usePlayerView } from '../lib/playerViewContext'

/**
 * Team of the Gameweek: the top projected performers per position (3 keepers,
 * 5 each for defence/midfield/attack) plus the single best pick overall. Each
 * number is that player's projected output for the upcoming round, computed from
 * their actual fixture — click any name to open the full player report.
 */

// FPL fixture difficulty runs 1 (easiest) to 5 (hardest).
function diffTone(difficulty) {
  if (difficulty == null) return 'neutral'
  if (difficulty <= 2) return 'good'
  if (difficulty >= 4) return 'bad'
  return 'neutral'
}

function openable(pick) {
  return { id: pick.searchId ?? pick.id, name: pick.name, team: pick.team, position: pick.position, photoUrl: pick.photoUrl }
}

function PickRow({ pick, rank, onOpen }) {
  return (
    <li className="tgw-row">
      <button type="button" onClick={() => onOpen(openable(pick))} aria-label={`Open the ${pick.name} report`}>
        <span className="tgw-rank">{rank}</span>
        <PlayerAvatar initials={pick.initials} photoUrl={pick.photoUrl} size="small" />
        <span className="tgw-id">
          <span className="tgw-name">{pick.webName ?? pick.name}</span>
          <span className="tgw-meta">
            <TeamCrest src={pick.teamCrestUrl} name={pick.team} size={13} />
            {pick.teamShort}
            <span className={`tgw-fix tone-${diffTone(pick.difficulty)}`}>{pick.fixture}</span>
          </span>
        </span>
        <span className="tgw-nums">
          <span className="tgw-out"><b>{Number(pick.output).toFixed(1)}</b><small>xPts</small></span>
          <span className="tgw-form">{Number(pick.form).toFixed(1)}<small>form</small></span>
        </span>
      </button>
    </li>
  )
}

function BestCard({ best, onOpen }) {
  if (!best) return null
  return (
    <button type="button" className="tgw-best" onClick={() => onOpen(openable(best))} aria-label={`Open the ${best.name} report`}>
      <span className="tgw-best-tag">{best.tag ?? 'Star of the Gameweek'}</span>
      <div className="tgw-best-body">
        <PlayerAvatar initials={best.initials} photoUrl={best.photoUrl} size="large" />
        <div className="tgw-best-id">
          <strong className="tgw-best-name">{best.name}</strong>
          <span className="tgw-best-meta">
            <TeamCrest src={best.teamCrestUrl} name={best.team} size={16} />
            {best.team} · {best.position}
            <span className={`tgw-fix tone-${diffTone(best.difficulty)}`}>{best.fixture}</span>
          </span>
        </div>
        <div className="tgw-best-out">
          <b>{Number(best.output).toFixed(1)}</b>
          <small>projected pts</small>
        </div>
      </div>
    </button>
  )
}

export function FormPicks({ formPicks }) {
  const { openPlayer } = usePlayerView()
  if (!formPicks) return null

  const hasPicks = formPicks.groups?.some((group) => group.picks?.length > 0)
  if (!hasPicks) return null

  return (
    <section className="panel tgw-panel" aria-labelledby="tgw-heading">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Form and output</p>
          <h2 id="tgw-heading">{formPicks.heading}</h2>
        </div>
        <p className="panel-note">{formPicks.subheading}</p>
      </header>

      <BestCard best={formPicks.best} onOpen={openPlayer} />

      <div className="tgw-grid">
        {formPicks.groups.map((group) => (
          group.picks.length > 0 && (
            <div className="tgw-col" key={group.key}>
              <h3 className="tgw-col-head">
                <span className="tgw-col-ic" aria-hidden="true">{group.icon}</span>
                {group.label}
              </h3>
              <ol className="tgw-list">
                {group.picks.map((p, index) => (
                  <PickRow key={p.id} pick={p} rank={index + 1} onOpen={openPlayer} />
                ))}
              </ol>
            </div>
          )
        ))}
      </div>
    </section>
  )
}
