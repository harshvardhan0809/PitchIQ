import { indexBy } from './providers/fpl.js'
import { toNumber } from './format.js'

/**
 * Live match center data, straight from the FPL fixtures feed.
 *
 * FPL doesn't timestamp events, so this is not a play-by-play — it's the live
 * state of each in-play or just-finished match: the score, the match minute, and
 * the returns that have landed (goals, assists, cards, bonus), each tied to a
 * real player. The client polls this on a short interval while matches are live
 * and animates in whatever is new since the last poll.
 */

// FPL element_type → outfield role, used to place a scorer on the pitch zone.
const POSITION = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }

// fixture.stats identifiers we surface, in the order they should read in a feed.
const EVENT_TYPES = [
  { id: 'goals_scored', type: 'goal' },
  { id: 'own_goals', type: 'own_goal' },
  { id: 'assists', type: 'assist' },
  { id: 'penalties_saved', type: 'pen_saved' },
  { id: 'penalties_missed', type: 'pen_missed' },
  { id: 'red_cards', type: 'red' },
  { id: 'yellow_cards', type: 'yellow' },
  { id: 'bonus', type: 'bonus' },
]

function eventsFrom(fixture, elementsById, teamsById) {
  const byId = new Map((fixture.stats ?? []).map((stat) => [stat.identifier, stat]))
  const out = []
  for (const { id, type } of EVENT_TYPES) {
    const stat = byId.get(id)
    if (!stat) continue
    for (const side of ['h', 'a']) {
      for (const item of stat[side] ?? []) {
        const player = elementsById.get(item.element)
        if (!player) continue
        const team = teamsById.get(side === 'h' ? fixture.team_h : fixture.team_a)
        out.push({
          // Stable id so the client can tell an existing event from a new one.
          key: `${fixture.id}:${type}:${item.element}:${item.value}`,
          type,
          side: side === 'h' ? 'home' : 'away',
          playerId: item.element,
          name: player.web_name,
          position: POSITION[player.element_type] ?? 'MID',
          teamShort: team?.short_name ?? '',
          count: toNumber(item.value, 1),
        })
      }
    }
  }
  return out
}

export async function getLive({ fpl }) {
  const bootstrap = await fpl.getBootstrap()
  const events = bootstrap.events ?? []
  const event = events.find((e) => e.is_current)
    ?? events.find((e) => e.is_next)
    ?? null
  const teamsById = indexBy(bootstrap.teams ?? [], 'id')
  const elementsById = indexBy(bootstrap.elements ?? [], 'id')

  const fixtures = event ? await fpl.getLiveFixtures(event.id) : []

  const matches = (fixtures ?? [])
    .filter((fixture) => Boolean(fixture.started || fixture.finished || fixture.finished_provisional))
    .map((fixture) => {
      const finished = Boolean(fixture.finished || fixture.finished_provisional)
      return {
        id: `fpl:${fixture.id}`,
        started: Boolean(fixture.started),
        live: Boolean(fixture.started) && !finished,
        finished,
        minute: toNumber(fixture.minutes, 0),
        homeScore: toNumber(fixture.team_h_score, 0),
        awayScore: toNumber(fixture.team_a_score, 0),
        events: eventsFrom(fixture, elementsById, teamsById),
      }
    })

  return {
    generatedAt: new Date().toISOString(),
    event: event?.id ?? null,
    gameweekName: event?.name ?? null,
    anyLive: matches.some((match) => match.live),
    matches,
  }
}
