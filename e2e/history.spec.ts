import { expect, test } from '@playwright/test'
import { card, cardNames, CHARGING_KW, fakeWorker } from './helpers'

const chart = (page: Parameters<typeof card>[0], name: string) => card(page, name).getByRole('img')

test('history: an occupied charger charts its power and shades the plugged-in time', async ({ page }) => {
  await fakeWorker(page)
  await page.goto('./')

  const busy = card(page, 'Weisshorn 1')
  await expect(busy).toContainText(`Peak ${CHARGING_KW} kW`)
  await expect(busy).toContainText('Plugged in')
  await expect(chart(page, 'Weisshorn 1')).toHaveAccessibleName(
    `Charging power, last 12 hours, peak ${CHARGING_KW} kW; shaded while a car was plugged in`,
  )
  // One shaded band for the single unbroken plugged-in run
  await expect(chart(page, 'Weisshorn 1').locator('rect')).toHaveCount(1)
})

test('history: a charger nobody used says so and has no shading', async ({ page }) => {
  await fakeWorker(page)
  await page.goto('./')

  const free = card(page, 'Parkhaus 1.OG 01')
  await expect(free).toContainText('No charging')
  await expect(free).not.toContainText('Plugged in')
  await expect(chart(page, 'Parkhaus 1.OG 01')).toHaveAccessibleName('No charging in the last 12 hours')
  await expect(chart(page, 'Parkhaus 1.OG 01').locator('rect')).toHaveCount(0)
})

test('history: every chart has a tick per clock hour', async ({ page }) => {
  await fakeWorker(page)
  await page.goto('./')

  // 12 full hours fit in the window, 13 when the test runs exactly on the hour
  const ticks = chart(page, 'Weisshorn 1').locator('[data-hour-ticks] line')
  await expect.poll(() => ticks.count()).toBeGreaterThanOrEqual(12)
  expect(await ticks.count()).toBeLessThanOrEqual(13)
})

test('history: the board works without it, just with no charts', async ({ page }) => {
  await fakeWorker(page, undefined, { history: null })
  await page.goto('./')

  await expect.poll(() => cardNames(page)).toHaveLength(6)
  await expect(card(page, 'Weisshorn 1')).toContainText('Occupied')
  await expect(page.locator('main').getByRole('img')).toHaveCount(0)
})
