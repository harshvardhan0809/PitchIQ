import { toNumber } from '../format.js'

/**
 * Fixture difficulty ratings from the FPL feed are 1 (easiest) to 5 (hardest).
 * These translate that scale into the two multipliers the projection model
 * actually needs: how much a fixture lifts or dampens attacking output, and the
 * baseline chance of a clean sheet for the team defending it.
 *
 * Keeping this in one place means the transfer, differential and fixture-swing
 * views (later slices) all read difficulty the same way as the captain model.
 */
const ATTACK_MULTIPLIER = { 1: 1.25, 2: 1.12, 3: 1.0, 4: 0.88, 5: 0.76 }
const CLEAN_SHEET_BASE = { 1: 0.55, 2: 0.45, 3: 0.33, 4: 0.22, 5: 0.13 }

export function attackMultiplier(difficulty) {
  return ATTACK_MULTIPLIER[difficulty] ?? 1.0
}

export function cleanSheetProbability(difficulty, isHome) {
  const base = CLEAN_SHEET_BASE[difficulty] ?? 0.3
  return Math.min(0.7, base + (isHome ? 0.05 : 0))
}

/** Upcoming fixtures for one FPL team, in chronological order. */
export function teamFixtures(teamId, fixtures, teamsById, count = 5) {
  return (fixtures ?? [])
    .filter((fixture) => !fixture.finished && (fixture.team_h === teamId || fixture.team_a === teamId))
    .filter((fixture) => fixture.event != null)
    .sort((left, right) => (
      (left.event - right.event)
      || (new Date(left.kickoff_time) - new Date(right.kickoff_time))
    ))
    .slice(0, count)
    .map((fixture) => {
      const home = fixture.team_h === teamId
      const opponent = teamsById.get(home ? fixture.team_a : fixture.team_h)
      return {
        event: fixture.event,
        kickoff: fixture.kickoff_time ?? null,
        home,
        opponent: opponent?.short_name ?? '—',
        opponentName: opponent?.name ?? 'Unknown',
        difficulty: toNumber(home ? fixture.team_h_difficulty : fixture.team_a_difficulty, 3),
      }
    })
}

/**
 * A 0-100 score for a run of fixtures where higher means an easier schedule.
 * Used to rank fixture swings and to weight medium-term transfer value.
 */
export function fixtureRunScore(fixtures) {
  if (fixtures.length === 0) return null
  const average = fixtures.reduce((total, fixture) => total + fixture.difficulty, 0) / fixtures.length
  return Math.round(((5 - average) / 4) * 100)
}
