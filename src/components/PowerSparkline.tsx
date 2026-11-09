import { formatPower } from '../format'
import type { PowerSeries } from '../types'
import {
  VIEW_H,
  VIEW_W,
  hourTicks,
  occupiedSpans,
  peakPower,
  sparklineSegments,
  type Point,
} from '../sparkline'

// Ticks hang below the baseline (the svg is overflow-visible) so they never
// sit on top of the data
const TICK_H = 3

const line = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

export function PowerSparkline({
  times,
  values,
  occupied = [],
  now = Date.now(),
}: PowerSeries & { now?: number }) {
  const peak = peakPower(times, values, now)
  const runs = sparklineSegments(times, values, now, Math.max(peak, 1))
  const spans = occupiedSpans(times, occupied, now)
  const ticks = hourTicks(now)

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
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="mt-1 h-8 w-full overflow-visible text-brand"
      >
        {spans.map((sp, i) => (
          <rect
            key={i}
            x={sp.x0}
            y="0"
            width={sp.x1 - sp.x0}
            height={VIEW_H}
            className="fill-navy/10 dark:fill-white/15"
          />
        ))}
        <line
          x1="0"
          x2={VIEW_W}
          y1={VIEW_H}
          y2={VIEW_H}
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <g data-hour-ticks aria-hidden stroke="currentColor" strokeOpacity="0.35" strokeWidth="1">
          {ticks.map((x) => (
            <line key={x} x1={x} x2={x} y1={VIEW_H} y2={VIEW_H + TICK_H} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        {runs.map((pts, i) =>
          pts.length === 1 ? (
            <circle key={i} cx={pts[0].x} cy={pts[0].y} r="1" fill="currentColor" />
          ) : (
            <g key={i}>
              <path
                d={`${line(pts)} L${pts[pts.length - 1].x.toFixed(2)} ${VIEW_H} L${pts[0].x.toFixed(2)} ${VIEW_H} Z`}
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
