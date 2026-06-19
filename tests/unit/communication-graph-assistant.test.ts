/**
 * R39.5 / R39.7 — ASSISTANT in the communication graph (STATIC-edge layer).
 *
 * This suite covers the STATIC adjacency-matrix half of the ASSISTANT rules —
 * the part decided by `canSendMessage` / `getEdgeType` / `getAllowedRecipients`
 * / `isValidRole` directly off ALLOW_EDGES, with NO relational context. The
 * RELATIONAL half (validateMessageRoute with assistantSender / userSender, the
 * "only its own user + the active MAESTRO" decision) lives in
 * communication-graph-user-routing.test.ts. Together they prove:
 *
 *   - R39.7 (invisible to other agents): the ASSISTANT has NO static edge to any
 *     agent title, and NO agent title has a static edge to the ASSISTANT — so the
 *     unconditional canSendMessage answer is `false` in BOTH directions for every
 *     agent title. An ASSISTANT can never be discovered or messaged off the
 *     static graph; its only real targets (own user + MAESTRO) are relational.
 *   - R39.5 (messaging restricted): no static `allow` edge lets an ASSISTANT
 *     initiate to any title; the legitimate reach is the relational branch only.
 *
 * The comm-graph module is PURE — no mocks needed.
 */
import { describe, it, expect } from 'vitest'
import {
  canSendMessage,
  getEdgeType,
  getAllowedRecipients,
  isValidRole,
  validateMessageRoute,
  ALL_ROLES,
  ALL_NODES,
} from '@/lib/communication-graph'
import type { AgentRole } from '@/types/agent'
import type { GraphNode } from '@/lib/communication-graph'

// Every agent title EXCEPT the assistant itself — the set R39.7 must keep the
// ASSISTANT isolated from in BOTH directions.
const OTHER_AGENT_TITLES: AgentRole[] = [
  'manager',
  'chief-of-staff',
  'orchestrator',
  'architect',
  'integrator',
  'member',
  'autonomous',
  'maintainer',
]

describe('communication-graph — ASSISTANT static node (R39.5/R39.7)', () => {
  it('isValidRole("assistant") is true and ALL_ROLES includes it (R39.1 — 9th title)', () => {
    expect(isValidRole('assistant')).toBe(true)
    expect(ALL_ROLES).toContain('assistant')
    expect(ALL_NODES).toContain('assistant' as GraphNode)
  })

  it('R39.7 outbound: canSendMessage("assistant", <every agent title>) is denied', () => {
    // The ASSISTANT has an EMPTY static ALLOW_EDGES set. Its only legitimate
    // targets (own user + MAESTRO) are relational, decided in validateMessageRoute.
    for (const recipient of OTHER_AGENT_TITLES) {
      expect(canSendMessage('assistant', recipient)).toBe(false)
    }
  })

  it('R39.7 outbound: assistant has no static allow OR reply-only edge to any agent title', () => {
    for (const recipient of OTHER_AGENT_TITLES) {
      expect(getEdgeType('assistant', recipient)).toBe('deny')
    }
  })

  it('R39.7 inbound: canSendMessage(<every agent title>, "assistant") is denied (invisible to agents)', () => {
    // No other title's ALLOW_EDGES set may list 'assistant' — the ASSISTANT is
    // never a static recipient, which IS the invisibility encoding.
    for (const sender of OTHER_AGENT_TITLES) {
      expect(canSendMessage(sender, 'assistant')).toBe(false)
      expect(getEdgeType(sender, 'assistant')).toBe('deny')
    }
  })

  it('R39.7 inbound: assistant→assistant is also denied (no self edge)', () => {
    expect(canSendMessage('assistant', 'assistant')).toBe(false)
    expect(getEdgeType('assistant', 'assistant')).toBe('deny')
  })

  it('R39.5: getAllowedRecipients("assistant") is empty (no static initiate target)', () => {
    expect(getAllowedRecipients('assistant')).toEqual([])
  })

  it('R39.7: every node has a deny static edge to assistant (no node statically reaches it)', () => {
    // Exhaustive sweep over EVERY graph node (agent titles + human). The only
    // legitimate human→assistant path is relational (userSender.recipientIsOwnAssistant),
    // never a static edge — so getEdgeType is 'deny' for all of them including 'human'.
    for (const sender of ALL_NODES) {
      expect(getEdgeType(sender, 'assistant' as GraphNode)).toBe('deny')
    }
  })

  it('validateMessageRoute: agent→assistant is denied with the R39.7 invisibility reason', () => {
    // An agent sender (no assistantSender / userSender block) targeting an
    // ASSISTANT recipient must be refused — the ASSISTANT is invisible to agents.
    for (const sender of OTHER_AGENT_TITLES) {
      const r = validateMessageRoute(sender, 'assistant', {})
      expect(r.allowed).toBe(false)
      expect(r.reason).toMatch(/invisible to other agents/i)
      expect(r.edgeType).toBe('deny')
    }
  })

  it('validateMessageRoute: assistant→agent is denied (R39.5) absent a relational block', () => {
    // An ASSISTANT sender with NO assistantSender block can reach nothing —
    // fail-closed. Its only reach (own user + MAESTRO) requires the relational
    // block, which is asserted in communication-graph-user-routing.test.ts.
    for (const recipient of OTHER_AGENT_TITLES) {
      const r = validateMessageRoute('assistant', recipient, {})
      expect(r.allowed).toBe(false)
      expect(r.reason).toMatch(/only message its own user and the MAESTRO/i)
      expect(r.edgeType).toBe('deny')
    }
  })
})
