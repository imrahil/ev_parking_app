// The browser side of Web Push: capability detection and the service-worker
// subscription. No React here — the state lives in hooks/usePushWatch.ts.
import { API_URL } from './api'
import type { PushState } from './types'

const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

/** What this browser can do about push, decided once on load. */
export function detectPushState(): PushState {
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

/** The SW is registered lazily — nobody who ignores notifications gets one. */
export async function subscribeToPush(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })
}

/** The existing subscription, if any — never registers the SW or prompts. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}
