import { Link } from 'react-router-dom'

import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { fetchSquad } from '../../services/intelligenceApi'
import { getProfile } from '../../services/profileApi'
import { usesLiveData } from '../../services/footballApi'
import { PlayerLink } from '../PlayerLink'
import '../../styles/intel.css'

/**
 * "My Team": runs the FPL team saved on the user's profile through the projection
 * engine — projected score, captain advice, weak links (all free) and the
 * transfer fixes (Pro). The team ID is managed in the account/profile page (one
 * place, synced across devices); there's no inline entry here.
 */
function Fixture({ next }) {
  if (!next) return <span className="sq-fx sq-fx-none">—</span>
  return (
    <span className={`sq-fx diff-${next.difficulty}`}>
      {next.home ? 'H' : 'A'} {next.opponent}
    </span>
  )
}

function Face({ player, size = 'sm' }) {
  if (player.photoUrl) {
    return <span className={`sq-face sq-face-${size}`}><img src={player.photoUrl} alt="" loading="lazy" /></span>
  }
  const initials = (player.name ?? '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  return <span className={`sq-face sq-face-${size}`}>{initials}</span>
}

function PlayerRow({ player }) {
  const doubt = player.availability?.status && player.availability.status !== 'a'
  return (
    <li className={`sq-row ${doubt ? 'is-doubt' : ''}`}>
      <span className="pos-pill">{player.position}</span>
      <span className="sq-row-name">
        <PlayerLink player={player}>{player.webName ?? player.name}</PlayerLink>
        {player.isCaptain && <span className="sq-armband" title="Captain">C</span>}
        {player.isViceCaptain && <span className="sq-armband vice" title="Vice-captain">V</span>}
        {doubt && <span className="sq-doubt-dot" title={player.availability.label}>●</span>}
      </span>
      <span className="sq-row-team">{player.teamShort}</span>
      <Fixture next={player.next} />
      <span className="sq-row-xpts">{player.expectedPoints}<small>xPts</small></span>
    </li>
  )
}

function CaptainAdvice({ squad }) {
  const { captainAdvice, currentCaptain, recommendedCaptain, captainMultiplier } = squad
  if (!recommendedCaptain) return null
  const keep = captainAdvice === 'keep'
  return (
    <div className={`sq-captain ${keep ? 'keep' : 'switch'}`}>
      <p className="sq-captain-tag">{keep ? '✓ Armband looks right' : '↔ Consider switching armband'}</p>
      <div className="sq-captain-body">
        <Face player={recommendedCaptain} size="md" />
        <div>
          <h3><PlayerLink player={recommendedCaptain}>{recommendedCaptain.name}</PlayerLink> <span className="mult">×{captainMultiplier}</span></h3>
          <p className="sq-captain-line">
            {keep
              ? 'Your captain has the best projected ceiling in the XI.'
              : currentCaptain
                ? `Higher ceiling than your current pick, ${currentCaptain.name}.`
                : 'Best projected ceiling in your XI.'}
          </p>
        </div>
        <div className="sq-captain-score">
          <span className="val">{recommendedCaptain.expectedPoints}</span>
          <span className="lbl">xPts</span>
        </div>
      </div>
    </div>
  )
}

function WeakLinks({ links }) {
  if (!links?.length) return null
  return (
    <section className="sq-section">
      <h3 className="sq-section-title">Weak links</h3>
      <p className="sq-section-sub">The starters dragging your projection down this week.</p>
      <ul className="sq-weak">
        {links.map((player) => (
          <li key={player.id} className="sq-weak-item">
            <Face player={player} />
            <div className="sq-weak-id">
              <span className="sq-weak-name"><PlayerLink player={player}>{player.name}</PlayerLink></span>
              <span className="sq-weak-reason">{player.reason}</span>
            </div>
            <span className="sq-row-xpts">{player.expectedPoints}<small>xPts</small></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TransferCard({ swap }) {
  const spendLabel = swap.spend > 0
    ? `costs £${swap.spend.toFixed(1)}m`
    : swap.spend < 0 ? `frees £${Math.abs(swap.spend).toFixed(1)}m` : 'same price'
  return (
    <li className="sq-transfer">
      <div className="sq-transfer-side out">
        <span className="sq-transfer-dir">OUT</span>
        <span className="sq-transfer-name"><PlayerLink player={swap.out}>{swap.out.webName ?? swap.out.name}</PlayerLink></span>
        <span className="sq-transfer-meta">{swap.out.teamShort} · {swap.out.expectedPoints} xPts</span>
        <span className="sq-transfer-reason">{swap.reason}</span>
      </div>
      <div className="sq-transfer-arrow">
        <span className="sq-gain">+{swap.gain}</span>
        <small>xPts</small>
      </div>
      <div className="sq-transfer-side in">
        <span className="sq-transfer-dir">IN</span>
        <span className="sq-transfer-name"><PlayerLink player={swap.in}>{swap.in.webName ?? swap.in.name}</PlayerLink></span>
        <span className="sq-transfer-meta">{swap.in.teamShort} · {swap.in.expectedPoints} xPts</span>
        <span className="sq-transfer-spend">{spendLabel}</span>
      </div>
    </li>
  )
}

function Transfers({ data }) {
  return (
    <section className="sq-section">
      <div className="sq-section-head">
        <div>
          <h3 className="sq-section-title">Transfer suggestions</h3>
          <p className="sq-section-sub">Legal upgrades within your bank and the 3-per-club limit, ranked by points gained.</p>
        </div>
        <span className="pos-pill pro-chip">PRO</span>
      </div>

      {data.locked ? (
        <div className="sq-upgrade">
          <span className="lock-chip">🔒 {PLAN_LABELS[data.requiredPlan]} feature</span>
          <h3>See {data.transferCount} transfer{data.transferCount === 1 ? '' : 's'} that raise your projection</h3>
          <p>
            We found upgrades for your weak links — each with the exact points gain, price change and reasoning.
            Unlock the fixes with {PLAN_LABELS[data.requiredPlan]}.
          </p>
          <Link to="/pricing" className="upgrade-cta">
            Unlock {PLAN_LABELS[data.requiredPlan]} →
          </Link>
          <p className="upgrade-note">Secure card &amp; UPI checkout. Cancel anytime.</p>
        </div>
      ) : data.transfers.length ? (
        <ul className="sq-transfers">
          {data.transfers.map((swap) => <TransferCard key={`${swap.out.id}-${swap.in.id}`} swap={swap} />)}
        </ul>
      ) : (
        <p className="sq-empty">No upgrade clears the noise threshold — your XI is in good shape. Consider rolling the transfer.</p>
      )}
    </section>
  )
}

function ConnectPrompt() {
  return (
    <div className="sq-connect-prompt">
      <span className="sq-connect-mark" aria-hidden="true">🧩</span>
      <h3>Connect your FPL team</h3>
      <p>
        Add your FPL Team ID in your profile once and it powers My Team and the War Room across every device.
      </p>
      <Link to="/account" className="upgrade-cta">Set it in your profile →</Link>
      <p className="sq-connect-hint">
        You&apos;ll find the ID in your FPL team URL: <code>fantasy.premierleague.com/entry/<b>1234567</b>/event/…</code>
      </p>
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

export function SquadAnalyzer({ league = 'PL' }) {
  const { plan, signedIn } = useAuth()

  // The team ID lives on the profile now — read it, don't enter it here. In demo
  // mode (no live profile) a sample team stands in so the view is explorable.
  const profileQuery = useAsync(getProfile, [], { enabled: signedIn })
  const profileTeamId = profileQuery.data?.fplTeamId ? String(profileQuery.data.fplTeamId) : ''
  const teamId = usesLiveData ? profileTeamId : (profileTeamId || 'demo')

  const { status, data, error, reload } = useAsync(fetchSquad, [teamId, league], {
    enabled: Boolean(teamId),
    refreshKey: plan,
  })

  const resolvingProfile = usesLiveData && signedIn && profileQuery.status === 'loading'

  return (
    <div className="intel sq">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">My Team</p>
          <h1 className="intel-title">Your squad, projected</h1>
          <p className="intel-sub">
            A weekly read on the team saved to your profile: projected score, the right captain, your weak links,
            and the transfers that fix them.
          </p>
        </div>
        {teamId && (
          <div className="sq-connected">
            <span className="sq-connected-id">Team #{teamId}</span>
            <Link to="/account" className="sq-connected-link">Manage in profile</Link>
            <button type="button" className="sq-connected-reload" onClick={reload}>Reload</button>
          </div>
        )}
      </header>

      {resolvingProfile && <Skeleton />}

      {!resolvingProfile && !teamId && <ConnectPrompt />}

      {teamId && status === 'loading' && <Skeleton />}

      {teamId && status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'Could not analyse that team.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {teamId && status === 'ready' && data && (
        <>
          <section className="sq-summary">
            <div className="sq-entry">
              <h2 className="sq-team-name">{data.entry.teamName}</h2>
              <p className="sq-entry-meta">
                {data.entry.managerName}
                {data.entry.overallRank != null && <> · OR {data.entry.overallRank.toLocaleString()}</>}
                {' · '}£{data.entry.teamValue}m · £{data.entry.bank}m in bank
              </p>
              {data.gameweekName && <p className="intel-gw"><b>{data.gameweekName}</b></p>}
            </div>
            <div className="sq-proj">
              <span className="val">{data.squad.projectedPoints}</span>
              <span className="lbl">projected pts</span>
            </div>
          </section>

          <CaptainAdvice squad={data.squad} />

          <div className="sq-columns">
            <section className="sq-section">
              <h3 className="sq-section-title">Starting XI</h3>
              <ul className="sq-list">
                {data.squad.starters.map((player) => <PlayerRow key={player.id} player={player} />)}
              </ul>
            </section>
            <section className="sq-section">
              <h3 className="sq-section-title">Bench</h3>
              <ul className="sq-list sq-bench">
                {data.squad.bench.map((player) => <PlayerRow key={player.id} player={player} />)}
              </ul>
            </section>
          </div>

          <WeakLinks links={data.weakLinks} />
          <Transfers data={data} />
        </>
      )}
    </div>
  )
}
