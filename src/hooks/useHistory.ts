import { useEffect, useState } from 'react'
import { API_URL, fetchHistory } from '../api'
import type { PowerHistory } from '../types'

// The worker samples every 10 min, so asking more often than this buys nothing
const HISTORY_REFRESH_MS = 5 * 60_000

/**
 * Charging-power history from the worker. Null until loaded, and for good in
 * direct mode (the browser has nowhere to accumulate it). A failed load is
 * not an error worth showing: the charts simply stay hidden.
 */
export function useHistory(): PowerHistory | null {
  const [history, setHistory] = useState<PowerHistory | null>(null)

  useEffect(() => {
    if (!API_URL) return
    const ac = new AbortController()

    const load = () =>
      fetchHistory(ac.signal)
        .then((h) => !ac.signal.aborted && setHistory(h))
        .catch(() => {})

    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }

    load()
    const id = setInterval(load, HISTORY_REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      ac.abort()
    }
  }, [])

  return history
}
