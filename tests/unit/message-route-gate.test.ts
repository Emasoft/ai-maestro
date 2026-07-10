/**
 * The shared R6 gate (TRDD-YEE33F3A follow-up 1). One rule, two callers.
 *
 * The gate exists because `forwardFromUI` never ran the R6 title graph while the
 * `SendMessage` AIO did — a governance rule with one implementation and two
 * callers, of which only one called it. These tests pin the three behaviours that
 * make the shared version safe to wire into both:
 *
 *  1. LOCAL recipient → the full graph, verbatim. No normalisation, no wrapper
 *     opinion; the graph stays the single authority.
 *  2. REMOTE recipient (an explicit `@hostId` that is not us) → the weak
 *     sender-side check only, because a recipient's title lives on its own host.
 *     `services/amp-service.ts:1111-1124` is the contract; the receiving host runs
 *     the real graph.
 *  3. A LOCAL name that resolves to nothing is NOT remote. It keeps the `'unknown'`
 *     sentinel and the graph refuses it. Keying "remote" on "unresolved" instead
 *     of on an explicit foreign host would let a typo'd local name through on the
 *     theory that some other host will catch it. Nothing is there to catch it.
 *
 * `isSelf` is mocked so "which host am I" never depends on the developer's
 * ~/.aimaestro/hosts.json. The graph itself is REAL — mocking it would test the
 * mock, and the whole point is that the gate delegates rather than reimplements.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/hosts-config', () => ({
  isSelf: (hostId: string) => hostId === 'this-host',
}))

import { assertAgentRouteAllowed, isRemoteRecipient } from '@/lib/message-route-gate'

const local = (title: string | null | undefined) => ({ title })
const remote = (title: string | null | undefined, hostId: string) => ({ title, hostId })

describe('local recipient — the graph decides, verbatim', () => {
  it('allows an edge the graph allows', () => {
    const r = assertAgentRouteAllowed({ senderTitle: 'chief-of-staff', recipient: local('member') })
    expect(r.allowed).toBe(true)
    expect(r.code).toBeUndefined()
  })

  it('refuses an edge the graph refuses, and surfaces the graph reason', () => {
    // R6 v3: MEMBER may not reach MANAGER; it routes through its COS.
    const r = assertAgentRouteAllowed({ senderTitle: 'member', recipient: local('manager') })
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('graph_denied')
    expect(r.error).toContain('communication graph (R6)')
  })

  it('passes inReplyTo through, so reply-only edges to the human resolve', () => {
    const withoutReply = assertAgentRouteAllowed({ senderTitle: 'member', recipient: local('human') })
    const withReply = assertAgentRouteAllowed({
      senderTitle: 'member',
      recipient: local('human'),
      inReplyTo: 'msg-1',
    })
    // A team title reaches H only as a reply (edge `1`). If these ever agree, the
    // reply context has stopped being threaded and the reply-only edge is dead.
    expect(withoutReply.allowed).toBe(false)
    expect(withReply.allowed).toBe(true)
  })

  it('a title-less local recipient is fail-closed to member (AUTH-MIN-05), not to allow', () => {
    expect(assertAgentRouteAllowed({ senderTitle: 'chief-of-staff', recipient: local(null) }).allowed).toBe(true)
    expect(assertAgentRouteAllowed({ senderTitle: 'member', recipient: local(null) }).allowed).toBe(false)
  })
})

describe("a local name that resolves to nothing is refused — it is NOT 'remote'", () => {
  it("the 'unknown' sentinel is refused even for a sender that may reach a MEMBER", () => {
    // chief-of-staff -> member is allowed; chief-of-staff -> 'unknown' is not.
    // This is the case a rule keyed on "unresolved" would wrongly let through.
    const r = assertAgentRouteAllowed({ senderTitle: 'chief-of-staff', recipient: local('unknown') })
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('graph_denied')
  })

  it('a bare name is local no matter what, so no hostId means no weak check', () => {
    expect(isRemoteRecipient(null)).toBe(false)
    expect(isRemoteRecipient(undefined)).toBe(false)
    expect(isRemoteRecipient('')).toBe(false)
  })

  it("a qualified name pointing at OUR OWN host is local, not remote", () => {
    const r = assertAgentRouteAllowed({ senderTitle: 'chief-of-staff', recipient: remote('unknown', 'this-host') })
    // Same refusal as the bare unresolved name: self-host never takes the weak path.
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('graph_denied')
  })
})

describe('remote recipient — weak sender-side check, receiving host enforces', () => {
  it('allows a titled sender to a remote agent whose title we cannot know', () => {
    // MEMBER -> 'unknown' is refused locally. The SAME pair, qualified to another
    // host, must pass: this host has no standing to judge a title it cannot read.
    expect(assertAgentRouteAllowed({ senderTitle: 'member', recipient: local('unknown') }).allowed).toBe(false)

    const r = assertAgentRouteAllowed({ senderTitle: 'member', recipient: remote('unknown', 'peer-host') })
    expect(r.allowed).toBe(true)
    expect(r.ops.join(' ')).toContain('receiving host enforces')
  })

  it('the weak check still refuses a sender whose title reaches nobody', () => {
    const r = assertAgentRouteAllowed({ senderTitle: 'not-a-title', recipient: remote('unknown', 'peer-host') })
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('title_communication_forbidden')
  })

  it('the remote path does not consult the recipient title at all', () => {
    // Whatever we happen to hold locally for a remote name is irrelevant and must
    // not change the answer — otherwise a stale mirror becomes an authority.
    const withUnknown = assertAgentRouteAllowed({ senderTitle: 'member', recipient: remote('unknown', 'peer-host') })
    const withManager = assertAgentRouteAllowed({ senderTitle: 'member', recipient: remote('manager', 'peer-host') })
    // member -> manager is a DENIED edge locally, yet remote must still allow.
    expect(assertAgentRouteAllowed({ senderTitle: 'member', recipient: local('manager') }).allowed).toBe(false)
    expect(withUnknown.allowed).toBe(true)
    expect(withManager.allowed).toBe(true)
  })
})

describe('fail-closed', () => {
  it('a throw inside the graph refuses rather than passing through', () => {
    // Force the throw the SVC2-MAJ-19 catch exists for. `senderTitle` is read by
    // `isValidRole` on the remote path only, so use a local recipient whose
    // `String()` conversion explodes.
    const hostile = {
      get title(): string { throw new Error('boom') },
    } as unknown as { title: string }

    const r = assertAgentRouteAllowed({ senderTitle: 'member', recipient: hostile })
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('graph_check_unavailable')
  })
})
