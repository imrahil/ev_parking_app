import { useEffect, useState } from 'react'

export type Theme = 'auto' | 'light' | 'dark'

const THEME_KEY = 'parking-app:theme'

function readStored(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'auto'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStored())

  useEffect(() => {
    if (theme === 'auto') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      document
        .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach((m) => (m.content = dark ? '#081823' : '#f4f5f7'))
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const cycleTheme = () =>
    setTheme((t) => (t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'))

  return { theme, cycleTheme }
}
