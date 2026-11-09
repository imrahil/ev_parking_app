import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, armWatch, disarmWatch, fetchWatches, subIdFor } from '../api'
import { errorMessage } from '../format'
import type { PushSubscriptionPayload } from '../types'

const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''
const WATCHES_KEY = 'parking-app:watches'

// Watches only vanish server-side when the cron delivers them (every 10 min)
// or they expire, so re-syncing more often than this rarely finds a change —
// and every GET /watches spends a KV list from the worker's public daily
// budget, the same one arming needs.
export const FOCUS_SYNC_MS = 10 * 60 * 1000

export type PushState =
  | 'ready' // usable; permission may still need asking
  | 'blocked' // permission denied — only recoverable in browser settings
  | 'needs-install' // iOS: push only exists once added to the Home Screen
  | 'unsupported'
  | 'unconfigured' // direct mode, or no VAPID key baked in — feature is off

function detect(): PushState {
  if (!API_URL || !VAPID_PUBLIC_KEY) return 'unconfigured'

  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return Notification.permission === 'denied' ? 'blocked' : 'ready'
  }

  // iOS hides PushManager entirely in a Safari tab; it appears only in an
  // installed web app. Worth saying so rather than showing a dead button.
  const ios =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const installed = window.matchMedia('(display-mode: standalone)').matches
  return ios && !installed ? 'needs-install' : 'unsupported'
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function readStoredWatches(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(WATCHES_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** The SW is registered lazily — nobody who ignores notifications gets one. */
async function subscribe(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export function usePushWatch() {
  const [state, setState] = useState<PushState>(() => detect())
  const [watches, setWatches] = useState<string[]>(() => readStoredWatches())
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
        const sub = await subscribe()
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
