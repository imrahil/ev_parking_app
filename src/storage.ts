/**
 * A JSON array of strings from localStorage. Anything else — no entry, broken
 * JSON, not an array — gives `fallback`; non-string items are dropped.
 */
export function readStringArray(key: string, fallback: string[] = []): string[] {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback
  } catch {
    return fallback
  }
}
