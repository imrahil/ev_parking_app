import type { BoardSummary } from '../board'
import type { Theme } from '../hooks/useTheme'
import { OUTLINE_PILL } from '../consts/consts'
import { FilterChip } from './FilterChip'
import { ThemeToggle } from './ThemeToggle'

export function Header({
  board,
  activeGroup,
  onShowAll,
  onToggleGroup,
  theme,
  onCycleTheme,
  onOpenSettings,
}: {
  board: BoardSummary
  activeGroup: string
  onShowAll: () => void
  onToggleGroup: (group: string) => void
  theme: Theme
  onCycleTheme: () => void
  onOpenSettings: () => void
}) {
  return (
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
              <span className="text-mint">{board.counts.free} Free</span>
              <span className="text-busy">{board.counts.busy} Busy</span>
            </div>
            <ThemeToggle theme={theme} onCycle={onCycleTheme} />
            <button
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Settings"
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold transition ${OUTLINE_PILL}`}
            >
              <span aria-hidden>⚙</span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <FilterChip active={!activeGroup} onClick={onShowAll} label="All" stats={board.all} />
          {board.visibleGroups.map((g) => (
            <FilterChip
              key={g}
              active={activeGroup === g}
              onClick={() => onToggleGroup(g)}
              label={g}
              stats={board.stats[g]}
            />
          ))}
        </div>
      </div>
    </header>
  )
}
