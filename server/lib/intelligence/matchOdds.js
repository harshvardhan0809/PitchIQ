import { HttpError } from '../http.js'
import { indexBy, teamCrestUrl } from '../providers/fpl.js'
import { toIso, toNumber } from '../format.js'

/**
 * Match xG & Clean Sheets.
 *
 * For every fixture in the focus gameweek, estimate each side's expected goals
 * and the chance they keep a clean sheet — from the FPL attack/defence strength
 * ratings, no external data. A simple, transparent Poisson model:
 *
 *   xG(attacker) = base(home/away) · attackFactor(attacker) · defenceWeakness(defender)
 *   cleanSheet(team) = P(opponent scores 0) = e^(−xG(opponent))
 *   BTTS = (1 − e^(−xG_home)) · (1 − e^(−xG_away))
 *
 * In-season it uses the granular attack/defence splits; pre-season (when FPL
 * zeroes those) it falls back to overall strength and labels the read as such.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
// Normalise to 0..1 across the league; flat 0.5 when every team is equal.
const norm = (v, lo, hi) => (hi > lo ? (v - lo) / (hi - lo) : 0.5)
const pZero = (lambda) => Math.exp(-lambda) // Poisson probability of zero goals

// Typical Premier League scoring baselines (goals per team per game).
const BASE_HOME = 1.5
const BASE_AWAY = 1.2

function ratingsFor(teams, hasGranular) {
  return teams.map((team) => ({
    id: team.id,
    attack: hasGranular
      ? mean([toNumber(team.strength_attack_home, 0), toNumber(team.strength_attack_away, 0)])
      : mean([toNumber(team.strength_overall_home, 0), toNumber(team.strength_overall_away, 0)]),
    defence: hasGranular
      ? mean([toNumber(team.strength_defence_home, 0), toNumber(team.strength_defence_away, 0)])
      : mean([toNumber(team.strength_overall_home, 0), toNumber(team.strength_overall_away, 0)]),
  }))
}

function sideOf(team, xg, cleanSheetPct, score, started) {
  return {
    id: team?.id ?? null,
    name: team?.name ?? 'To be confirmed',
    shortName: team?.short_name ?? 'TBC',
    crest: team?.code ? teamCrestUrl(team.code) : null,
    xg: Number(xg.toFixed(2)),
    cleanSheetPct,
    score: started ? toNumber(score, null) : null,
  }
}

export async function getMatchOdds({ fpl }) {
  const [bootstrap, fixtures] = await Promise.all([fpl.getBootstrap(), fpl.getFixtures()])
  const teams = bootstrap.teams ?? []
  if (teams.length === 0) throw new HttpError('No team data is available yet.', 503)

  const teamsById = indexBy(teams, 'id')
  const events = bootstrap.events ?? []
  const event = events.find((e) => e.is_current)
    ?? events.find((e) => e.is_next)
    ?? [...events].reverse().find((e) => e.finished)
    ?? events[0]
    ?? null
  const hasGranular = teams.some((t) => toNumber(t.strength_attack_home, 0) > 0)

  const raw = ratingsFor(teams, hasGranular)
  const atkLo = Math.min(...raw.map((r) => r.attack)); const atkHi = Math.max(...raw.map((r) => r.attack))
  const defLo = Math.min(...raw.map((r) => r.defence)); const defHi = Math.max(...raw.map((r) => r.defence))
  const byId = new Map(raw.map((r) => [r.id, {
    attack: norm(r.attack, atkLo, atkHi), // 0 weakest … 1 strongest attack
    defence: norm(r.defence, defLo, defHi), // 0 weakest … 1 strongest defence
  }]))

  const xgFor = (attackerId, defenderId, base) => {
    const a = byId.get(attackerId); const d = byId.get(defenderId)
    const attackFactor = 0.65 + a.attack * 0.8 // 0.65 … 1.45
    const defenceWeakness = 1.4 - d.defence * 0.9 // 1.4 (leaky) … 0.5 (miserly)
    return clamp(base * attackFactor * defenceWeakness, 0.2, 4)
  }

  const matches = (fixtures ?? [])
    .filter((fixture) => fixture.event === event?.id)
    .sort((left, right) => String(left.kickoff_time ?? '').localeCompare(String(right.kickoff_time ?? '')))
    .map((fixture) => {
      const home = teamsById.get(fixture.team_h)
      const away = teamsById.get(fixture.team_a)
      const xgHome = xgFor(fixture.team_h, fixture.team_a, BASE_HOME)
      const xgAway = xgFor(fixture.team_a, fixture.team_h, BASE_AWAY)
      const started = Boolean(fixture.started || fixture.finished || fixture.finished_provisional)
      return {
        id: `fpl:${fixture.id}`,
        kickoff: toIso(fixture.kickoff_time),
        started,
        finished: Boolean(fixture.finished || fixture.finished_provisional),
        home: sideOf(home, xgHome, Math.round(pZero(xgAway) * 100), fixture.team_h_score, started),
        away: sideOf(away, xgAway, Math.round(pZero(xgHome) * 100), fixture.team_a_score, started),
        totalXg: Number((xgHome + xgAway).toFixed(2)),
        bttsPct: Math.round((1 - pZero(xgHome)) * (1 - pZero(xgAway)) * 100),
      }
    })

  return {
    gameweek: event?.id ?? null,
    gameweekName: event?.name ?? null,
    dataDepth: hasGranular ? 'in-season' : 'pre-season',
    generatedAt: new Date().toISOString(),
    matches,
  }
}
