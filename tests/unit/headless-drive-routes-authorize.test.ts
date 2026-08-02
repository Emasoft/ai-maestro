import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * R42 in HEADLESS mode — the three drive routes must call `authorize()` WITH A TARGET.
 *
 * WHY A SOURCE SCAN AND NOT A ROUTE TEST: the headless auth-mirror suite cannot reach a 403. Its
 * `/stop` and `/restart` cases all use a FORGED bearer and assert **401** — `authenticateAgent`
 * rejects them before `authorize()` is ever consulted — and reaching a 403 needs a real
 * cryptographic AID token the suite has no way to mint. That file records the same limit in its own
 * comments, and it is why two of its assertions are the permissive `expect([401, 403]).toContain(…)`,
 * which passes on a 401 and therefore says nothing about authorization.
 *
 * So the R42 DECISION is pinned behaviourally in `tests/authorization.test.ts` (MANAGER → other →
 * denied, `reason` matching /^R42:/), and what is left unpinned is the WIRING: that these handlers
 * actually consult that decision. That gap is not hypothetical — it is the exact bug TRDD-BF3JN4TL
 * was written about. Headless `/stop` and `/restart` REIMPLEMENT the routes with raw tmux calls and
 * originally called only `authenticateAgent`, and `/chat` — `sendKeys(session, msg, …)`, the most
 * direct injection surface in the product — had NO auth call at all. A rule in `lib/authorization.ts`
 * cannot bind a code path that never calls `authorize()`.
 *
 * A text scan is weaker than a behavioural test and it pins the ONE property whose absence WAS the
 * exploit: an authenticated handler that forgets to authorize. It fails in the suite everyone runs.
 */

const ROUTER = join(__dirname, '..', '..', 'services', 'headless-router.ts')

/** Every `authorize(auth, '<action>', <target>)` call, with whether a target was supplied. */
function authorizeCalls(source: string): { action: string; hasTarget: boolean }[] {
  const out: { action: string; hasTarget: boolean }[] = []
  // Skip comment lines: the router documents the Next.js chain in prose, and matching those
  // would let a DELETED call keep passing on the strength of the comment describing it.
  for (const line of source.split('\n')) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    const m = line.match(/\bauthorize\(\s*auth\s*,\s*'([^']+)'\s*(,)?/)
    if (m) out.push({ action: m[1], hasTarget: Boolean(m[2]) })
  }
  return out
}

/** The actions R42 revokes cross-agent. Kept in sync with DRIVE_ACTIONS in lib/authorization.ts. */
const DRIVE_ACTIONS = ['send-command', 'restart-session']

describe('R42 headless wiring — a drive handler that only authenticates is the original exploit', () => {
  const source = readFileSync(ROUTER, 'utf-8')
  const calls = authorizeCalls(source)

  it('the scan found real calls — a scanner that matches nothing reports clean', () => {
    // Non-vacuity, and the reason the comment-skip above matters: without it this count is
    // satisfied by prose. The floor sits well BELOW the real count (8 at time of writing) on
    // purpose: a floor pinned AT the count is a ratchet, and it reddens under this test's
    // confusing name whenever an unrelated route's authorize call legitimately moves — measured,
    // when a neuter removed /chat's call. What must be pinned per-route is pinned per-route below.
    expect(calls.length).toBeGreaterThanOrEqual(5)
    expect(calls.some((c) => c.action === 'manage-skills')).toBe(true)
  })

  it('POSITIVE CONTROL — the detector distinguishes a targeted call from a bare one', () => {
    expect(authorizeCalls("const d = authorize(auth, 'send-command', target?.id)")).toEqual([
      { action: 'send-command', hasTarget: true },
    ])
    // A bare call is a SELF check and would GRANT — the failure this test exists to catch.
    expect(authorizeCalls("const d = authorize(auth, 'send-command')")).toEqual([
      { action: 'send-command', hasTarget: false },
    ])
    // Prose describing the call must not count as the call.
    expect(authorizeCalls("  // calls authorize(auth, 'send-command', id) like the Next.js route")).toEqual([])
    expect(authorizeCalls("   * authorize(auth, 'manage-skills')")).toEqual([])
  })

  it.each(DRIVE_ACTIONS)('a `%s` authorization exists in the headless router', (action) => {
    expect(calls.filter((c) => c.action === action).length).toBeGreaterThan(0)
  })

  it('EVERY drive authorization passes a TARGET — a bare authorize() is a self-check that grants', () => {
    // The subtle regression: keeping the call and dropping its third argument leaves the code
    // looking authorized while `targetAgentId` is undefined, which is the self case R42.4 permits.
    const untargeted = calls.filter((c) => DRIVE_ACTIONS.includes(c.action) && !c.hasTarget)
    expect(untargeted).toEqual([])
  })

  it('all three drive handlers are covered — stop, restart, and chat', () => {
    // /chat is the one that had NO auth call at all, and it is `sendKeys` straight into a live
    // prompt. Counting them pins that a future edit cannot drop one and leave the other two.
    const drives = calls.filter((c) => DRIVE_ACTIONS.includes(c.action))
    expect(drives.length).toBeGreaterThanOrEqual(3)
    expect(drives.filter((c) => c.action === 'send-command').length).toBeGreaterThanOrEqual(2)
    expect(drives.filter((c) => c.action === 'restart-session').length).toBeGreaterThanOrEqual(1)
  })
})

/**
 * NEUTER RECORD — 2026-08-02
 *
 * (a) Delete the third argument from `/stop`'s call — `authorize(auth, 'send-command')`. Reds 1:
 *       × EVERY drive authorization passes a TARGET
 *     Presence-only checks stay green, which is the point: a call that is present and untargeted
 *     is the regression a "does it call authorize" test cannot see.
 *
 * (b) Delete `/chat`'s call entirely. Reds 1:
 *       × all three drive handlers are covered — stop, restart, and chat
 *     The per-action existence tests stay green, because `/stop` still supplies a `send-command`.
 *     That is exactly why the count matters and a per-action presence check does not suffice.
 *
 *     MEASURED, and it found a defect in THIS FILE: (b) originally reddened 2, the second being
 *     the non-vacuity test, because its floor was set AT the current call count (8) rather than
 *     below it. A floor pinned at the count is a ratchet wearing a floor's name — it fires
 *     whenever any unrelated route's authorize call moves, and it reports that under the heading
 *     "the scan found real calls", which points the next reader at the scanner instead of at
 *     their own edit. Lowered to 5. A prediction that survives unmeasured is how a mis-specified
 *     assertion keeps its reputation.
 */
