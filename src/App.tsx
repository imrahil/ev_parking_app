import { useEffect, useMemo, useState } from 'react'
import { useStations } from './hooks/useStations'
import { useHistory } from './hooks/useHistory'
import { usePushWatch } from './hooks/usePushWatch'
import { useTheme } from './hooks/useTheme'
import { useGroupFilter } from './hooks/useGroupFilter'
import { StationCard } from './components/StationCard'
import { SettingsDialog } from './components/SettingsDialog'
import { ThemeToggle } from './components/ThemeToggle'
import { FilterChip } from './components/FilterChip'
import { stateToStatus } from './api'
import { OUTLINE_PILL, STATUS } from './consts/consts'

// The worker refreshes from ecarup every 10 min; polling its cache every
// minute keeps the board at most ~1 min behind that
const REFRESH_MS = 60_000

type GroupStats = { free: number; busy: number; total: number }

export function App() {
  const { activeGroup, hiddenGroups, showAll, toggleGroup, toggleHidden } = useGroupFilter()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { refs, refsError, views } = useStations(REFRESH_MS)
  const { theme, cycleTheme } = useTheme()
  const push = usePushWatch()
  const history = useHistory()

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

  // One pass over the visible stations feeds both the chips and the header
  const groupStats = useMemo(() => {
    const stats: Record<string, GroupStats> = {}
    for (const g of visibleGroups) stats[g] = { free: 0, busy: 0, total: 0 }
    const all: GroupStats = { free: 0, busy: 0, total: 0 }
    for (const v of visibleOrdered) {
      const status = stateToStatus(v.data?.State)
      const group = v.ref.group ? stats[v.ref.group] : undefined
      for (const bucket of group ? [all, group] : [all]) {
        bucket.total++
        if (status === STATUS.AVAILABLE) bucket.free++
        else if (status === STATUS.OCCUPIED) bucket.busy++
      }
    }
    return { stats, all }
  }, [visibleOrdered, visibleGroups])

  // The header counts follow the active filter. A stored filter naming a group
  // that no longer exists matches no station, hence the fallback to zero.
  const counts: GroupStats | undefined = activeGroup ? groupStats.stats[activeGroup] : groupStats.all

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
                <span className="text-mint">{counts?.free ?? 0} Free</span>
                <span className="text-busy">{counts?.busy ?? 0} Busy</span>
              </div>
              <ThemeToggle theme={theme} onCycle={cycleTheme} />
              <button
                onClick={() => setSettingsOpen(true)}
                title="Settings"
                aria-label="Settings"
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold transition ${OUTLINE_PILL}`}
              >
                <span aria-hidden>⚙</span>
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <FilterChip
              active={!activeGroup}
              onClick={showAll}
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
            <StationCard
              history={history
                  ? { times: history.t, values: history.p[v.ref.id] ?? [], occupied: history.s?.[v.ref.id] }
                  : undefined}
              key={v.ref.id}
              view={v}
              watch={
                push.state === 'ready'
                  ? {
                      armed: push.watches.includes(v.ref.id),
                      busy: push.busy === v.ref.id,
                      onToggle: () => push.toggle(v.ref.id),
                    }
                  : undefined
              }
            />
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
        onToggle={toggleHidden}
        pushState={push.state}
        watchCount={push.watches.length}
        pushError={push.error}
      />
    </div>
  )
}
