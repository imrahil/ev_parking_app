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

export const STATUS_STYLES: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/40',
  [STATUS.OCCUPIED]: 'bg-rose-500/20 text-rose-300 ring-rose-400/40',
  [STATUS.UNKNOWN]: 'bg-slate-500/20 text-slate-300 ring-slate-400/40',
}

export const STATUS_LABEL: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'Available',
  [STATUS.OCCUPIED]: 'Occupied',
  [STATUS.UNKNOWN]: 'Unknown',
}

export const STATUS_DOT: Record<Status, string> = {
  [STATUS.AVAILABLE]: 'bg-emerald-400 shadow-emerald-400/60',
  [STATUS.OCCUPIED]: 'bg-rose-400 shadow-rose-400/60',
  [STATUS.UNKNOWN]: 'bg-slate-400 shadow-slate-400/40',
}
