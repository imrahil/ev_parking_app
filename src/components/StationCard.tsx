import type { StationView } from '../types'
import { stateToStatus } from '../api'
import {
  STATUS,
  STATUS_LABEL,
  CONNECTOR_STYLES,
  CONNECTOR_DOT,
  type Status,
} from '../consts/consts'

export type WatchControl = {
  armed: boolean
  busy: boolean
  onToggle: () => void
}

// Price-style status text, like the menu's blue «CHF 9.20»
const STATUS_TEXT: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'Free',
  [STATUS.OCCUPIED]: 'Occupied',
  [STATUS.UNKNOWN]: 'Unknown',
}

const STATUS_TEXT_STYLES: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'text-mint',
  [STATUS.OCCUPIED]: 'text-brand',
  [STATUS.UNKNOWN]: 'text-navy/50 dark:text-white/50',
}

const STATUS_TEXT_DOT: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-mint shadow-[0_0_8px] shadow-mint/60',
  [STATUS.OCCUPIED]: 'bg-brand shadow-[0_0_8px] shadow-brand/60',
  [STATUS.UNKNOWN]: 'bg-navy/40 dark:bg-white/40',
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

export function StationCard({ view, watch }: { view: StationView; watch?: WatchControl }) {
  const { ref, data, error, loading, fetchedAt } = view
  const overall = stateToStatus(data?.State)
  const name = data?.Name ?? ref.name
  const desc = data?.Description

  const connectors = data?.Connectors ?? []

  return (
    <div className="rounded-xl p-5 bg-white text-navy shadow-[0_8px_20px_-6px_rgba(8,24,35,0.25)] dark:bg-navy dark:text-white dark:shadow-[0_0_4px_1px_rgba(255,255,255,0.22),0_0_10px_2px_rgba(255,255,255,0.12),8px_10px_20px_rgba(0,0,0,0.85)]">
      <div className="flex items-start justify-between gap-3 border-b border-navy/80 dark:border-white/80 pb-3">
        <div className="min-w-0">
          <h3 className="text-base tracking-tight truncate">{name}</h3>
          {desc && <p className="text-xs text-navy/60 dark:text-white/60 mt-0.5 truncate">{desc}</p>}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-bold tracking-wide ${STATUS_TEXT_STYLES[overall]}`}
        >
          <span className={`h-2 w-2 rounded-full ${STATUS_TEXT_DOT[overall]}`} />
          {STATUS_TEXT[overall]}
        </span>
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

      <div className="mt-4 flex items-center gap-2 text-xs text-navy/50 dark:text-white/50">
        <span className="min-w-0 truncate">
          {loading && !data ? 'Loading…' : `Updated ${timeAgo(fetchedAt)}`}
          {error && (
            <span className="text-busy dark:text-[#f08a92] ml-2" title={error}>
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
                : 'bg-transparent ring-1 text-navy/60 ring-navy/25 hover:ring-navy/60 hover:text-navy dark:text-white/60 dark:ring-white/25 dark:hover:ring-white/60 dark:hover:text-white'
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
