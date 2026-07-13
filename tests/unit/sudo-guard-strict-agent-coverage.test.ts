/**
 * TRDD-6A2I6ZO0 — coverage guardrail for the strict-route agent path.
 *
 * `requireAidTitle` fails CLOSED for a strict route that appears in none of the
 * guard's declaration sets. That default is correct, but it is SILENT: the route
 * simply 403s every agent with "This operation is not available to agents",
 * which reads like a deliberate policy rather than an oversight.
 *
 * That is exactly how the eight routes of epic TRDD-SCLSRS6E (panel, queue,
 * prompt/answer, and the five TRDD-lifecycle verbs) shipped unreachable by the
 * janitor they were built for. Nothing failed; the feature was simply inert.
 * Running this guardrail for the first time also surfaced six OLDER strict
 * routes in the same state.
 *
 * The invariant: every strict route in security-registry.json is DECLARED in
 * exactly one of
 *   - STRICT_AGENT_RULES     (agent-callable, mapped to an AuthAction)
 *   - SYSTEM_OWNER_ONLY_STRICT (deliberately human-only)
 *   - AGENT_POLICY_PENDING   (policy not yet decided — a pinned debt ledger)
 *
 * so that adding a strict route without deciding its agent policy breaks the
 * build instead of shipping a dead endpoint.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  SYSTEM_OWNER_ONLY_STRICT,
  AGENT_POLICY_PENDING,
  requireAidTitle,
} from '@/lib/sudo-guard'
import type { AgentAuthResult } from '@/lib/agent-auth'

const repoRoot = path.resolve(__dirname, '..', '..')

function strictRouteKeys(): string[] {
  const registry = JSON.parse(
    readFileSync(path.join(repoRoot, 'security-registry.json'), 'utf8'),
  ) as { entries: Record<string, string> }

  return Object.entries(registry.entries)
    .filter(([, level]) => level === 'strict')
    .map(([key]) => {
      const m = key.match(/^([A-Z]+)_(.+)$/)
      if (!m) throw new Error(`Malformed security-registry key: ${key}`)
      return `${m[1]} ${m[2]}`
    })
}

/**
 * STRICT_AGENT_RULES is module-private on purpose (the guard owns the mapping),
 * so probe it behaviourally: a route the guard cannot classify emits this exact
 * message. Any other outcome means the route IS declared somewhere.
 */
const UNDECLARED_MESSAGE = 'This operation is not available to agents.'
const PENDING_MESSAGE = 'Agent access to this operation has not been defined yet.'
const OWNER_ONLY_MESSAGE = 'This operation is restricted to the system owner.'

const MANAGER: AgentAuthResult = {
  agentId: '11111111-1111-4111-8111-111111111111',
  governanceTitle: 'manager',
}

async function messageFor(method: string, template: string): Promise<string | null> {
  const res = requireAidTitle(MANAGER, method, template)
  if (!res) return null // allowed outright
  const body = (await res.json()) as { message?: string }
  return body.message ?? null
}

/**
 * The exact inventory of undecided routes, as of 2026-07-09. This list may
 * SHRINK as policies are decided; it must never grow without a deliberate edit
 * here, which is the point.
 *
 * TRDD-D3RP7KQZ removed four: the panel/queue/prompt-answer trio and
 * `PATCH /api/agents/[id]`, now mapped in STRICT_AGENT_RULES.
 */
const PENDING_INVENTORY: string[] = [
  // EMPTY — TRDD-K2WJH7RF discharged the ledger (USER-approved 2026-07-09).
  // The ten that were here are now DECIDED, and are pinned below instead.
]

/**
 * TRDD-K2WJH7RF Part 2 — the five governance routes, now a STATED owner-only
 * decision rather than a shrug. 403 before, 403 after: the behaviour is
 * deliberately unchanged, which is exactly why this must be asserted. A silent
 * delisting would look identical from the outside while opening the route.
 */
const K2WJH7RF_OWNER_ONLY = [
  'POST /api/governance/maestro-delegate',
  'DELETE /api/governance/maestro-delegate',
  'POST /api/agents/foreign-approvals/[id]/approve',
  'POST /api/agents/foreign-approvals/[id]/reject',
  'POST /api/system/aid-recover',
]

/**
 * TRDD-K2WJH7RF Part 1 — the five TRDD write verbs. The guard now ADMITS an
 * authenticated agent (`deferToRoute`) because the decision needs the target
 * TRDD's approval tier, which lives on disk and which the guard refuses to read.
 * The real check is `authorizeTrddVerb()` inside each route.
 *
 * These are what ai-maestro-janitor#76 told the janitor to SKIP.
 */
const K2WJH7RF_TRDD_VERBS = [
  'PATCH /api/trdd/[id]',
  'POST /api/trdd/[id]/approve',
  'POST /api/trdd/[id]/refuse',
  'POST /api/trdd/[id]/promote',
  'POST /api/trdd/[id]/archive',
]

/**
 * The route FILE behind each deferred verb. Deferral means the guard performs no
 * check, so if one of these files stopped calling `authorizeTrddVerb()` the route
 * would authorize NOBODY — it would authorize EVERYONE. Nothing else in the
 * system would notice. This mapping is what makes that regression impossible.
 */
const DEFERRED_ROUTE_FILES: Record<string, string> = {
  'PATCH /api/trdd/[id]': 'app/api/trdd/[id]/route.ts',
  'POST /api/trdd/[id]/approve': 'app/api/trdd/[id]/approve/route.ts',
  'POST /api/trdd/[id]/refuse': 'app/api/trdd/[id]/refuse/route.ts',
  'POST /api/trdd/[id]/promote': 'app/api/trdd/[id]/promote/route.ts',
  'POST /api/trdd/[id]/archive': 'app/api/trdd/[id]/archive/route.ts',
}

/**
 * The routes TRDD-D3RP7KQZ decided. Leaving the pending list is necessary but
 * not sufficient — a route dropped from the ledger without a STRICT_AGENT_RULES
 * entry would fall through to the silent `UNDECLARED_MESSAGE` 403, which is the
 * exact failure the ledger exists to prevent. Assert they are genuinely
 * reachable by a MANAGER now.
 */
const DECIDED_BY_D3RP7KQZ = [
  'POST /api/agents/[id]/panel',
  'POST /api/agents/[id]/queue',
  'POST /api/agents/[id]/prompt/answer',
  'PATCH /api/agents/[id]',
]

describe('strict-route agent-path coverage (TRDD-6A2I6ZO0)', () => {
  it('every strict route is DECLARED — mapped, owner-only, or explicitly pending', async () => {
    const undeclared: string[] = []

    for (const routeKey of strictRouteKeys()) {
      if (SYSTEM_OWNER_ONLY_STRICT.has(routeKey)) continue
      if (AGENT_POLICY_PENDING.has(routeKey)) continue

      const [method, ...rest] = routeKey.split(' ')
      if ((await messageFor(method, rest.join(' '))) === UNDECLARED_MESSAGE) {
        undeclared.push(routeKey)
      }
    }

    expect(
      undeclared,
      'These strict routes are declared nowhere, so every agent caller gets a silent, ' +
        `misleading 403:\n  ${undeclared.join('\n  ')}\n` +
        'Map them in STRICT_AGENT_RULES, or declare them owner-only / pending.',
    ).toEqual([])
  })

  it('the pending set is pinned to its inventory and every entry is a real strict route', () => {
    expect([...AGENT_POLICY_PENDING].sort()).toEqual([...PENDING_INVENTORY].sort())

    const strict = new Set(strictRouteKeys())
    for (const routeKey of PENDING_INVENTORY) {
      expect(strict.has(routeKey), `${routeKey} is listed pending but is not a strict route`).toBe(true)
    }
  })

  it('the pending set and the owner-only set are disjoint', () => {
    const overlap = [...AGENT_POLICY_PENDING].filter((r) => SYSTEM_OWNER_ONLY_STRICT.has(r))
    expect(overlap).toEqual([])
  })

  it('a pending route refuses agents with a stated reason, not the fall-through default', async () => {
    // The ledger is EMPTY since TRDD-K2WJH7RF, so looping it would assert
    // nothing — a check that cannot fire is not a check. Exercise the MECHANISM
    // directly instead, so it still works for the next undecided route that
    // lands here (which is the only reason the empty set is kept at all).
    const probe = 'POST /api/trdd/[id]/approve' // a real strict route
    AGENT_POLICY_PENDING.add(probe)
    try {
      const [method, ...rest] = probe.split(' ')
      expect(await messageFor(method, rest.join(' '))).toBe(PENDING_MESSAGE)
    } finally {
      AGENT_POLICY_PENDING.delete(probe)
    }

    // …and the ledger really is empty again afterwards.
    expect([...AGENT_POLICY_PENDING]).toEqual([])
  })

  // ── TRDD-K2WJH7RF ─────────────────────────────────────────────────────────

  it('K2WJH7RF Part 2: the five governance routes are owner-only, not merely delisted', async () => {
    for (const routeKey of K2WJH7RF_OWNER_ONLY) {
      expect(SYSTEM_OWNER_ONLY_STRICT.has(routeKey), `${routeKey} not owner-only`).toBe(true)
      expect(AGENT_POLICY_PENDING.has(routeKey), `${routeKey} still pending`).toBe(false)

      const [method, ...rest] = routeKey.split(' ')
      // A MANAGER — the most privileged AGENT there is — must still be refused,
      // and refused for the STATED reason (not the silent fall-through 403).
      expect(await messageFor(method, rest.join(' ')), routeKey).toBe(OWNER_ONLY_MESSAGE)
    }
  })

  it('K2WJH7RF Part 1: the five TRDD verbs are admitted by the guard and deferred to the route', async () => {
    for (const routeKey of K2WJH7RF_TRDD_VERBS) {
      expect(AGENT_POLICY_PENDING.has(routeKey), `${routeKey} still pending`).toBe(false)
      expect(SYSTEM_OWNER_ONLY_STRICT.has(routeKey), `${routeKey} wrongly owner-only`).toBe(false)

      const [method, ...rest] = routeKey.split(' ')
      // null ⇒ the guard admitted the agent. That is CORRECT here and it is not
      // a hole: the route runs the real authorize('manage-trdd', …) with the
      // tier it read off disk. The next test is what makes that guarantee hold.
      expect(await messageFor(method, rest.join(' ')), routeKey).toBeNull()
    }
  })

  it('K2WJH7RF: every DEFERRED route actually calls authorizeTrddVerb (else it authorizes EVERYONE)', () => {
    // This is the load-bearing test of the whole deferral design. The guard waves
    // these routes through, so the route's own call is the ONLY check. A route
    // that lost it would not fail closed — it would fail OPEN, silently, and let
    // any agent approve any TRDD (its own proposals included).
    const holes: string[] = []

    for (const [routeKey, relPath] of Object.entries(DEFERRED_ROUTE_FILES)) {
      const src = readFileSync(path.join(repoRoot, relPath), 'utf8')
      const imports = /import\s+\{[^}]*\bauthorizeTrddVerb\b[^}]*\}\s+from\s+'@\/lib\/trdd-authz'/.test(src)
      const calls = /\bauthorizeTrddVerb\s*\(\s*auth\b/.test(src)
      if (!imports || !calls) holes.push(`${routeKey}  (${relPath})`)
    }

    expect(
      holes,
      'These routes are DEFERRED by the sudo-guard but do not call authorizeTrddVerb(auth, …).\n' +
        'The guard performs no check on them, so they are wide open to every agent:\n  ' +
        holes.join('\n  '),
    ).toEqual([])
  })

  it('the routes decided by TRDD-D3RP7KQZ are mapped, not merely delisted', async () => {
    for (const routeKey of DECIDED_BY_D3RP7KQZ) {
      expect(AGENT_POLICY_PENDING.has(routeKey), `${routeKey} is still pending`).toBe(false)

      const [method, ...rest] = routeKey.split(' ')
      // null ⇒ requireAidTitle allowed it outright. Any message here means the
      // route resolved to a refusal — including the silent fall-through 403.
      expect(await messageFor(method, rest.join(' ')), routeKey).toBeNull()
    }
  })

  it('a genuinely unknown strict route still fails closed', async () => {
    // Sanity check on the probe itself: without this, the first test could never
    // detect drift, because every route would look "declared".
    expect(await messageFor('POST', '/api/never/registered/route')).toBe(UNDECLARED_MESSAGE)
  })
})
