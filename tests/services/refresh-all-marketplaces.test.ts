/**
 * `RefreshAllMarketplaces` — ONE argless `claude plugin marketplace update` for every registered
 * marketplace (TRDD-PE54D95Q, AC1).
 *
 * WHY THE ARGV IS THE ASSERTION. The absorbed lane used to loop `UpdateMarketplace({ name })`,
 * spawning one CLI process per marketplace — 275 of them per tick on this host. The lane's own
 * test can only assert that it calls this function ONCE; it mocks this module, so it never sees
 * what argv reaches the CLI. A regression that quietly re-added a name would keep that count at
 * one and still spawn a narrowed, wrong command. So the argv is pinned HERE, at the only layer
 * that can see it.
 *
 * The argless form is not an assumption: `claude plugin marketplace update --help` reads
 * "Usage: claude plugin marketplace update [options] [name]" / "updates all if no name
 * specified" — verified before this function was written.
 *
 * NEUTER RUNS (all OBSERVED via scripts/dev/neuter, every restore verified by blob hash):
 *   1. s/'update'\]/'update', 'some-name']/    → 1 red / 4 green:
 *        runs `claude plugin marketplace update` with NO name, exactly once
 *      i.e. the exact regression this file exists to catch — a name creeping back into the argv.
 *   2. s/30 * 60 * 1000/900000/ (the constant)  → 1 red / 5 green:
 *        gives the refresh a budget LARGER than the measured 1082 s run
 *      i.e. restoring the cap that shipped reds THAT test and nothing else.
 *   3. s/, { timeout: … }// (drop the option)   → 3 red / 3 green — broader on purpose: removing
 *      the argument shifts promisify's callback position, so the mock's argv recording and the
 *      failure path break too. Removal is caught; run 2 is the one that pins the VALUE.
 *
 * Line numbers are deliberately NOT cited here. The previous version of this block named
 * `$. == 5431`, and the argv line is now 5457 — a coordinate nothing verifies rots silently, and
 * the mutation text alone is unambiguous.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// `opts` is recorded, not discarded. It used to be `_opts`, and that is precisely how a 900 s
// budget shipped against a job measured at 1082 s: the only test that could have seen the timeout
// threw it away.
//
// The mock DISPATCHES ON `file`, because the pipeline now runs two different commands: a `ps`
// snapshot (the G02b in-flight guard) and then the refresh itself. A mock that answered both the
// same way would make `cli.opts[0]` the SNAPSHOT's options while a test named it the refresh's —
// a fixture silently measuring the wrong call.
const cli = vi.hoisted(() => ({
  calls: [] as string[][],
  opts: [] as unknown[],
  fail: false,
  /** The error the fake CLI raises. Defaults to a bare Error; the failure-shape tests replace it
   *  with the object node actually produces (stdout/stderr/killed/signal/code). */
  failErr: null as Error | null,
  /** What the fake `ps` prints. Empty ⇒ nobody is refreshing. */
  ps: '',
  psFail: false,
}))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (file: string, args: string[], opts: unknown, cb: (e: Error | null, r?: unknown) => void) => {
      cli.calls.push([file, ...args])
      cli.opts.push(opts)
      if (file === 'ps') {
        if (cli.psFail) { cb(new Error('ps: command not found')); return }
        cb(null, { stdout: cli.ps, stderr: '' })
        return
      }
      if (cli.fail) { cb(cli.failErr ?? new Error('CLI refused')); return }
      cb(null, { stdout: '', stderr: '' })
    },
  }
})

import {
  RefreshAllMarketplaces,
  MARKETPLACE_REFRESH_TIMEOUT_MS,
  REFRESH_OUTPUT_KEEP_BYTES,
  describeRefreshFailure,
  findForeignMarketplaceRefresh,
} from '@/services/element-management-service'

/** The measured wall-clock of the real argless refresh on this host. The budget must exceed it
 *  or the run is killed short and ALL results are discarded — which is what happened live on
 *  2026-08-06 at 10:17:31 (900 s cap vs 1082 s) and again 3/3 on 2026-08-19 (1800 s cap vs ~1685+ s). */
// 1082 s on 2026-08-06 (275 marketplaces, cold); 1685 s on 2026-08-19 (261 marketplaces, WARM
// registry — a cold run is longer). The cap is asserted against the LARGEST measurement, because
// the 1800 s cap that cleared 1082 s killed the lane 3/3 on the day it measured 1685 s.
const MEASURED_REFRESH_SECONDS = 1685

const OWNER = { isSystemOwner: true as const }

/** Index of the REFRESH call inside the recorded stream, so an options assertion can never end up
 *  reading the `ps` snapshot's options instead. `-1` when the refresh never ran. */
const refreshIdx = () => cli.calls.findIndex(c => c[0] === 'claude' && c[1] === 'plugin' && c[2] === 'marketplace')

beforeEach(() => {
  cli.calls = []
  cli.opts = []
  cli.fail = false
  cli.failErr = null
  cli.ps = ''
  cli.psFail = false
})

describe('RefreshAllMarketplaces — the argless refresh', () => {
  it('runs `claude plugin marketplace update` with NO name, exactly once', async () => {
    const r = await RefreshAllMarketplaces(OWNER)
    expect(r.success).toBe(true)

    const marketplaceCalls = cli.calls.filter(c => c[1] === 'plugin' && c[2] === 'marketplace')
    expect(marketplaceCalls).toHaveLength(1)
    // Exact argv. `toEqual` on the whole array is what rejects a trailing name — a
    // `toContain('update')` would pass happily on `[..., 'update', 'some-name']`.
    expect(marketplaceCalls[0]).toEqual(['claude', 'plugin', 'marketplace', 'update'])
  })

  it('gives the refresh a budget LARGER than the largest measured run (1685 s, 2026-08-19)', async () => {
    // The argless call is all-or-nothing: a cap below the real duration does not degrade the
    // refresh, it voids every one of the 275 results. Asserting "a timeout is present" would pass
    // over the 900 s that shipped, so the assertion is tied to the MEASUREMENT.
    await RefreshAllMarketplaces(OWNER)
    expect(refreshIdx()).toBeGreaterThanOrEqual(0) // the options below belong to the REFRESH call
    expect(cli.opts[refreshIdx()]).toMatchObject({ timeout: MARKETPLACE_REFRESH_TIMEOUT_MS })
    expect(MARKETPLACE_REFRESH_TIMEOUT_MS).toBeGreaterThan(MEASURED_REFRESH_SECONDS * 1000)
  })

  it('reports failure instead of throwing when the CLI refuses', async () => {
    cli.fail = true
    const r = await RefreshAllMarketplaces(OWNER)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/CLI refused/)
  })

  it('does NOT ask for a restart — a catalog refresh changes what is installable, not what is installed', async () => {
    expect((await RefreshAllMarketplaces(OWNER)).restartNeeded).toBe(false)
  })
})

describe('RefreshAllMarketplaces — the gates it keeps', () => {
  it('refuses without an authContext, and runs no CLI at all', async () => {
    const r = await RefreshAllMarketplaces(null as never)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/authContext is mandatory/)
    expect(cli.calls).toHaveLength(0) // the refusal is BEFORE the side effect, not after
  })

  it('refuses a non-owner AGENT — refreshing every catalog is host-wide, so it stays owner-only', async () => {
    // The IRON rule (assertAgentMayNotUserScope). A marketplace is inherently global, so every
    // agent that later installs from any of them inherits whatever this pulled — which makes
    // refreshing ALL of them at least as privileged as refreshing one, never less.
    const r = await RefreshAllMarketplaces({ isSystemOwner: false, agentId: 'some-agent' } as never)
    expect(r.success).toBe(false)
    expect(cli.calls).toHaveLength(0)
  })
})

// ── G02b: the in-flight guard ────────────────────────────────────────────────
//
// WHY IT EXISTS (TRDD-PE54D95Q, measured). Two executors run this same chore on this host — this
// server and the ai-maestro-janitor daemon — and they share no lock. Uncontended the command runs
// ~1148 s; the janitor logged 84 / 1134 / 1254 / 1808 / 1815 s for it, so 2 of 5 crossed the
// 3600 s cap, and the batch is all-or-nothing: a run killed at the cap discards EVERY result.
//
// NEUTER RUNS for this section — all OBSERVED at 20 tests, every restore verified by blob hash:
//   4. s/if (foreignPid !== null) {/if (false) {/   (disarm the guard)   → 1 red / 19 green:
//        SKIPS, spawning no refresh at all, when another process is already running one
//      Note it reds ONLY that one: "proceeds normally" and "FAILS OPEN" both assert that the
//      refresh RUNS, which a disarmed guard also produces. That asymmetry is expected, and it is
//      why the skip test asserts `refreshIdx() === -1` rather than merely reading the result.
//   5. s/words[i + 1] === 'marketplace' && words[i + 2] === 'update'/words.includes('marketplace')
//      && words.includes('update')/  (drop consecutiveness)             → 1 red / 19 green:
//        requires the three words CONSECUTIVE …
//   6. `} catch { return -1 }` in foreignMarketplaceRefreshPid (fail CLOSED) → 1 red / 19 green:
//        FAILS OPEN when `ps` itself is unusable …
//      i.e. without it an unreadable `ps` silently stops the lane forever.
//   9. s/if (pid === selfPid) continue/if (false) continue/             → 1 red / 19 green:
//        never reports OUR OWN process, even when its argv carries the needle

/** Real `ps -eo pid,command` shape: a header line, right-aligned pids, then the full argv. */
const psHeader = '  PID COMMAND'

describe('findForeignMarketplaceRefresh — the pure predicate', () => {
  it('returns the pid of a marketplace refresh that is already running', () => {
    const snap = [
      psHeader,
      '    1 /sbin/launchd',
      ' 4242 /opt/homebrew/bin/node /opt/homebrew/bin/claude plugin marketplace update',
    ].join('\n')
    expect(findForeignMarketplaceRefresh(snap, 999)).toBe(4242)
  })

  it('returns null when nothing is refreshing — the header and unrelated processes are not matches', () => {
    const snap = [
      psHeader,
      '    1 /sbin/launchd',
      ' 7777 node /Users/x/ai-maestro/server.mjs',
      ' 8888 ps -eo pid,command',
    ].join('\n')
    expect(findForeignMarketplaceRefresh(snap, 7777)).toBeNull()
  })

  it('requires the three words CONSECUTIVE — a line that merely contains all of them is not a refresh', () => {
    // The fixture carries all three as BARE words, just not adjacent — so relaxing the check to
    // "contains each of them" matches this line and the test reds. A fixture spelling them
    // `plugin.log marketplace.log update.log` would pin nothing: `plugin.log` is not `plugin`, so
    // it fails the very first comparison and passes with the guard relaxed.
    const snap = [
      psHeader,
      ' 5150 node scripts/reindex.js plugin marketplace --mode update',
    ].join('\n')
    expect(findForeignMarketplaceRefresh(snap, 999)).toBeNull()
  })

  it('matches a wrapper form that never mentions `claude` — the needle is the argv, not the binary name', () => {
    // Deliberate: requiring `claude` would MISS a wrapper the janitor might use, and a miss
    // re-admits the collision. A false positive only costs one skipped round.
    const snap = [psHeader, ' 6060 /bin/sh -c cc plugin marketplace update'].join('\n')
    expect(findForeignMarketplaceRefresh(snap, 999)).toBe(6060)
  })

  it('never reports OUR OWN process, even when its argv carries the needle', () => {
    // The fixture puts the needle on selfPid on purpose — with the exclusion removed this line
    // matches and the test reds, so the guard is pinned rather than merely present.
    const snap = [psHeader, ' 4242 claude plugin marketplace update'].join('\n')
    expect(findForeignMarketplaceRefresh(snap, 4242)).toBeNull()
  })
})

describe('RefreshAllMarketplaces — G02b skips rather than collides', () => {
  it('SKIPS, spawning no refresh at all, when another process is already running one', async () => {
    cli.ps = [psHeader, ' 4242 claude plugin marketplace update'].join('\n')
    const r = await RefreshAllMarketplaces(OWNER)

    // No refresh was spawned — the whole point. Asserting only on the result would pass over a
    // guard that reported a skip AND ran the command anyway.
    expect(refreshIdx()).toBe(-1)
    // A skip is neither a failure nor a plain success: `success` stays true (nothing went wrong)
    // and `skipped` carries the reason, so the caller can report it honestly.
    expect(r.success).toBe(true)
    expect(r.skipped).toMatch(/4242/)
    expect(r.operations.join('\n')).toMatch(/G02b: SKIPPED/)
  })

  it('proceeds normally when the snapshot shows nobody refreshing', async () => {
    cli.ps = [psHeader, ' 7777 node server.mjs'].join('\n')
    const r = await RefreshAllMarketplaces(OWNER)
    expect(r.success).toBe(true)
    expect(r.skipped).toBeUndefined()
    expect(cli.calls[refreshIdx()]).toEqual(['claude', 'plugin', 'marketplace', 'update'])
  })

  it('FAILS OPEN when `ps` itself is unusable — an unreadable observer must not stop the chore', async () => {
    // The opposite choice turns one broken observer into a permanent outage of the thing observed:
    // the lane would skip forever and nothing would say why.
    cli.psFail = true
    const r = await RefreshAllMarketplaces(OWNER)
    expect(r.skipped).toBeUndefined()
    expect(cli.calls[refreshIdx()]).toEqual(['claude', 'plugin', 'marketplace', 'update'])
    expect(r.success).toBe(true)
  })
})

// ── describeRefreshFailure: the recorded cause ───────────────────────────────
//
// WHY (measured 2026-08-16). The catch stored `err.message` alone. For promisified `execFile`
// that is `Command failed: <cmd>\n<stderr>` — and this CLI writes to **stdout**, leaving stderr
// EMPTY. So all 12 recorded failures between 2026-08-06 and 2026-08-15 read exactly
// `Command failed: claude plugin marketplace update\n` and nothing else: a defect that recurred
// for ten days and left no cause behind, while `err.stdout` held the answer and was discarded.
//
// NEUTER RUNS — OBSERVED, every restore verified by blob hash:
//   7. s/if (out) parts.push/if (false) parts.push/  (discard stdout again) → 3 red / 17 green:
//        keeps stdout, because this CLI reports there and stderr is empty
//        clamps from BOTH ends and marks the cut, never keeping only the tail
//        is WIRED — a real pipeline failure carries the CLI output into result.error
//      Three, because the clamping and the wiring both reach the CLI's output through this line —
//      i.e. re-introducing the exact ten-day defect reds the helper AND the pipeline test.
//   8. s/const timedOut = e.killed === true && typeof e.code !== 'number'/const timedOut = false/
//                                                                        → 1 red / 19 green:
//        names a TIMEOUT and its budget when node killed the process

/** The error object node actually hands you — not a bare `new Error()`. */
const execFileError = (over: Record<string, unknown>) =>
  Object.assign(new Error('Command failed: claude plugin marketplace update\n'), over) as Error

describe('describeRefreshFailure', () => {
  it('keeps stdout, because this CLI reports there and stderr is empty', () => {
    const s = describeRefreshFailure(execFileError({
      code: 1,
      stdout: 'Repository not found: some/marketplace',
      stderr: '',
    }))
    expect(s).toMatch(/Repository not found: some\/marketplace/)
  })

  it('names a TIMEOUT and its budget when node killed the process', () => {
    // A timeout and a refusal have opposite remedies (raise the cap vs fix the config), and
    // `err.message` is identical for both — so the string has to separate them.
    const s = describeRefreshFailure(execFileError({ killed: true, signal: 'SIGTERM' }))
    expect(s).toMatch(/^TIMEOUT after 3600s/)
    expect(s).toMatch(/SIGTERM/)
  })

  it('still names the TIMEOUT when the CLI handled SIGTERM and exited 1 (killed:true, code:1, signal:null)', () => {
    // The real shape on 2026-08-19: node's timeout sent SIGTERM, `claude` caught it and exited 1,
    // so node reports killed:true + a NUMERIC code + no signal. The old heuristic required
    // "killed without an exit code" and recorded three consecutive 30-min timeouts as a bare
    // "Command failed" — which reads as a crash, the opposite remedy.
    const s = describeRefreshFailure(execFileError({ killed: true, code: 1, signal: null, stdout: 'Updating 261 marketplace(s)...' }))
    expect(s).toMatch(/^TIMEOUT after 3600s/)
    expect(s).toMatch(/CLI exited 1/)
    expect(s).toMatch(/Updating 261 marketplace/)
  })

  it('does NOT call a non-zero exit a timeout', () => {
    const s = describeRefreshFailure(execFileError({ code: 1, killed: false, stdout: 'nope' }))
    expect(s).not.toMatch(/TIMEOUT/)
  })

  it('says so explicitly when the CLI printed nothing at all', () => {
    // "no output" is itself evidence. A bare message leaves the reader unable to tell that from
    // "we threw the output away", which is the bug this function was written for.
    expect(describeRefreshFailure(execFileError({ code: 1 }))).toMatch(/produced no output on either stream/)
  })

  it('clamps from BOTH ends and marks the cut, never keeping only the tail', () => {
    // A CLI prints its DIAGNOSIS first and the raw error last, so `tail` keeps exactly the wrong
    // end and `head` loses the cause.
    const big = `HEAD-MARKER${'x'.repeat(REFRESH_OUTPUT_KEEP_BYTES * 2)}TAIL-MARKER`
    const s = describeRefreshFailure(execFileError({ code: 1, stdout: big }))
    expect(s).toMatch(/HEAD-MARKER/)
    expect(s).toMatch(/TAIL-MARKER/)
    expect(s).toMatch(/bytes elided/)
    expect(s.length).toBeLessThan(big.length)
  })

  it('is WIRED — a real pipeline failure carries the CLI output into result.error', async () => {
    // Testing the helper alone would leave "is it actually used?" unasked; the catch used to
    // build this string inline and drop exactly this field.
    cli.fail = true
    cli.failErr = execFileError({ code: 1, stdout: 'Repository not found: gone/marketplace' })
    const r = await RefreshAllMarketplaces(OWNER)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Repository not found: gone\/marketplace/)
  })
})
