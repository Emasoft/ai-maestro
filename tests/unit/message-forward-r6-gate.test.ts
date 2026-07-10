/**
 * `forwardFromUI` and the R6 title graph (TRDD-YEE33F3A follow-up 1).
 *
 * Forward ran `checkMessageAllowed` — the TEAM filter — and never the R6 title
 * graph, so any agent could forward to a recipient its title may not reach. These
 * tests pin the fix, and they pin it the only way a denial can honestly be pinned:
 *
 *   A DENIAL IS "NOTHING WAS WRITTEN", NOT "A 403 CAME BACK".
 *
 * A route that answers 403 after delivering the message has denied nothing. So
 * every refusal below asserts that `deliver` and `writeToAMPSent` were never
 * called. `deliver` is the only path a message takes to a recipient's inbox;
 * `writeToAMPSent` is the only path to the sender's `sent/` folder.
 *
 * The communication graph is REAL here. Mocking it would test the mock, and the
 * whole point of `lib/message-route-gate.ts` is that the rule has exactly one
 * implementation which both senders delegate to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthContext } from '@/lib/agent-auth'

// `vi.mock` factories are hoisted above every const, so the spies they close over
// must be created inside `vi.hoisted` or they are read before initialisation.
const { deliver, writeToAMPSent, queueMessage, TITLES } = vi.hoisted(() => ({
  deliver: vi.fn(async () => ({ delivered: true, notified: true })),
  writeToAMPSent: vi.fn(async () => undefined),
  queueMessage: vi.fn(async () => undefined),
  // Titles by agent id. The graph is real, so these decide the outcome.
  TITLES: {
    'id-member': 'member',
    'id-member-2': 'member',
    'id-cos': 'chief-of-staff',
  } as Record<string, string>,
}))

vi.mock('@/lib/message-delivery', () => ({ deliver }))
vi.mock('@/lib/amp-inbox-writer', () => ({ writeToAMPSent }))
vi.mock('@/lib/amp-relay', () => ({ queueMessage }))
vi.mock('@/lib/content-security', () => ({ applyContentSecurity: (m: unknown) => m }))
vi.mock('@/lib/message-filter', () => ({ checkMessageAllowed: () => ({ allowed: true }) }))
vi.mock('@/lib/amp-keys', () => ({ verifySignature: () => true }))
vi.mock('@/lib/host-keys', () => ({ signHostAttestation: () => 'sig' }))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string) => (TITLES[id] ? { id, name: id, governanceTitle: TITLES[id] } : undefined),
}))

vi.mock('@/lib/messageQueue', () => ({
  resolveAgentIdentifier: (name: string) =>
    TITLES[name] ? { agentId: name, alias: name, sessionName: name } : null,
  getMessage: vi.fn(),
  getSelfHostName: () => 'this-host',
}))

vi.mock('@/lib/hosts-config-server.mjs', () => ({
  isSelf: (h: string) => h === 'this-host',
  getHostById: () => undefined,
  getSelfHost: () => ({ id: 'this-host' }),
  getSelfHostId: () => 'this-host',
}))

// Consumed by the gate. Exactly one configured peer exists in this fixture.
vi.mock('@/lib/hosts-config', () => ({
  isSelf: (h: string) => h === 'this-host',
  findHostByAnyIdentifier: (id: string) => (id === 'peer-host' || id === 'this-host' ? { id } : undefined),
}))

import { forwardFromUI } from '@/lib/message-send'
import { MessageRouteDenied } from '@/lib/message-route-gate'

const ORIGINAL = {
  id: 'orig-1',
  from: 'id-cos',
  fromAlias: 'id-cos',
  to: 'id-member',
  toAlias: 'id-member',
  timestamp: new Date(0).toISOString(),
  subject: 'hello',
  content: { type: 'notification', message: 'body' },
} as never

const agent = (id: string): AuthContext => ({ agentId: id, isSystemOwner: false }) as AuthContext
const owner: AuthContext = { isSystemOwner: true } as AuthContext

const forward = (from: string, to: string, authContext?: AuthContext) =>
  forwardFromUI({ fromAgent: from, toAgent: to, providedOriginalMessage: ORIGINAL, authContext })

/** The only two ways a message reaches disk. Neither may fire on a denial. */
const nothingWasWritten = () => {
  expect(deliver).not.toHaveBeenCalled()
  expect(writeToAMPSent).not.toHaveBeenCalled()
  expect(queueMessage).not.toHaveBeenCalled()
}

beforeEach(() => {
  deliver.mockClear()
  writeToAMPSent.mockClear()
  queueMessage.mockClear()
})

describe('forwardFromUI — the R6 graph, which it used to skip entirely', () => {
  it('MEMBER → MEMBER is refused, and NOTHING is written', async () => {
    // The bug in one line: the graph has no member→member edge, yet before the
    // gate this forward delivered.
    await expect(forward('id-member', 'id-member-2', agent('id-member'))).rejects.toThrow(MessageRouteDenied)
    nothingWasWritten()
  })

  it('the refusal carries the graph_denied code, so the service can answer 403 not 500', async () => {
    const err = await forward('id-member', 'id-member-2', agent('id-member')).catch(e => e)
    expect(err).toBeInstanceOf(MessageRouteDenied)
    expect(err.code).toBe('graph_denied')
    expect(err.message).toContain('communication graph (R6)')
  })

  it('MEMBER → CHIEF-OF-STAFF is an allowed edge, and the message IS delivered', async () => {
    // The mirror image of the first test. A gate that refuses everything is not a
    // gate, so the allowed edge must still pass through to delivery.
    await forward('id-member', 'id-cos', agent('id-member'))
    expect(deliver).toHaveBeenCalledTimes(1)
  })
})

describe('forwardFromUI — auth context', () => {
  it('an ABSENT auth context is refused, never read as the owner', async () => {
    // G04.AUTH precedent: "no context" must not decay into "trusted caller".
    const err = await forward('id-member', 'id-member-2', undefined).catch(e => e)
    expect(err).toBeInstanceOf(MessageRouteDenied)
    expect(err.code).toBe('forbidden_no_auth_context')
    nothingWasWritten()
  })

  it('a system-owner caller keeps today behaviour — no graph check', async () => {
    // Deliberately preserved, not overlooked: a human forwarding from an agent's
    // mailbox emits a message whose declared sender is that agent. Whether R6
    // should bind the human is a MANAGER policy question, escalated rather than
    // decided inside a bug fix. If that decision lands, this test changes with it.
    await forward('id-member', 'id-member-2', owner)
    expect(deliver).toHaveBeenCalledTimes(1)
  })
})
