import { useCallback, useEffect, useRef, useState } from 'react'
import { armWatch, disarmWatch, fetchWatches, subIdFor } from '../api'
import { errorMessage } from '../format'
import { currentSubscription, detectPushState, subscribeToPush } from '../push'
import { readStringArray } from '../storage'
import type { PushState, PushSubscriptionPayload } from '../types'

const WATCHES_KEY = 'parking-app:watches'

// Watches only vanish server-side when the cron delivers them (every 10 min)
// or they expire, so re-syncing more often than this rarely finds a change —
// and every GET /watches spends a KV list from the worker's public daily
// budget, the same one arming needs.
export const FOCUS_SYNC_MS = 10 * 60 * 1000

export function usePushWatch() {
  const [state, setState] = useState<PushState>(() => detectPushState())
  const [watches, setWatches] = useState<string[]>(() => readStringArray(WATCHES_KEY))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Read by the focus listener without re-subscribing it on every change
  const watchesRef = useRef(watches)

  useEffect(() => {
    watchesRef.current = watches
    localStorage.setItem(WATCHES_KEY, JSON.stringify(watches))
  }, [watches])

  // The server is the source of truth: watches are one-shot and expire after
  // 8h, so localStorage goes stale on its own. Re-sync on load (which also
  // recovers watches after a reinstall), and on coming back into view — but
  // only when a bell is lit (with none armed, nothing server-side can change)
  // and at most once per FOCUS_SYNC_MS.
  useEffect(() => {
    if (state !== 'ready') return
    let cancelled = false
    let lastSync = 0 // effect-local, like useStations' guard: a remount syncs afresh

    const sync = async () => {
      lastSync = Date.now()
      const sub = await currentSubscription()
      if (!sub) return
      try {
        const stations = await fetchWatches(await subIdFor(sub.endpoint))
        if (!cancelled) setWatches(stations)
      } catch {
        // keep whatever we had; the bell being briefly wrong is not worth a toast
      }
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (watchesRef.current.length === 0) return
      if (Date.now() - lastSync < FOCUS_SYNC_MS) return
      sync()
    }

    sync()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state])

  // Busy and error bookkeeping shared by arm and disarm. `action` is called
  // before this function's first await, so whatever it does first still runs
  // inside the user's tap — arm depends on that.
  const run = useCallback(async (stationId: string, action: () => Promise<void>) => {
    setBusy(stationId)
    setError(null)
    try {
      await action()
    } catch (e: unknown) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const arm = useCallback(
    (stationId: string) =>
      run(stationId, async () => {
        // Must stay the first await: iOS only accepts this inside a user gesture
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'blocked' : 'ready')
          return
        }
        const sub = await subscribeToPush()
        await armWatch(sub.toJSON() as PushSubscriptionPayload, stationId)
        setWatches((prev) => (prev.includes(stationId) ? prev : [...prev, stationId]))
      }),
    [run],
  )

  const disarm = useCallback(
    (stationId: string) =>
      run(stationId, async () => {
        const sub = await currentSubscription()
        if (sub) await disarmWatch(sub.endpoint, stationId)
        setWatches((prev) => prev.filter((id) => id !== stationId))
      }),
    [run],
  )

  const toggle = useCallback(
    (stationId: string) => (watches.includes(stationId) ? disarm(stationId) : arm(stationId)),
    [watches, arm, disarm],
  )

  return { state, watches, busy, error, toggle }
}
