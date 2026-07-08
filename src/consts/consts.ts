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

// Solid pill badges, like the menu's «Vegi» / «Fisch» tags
export const STATUS_STYLES: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-mint text-white',
  [STATUS.OCCUPIED]: 'bg-busy text-white',
  [STATUS.UNKNOWN]:
    'bg-transparent text-navy/60 ring-1 ring-navy/30 dark:text-white/60 dark:ring-white/30',
}

// Tinted chips for per-connector state (sit on card surfaces)
export const CONNECTOR_STYLES: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-mint/15 text-mint ring-1 ring-mint/30',
  [STATUS.OCCUPIED]: 'bg-busy/15 text-busy ring-1 ring-busy/30 dark:text-[#f08a92]',
  [STATUS.UNKNOWN]:
    'bg-navy/5 text-navy/60 ring-1 ring-navy/20 dark:bg-white/5 dark:text-white/50 dark:ring-white/15',
}

export const STATUS_LABEL: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'Available',
  [STATUS.OCCUPIED]: 'Occupied',
  [STATUS.UNKNOWN]: 'Unknown',
}

export const STATUS_DOT: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-white/90',
  [STATUS.OCCUPIED]: 'bg-white/90',
  [STATUS.UNKNOWN]: 'bg-navy/50 dark:bg-white/50',
}

export const CONNECTOR_DOT: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-mint',
  [STATUS.OCCUPIED]: 'bg-busy',
  [STATUS.UNKNOWN]: 'bg-navy/40 dark:bg-white/40',
}
