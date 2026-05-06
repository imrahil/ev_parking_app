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
