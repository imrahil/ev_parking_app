// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { allStations, BUSY, FREE, jsonResponse, OFFLINE, ref } from './test/fixtures'
import type { AllStationsResponse } from './types'

// Visible by default: Parkhaus 1.OG, Weisshorn. Hidden by default: Besucherplatz, Parkhaus EG.
const board = allStations([
  [ref(1, 'Besucherplatz'), FREE],
  [ref(2, 'Parkhaus 1.OG'), FREE],
  [ref(3, 'Parkhaus 1.OG'), BUSY],
  [ref(4, 'Parkhaus EG'), BUSY],
  [ref(5, 'Weisshorn'), BUSY],
  [ref(6, 'Weisshorn'), OFFLINE],
  [ref(7), FREE],
])

function serve(payload: AllStationsResponse | (() => Response) = board) {
  const fetch = vi.fn(async () => (typeof payload === 'function' ? payload() : jsonResponse(payload)))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const cardNames = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)
const chip = (name: RegExp) => screen.getByRole('button', { name })

async function renderApp() {
  render(<App />)
  await waitFor(() => expect(cardNames().length).toBeGreaterThan(0))
}

describe('App', () => {
  it('hides Besucherplatz and Parkhaus EG by default; ungrouped stations always show', async () => {
    serve()
    await renderApp()

    expect(cardNames()).toEqual(['Live Station 2', 'Live Station 3', 'Live Station 5', 'Live Station 6', 'Live Station 7'])
    expect(screen.queryByRole('button', { name: /^Besucherplatz/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Parkhaus EG/ })).toBeNull()
  })

  it('chips count free/total over the visible stations', async () => {
    serve()
    await renderApp()

    expect(within(chip(/^All/)).getByText('2/5')).toBeTruthy()
    expect(within(chip(/^Parkhaus 1\.OG/)).getByText('1/2')).toBeTruthy()
    expect(within(chip(/^Weisshorn/)).getByText('0/2')).toBeTruthy()
  })

  it('header counts follow the active filter', async () => {
    serve()
    await renderApp()

    expect(screen.getByText('2 Free')).toBeTruthy()
    expect(screen.getByText('2 Busy')).toBeTruthy()

    fireEvent.click(chip(/^Weisshorn/))
    expect(screen.getByText('0 Free')).toBeTruthy()
    expect(screen.getByText('1 Busy')).toBeTruthy()
  })

  it('header counts are zero for a stored filter whose group no longer exists', async () => {
    localStorage.setItem('parking-app:groupFilter', 'Gone')
    serve()
    render(<App />)

    // The chips only get their stats once the board has loaded
    await waitFor(() => expect(within(chip(/^All/)).getByText('2/5')).toBeTruthy())
    expect(cardNames()).toEqual([])
    expect(screen.getByText('0 Free')).toBeTruthy()
    expect(screen.getByText('0 Busy')).toBeTruthy()
  })

  it('filters by group, toggles back to All, and remembers the filter', async () => {
    serve()
    await renderApp()

    fireEvent.click(chip(/^Weisshorn/))
    expect(cardNames()).toEqual(['Live Station 5', 'Live Station 6'])
    expect(localStorage.getItem('parking-app:groupFilter')).toBe('Weisshorn')

    fireEvent.click(chip(/^Weisshorn/))
    expect(cardNames()).toHaveLength(5)
    expect(localStorage.getItem('parking-app:groupFilter')).toBe('')
  })

  it('restores a stored filter on load', async () => {
    localStorage.setItem('parking-app:groupFilter', 'Parkhaus 1.OG')
    serve()
    await renderApp()
    expect(cardNames()).toEqual(['Live Station 2', 'Live Station 3'])
  })

  it('settings show and hide groups, and hiding the active one falls back to All', async () => {
    serve()
    await renderApp()
    fireEvent.click(chip(/^Weisshorn/))

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Weisshorn' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Besucherplatz' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cardNames()).toEqual(['Live Station 1', 'Live Station 2', 'Live Station 3', 'Live Station 7'])
    expect(JSON.parse(localStorage.getItem('parking-app:hiddenGroups')!)).toEqual(['Parkhaus EG', 'Weisshorn'])
    expect(localStorage.getItem('parking-app:groupFilter')).toBe('')
  })

  it('ignores a corrupt hidden-groups value', async () => {
    localStorage.setItem('parking-app:hiddenGroups', '{not json')
    serve()
    await renderApp()
    expect(cardNames()).not.toContain('Live Station 1')
  })

  it('shows the error banner when the worker is down, and an empty state', async () => {
    serve(() => jsonResponse({ error: 'stations.json HTTP 500' }, 502))
    render(<App />)

    expect(await screen.findByText('Failed to load station data: HTTP 502')).toBeTruthy()
    expect(screen.queryByText('No stations match the current filter.')).toBeNull()
  })

  it('shows the empty state when every group is hidden', async () => {
    localStorage.setItem('parking-app:hiddenGroups', JSON.stringify(['Besucherplatz', 'Parkhaus 1.OG', 'Parkhaus EG', 'Weisshorn']))
    serve(allStations([[ref(1, 'Weisshorn'), FREE]]))
    render(<App />)
    expect(await screen.findByText('No stations match the current filter.')).toBeTruthy()
  })

  it('"Free only" hides busy and offline cards, keeps the counts, and is remembered', async () => {
    serve()
    await renderApp()
    const toggle = screen.getByRole('switch', { name: /Free only/ })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(cardNames()).toEqual(['Live Station 2', 'Live Station 7'])
    expect(within(chip(/^All/)).getByText('2/5')).toBeTruthy()
    expect(screen.getByText('2 Busy')).toBeTruthy()
    expect(localStorage.getItem('parking-app:freeOnly')).toBe('1')

    fireEvent.click(chip(/^Weisshorn/))
    expect(cardNames()).toEqual([])
    expect(screen.getByText('No free chargers right now.')).toBeTruthy()

    fireEvent.click(toggle)
    expect(cardNames()).toEqual(['Live Station 5', 'Live Station 6'])
    expect(localStorage.getItem('parking-app:freeOnly')).toBe('0')
  })

  it('restores "Free only" on load', async () => {
    localStorage.setItem('parking-app:freeOnly', '1')
    serve()
    await renderApp()
    expect(cardNames()).toEqual(['Live Station 2', 'Live Station 7'])
  })

  it('the theme button cycles auto -> light -> dark', async () => {
    serve()
    await renderApp()
    const button = screen.getByTitle(/^Theme:/)

    expect(button.title).toMatch('Auto')
    await act(async () => fireEvent.click(button))
    expect(button.title).toMatch('Light')
    await act(async () => fireEvent.click(button))
    expect(button.title).toMatch('Dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
