import { useCallback, useEffect, useState } from 'react'
import { readStringArray } from '../storage'

const FILTER_KEY = 'parking-app:groupFilter'
const HIDDEN_KEY = 'parking-app:hiddenGroups'
const DEFAULT_HIDDEN = ['Besucherplatz', 'Parkhaus EG']

function readStoredFilter(): string {
  return localStorage.getItem(FILTER_KEY) ?? ''
}

/**
 * Which group the board is filtered to ('' = All) and which groups are hidden
 * in settings, both persisted in localStorage.
 */
export function useGroupFilter() {
  const [activeGroup, setActiveGroup] = useState<string>(() => readStoredFilter())
  const [hiddenGroups, setHiddenGroups] = useState<string[]>(() => readStringArray(HIDDEN_KEY, DEFAULT_HIDDEN))

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, activeGroup)
  }, [activeGroup])

  useEffect(() => {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenGroups))
  }, [hiddenGroups])

  // If the currently filtered group gets hidden, fall back to "All"
  useEffect(() => {
    if (activeGroup && hiddenGroups.includes(activeGroup)) setActiveGroup('')
  }, [hiddenGroups, activeGroup])

  const showAll = useCallback(() => setActiveGroup(''), [])

  // Tapping the active chip again clears the filter
  const toggleGroup = useCallback((g: string) => setActiveGroup((prev) => (prev === g ? '' : g)), [])

  const toggleHidden = useCallback(
    (g: string) =>
      setHiddenGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g])),
    [],
  )

  return { activeGroup, hiddenGroups, showAll, toggleGroup, toggleHidden }
}
