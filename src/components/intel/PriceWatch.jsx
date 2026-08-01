import { Link } from 'react-router-dom'

import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { fetchPriceWatch } from '../../services/intelligenceApi'
import { PlayerLink } from '../PlayerLink'
import '../../styles/intel.css'

/**
 * Price Change Predictor — tonight's likely risers and fallers, ranked by
 * transfer momentum. Free users see the top few each way; Pro sees the full
 * boards. Its own view (not IntelBoard) because the shape is two directional
 * lists, not a single ranked board.
 */

const fmtSigned = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`

function Face({ item }) {
  if (item.photoUrl) return <span className="pw-face"><img src={item.photoUrl} alt="" loading="lazy" /></span>
  const initials = (item.webName ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  return <span className="pw-face">{initials}</span>
}

function PriceRow({ item, direction }) {
  return (
    <div className="pw-row">
      <Face item={item} />
      <div className="pw-id">
        <div className="pw-name">
          <PlayerLink player={item}>{item.webName}</PlayerLink>
          {item.changedThisGw !== 0 && (
            <span className="pw-changed">{item.changedThisGw > 0 ? '▲' : '▼'} £{Math.abs(item.changedThisGw).toFixed(1)} today</span>
          )}
        </div>
        <div className="pw-meta">
          <span className="pos-pill">{item.position}</span>
          <span>{item.teamShort} · £{item.price.toFixed(1)}</span>
          <span className="owned-pill">{item.ownership.toFixed(1)}% owned</span>
        </div>
      </div>
      <div className="pw-net">
        <span className={`pw-net-val ${direction}`}>{fmtSigned(item.netTransfers)}</span>
        <span className="pw-net-lbl">net transfers</span>
      </div>
      <div className="pw-conf">
        <div className="pw-conf-top">
          <span className="pw-like">{item.likelihood}</span>
          <span className="pw-pct">{item.confidence}%</span>
        </div>
        <div className="pw-bar"><div className={`pw-fill ${direction}`} style={{ width: `${item.confidence}%` }} /></div>
      </div>
    </div>
  )
}

function Column({ direction, title, items }) {
  return (
    <section className={`pw-col ${direction}`} aria-label={title}>
      <div className="pw-col-head">
        <span className="pw-arrow" aria-hidden="true">{direction === 'rise' ? '▲' : '▼'}</span>
        <h3>{title}</h3>
        <span className="pw-count">{items.length}</span>
      </div>
      {items.length === 0
        ? <p className="pw-empty">No movement yet.</p>
        : items.map((item) => <PriceRow key={item.id} item={item} direction={direction} />)}
    </section>
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

export function PriceWatch({ league = 'PL' }) {
  const { plan } = useAuth()
  const { status, data, error, reload } = useAsync(fetchPriceWatch, [league], { refreshKey: plan })

  const empty = data && data.risers.length === 0 && data.fallers.length === 0

  return (
    <div className="intel pricewatch">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">Price Change Predictor</p>
          <h1 className="intel-title">Tonight&apos;s price movers</h1>
          <p className="intel-sub">
            Who&apos;s closest to a price rise or fall, ranked by transfer momentum — the net transfers
            this gameweek as a share of all {data?.totalManagers ? data.totalManagers.toLocaleString('en-US') : ''} managers.
            Transfer before a rise; sell before a fall.
          </p>
          {data?.gameweekName && (
            <p className="intel-gw">
              <b>{data.gameweekName}</b>
              {data.phase === 'pre' && ' · opens when the gameweek goes live'}
              {data.phase === 'demo' && ' · sample data'}
            </p>
          )}
        </div>
      </header>

      {status === 'loading' && <Skeleton />}

      {status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'The price engine could not respond.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {status === 'ready' && data && (
        empty ? (
          <div className="pw-empty-state">
            <span className="pw-empty-mark" aria-hidden="true">£</span>
            <h3>No transfer movement yet</h3>
            <p>
              The Premier League season hasn&apos;t opened transfers. As soon as managers start moving,
              this board fills with tonight&apos;s likely risers and fallers.
            </p>
          </div>
        ) : (
          <>
            <div className="pw-cols">
              <Column direction="rise" title="Rising" items={data.risers} />
              <Column direction="fall" title="Falling" items={data.fallers} />
            </div>

            {data.locked && (
              <div className="upgrade pw-upgrade">
                <span className="lock-chip">🔒 {PLAN_LABELS[data.requiredPlan]} feature</span>
                <h3>See every mover</h3>
                <p>
                  You&apos;re seeing the top few each way. Unlock {data.lockedCount} more risers and fallers,
                  updated live before the nightly price change — so you always transfer at the right time.
                </p>
                <Link to="/pricing" className="upgrade-cta">Unlock {PLAN_LABELS[data.requiredPlan]} →</Link>
                <p className="upgrade-note">Secure card &amp; UPI checkout. Cancel anytime.</p>
              </div>
            )}

            <p className="pw-disclaimer">
              A prediction from live transfer momentum, not a guarantee — FPL&apos;s exact threshold floats through the day.
            </p>
          </>
        )
      )}
    </div>
  )
}
