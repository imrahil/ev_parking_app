import { describe, expect, it } from 'vitest'
import { HISTORY_WINDOW_MS, hourTicks, occupiedSpans, peakPower, sparklineSegments } from './sparkline'

const NOW = 100 * HISTORY_WINDOW_MS
const MIN = 60_000

describe('sparklineSegments', () => {
  it('maps the window to x 0..100 and kW to y, 0 kW at the bottom', () => {
    // 6 h apart, so they are separate runs; one point each
    const [a, b] = sparklineSegments([NOW - HISTORY_WINDOW_MS / 2, NOW], [0, 10], NOW, 10)
    expect(a[0]).toEqual({ x: 50, y: 24 })
    expect(b[0]).toEqual({ x: 100, y: 0 })
  })

  it('breaks the line at null readings', () => {
    const runs = sparklineSegments([NOW - 30 * MIN, NOW - 20 * MIN, NOW - 10 * MIN], [5, null, 5], NOW, 10)
    expect(runs).toHaveLength(2)
  })

  it('breaks the line across a gap longer than the sampling interval', () => {
    const runs = sparklineSegments([NOW - 5 * 60 * MIN, NOW - 10 * MIN], [5, 5], NOW, 10)
    expect(runs).toHaveLength(2)
  })

  it('ignores samples older than 12 h', () => {
    expect(sparklineSegments([NOW - HISTORY_WINDOW_MS - MIN], [5], NOW, 10)).toEqual([])
  })
})

describe('occupiedSpans', () => {
  const at = (...mins: number[]) => mins.map((m) => NOW - m * MIN)

  it('merges consecutive plugged-in samples into one span', () => {
    const spans = occupiedSpans(at(40, 30, 20, 10), [1, 1, 1, 0], NOW)
    expect(spans).toHaveLength(1)
    expect(spans[0].x0).toBeCloseTo(((HISTORY_WINDOW_MS - 40 * MIN) / HISTORY_WINDOW_MS) * 100)
    expect(spans[0].x1).toBeCloseTo(((HISTORY_WINDOW_MS - 20 * MIN) / HISTORY_WINDOW_MS) * 100)
  })

  it('splits at a free sample, a failed fetch and a long gap', () => {
    expect(occupiedSpans(at(50, 40, 30, 20), [1, 0, 1, 1], NOW)).toHaveLength(2)
    expect(occupiedSpans(at(50, 40, 30, 20), [1, null, 1, 1], NOW)).toHaveLength(2)
    expect(occupiedSpans(at(300, 10), [1, 1], NOW)).toHaveLength(2)
  })

  it('gives a single sample a visible width, and ignores old ones', () => {
    const [s] = occupiedSpans(at(10), [1], NOW)
    expect(s.x1 - s.x0).toBeGreaterThan(0)
    expect(occupiedSpans([NOW - HISTORY_WINDOW_MS - MIN], [1], NOW)).toEqual([])
  })

  it('is empty without occupancy data (history from before it was recorded)', () => {
    expect(occupiedSpans(at(10, 20), [], NOW)).toEqual([])
  })
})

describe('hourTicks', () => {
  // Local time, in January so no DST change falls inside the window
  const at1230 = new Date(2026, 0, 15, 12, 30).getTime()

  it('puts one tick on every full clock hour in the window, oldest first', () => {
    const ticks = hourTicks(at1230)
    // 01:00 … 12:00; 00:30 is the left edge, so 00:00 is out
    expect(ticks).toHaveLength(12)
    expect(ticks[0]).toBeCloseTo((0.5 / 12) * 100)
    expect(ticks[11]).toBeCloseTo((11.5 / 12) * 100)
    expect(ticks[1] - ticks[0]).toBeCloseTo(100 / 12)
  })

  it('ticks both edges when now is exactly on the hour', () => {
    const ticks = hourTicks(new Date(2026, 0, 15, 12, 0).getTime())
    expect(ticks).toHaveLength(13)
    expect(ticks[0]).toBeCloseTo(0)
    expect(ticks[12]).toBeCloseTo(100)
  })
})

describe('peakPower', () => {
  it('is the highest reading in the window, ignoring gaps and old samples', () => {
    const times = [NOW - HISTORY_WINDOW_MS - MIN, NOW - 20 * MIN, NOW - 10 * MIN, NOW]
    expect(peakPower(times, [22, 3.6, null, 7.4], NOW)).toBe(7.4)
  })

  it('is 0 with no readings', () => {
    expect(peakPower([], [], NOW)).toBe(0)
    expect(peakPower([NOW], [null], NOW)).toBe(0)
  })
})
