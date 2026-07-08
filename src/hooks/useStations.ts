import { useEffect, useRef, useState } from 'react'
import { API_URL, fetchAllStations, fetchStation, loadStations } from '../api'
import type { StationRef, StationView } from '../types'

export function useStations(refreshMs: number) {
  const [refs, setRefs] = useState<StationRef[]>([])
  const [refsError, setRefsError] = useState<string | null>(null)
  const [views, setViews] = useState<Record<string, StationView>>({})
  const [lastTick, setLastTick] = useState<number>(Date.now())
  const refreshFnRef = useRef<() => void>(() => {})

  // Direct mode only: the station list comes from stations.json.
  // In API mode the list arrives with every /stations response instead.
  useEffect(() => {
    if (API_URL) return
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
    if (!API_URL && refs.length === 0) return

    const ac = new AbortController()
    // Effect-local so a StrictMode remount (which aborts this effect's fetch)
    // can't block the next mount's first refresh
    let refreshing = false

    // One request to the worker for all stations. fetchedAt reflects when the
    // worker last polled ecarup, so "Updated X ago" shows the real data age.
    const refreshFromApi = async () => {
      const all = await fetchAllStations(ac.signal)
      setRefs((prev) => {
        const next = all.stations.map((s) => s.ref)
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
      })
      setViews(
        Object.fromEntries(
          all.stations.map((s) => [
            s.ref.id,
            {
              ref: s.ref,
              loading: false,
              error: s.error ?? null,
              data: s.data,
              fetchedAt: all.updatedAt,
            },
          ]),
        ),
      )
      setRefsError(null)
    }

    const refreshDirect = async () => {
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
    }

    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        if (API_URL) await refreshFromApi()
        else await refreshDirect()
        setLastTick(Date.now())
      } catch (e: unknown) {
        // API mode only; stale views are kept so the board stays usable
        if (!ac.signal.aborted) setRefsError(e instanceof Error ? e.message : String(e))
      } finally {
        refreshing = false
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
