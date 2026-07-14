import { useEffect, useMemo, useState } from 'react'
import { useStations } from './hooks/useStations'
import { useTheme, type Theme } from './hooks/useTheme'
import { StationCard } from './components/StationCard'
import { SettingsDialog } from './components/SettingsDialog'
import { stateToStatus } from './api'
import { STATUS } from './consts/consts'

const FILTER_KEY = 'parking-app:groupFilter'
const HIDDEN_KEY = 'parking-app:hiddenGroups'
const DEFAULT_HIDDEN = ['Besucherplatz', 'Parkhaus EG']

// The worker refreshes from ecarup every 10 min; polling its cache every
// minute keeps the board at most ~1 min behind that
const REFRESH_MS = 60_000

function readStoredFilter(): string {
  return localStorage.getItem(FILTER_KEY) ?? ''
}

function readStoredHidden(): string[] {
  const raw = localStorage.getItem(HIDDEN_KEY)
  if (!raw) return DEFAULT_HIDDEN
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : DEFAULT_HIDDEN
  } catch {
    return DEFAULT_HIDDEN
  }
}

export function App() {
  const [activeGroup, setActiveGroup] = useState<string>(() => readStoredFilter())

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, activeGroup)
  }, [activeGroup])

  const [hiddenGroups, setHiddenGroups] = useState<string[]>(() => readStoredHidden())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenGroups))
  }, [hiddenGroups])

  // If the currently filtered group gets hidden, fall back to "All"
  useEffect(() => {
    if (activeGroup && hiddenGroups.includes(activeGroup)) setActiveGroup('')
  }, [hiddenGroups, activeGroup])

  const { refs, refsError, views } = useStations(REFRESH_MS)
  const { theme, cycleTheme } = useTheme()

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

  const visibleGroups = useMemo(
    () => groups.filter((g) => !hiddenGroups.includes(g)),
    [groups, hiddenGroups],
  )

  // Ungrouped stations are always visible; hiding applies per group
  const visibleOrdered = useMemo(
    () => ordered.filter((v) => !v.ref.group || !hiddenGroups.includes(v.ref.group)),
    [ordered, hiddenGroups],
  )

  const filtered = useMemo(() => {
    if (!activeGroup) return visibleOrdered
    return visibleOrdered.filter((v) => v.ref.group === activeGroup)
  }, [visibleOrdered, activeGroup])

  const counts = useMemo(() => {
    let a = 0, o = 0
    for (const v of filtered) {
      const s = stateToStatus(v.data?.State)
      if (s === STATUS.AVAILABLE) a++
      else if (s === STATUS.OCCUPIED) o++
    }
    return { a, o }
  }, [filtered])

  const groupStats = useMemo(() => {
    const stats: Record<string, { free: number; total: number }> = {}
    for (const g of visibleGroups) stats[g] = { free: 0, total: 0 }
    let allFree = 0
    for (const v of visibleOrdered) {
      const g = v.ref.group
      const free = stateToStatus(v.data?.State) === STATUS.AVAILABLE
      if (free) allFree++
      if (g && stats[g]) {
        stats[g].total++
        if (free) stats[g].free++
      }
    }
    return { stats, all: { free: allFree, total: visibleOrdered.length } }
  }, [visibleOrdered, visibleGroups])

  const toggleGroup = (g: string) => {
    setActiveGroup((prev) => (prev === g ? '' : g))
  }

  return (
    <div className="min-h-full">
      <header className="sm:sticky top-0 z-10 backdrop-blur bg-paper/90 dark:bg-ink/90 border-b border-navy/10 dark:border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src="./icons/icon-192.png"
              alt=""
              className="h-9 w-9 rounded-xl shadow-lg"
            />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl tracking-tight leading-tight truncate">
                Pilatus EV Chargers
              </h1>
              <p className="text-xs text-navy/60 dark:text-white/60">Live status overview</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-xs">
              <div className="hidden sm:flex items-center gap-3 font-semibold">
                <span className="text-mint">{counts.a} Free</span>
                <span style={{ color: '#db0237' }}>{counts.o} Busy</span>
              </div>
              <ThemeToggle theme={theme} onCycle={cycleTheme} />
              <button
                onClick={() => setSettingsOpen(true)}
                title="Settings"
                aria-label="Settings"
                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition bg-transparent text-navy/70 ring-navy/25 hover:ring-navy/60 hover:text-navy dark:text-white/70 dark:ring-white/25 dark:hover:ring-white/60 dark:hover:text-white"
              >
                <span aria-hidden>⚙</span>
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <FilterChip
              active={!activeGroup}
              onClick={() => setActiveGroup('')}
              label="All"
              stats={groupStats.all}
            />
            {visibleGroups.map((g) => (
              <FilterChip
                key={g}
                active={activeGroup === g}
                onClick={() => toggleGroup(g)}
                label={g}
                stats={groupStats.stats[g]}
              />
            ))}
          </div>

        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {refsError && (
          <div className="mb-4 rounded-xl bg-busy/10 ring-1 ring-busy/30 px-4 py-3 text-busy text-sm">
            Failed to load station data: {refsError}
          </div>
        )}
        {filtered.length === 0 && !refsError && (
          <div className="text-center text-navy/50 dark:text-white/50 text-sm py-12">
            No stations match the current filter.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((v) => (
            <StationCard key={v.ref.id} view={v} />
          ))}
        </div>
        <footer className="mt-10 text-center text-xs text-navy/50 dark:text-white/40">
          Data: ecarup.com · updates every 10 min
          <br />
          © 2026 Jarek Szczepanski
        </footer>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        groups={groups}
        hidden={hiddenGroups}
        onToggle={(g) =>
          setHiddenGroups((prev) =>
            prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
          )
        }
      />
    </div>
  )
}

const THEME_META: Record<Theme, { icon: string; label: string }> = {
  auto: { icon: '◐', label: 'Auto' },
  light: { icon: '☀', label: 'Light' },
  dark: { icon: '☾', label: 'Dark' },
}

function ThemeToggle({ theme, onCycle }: { theme: Theme; onCycle: () => void }) {
  const { icon, label } = THEME_META[theme]
  return (
    <button
      onClick={onCycle}
      title={`Theme: ${label} — click to change`}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition bg-transparent text-navy/70 ring-navy/25 hover:ring-navy/60 hover:text-navy dark:text-white/70 dark:ring-white/25 dark:hover:ring-white/60 dark:hover:text-white"
    >
      <span aria-hidden>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
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
    ? 'bg-white/25 text-white dark:bg-navy/15 dark:text-navy'
    : hasStats && stats.free > 0
      ? 'bg-mint/15 text-mint'
      : 'bg-navy/10 text-navy/50 dark:bg-white/10 dark:text-white/50'
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
        active
          ? 'bg-selected text-white shadow dark:bg-white dark:text-navy'
          : 'bg-transparent text-navy/70 ring-1 ring-navy/25 hover:ring-navy/60 hover:text-navy dark:text-white/70 dark:ring-white/25 dark:hover:ring-white/60 dark:hover:text-white'
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
