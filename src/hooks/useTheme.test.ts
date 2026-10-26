// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTheme } from './useTheme'

const KEY = 'parking-app:theme'

/** A controllable prefers-color-scheme: dark media query. */
function stubSystemDark(initial: boolean) {
  const listeners = new Set<() => void>()
  const mq = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => mq)
  return (dark: boolean) => {
    mq.matches = dark
    listeners.forEach((fn) => fn())
  }
}

const isDark = () => document.documentElement.classList.contains('dark')

describe('useTheme', () => {
  it('defaults to auto and follows the system setting live', () => {
    const setSystemDark = stubSystemDark(false)
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('auto')
    expect(isDark()).toBe(false)
    act(() => setSystemDark(true))
    expect(isDark()).toBe(true)
  })

  it('cycles auto -> light -> dark -> auto and stores only explicit choices', () => {
    stubSystemDark(true)
    const { result } = renderHook(() => useTheme())

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('light')
    expect(localStorage.getItem(KEY)).toBe('light')
    expect(isDark()).toBe(false)

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('dark')
    expect(localStorage.getItem(KEY)).toBe('dark')
    expect(isDark()).toBe(true)

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('auto')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('an explicit choice ignores the system setting', () => {
    const setSystemDark = stubSystemDark(false)
    localStorage.setItem(KEY, 'dark')
    renderHook(() => useTheme())

    expect(isDark()).toBe(true)
    act(() => setSystemDark(false))
    expect(isDark()).toBe(true)
  })

  it('falls back to auto for a garbage stored value', () => {
    stubSystemDark(false)
    localStorage.setItem(KEY, 'sepia')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('auto')
  })

  it('keeps the theme-color meta tags in step', () => {
    stubSystemDark(false)
    document.head.innerHTML = '<meta name="theme-color" content=""><meta name="theme-color" content="">'
    localStorage.setItem(KEY, 'dark')
    renderHook(() => useTheme())

    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
    expect(metas.map((m) => m.content)).toEqual(['#081823', '#081823'])
  })
})
