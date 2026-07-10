/**
 * `agentRegistry.getExistingAgent()` is a READ. This suite proves it against the
 * REAL singleton — no mocks — because the property under test is precisely the
 * one a mock cannot vouch for: that looking an agent up does not bring it into
 * being.
 *
 * The sibling `agentRegistry.getAgent()` is a get-OR-CREATE. It never returns
 * null: it calls `evictIfNeeded()` (shutting down the least-recently-used real
 * Agent once the registry hits its cap of 10), constructs an `Agent` for whatever
 * id it was handed, and runs `initialize()` → `cerebellum.start()` → the
 * subconscious's `start()`, which subscribes to host hints, starts a
 * config-change timer, and mkdirs `~/.aimaestro/agents/<id>/` to write
 * `status.json`. Three services called it on a pure read path (TRDD-YEE33F3A).
 *
 * So the guard here is not "does it return undefined" — that is obvious — but
 * "does the registry stay exactly as it was". `getStatus().activeAgents` is the
 * observable: a construct increments it, an eviction decrements it. A regression
 * to `getAgent()` moves that number and fails these tests.
 */

import { describe, it, expect } from 'vitest'
import { agentRegistry } from '@/lib/agent'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'

describe('getExistingAgent constructs nothing and evicts nothing', () => {
  it('an unknown id returns undefined', () => {
    expect(agentRegistry.getExistingAgent(UNKNOWN)).toBeUndefined()
  })

  it('reading an unknown id creates no registry entry', () => {
    const before = agentRegistry.getStatus().activeAgents
    agentRegistry.getExistingAgent(UNKNOWN)
    expect(agentRegistry.getStatus().activeAgents).toBe(before)
  })

  it('sweeping more unknown ids than the cap still creates nothing', () => {
    // The eviction primitive needs a construct to trigger it: `evictIfNeeded()`
    // only runs on the create path. 25 reads > maxAgents (10) — under the old
    // `getAgent()` this loop would have constructed 25 Agents and evicted 15.
    const { activeAgents: before, maxAgents } = agentRegistry.getStatus()
    expect(maxAgents).toBeLessThan(25)

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
