// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HISTORY_WINDOW_MS, occupiedSpans, PowerSparkline, sparklineSegments } from './PowerSparkline'

const NOW = 100 * HISTORY_WINDOW_MS
const MIN = 60_000

describe('sparklineSegments', () => {
  it('maps the window to x 0..100 and kW to y, 0 kW at the bottom', () => {
    // 6 h apart, so they are separate runs; one point each
    const [a, b] = sparklineSegments([NOW - HISTORY_WINDOW_MS / 2, NOW], [0, 10], NOW, 10)
    expect(a[0]).toEqual({ x: 50, y: 24 })
    expect(b[0]).toEqual({ x: 100, y: 0 })
  })

  it('breaks the line at null readings', () => {
    const runs = sparklineSegments([NOW - 30 * MIN, NOW - 20 * MIN, NOW - 10 * MIN], [5, null, 5], NOW, 10)
    expect(runs).toHaveLength(2)
  })

  it('breaks the line across a gap longer than the sampling interval', () => {
    const runs = sparklineSegments([NOW - 5 * 60 * MIN, NOW - 10 * MIN], [5, 5], NOW, 10)
    expect(runs).toHaveLength(2)
  })

  it('ignores samples older than 12 h', () => {
    expect(sparklineSegments([NOW - HISTORY_WINDOW_MS - MIN], [5], NOW, 10)).toEqual([])
  })
})

describe('occupiedSpans', () => {
  const at = (...mins: number[]) => mins.map((m) => NOW - m * MIN)

  it('merges consecutive plugged-in samples into one span', () => {
    const spans = occupiedSpans(at(40, 30, 20, 10), [1, 1, 1, 0], NOW)
    expect(spans).toHaveLength(1)
    expect(spans[0].x0).toBeCloseTo(((HISTORY_WINDOW_MS - 40 * MIN) / HISTORY_WINDOW_MS) * 100)
    expect(spans[0].x1).toBeCloseTo(((HISTORY_WINDOW_MS - 20 * MIN) / HISTORY_WINDOW_MS) * 100)
  })

  it('splits at a free sample, a failed fetch and a long gap', () => {
    expect(occupiedSpans(at(50, 40, 30, 20), [1, 0, 1, 1], NOW)).toHaveLength(2)
    expect(occupiedSpans(at(50, 40, 30, 20), [1, null, 1, 1], NOW)).toHaveLength(2)
    expect(occupiedSpans(at(300, 10), [1, 1], NOW)).toHaveLength(2)
  })

  it('gives a single sample a visible width, and ignores old ones', () => {
    const [s] = occupiedSpans(at(10), [1], NOW)
    expect(s.x1 - s.x0).toBeGreaterThan(0)
    expect(occupiedSpans([NOW - HISTORY_WINDOW_MS - MIN], [1], NOW)).toEqual([])
  })

  it('is empty without occupancy data (history from before it was recorded)', () => {
    expect(occupiedSpans(at(10, 20), [], NOW)).toEqual([])
  })
})

describe('PowerSparkline', () => {
  it('shades plugged-in periods and says so in the legend', () => {
    const { container } = render(
      <PowerSparkline now={NOW} times={[NOW - 20 * MIN, NOW - 10 * MIN]} values={[0, 0]} occupied={[1, 1]} />,
    )
    expect(screen.getByText('Plugged in')).toBeTruthy()
    expect(container.querySelectorAll('rect')).toHaveLength(1)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('plugged in')
  })

  it('shows no legend or band when nobody was plugged in', () => {
    const { container } = render(<PowerSparkline now={NOW} times={[NOW - 10 * MIN]} values={[0]} occupied={[0]} />)
    expect(screen.queryByText('Plugged in')).toBeNull()
    expect(container.querySelectorAll('rect')).toHaveLength(0)
  })

  it('labels the peak', () => {
    render(<PowerSparkline now={NOW} times={[NOW - 20 * MIN, NOW - 10 * MIN]} values={[3.6, 7.4]} />)
    expect(screen.getByText('Peak 7.4 kW')).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('peak 7.4 kW')
  })

  it('says so when nothing charged, and still renders', () => {
    render(<PowerSparkline now={NOW} times={[NOW - 10 * MIN]} values={[0]} />)
    expect(screen.getByText('No charging')).toBeTruthy()
    expect(screen.getByRole('img')).toBeTruthy()
  })

  it('renders an empty chart for a station with no readings', () => {
    render(<PowerSparkline now={NOW} times={[]} values={[]} />)
    expect(screen.getByText('No charging')).toBeTruthy()
  })
})
