/**
 * What the R6 graph does with a recipient it cannot resolve — the fact the
 * forward gate (TRDD-YEE33F3A follow-up 1) has to be built on top of, and the one
 * the TRDD's first design note got wrong.
 *
 * `validateMessageRoute` has a deliberate fail-closed default for a FALSY
 * recipient role (`null`/`undefined`/`''`): treat it as `member`, the title with
 * the most inbound restrictions (AUTH-MIN-05). But the SendMessage AIO does not
 * pass a falsy value — `services/send-message-service.ts:281` initialises
 * `recipientTitle` to the truthy STRING `'unknown'` and overwrites it only when
 * the recipient is found in the LOCAL registry. A remote agent never is.
 *
 * So the AUTH-MIN-05 branch is skipped and the call lands on the `isValidRole`
 * check, which refuses. The two behaviours differ, and the difference decides
 * whether a cross-host message is delivered or denied. These tests pin both, so
 * that neither can be changed by accident while the shared gate is extracted.
 *
 * Cross-host is NOT meant to be gated here. `services/amp-service.ts:1111-1124`
 * states the contract: the sender-side runs only the weak
 * `getAllowedRecipients(senderTitle).length > 0` check, and the FULL graph check
 * runs on the receiving host (`amp-service.ts:1286`, in the local-delivery branch
 * that a peer's `/api/v1/route` re-enters). A recipient's title lives on the
 * recipient's host.
 */

import { describe, it, expect } from 'vitest'
import { validateMessageRoute, getAllowedRecipients } from '@/lib/communication-graph'

describe('a FALSY recipient title is fail-closed to member (AUTH-MIN-05)', () => {
  it('a title-less recipient is reachable exactly by the titles that may reach a MEMBER', () => {
    // The point of the default: unknown-but-present is treated as the most
    // inbound-restricted title, so the graph errs toward refusal.
    expect(validateMessageRoute('chief-of-staff', null).allowed).toBe(true)
    expect(validateMessageRoute('orchestrator', null).allowed).toBe(true)
    expect(validateMessageRoute('member', null).allowed).toBe(false)
    expect(validateMessageRoute('architect', undefined).allowed).toBe(false)
  })

  it('the refusal names the missing title rather than a graph edge', () => {
    const result = validateMessageRoute('member', null)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('without a governance title')
  })
})

describe("the STRING 'unknown' is not falsy, so it never reaches that default", () => {
  it("every sender title is refused, including the ones that may reach a MEMBER", () => {
    // `chief-of-staff -> member` is allowed; `chief-of-staff -> 'unknown'` is not.
    // That is the whole gap: the AIO's sentinel bypasses the fail-closed default
    // and lands on the invalid-role refusal instead.
    for (const sender of ['manager', 'chief-of-staff', 'orchestrator', 'member', 'architect']) {
      const result = validateMessageRoute(sender, 'unknown')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Unknown recipient role: unknown')
    }
  })

  it("a title-less recipient and an 'unknown' recipient give DIFFERENT answers to the same sender", () => {
    // If these ever agree, the sentinel has stopped mattering and the AIO's
    // remote-recipient behaviour has silently changed.
    expect(validateMessageRoute('chief-of-staff', null).allowed).toBe(true)
    expect(validateMessageRoute('chief-of-staff', 'unknown').allowed).toBe(false)
  })
})

describe('the weak sender-side check the cross-host contract actually calls for', () => {
  it('a titled agent has allowed recipients, so a remote send passes the sender-side gate', () => {
    // What amp-service runs before handing the message to the peer. It asks a
    // question that can be answered without knowing the recipient.
    expect(getAllowedRecipients('member').length).toBeGreaterThan(0)
    expect(getAllowedRecipients('manager').length).toBeGreaterThan(0)
  })

  it('the check is not vacuous — it is answerable from the sender title alone', () => {
    // Every governance title must yield a deterministic list; a title that
    // reached nobody would be refused outright by the sender-side gate.
    const titles = ['manager', 'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member', 'maintainer', 'autonomous'] as const
    for (const t of titles) {
      expect(Array.isArray(getAllowedRecipients(t))).toBe(true)
    }
  })
})
