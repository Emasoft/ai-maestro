/**
 * `aimaestro-trdd.sh approve|refuse --tier` is a DEAD FLAG, and must behave like one
 * (ai-maestro#69 item 2).
 *
 * WHAT WAS ACTUALLY WRONG — three defects on one flag, pointing in opposite directions:
 *
 *   (a) The server RETIRED the numeric `tier` body field (ai-maestro#66 Q9).
 *       `app/api/trdd/[id]/approve/route.ts` reads only {approver, rationale, agentId};
 *       `refuse/route.ts` only {approver, reason, agentId} — it has never read `tier` at all,
 *       though its docstring advertised one until this change. So the CLI serialised the value
 *       into a body that discarded it, and the caller got a SUCCESS while believing they had
 *       set the approval requirement.
 *   (b) The validator demanded a NUMBER, so the five canonical ladder names — which
 *       `docs/SCRIPT-MANIFEST.md` publishes in the same section as this flag — were rejected
 *       outright. The error taught the wrong vocabulary to precisely the reader who had just
 *       read the ladder.
 *   (c) It accepted ANY number, so `--tier 9` passed validation and then evaporated.
 *
 * WHY THE FIX IS NOT "WIRE IT UP". The approval requirement is the CARD's property, decided by
 * the D3 objective floor. A flag letting the approver name the tier would let them lower the bar
 * they must clear — a governance hole, not a convenience. So the flag is made honest, not live.
 *
 * WHY IT IS STILL ACCEPTED. The skill-facing CLI is frozen (R23): every previously-valid call
 * still works, with identical stdout and exit code and one added stderr line. The one behaviour
 * that DID change is an unmatchable value now failing, on the ai-maestro#114 precedent — a value
 * that silently does nothing is indistinguishable from one that worked.
 *
 * WHY THIS HARNESS OBSERVES THE BODY. The load-bearing claim is "no `tier` reaches the server",
 * and no exit code can see that: the old code exited 0 too, because the server accepted the
 * request and ignored the field. Only the request body discriminates the fix from the bug. The
 * `_api` stub therefore echoes its third argument, which is the only altitude at which "the
 * field is absent" is a POSITIVE observation rather than an absence.
 *
 * WHY `approve` AND NOT `refuse`. `refuse` runs the ai-maestro#71 reason guard first, which can
 * refuse the call for a reason that has nothing to do with `--tier` — and then every assertion
 * here would pass while testing a branch it does not name. `approve` reaches the body builder
 * with the tier block as the only gate in the way.
 *
 * NEUTER RUNS (2026-08-05 — run through `scripts/dev/neuter`, which proves the mutation landed
 * and restores by blob hash; these are the OBSERVED counts, and the first draft of this comment
 * predicted "1 red" for each and was wrong about both):
 *   1. the rejection arm's `return 1 ;;` → `tier_norm=unmatched ;;`
 *      → 2 red / 12 green: `an unmatchable --tier is refused before the request` and
 *        `a non-ladder word is refused before the request`.
 *      `the rejection teaches the ladder…` stayed GREEN, which is informative rather than slack:
 *      the mutation leaves the three echo lines standing, so that closure pins the MESSAGE and
 *      not the refusal. No other closure here could tell those two apart.
 *   2. the jq seed `{}` → `{tier: "2"}`, re-injecting the field into every request body
 *      → 2 red / 12 green: `the deprecated --tier is NOT sent to the server` and
 *        `a legacy numeric --tier is still accepted, and still not sent`.
 * The two red sets are DISJOINT, so the two halves of the fix — reject-the-unmatchable and
 * never-send — are pinned independently rather than jointly.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const CLI = path.join(REPO, 'scripts', 'aimaestro-trdd.sh')

/** A syntactically valid 8-char base36 id, so `_check_trdd_id` is never the thing that refuses. */
const ID = 'K3QX9P2W'

interface Run {
  exit: number
  requestMade: boolean
  /** The JSON body handed to `_api`, or null when no request was made. */
  body: Record<string, unknown> | null
  stderr: string
}

/**
 * Drive one `_gate_verb` invocation with the transport stubbed.
 * `_api` is called as `_api POST <path> <body>`, so `$3` is the request body.
 */
function run(verb: 'approve' | 'refuse', args: string): Run {
  const stub = `_api() { echo "REQUEST-WAS-MADE" >&2; echo "BODY:$3" >&2; echo '{}'; }`
  const harness = `
    ${stub}
    source "${CLI}" 2>/dev/null || true
    ${stub}
    _gate_verb ${verb} ${verb === 'refuse' ? 'reason' : 'rationale'} ${ID} ${args}
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  const stderr = r.stderr ?? ''
  const m = stderr.match(/^BODY:(.*)$/m)
  return {
    exit: r.status ?? -1,
    requestMade: stderr.includes('REQUEST-WAS-MADE'),
    body: m ? JSON.parse(m[1]) : null,
    stderr,
  }
}

describe('the deprecated --tier never reaches the server', () => {
  it('the deprecated --tier is NOT sent to the server', () => {
    const r = run('approve', '--tier manager')
    // The whole point: the request still succeeds, so only the BODY can tell the fix from the
    // bug. Asserting the exit code here would pass against the code this test replaces.
    expect(r.requestMade).toBe(true)
    expect(r.body).not.toBeNull()
    expect(Object.keys(r.body!)).not.toContain('tier')
  })

  it('a legacy numeric --tier is still accepted, and still not sent', () => {
    // The frozen-contract half (R23): a call that worked before must still work.
    const r = run('approve', '--tier 2')
    expect(r.exit).toBe(0)
    expect(r.requestMade).toBe(true)
    expect(Object.keys(r.body!)).not.toContain('tier')
  })
})

describe('--tier speaks the ladder the manifest publishes', () => {
  it.each(['none', 'orchestrator', 'chief-of-staff', 'manager', 'user'])(
    'the canonical ladder name %s is accepted',
    (name) => {
      // Every one of these was a hard error before the fix ("--tier must be a number (0-3)"),
      // which is what made the CLI teach a vocabulary its own manifest contradicted.
      const r = run('approve', `--tier ${name}`)
      expect(r.exit).toBe(0)
      expect(r.requestMade).toBe(true)
    },
  )

  it('an unmatchable --tier is refused before the request', () => {
    // `9` passed the old numeric check and then evaporated. The pair (exit, requestMade) is the
    // assertion: erroring AFTER the POST would have approved the card anyway.
    const r = run('approve', '--tier 9')
    expect(r.exit).not.toBe(0)
    expect(r.requestMade).toBe(false)
  })

  it('a non-ladder word is refused before the request', () => {
    const r = run('approve', '--tier bogus')
    expect(r.exit).not.toBe(0)
    expect(r.requestMade).toBe(false)
  })

  it('the rejection teaches the ladder rather than the retired numeric range', () => {
    const r = run('approve', '--tier bogus')
    expect(r.stderr).toMatch(/none < orchestrator < chief-of-staff < manager < user/)
  })
})

describe('the deprecation notice says where the requirement actually comes from', () => {
  it('names min-approval-requirement, not just "deprecated"', () => {
    // A notice that only says "deprecated" leaves the caller with no way to do the thing they
    // were trying to do, which is how a dead flag survives: everyone keeps passing it.
    const r = run('approve', '--tier manager')
    expect(r.stderr).toMatch(/min-approval-requirement/)
    expect(r.stderr).toMatch(/--set min-approval-requirement=manager/)
  })

  it('flags the one numeric rung that cannot be decoded unambiguously', () => {
    // 1 is chief-of-staff OR orchestrator depending on dispatch scope. Silently picking one
    // would be the same class of lie this whole change removes.
    const r = run('approve', '--tier 1')
    expect(r.stderr).toMatch(/AMBIGUOUS/)
    expect(r.stderr).toMatch(/orchestrator/)
  })
})

describe('positive controls', () => {
  it('omitting --tier entirely still works and still sends the other fields', () => {
    // Without this the file would pass against a build that rejected or dropped everything.
    const r = run('approve', '--approver manager-bot --rationale "meets the floor"')
    expect(r.exit).toBe(0)
    expect(r.requestMade).toBe(true)
    expect(r.body).toMatchObject({ approver: 'manager-bot', rationale: 'meets the floor' })
  })

  it('omitting --tier emits no deprecation notice', () => {
    const r = run('approve', '--approver manager-bot')
    expect(r.stderr).not.toMatch(/DEPRECATED/)
  })
})
