// Geometry for the 12 h power chart: pure functions from history samples to
// viewBox coordinates. The drawing is in components/PowerSparkline.tsx.

// Matches HISTORY_MS in worker/src/worker.js, which trims the history it serves
// to the same 12 h. Change both, or the chart is half empty or drops samples.
export const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000
// Hourly night samples are the sparsest the worker writes; a longer hole means
// it was down, and drawing a line across it would invent data
const MAX_GAP_MS = 75 * 60 * 1000

// The chart's viewBox; it is stretched to the card's width when drawn
export const VIEW_W = 100
export const VIEW_H = 24

export type Point = { x: number; y: number }

/** Where time `t` falls on the x axis of a window starting at `start`. */
const toX = (t: number, start: number) => Math.min(VIEW_W, ((t - start) / HISTORY_WINDOW_MS) * VIEW_W)

/**
 * Splits a series into drawable runs, breaking at null readings and at long
 * time gaps. x is 0..VIEW_W across the 12 h window ending at `now`, y is 0..VIEW_H with
 * 0 at the top; `max` is the kW that maps to the top edge.
 */
export function sparklineSegments(
  times: number[],
  values: (number | null)[],
  now: number,
  max: number,
): Point[][] {
  const start = now - HISTORY_WINDOW_MS
  const runs: Point[][] = []
  let run: Point[] = []
  let lastT = -Infinity

  const flush = () => {
    if (run.length) runs.push(run)
    run = []
  }

  times.forEach((t, i) => {
    const v = values[i]
    if (t < start || v === null || v === undefined || !Number.isFinite(v)) return flush()
    if (t - lastT > MAX_GAP_MS) flush()
    lastT = t
    run.push({
      x: toX(t, start),
      y: VIEW_H - (Math.max(0, v) / max) * VIEW_H,
    })
  })
  flush()
  return runs
}

type Span = { x0: number; x1: number }

// A lone sample still gets a visible sliver
const MIN_SPAN_W = 0.8

/**
 * Runs of consecutive "plugged in" samples as x ranges across the 12 h window.
 * Like the line, a run breaks at null readings and at long time gaps.
 */
export function occupiedSpans(times: number[], occupied: (number | null)[], now: number): Span[] {
  const start = now - HISTORY_WINDOW_MS
  const spans: Span[] = []
  let current: Span | null = null
  let lastT = -Infinity

  times.forEach((t, i) => {
    const on = occupied[i] === 1
    if (t < start || !on) {
      current = null
      return
    }
    const x = toX(t, start)
    if (current && t - lastT <= MAX_GAP_MS) current.x1 = x
    else spans.push((current = { x0: x, x1: x }))
    lastT = t
  })
  return spans.map((s) => (s.x1 - s.x0 < MIN_SPAN_W ? { x0: s.x0, x1: s.x0 + MIN_SPAN_W } : s))
}

const HOUR_MS = 60 * 60 * 1000

/**
 * x of every full clock hour in the 12 h window ending at `now`, oldest first.
 * Clock hours in the viewer's time zone, not hours-ago, so a tick is 14:00,
 * 15:00, … and the ticks slide left as time passes.
 */
export function hourTicks(now: number): number[] {
  const start = now - HISTORY_WINDOW_MS
  const top = new Date(now)
  top.setMinutes(0, 0, 0)
  const ticks: number[] = []
  for (let t = top.getTime(); t >= start; t -= HOUR_MS) ticks.unshift(toX(t, start))
  return ticks
}

/** Highest reading inside the window, 0 if there is none. */
export function peakPower(times: number[], values: (number | null)[], now: number): number {
  const start = now - HISTORY_WINDOW_MS
  const inWindow = values.filter((v, i): v is number => times[i] >= start && v !== null && Number.isFinite(v))
  return inWindow.length ? Math.max(...inWindow) : 0
}
