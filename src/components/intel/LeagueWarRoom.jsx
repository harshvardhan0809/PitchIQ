import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { fetchLeague } from '../../services/intelligenceApi'
import { getProfile } from '../../services/profileApi'
import { PlayerLink } from '../PlayerLink'
import '../../styles/intel.css'

/**
 * Mini-League War Room: enter a classic league ID to see the standings and your
 * exact gap to overtake (free), plus the rival captains, league template and your
 * differentials (Pro). The league ID is remembered locally; the caller's FPL team
 * ID (from their profile) is passed through so the server can highlight their row.
 */
const STORAGE_KEY = 'optixi-league-id'

function readStored() {
  try { return window.localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
}
function writeStored(id) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage unavailable */ }
}

const MOVE = { up: '▲', down: '▼', same: '–' }

function ConnectForm({ value, onChange, onSubmit, connected, onClear }) {
  return (
    <form className="sq-connect" onSubmit={onSubmit}>
      <label htmlFor="league-id" className="sq-connect-label">Classic league ID</label>
      <div className="sq-connect-row">
        <input
          id="league-id"
          className="sq-connect-input"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="e.g. 123456"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
        />
        <button type="submit" className="sq-connect-btn">{connected ? 'Reload' : 'Open War Room'}</button>
        {connected && <button type="button" className="sq-connect-clear" onClick={onClear}>Change</button>}
      </div>
      <p className="sq-connect-hint">
        Find it in the league URL: <code>fantasy.premierleague.com/leagues/<b>123456</b>/standings/c</code>
      </p>
    </form>
  )
}

function YouCard({ you }) {
  if (!you) {
    return (
      <div className="wr-you wr-you-empty">
        <p>
          Set your FPL Team ID in <Link to="/account" className="wr-inline-link">your profile</Link> to highlight your row
          and see your exact gap to overtake.
        </p>
      </div>
    )
  }
  return (
    <div className="wr-you">
      <div className="wr-you-rank">
        <span className="wr-you-rank-val">{you.rank}</span>
        <span className="wr-you-rank-lbl">your rank</span>
      </div>
      <div className="wr-you-main">
        <h2 className="wr-you-team">{you.teamName}</h2>
        <p className="wr-you-meta">{you.total.toLocaleString('en-US')} pts total · {you.eventTotal} this GW</p>
      </div>
      <div className="wr-you-gaps">
        {you.toOvertake
          ? (
            <p className="wr-gap">
              <b>{you.toOvertake.points}</b> pt{you.toOvertake.points === 1 ? '' : 's'} to overtake
              <span className="wr-gap-target">{you.toOvertake.targetName}</span>
            </p>
          )
          : <p className="wr-gap wr-gap-top">🏆 Top of the league</p>}
        {you.leaderGap > 0 && <p className="wr-gap-leader">{you.leaderGap.toLocaleString('en-US')} behind the leader</p>}
      </div>
    </div>
  )
}

function StandingsTable({ standings, locked }) {
  return (
    <div className="wr-table-wrap">
      <table className="wr-table">
        <thead>
          <tr>
            <th className="wr-th-rank">#</th>
            <th>Team</th>
            <th className="wr-th-cap">Captain</th>
            <th className="wr-th-num">GW</th>
            <th className="wr-th-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.entryId} className={row.isYou ? 'wr-you-row' : ''}>
              <td className="wr-td-rank">
                <span className={`wr-move wr-move-${row.movement}`} aria-hidden="true">{MOVE[row.movement]}</span>
                {row.rank}
              </td>
              <td>
                <div className="wr-team">{row.teamName}{row.isYou && <span className="wr-you-tag">YOU</span>}</div>
                <div className="wr-manager">{row.managerName}</div>
              </td>
              <td className="wr-td-cap">
                {row.captain
                  ? <span className="wr-cap"><PlayerLink player={row.captain}>{row.captain.webName}</PlayerLink><small>{row.captain.teamShort}</small></span>
                  : locked ? <span className="wr-cap-lock" title="Pro feature">🔒</span> : <span className="wr-cap-none">—</span>}
              </td>
              <td className="wr-td-num">{row.eventTotal}</td>
              <td className="wr-td-num wr-td-total">{row.total.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CaptainBars({ captains }) {
  if (!captains.length) return null
  const max = Math.max(...captains.map((c) => c.pct), 1)
  return (
    <section className="wr-section">
      <h3 className="wr-section-title">Who your rivals are captaining</h3>
      <ul className="wr-cap-bars">
        {captains.map((c) => (
          <li key={`${c.webName}-${c.teamShort}`} className="wr-cap-bar">
            <span className="wr-cap-name"><PlayerLink player={c}>{c.webName}</PlayerLink> <small>{c.teamShort}</small></span>
            <span className="wr-cap-track"><span className="wr-cap-fill" style={{ width: `${(c.pct / max) * 100}%` }} /></span>
            <span className="wr-cap-pct">{c.pct}%</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TemplateChips({ template, differentials }) {
  if (!template.length && !differentials.length) return null
  return (
    <div className="wr-columns">
      {template.length > 0 && (
        <section className="wr-section">
          <h3 className="wr-section-title">League template</h3>
          <p className="wr-section-sub">Most-owned across your league — the players you match rather than gain on.</p>
          <ul className="wr-chips">
            {template.map((t) => (
              <li key={`${t.webName}-${t.teamShort}`} className="wr-chip">
                <span className="pos-pill">{t.position}</span>
                <PlayerLink player={t}>{t.webName}</PlayerLink><small>{t.teamShort}</small>
                <span className="wr-chip-pct">{t.pct}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {differentials.length > 0 && (
        <section className="wr-section">
          <h3 className="wr-section-title">Your differentials</h3>
          <p className="wr-section-sub">Players you own that few rivals do — where you gain ground when they return.</p>
          <ul className="wr-chips">
            {differentials.map((d) => (
              <li key={`${d.webName}-${d.teamShort}`} className="wr-chip wr-chip-diff">
                <span className="pos-pill">{d.position}</span>
                <PlayerLink player={d}>{d.webName}</PlayerLink><small>{d.teamShort}</small>
                <span className="wr-chip-own">{d.owners} owner{d.owners === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function UpgradePanel({ requiredPlan, lockedCount }) {
  return (
    <div className="upgrade wr-upgrade">
      <span className="lock-chip">🔒 {PLAN_LABELS[requiredPlan]} feature</span>
      <h3>See what your rivals are doing</h3>
      <p>
        Unlock every rival&apos;s captain across your top {lockedCount}, the league template, and your own differentials —
        so you know exactly where to attack and defend before each deadline.
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
      {[0, 1, 2, 3, 4].map((index) => <div className="sk row" key={index} />)}
    </div>
  )
}

export function LeagueWarRoom({ league = 'PL' }) {
  const { plan, signedIn } = useAuth()
  const [leagueId, setLeagueId] = useState(readStored)
  const [submitted, setSubmitted] = useState(readStored)
  const [entryId, setEntryId] = useState('')

  // Pull the caller's own team ID from their profile so the server can highlight
  // their row and compute the overtake gap.
  useEffect(() => {
    if (!signedIn) return undefined
    let active = true
    getProfile()
      .then((profile) => { if (active && profile?.fplTeamId) setEntryId(String(profile.fplTeamId)) })
      .catch(() => { /* highlight is optional */ })
    return () => { active = false }
  }, [signedIn])

  const { status, data, error, reload } = useAsync(fetchLeague, [submitted, entryId, league], {
    enabled: Boolean(submitted),
    refreshKey: plan,
  })

  function handleSubmit(event) {
    event.preventDefault()
    const id = leagueId.trim()
    if (!id) return
    writeStored(id)
    if (id === submitted) reload()
    else setSubmitted(id)
  }

  function handleClear() {
    writeStored('')
    setLeagueId('')
    setSubmitted('')
  }

  const empty = data && data.standings.length === 0

  return (
    <div className="intel wr">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">Mini-League War Room</p>
          <h1 className="intel-title">Your league, decoded</h1>
          <p className="intel-sub">
            Where you stand, the exact points to overtake the manager above you, and — with Pro — what every rival is
            captaining, the league template, and your differentials.
          </p>
        </div>
      </header>

      <ConnectForm
        value={leagueId}
        onChange={setLeagueId}
        onSubmit={handleSubmit}
        connected={Boolean(submitted)}
        onClear={handleClear}
      />

      {!submitted && <p className="sq-idle">Enter your league ID above to open the War Room.</p>}

      {submitted && status === 'loading' && <Skeleton />}

      {submitted && status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'Could not open that league.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {submitted && status === 'ready' && data && (
        empty ? (
          <div className="pw-empty-state">
            <span className="pw-empty-mark" aria-hidden="true">⚔</span>
            <h3>No standings yet</h3>
            <p>This league has no results — either the ID is wrong, or the season hasn&apos;t played a gameweek yet. Standings fill after GW1.</p>
          </div>
        ) : (
          <>
            <section className="wr-head">
              <div>
                <h2 className="wr-league-name">{data.league.name}</h2>
                <p className="wr-league-meta">
                  {data.league.size} teams{data.league.hasNext ? '+' : ''}
                  {data.gameweekName && <> · {data.gameweekName}</>}
                  {data.phase === 'demo' && ' · sample data'}
                </p>
              </div>
            </section>

            <YouCard you={data.you} />
            <StandingsTable standings={data.standings} locked={data.locked} />

            {data.locked
              ? <UpgradePanel requiredPlan={data.requiredPlan} lockedCount={data.lockedCount} />
              : (
                <>
                  <CaptainBars captains={data.captains} />
                  <TemplateChips template={data.template} differentials={data.yourDifferentials} />
                </>
              )}
          </>
        )
      )}
    </div>
  )
}
