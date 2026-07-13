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
import { readTrdd } from './trdd-store'
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
 * @returns a NextResponse the route must RETURN (404 / 403), or null to proceed.
 */
export function authorizeTrddVerb(
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
 * Reject an archive that targets a non-terminal state — `failed` above all.
 *
 * This is a DATA invariant, not an authorization one, so it lives HERE and not
 * in authorize(): the human system-owner is granted unconditionally inside
 * authorize() (`!auth.agentId` → allowed) and would never reach a check placed
 * there. A rule that protects a task from being lost must bind the owner too.
 *
 * @returns a NextResponse the route must RETURN (400), or null to proceed.
 */
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
