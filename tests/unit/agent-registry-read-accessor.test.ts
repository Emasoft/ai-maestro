/**
 * `agentRegistry.getExistingAgent()` is a READ. This suite proves it against the
 * REAL singleton — no mocks — because the property under test is precisely the
 * one a mock cannot vouch for: that looking an agent up does not bring it into
 * being.
 *
 * The sibling `agentRegistry.getAgent()` is a get-OR-CREATE. It never returns
 * null: it constructs an `Agent` for whatever id it was handed, and runs
 * `initialize()` → `cerebellum.start()` → the subconscious's `start()`, which
 * subscribes to host hints, starts a config-change timer, and mkdirs
 * `~/.aimaestro/agents/<id>/` to write `status.json`. Three services called it
 * on a pure read path (TRDD-YEE33F3A).
 *
 * So the guard here is not "does it return undefined" — that is obvious — but
 * "does the registry stay exactly as it was". `getStatus().activeAgents` is the
 * observable: a construct increments it. A regression to `getAgent()` moves that
 * number and fails these tests.
 *
 * The eviction this file used to also guard against is GONE (TRDD-QC8R79G5): the
 * registry no longer has a cap, because it was never a cache. Residency is now
 * covered by `agent-registry-residency.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import { agentRegistry } from '@/lib/agent'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'

describe('getExistingAgent constructs nothing', () => {
  it('an unknown id returns undefined', () => {
    expect(agentRegistry.getExistingAgent(UNKNOWN)).toBeUndefined()
  })

  it('reading an unknown id creates no registry entry', () => {
    const before = agentRegistry.getStatus().activeAgents
    agentRegistry.getExistingAgent(UNKNOWN)
    expect(agentRegistry.getStatus().activeAgents).toBe(before)
  })

  it('sweeping many unknown ids still creates nothing', () => {
    // Under the old `getAgent()` this loop would have constructed 25 Agents —
    // and, back when the registry evicted at 10, shut 15 of them down again.
    const { activeAgents: before } = agentRegistry.getStatus()

    for (let i = 0; i < 25; i++) {
      expect(agentRegistry.getExistingAgent(`unknown-agent-${i}`)).toBeUndefined()
    }

    expect(agentRegistry.getStatus().activeAgents).toBe(before)
  })

  it('the constructing accessor is still present, and is the one to avoid on reads', () => {
    // Guards the rename: if `getAgent` disappears, the doc comments and the
    // startup path that legitimately constructs need revisiting together.
    expect(typeof agentRegistry.getAgent).toBe('function')
    expect(typeof agentRegistry.getExistingAgent).toBe('function')
  })
})
