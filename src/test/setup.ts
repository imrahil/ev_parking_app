import { afterEach, vi } from 'vitest'

// No vitest globals, so Testing Library can't register its own cleanup.
// Node-environment files never import it, so load it lazily.
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
    localStorage.clear()
    document.documentElement.className = ''
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
