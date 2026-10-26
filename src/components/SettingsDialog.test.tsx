// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'
import type { PushState } from '../hooks/usePushWatch'

function setup(patch: Partial<Parameters<typeof SettingsDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    groups: ['Parkhaus EG', 'Weisshorn'],
    hidden: ['Weisshorn'],
    onToggle: vi.fn(),
    pushState: 'ready' as PushState,
    watchCount: 0,
    pushError: null,
    ...patch,
  }
  render(<SettingsDialog {...props} />)
  return props
}

describe('SettingsDialog', () => {
  it('renders nothing while closed', () => {
    setup({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('checks visible groups and reports toggles', () => {
    const props = setup()

    const eg = screen.getByRole('checkbox', { name: 'Parkhaus EG' }) as HTMLInputElement
    const weisshorn = screen.getByRole('checkbox', { name: 'Weisshorn' }) as HTMLInputElement
    expect(eg.checked).toBe(true)
    expect(weisshorn.checked).toBe(false)

    fireEvent.click(weisshorn)
    expect(props.onToggle).toHaveBeenCalledWith('Weisshorn')
  })

  it('closes on Escape, the close button and the backdrop, not on the panel', () => {
    const props = setup()

    fireEvent.click(screen.getByText('Visible stations'))
    expect(props.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(props.onClose).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['ready', /Tap the bell/],
    ['blocked', /Notifications are blocked/],
    ['needs-install', /Add to Home Screen/],
    ['unsupported', /does not support web notifications/],
  ] as const)('explains the %s push state', (pushState, text) => {
    setup({ pushState })
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('hides the notifications section when the feature is off', () => {
    setup({ pushState: 'unconfigured' })
    expect(screen.queryByText('Notifications')).toBeNull()
  })

  it('counts watches and shows push errors', () => {
    setup({ watchCount: 1, pushError: 'Too many watches' })
    expect(screen.getByText('1 charger being watched')).toBeTruthy()
    expect(screen.getByText(/Too many watches/)).toBeTruthy()
  })
})
