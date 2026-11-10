import { useCallback, useEffect, useState } from 'react'

const FILTER_KEY = 'parking-app:groupFilter'
const FREE_ONLY_KEY = 'parking-app:freeOnly'
// Groups used to be hideable in a settings dialog; drop what that left behind
const LEGACY_HIDDEN_KEY = 'parking-app:hiddenGroups'

function readStoredFilter(): string {
  return localStorage.getItem(FILTER_KEY) ?? ''
}

/**
 * Which group the board is filtered to ('' = All) and whether only free
 * stations are shown, both persisted in localStorage.
 */
export function useGroupFilter() {
  const [activeGroup, setActiveGroup] = useState<string>(() => readStoredFilter())
  const [freeOnly, setFreeOnly] = useState<boolean>(() => localStorage.getItem(FREE_ONLY_KEY) === '1')

  useEffect(() => {
    localStorage.removeItem(LEGACY_HIDDEN_KEY)
  }, [])

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, activeGroup)
  }, [activeGroup])

  useEffect(() => {
    localStorage.setItem(FREE_ONLY_KEY, freeOnly ? '1' : '0')
  }, [freeOnly])

  const showAll = useCallback(() => setActiveGroup(''), [])

  // Tapping the active chip again clears the filter
  const toggleGroup = useCallback((g: string) => setActiveGroup((prev) => (prev === g ? '' : g)), [])

  const toggleFreeOnly = useCallback(() => setFreeOnly((prev) => !prev), [])

  return { activeGroup, freeOnly, showAll, toggleGroup, toggleFreeOnly }
}
