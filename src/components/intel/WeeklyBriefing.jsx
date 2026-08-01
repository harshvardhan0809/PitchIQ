import { Link } from 'react-router-dom'

import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { fetchBriefing } from '../../services/intelligenceApi'
import { PlayerLink } from '../PlayerLink'
import '../../styles/intel.css'

/**
 * Weekly Briefing: the plain-English gameweek digest. The headline and the first
 * section are free; the rest is the Pro payoff, behind an upgrade panel.
 */
function Face({ player }) {
  if (player?.photoUrl) {
    return <span className="brief-face"><img src={player.photoUrl} alt="" loading="lazy" /></span>
  }
  const initials = (player?.name ?? '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  return <span className="brief-face">{initials}</span>
}

function Section({ section, index }) {
  const { player } = section
  return (
    <article className={`brief-card ${section.tone}`}>
      <div className="brief-num">{String(index + 1).padStart(2, '0')}</div>
      <div className="brief-main">
        <h3 className="brief-title">{section.title}</h3>
        <p className="brief-body">{section.body}</p>
      </div>
      {player && (
        <div className="brief-player">
          <Face player={player} />
          <div className="brief-player-id">
            <span className="brief-player-name"><PlayerLink player={player}>{player.webName ?? player.name}</PlayerLink></span>
            <span className="brief-player-meta">
              {player.position} · {player.teamShort}
              {player.price ? ` · £${player.price.toFixed(1)}` : ''}
            </span>
          </div>
          <div className="brief-xpts">{player.expectedPoints}<small>xPts</small></div>
        </div>
      )}
    </article>
  )
}

function UpgradePanel({ lockedCount, requiredPlan }) {
  return (
    <div className="brief-upgrade">
      <span className="lock-chip">🔒 {PLAN_LABELS[requiredPlan]} feature</span>
      <h3>Read the full briefing</h3>
      <p>
        Unlock {lockedCount} more section{lockedCount === 1 ? '' : 's'} — the differential to watch, the best value pick,
        and who to be wary of — refreshed before every deadline.
      </p>
      <Link to="/pricing" className="upgrade-cta">Unlock {PLAN_LABELS[requiredPlan]} →</Link>
      <p className="upgrade-note">Secure card &amp; UPI checkout. Cancel anytime.</p>
    </div>
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

export function WeeklyBriefing({ league = 'PL' }) {
  const { plan } = useAuth()
  const { status, data, error, reload } = useAsync(fetchBriefing, [league], { refreshKey: plan })

  return (
    <div className="intel brief">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">Weekly Briefing</p>
          <h1 className="intel-title">Your gameweek, in a minute</h1>
          <p className="intel-sub">
            The captain, a differential, the best value, and who to watch — written from the projection model,
            refreshed before every deadline.
          </p>
          {data?.gameweekName && (
            <p className="intel-gw">
              <b>{data.gameweekName}</b>
              {data.phase === 'pre' && ' · pre-season projection'}
              {data.phase === 'demo' && ' · sample data'}
            </p>
          )}
        </div>
      </header>

      {status === 'loading' && <Skeleton />}

      {status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'The briefing could not be generated.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {status === 'ready' && data && (
        <>
          {data.headline && <p className="brief-headline">{data.headline}</p>}

          <div className="brief-list">
            {data.sections.map((section, index) => (
              <Section key={section.id} section={section} index={index} />
            ))}
          </div>

          {data.locked && data.lockedCount > 0 && (
            <UpgradePanel lockedCount={data.lockedCount} requiredPlan={data.requiredPlan} />
          )}
        </>
      )}
    </div>
  )
}
