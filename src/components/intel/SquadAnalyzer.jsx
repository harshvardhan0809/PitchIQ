import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { fetchSquad } from '../../services/intelligenceApi'
import { getProfile, saveProfile } from '../../services/profileApi'
import { PlayerLink } from '../PlayerLink'
import '../../styles/intel.css'

/**
 * "My Team": connect an FPL team by ID and see it run through the projection
 * engine — projected score, captain advice, weak links (all free) and the
 * transfer fixes (Pro). The team ID is saved to the user's profile (so it
 * follows them across devices), with localStorage as an offline fallback.
 */
const STORAGE_KEY = 'pitchiq-team-id'

function readStored() {
  try { return window.localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
}
function writeStored(id) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage unavailable */ }
}

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

function ConnectForm({ value, onChange, onSubmit, connected, onDisconnect }) {
  return (
    <form className="sq-connect" onSubmit={onSubmit}>
      <label htmlFor="fpl-team-id" className="sq-connect-label">FPL team ID</label>
      <div className="sq-connect-row">
        <input
          id="fpl-team-id"
          className="sq-connect-input"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="e.g. 1234567"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
        />
        <button type="submit" className="sq-connect-btn">{connected ? 'Reload' : 'Analyse my team'}</button>
        {connected && (
          <button type="button" className="sq-connect-clear" onClick={onDisconnect}>Change</button>
        )}
      </div>
      <p className="sq-connect-hint">
        Find it in your FPL team URL: <code>fantasy.premierleague.com/entry/<b>1234567</b>/event/…</code>
      </p>
    </form>
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
  const [teamId, setTeamId] = useState(readStored)
  const [submitted, setSubmitted] = useState(readStored)

  // Adopt the team id saved to the profile (it wins over a local-only value, so
  // the same team shows up on any device the user signs in from).
  useEffect(() => {
    if (!signedIn) return undefined
    let active = true
    getProfile()
      .then((profile) => {
        const saved = profile?.fplTeamId ? String(profile.fplTeamId) : ''
        if (active && saved) { setTeamId(saved); setSubmitted(saved); writeStored(saved) }
      })
      .catch(() => { /* fall back to the local value */ })
    return () => { active = false }
  }, [signedIn])

  const { status, data, error, reload } = useAsync(fetchSquad, [submitted, league], {
    enabled: Boolean(submitted),
    refreshKey: plan,
  })

  function handleSubmit(event) {
    event.preventDefault()
    const id = teamId.trim()
    if (!id) return
    writeStored(id)
    saveProfile({ fplTeamId: id }).catch(() => { /* local copy still works */ })
    if (id === submitted) reload()
    else setSubmitted(id)
  }

  function handleDisconnect() {
    writeStored('')
    saveProfile({ fplTeamId: '' }).catch(() => {})
    setTeamId('')
    setSubmitted('')
  }

  return (
    <div className="intel sq">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">My Team</p>
          <h1 className="intel-title">Your squad, projected</h1>
          <p className="intel-sub">
            Connect your FPL team once and get a weekly read: projected score, the right captain, your weak links,
            and the transfers that fix them.
          </p>
        </div>
      </header>

      <ConnectForm
        value={teamId}
        onChange={setTeamId}
        onSubmit={handleSubmit}
        connected={Boolean(submitted)}
        onDisconnect={handleDisconnect}
      />

      {!submitted && (
        <p className="sq-idle">Enter your team ID above to analyse your squad.</p>
      )}

      {submitted && status === 'loading' && <Skeleton />}

      {submitted && status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'Could not analyse that team.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {submitted && status === 'ready' && data && (
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
