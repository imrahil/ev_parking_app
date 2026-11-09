import { formatPower } from '../format'

export const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000
// Hourly night samples are the sparsest the worker writes; a longer hole means
// it was down, and drawing a line across it would invent data
const MAX_GAP_MS = 75 * 60 * 1000

const W = 100
const H = 24

type Point = { x: number; y: number }

/**
 * Splits a series into drawable runs, breaking at null readings and at long
 * time gaps. x is 0..W across the 12 h window ending at `now`, y is 0..H with
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
      x: Math.min(W, ((t - start) / HISTORY_WINDOW_MS) * W),
      y: H - (Math.max(0, v) / max) * H,
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
    const x = Math.min(W, ((t - start) / HISTORY_WINDOW_MS) * W)
    if (current && t - lastT <= MAX_GAP_MS) current.x1 = x
    else spans.push((current = { x0: x, x1: x }))
    lastT = t
  })
  return spans.map((s) => (s.x1 - s.x0 < MIN_SPAN_W ? { x0: s.x0, x1: s.x0 + MIN_SPAN_W } : s))
}

const line = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

export function PowerSparkline({
  times,
  values,
  occupied = [],
  now = Date.now(),
}: {
  times: number[]
  values: (number | null)[]
  occupied?: (number | null)[]
  now?: number
}) {
  const start = now - HISTORY_WINDOW_MS
  const inWindow = values.filter((v, i): v is number => times[i] >= start && v !== null && Number.isFinite(v))
  const peak = inWindow.length ? Math.max(...inWindow) : 0
  const runs = sparklineSegments(times, values, now, Math.max(peak, 1))
  const spans = occupiedSpans(times, occupied, now)

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[11px] text-navy/50 dark:text-white/50 tabular-nums">
        <span>Last 12 h</span>
        {spans.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="h-2 w-3 rounded-sm bg-navy/10 dark:bg-white/15" />
            Plugged in
          </span>
        )}
        <span>{peak > 0 ? `Peak ${formatPower(peak)}` : 'No charging'}</span>
      </div>
      <svg
        role="img"
        aria-label={
          (peak > 0 ? `Charging power, last 12 hours, peak ${formatPower(peak)}` : 'No charging in the last 12 hours') +
          (spans.length ? '; shaded while a car was plugged in' : '')
        }
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-1 h-8 w-full overflow-visible text-brand"
      >
        {spans.map((sp, i) => (
          <rect
            key={i}
            x={sp.x0}
            y="0"
            width={sp.x1 - sp.x0}
            height={H}
            className="fill-navy/10 dark:fill-white/15"
          />
        ))}
        <line
          x1="0"
          x2={W}
          y1={H}
          y2={H}
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {runs.map((pts, i) =>
          pts.length === 1 ? (
            <circle key={i} cx={pts[0].x} cy={pts[0].y} r="1" fill="currentColor" />
          ) : (
            <g key={i}>
              <path
                d={`${line(pts)} L${pts[pts.length - 1].x.toFixed(2)} ${H} L${pts[0].x.toFixed(2)} ${H} Z`}
                fill="currentColor"
                fillOpacity="0.15"
              />
              <path
                d={line(pts)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ),
        )}
      </svg>
    </div>
  )
}
