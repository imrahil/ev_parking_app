import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: the production build on a phone-sized Chromium.
 *
 *   npm run e2e
 *
 * The worker is NOT started: its data comes from live ecarup.com, which no
 * test can pin down. Instead the app is built against a fake worker origin
 * that every test answers with `page.route` (e2e/helpers.ts). The real
 * worker <-> client contract is covered by src/worker.test.ts.
 */
export const WORKER = 'https://worker.e2e'
const APP = 'http://localhost:4173'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: APP,
    // sw.js only receives pushes; the tests fake the push stack instead
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    url: APP,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { VITE_API_URL: `${WORKER}/stations` },
  },
})
