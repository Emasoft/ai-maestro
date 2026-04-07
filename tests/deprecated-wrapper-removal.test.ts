/**
 * Tests verifying that deprecated thin wrappers have been removed
 * and callers use DeleteAgent directly.
 *
 * Validates:
 *   - deleteAgentById is no longer exported from agents-core-service
 *   - deleteAgentSelf is no longer exported from amp-service
 *   - deleteAssistantAgent is no longer exported from help-service
 *   - createNewAgent is no longer exported from agents-core-service
 */

import { describe, it, expect } from 'vitest'

describe('deprecated wrapper removal', () => {
  it('deleteAgentById should no longer be exported from agents-core-service', async () => {
    /** Verifies that the deprecated deleteAgentById wrapper was removed from agents-core-service */
    const mod = await import('@/services/agents-core-service')
    expect((mod as Record<string, unknown>).deleteAgentById).toBeUndefined()
  })

  it('deleteAgentSelf should no longer be exported from amp-service', async () => {
    /** Verifies that the deprecated deleteAgentSelf wrapper was removed from amp-service */
    const mod = await import('@/services/amp-service')
    expect((mod as Record<string, unknown>).deleteAgentSelf).toBeUndefined()
  })

  it('deleteAssistantAgent should no longer be exported from help-service', async () => {
    /** Verifies that the deprecated deleteAssistantAgent wrapper was removed from help-service */
    const mod = await import('@/services/help-service')
    expect((mod as Record<string, unknown>).deleteAssistantAgent).toBeUndefined()
  })

  it('createNewAgent should no longer be exported from agents-core-service', async () => {
    /** Verifies that the deprecated createNewAgent wrapper was removed from agents-core-service */
    const mod = await import('@/services/agents-core-service')
    expect((mod as Record<string, unknown>).createNewAgent).toBeUndefined()
  })
})
