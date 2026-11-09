import { describe, expect, it } from 'vitest'
import { errorMessage, formatPower, timeAgo } from './format'

describe('formatPower', () => {
  it('shows kW with at most one decimal', () => {
    expect(formatPower(7.4)).toBe('7.4 kW')
    expect(formatPower(11)).toBe('11 kW')
    expect(formatPower(3.649)).toBe('3.6 kW')
  })
})

describe('timeAgo', () => {
  const NOW = 1_800_000_000_000
  const ago = (seconds: number) => timeAgo(NOW - seconds * 1000, NOW)

  it('steps from seconds to minutes to hours', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(4)).toBe('just now')
    expect(ago(5)).toBe('5s ago')
    expect(ago(59)).toBe('59s ago')
    expect(ago(60)).toBe('1m ago')
    expect(ago(59 * 60 + 59)).toBe('59m ago')
    expect(ago(60 * 60)).toBe('1h ago')
    expect(ago(30 * 60 * 60)).toBe('30h ago')
  })

  it('shows a dash when nothing was fetched yet', () => {
    expect(timeAgo(null, NOW)).toBe('—')
  })
})

describe('errorMessage', () => {
  it('takes the message of an Error and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(503)).toBe('503')
  })
})
