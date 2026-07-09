/**
 * TRDD-D3RP7KQZ — coverage guardrail for the agent-scoped mutation surface.
 *
 * The USER's invariant (2026-07-09): an agent may drive its own surface but may
 * never reconfigure itself, and only a MANAGER, the target's own COS, or the
 * human may reconfigure another agent. `lib/authorization.ts` decides that. A
 * route that never ASKS is not covered by it.
 *
 * `POST /api/agents/[id]/install-skills` was exactly that: `enforceAuth` only
 * AUTHENTICATES — it proves who the caller is and nothing about what they may
 * do — so any authenticated agent could install the skill set onto itself or
 * any other non-Claude agent. Nothing failed; the invariant was simply not
 * enforced there. Found by hand while implementing the decision, which is a bad
 * way to find things.
 *
 * The invariant this test enforces: every MUTATING route under
 * `app/api/agents/[id]/` either performs an authorization step, or is named in
 * UNREVIEWED_INVENTORY below. Adding a new one without deciding its policy
 * fails here instead of shipping an open door.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. This is a source-text check. It can
 * see that a route calls `authorize()` / `requireSudoToken()`, or forwards the
 * caller's `auth.context` into a Change* pipeline (whose Gate 0 calls
 * `authorize()`). It CANNOT verify the action or target passed. So it proves a
 * route does not entirely omit authorization — a real and sufficient property
 * for catching the install-skills class of bug — and nothing finer. The finer
 * question is settled at the `authorize()` boundary, in tests/authorization.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')
const agentScopedRoot = path.join(repoRoot, 'app', 'api', 'agents', '[id]')

/** Routes under app/api/agents/[id]/ that mutate but perform no authorization. */
function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const MUTATING = /^export async function (POST|PUT|PATCH|DELETE)/m

/**
 * The four shapes an authorization step takes in this codebase:
 *   authorize(...)        — the route decides directly
 *   requireSudoToken(...) — strict route; the guard decides (R32 dual-path)
 *   auth.context / authContext — forwarded into a Change* pipeline whose Gate 0
 *                                (`assertAuthorized`) calls authorize() for it
 *   canIssue(...)         — the R28 portfolio route's own mint-authority check
 *                           (title + standing authority). It is deliberately
 *                           NOT sudo-gated and does not call authorize(); it is
 *                           still a real authorization step, so it counts.
 *
 * Each pattern requires the call parenthesis, so a comment merely NAMING one of
 * these (portfolio/route.ts explains at length why it does not call
 * requireSudoToken) does not read as a call.
 */
const AUTHORIZES = /\bauthorize\(|\brequireSudoToken\(|\bcanIssue\(|\bauth\.context\b|\bauthContext\b/

/**
 * Agent-scoped mutating routes with NO authorization step, as of 2026-07-09.
 *
 * This is a DEBT LEDGER of routes nobody has reviewed against the invariant —
 * not a list of routes judged safe. It may SHRINK as each is decided; it must
 * never grow without a deliberate edit here, which is the point.
 *
 * Two are now CLOSED and gone from this list, and both were worse than the
 * ledger's original guess that "several are probably fine":
 *
 *   - `queue/[entryId]` DELETE documented, deliberately, that "any authenticated
 *     caller may cancel a queued entry". Any agent could delete the commands a
 *     MANAGER had queued for the whole fleet, and veto orders queued for itself.
 *     Pinned by tests/unit/queue-cancel-authorization.test.ts.
 *   - `chat` POST ends in `sendKeys(..., {literal:true, enter:true})` — arbitrary
 *     text plus Enter into any agent's pane. It was the unguarded twin of the
 *     `send-command` route. Pinned by tests/unit/chat-send-authorization.test.ts.
 *   - `email/addresses/[address]` PATCH+DELETE let any agent rewrite any agent's
 *     address book, while its THREE siblings already authorized with
 *     `modify-agent`. A missed route, not a policy gap. Pinned by
 *     tests/unit/email-address-authorization.test.ts, which also asserts all four
 *     address routes agree on one action (no split-brain).
 *
 * TWO KNOWN DETECTOR ARTIFACTS in the list below — do NOT "fix" them blindly:
 *   - `metadata/route.ts` DOES authorize, at `ChangeMetadata` gate G00. It only
 *     appears here because it forwards `buildAuthContext(auth)` into the pipeline
 *     rather than calling `authorize()` itself, which the regex cannot see.
 *   - `amp-init/route.ts` has a hand-rolled `isManager(auth.agentId)` check.
 *     Correct today, but it bypasses the matrix — including the self-target rule,
 *     so an agent may re-mint its OWN AMP identity keys. Worth a decision.
 *
 * The audit is TRDD-4Q7WMPZK, which records what each remaining route does.
 */
const UNREVIEWED_INVENTORY = [
  'amp-init/route.ts',
  'element-inventory/route.ts',
  'export/route.ts',
  'messages/[messageId]/route.ts',
  'metadata/route.ts',
  'metrics/route.ts',
  'subconscious/route.ts',
]

function unauthorizedRoutes(): string[] {
  return findRouteFiles(agentScopedRoot)
    .filter((file) => {
      const src = readFileSync(file, 'utf8')
      return MUTATING.test(src) && !AUTHORIZES.test(src)
    })
    .map((file) => path.relative(agentScopedRoot, file))
    .sort()
}

describe('agent-scoped mutation routes authorize the caller (TRDD-D3RP7KQZ)', () => {
  it('every mutating route either authorizes or is an explicitly declared debt', () => {
    const undeclared = unauthorizedRoutes().filter((r) => !UNREVIEWED_INVENTORY.includes(r))

    expect(
      undeclared,
      'These routes mutate an agent but never authorize the caller against it, so any ' +
        `authenticated agent can reconfigure any agent — itself included:\n  ${undeclared.join('\n  ')}\n` +
        'Add an authorization step, or declare it in UNREVIEWED_INVENTORY with a reason.',
    ).toEqual([])
  })

  it('the debt ledger is pinned and contains no route that has since been fixed', () => {
    // A fixed route left in the ledger is a lie in the opposite direction: it
    // makes the debt look larger than it is and hides real progress.
    expect(unauthorizedRoutes().sort()).toEqual([...UNREVIEWED_INVENTORY].sort())
  })

  it('install-skills authorizes — the route this guardrail was written for', () => {
    const src = readFileSync(path.join(agentScopedRoot, 'install-skills', 'route.ts'), 'utf8')
    expect(MUTATING.test(src)).toBe(true)
    expect(src).toMatch(/authorize\(auth, 'manage-skills', id\)/)
  })
})
