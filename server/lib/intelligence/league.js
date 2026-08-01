import { HttpError } from '../http.js'
import { indexBy } from '../providers/fpl.js'

/**
 * Mini-League War Room — the competitive, social view.
 *
 * Given a classic league ID, it answers the questions you actually ask about
 * your mini-league: where do I stand, exactly how many points behind the person
 * above me, what is everyone captaining, what's the league "template", and which
 * of my players are true differentials against my rivals.
 *
 * Cost control: the standings table is a single cheap request (top 50). The
 * deep analysis — captains, template, differentials — needs each rival's picks,
 * so it is bounded to the top DEEP_LIMIT managers and only runs for Pro callers.
 */

// How many top managers to pull picks for when building captain/template intel.
const DEEP_LIMIT = 12
// A player owned by this share or less of the analysed set counts as your differential.
const DIFF_THRESHOLD = 0.25

/** The event whose picks we can read: in progress, else the last finished. */
function picksEvent(events) {
  return events.find((event) => event.is_current)
    ?? [...events].reverse().find((event) => event.finished)
    ?? null
}

function movementOf(rank, lastRank) {
  if (!lastRank || lastRank === 0) return 'same'
  if (rank < lastRank) return 'up'
  if (rank > lastRank) return 'down'
  return 'same'
}

function toStandingRow(result, entryId) {
  return {
    rank: result.rank ?? null,
    lastRank: result.last_rank ?? null,
    movement: movementOf(result.rank, result.last_rank),
    entryId: result.entry,
    teamName: result.entry_name ?? 'Team',
    managerName: result.player_name ?? 'Manager',
    total: result.total ?? 0,
    eventTotal: result.event_total ?? 0,
    isYou: entryId != null && result.entry === entryId,
    captain: null, // filled in for the deep set (Pro)
  }
}

function elementLabel(element, teamsById, typesById) {
  const team = teamsById.get(element?.team)
  return {
    // `fpl:{id}` so the UI can open the player's report from a captain/template chip.
    id: element?.id ? `fpl:${element.id}` : null,
    webName: element?.web_name ?? 'Unknown',
    teamShort: team?.short_name ?? '—',
    position: typesById.get(element?.element_type)?.singular_name_short ?? 'MID',
  }
}

export async function getLeagueWarRoom({ fpl, leagueId, entryId = null, deep = false }) {
  const [bootstrap, standingsData] = await Promise.all([
    fpl.getBootstrap(),
    fpl.getLeagueStandings(leagueId).catch((error) => {
      if (error instanceof HttpError && error.status === 404) {
        throw new HttpError('No league with that ID. Check the number in the league’s URL.', 404)
      }
      throw error
    }),
  ])

  const teamsById = indexBy(bootstrap.teams, 'id')
  const typesById = indexBy(bootstrap.element_types, 'id')
  const elementsById = indexBy(bootstrap.elements, 'id')
  const events = bootstrap.events ?? []
  const focus = picksEvent(events)
  const phase = events.some((event) => event.finished) ? 'active' : 'pre'

  const leagueInfo = standingsData.league ?? {}
  const results = standingsData.standings?.results ?? []
  const standings = results.map((result) => toStandingRow(result, entryId))

  // You: rank, the exact gap to the manager directly above, and to the leader.
  const yourRow = standings.find((row) => row.isYou) ?? null
  let you = null
  if (yourRow) {
    const above = standings.find((row) => row.rank === yourRow.rank - 1) ?? null
    const leader = standings.find((row) => row.rank === 1) ?? null
    you = {
      rank: yourRow.rank,
      total: yourRow.total,
      eventTotal: yourRow.eventTotal,
      teamName: yourRow.teamName,
      toOvertake: above ? { points: (above.total - yourRow.total) + 1, targetName: above.teamName } : null,
      leaderGap: leader ? leader.total - yourRow.total : 0,
    }
  }

  const base = {
    gameweek: focus?.id ?? null,
    gameweekName: focus?.name ?? null,
    deadline: focus?.deadline_time ?? null,
    phase,
    generatedAt: new Date().toISOString(),
    league: { id: leagueInfo.id ?? leagueId, name: leagueInfo.name ?? 'Mini-league', size: results.length, hasNext: Boolean(standingsData.standings?.has_next) },
    event: focus ? { id: focus.id, name: focus.name, finished: Boolean(focus.finished) } : null,
    standings,
    you,
    captains: [],
    template: [],
    yourDifferentials: [],
    deepCount: 0,
  }

  // The deep intel (Pro) needs each rival's picks — only run it when asked and
  // only when there is a played gameweek to read picks from.
  if (!deep || !focus) return base

  const targets = standings.slice(0, DEEP_LIMIT)
  if (yourRow && !targets.some((row) => row.entryId === yourRow.entryId)) targets.push(yourRow)

  const picksByEntry = new Map()
  await Promise.all(targets.map(async (row) => {
    try {
      const data = await fpl.getEntryPicks(row.entryId, focus.id)
      picksByEntry.set(row.entryId, data.picks ?? [])
    } catch { /* skip a manager whose picks can't be read */ }
  }))

  const deepCount = picksByEntry.size
  if (deepCount === 0) return base

  // Attach each analysed manager's captain to their standings row.
  const captainTally = new Map()
  const ownershipTally = new Map()
  for (const [entry, picks] of picksByEntry) {
    for (const pick of picks) {
      ownershipTally.set(pick.element, (ownershipTally.get(pick.element) ?? 0) + 1)
      if (pick.is_captain) {
        captainTally.set(pick.element, (captainTally.get(pick.element) ?? 0) + 1)
        const row = standings.find((r) => r.entryId === entry)
        if (row) row.captain = elementLabel(elementsById.get(pick.element), teamsById, typesById)
      }
    }
  }

  const rankTally = (tally, limit) => [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([elementId, count]) => ({
      ...elementLabel(elementsById.get(elementId), teamsById, typesById),
      count,
      pct: Math.round((count / deepCount) * 100),
    }))

  const captains = rankTally(captainTally, 8)
  const template = rankTally(ownershipTally, 12)

  // Your differentials: players you own that few of your rivals do.
  let yourDifferentials = []
  const yourPicks = yourRow ? picksByEntry.get(yourRow.entryId) : null
  if (yourPicks) {
    yourDifferentials = yourPicks
      .filter((pick) => (ownershipTally.get(pick.element) ?? 0) <= Math.max(1, Math.floor(deepCount * DIFF_THRESHOLD)))
      .map((pick) => ({
        ...elementLabel(elementsById.get(pick.element), teamsById, typesById),
        owners: ownershipTally.get(pick.element) ?? 1,
      }))
      .sort((a, b) => a.owners - b.owners)
      .slice(0, 6)
  }

  return { ...base, captains, template, yourDifferentials, deepCount }
}
