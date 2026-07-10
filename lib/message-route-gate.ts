/**
 * The R6 communication-graph gate, in ONE place (TRDD-YEE33F3A follow-up 1).
 *
 * Two code paths deliver a message from an agent: the `SendMessage` AIO
 * (`services/send-message-service.ts`, gate G06) and `forwardFromUI`
 * (`lib/message-send.ts`). Only the first ran the R6 title graph. Forward ran
 * `checkMessageAllowed` — the TEAM-GOVERNANCE filter — which is a different rule,
 * so any agent could forward to a recipient its title may not reach.
 *
 * The obvious fix — copy G06's body into `forwardFromUI` — is the wrong one. G06
 * is a governance rule, and a governance rule with two implementations has two
 * behaviours the moment either is touched. That is exactly how the bug arose:
 * `sendMessage` grew the check (SVC2-MAJ-06) and `forwardMessage`, one function
 * away, did not. So the rule moves here and both callers call it.
 *
 * ── The cross-host contract ──────────────────────────────────────────────────
 *
 * A recipient's title lives on the recipient's host and changes there. This host
 * cannot know it, and a sender-side copy (e.g. read from `lib/agent-directory.ts`)
 * would be a stale mirror of an authoritative fact. `services/amp-service.ts`
 * settles this at lines 1111-1124: for a remote recipient the sender runs only a
 * weak check — does this sender title reach ANYBODY? — and the FULL graph check
 * runs on the receiving host (`amp-service.ts:1286`, the local-delivery branch
 * that a peer's `/api/v1/route` re-enters). This gate follows that contract.
 *
 * ── Remote means an explicit foreign host, NOT "absent from the registry" ─────
 *
 * These are different, and conflating them opens a hole. A recipient absent from
 * the local registry is either (a) an agent on another host, or (b) a name that
 * does not exist. The AIO gives both the same `'unknown'` title sentinel
 * (`send-message-service.ts:281`), so a rule keyed on "unresolved" would let a
 * typo'd local name through on the theory that some other host will catch it. No
 * host will: nothing is there. Remote is therefore keyed on an explicit
 * `name@hostId` whose host is not us — the same predicate `amp-service` uses
 * (`resolvedHostId && !isSelf(resolvedHostId)`). A local name that resolves to
 * nothing keeps its `'unknown'` title and the graph refuses it, as it does today.
 *
 * ── Why `'unknown'` is refused rather than fail-closed to `member` ────────────
 *
 * `validateMessageRoute` has a deliberate most-restrictive default for a FALSY
 * recipient role (AUTH-MIN-05: treat it as `member`). The sentinel is the truthy
 * string `'unknown'`, so it never reaches that default and lands on the
 * invalid-role refusal instead. Both behaviours are pinned by
 * `tests/unit/communication-graph-unresolved-recipient.test.ts`. This gate does
 * not paper over the difference — it passes the title through untouched, so the
 * graph stays the single authority on what a title may do.
 */

import { validateMessageRoute, getAllowedRecipients, isValidRole } from '@/lib/communication-graph'
import { isSelf } from '@/lib/hosts-config'
import type { UserTitle } from '@/types/user'

/** Reasons a route can be refused. Callers map these onto transport-specific errors. */
export type RouteGateCode =
  /** The R6 graph refused this sender title → recipient title edge. */
  | 'graph_denied'
  /** The sender's title reaches nobody at all (the weak cross-host pre-check). */
  | 'title_communication_forbidden'
  /** The graph could not be consulted. Fail CLOSED — never pass through. */
  | 'graph_check_unavailable'

export interface RouteGateRecipient {
  /**
   * The recipient's governance title as resolved on THIS host, or the `'unknown'`
   * sentinel when it could not be resolved. Passed to the graph verbatim.
   */
  title: string | null | undefined
  /**
   * The hostId parsed from a qualified `name@hostId`, or null for a bare name.
   * A bare name is always local; `isSelf(hostId)` decides for a qualified one.
   */
  hostId?: string | null
  /** The recipient is the human user (R6 treats H as a first-class node). */
  isHuman?: boolean
  /** R38.2 — the recipient user's title, when the user-authority model is on. */
  userTitle?: UserTitle
}

export interface AgentRouteGateInput {
  /** The SENDER's governance title. Agent senders only — see `assertAgentRouteAllowed`. */
  senderTitle: string
  recipient: RouteGateRecipient
  /** Set when this message replies to a prior one; R6 reply-only edges need it. */
  inReplyTo?: string
}

export interface RouteGateResult {
  allowed: boolean
  /** Human-readable refusal, suitable for an API body. Absent when allowed. */
  error?: string
  code?: RouteGateCode
  /** Audit trail, appended by the caller to its own `ops[]`. */
  ops: string[]
}

/** A qualified name pointing at a host that is not this one. */
export function isRemoteRecipient(hostId: string | null | undefined): boolean {
  return !!hostId && !isSelf(hostId)
}

/**
 * May an AGENT with `senderTitle` route a message to `recipient`?
 *
 * Agent senders only. `user` and `system` senders are NOT handled here: the AIO's
 * user branch carries the R38.2 relational model (`resolveUserSenderContext`) and
 * a system sender skips the graph by design. Forward never produces either — it
 * rewrites `from` to the mailbox owner, which is always an agent — so keeping
 * those branches out of the shared gate keeps it a rule about agents rather than
 * a switch over every possible sender.
 *
 * Fails CLOSED on any throw (SVC2-MAJ-19): a broken import or a transient error
 * must never become a silent governance bypass.
 */
export function assertAgentRouteAllowed(input: AgentRouteGateInput): RouteGateResult {
  const { senderTitle, recipient, inReplyTo } = input
  const ops: string[] = []

  try {
    if (isRemoteRecipient(recipient.hostId)) {
      // We cannot know a remote agent's title. Ask the only question answerable
      // from the sender alone, then let the receiving host run the real graph.
      if (!isValidRole(senderTitle)) {
        return deny(ops, 'title_communication_forbidden', `Unknown sender role: ${senderTitle}`)
      }
      if (getAllowedRecipients(senderTitle).length === 0) {
        return deny(ops, 'title_communication_forbidden', `${senderTitle.toUpperCase()} has no allowed message recipients`)
      }
      ops.push(`GATE: remote recipient on host '${recipient.hostId}' — sender-side check only; receiving host enforces R6`)
      return { allowed: true, ops }
    }

    const recipientTitle = recipient.title
    const recipientTitleStr = String(recipientTitle ?? '')
    const recipientIsHuman = recipient.isHuman || recipientTitleStr === 'human' || recipientTitleStr === 'user'

    const graph = validateMessageRoute(senderTitle, recipientTitle, {
      recipientIsHuman,
      recipientUserTitle: recipient.userTitle,
      inReplyToMessageId: inReplyTo,
    })

    if (!graph.allowed) {
      const suggestion = graph.suggestion ? ` Suggestion: ${graph.suggestion}` : ''
      const reason = graph.reason || `${senderTitle.toUpperCase()} cannot message ${(recipientTitleStr || 'unknown').toUpperCase()}`
      ops.push(`GATE: DENIED — R6 graph: ${senderTitle} → ${recipientTitleStr || 'unknown'} forbidden${graph.edgeType ? ` (${graph.edgeType})` : ''}`)
      return { allowed: false, code: 'graph_denied', error: `Message blocked by communication graph (R6): ${reason}.${suggestion}`, ops }
    }

    ops.push(`GATE: R6 graph allows ${senderTitle} → ${recipientTitleStr || 'unknown'}${graph.edgeType === 'reply-only' ? ' (reply-only)' : ''}`)
    return { allowed: true, ops }
  } catch (err) {
    // A governance gate that throws must refuse, not shrug. Before SVC2-MAJ-19
    // the equivalent catch logged a WARN and let the message through, so a broken
    // import path was a silent bypass.
    const detail = err instanceof Error ? err.message : 'unknown error'
    ops.push(`GATE: DENIED — graph module unavailable (${detail})`)
    console.error('[MessageRouteGate] fail-closed:', err)
    return { allowed: false, code: 'graph_check_unavailable', error: 'graph_check_unavailable', ops }
  }
}

function deny(ops: string[], code: RouteGateCode, error: string): RouteGateResult {
  ops.push(`GATE: DENIED — ${error}`)
  return { allowed: false, code, error, ops }
}
