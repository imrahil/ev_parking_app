// What the board shows, worked out from the station list, the live views and
// the user's group choices. Pure, so it is tested without rendering.
import { stateToStatus } from './api'
import { STATUS } from './consts/consts'
import type { StationRef, StationView } from './types'

export type GroupStats = { free: number; busy: number; total: number }

export type BoardSummary = {
  /** Every group in the station list, sorted — what Settings offers to hide. */
  groups: string[]
  /** The groups that are not hidden — one filter chip each. */
  visibleGroups: string[]
  /**
   * The cards to draw: not hidden, in the active group if there is one, and
   * free if `freeOnly` is on.
   */
  stations: StationView[]
  /** Per visible group, for its chip. */
  stats: Record<string, GroupStats>
  /** Over every visible station, for the "All" chip. */
  all: GroupStats
  /** Over `stations`, for the header. */
  counts: GroupStats
}

const NONE: GroupStats = { free: 0, busy: 0, total: 0 }

/**
 * `activeGroup` '' means All. Ungrouped stations are always visible; hiding
 * applies per group. A station in `refs` with no view yet is left out.
 * `freeOnly` narrows the cards only: the chips and header still count every
 * visible station, so they keep saying how busy the place is.
 */
export function summariseBoard(
  refs: StationRef[],
  views: Record<string, StationView>,
  hiddenGroups: string[],
  activeGroup: string,
  freeOnly = false,
): BoardSummary {
  const groups = Array.from(new Set(refs.map((r) => r.group).filter((g): g is string => Boolean(g)))).sort()
  const visibleGroups = groups.filter((g) => !hiddenGroups.includes(g))

  const visible = refs
    .map((r) => views[r.id])
    .filter(Boolean)
    .filter((v) => !v.ref.group || !hiddenGroups.includes(v.ref.group))

  // One pass over the visible stations feeds both the chips and the header
  const stats: Record<string, GroupStats> = {}
  for (const g of visibleGroups) stats[g] = { ...NONE }
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
    visibleGroups,
    stations: freeOnly ? inGroup.filter((v) => stateToStatus(v.data?.State) === STATUS.AVAILABLE) : inGroup,
    stats,
    all,
    // A stored filter naming a group that no longer exists matches no station
    counts: activeGroup ? (stats[activeGroup] ?? NONE) : all,
  }
}
