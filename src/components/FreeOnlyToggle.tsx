import { OUTLINE_PILL } from '../consts/consts'

// Narrows the cards to free stations. Sits at the end of the chip row, pushed
// right, so it reads as a view option rather than another group.
export function FreeOnlyToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      title={on ? 'Showing free chargers only' : 'Show free chargers only'}
      className={`ml-auto inline-flex items-center gap-2 rounded-full py-1 pl-1.5 pr-3 text-xs font-semibold transition ${
        on ? 'bg-mint/15 text-mint ring-1 ring-mint/50' : OUTLINE_PILL
      }`}
    >
      <span
        aria-hidden
        className={`relative inline-block h-4 w-7 rounded-full transition-colors ${
          on ? 'bg-mint' : 'bg-navy/20 dark:bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
            on ? 'translate-x-3' : ''
          }`}
        />
      </span>
      Free only
    </button>
  )
}
