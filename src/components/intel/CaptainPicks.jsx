import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { fetchCaptainPicks } from '../../services/intelligenceApi'
import '../../styles/intel.css'

// Ask the global account menu (top bar) to open — used by the upgrade CTA.
const openAccountMenu = () => window.dispatchEvent(new CustomEvent('pitchiq-open-account'))

function Face({ pick }) {
  if (pick.photoUrl) {
    return <span className="pick-face"><img src={pick.photoUrl} alt="" loading="lazy" /></span>
  }
  const initials = pick.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
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
    <section className="top-pick" aria-label="Top captain pick">
      <p className="top-pick-tag">★ {pick.verdict}</p>
      <div className="top-pick-body">
        <Face pick={pick} />
        <div className="pick-id">
          <h2 className="pick-name">{pick.name}</h2>
          <div className="pick-meta">
            <span className="pos-pill">{pick.position}</span>
            <span>{pick.team}</span>
            <span>£{pick.price.toFixed(1)}</span>
            <DifficultyPill next={pick.next} />
            {pick.flags.differential && <span className="badge-diff">Differential</span>}
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
          {pick.name}
          {pick.flags.differential && <span className="badge-diff">Diff</span>}
        </div>
        <div className="row-meta">
          <span className="pos-pill">{pick.position}</span>
          <span>{pick.teamShort} · £{pick.price.toFixed(1)}</span>
          <DifficultyPill next={pick.next} />
        </div>
      </div>
      <div className="row-conf"><Confidence value={pick.confidence} /></div>
      <div className="row-xpts">{pick.expectedPoints}<small>xPts</small></div>
    </div>
  )
}

function UpgradePanel({ lockedCount, requiredPlan, onUpgrade, sampleRows }) {
  return (
    <div className="locked-wrap">
      <div className="locked-rows" aria-hidden="true">
        {sampleRows.map((pick) => <BoardRow key={pick.rank} pick={pick} />)}
      </div>
      <div className="upgrade">
        <span className="lock-chip">🔒 {PLAN_LABELS[requiredPlan]} feature</span>
        <h3>See the full captain board</h3>
        <p>
          Unlock {lockedCount} more ranked picks with confidence scores, differentials and the
          reasoning behind every armband — updated before each deadline.
        </p>
        <button type="button" className="upgrade-cta" onClick={onUpgrade}>
          Unlock {PLAN_LABELS[requiredPlan]} →
        </button>
        <p className="upgrade-note">Enter an access code to upgrade. Card checkout arrives with billing.</p>
      </div>
    </div>
  )
}

// Placeholder rows sit behind the blur so the paywall shows there's real depth.
const GHOST_ROWS = [2, 3, 4].map((rank) => ({
  rank,
  name: '—',
  teamShort: '—',
  position: '—',
  price: 0,
  expectedPoints: '—',
  confidence: 60,
  next: null,
  flags: {},
}))

function Skeleton() {
  return (
    <div className="intel-skeleton" aria-hidden="true">
      <div className="sk hero" />
      {[0, 1, 2, 3].map((index) => <div className="sk row" key={index} />)}
    </div>
  )
}

export function CaptainPicks({ league = 'PL' }) {
  const { plan } = useAuth()
  // Refetch whenever the plan changes (sign in / upgrade / sign out), because
  // the server returns a different board for each tier.
  const { status, data, error, reload } = useAsync(fetchCaptainPicks, [league], { refreshKey: plan })

  return (
    <div className="intel">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">AI Captain Intelligence</p>
          <h1 className="intel-title">Who to captain</h1>
          <p className="intel-sub">
            Every captain candidate ranked by projected points and ceiling, with the fixture, form
            and minutes reasoning behind each call.
          </p>
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
          <p>{error?.message ?? 'The captain engine could not respond.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {status === 'ready' && data && (
        <>
          {data.topPick && <TopPick pick={data.topPick} />}

          {data.locked ? (
            <>
              <div className="board-head">
                <h3>Full captain board</h3>
                <span>{data.lockedCount} more picks</span>
              </div>
              <UpgradePanel
                lockedCount={data.lockedCount}
                requiredPlan={data.requiredPlan}
                onUpgrade={openAccountMenu}
                sampleRows={GHOST_ROWS}
              />
            </>
          ) : (
            <>
              <div className="board-head">
                <h3>Full captain board</h3>
                <span>Ranked 1–{data.board.length}</span>
              </div>
              <div className="board">
                {data.board.map((pick) => <BoardRow key={pick.id} pick={pick} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
