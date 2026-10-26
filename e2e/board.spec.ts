import { expect, test } from '@playwright/test'
import { BUSY, card, cardNames, chip, fakeWorker, station } from './helpers'

test.beforeEach(async ({ page }) => {
  await fakeWorker(page, undefined, { updatedAt: Date.now() - 5 * 60_000 })
})

test('board: a fresh visit shows the default groups with live names and status', async ({ page }) => {
  await page.goto('./')

  await expect(page).toHaveTitle('Pilatus EV Chargers')
  await expect.poll(() => cardNames(page)).toEqual(['Parkhaus 1.OG 01', 'Parkhaus 1.OG 02', 'Weisshorn 1', 'Aletschhorn 1'])
  await expect(card(page, 'Parkhaus 1.OG 01')).toContainText('Free')
  await expect(card(page, 'Parkhaus 1.OG 02')).toContainText('Occupied')
  // The age is the worker's updatedAt, not when the browser fetched it
  await expect(card(page, 'Weisshorn 1')).toContainText('Updated 5m ago')
})

test('board: chips show free/total per group, and All covers the visible ones', async ({ page }) => {
  await page.goto('./')

  await expect(chip(page, 'All')).toContainText('2/4')
  await expect(chip(page, 'Parkhaus 1.OG')).toContainText('1/2')
  await expect(chip(page, 'Weisshorn')).toContainText('0/1')
  await expect(chip(page, 'Besucherplatz')).toHaveCount(0)
})

test('board: filtering by group survives a reload', async ({ page }) => {
  await page.goto('./')

  await chip(page, 'Weisshorn').click()
  await expect.poll(() => cardNames(page)).toEqual(['Weisshorn 1'])

  await page.reload()
  await expect.poll(() => cardNames(page)).toEqual(['Weisshorn 1'])

  await chip(page, 'All').click()
  await expect.poll(() => cardNames(page)).toHaveLength(4)
})

test('settings: showing and hiding groups is remembered', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Settings' }).click()

  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('checkbox', { name: 'Besucherplatz' })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Besucherplatz' }).check()
  await dialog.getByRole('checkbox', { name: 'Weisshorn' }).uncheck()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  const expected = ['Besucherparkplatz 1', 'Parkhaus 1.OG 01', 'Parkhaus 1.OG 02', 'Aletschhorn 1']
  await expect.poll(() => cardNames(page)).toEqual(expected)
  await page.reload()
  await expect.poll(() => cardNames(page)).toEqual(expected)
})

test('settings: hiding the group being filtered falls back to All', async ({ page }) => {
  await page.goto('./')
  await chip(page, 'Aletschhorn').click()
  await expect.poll(() => cardNames(page)).toEqual(['Aletschhorn 1'])

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('checkbox', { name: 'Aletschhorn' }).uncheck()
  await page.getByRole('button', { name: 'Close' }).click()

  await expect.poll(() => cardNames(page)).toEqual(['Parkhaus 1.OG 01', 'Parkhaus 1.OG 02', 'Weisshorn 1'])
})

test('board: a station with several connectors lists them', async ({ page }) => {
  const multi = station(7, 'Weisshorn', BUSY, 'Weisshorn 2')
  multi.data.Connectors = [
    { Id: 1, Name: 'A', State: BUSY, ActivePower: 7, MaxPower: 11 },
    { Id: 2, Name: 'B', State: 1, ActivePower: 0, MaxPower: 11 },
  ]
  await fakeWorker(page, [multi])
  await page.goto('./')

  await expect(card(page, 'Weisshorn 2').getByTitle('Connector A: Occupied')).toBeVisible()
  await expect(card(page, 'Weisshorn 2').getByTitle('Connector B: Available')).toBeVisible()
})
