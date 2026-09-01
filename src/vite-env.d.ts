/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Aggregated status API (Cloudflare Worker). Empty/unset = poll ecarup.com directly. */
  readonly VITE_API_URL?: string
  /** VAPID public key for Web Push. Empty/unset = notifications disabled. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}
