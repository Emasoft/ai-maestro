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
 * NEUTER RUN (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/'update'\]/'update', 'some-name']/ if $. == 5431
 *   → 1 red / 4 green:
 *       runs `claude plugin marketplace update` with NO name, exactly once
 * i.e. the exact regression this file exists to catch — a name creeping back into the argv —
 * reds this and nothing else.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const cli = vi.hoisted(() => ({ calls: [] as string[][], fail: false }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (file: string, args: string[], _opts: unknown, cb: (e: Error | null, r?: unknown) => void) => {
      cli.calls.push([file, ...args])
      if (cli.fail) { cb(new Error('CLI refused')); return }
      cb(null, { stdout: '', stderr: '' })
    },
  }
})

import { RefreshAllMarketplaces } from '@/services/element-management-service'

const OWNER = { isSystemOwner: true as const }

beforeEach(() => {
  cli.calls = []
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
