/**
 * §6.4 of docs/SCRIPT-MANIFEST.md — `--help` is a LOCAL, OFFLINE operation and exits 0.
 *
 * TRDD-T3FXA0Y0 (ai-maestro#121). The exit status is the fleet's only machine-readable
 * success signal, and it was uncorrelated with the outcome in all three directions: exit 0
 * on an impossible filter (#114), exit 1 on a fully successful `create`, and exit 1 with no
 * message at all on a real failure.
 *
 * `--help` is the smallest total case of the contract, and the one every caller hits first.
 * It needs no server, no network and no credential, so there is no defensible reason for it
 * to fail — yet `aimaestro-agent.sh --help` exited 1, because `check_api_running || exit 1`
 * ran BEFORE the dispatch. An unauthenticated caller got a 401 diagnostic INSTEAD of the
 * help text: the CLI was undiscoverable at exactly the moment someone needed it.
 *
 * WHY THIS IS A RATCHET AND NOT A PASS/FAIL. Measured 2026-08-05: 29 of 50 deployed CLIs
 * violate. Asserting zero today would mean a permanently red suite, and a permanently red
 * test gets deleted or skipped — so it would protect nothing. Instead the KNOWN-BAD list is
 * pinned by name and the count may only FALL. Fixing one means deleting its line here; a
 * NEW violation fails immediately, because it is not on the list.
 *
 * It runs against the REPO's scripts, never `~/.local/bin` — a deployed dir is one machine's
 * snapshot, and SCRIPT-MANIFEST.md §5 documents that using it as truth is how this drifts.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'

const SCRIPTS = join(process.cwd(), 'scripts')

/**
 * The scripts that still violate §6.4, by name. THIS LIST MAY ONLY SHRINK.
 *
 * **27 amp-* entries were removed on 2026-08-05 (TRDD-3KJW8P6R).** They shared one root:
 * `amp-helper.sh` resolved AMP identity at SOURCE time, so `--help` died before the calling
 * script's own (correct) help branch was ever reached. The helper now recognises a help-only
 * invocation and skips resolution — WITHOUT weakening the identity abort, which still refuses
 * a real operation and still declines to print a pickable uuid list. Verified in the same run
 * as the fix: 31/31 print help with no identity; a real `amp-send` from an unbound session
 * still exits 1 with zero uuid-shaped strings in its output.
 *
 * `aid-auth.sh` REMAINS, and for a different reason: it PRINTS a token to stdout, so `--help`
 * is not a distinct verb for it — deciding what help even means there is a design question,
 * not the identity bug. Left listed rather than quietly exempted.
 */
const KNOWN_VIOLATORS = new Set([
  'aid-auth.sh',
])

/** Tier-A + amp/aid surface: the scripts a plugin may invoke. */
const CANDIDATES = existsSync(SCRIPTS)
  ? readdirSync(SCRIPTS)
      .filter((f) => /^(aimaestro|amp|aid)-.*\.sh$/.test(f))
      .sort()
  : []

function helpExitCode(script: string): number {
  try {
    execFileSync('bash', [join(SCRIPTS, script), '--help'], {
      stdio: 'pipe',
      timeout: 20_000,
      // No AID_AUTH, no session: --help must work for a caller with NO credential.
      // That is the whole claim, so the environment has to actually lack one.
      env: { ...process.env, AID_AUTH: '', AIMAESTRO_SESSION: '', AIMAESTRO_SUDO_TOKEN: '' },
    })
    return 0
  } catch (err) {
    const e = err as { status?: number }
    return typeof e.status === 'number' ? e.status : 1
  }
}

describe('the scan is real — "0 violations" must not be what an empty list returns', () => {
  it('found the CLI surface', () => {
    expect(CANDIDATES.length).toBeGreaterThan(40)
  })

  it('includes the script this contract was written for', () => {
    expect(CANDIDATES).toContain('aimaestro-agent.sh')
  })
})

describe('SCRIPT-MANIFEST §6.4 — `--help` exits 0 with no server and no credential', () => {
  const compliant = CANDIDATES.filter((s) => !KNOWN_VIOLATORS.has(s))

  it.each(compliant)('%s --help exits 0', (script) => {
    expect(helpExitCode(script)).toBe(0)
  })

  it('the known-violator list may only SHRINK — no new violations', () => {
    // A name on the list that now PASSES is not a failure, it is progress that
    // nobody recorded; the list is stale and must be trimmed. Reported separately
    // from a genuine regression so the two are never confused.
    const fixed = [...KNOWN_VIOLATORS].filter((s) => CANDIDATES.includes(s) && helpExitCode(s) === 0)
    expect(
      fixed,
      `These are FIXED but still listed as known violators. Delete them from ` +
        `KNOWN_VIOLATORS — the list is a ratchet and must fall as they are fixed:\n` +
        fixed.join('\n'),
    ).toEqual([])
  })

  it('TRUE POSITIVE — a real amp operation from an UNBOUND session is still refused', () => {
    // TRDD-3KJW8P6R. The help-only skip in amp-helper.sh must not have weakened the identity
    // gate, and every assertion above is satisfied by a fix that simply disables it — so this
    // runs in the SAME suite, which is the only arrangement that can catch that trade.
    //
    // Two claims, because "it refused" is not enough: the abort is deliberately written to
    // name only the paths that PROVE identity and to REFUSE to print a pickable uuid list.
    // An unbound session copying a live peer's uuid is the exact state-corrupting act the
    // message exists to prevent — an error must not hand the caller the exploit.
    //
    // NEUTER RUN (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
    //   s/exit 1/exit 0/ if $. == 343     (the identity abort in amp-helper.sh)
    //   → 1 red / 55 green: this test, and ONLY this test.
    // The 55 help assertions are indifferent to it, which is the whole point — they would
    // stay green through a "fix" that simply stopped aborting.
    //
    // What this does NOT catch, stated rather than implied: widening the help-only `case`
    // to match every invocation. That shortcut leaves AMP_DIR at the nonexistent sentinel,
    // so a real send still fails and still prints no uuid — the outcome is identical and no
    // assertion here can tell them apart. It is caught upstream instead, by the sentinel
    // being a path that cannot exist rather than a plausible default.
    let status = 0
    let output = ''
    try {
      execFileSync('bash', [join(SCRIPTS, 'amp-send.sh'), 'someone', 'subject', 'body'], {
        stdio: 'pipe',
        timeout: 20_000,
        env: {
          ...process.env,
          AID_AUTH: '',
          AIM_AGENT_ID: '',
          AIM_AGENT_NAME: '',
          AMP_DIR: '',
          AGENT_WORK_DIR: '',
        },
      })
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer }
      status = typeof e.status === 'number' ? e.status : 1
      output = `${e.stderr?.toString() ?? ''}${e.stdout?.toString() ?? ''}`
    }

    expect(status, 'an unbound session must NOT be able to send').not.toBe(0)
    expect(
      output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [],
      'the refusal must not print a pickable uuid list',
    ).toEqual([])
  })

  it('an UNKNOWN VERB is reported locally, without blaming the server', () => {
    // TRDD-T3FXA0Y0 box 3, third instance of the gate-ordering defect. Recognising a verb
    // is a LOCAL, OFFLINE determination — `aimaestro-agent.sh nonsense` is wrong on a host
    // with no network, and the script already knows it. With `check_api_running` first, the
    // caller was told "the API is not reachable", so someone who typo'd a verb went and
    // debugged a server that had nothing to do with it.
    //
    // The second assertion is the load-bearing one. Exit 1 was ALREADY correct before the
    // fix — the gate exits 1 too — so a test asserting only the status passes either way
    // and pins nothing. What changed is WHICH failure is reported, and the only way to see
    // that is to assert the server is NOT blamed.
    //
    // NEUTER RUN (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
    //   s/^    dispatch check /    check_api_running || exit 1; dispatch check / if $. == 172
    //   (i.e. put the gate back in front of recognition — the pre-fix ordering)
    //   → 1 red / 56 green: this test, and ONLY this test.
    let status = 0
    let output = ''
    try {
      execFileSync('bash', [join(SCRIPTS, 'aimaestro-agent.sh'), 'nonsense-verb'], {
        stdio: 'pipe',
        timeout: 20_000,
        env: { ...process.env, AID_AUTH: '', AIMAESTRO_SESSION: '', AIMAESTRO_SUDO_TOKEN: '' },
      })
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer }
      status = typeof e.status === 'number' ? e.status : 1
      output = `${e.stderr?.toString() ?? ''}${e.stdout?.toString() ?? ''}`
    }

    expect(status, 'an unknown verb must be a failure').not.toBe(0)
    expect(output, 'the caller typo\'d a verb — do not send them to debug the server').not.toMatch(
      /not reachable|not running|HTTP 401|:23000/i,
    )
    expect(output, 'and it must say what was actually wrong').toMatch(/Unknown command/i)
  })

  it('every listed violator still exists (no stale names hiding a deleted script)', () => {
    const ghosts = [...KNOWN_VIOLATORS].filter((s) => !CANDIDATES.includes(s))
    expect(ghosts, `KNOWN_VIOLATORS names scripts that no longer exist: ${ghosts.join(', ')}`).toEqual([])
  })
})
