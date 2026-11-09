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

const line = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

export function PowerSparkline({
  times,
  values,
  now = Date.now(),
}: {
  times: number[]
  values: (number | null)[]
  now?: number
}) {
  const start = now - HISTORY_WINDOW_MS
  const inWindow = values.filter((v, i): v is number => times[i] >= start && v !== null && Number.isFinite(v))
  const peak = inWindow.length ? Math.max(...inWindow) : 0
  const runs = sparklineSegments(times, values, now, Math.max(peak, 1))

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[11px] text-navy/50 dark:text-white/50 tabular-nums">
        <span>Last 12 h</span>
        <span>{peak > 0 ? `Peak ${formatPower(peak)}` : 'No charging'}</span>
      </div>
      <svg
        role="img"
        aria-label={peak > 0 ? `Charging power, last 12 hours, peak ${formatPower(peak)}` : 'No charging in the last 12 hours'}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-1 h-8 w-full overflow-visible text-brand"
      >
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
