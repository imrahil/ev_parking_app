import { useEffect, useMemo, useState } from 'react'
import { useStations } from './hooks/useStations'
import { useHistory } from './hooks/useHistory'
import { usePushWatch } from './hooks/usePushWatch'
import { useTheme } from './hooks/useTheme'
import { useGroupFilter } from './hooks/useGroupFilter'
import { Header } from './components/Header'
import { StationCard } from './components/StationCard'
import { SettingsDialog } from './components/SettingsDialog'
import { summariseBoard } from './board'

// The worker refreshes from ecarup every 10 min; polling its cache every
// minute keeps the board at most ~1 min behind that
const REFRESH_MS = 60_000

export function App() {
  const { activeGroup, hiddenGroups, freeOnly, showAll, toggleGroup, toggleHidden, toggleFreeOnly } = useGroupFilter()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { refs, refsError, views } = useStations(REFRESH_MS)
  const { theme, cycleTheme } = useTheme()
  const push = usePushWatch()
  const history = useHistory()

  // Re-render twice a minute so "Updated X ago" and the charts keep moving
  const [, setNow] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const board = useMemo(
    () => summariseBoard(refs, views, hiddenGroups, activeGroup, freeOnly),
    [refs, views, hiddenGroups, activeGroup, freeOnly],
  )

  return (
    <div className="min-h-full">
      <Header
        board={board}
        activeGroup={activeGroup}
        onShowAll={showAll}
        onToggleGroup={toggleGroup}
        freeOnly={freeOnly}
        onToggleFreeOnly={toggleFreeOnly}
        theme={theme}
        onCycleTheme={cycleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {refsError && (
          <div className="mb-4 rounded-xl bg-busy/10 ring-1 ring-busy/30 px-4 py-3 text-busy text-sm">
            Failed to load station data: {refsError}
          </div>
        )}
        {board.stations.length === 0 && !refsError && (
          <div className="text-center text-navy/50 dark:text-white/50 text-sm py-12">
            {freeOnly && board.counts.total > 0
              ? 'No free chargers right now.'
              : 'No stations match the current filter.'}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {board.stations.map((v) => (
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
        groups={board.groups}
        hidden={hiddenGroups}
        onToggle={toggleHidden}
        pushState={push.state}
        watchCount={push.watches.length}
        pushError={push.error}
      />
    </div>
  )
}
