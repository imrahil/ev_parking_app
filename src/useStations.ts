import { useEffect, useRef, useState } from 'react'
import { fetchStation, loadStations } from './api'
import type { StationRef, StationView } from './types'

export function useStations(refreshMs: number) {
  const [refs, setRefs] = useState<StationRef[]>([])
  const [refsError, setRefsError] = useState<string | null>(null)
  const [views, setViews] = useState<Record<string, StationView>>({})
  const [lastTick, setLastTick] = useState<number>(Date.now())
  const refreshingRef = useRef(false)
  const refreshFnRef = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false

    loadStations()
      .then((list) => {
        if (cancelled) return
        setRefs(list)
        setViews(
          Object.fromEntries(
            list.map((r) => [
              r.id,
              { ref: r, loading: true, error: null, data: null, fetchedAt: null },
            ]),
          ),
        )
      })
      .catch((e: unknown) => !cancelled && setRefsError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (refs.length === 0) return

    const ac = new AbortController()

    const refresh = async () => {
      if (refreshingRef.current) return
      refreshingRef.current = true
      try {
        await Promise.all(
          refs.map(async (ref) => {
            try {
              const data = await fetchStation(ref.id, ac.signal)
              setViews((prev) => ({
                ...prev,
                [ref.id]: { ref, loading: false, error: null, data, fetchedAt: Date.now() },
              }))
            } catch (e: unknown) {
              if (ac.signal.aborted) return
              setViews((prev) => ({
                ...prev,
                [ref.id]: {
                  ref,
                  loading: false,
                  error: e instanceof Error ? e.message : String(e),
                  data: prev[ref.id]?.data ?? null,
                  fetchedAt: prev[ref.id]?.fetchedAt ?? null,
                },
              }))
            }
          }),
        )
        setLastTick(Date.now())
      } finally {
        refreshingRef.current = false
      }
    }

    refreshFnRef.current = refresh
    refresh()
    const id = setInterval(refresh, refreshMs)

    return () => {
      clearInterval(id)
      ac.abort()
    }
  }, [refs, refreshMs])

  const refreshNow = () => refreshFnRef.current()

  return { refs, refsError, views, lastTick, refreshNow }
}
