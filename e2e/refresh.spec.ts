import { expect, test } from '@playwright/test'
import { BOARD, BUSY, card, fakeWorker, FREE, station } from './helpers'

test('refresh: one request per refresh, then one per minute', async ({ page }) => {
  await page.clock.install()
  const worker = await fakeWorker(page)
  await page.goto('./')
  await expect(card(page, 'Weisshorn 1')).toContainText('Occupied')
  expect(worker.stationRequests()).toHaveLength(1)

  worker.setBoard(BOARD.map((s) => (s.data.Name === 'Weisshorn 1' ? station(5, 'Weisshorn', FREE, 'Weisshorn 1') : s)))
  await page.clock.fastForward(59_000)
  expect(worker.stationRequests()).toHaveLength(1)
  await page.clock.fastForward(1_000)

  await expect(card(page, 'Weisshorn 1')).toContainText('Free')
  expect(worker.stationRequests()).toHaveLength(2)
})

test('refresh: coming back to the app fetches immediately', async ({ page }) => {
  const worker = await fakeWorker(page)
  await page.goto('./')
  await expect(card(page, 'Parkhaus 1.OG 01')).toContainText('Free')

  worker.setBoard([station(2, 'Parkhaus 1.OG', BUSY, 'Parkhaus 1.OG 01')])
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

  await expect(card(page, 'Parkhaus 1.OG 01')).toContainText('Occupied')
})

test('refresh: a worker outage shows a banner but keeps the last board', async ({ page }) => {
  const worker = await fakeWorker(page)
  await page.goto('./')
  await expect(card(page, 'Weisshorn 1')).toBeVisible()

  worker.setBoard(null)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Failed to load station data: HTTP 502')).toBeVisible()
  await expect(card(page, 'Weisshorn 1')).toContainText('Occupied')

  worker.setBoard(BOARD)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText(/Failed to load station data/)).toBeHidden()
})

test('refresh: an outage on first load explains itself', async ({ page }) => {
  const worker = await fakeWorker(page)
  worker.setBoard(null)
  await page.goto('./')

  await expect(page.getByText('Failed to load station data: HTTP 502')).toBeVisible()
})

test('refresh: a station ecarup could not answer for shows its error', async ({ page }) => {
  await fakeWorker(page, [{ ref: station(5, 'Weisshorn', FREE).ref, data: null, error: 'HTTP 503' } as never])
  await page.goto('./')

  const c = card(page, 'Fallback 5')
  await expect(c).toContainText('Unknown')
  await expect(c).toContainText('HTTP 503')
})
