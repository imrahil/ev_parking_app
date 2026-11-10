// What the board shows, worked out from the station list, the live views and
// the user's filter choices. Pure, so it is tested without rendering.
import { stateToStatus } from './api'
import { STATUS } from './consts/consts'
import type { StationRef, StationView } from './types'

export type GroupStats = { free: number; busy: number; total: number }

export type BoardSummary = {
  /** Every group in the station list, sorted — one filter chip each. */
  groups: string[]
  /** The cards to draw: in the active group if there is one, and free if `freeOnly` is on. */
  stations: StationView[]
  /** Per group, for its chip. */
  stats: Record<string, GroupStats>
  /** Over every station, for the "All" chip. */
  all: GroupStats
  /** Over `stations`, for the header. */
  counts: GroupStats
}

const NONE: GroupStats = { free: 0, busy: 0, total: 0 }

/**
 * `activeGroup` '' means All; ungrouped stations show only under All. A
 * station in `refs` with no view yet is left out. `freeOnly` narrows the cards
 * only: the chips and header still count every station, so they keep saying
 * how busy the place is.
 */
export function summariseBoard(
  refs: StationRef[],
  views: Record<string, StationView>,
  activeGroup: string,
  freeOnly = false,
): BoardSummary {
  const groups = Array.from(new Set(refs.map((r) => r.group).filter((g): g is string => Boolean(g)))).sort()
  const visible = refs.map((r) => views[r.id]).filter(Boolean)

  // One pass over the stations feeds both the chips and the header
  const stats: Record<string, GroupStats> = {}
  for (const g of groups) stats[g] = { ...NONE }
  const all: GroupStats = { ...NONE }
  for (const v of visible) {
    const status = stateToStatus(v.data?.State)
    const group = v.ref.group ? stats[v.ref.group] : undefined
    for (const bucket of group ? [all, group] : [all]) {
      bucket.total++
      if (status === STATUS.AVAILABLE) bucket.free++
      else if (status === STATUS.OCCUPIED) bucket.busy++
    }
  }

  const inGroup = activeGroup ? visible.filter((v) => v.ref.group === activeGroup) : visible

  return {
    groups,
    stations: freeOnly ? inGroup.filter((v) => stateToStatus(v.data?.State) === STATUS.AVAILABLE) : inGroup,
    stats,
    all,
    // A stored filter naming a group that no longer exists matches no station
    counts: activeGroup ? (stats[activeGroup] ?? NONE) : all,
  }
}
