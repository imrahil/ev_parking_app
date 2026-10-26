import { expect, test } from '@playwright/test'
import { card, fakePush, fakeWorker, uuid } from './helpers'

test('notify: the bell appears only on occupied chargers', async ({ page }) => {
  await fakePush(page)
  await fakeWorker(page)
  await page.goto('./')

  await expect(card(page, 'Weisshorn 1').getByRole('button', { name: /Notify me/ })).toBeVisible()
  await expect(card(page, 'Parkhaus 1.OG 02').getByRole('button', { name: /Notify me/ })).toBeVisible()
  await expect(card(page, 'Parkhaus 1.OG 01').getByRole('button')).toHaveCount(0)
})

test('notify: arming and disarming a watch goes through the worker', async ({ page }) => {
  await fakePush(page)
  const worker = await fakeWorker(page)
  await page.goto('./')
  const bell = card(page, 'Weisshorn 1').getByRole('button')

  await bell.click()
  await expect(bell).toHaveText(/Watching/)
  await expect(bell).toHaveAttribute('aria-pressed', 'true')
  const post = worker.requests.find((r) => r.method === 'POST')
  expect(post).toMatchObject({
    path: '/watch',
    body: { stationId: uuid(5), subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device' } },
  })

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('1 charger being watched')).toBeVisible()
  await page.keyboard.press('Escape')

  await bell.click()
  await expect(bell).toHaveText(/Notify me/)
  expect(worker.requests.find((r) => r.method === 'DELETE')).toMatchObject({
    path: '/watch',
    body: { stationId: uuid(5), endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device' },
  })
})

test('notify: an armed watch is still shown after a reload', async ({ page }) => {
  await fakePush(page)
  await fakeWorker(page)
  await page.goto('./')
  await card(page, 'Weisshorn 1').getByRole('button').click()
  await expect(card(page, 'Weisshorn 1').getByRole('button')).toHaveText(/Watching/)

  await page.reload()
  await expect(card(page, 'Weisshorn 1').getByRole('button')).toHaveText(/Watching/)
})

test('notify: denying permission removes the bells and explains how to undo it', async ({ page }) => {
  await fakePush(page, 'denied')
  const worker = await fakeWorker(page)
  await page.goto('./')

  await card(page, 'Weisshorn 1').getByRole('button').click()

  await expect(page.getByRole('button', { name: /Notify me/ })).toHaveCount(0)
  expect(worker.requests.some((r) => r.method === 'POST')).toBe(false)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText(/Notifications are blocked/)).toBeVisible()
})
