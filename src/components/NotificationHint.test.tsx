// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NotificationHint } from './NotificationHint'

describe('NotificationHint', () => {
  it.each([
    ['ready', /Tap the bell/],
    ['blocked', /Notifications are blocked/],
    ['needs-install', /Add to Home Screen/],
    ['unsupported', /does not support web notifications/],
  ] as const)('explains the %s push state', (state, text) => {
    render(<NotificationHint state={state} />)
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('renders nothing when the feature is off', () => {
    const { container } = render(<NotificationHint state="unconfigured" />)
    expect(container.innerHTML).toBe('')
  })
})
