/**
 * TRDD write-verb authorization — the route-side half of `manage-trdd`
 * (TRDD-K2WJH7RF Part 1, USER-approved 2026-07-09).
 *
 * WHY THIS FILE EXISTS
 *
 * `authorize()` in lib/authorization.ts is synchronous and does no filesystem
 * I/O — it touches only the registry and the team file. But a `manage-trdd`
 * decision turns on facts that live in the target TRDD's frontmatter on disk:
 * its approval tier, its assignee, its author. K2WJH7RF chose the cleaner of the
 * two options: the ROUTE resolves those facts and passes them in, so authorize()
 * stays honest about what it knows.
 *
 * This module is that resolver, and it is the ONE seam all five write routes go
 * through. `lib/sudo-guard.ts` deliberately DEFERS these routes (`deferToRoute`)
 * because the guard never reads the body or the task corpus — so if a route
 * skipped this helper, nothing else would check it. `authorize()` fails closed
 * without a TrddAuthContext, so a route that forgot denies everything loudly
 * rather than allowing everything silently; a unit test pins that each route
 * really does call in here.
 */
import { NextResponse } from 'next/server'
import type { AgentAuthResult } from './agent-auth'
import { authorize, type TrddVerb, type TrddApprovalTitle } from './authorization'
import { readTrdd, withTrddLock } from './trdd-store'
import { countAcceptanceBoxes } from './trdd-doctor'
import { getAgent, getAgentByNameAnyHost } from './agent-registry'

/**
 * The only columns an `archive` may target.
 *
 * `failed` is deliberately ABSENT, and that absence is the whole point. A failed
 * TRDD is RETRYABLE: it stays on the board, its cause gets fixed (often by other
 * TRDDs), and it is tried again. Archiving it would quietly convert a task that
 * still needs doing into a task nobody will ever look at again. Giving up on a
 * failed TRDD is an explicit `cancelled` — a decision someone makes, not a
 * side-effect of the word "archive".
 */
export const ARCHIVABLE_STATES = new Set(['completed', 'cancelled', 'superseded'])

/** The authority ladder of aimaestro-trdd-approval.md, verbatim. */
const LADDER = new Set<string>(['none', 'orchestrator', 'chief-of-staff', 'manager', 'user'])

/**
 * The DEPRECATED `approval-tier: N` field, decoded. Never written — only read,
 * so a TRDD authored before the rename still authorizes correctly instead of
 * silently falling back to the default.
 */
const LEGACY_TIER: Record<string, TrddApprovalTitle> = {
  '0': 'none',
  '1': 'chief-of-staff',
  '2': 'manager',
  '3': 'user',
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  return null
}

/**
 * Resolve a TRDD's `min-approval-requirement:` to the ladder.
 *
 * An absent, unknown, or unparseable value resolves to `manager` — NEVER to
 * `none`. Defaulting an unreadable field to "no approval needed" would mean a
 * typo in frontmatter silently opens a card to the entire fleet. The safe
 * direction for an unknown tier is the restrictive one.
 */
export function readMinApproval(fm: Record<string, unknown>): TrddApprovalTitle {
  const raw = str(fm['min-approval-requirement'])?.toLowerCase()
  if (raw && LADDER.has(raw)) return raw as TrddApprovalTitle

  const legacy = str(fm['approval-tier'])
  if (legacy && LEGACY_TIER[legacy]) return LEGACY_TIER[legacy]

  return 'manager'
}

/**
 * Resolve a TRDD actor field to a registry agent id.
 *
 * These fields hold a LOGICAL name, not a UUID — real corpora carry values like
 * `ai-maestro-session`, `main`, `claude-opus-session`, `maestro`. Most will not
 * resolve to a registered agent at all, and that is fine: an unresolvable
 * assignee simply means no agent can claim to BE the assignee, so only MANAGER
 * (or a team ORCHESTRATOR, which itself needs a resolvable assignee) can act.
 * Conservative by construction.
 *
 * Comparing the raw string against `auth.agentId` (a UUID) would never match and
 * would silently deny the genuine assignee — which is why this resolution exists
 * rather than a naive equality check at the call site.
 */
function resolveActor(v: unknown): string | null {
  const s = str(v)
  if (!s || s === 'null' || s === 'none' || s === 'unassigned') return null
  if (getAgent(s)) return s // already an agent UUID
  return getAgentByNameAnyHost(s)?.id ?? null
}

/**
 * Read the target TRDD, then authorize `verb` against it.
 *
 * NOT EXPORTED — call {@link withAuthorizedTrdd}, which runs this and the write it
 * authorises inside ONE document lock. See that function for why the unlocked spelling
 * was deliberately taken away rather than left beside the locked one.
 *
 * @returns a NextResponse the route must RETURN (404 / 403), or null to proceed.
 */
function authorizeTrddVerb(
  auth: AgentAuthResult,
  designDir: string,
  id: string,
  verb: TrddVerb
): NextResponse | null {
  const trdd = readTrdd(designDir, id)
  if (!trdd) {
    return NextResponse.json({ error: `TRDD ${id} not found` }, { status: 404 })
  }

  const fm = trdd.frontmatter ?? {}
  const decision = authorize(auth, 'manage-trdd', undefined, {
    verb,
    minApproval: readMinApproval(fm),
    assigneeAgentId: resolveActor(fm['assignee']),
    createdByAgentId: resolveActor(fm['created-by']),
  })

  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'trdd_forbidden', message: decision.reason, trdd: id, verb },
      { status: 403 }
    )
  }
  return null
}

/**
 * Authorize `verb` and perform `write` as ONE critical section on the target document
 * (TRDD-6D6SQNI6).
 *
 * THE BUG THIS CLOSES. `authorizeTrddVerb` reads the card to decide who may act; the store
 * verb then takes the document lock and writes. Between those two steps the card is
 * unlocked, so a peer changing `assignee` or `min-approval-requirement` — the two fields
 * the decision turns on, and precisely the ones a racing governance edit would be
 * changing — lets the mutation land on an authorization computed against a state that no
 * longer exists.
 *
 * WHY THE LOCK LIVES HERE, AND NOT IN THE FIVE ROUTES. The card's root cause is not the
 * missing lock, it is that the gap was INVISIBLE: the store's lock is real, it does
 * serialise the writes, and a reader auditing a route sees a lock and stops looking —
 * which is how this survived the pass that introduced the lock and the pass after it. A
 * fix that asks each of five routes (and every future sixth) to remember an extra
 * acquisition reproduces exactly that failure mode, because the omission looks like
 * nothing. This module is already the ONE seam all five go through — `lib/sudo-guard.ts`
 * DEFERS them here on purpose — so widening the section here covers every caller, and
 * un-exporting the unlocked `authorizeTrddVerb` leaves no spelling that skips it.
 *
 * WHY NOT AUTHORIZE INSIDE THE STORE. The store is also driven by the `trddgrep` CLI,
 * which has no `AgentAuthResult`. Every verb would grow an OPTIONAL auth parameter — and
 * an optional authorization argument fails open by default, which is a worse bug than the
 * one being fixed.
 *
 * SAFE TO NEST, MEASURED: `withTrddLock` is reentrant (see its own note), so the store's
 * inner acquisition on the same normalized key runs directly instead of deadlocking.
 *
 * `write` runs ONLY if authorization passed, and everything it needs — minting an approval
 * token, for instance — belongs inside it: a token minted before authority is established
 * would leave an audit record for an approval that never happened.
 *
 * @returns `{denied}` — a NextResponse the route must RETURN — or `{denied: null, value}`.
 */
export async function withAuthorizedTrdd<T>(
  auth: AgentAuthResult,
  designDir: string,
  id: string,
  verb: TrddVerb,
  write: () => T | Promise<T>
): Promise<{ denied: NextResponse; value?: undefined } | { denied: null; value: T }> {
  return withTrddLock(designDir, id, async () => {
    const denied = authorizeTrddVerb(auth, designDir, id, verb)
    if (denied) return { denied }
    return { denied: null, value: await write() }
  })
}

/**
 * Reject an archive that targets a non-terminal state — `failed` above all.
 *
 * This is a DATA invariant, not an authorization one, so it lives HERE and not
 * in authorize(): the human system-owner is granted unconditionally inside
 * authorize() (`!auth.agentId` → allowed) and would never reach a check placed
 * there. A rule that protects a task from being lost must bind the owner too.
 *
 * @returns a NextResponse the route must RETURN (400), or null to proceed.
 */
/**
 * TRDD-P6MSMQ2I — the terminal-column COMPLETION gate, enforced where the transition
 * actually happens.
 *
 * The gate (aimaestro-trdd-approval.md §D4 step 5b) says a card may enter a terminal
 * column only when its acceptance checklist EXISTS (>=1 box) and every box is ticked. It
 * was enforced by the LINTER alone, so `POST /api/trdd/[id]/archive --state completed`
 * happily minted exactly the false completion the gate exists to prevent — and then
 * `trddgrep validate` reported a standing ERROR about a card the API had just created.
 * Measured 2026-08-22 (TRDD-798OAHMX e2e): `G6A54OYK` was archived that way and is
 * deliberately left in place as the live reproduction.
 *
 * It reuses `countAcceptanceBoxes`, the linter's OWN counter, rather than a lookalike
 * regex. That is the whole point: two spellings of "an acceptance box" would drift, and
 * the failure mode is silent — the route would admit a card the linter then rejects,
 * which is the bug being fixed here, wearing a different hat. The counter already handles
 * fenced blocks (a card documenting this rule contains example checkboxes) and treats
 * `[~]` as a decision rather than an outstanding obligation.
 *
 * `cancelled` and `superseded` are NOT gated, matching the linter exactly. Open boxes are
 * what those columns MEAN — abandoned and overtaken work is not required to be finished,
 * and demanding a complete checklist from them would make the honest closure of a dead
 * card impossible.
 *
 * There is no grandfather boundary here, deliberately. The linter needs one because it
 * judges cards closed long ago; this runs only on a transition happening NOW, which is
 * always past the boundary.
 */
export function rejectIncompleteChecklist(
  designDir: string,
  id: string,
  state: unknown,
): NextResponse | null {
  if (str(state)?.toLowerCase() !== 'completed') return null

  const trdd = readTrdd(designDir, id)
  // Not found / unreadable is NOT this guard's business — `archiveTrdd` owns the 404, and
  // answering it here would fork one condition across two layers.
  if (!trdd) return null

  const boxes = countAcceptanceBoxes(trdd.body)
  if (boxes.total === 0) {
    return NextResponse.json(
      {
        error: 'trdd_terminal_without_checklist',
        message:
          `${trdd.id} has NO acceptance checklist, so archiving it as 'completed' would ` +
          `record a completion that proves nothing: nothing states what the card promised ` +
          `or whether it delivered. Write the checklist first, then archive.`,
      },
      { status: 409 }
    )
  }
  if (boxes.open > 0) {
    return NextResponse.json(
      {
        error: 'trdd_terminal_with_open_box',
        message:
          `${trdd.id} has ${boxes.open} of ${boxes.total} acceptance box(es) still ` +
          `unchecked — archiving it as 'completed' would be a false completion. Either the ` +
          `work is not done, or an obsolete box must be struck through with its reason ` +
          `(never silently ticked).`,
      },
      { status: 409 }
    )
  }
  return null
}

export function rejectUnarchivableState(state: unknown): NextResponse | null {
  const s = str(state)?.toLowerCase() ?? ''
  if (ARCHIVABLE_STATES.has(s)) return null

  return NextResponse.json(
    {
      error: 'trdd_not_archivable',
      message:
        `archive requires state ${[...ARCHIVABLE_STATES].join(' | ')} (got ${s || 'nothing'}). ` +
        `A 'failed' TRDD is retryable and stays on the board — giving up on it is an explicit 'cancelled'.`,
    },
    { status: 400 }
  )
}
