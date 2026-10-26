// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StationCard, type WatchControl } from './StationCard'
import { apiStation, BUSY, connector, FREE, OFFLINE, ref, view } from '../test/fixtures'

const MIN = 60_000
const watch = (patch: Partial<WatchControl> = {}): WatchControl => ({ armed: false, busy: false, onToggle: vi.fn(), ...patch })

describe('StationCard', () => {
  it('shows the live name and description over the stations.json fallback', () => {
    const r = ref(1, 'Weisshorn', 'Fallback name')
    render(<StationCard view={view(r, apiStation(r, FREE, { Name: 'Weisshorn 1', Description: 'North side' }))} />)

    expect(screen.getByRole('heading', { name: 'Weisshorn 1' })).toBeTruthy()
    expect(screen.getByText('North side')).toBeTruthy()
    expect(screen.queryByText('Fallback name')).toBeNull()
  })

  it('falls back to the stations.json name before the first fetch', () => {
    render(<StationCard view={view(ref(1, 'A', 'Besucherparkplatz 1'), null, { loading: true, fetchedAt: null })} />)

    expect(screen.getByRole('heading', { name: 'Besucherparkplatz 1' })).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
  })

  it.each([
    [FREE, 'Free'],
    [BUSY, 'Occupied'],
    [OFFLINE, 'Unknown'],
  ])('state %i reads "%s"', (state, label) => {
    const r = ref(1)
    render(<StationCard view={view(r, apiStation(r, state))} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it.each([
    [0, 'just now'],
    [30_000, '30s ago'],
    [12 * MIN, '12m ago'],
    [3 * 60 * MIN, '3h ago'],
  ])('data %ims old reads "Updated %s"', (age, text) => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000)
    const r = ref(1)
    render(<StationCard view={view(r, apiStation(r, FREE), { fetchedAt: 1_000_000_000 - age })} />)
    expect(screen.getByText(`Updated ${text}`)).toBeTruthy()
  })

  it('shows a fetch error next to the (stale) update time', () => {
    const r = ref(1)
    render(<StationCard view={view(r, apiStation(r, FREE), { error: 'HTTP 503' })} />)
    expect(screen.getByText(/HTTP 503/)).toBeTruthy()
    expect(screen.getByText('Free')).toBeTruthy()
  })

  it('lists connectors only when there is more than one', () => {
    const r = ref(1)
    const { rerender } = render(<StationCard view={view(r, apiStation(r, FREE))} />)
    expect(screen.queryByTitle(/^Connector/)).toBeNull()

    rerender(
      <StationCard
        view={view(r, apiStation(r, BUSY, { Connectors: [connector(1, BUSY, 'A'), connector(2, FREE, 'B'), connector(3, OFFLINE, 'C')] }))}
      />,
    )
    expect(screen.getByTitle('Connector A: Occupied')).toBeTruthy()
    expect(screen.getByTitle('Connector B: Available')).toBeTruthy()
    expect(screen.getByTitle('Connector C: Unknown')).toBeTruthy()
  })

  describe('notify bell', () => {
    it('appears only on an occupied station, and only with a watch control', () => {
      const r = ref(1)
      const { rerender } = render(<StationCard view={view(r, apiStation(r, BUSY))} />)
      expect(screen.queryByRole('button')).toBeNull()

      rerender(<StationCard view={view(r, apiStation(r, FREE))} watch={watch()} />)
      expect(screen.queryByRole('button')).toBeNull()

      rerender(<StationCard view={view(r, apiStation(r, OFFLINE))} watch={watch()} />)
      expect(screen.queryByRole('button')).toBeNull()

      rerender(<StationCard view={view(r, apiStation(r, BUSY))} watch={watch()} />)
      expect(screen.getByRole('button', { name: /Notify me/ })).toBeTruthy()
    })

    it('reflects the armed state and toggles', () => {
      const r = ref(1)
      const w = watch({ armed: true })
      render(<StationCard view={view(r, apiStation(r, BUSY))} watch={w} />)

      const bell = screen.getByRole('button', { name: /Watching/ })
      expect(bell.getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(bell)
      expect(w.onToggle).toHaveBeenCalledOnce()
    })

    it('is disabled while a request is in flight', () => {
      const r = ref(1)
      render(<StationCard view={view(r, apiStation(r, BUSY))} watch={watch({ busy: true })} />)
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
