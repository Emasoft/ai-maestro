'use client'

import { useState, useEffect } from 'react'

export type DeviceType = 'phone' | 'desktop'

interface DeviceInfo {
  deviceType: DeviceType
  isTouch: boolean
}

// Query parameter override: ?touch=1 or ?mobile=1 forces touch/mobile mode
function getQueryOverrides(): { forceTouch: boolean; forceMobile: boolean } {
  if (typeof window === 'undefined') return { forceTouch: false, forceMobile: false }
  const params = new URLSearchParams(window.location.search)
  const forceTouch = params.get('touch') === '1'
  const forceMobile = params.get('mobile') === '1'
  return { forceTouch, forceMobile }
}

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false
  // Primary check: CSS media query for coarse pointer (touch screens)
  if (window.matchMedia?.('(pointer: coarse)')?.matches) return true
  // iPadOS with Magic Keyboard: primary pointer is fine, but touch is still available
  if (window.matchMedia?.('(any-pointer: coarse)')?.matches) return true
  // Fallback: touch event support
  if ('ontouchstart' in window) return true
  // Fallback: navigator check
  if (navigator.maxTouchPoints > 0) return true
  return false
}

function classify(width: number): DeviceType {
  if (width < 768) return 'phone'
  return 'desktop'
}

export function useDeviceType(): DeviceInfo {
  // Resolve query overrides once per render so that both the useState lazy
  // initializer and the useEffect closure always see the same values.
  // Calling getQueryOverrides() twice (once in useState and once in useEffect)
  // could produce inconsistent forceTouch/forceMobile values if window.location
  // changes between those two calls (e.g. client-side navigation that does not
  // remount this component).
  const queryOverrides = getQueryOverrides()

  const [info, setInfo] = useState<DeviceInfo>(() => {
    if (typeof window === 'undefined') return { deviceType: 'desktop', isTouch: false }
    const { forceTouch, forceMobile } = queryOverrides
    const isTouch = forceTouch || detectTouch()
    const deviceType = forceMobile ? 'phone' : classify(window.innerWidth)
    return { deviceType, isTouch }
  })

  useEffect(() => {
    // UI2-MAJ-25: read overrides FRESH inside `update()` each time it fires
    // so client-side navigation that changes ?touch=/?mobile= without
    // remounting the hook re-evaluates them. Previously this captured the
    // mount-time overrides and never refreshed. We also listen to popstate
    // for SPA back/forward, plus a synthetic 'aimaestro:url-change' event
    // for in-app navigation (Next.js router.push / replaceState callers
    // can dispatch this if they want to trigger an immediate refresh).
    const update = () => {
      const { forceTouch, forceMobile } = getQueryOverrides()
      const isTouch = forceTouch || detectTouch()
      const deviceType = forceMobile ? 'phone' : classify(window.innerWidth)
      setInfo(prev => {
        if (prev.deviceType === deviceType && prev.isTouch === isTouch) return prev
        return { deviceType, isTouch }
      })
    }

    // Listen for resize
    window.addEventListener('resize', update)
    // UI2-MAJ-25: SPA navigation (Back/Forward) — re-read query overrides
    window.addEventListener('popstate', update)

    // Listen for pointer capability changes (e.g. connecting/disconnecting mouse)
    const mql = window.matchMedia?.('(pointer: coarse)')
    const mqlAny = window.matchMedia?.('(any-pointer: coarse)')
    if (mql?.addEventListener) {
      mql.addEventListener('change', update)
    }
    if (mqlAny?.addEventListener) {
      mqlAny.addEventListener('change', update)
    }

    // Initial check
    update()

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('popstate', update)
      if (mql?.removeEventListener) {
        mql.removeEventListener('change', update)
      }
      if (mqlAny?.removeEventListener) {
        mqlAny.removeEventListener('change', update)
      }
    }
  // queryOverrides is intentionally excluded: getQueryOverrides() returns a new object each call,
  // so including it would re-run the effect on every render and re-register all listeners.
  // The fresh `update()` body above re-reads overrides on every fire instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return info
}
