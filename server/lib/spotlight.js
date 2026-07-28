import { indexBy, teamCrestUrl } from './providers/fpl.js'
import { initials, toIso, toNumber } from './format.js'
import { buildProjections } from './intelligence/projections.js'

/**
 * The front page ("Matchday"), built entirely from the Fantasy Premier League
 * API — the same source as the rest of the app. FPL publishes the fixtures,
 * scores, teams and players for the Premier League, so nothing here depends on
 * any other provider: one bootstrap + fixtures fetch (both cached) covers it.
 *
 * The round shown is whatever is current, else the next one due, else the last
 * one played. "Players to watch" are the top projected performers for that
 * gameweek, straight from the projection engine.
 */

const AVAILABILITY_CODE = { a: 'available', d: 'doubtful', i: 'injured', s: 'suspended', u: 'unavailable', n: 'unavailable' }

function fixtureState(fixture) {
  if (fixture.started && !fixture.finished && !fixture.finished_provisional) return 'live'
  if (fixture.finished || fixture.finished_provisional) return 'finished'
  return 'scheduled'
}

function teamSide(team, score, state) {
  return {
    id: team?.id ?? null,
    name: team?.name ?? 'To be confirmed',
    shortName: team?.short_name ?? team?.name ?? 'TBC',
    crest: team?.code ? teamCrestUrl(team.code) : null,
    score: state === 'scheduled' ? null : toNumber(score, null),
  }
}

function toMatch(fixture, teamsById) {
  const state = fixtureState(fixture)
  return {
    id: `fpl:${fixture.id}`,
    utcDate: toIso(fixture.kickoff_time),
    status: state.toUpperCase(),
    state,
    matchday: fixture.event ?? null,
    homeTeam: teamSide(teamsById.get(fixture.team_h), fixture.team_h_score, state),
    awayTeam: teamSide(teamsById.get(fixture.team_a), fixture.team_a_score, state),
  }
}

/** The gameweek to lead with: in progress, else next due, else last finished. */
function focusEvent(events) {
  return events.find((event) => event.is_current)
    ?? events.find((event) => event.is_next)
    ?? [...events].reverse().find((event) => event.finished)
    ?? events[0]
    ?? null
}

function toWatchItem(player, teamsById) {
  const team = teamsById.get(player.teamId)
  const status = player.availability?.status ?? 'a'
  const fixture = player.next
    ? `${player.next.home ? 'vs' : '@'} ${player.next.opponent}`
    : '—'
  return {
    id: player.id,
    // Selecting opens the full FPL player report.
    searchId: player.id,
    name: player.name,
    initials: initials(player.name),
    photoUrl: player.photoUrl,
    team: player.team,
    teamShort: player.teamShort,
    teamCrestUrl: team?.code ? teamCrestUrl(team.code) : null,
    position: player.position,
    availability: {
      code: AVAILABILITY_CODE[status] ?? 'available',
      label: player.availability?.label ?? 'Available',
      note: player.availability?.news ?? null,
    },
    stats: [
      { label: 'xPts', value: player.expectedPoints },
      { label: 'Fixture', value: fixture },
      { label: 'Owned', value: `${Number(player.ownership ?? 0).toFixed(0)}%` },
    ],
  }
}

export async function getSpotlight({ fpl }) {
  const [bootstrap, fixtures, projection] = await Promise.all([
    fpl.getBootstrap(),
    fpl.getFixtures(),
    buildProjections({ fpl }),
  ])

  const teamsById = indexBy(bootstrap.teams, 'id')
  const events = bootstrap.events ?? []
  const event = focusEvent(events)

  const items = (fixtures ?? [])
    .filter((fixture) => fixture.event === event?.id)
    .sort((left, right) => String(left.kickoff_time ?? '').localeCompare(String(right.kickoff_time ?? '')))
    .map((fixture) => toMatch(fixture, teamsById))

  const anyLive = items.some((match) => match.state === 'live')
  const allFinished = items.length > 0 && items.every((match) => match.state === 'finished')
  const state = anyLive ? 'live' : allFinished ? 'recent' : 'upcoming'
  const note = anyLive
    ? 'Matches in progress.'
    : allFinished ? 'Most recent completed round.' : 'The next round of fixtures.'
  const firstKickoff = items.map((match) => match.utcDate).filter(Boolean).sort()[0]
    ?? toIso(event?.deadline_time)

  const watch = projection.players
    .filter((player) => player.playProb >= 0.5 && player.next)
    .sort((left, right) => right.expectedPoints - left.expectedPoints)
    .slice(0, 8)
    .map((player) => toWatchItem(player, teamsById))

  return {
    competition: {
      code: 'PL',
      name: 'Premier League',
      country: 'England',
      seasonLabel: event?.name ?? 'Premier League',
      currentMatchday: event?.id ?? null,
      supportsFpl: true,
    },
    matches: {
      state,
      heading: event?.name ?? 'Fixtures',
      note,
      firstKickoff,
      matchday: event?.id ?? null,
      isPreviousSeason: false,
      items,
    },
    playersToWatch: {
      heading: 'Players to watch',
      subheading: event ? `Top projected performers for ${event.name}` : 'Top projected performers',
      items: watch,
    },
  }
}
