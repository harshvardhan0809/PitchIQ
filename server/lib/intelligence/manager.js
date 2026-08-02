import { HttpError } from '../http.js'
import { indexBy, teamCrestUrl } from '../providers/fpl.js'
import { toIso, toNumber } from '../format.js'

/**
 * Manager's Mindset.
 *
 * The FPL API doesn't name head coaches or publish anything about their
 * psychology, so nothing here invents claims about a specific person. Instead it
 * reads the one thing that genuinely reflects a manager's mind — how the team is
 * actually set up to play — and translates it into a mentality archetype and how
 * that mindset tilts the next match.
 *
 * Signals used (whatever is available): FPL's attack/defence/overall strength
 * ratings, and once games are played, goals for/against, clean sheets, form and
 * how volatile the scorelines are. Everything is an honest read of on-pitch
 * behaviour, labelled as such.
 */

// Data-assigned archetypes. The descriptions are general tactical truths, chosen
// by what the numbers say — never a fabricated profile of a named manager.
const ARCHETYPES = {
  controller: {
    key: 'controller',
    label: 'Complete Controller',
    tagline: 'Dominates both boxes — dictates the game on its terms.',
    mentality: 'Set up to control every phase: strong going forward and hard to break down. This is a front-foot mentality that still values a clean sheet — the team expects to win, not to survive.',
    effect: 'Tends to win the expected-goals battle comfortably. Good for attackers and defenders alike; the main risk is complacency against a low block.',
  },
  aggressor: {
    key: 'aggressor',
    label: 'Front-Foot Aggressor',
    tagline: 'Attack first, worry later — chases goals and takes risks.',
    mentality: 'A win-at-all-costs, attack-heavy mindset: numbers forward, high line, and a willingness to trade chances. The manager backs the team to outscore anyone rather than shut the game down.',
    effect: 'High-scoring, high-variance games. Captaincy heaven for its forwards, but clean sheets are unreliable — its own defenders are exposed on the counter.',
  },
  organiser: {
    key: 'organiser',
    label: 'Pragmatic Organiser',
    tagline: 'Control the risk — solid shape, take what the game gives.',
    mentality: 'A risk-averse, defence-first mind: a compact block, patience, and clean sheets over spectacle. The team is happy to keep it tight and win the moments rather than the possession count.',
    effect: 'Low-scoring, cagey matches. Clean-sheet points and set-piece threats matter more than open-play goals; its attackers can go quiet for spells.',
  },
  survivor: {
    key: 'survivor',
    label: 'Scrappy Survivor',
    tagline: 'Backs-to-the-wall — grit over gameplan, every point fought for.',
    mentality: 'A survival mentality forced by limited resources: reactive, deep, and desperate. The plan is to frustrate, nick something, and dig in — emotion and effort over control.',
    effect: 'Unpredictable and streaky. Capable of a shock result or a heavy defeat; hard to trust for either a clean sheet or a big attacking return.',
  },
  balanced: {
    key: 'balanced',
    label: 'Balanced Operator',
    tagline: 'No extremes — adapts the plan to the opponent.',
    mentality: 'A pragmatic, adaptable mind with no fixed dogma: attack when it can, defend when it must. The approach flexes by opponent and game-state rather than imposing one identity.',
    effect: 'Middling variance. The match character depends heavily on the opponent — read the fixture, not just the badge.',
  },
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const norm = (v, lo, hi) => (hi > lo ? Math.round(((v - lo) / (hi - lo)) * 100) : 50)
const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)

/** Raw attack/defence signal per team, granular in-season, overall pre-season. */
function rawStrengths(teams, hasGranular) {
  return teams.map((team) => {
    const attack = hasGranular
      ? mean([toNumber(team.strength_attack_home, 0), toNumber(team.strength_attack_away, 0)])
      : mean([toNumber(team.strength_overall_home, 0), toNumber(team.strength_overall_away, 0)])
    const defence = hasGranular
      ? mean([toNumber(team.strength_defence_home, 0), toNumber(team.strength_defence_away, 0)])
      : mean([toNumber(team.strength_overall_home, 0), toNumber(team.strength_overall_away, 0)])
    return { id: team.id, attack, defence }
  })
}

/** Per-team results pulled from finished fixtures (empty pre-season). */
function seasonForm(teamId, fixtures, teamsById) {
  const played = (fixtures ?? []).filter((f) => (f.finished || f.finished_provisional)
    && (f.team_h === teamId || f.team_a === teamId)
    && f.team_h_score != null && f.team_a_score != null)

  let gf = 0; let ga = 0; let cs = 0; const margins = []; const results = []
  for (const f of played) {
    const home = f.team_h === teamId
    const own = home ? f.team_h_score : f.team_a_score
    const opp = home ? f.team_a_score : f.team_h_score
    gf += own; ga += opp; if (opp === 0) cs += 1
    margins.push(own - opp)
    results.push(own > opp ? 'W' : own < opp ? 'L' : 'D')
  }
  const n = played.length
  const avgMargin = mean(margins)
  const variance = n ? mean(margins.map((m) => (m - avgMargin) ** 2)) : 0
  return {
    played: n,
    goalsFor: gf,
    goalsAgainst: ga,
    cleanSheets: cs,
    gfPerGame: n ? gf / n : 0,
    gaPerGame: n ? ga / n : 0,
    csRate: n ? cs / n : 0,
    volatility: Math.sqrt(variance), // spread of scoreline margins
    recent: results.slice(-5),
    teamsById,
  }
}

function archetypeFor(attack, defence) {
  if (attack >= 62 && defence >= 62) return ARCHETYPES.controller
  if (attack - defence >= 14) return ARCHETYPES.aggressor
  if (defence - attack >= 14) return ARCHETYPES.organiser
  if (attack <= 40 && defence <= 40) return ARCHETYPES.survivor
  return ARCHETYPES.balanced
}

function homeLeanTrait(team) {
  const diff = toNumber(team.strength_overall_home, 0) - toNumber(team.strength_overall_away, 0)
  if (diff >= 1) return { label: 'Home fortress', value: 'Stronger at home', tone: 'good', score: clamp(50 + diff * 22, 0, 100) }
  if (diff <= -1) return { label: 'Road warriors', value: 'Travels well', tone: 'good', score: clamp(50 + diff * 22, 0, 100) }
  return { label: 'Even home & away', value: 'No strong split', tone: 'neutral', score: 50 }
}

function temperamentTrait(form) {
  if (form.played < 3) return { label: 'Temperament', value: 'Too early to read', tone: 'neutral', note: 'Needs a few results to judge.' }
  if (form.volatility >= 1.6) return { label: 'Volatile', value: 'Emotional swings', tone: 'bad', note: 'Big wins and heavy defeats — streaky.' }
  if (form.volatility <= 0.9) return { label: 'Composed', value: 'Consistent margins', tone: 'good', note: 'Rarely blown out; steady.' }
  return { label: 'Measured', value: 'Occasional swings', tone: 'neutral', note: 'Mostly controlled results.' }
}

function momentumTrait(team, form) {
  const f = toNumber(team.form, 0)
  if (form.played === 0) return { label: 'Momentum', value: 'Clean slate', tone: 'neutral', note: 'New season — no form yet.' }
  if (f >= 2) return { label: 'Momentum', value: 'On a high', tone: 'good', note: `Form ${team.form}.` }
  if (f <= 1) return { label: 'Momentum', value: 'Struggling', tone: 'bad', note: `Form ${team.form}.` }
  return { label: 'Momentum', value: 'Ticking over', tone: 'neutral', note: `Form ${team.form}.` }
}

/** The team's next fixture and how the mindset shapes it. */
function nextMatchInfluence(team, ratingById, fixtures, teamsById, events) {
  const nextEvent = events.find((e) => e.is_current) ?? events.find((e) => e.is_next)
  const fixture = (fixtures ?? [])
    .filter((f) => !f.finished && (f.team_h === team.id || f.team_a === team.id))
    .sort((a, b) => String(a.kickoff_time ?? '').localeCompare(String(b.kickoff_time ?? '')))[0]

  if (!fixture) return { available: false, note: 'No upcoming fixture is scheduled yet.' }

  const home = fixture.team_h === team.id
  const opp = teamsById.get(home ? fixture.team_a : fixture.team_h)
  const me = ratingById.get(team.id)
  const them = ratingById.get(opp?.id)

  // Rough tilt: my attack vs their defence, their attack vs my defence, + home edge.
  const homeEdge = home ? 8 : -6
  const attackEdge = (me.attack - them.defence) + homeEdge

  const openness = (me.attack + them.attack) / 2
  const solidity = (me.defence + them.defence) / 2
  const character = openness - solidity >= 10 ? 'open' : solidity - openness >= 10 ? 'cagey' : 'balanced'

  const myArch = archetypeFor(me.attack, me.defence)
  const theirArch = archetypeFor(them.attack, them.defence)

  let lean
  if (attackEdge >= 18) lean = `Leans to a ${home ? 'home' : 'strong away'} win — the attack should overpower ${opp?.short_name ?? 'them'}.`
  else if (attackEdge <= -12) lean = `The tougher side of the tie — ${opp?.short_name ?? 'the opponent'} holds the edge here.`
  else lean = 'A close call — small margins and game-state will decide it.'

  const cleanSheetPct = clamp(Math.round(50 + (me.defence - them.attack) * 0.5 + homeEdge), 8, 88)

  return {
    available: true,
    opponent: opp?.name ?? 'To be confirmed',
    opponentShort: opp?.short_name ?? 'TBC',
    opponentArchetype: theirArch.label,
    home,
    kickoff: toIso(fixture.kickoff_time),
    matchday: fixture.event ?? nextEvent?.id ?? null,
    character,
    lean,
    edge: `${myArch.label} vs ${theirArch.label}: ${character === 'open'
      ? 'both want to attack — expect an open, high-tempo game.'
      : character === 'cagey'
        ? 'two cautious set-ups — likely a tight, low-scoring affair.'
        : 'contrasting plans — whoever imposes their mindset wins the tie.'}`,
    cleanSheetPct,
  }
}

export async function getManagerAnalysis({ fpl, teamId = null, defaultTeamShort = 'MUN' }) {
  const [bootstrap, fixtures] = await Promise.all([fpl.getBootstrap(), fpl.getFixtures()])
  const teams = bootstrap.teams ?? []
  if (teams.length === 0) throw new HttpError('No team data is available yet.', 503)

  const teamsById = indexBy(teams, 'id')
  const events = bootstrap.events ?? []
  const phase = events.some((e) => e.finished) ? 'active' : 'pre'
  const hasGranular = teams.some((t) => toNumber(t.strength_attack_home, 0) > 0)

  // Normalise attack/defence across the league so ratings are relative.
  const raw = rawStrengths(teams, hasGranular)
  const atkLo = Math.min(...raw.map((r) => r.attack)); const atkHi = Math.max(...raw.map((r) => r.attack))
  const defLo = Math.min(...raw.map((r) => r.defence)); const defHi = Math.max(...raw.map((r) => r.defence))
  const ratingById = new Map(raw.map((r) => [r.id, { attack: norm(r.attack, atkLo, atkHi), defence: norm(r.defence, defLo, defHi) }]))

  // No team chosen → open on the configured default club (Man Utd by default);
  // fall back to the strongest side if that short name isn't in the league.
  const strongest = () => [...teams].sort((a, b) => {
    const ra = ratingById.get(a.id); const rb = ratingById.get(b.id)
    return (rb.attack + rb.defence) - (ra.attack + ra.defence)
  })[0]
  const byShort = defaultTeamShort
    ? teams.find((t) => String(t.short_name).toUpperCase() === defaultTeamShort.toUpperCase())
    : null
  const chosen = (teamId && teamsById.get(teamId))
    ? teamsById.get(teamId)
    : (byShort ?? strongest())

  const rating = ratingById.get(chosen.id)
  const form = seasonForm(chosen.id, fixtures, teamsById)

  // Enrich attack/defence with in-season goal output when we have it.
  let attack = rating.attack
  let defence = rating.defence
  if (form.played >= 3) {
    attack = Math.round(clamp(attack * 0.6 + norm(form.gfPerGame, 0.4, 2.6) * 0.4, 0, 100))
    defence = Math.round(clamp(defence * 0.6 + norm(2.2 - form.gaPerGame, 0, 2.2) * 0.4, 0, 100))
  }

  const archetype = archetypeFor(attack, defence)

  const traits = [
    { label: 'Attacking intent', value: `${attack}/100`, score: attack, tone: attack >= 60 ? 'good' : attack <= 40 ? 'bad' : 'neutral', note: 'How much the team commits to scoring.' },
    { label: 'Defensive setup', value: `${defence}/100`, score: defence, tone: defence >= 60 ? 'good' : defence <= 40 ? 'bad' : 'neutral', note: 'How much it prioritises keeping it tight.' },
    { ...homeLeanTrait(chosen) },
    temperamentTrait(form),
    momentumTrait(chosen, form),
  ]

  const nextMatch = nextMatchInfluence(chosen, ratingById, fixtures, teamsById, events)

  return {
    gameweek: (events.find((e) => e.is_current) ?? events.find((e) => e.is_next))?.id ?? null,
    gameweekName: (events.find((e) => e.is_current) ?? events.find((e) => e.is_next))?.name ?? null,
    phase,
    generatedAt: new Date().toISOString(),
    dataDepth: form.played >= 3 ? 'in-season' : 'pre-season',
    teams: teams.map((t) => ({ id: t.id, name: t.name, shortName: t.short_name })).sort((a, b) => a.name.localeCompare(b.name)),
    team: {
      id: chosen.id,
      name: chosen.name,
      shortName: chosen.short_name,
      crest: chosen.code ? teamCrestUrl(chosen.code) : null,
    },
    profile: {
      archetype: { key: archetype.key, label: archetype.label, tagline: archetype.tagline },
      mentality: archetype.mentality,
      effect: archetype.effect,
      ratings: { attack, defence },
      traits,
      record: form.played > 0
        ? { played: form.played, goalsFor: form.goalsFor, goalsAgainst: form.goalsAgainst, cleanSheets: form.cleanSheets, recent: form.recent }
        : null,
    },
    nextMatch,
  }
}
