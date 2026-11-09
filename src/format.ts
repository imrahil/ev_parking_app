// ActivePower from ecarup is already in kW
export function formatPower(kw: number): string {
  return `${kw.toLocaleString('en', { maximumFractionDigits: 1 })} kW`
}

// Display text for whatever a catch block was handed
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Age of a timestamp for the "Updated …" line; null = never fetched
export function timeAgo(ts: number | null, now = Date.now()): string {
  if (!ts) return '—'
  const s = Math.floor((now - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}
