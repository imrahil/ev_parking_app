import type { StationView } from '../types'
import { formatPower } from '../format'
import { PowerSparkline } from './PowerSparkline'
import { stateToStatus } from '../api'
import {
  STATUS,
  STATUS_LABEL,
  CONNECTOR_STYLES,
  CONNECTOR_DOT,
  CARD_SURFACE,
  OUTLINE_RING,
  STATUS_TEXT,
  STATUS_TEXT_STYLES,
  STATUS_TEXT_DOT,
} from '../consts/consts'

export type PowerSeries = {
  times: number[]
  values: (number | null)[]
  // 1 = a car was plugged in at that sample
  occupied?: (number | null)[]
}

export type WatchControl = {
  armed: boolean
  busy: boolean
  onToggle: () => void
}

function timeAgo(ts: number | null): string {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

export function StationCard({
  view,
  watch,
  history,
}: {
  view: StationView
  watch?: WatchControl
  history?: PowerSeries
}) {
  const { ref, data, error, loading, fetchedAt } = view
  const overall = stateToStatus(data?.State)
  const name = data?.Name ?? ref.name
  const desc = data?.Description
  const power = overall === STATUS.OCCUPIED && Number.isFinite(data?.ActivePower) ? data!.ActivePower : null

  const connectors = data?.Connectors ?? []

  return (
    <div className={`${CARD_SURFACE} shadow-[0_8px_20px_-6px_rgba(8,24,35,0.25)]`}>
      <div className="flex items-start justify-between gap-3 border-b border-navy/80 dark:border-white/80 pb-3">
        <div className="min-w-0">
          <h3 className="text-base tracking-tight truncate">{name}</h3>
          {desc && <p className="text-xs text-navy/60 dark:text-white/60 mt-0.5 truncate">{desc}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span
            className={`inline-flex items-center gap-1.5 text-sm font-bold tracking-wide ${STATUS_TEXT_STYLES[overall]}`}
          >
            <span className={`h-2 w-2 rounded-full ${STATUS_TEXT_DOT[overall]}`} />
            {STATUS_TEXT[overall]}
          </span>
          {power !== null && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-navy/60 dark:text-white/60 mt-0.5 tabular-nums"
              title="Current charging power"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
              </svg>
              {formatPower(power)}
            </span>
          )}
        </div>
      </div>

      {connectors.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {connectors.map((c) => {
            const s = stateToStatus(c.State)
            return (
              <span
                key={c.Id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONNECTOR_STYLES[s]}`}
                title={`Connector ${c.Name}: ${STATUS_LABEL[s]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${CONNECTOR_DOT[s]}`} />
                {c.Name}
              </span>
            )
          })}
        </div>
      )}

      {history && <PowerSparkline times={history.times} values={history.values} occupied={history.occupied} />}

      <div className="mt-4 flex items-center gap-2 text-xs text-navy/50 dark:text-white/50">
        <span className="min-w-0 truncate">
          {loading && !data ? 'Loading…' : `Updated ${timeAgo(fetchedAt)}`}
          {error && (
            <span className="text-busy dark:text-busy-soft ml-2" title={error}>
              ⚠ {error}
            </span>
          )}
        </span>

        {watch && overall === STATUS.OCCUPIED && (
          <button
            onClick={watch.onToggle}
            disabled={watch.busy}
            aria-pressed={watch.armed}
            title={
              watch.armed
                ? 'Watching - you get one notification when this charger frees up'
                : 'Notify me once when this charger frees up'
            }
            className={`ml-auto shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
              watch.armed
                ? CONNECTOR_STYLES[STATUS.AVAILABLE]
                : `${OUTLINE_RING} text-navy/60 dark:text-white/60`
            }`}
          >
            <span aria-hidden>🔔</span>
            {watch.armed ? 'Watching' : 'Notify me'}
          </button>
        )}
      </div>
    </div>
  )
}
