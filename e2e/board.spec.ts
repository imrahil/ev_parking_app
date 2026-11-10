import { expect, test } from '@playwright/test'
import { BOARD, BUSY, card, cardNames, chip, fakeWorker, station } from './helpers'

test.beforeEach(async ({ page }) => {
  await fakeWorker(page, undefined, { updatedAt: Date.now() - 5 * 60_000 })
})

test('board: a fresh visit shows every group with live names and status', async ({ page }) => {
  await page.goto('./')

  await expect(page).toHaveTitle('Pilatus EV Chargers')
  await expect.poll(() => cardNames(page)).toEqual(BOARD.map((s) => s.data.Name))
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0)
  await expect(card(page, 'Parkhaus 1.OG 01')).toContainText('Free')
  await expect(card(page, 'Parkhaus 1.OG 02')).toContainText('Occupied')
  // The age is the worker's updatedAt, not when the browser fetched it
  await expect(card(page, 'Weisshorn 1')).toContainText('Updated 5m ago')
})

test('board: chips show free/total per group, and All covers every station', async ({ page }) => {
  await page.goto('./')

  await expect(chip(page, 'All')).toContainText('3/6')
  await expect(chip(page, 'Besucherplatz')).toContainText('1/1')
  await expect(chip(page, 'Parkhaus 1.OG')).toContainText('1/2')
  await expect(chip(page, 'Parkhaus EG')).toContainText('0/1')
  await expect(chip(page, 'Weisshorn')).toContainText('0/1')
})

test('board: filtering by group survives a reload', async ({ page }) => {
  await page.goto('./')

  await chip(page, 'Weisshorn').click()
  await expect.poll(() => cardNames(page)).toEqual(['Weisshorn 1'])

  await page.reload()
  await expect.poll(() => cardNames(page)).toEqual(['Weisshorn 1'])

  await chip(page, 'All').click()
  await expect.poll(() => cardNames(page)).toHaveLength(6)
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

test('board: "Free only" shows just the free chargers and survives a reload', async ({ page }) => {
  await page.goto('./')
  const toggle = page.getByRole('switch', { name: 'Free only' })

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => cardNames(page)).toEqual(['Besucherparkplatz 1', 'Parkhaus 1.OG 01', 'Aletschhorn 1'])
  // The chips still count the whole board
  await expect(chip(page, 'All')).toContainText('3/6')

  await page.reload()
  await expect.poll(() => cardNames(page)).toEqual(['Besucherparkplatz 1', 'Parkhaus 1.OG 01', 'Aletschhorn 1'])

  await chip(page, 'Weisshorn').click()
  await expect(page.getByText('No free chargers right now.')).toBeVisible()

  await page.getByRole('switch', { name: 'Free only' }).click()
  await expect.poll(() => cardNames(page)).toEqual(['Weisshorn 1'])
})
