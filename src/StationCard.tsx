import type { StationView } from './types'
import { stateToStatus } from './api'
import { STATUS, type Status } from './consts'

const STATUS_STYLES: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/40',
  [STATUS.OCCUPIED]: 'bg-rose-500/20 text-rose-300 ring-rose-400/40',
  [STATUS.UNKNOWN]: 'bg-slate-500/20 text-slate-300 ring-slate-400/40',
}

const STATUS_LABEL: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'Available',
  [STATUS.OCCUPIED]: 'Occupied',
  [STATUS.UNKNOWN]: 'Unknown',
}

const STATUS_DOT: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-emerald-400 shadow-emerald-400/60',
  [STATUS.OCCUPIED]: 'bg-rose-400 shadow-rose-400/60',
  [STATUS.UNKNOWN]: 'bg-slate-400 shadow-slate-400/40',
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

export function StationCard({ view }: { view: StationView }) {
  const { ref, data, error, loading, fetchedAt } = view
  const overall = stateToStatus(data?.State)
  const name = data?.Name ?? ref.name
  const desc = data?.Description

  return (
    <div className="rounded-2xl bg-slate-800/60 ring-1 ring-white/10 p-5 shadow-lg backdrop-blur transition hover:ring-white/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white truncate">{name}</h3>
          {desc && <p className="text-xs text-slate-400 mt-0.5 truncate">{desc}</p>}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${STATUS_STYLES[overall]}`}
        >
          <span className={`h-2 w-2 rounded-full shadow-[0_0_8px] ${STATUS_DOT[overall]}`} />
          {STATUS_LABEL[overall]}
        </span>
      </div>

      {data && data.Connectors.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {data.Connectors.map((c) => {
            const s = stateToStatus(c.State)
            return (
              <span
                key={c.Id}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ring-1 ${STATUS_STYLES[s]}`}
                title={`Connector ${c.Name}: ${STATUS_LABEL[s]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]}`} />
                {c.Name}
              </span>
            )
          })}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>{loading && !data ? 'Loading…' : `Updated ${timeAgo(fetchedAt)}`}</span>
        {error && <span className="text-amber-300/80 truncate ml-2" title={error}>⚠ {error}</span>}
      </div>
    </div>
  )
}
