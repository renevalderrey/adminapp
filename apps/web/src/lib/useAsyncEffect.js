import { useEffect, useRef, useCallback } from 'react'

export function useIsMounted() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return useCallback(() => mounted.current, [])
}

export function useAsyncEffect(fn, deps = []) {
  useEffect(() => {
    const ctrl = new AbortController()
    fn(ctrl.signal)
    return () => ctrl.abort()
  }, deps)
}
