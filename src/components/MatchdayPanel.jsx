import { useEffect, useMemo, useRef, useState } from 'react'

import { TeamCrest } from './TeamCrest'
import { useAsync } from '../hooks/useAsync'
import { fetchLive, fetchMatchXg } from '../services/footballApi'
import { formatDayHeading, formatRelative, formatScoreline, formatTime } from '../lib/format'

const csTone = (pct) => (pct >= 45 ? 'good' : pct <= 20 ? 'bad' : 'neutral')

const LIVE_POLL_MS = 12000

// How each fixture-stat event reads in the live feed.
const EVENT_META = {
  goal: { icon: '⚽', cls: 'goal', label: 'Goal' },
  own_goal: { icon: '⚽', cls: 'og', label: 'Own goal' },
  assist: { icon: '🅰', cls: 'assist', label: 'Assist' },
  yellow: { icon: 'YC', cls: 'yellow', label: 'Yellow card' },
  red: { icon: 'RC', cls: 'red', label: 'Red card' },
  bonus: { icon: '★', cls: 'bonus', label: 'Bonus pts' },
  pen_saved: { icon: 'SV', cls: 'save', label: 'Pen saved' },
  pen_missed: { icon: 'PM', cls: 'miss', label: 'Pen missed' },
}

// Where a scorer/assister sits on the pitch: their side's half, x by role.
const PITCH_X = {
  home: { GK: 8, DEF: 22, MID: 37, FWD: 47 },
  away: { GK: 92, DEF: 78, MID: 63, FWD: 53 },
}

function pitchMarkers(events) {
  const attack = events.filter((event) => event.type === 'goal' || event.type === 'assist')
  const bySide = { home: [], away: [] }
  for (const event of attack) bySide[event.side].push(event)
  const out = []
  for (const side of ['home', 'away']) {
    const list = bySide[side]
    list.forEach((event, index) => {
      const x = PITCH_X[side][event.position] ?? (side === 'home' ? 40 : 60)
      const y = 50 + (index - (list.length - 1) / 2) * 17
      out.push({ ...event, x, y: Math.max(16, Math.min(84, y)) })
    })
  }
  return out
}

/**
 * The live match on a pitch: a tilted field with the score and match clock, and
 * a marker for every goal/assist popping onto that player's half in their
 * position zone as it lands. FPL has no ball-tracking, so this is honest — who
 * scored/assisted and roughly where they play, not real coordinates.
 */
function LivePitch({ home, away, info }) {
  const markers = pitchMarkers(info.events)

  // The ball glides to the latest goal the moment a poll surfaces it. Goals
  // already present when the card first opens are adopted without a move, so the
  // ball only travels on a genuinely new return — from one scorer to the next.
  const [ball, setBall] = useState({ x: 50, y: 50, moved: false, n: 0 })
  const seenGoals = useRef(null)

  useEffect(() => {
    const current = pitchMarkers(info.events).filter((marker) => marker.type === 'goal')
    const keys = new Set(current.map((goal) => goal.key))
    if (seenGoals.current === null) {
      seenGoals.current = keys
      return undefined
    }
    const fresh = current.filter((goal) => !seenGoals.current.has(goal.key))
    seenGoals.current = keys
    if (fresh.length > 0) {
      const target = fresh[fresh.length - 1]
      setBall((prev) => ({ x: target.x, y: target.y, moved: true, n: prev.n + 1 }))
    }
    return undefined
  }, [info.events])

  return (
    <div className="lp">
      <div className="lp-head">
        <span className={`mx-live-state ${info.live ? 'is-live' : ''}`}>
          {info.live && <span className="live-dot" aria-hidden="true" />}
          {info.live ? (info.minute ? `LIVE ${info.minute}'` : 'LIVE') : 'Full time'}
        </span>
        <span className="lp-scoreline">
          <b>{home.shortName}</b>
          <span className="lp-score">{info.homeScore}<i>–</i>{info.awayScore}</span>
          <b>{away.shortName}</b>
        </span>
      </div>

      <div className="lp-scene">
        <div className="lp-pitch" aria-hidden="true">
          <span className="lp-line" />
          <span className="lp-circle" />
          <span className="lp-box left" />
          <span className="lp-box right" />
          {ball.moved && (
            <span className="lp-ring" key={ball.n} style={{ left: `${ball.x}%`, top: `${ball.y}%` }} />
          )}
          <span className="lp-ball" style={{ left: `${ball.x}%`, top: `${ball.y}%` }} />
          {markers.map((marker) => (
            <span
              className={`lp-marker ${marker.type}`}
              key={marker.key}
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            >
              <span className="lp-pin">{marker.type === 'goal' ? '⚽' : '🅰'}</span>
              <span className="lp-tag">{marker.name}{marker.count > 1 ? ` ×${marker.count}` : ''}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The full returns list for one match — goals, assists, cards and bonus, each
 * tied to a real player. Not a timed play-by-play (FPL doesn't timestamp
 * events); it's the live state, polled, with new rows animating in.
 */
function LiveFeed({ info }) {
  if (info.events.length === 0) {
    return <p className="mx-feed-empty">No goals or cards yet.</p>
  }
  return (
    <ul className="mx-feed">
      {info.events.map((event) => {
        const meta = EVENT_META[event.type] ?? { icon: '•', cls: '', label: '' }
        return (
          <li className={`mx-feed-item side-${event.side}`} key={event.key}>
            <span className={`mx-feed-badge badge-${meta.cls}`}>{meta.icon}</span>
            <span className="mx-feed-name">{event.name}</span>
            <span className="mx-feed-type">{meta.label}{event.count > 1 ? ` ×${event.count}` : ''}</span>
            <span className="mx-feed-team">{event.teamShort}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The expected-goals read for one match, shown when its card is expanded. Every
 * number is the model's (FPL attack/defence strength) — projected before kickoff,
 * and graded against the real score once the match is done.
 */
function MatchXgDetail({ status, xg }) {
  if (status === 'loading' || status === 'idle') {
    return <div className="mx-detail mx-detail-state">Loading expected goals…</div>
  }
  if (status === 'error') {
    return <div className="mx-detail mx-detail-state">Couldn’t load the xG read for this match.</div>
  }
  if (!xg) {
    return <div className="mx-detail mx-detail-state">No expected-goals read is published for this match yet.</div>
  }

  const { home, away, totalXg, bttsPct, started, finished } = xg
  const total = Math.max(0.1, home.xg + away.xg)
  const homePct = Math.round((home.xg / total) * 100)
  const goals = finished ? (home.score ?? 0) + (away.score ?? 0) : null
  const verdictTone = finished ? (Math.abs(goals - totalXg) <= 1 ? 'good' : Math.abs(goals - totalXg) <= 2 ? 'neutral' : 'bad') : null

  return (
    <div className="mx-detail">
      <div className="mx-xg-row">
        <span className="mx-xg-side home">
          <b className="mx-xg-val">{home.xg}</b>
          <small className="mx-xg-team">{home.shortName}</small>
        </span>
        <div className="mx-bar" role="img" aria-label={`Expected goals ${home.shortName} ${home.xg}, ${away.shortName} ${away.xg}`}>
          <span className="mx-fill home" style={{ width: `${homePct}%` }} />
          <span className="mx-fill away" style={{ width: `${100 - homePct}%` }} />
        </div>
        <span className="mx-xg-side away">
          <b className="mx-xg-val">{away.xg}</b>
          <small className="mx-xg-team">{away.shortName}</small>
        </span>
      </div>
      <p className="mx-cap">{started ? 'projected expected goals' : 'expected goals'} · {home.shortName} vs {away.shortName}</p>

      <div className="mx-metrics">
        <div className={`mx-metric tone-${csTone(home.cleanSheetPct)}`}>
          <span className="mx-metric-val">{home.cleanSheetPct}<small>%</small></span>
          <span className="mx-metric-lbl">{home.shortName} clean sheet</span>
        </div>
        <div className="mx-metric">
          <span className="mx-metric-val">{totalXg}<small>xG</small></span>
          <span className="mx-metric-lbl">Total goals</span>
        </div>
        <div className={`mx-metric tone-${csTone(away.cleanSheetPct)}`}>
          <span className="mx-metric-val">{away.cleanSheetPct}<small>%</small></span>
          <span className="mx-metric-lbl">{away.shortName} clean sheet</span>
        </div>
      </div>

      {finished ? (
        <p className={`mx-verdict tone-${verdictTone}`}>
          Projected <b>{totalXg}</b> xG · actually <b>{goals}</b> {goals === 1 ? 'goal' : 'goals'}
        </p>
      ) : (
        <p className="mx-btts">Both teams to score <b>{bttsPct}%</b></p>
      )}
    </div>
  )
}

function MatchCard({ match, isOpen, onToggle, xgStatus, xg, liveInfo }) {
  const scoreline = formatScoreline(match)
  // Live data (when we have it) is the source of truth for score and status.
  const showLive = Boolean(liveInfo && (liveInfo.live || liveInfo.finished))
  const isLive = showLive ? liveInfo.live : match.state === 'live'
  const finished = showLive ? liveInfo.finished : match.state === 'finished'
  const showScore = showLive || scoreline !== null
  const scores = [
    showLive ? liveInfo.homeScore : match.homeTeam.score,
    showLive ? liveInfo.awayScore : match.awayTeam.score,
  ]
  const statusLabel = isLive
    ? (liveInfo?.minute ? `${liveInfo.minute}'` : 'LIVE')
    : finished ? 'FT' : formatTime(match.utcDate)

  return (
    <li className={`match-card state-${match.state} ${isLive ? 'is-live-now' : ''} ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="match-card-btn"
        onClick={() => onToggle(match.id)}
        aria-expanded={isOpen}
        aria-label={`${match.homeTeam.shortName} versus ${match.awayTeam.shortName} — show the match detail`}
      >
        <div className="match-card-status">
          {isLive && <span className="live-dot" aria-hidden="true" />}
          <span className={`match-status-label ${isLive ? 'live' : ''}`}>{statusLabel}</span>
        </div>

        <div className="match-card-teams">
          {[match.homeTeam, match.awayTeam].map((side, index) => (
            <div className="match-card-team" key={`${match.id}-${index === 0 ? 'home' : 'away'}`}>
              <TeamCrest src={side.crest} name={side.name} />
              <span className="match-card-name">{side.shortName}</span>
              {showScore && <span className="match-card-score">{scores[index] ?? 0}</span>}
            </div>
          ))}
        </div>

        <span className={`match-card-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden="true">xG</span>
      </button>

      {match.state === 'off' && <p className="match-card-note">{match.status.toLowerCase()}</p>}
      {isOpen && (
        <>
          {showLive && (
            <div className="mx-live">
              <LivePitch home={match.homeTeam} away={match.awayTeam} info={liveInfo} />
              <LiveFeed info={liveInfo} />
            </div>
          )}
          <MatchXgDetail status={xgStatus} xg={xg} />
        </>
      )}
    </li>
  )
}

/**
 * Groups the round by calendar day, because a matchday is usually spread over a
 * weekend and "Saturday / Sunday" is how people actually read a fixture list.
 *
 * The key must be the *local* day, not the UTC one: a 19:00 UTC kickoff is the
 * following day east of Greenwich, and keying on UTC there splits one local
 * evening into two groups that both render the same heading.
 */
function localDayKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function groupByDay(matches) {
  const groups = new Map()
  for (const match of matches) {
    const key = localDayKey(match.utcDate)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(match)
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

export function MatchdayPanel({ matches, competitionName, league = 'PL' }) {
  const hasMatches = matches.items.length > 0
  const relative = formatRelative(matches.firstKickoff)

  // Click a match to reveal its expected-goals read. The xG payload is only
  // fetched once a user actually opens a match (latched on), then reused.
  const [openId, setOpenId] = useState(null)
  const [wantXg, setWantXg] = useState(false)
  const xg = useAsync(fetchMatchXg, [league], { enabled: wantXg })
  const xgById = useMemo(
    () => new Map((xg.data?.matches ?? []).map((entry) => [entry.id, entry])),
    [xg.data],
  )

  const toggle = (id) => {
    setWantXg(true)
    setOpenId((prev) => (prev === id ? null : id))
  }

  // Live match center: while the round is in play, poll the short-TTL live feed
  // so scores, the match minute and returns update on their own. State only
  // advances on a successful poll, so the cards never flash back to static.
  //
  // The window opens when the spotlight already says "live", or on wall-clock
  // once the first kickoff passes — so a page left open before kickoff still
  // comes alive on its own — and closes ~4h later (or once the round is done).
  const firstKickoffMs = matches.firstKickoff ? Date.parse(matches.firstKickoff) : null
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60000)
    return () => window.clearInterval(id)
  }, [])
  const inKickoffWindow = firstKickoffMs != null
    && nowMs >= firstKickoffMs - 5 * 60000
    && nowMs <= firstKickoffMs + 4 * 3600000
  const anyItemLive = matches.items.some((item) => item.state === 'live')
  const isLiveWindow = anyItemLive || matches.state === 'live' || (matches.state !== 'recent' && inKickoffWindow)
  const [liveData, setLiveData] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  useEffect(() => {
    if (!isLiveWindow) return undefined
    let active = true
    const poll = () => {
      fetchLive(league)
        .then((data) => { if (active) { setLiveData(data); setLastUpdated(Date.now()) } })
        .catch(() => { /* keep the last good snapshot */ })
    }
    poll()
    const id = window.setInterval(poll, LIVE_POLL_MS)
    return () => { active = false; window.clearInterval(id) }
  }, [isLiveWindow, league])

  // Tick every 5s so the "updated Ns ago" freshness stamp stays honest.
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    if (!isLiveWindow) return undefined
    const id = window.setInterval(() => setNowTs(Date.now()), 5000)
    return () => window.clearInterval(id)
  }, [isLiveWindow])
  const agoLabel = lastUpdated ? `${Math.max(0, Math.round((nowTs - lastUpdated) / 1000))}s ago` : null

  const liveById = useMemo(
    () => new Map((liveData?.matches ?? []).map((entry) => [entry.id, entry])),
    [liveData],
  )

  return (
    <section className="panel matchday-panel" id="matches" aria-labelledby="matchday-heading">
      <header className="panel-header">
        <div>
          <p className="eyebrow">{competitionName}</p>
          <h2 id="matchday-heading">{matches.heading}</h2>
        </div>
        {isLiveWindow ? (
          <span className="live-pill"><span className="live-dot" aria-hidden="true" />Live{agoLabel ? ` · updated ${agoLabel}` : ' · connecting…'}</span>
        ) : (
          <p className="panel-note">
            {matches.note}
            {relative && matches.state === 'upcoming' ? ` Starts ${relative}.` : ''}
          </p>
        )}
      </header>

      {matches.isPreviousSeason && (
        <p className="callout">
          The new season has not started yet, so this shows the last completed round.
        </p>
      )}

      {hasMatches ? (
        <>
          <p className="match-hint">Tap a match for live returns &amp; its expected-goals read.</p>
          {groupByDay(matches.items).map(([day, dayMatches]) => (
            <div className="match-day-group" key={day}>
              <h3 className="match-day-heading">{formatDayHeading(dayMatches[0].utcDate)}</h3>
              <ul className="match-grid">
                {dayMatches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    isOpen={openId === match.id}
                    onToggle={toggle}
                    xgStatus={xg.status}
                    xg={xgById.get(match.id) ?? null}
                    liveInfo={liveById.get(match.id) ?? null}
                  />
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <p className="empty">No fixtures are published for this competition right now.</p>
      )}
    </section>
  )
}
