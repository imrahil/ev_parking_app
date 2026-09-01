import { useCallback, useEffect, useState } from 'react'
import { API_URL, armWatch, disarmWatch, fetchWatches, subIdFor } from '../api'
import type { PushSubscriptionPayload } from '../types'

const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''
const WATCHES_KEY = 'parking-app:watches'

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

  useEffect(() => {
    localStorage.setItem(WATCHES_KEY, JSON.stringify(watches))
  }, [watches])

  // The server is the source of truth: watches are one-shot and expire after
  // 8h, so localStorage goes stale on its own. Re-sync on load and whenever
  // the app comes back into view (same trigger the board refresh uses).
  useEffect(() => {
    if (state !== 'ready') return
    let cancelled = false

    const sync = async () => {
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
      if (document.visibilityState === 'visible') sync()
    }

    sync()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state])

  const arm = useCallback(async (stationId: string) => {
    setBusy(stationId)
    setError(null)
    try {
      // Must stay the first await: iOS only accepts this inside a user gesture
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'ready')
        return
      }
      const sub = await subscribe()
      await armWatch(sub.toJSON() as PushSubscriptionPayload, stationId)
      setWatches((prev) => (prev.includes(stationId) ? prev : [...prev, stationId]))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const disarm = useCallback(async (stationId: string) => {
    setBusy(stationId)
    setError(null)
    try {
      const sub = await currentSubscription()
      if (sub) await disarmWatch(sub.endpoint, stationId)
      setWatches((prev) => prev.filter((id) => id !== stationId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const toggle = useCallback(
    (stationId: string) => (watches.includes(stationId) ? disarm(stationId) : arm(stationId)),
    [watches, arm, disarm],
  )

  return { state, watches, busy, error, toggle }
}
