import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// NT-039: services/shared-state.ts and services/shared-state-bridge.mjs both initialize
// `globalThis._sharedState` with an `if (!globalThis._sharedState)` guard. In FULL mode the
// BRIDGE loads first (server.mjs imports it before any route module), so a key the bridge's
// initializer lacks is a key the whole process lacks — unless the TS side back-fills it.
//
// Measured 2026-08-19: `injectedPrompts` was added to shared-state.ts on 2026-08-06 without a
// bridge slot or a back-fill, and every `sendAgentSessionCommand` (USER inject, agent self-inject,
// prompt answers) threw `Cannot read properties of undefined (reading 'set')` for 13 days.
// This test loads the two files in the PRODUCTION order and asserts that every export the TS
// module hands out is a live container — so the next new key cannot repeat the failure silently.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharedGlobal = typeof globalThis & { _sharedState?: any }

let saved: unknown

beforeEach(() => {
  saved = (globalThis as SharedGlobal)._sharedState
  delete (globalThis as SharedGlobal)._sharedState
  vi.resetModules()
})

afterEach(() => {
  ;(globalThis as SharedGlobal)._sharedState = saved
  vi.resetModules()
})

describe('shared-state: the bridge-first load order (FULL mode)', () => {
  it('every container shared-state.ts exports is a live Map/Set even when the bridge initialized _sharedState first', async () => {
    // 1. the bridge initializes the global (what server.mjs does at boot)
    await import('@/services/shared-state-bridge.mjs')
    const g = (globalThis as SharedGlobal)._sharedState!
    expect(g).toBeDefined()
    // 2. the TS module loads second (what the first route import does) and must back-fill
    const ts = await import('@/services/shared-state')
    expect(ts.sessionActivity).toBeInstanceOf(Map)
    expect(ts.injectedPrompts).toBeInstanceOf(Map)
    expect(ts.terminalSessions).toBeInstanceOf(Map)
    expect(ts.statusSubscribers).toBeInstanceOf(Set)
    expect(ts.companionClients).toBeInstanceOf(Map)
    expect(ts.panelClients).toBeInstanceOf(Map)
    expect(ts.panelFeedback).toBeInstanceOf(Map)
    // and they are the SAME objects the bridge holds — one process, one state
    expect(ts.sessionActivity).toBe(g.sessionActivity)
    expect(ts.injectedPrompts).toBe(g.injectedPrompts)
  })

  it('the bridge does not rely on the TS back-fill either: a bridge-only process has injectedPrompts', async () => {
    await import('@/services/shared-state-bridge.mjs')
    const g = (globalThis as SharedGlobal)._sharedState!
    expect(g.injectedPrompts).toBeInstanceOf(Map)
  })

  it('and the reverse order (TS first, bridge second — the headless/test shape) still yields one shared state', async () => {
    const ts = await import('@/services/shared-state')
    await import('@/services/shared-state-bridge.mjs')
    const g = (globalThis as SharedGlobal)._sharedState!
    expect(ts.injectedPrompts).toBe(g.injectedPrompts)
    expect(ts.panelClients).toBe(g.panelClients)
  })
})
