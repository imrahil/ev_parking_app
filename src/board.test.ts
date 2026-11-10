import { describe, expect, it } from 'vitest'
import { summariseBoard } from './board'
import { apiStation, BUSY, FREE, OFFLINE, ref, view } from './test/fixtures'
import type { StationRef, StationView } from './types'

// Besucherplatz: 1 free · Parkhaus: 1 free, 1 busy · Weisshorn: 1 busy, 1 offline · ungrouped: 1 free
const entries: [StationRef, number][] = [
  [ref(1, 'Besucherplatz'), FREE],
  [ref(2, 'Parkhaus'), FREE],
  [ref(3, 'Parkhaus'), BUSY],
  [ref(5, 'Weisshorn'), BUSY],
  [ref(6, 'Weisshorn'), OFFLINE],
  [ref(7), FREE],
]
const refs = entries.map(([r]) => r)
const views: Record<string, StationView> = Object.fromEntries(
  entries.map(([r, state]) => [r.id, view(r, apiStation(r, state))]),
)
const ids = (stations: StationView[]) => stations.map((v) => v.ref.id)

describe('summariseBoard', () => {
  it('lists the groups sorted and keeps stations in list order', () => {
    const b = summariseBoard(refs, views, '')
    expect(b.groups).toEqual(['Besucherplatz', 'Parkhaus', 'Weisshorn'])
    expect(ids(b.stations)).toEqual(refs.map((r) => r.id))
  })

  it('counts free, busy and total per group and overall; offline is neither', () => {
    const b = summariseBoard(refs, views, '')
    expect(b.stats.Weisshorn).toEqual({ free: 0, busy: 1, total: 2 })
    expect(b.stats.Parkhaus).toEqual({ free: 1, busy: 1, total: 2 })
    expect(b.all).toEqual({ free: 3, busy: 2, total: 6 })
    expect(b.counts).toEqual(b.all)
  })

  it('ungrouped stations count only towards All', () => {
    const b = summariseBoard(refs, views, '')
    expect(ids(b.stations)).toContain(ref(7).id)
    expect(Object.keys(b.stats)).toEqual(b.groups)
  })

  it('an active group narrows the cards and the header counts, not the chips', () => {
    const b = summariseBoard(refs, views, 'Weisshorn')
    expect(ids(b.stations)).toEqual([ref(5).id, ref(6).id])
    expect(b.counts).toEqual({ free: 0, busy: 1, total: 2 })
    expect(b.all.total).toBe(6)
    expect(b.stats.Parkhaus.total).toBe(2)
  })

  it('an active group that is gone matches nothing', () => {
    const b = summariseBoard(refs, views, 'Gone')
    expect(b.stations).toEqual([])
    expect(b.counts).toEqual({ free: 0, busy: 0, total: 0 })
  })

  it('leaves out a station that has no view yet', () => {
    const { [ref(2).id]: _, ...partial } = views
    const b = summariseBoard(refs, partial, '')
    expect(ids(b.stations)).not.toContain(ref(2).id)
    expect(b.stats.Parkhaus).toEqual({ free: 0, busy: 1, total: 1 })
  })

  it('freeOnly narrows the cards but not the counts', () => {
    const b = summariseBoard(refs, views, '', true)
    expect(ids(b.stations)).toEqual([ref(1).id, ref(2).id, ref(7).id])
    expect(b.all).toEqual({ free: 3, busy: 2, total: 6 })
    expect(b.stats.Weisshorn).toEqual({ free: 0, busy: 1, total: 2 })
  })

  it('freeOnly combines with the active group', () => {
    expect(ids(summariseBoard(refs, views, 'Parkhaus', true).stations)).toEqual([ref(2).id])
    expect(summariseBoard(refs, views, 'Weisshorn', true).stations).toEqual([])
  })
})
