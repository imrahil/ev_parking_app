import { expect, test } from '@playwright/test'
import { fakeWorker } from './helpers'

test.beforeEach(async ({ page }) => {
  await fakeWorker(page)
})

const html = (page: import('@playwright/test').Page) => page.locator('html')

test('theme: follows the system setting by default', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await expect(html(page)).toHaveClass(/dark/)

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html(page)).not.toHaveClass(/dark/)
})

test('theme: the button cycles Auto -> Light -> Dark and the choice persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('./')
  const toggle = page.getByTitle(/^Theme:/)

  await expect(toggle).toHaveAttribute('title', /Auto/)
  await toggle.click()
  await expect(toggle).toHaveAttribute('title', /Light/)
  await toggle.click()
  await expect(toggle).toHaveAttribute('title', /Dark/)
  await expect(html(page)).toHaveClass(/dark/)

  await page.reload()
  await expect(html(page)).toHaveClass(/dark/)
  await expect(toggle).toHaveAttribute('title', /Dark/)
})

test('theme: the stored choice applies before the app script runs (no flash)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('parking-app:theme', 'dark'))
  // No app bundle at all: only the inline script in index.html can act
  await page.route('**/assets/*.js', (route) => route.abort())
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('./', { waitUntil: 'domcontentloaded' })

  await expect(html(page)).toHaveClass(/dark/)
})
