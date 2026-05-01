type Props = {
  refreshMin: number
  onRefreshMin: (n: number) => void
  onManualRefresh: () => void
  lastTick: number
}

const OPTIONS = [1, 5, 10, 15, 30]

export function SettingsBar({ refreshMin, onRefreshMin, onManualRefresh, lastTick }: Props) {
  const updated = new Date(lastTick).toLocaleTimeString()
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2 text-slate-300">
        <span className="text-slate-400">Refresh</span>
        <select
          value={refreshMin}
          onChange={(e) => onRefreshMin(Number(e.target.value))}
          className="rounded-lg bg-slate-800/80 ring-1 ring-white/10 px-2.5 py-1.5 text-white focus:outline-none focus:ring-cyan-400/60"
        >
          {OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={onManualRefresh}
        className="rounded-lg bg-cyan-500/90 hover:bg-cyan-400 text-slate-900 font-semibold px-3 py-1.5 transition shadow"
      >
        Refresh now
      </button>
      <span className="text-xs text-slate-400 ml-auto">Last sync: {updated}</span>
    </div>
  )
}
