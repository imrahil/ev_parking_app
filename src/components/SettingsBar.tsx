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
      <label className="flex items-center gap-2">
        <span className="text-navy/60 dark:text-white/60">Refresh</span>
        <select
          value={refreshMin}
          onChange={(e) => onRefreshMin(Number(e.target.value))}
          className="rounded-full bg-white text-navy ring-1 ring-navy/20 px-2.5 py-1.5 dark:bg-navy dark:text-white dark:ring-white/20 focus:outline-none focus:ring-brand"
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
        className="rounded-full bg-brand hover:bg-[#0b8ec2] text-white font-semibold px-4 py-1.5 transition shadow"
      >
        Refresh now
      </button>
      <span className="text-xs text-navy/50 dark:text-white/50 ml-auto">Last sync: {updated}</span>
    </div>
  )
}
