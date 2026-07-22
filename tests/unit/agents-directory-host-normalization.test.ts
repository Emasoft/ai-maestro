/**
 * Route-level coverage for GET /api/agents/normalize-hosts.
 *
 * The route (app/api/agents/normalize-hosts/route.ts) is a thin wrapper around
 * services/agents-directory-service.ts::diagnoseHosts, whose real work is the
 * host-id classification in lib/agent-registry.ts::needsHostIdNormalization.
 *
 * These tests exercise the REAL functions — no mocks. The classification
 * predicate is tested with fully-controlled real inputs; diagnoseHosts is tested
 * as a real read-only integration against the on-disk agent registry, asserting
 * only invariants that hold for ANY registry state (so the test is deterministic
 * whether the registry has 0 or N agents). loadAgents() returns [] when the
 * registry file is absent, so this never throws on a fresh machine.
 */
import { describe, it, expect } from 'vitest'
import { needsHostIdNormalization } from '@/lib/agent-registry'
import { diagnoseHosts } from '@/services/agents-directory-service'

describe('needsHostIdNormalization (real host-id classification)', () => {
  it('flags every non-canonical host-id form (undefined, "local", uppercase, .local suffix)', () => {
    // Each of these is a real host-id shape the normalizer must catch.
    expect(needsHostIdNormalization(undefined)).toBe(true)
    expect(needsHostIdNormalization('local')).toBe(true)
    expect(needsHostIdNormalization('MyLaptop')).toBe(true) // uppercase → not canonical
    expect(needsHostIdNormalization('mylaptop.local')).toBe(true) // .local suffix
  })

  it('passes a canonical lowercase, dot-suffix-free host-id unchanged', () => {
    // A hostname already lowercased and stripped of ".local" needs no normalization.
    expect(needsHostIdNormalization('mylaptop')).toBe(false)
    expect(needsHostIdNormalization('host-01')).toBe(false)
  })
})

describe('diagnoseHosts (real service against the live registry)', () => {
  it('returns a well-formed diagnosis whose flags agree with the real predicate and whose counts are consistent', () => {
    // Real read-only call — reads the actual ~/.aimaestro/agents/registry.json.
    const result = diagnoseHosts()

    expect(result.status).toBe(200)
    expect(result.error).toBeUndefined()

    const { diagnosis } = result.data
    expect(typeof diagnosis.canonical).toBe('string')
    expect(diagnosis.canonical.length).toBeGreaterThan(0)
    expect(typeof diagnosis.totalAgents).toBe('number')
    expect(Array.isArray(diagnosis.hostIds)).toBe(true)

    // Every per-host entry's needsNormalization flag must match the real predicate,
    // and the aggregate count of agents-needing-normalization can never exceed the total.
    let flaggedAgents = 0
    for (const entry of diagnosis.hostIds) {
      expect(typeof entry.hostId).toBe('string')
      expect(typeof entry.count).toBe('number')
      expect(entry.needsNormalization).toBe(needsHostIdNormalization(entry.hostId))
      if (entry.needsNormalization) flaggedAgents += entry.count
    }
    expect(diagnosis.agentsNeedingNormalization).toBe(flaggedAgents)
    expect(diagnosis.agentsNeedingNormalization).toBeLessThanOrEqual(diagnosis.totalAgents)
  })
})
