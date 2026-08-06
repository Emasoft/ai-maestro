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
const cli = vi.hoisted(() => ({ calls: [] as string[][], opts: [] as unknown[], fail: false }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (file: string, args: string[], opts: unknown, cb: (e: Error | null, r?: unknown) => void) => {
      cli.calls.push([file, ...args])
      cli.opts.push(opts)
      if (cli.fail) { cb(new Error('CLI refused')); return }
      cb(null, { stdout: '', stderr: '' })
    },
  }
})

import { RefreshAllMarketplaces, MARKETPLACE_REFRESH_TIMEOUT_MS } from '@/services/element-management-service'

/** The measured wall-clock of the real argless refresh on this host, 2026-08-06: 275
 *  marketplaces, exit 0, 1082 s. The budget must exceed it or the run is killed 182 s short and
 *  ALL 275 results are discarded — which is what happened live at 10:17:31. */
const MEASURED_REFRESH_SECONDS = 1082

const OWNER = { isSystemOwner: true as const }

beforeEach(() => {
  cli.calls = []
  cli.opts = []
  cli.fail = false
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

  it('gives the refresh a budget LARGER than the measured 1082 s run', async () => {
    // The argless call is all-or-nothing: a cap below the real duration does not degrade the
    // refresh, it voids every one of the 275 results. Asserting "a timeout is present" would pass
    // over the 900 s that shipped, so the assertion is tied to the MEASUREMENT.
    await RefreshAllMarketplaces(OWNER)
    expect(cli.opts[0]).toMatchObject({ timeout: MARKETPLACE_REFRESH_TIMEOUT_MS })
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
