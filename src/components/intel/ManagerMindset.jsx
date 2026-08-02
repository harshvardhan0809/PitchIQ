import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAsync } from '../../hooks/useAsync'
import { PLAN_LABELS } from '../../lib/plan'
import { useAuth } from '../../lib/auth'
import { fetchManager } from '../../services/intelligenceApi'
import '../../styles/intel.css'

/**
 * Manager's Mindset: pick a club and read the manager's mentality from how the
 * team actually plays — attacking intent, defensive setup, home/away personality,
 * temperament and momentum — plus how that mindset shapes the next fixture.
 * The archetype (free) is the shareable read; the breakdown and next-match
 * influence are the Pro payoff.
 */
const CHARACTER = {
  open: { label: 'Open game', tone: 'good' },
  balanced: { label: 'Balanced', tone: 'neutral' },
  cagey: { label: 'Cagey', tone: 'bad' },
}

function Crest({ team }) {
  if (team.crest) return <span className="mgr-crest"><img src={team.crest} alt="" loading="lazy" /></span>
  return <span className="mgr-crest">{team.shortName}</span>
}

function TraitBar({ trait }) {
  const width = typeof trait.score === 'number' ? trait.score : 50
  return (
    <div className={`mgr-trait ${trait.tone ?? 'neutral'}`}>
      <div className="mgr-trait-top">
        <span className="mgr-trait-label">{trait.label}</span>
        <span className="mgr-trait-val">{trait.value}</span>
      </div>
      <div className="mgr-trait-track"><div className="mgr-trait-fill" style={{ width: `${width}%` }} /></div>
      {trait.note && <p className="mgr-trait-note">{trait.note}</p>}
    </div>
  )
}

function Record({ record }) {
  if (!record) return null
  return (
    <div className="mgr-record">
      <div className="mgr-record-stats">
        <span><b>{record.played}</b> played</span>
        <span><b>{record.goalsFor}</b> for</span>
        <span><b>{record.goalsAgainst}</b> against</span>
        <span><b>{record.cleanSheets}</b> clean sheets</span>
      </div>
      {record.recent?.length > 0 && (
        <div className="mgr-form">
          {record.recent.map((result, index) => (
            <span key={`${result}-${index}`} className={`mgr-form-dot r-${result.toLowerCase()}`}>{result}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function NextMatch({ nextMatch }) {
  if (!nextMatch) return null
  if (!nextMatch.available) return <p className="mgr-empty">{nextMatch.note}</p>
  const character = CHARACTER[nextMatch.character] ?? CHARACTER.balanced
  return (
    <section className="mgr-next">
      <div className="mgr-next-head">
        <h3 className="mgr-section-title">How the mindset shapes the next match</h3>
        <span className={`mgr-char mgr-char-${character.tone}`}>{character.label}</span>
      </div>
      <p className="mgr-next-fixture">
        {nextMatch.home ? 'Home vs' : 'Away at'} <b>{nextMatch.opponent}</b>
        <span className="mgr-next-arch"> · {nextMatch.opponentArchetype}</span>
      </p>
      <p className="mgr-next-lean">{nextMatch.lean}</p>
      <p className="mgr-next-edge">{nextMatch.edge}</p>
      <div className="mgr-next-cs">
        <span className="mgr-next-cs-lbl">Clean-sheet lean</span>
        <div className="mgr-trait-track"><div className="mgr-trait-fill good" style={{ width: `${nextMatch.cleanSheetPct}%` }} /></div>
        <span className="mgr-next-cs-val">{nextMatch.cleanSheetPct}%</span>
      </div>
    </section>
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

export function ManagerMindset({ league = 'PL' }) {
  const { plan } = useAuth()
  const [teamId, setTeamId] = useState('')
  const { status, data, error, reload } = useAsync(fetchManager, [teamId, league], { refreshKey: plan })

  const selected = teamId || (data?.team?.id ?? '')

  return (
    <div className="intel mgr">
      <header className="intel-head">
        <div>
          <p className="intel-eyebrow">Manager&apos;s Mindset</p>
          <h1 className="intel-title">The gaffer&apos;s game plan</h1>
          <p className="intel-sub">
            Every manager leaves a fingerprint on how their team plays. This reads that mentality straight from the
            club&apos;s on-pitch behaviour — and shows how it tilts the next match.
          </p>
          {data?.gameweekName && (
            <p className="intel-gw">
              <b>{data.gameweekName}</b>
              {data.dataDepth === 'pre-season' && ' · pre-season read from squad strength (deepens once games are played)'}
              {data.phase === 'demo' && ' · sample data'}
            </p>
          )}
        </div>
        {data?.teams?.length > 0 && (
          <label className="mgr-picker">
            <span className="mgr-picker-label">Club</span>
            <select value={selected} onChange={(event) => setTeamId(event.target.value)}>
              {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        )}
      </header>

      {status === 'loading' && <Skeleton />}

      {status === 'error' && (
        <div className="intel-error">
          <p>{error?.message ?? 'Could not analyse that club.'}</p>
          <button type="button" onClick={reload}>Try again</button>
        </div>
      )}

      {status === 'ready' && data && (
        <>
          <section className="mgr-hero">
            <Crest team={data.team} />
            <div className="mgr-hero-id">
              <h2 className="mgr-team-name">{data.team.name}</h2>
              <p className="mgr-archetype">{data.profile.archetype.label}</p>
              <p className="mgr-tagline">{data.profile.archetype.tagline}</p>
            </div>
          </section>

          <p className="mgr-mentality">{data.profile.mentality}</p>
          <p className="mgr-effect"><span className="mgr-effect-tag">On the pitch</span> {data.profile.effect}</p>

          {data.locked ? (
            <div className="upgrade mgr-upgrade">
              <span className="lock-chip">🔒 {PLAN_LABELS[data.requiredPlan]} feature</span>
              <h3>See the full read</h3>
              <p>
                Unlock the trait breakdown — attacking intent, defensive setup, temperament and momentum — plus exactly
                how this manager&apos;s mindset shapes the next fixture&apos;s outcome.
              </p>
              <Link to="/pricing" className="upgrade-cta">Unlock {PLAN_LABELS[data.requiredPlan]} →</Link>
              <p className="upgrade-note">Secure card &amp; UPI checkout. Cancel anytime.</p>
            </div>
          ) : (
            <>
              <Record record={data.profile.record} />
              <section className="mgr-traits">
                {data.profile.traits.map((trait) => <TraitBar key={trait.label} trait={trait} />)}
              </section>
              <NextMatch nextMatch={data.nextMatch} />
              <p className="mgr-disclaimer">
                Inferred from the team&apos;s on-pitch behaviour and squad strength — a read of the managerial approach,
                not inside knowledge of any individual.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
