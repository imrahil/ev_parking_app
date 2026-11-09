import type { Theme } from '../hooks/useTheme'
import { OUTLINE_PILL } from '../consts/consts'

const THEME_META: Record<Theme, { icon: string; label: string }> = {
  auto: { icon: '◐', label: 'Auto' },
  light: { icon: '☀', label: 'Light' },
  dark: { icon: '☾', label: 'Dark' },
}

export function ThemeToggle({ theme, onCycle }: { theme: Theme; onCycle: () => void }) {
  const { icon, label } = THEME_META[theme]
  return (
    <button
      onClick={onCycle}
      title={`Theme: ${label} — click to change`}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${OUTLINE_PILL}`}
    >
      <span aria-hidden>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
