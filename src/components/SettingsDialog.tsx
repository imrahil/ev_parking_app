import { useEffect } from 'react'
import type { PushState } from '../hooks/usePushWatch'

type Props = {
  open: boolean
  onClose: () => void
  groups: string[]
  hidden: string[]
  onToggle: (group: string) => void
  pushState: PushState
  watchCount: number
  pushError: string | null
}

// 'unconfigured' hides the section entirely — direct mode has no worker to
// send from, so there is nothing the user could do about it.
const PUSH_HINT: Record<Exclude<PushState, 'unconfigured'>, string> = {
  ready:
    'Tap the bell on a busy charger to be notified once when it frees up. Watches fire a single time and expire after 8 hours.',
  blocked:
    'Notifications are blocked for this site. Re-enable them in your browser settings, then reload.',
  'needs-install':
    'On iPhone and iPad, notifications only work once the app is installed: tap Share, then Add to Home Screen, and open it from there.',
  unsupported: 'This browser does not support web notifications.',
}

export function SettingsDialog({
  open,
  onClose,
  groups,
  hidden,
  onToggle,
  pushState,
  watchCount,
  pushError,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 bg-white text-navy shadow-[0_8px_20px_-6px_rgba(8,24,35,0.4)] dark:bg-navy dark:text-white dark:shadow-[0_0_4px_1px_rgba(255,255,255,0.22),0_0_10px_2px_rgba(255,255,255,0.12),8px_10px_20px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-navy/80 dark:border-white/80 pb-3">
          <h2 className="text-base font-semibold tracking-tight">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full h-7 w-7 inline-flex items-center justify-center text-navy/60 hover:text-navy hover:bg-navy/5 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10 transition"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-navy/50 dark:text-white/50">
          Visible stations
        </p>
        <div className="mt-2 space-y-0.5">
          {groups.map((g) => (
            <label
              key={g}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm cursor-pointer hover:bg-navy/5 dark:hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={!hidden.includes(g)}
                onChange={() => onToggle(g)}
                className="h-4 w-4 accent-brand"
              />
              {g}
            </label>
          ))}
        </div>

        {pushState !== 'unconfigured' && (
          <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-navy/50 dark:text-white/50">
              Notifications
            </p>
            <p className="mt-2 text-xs leading-relaxed text-navy/60 dark:text-white/60">
              {PUSH_HINT[pushState]}
            </p>
            {pushState === 'ready' && watchCount > 0 && (
              <p className="mt-1.5 text-xs font-semibold text-mint">
                {watchCount} charger{watchCount === 1 ? '' : 's'} being watched
              </p>
            )}
            {pushError && (
              <p className="mt-1.5 text-xs text-busy dark:text-[#f08a92]">⚠ {pushError}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
