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

export const GROUPS = [
  'Besucherplatz',
  'Parkhaus EG',
  'Parkhaus 1.OG',
  'Weisshorn',
] as const

export type Group = (typeof GROUPS)[number]
