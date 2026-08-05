/**
 * `aimaestro-trdd.sh refuse` must NAME ITS DEFECT (ai-maestro#71 — the USER-ratified refusal
 * protocol in `rules/aimaestro/aimaestro-trdd-approval.md`, "an approver is a GUIDE, not a GATE").
 *
 * WHAT THE RULE ACTUALLY REQUIRES, AND WHY A CLI CAN ONLY ENFORCE PART OF IT. The protocol says a
 * refusal carries three things: the precise defect, the bar for acceptance, and an invitation to
 * re-propose. No mechanical check can tell a real defect from a fluent non-answer — that is a
 * judgement. What a check CAN do is make the CHEAPEST failure impossible: the one-word "denied"
 * that ends the thread. So the guard rejects an empty reason and the stock dismissals, and the
 * error text teaches all three elements, because the remedy is the refuser writing them.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. A bare refusal is malpractice EVEN WHEN THE RULING IS
 * CORRECT. The proposer cannot read the approver's mind: it hears "no", concludes the capability
 * is forbidden, and tears out the work that depended on it. That is the incident the protocol was
 * ratified from — a correct security denial led a plugin Claude to start deleting its own working
 * skills, and the owner caught it by chance.
 *
 * WHY A SUBPROCESS. The guard lives inside the bash function `_gate_verb`, which `approve` and
 * `refuse` SHARE, and every path past it makes an authenticated HTTP call. Driving the real CLI
 * would return an identical auth failure for every input and prove nothing (the same trap
 * measured on ai-maestro#114, where all five values returned one 401 because `check_api_running`
 * refuses before dispatch). This harness sources the script with `_api` stubbed to print a
 * sentinel, which is the only altitude at which "the refusal short-circuited before the request"
 * is a POSITIVE observation rather than an absence.
 *
 * THE ASSERTION IS THE PAIR (exit code, request-made), never the exit code alone. A guard that
 * errored AFTER issuing the POST would still exit non-zero while having already refused the card
 * on the server — the one outcome this is meant to prevent.
 *
 * NEUTER RUN (2026-08-05 — OBSERVED): deleting the whole `if [ "$verb" = "refuse" ]` block reddens
 * the 6 rejection closures below and leaves both positive controls green. The `approve` closure is
 * the one that proves the guard is scoped rather than global — it stays green under BOTH the
 * neuter and the fix, and it would red if the guard were hoisted out of the `refuse` branch, which
 * is the mistake a future edit is most likely to make.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const CLI = path.join(REPO, 'scripts', 'aimaestro-trdd.sh')

/** A syntactically valid 8-char base36 id, so `_check_trdd_id` is never the thing that refuses. */
const ID = 'K3QX9P2W'

/**
 * Drive one `_gate_verb` invocation with the transport stubbed.
 * `AIMAESTRO_TRDD_NO_MAIN` is not needed: sourcing the script defines the functions, and we call
 * the verb ourselves rather than going through the dispatcher.
 */
function run(verb: 'refuse' | 'approve', args: string): { exit: number; requestMade: boolean; stderr: string } {
  const harness = `
    _api() { echo "REQUEST-WAS-MADE" >&2; echo '{}'; }
    source "${CLI}" 2>/dev/null || true
    _api() { echo "REQUEST-WAS-MADE" >&2; echo '{}'; }
    _gate_verb ${verb} ${verb === 'refuse' ? 'reason' : 'rationale'} ${ID} ${args}
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  return {
    exit: r.status ?? -1,
    requestMade: (r.stderr ?? '').includes('REQUEST-WAS-MADE'),
    stderr: r.stderr ?? '',
  }
}

describe('a refusal with no defect never reaches the server', () => {
  it('omitting --reason entirely is refused before the request', () => {
    const r = run('refuse', '')
    expect(r.exit).not.toBe(0)
    // The load-bearing half: exiting non-zero AFTER the POST would have refused the card anyway.
    expect(r.requestMade).toBe(false)
  })

  it('an empty --reason is refused before the request', () => {
    const r = run('refuse', '--reason ""')
    expect(r.exit).not.toBe(0)
    expect(r.requestMade).toBe(false)
  })

  it('a whitespace-only --reason is refused before the request', () => {
    const r = run('refuse', '--reason "   "')
    expect(r.exit).not.toBe(0)
    expect(r.requestMade).toBe(false)
  })

  it('the error teaches all three elements of the protocol, not just "required"', () => {
    const r = run('refuse', '')
    // An error that only says "--reason is required" produces a one-word reason on the retry.
    expect(r.stderr).toMatch(/PRECISE DEFECT/i)
    expect(r.stderr).toMatch(/THE BAR/i)
    expect(r.stderr).toMatch(/INVITATION/i)
  })
})

describe('a stock dismissal is a verdict, not a finding', () => {
  it.each(['denied', 'Rejected', 'wontfix', 'no', 'insufficient', 'out of scope'])(
    '%s is refused before the request',
    (stock) => {
      const r = run('refuse', `--reason "${stock}"`)
      expect(r.exit).not.toBe(0)
      expect(r.requestMade).toBe(false)
      expect(r.stderr).toMatch(/names no defect|verdict, not a finding/i)
    },
  )
})

describe('positive controls — the guard refuses non-answers, not refusals', () => {
  it('a reason that names a defect reaches the server', () => {
    const r = run(
      'refuse',
      '--reason "--exec takes an unsanitized string a malicious agent can pass to a shell; gate it behind a field allowlist first"',
    )
    // Without this the whole file would pass against a guard that rejected EVERYTHING.
    expect(r.requestMade).toBe(true)
  })

  it('approve is deliberately exempt — an approval needs no rationale', () => {
    // Scoping proof: this reds if the guard is ever hoisted out of the `refuse` branch, which is
    // the most likely future mistake. An approval that says nothing is terse; a refusal that says
    // nothing is the failure the protocol exists to stop.
    const r = run('approve', '')
    expect(r.requestMade).toBe(true)
  })
})
