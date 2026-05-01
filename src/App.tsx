import { useEffect, useMemo, useState } from 'react'
import { useStations } from './useStations'
import { StationCard } from './StationCard'
import { SettingsBar } from './SettingsBar'
import { stateToStatus } from './api'
import { GROUPS, STATUS } from './consts'

const STORAGE_KEY = 'parking-app:refreshMin'
const FILTER_KEY = 'parking-app:groupFilter'

function readStoredMin(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 5
}

function readStoredFilter(): string[] {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function App() {
  const [refreshMin, setRefreshMin] = useState<number>(() => readStoredMin())
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(refreshMin))
  }, [refreshMin])

  const [activeGroups, setActiveGroups] = useState<string[]>(() => readStoredFilter())
  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(activeGroups))
  }, [activeGroups])

  const { refs, refsError, views, lastTick, refreshNow } = useStations(refreshMin * 60_000)

  const [, setNow] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const ordered = useMemo(() => refs.map((r) => views[r.id]).filter(Boolean), [refs, views])

  const filtered = useMemo(() => {
    if (activeGroups.length === 0) return ordered
    const set = new Set(activeGroups)
    return ordered.filter((v) => v.ref.group && set.has(v.ref.group))
  }, [ordered, activeGroups])

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

  const toggleGroup = (g: string) => {
    setActiveGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
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
              active={activeGroups.length === 0}
              onClick={() => setActiveGroups([])}
              label="All"
            />
            {GROUPS.map((g) => (
              <FilterChip
                key={g}
                active={activeGroups.includes(g)}
                onClick={() => toggleGroup(g)}
                label={g}
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
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
        active
          ? 'bg-cyan-400/90 text-slate-900 ring-cyan-300 shadow'
          : 'bg-slate-800/60 text-slate-300 ring-white/10 hover:ring-white/30 hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}
