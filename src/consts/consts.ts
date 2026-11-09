export const STATUS = {
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  UNKNOWN: 'unknown',
} as const

export type Status = (typeof STATUS)[keyof typeof STATUS]

export const STATE_CODE = {
  AVAILABLE: 1,
  OCCUPIED: 2,
} as const

// Tinted chips for per-connector state (sit on card surfaces)
export const CONNECTOR_STYLES: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-mint/15 text-mint ring-1 ring-mint/30',
  [STATUS.OCCUPIED]: 'bg-busy/15 text-busy ring-1 ring-busy/30 dark:text-busy-soft',
  [STATUS.UNKNOWN]:
    'bg-navy/5 text-navy/60 ring-1 ring-navy/20 dark:bg-white/5 dark:text-white/50 dark:ring-white/15',
}

export const STATUS_LABEL: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'Available',
  [STATUS.OCCUPIED]: 'Occupied',
  [STATUS.UNKNOWN]: 'Unknown',
}

export const CONNECTOR_DOT: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-mint',
  [STATUS.OCCUPIED]: 'bg-busy',
  [STATUS.UNKNOWN]: 'bg-navy/40 dark:bg-white/40',
}

// Outlined, transparent button: header controls, inactive filter chips, the
// "Notify me" bell. Text colour is separate because the bell sits one step
// dimmer than the header controls.
export const OUTLINE_RING =
  'bg-transparent ring-1 ring-navy/25 hover:ring-navy/60 hover:text-navy dark:ring-white/25 dark:hover:ring-white/60 dark:hover:text-white'
export const OUTLINE_PILL = `${OUTLINE_RING} text-navy/70 dark:text-white/70`

// Card and dialog surface. The light-mode shadow differs per use, so each
// caller adds its own.
export const CARD_SURFACE =
  'rounded-xl p-5 bg-white text-navy dark:bg-navy dark:text-white dark:shadow-[0_0_4px_1px_rgba(255,255,255,0.22),0_0_10px_2px_rgba(255,255,255,0.12),8px_10px_20px_rgba(0,0,0,0.85)]'
