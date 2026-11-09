// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HISTORY_WINDOW_MS } from '../sparkline'
import { PowerSparkline } from './PowerSparkline'

const NOW = 100 * HISTORY_WINDOW_MS
const MIN = 60_000

describe('PowerSparkline', () => {
  it('draws the hour ticks even with no readings', () => {
    const { container } = render(<PowerSparkline now={new Date(2026, 0, 15, 12, 30).getTime()} times={[]} values={[]} />)
    expect(container.querySelectorAll('[data-hour-ticks] line')).toHaveLength(12)
  })

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
