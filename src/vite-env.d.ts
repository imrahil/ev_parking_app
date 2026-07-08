/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Aggregated status API (Cloudflare Worker). Empty/unset = poll ecarup.com directly. */
  readonly VITE_API_URL?: string
}
