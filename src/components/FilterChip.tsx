import { OUTLINE_PILL } from '../consts/consts'

export function FilterChip({
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
          : OUTLINE_PILL
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
