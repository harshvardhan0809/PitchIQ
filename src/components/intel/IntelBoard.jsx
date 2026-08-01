import { Link } from 'react-router-dom'

import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { PlayerLink } from '../PlayerLink'
import '../../styles/intel.css'

/**
 * Generic premium "board" view: a top pick hero, a ranked board, and a paywall
 * for free users. Both Captain Picks and Differentials are thin configs over
 * this — new intelligence lists (transfer targets, price risers) drop in the
 * same way.
 */

function Face({ pick }) {
  if (pick.photoUrl) {
    return <span className="pick-face"><img src={pick.photoUrl} alt="" loading="lazy" /></span>
  }
  const initials = (pick.name ?? '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  return <span className="pick-face">{initials}</span>
}

function DifficultyPill({ next }) {
  if (!next) return null
  return (
    <span className={`diff-pill diff-${next.difficulty}`}>
      {next.home ? 'H' : 'A'} {next.opponent} · {next.difficulty}
    </span>
  )
}

function Owned({ value }) {
  if (value == null) return null
  return <span className="owned-pill">{value}% owned</span>
}

function Confidence({ value }) {
  return (
    <div className="confidence">
      <div className="confidence-top">
        <span className="lbl">Confidence</span>
        <span className="pct">{value}%</span>
      </div>
      <div className="confidence-track">
        <div className="confidence-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function Reasons({ reasons }) {
  if (!reasons?.length) return null
  return (
    <ul className="reasons">
      {reasons.map((reason, index) => (
        <li className={`reason ${reason.tone}`} key={`${reason.kind}-${index}`}>{reason.text}</li>
      ))}
    </ul>
  )
}

function TopPick({ pick }) {
  return (
    <section className="top-pick" aria-label="Top pick">
      <p className="top-pick-tag">★ {pick.verdict}</p>
      <div className="top-pick-body">
        <Face pick={pick} />
        <div className="pick-id">
          <h2 className="pick-name"><PlayerLink player={pick}>{pick.name}</PlayerLink></h2>
          <div className="pick-meta">
            <span className="pos-pill">{pick.position}</span>
            <span>{pick.team}</span>
            <span>£{pick.price.toFixed(1)}</span>
            <DifficultyPill next={pick.next} />
            <Owned value={pick.ownership} />
            {pick.flags?.differential && <span className="badge-diff">Differential</span>}
          </div>
        </div>
        <div className="pick-scores">
          <div className="score">
            <span className="val">{pick.expectedPoints}</span>
            <span className="lbl">xPts</span>
          </div>
          <Confidence value={pick.confidence} />
        </div>
      </div>
      <Reasons reasons={pick.reasons} />
    </section>
  )
}

function BoardRow({ pick }) {
  return (
    <div className="board-row">
      <span className="rank">{pick.rank}</span>
      <div className="row-id">
        <div className="row-name">
          <PlayerLink player={pick}>{pick.name}</PlayerLink>
          {pick.flags?.differential && <span className="badge-diff">Diff</span>}
        </div>
        <div className="row-meta">
          <span className="pos-pill">{pick.position}</span>
          <span>{pick.teamShort} · £{pick.price.toFixed(1)}</span>
          <DifficultyPill next={pick.next} />
          <Owned value={pick.ownership} />
        </div>
      </div>
      <div className="row-conf"><Confidence value={pick.confidence} /></div>
      <div className="row-xpts">{pick.expectedPoints}<small>xPts</small></div>
    </div>
  )
}

const GHOST_ROWS = [2, 3, 4].map((rank) => ({
  rank, name: '—', teamShort: '—', position: '—', price: 0, expectedPoints: '—', confidence: 60, next: null, flags: {},
}))

function UpgradePanel({ lockedCount, requiredPlan, boardLabel }) {
  return (
    <div className="locked-wrap">
      <div className="locked-rows" aria-hidden="true">
        {GHOST_ROWS.map((pick) => <BoardRow key={pick.rank} pick={pick} />)}
      </div>
      <div className="upgrade">
        <span className="lock-chip">🔒 {PLAN_LABELS[requiredPlan]} feature</span>
        <h3>See the full {boardLabel}</h3>
        <p>
          Unlock {lockedCount} more ranked picks with confidence scores and the reasoning behind
          every call — updated before each deadline.
        </p>
        <Link to="/pricing" className="upgrade-cta">
          Unlock {PLAN_LABELS[requiredPlan]} →
        </Link>
        <p className="upgrade-note">Secure card &amp; UPI checkout. Cancel anytime.</p>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="intel-skeleton" aria-hidden="true">
      <div className="sk hero" />
      {[0, 1, 2, 3].map((index) => <div className="sk row" key={index} />)}
    </div>
  )
}

export function IntelBoard({ eyebrow, title, subtitle, boardLabel, fetcher, league = 'PL' }) {
  const { plan } = useAuth()
  const { status, data, error, reload } = useAsync(fetcher, [league], { refreshKey: plan })

  return (
    <div className="intel">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">{eyebrow}</p>
          <h1 className="intel-title">{title}</h1>
          <p className="intel-sub">{subtitle}</p>
          {data?.gameweekName && (
            <p className="intel-gw">
              <b>{data.gameweekName}</b>
              {data.phase === 'pre' && ' · pre-season projection from last season’s underlying numbers'}
              {data.phase === 'demo' && ' · sample data'}
            </p>
          )}
        </div>
      </header>

      {status === 'loading' && <Skeleton />}

      {status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'The intelligence engine could not respond.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {status === 'ready' && data && (
        <>
          {data.topPick && <TopPick pick={data.topPick} />}

          <div className="board-head">
            <h3>Full {boardLabel}</h3>
            <span>{data.locked ? `${data.lockedCount} more picks` : `Ranked 1–${data.board.length}`}</span>
          </div>

          {data.locked ? (
            <UpgradePanel lockedCount={data.lockedCount} requiredPlan={data.requiredPlan} boardLabel={boardLabel} />
          ) : (
            <div className="board">
              {data.board.map((pick) => <BoardRow key={pick.id} pick={pick} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
