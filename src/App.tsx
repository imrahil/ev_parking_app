import { useEffect, useMemo, useState } from 'react'
import { useStations } from './useStations'
import { StationCard } from './StationCard'
import { SettingsBar } from './SettingsBar'
import { stateToStatus } from './api'
import { STATUS } from './consts'

const STORAGE_KEY = 'parking-app:refreshMin'
const FILTER_KEY = 'parking-app:groupFilter'

function readStoredMin(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 5
}

function readStoredFilter(): string {
  return localStorage.getItem(FILTER_KEY) ?? ''
}

export function App() {
  const [refreshMin, setRefreshMin] = useState<number>(() => readStoredMin())
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(refreshMin))
  }, [refreshMin])

  const [activeGroup, setActiveGroup] = useState<string>(() => readStoredFilter())
  useEffect(() => {
    localStorage.setItem(FILTER_KEY, activeGroup)
  }, [activeGroup])

  const { refs, refsError, views, lastTick, refreshNow } = useStations(refreshMin * 60_000)

  const [, setNow] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const ordered = useMemo(() => refs.map((r) => views[r.id]).filter(Boolean), [refs, views])

  const groups = useMemo(() => {
    return Array.from(
      new Set(refs.map((r) => r.group).filter((g): g is string => Boolean(g)))
    ).sort()
  }, [refs])

  const filtered = useMemo(() => {
    if (!activeGroup) return ordered
    return ordered.filter((v) => v.ref.group === activeGroup)
  }, [ordered, activeGroup])

  const counts = useMemo(() => {
    let a = 0, o = 0, u = 0
    for (const v of filtered) {
      const s = stateToStatus(v.data?.State)
      if (s === STATUS.AVAILABLE) a++
      else if (s === STATUS.OCCUPIED) o++
      else u++
    }
    return { a, o, u }
  }, [filtered])

  const groupStats = useMemo(() => {
    const stats: Record<string, { free: number; total: number }> = {}
    for (const g of groups) stats[g] = { free: 0, total: 0 }
    let allFree = 0
    for (const v of ordered) {
      const g = v.ref.group
      const free = stateToStatus(v.data?.State) === STATUS.AVAILABLE
      if (free) allFree++
      if (g && stats[g]) {
        stats[g].total++
        if (free) stats[g].free++
      }
    }
    return { stats, all: { free: allFree, total: ordered.length } }
  }, [ordered, groups])

  const toggleGroup = (g: string) => {
    setActiveGroup((prev) => (prev === g ? '' : g))
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 backdrop-blur bg-slate-950/60 ring-1 ring-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-400 grid place-items-center text-slate-900 font-black shadow-lg">
              ⚡
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-white leading-tight">
                Pilatus EV Chargers
              </h1>
              <p className="text-xs text-slate-400">Live status overview</p>
            </div>
            <div className="ml-auto hidden sm:flex items-center gap-2 text-xs">
              <Pill color="emerald" label={`${counts.a} free`} />
              <Pill color="rose" label={`${counts.o} busy`} />
              <Pill color="slate" label={`${counts.u} ?`} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <FilterChip
              active={!activeGroup}
              onClick={() => setActiveGroup('')}
              label="All"
              stats={groupStats.all}
            />
            {groups.map((g) => (
              <FilterChip
                key={g}
                active={activeGroup === g}
                onClick={() => toggleGroup(g)}
                label={g}
                stats={groupStats.stats[g]}
              />
            ))}
          </div>

          <div className="mt-3">
            <SettingsBar
              refreshMin={refreshMin}
              onRefreshMin={setRefreshMin}
              onManualRefresh={refreshNow}
              lastTick={lastTick}
            />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {refsError && (
          <div className="mb-4 rounded-lg bg-rose-500/15 ring-1 ring-rose-400/30 px-4 py-3 text-rose-200 text-sm">
            Failed to load stations.json: {refsError}
          </div>
        )}
        {filtered.length === 0 && !refsError && (
          <div className="text-center text-slate-500 text-sm py-12">
            No stations match the current filter.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((v) => (
            <StationCard key={v.ref.id} view={v} />
          ))}
        </div>
        <footer className="mt-10 text-center text-xs text-slate-500">
          Data: ecarup.com · Refresh every {refreshMin} min
        </footer>
      </main>
    </div>
  )
}

function Pill({ color, label }: { color: 'emerald' | 'rose' | 'slate'; label: string }) {
  const map = {
    emerald: 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/40',
    rose: 'bg-rose-500/20 text-rose-300 ring-rose-400/40',
    slate: 'bg-slate-500/20 text-slate-300 ring-slate-400/40',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 ring-1 font-medium ${map[color]}`}>
      {label}
    </span>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  stats,
}: {
  active: boolean
  onClick: () => void
  label: string
  stats?: { free: number; total: number }
}) {
  const hasStats = stats && stats.total > 0
  const badgeColor = active
    ? 'bg-slate-900/20 text-slate-900'
    : hasStats && stats.free > 0
      ? 'bg-emerald-500/20 text-emerald-300'
      : 'bg-slate-700/60 text-slate-400'
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
        active
          ? 'bg-cyan-400/90 text-slate-900 ring-cyan-300 shadow'
          : 'bg-slate-800/60 text-slate-300 ring-white/10 hover:ring-white/30 hover:text-white'
      }`}
    >
      <span>{label}</span>
      {hasStats && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${badgeColor}`}>
          {stats.free}/{stats.total}
        </span>
      )}
    </button>
  )
}
