// R42.7 — the server-as-daemon fleet restart (TRDD-QZL828OD).
//
// 0-IMPACT BY CONSTRUCTION: every collaborator is an injected dep, so nothing here
// reads the developer's real registry, touches `~/.aimaestro`, or runs tmux. There
// is no fake-$HOME to get wrong because no code path resolves a home dir.
//
// Each test names the R42.7 constraint it pins, because the constraints are the
// grant: the ruling permits this operation ONLY while all six hold, so a test suite
// that proved the happy path and nothing else would be certifying a different,
// broader capability than the one that was approved.

import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { restartHarnessFleet } from '@/lib/fleet-restart-driver'
import type { FleetRestartOutcome, FleetRestartTarget } from '@/lib/fleet-restart-driver'
import { restartFleetForSessions, restartEntireHarnessFleet } from '@/lib/fleet-restart-fanout'

const agent = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  name,
  workingDirectory: `/Users/tester/agents/${name}`,
  program: 'claude',
  programArgs: '',
  ...extra,
})

/** A prep stub that always succeeds — the driver's own behaviour is what's under
 *  test, not the command build (that has its own coverage via the route). */
const readyPrep = vi.fn(async () => ({
  kind: 'ready' as const,
  command: 'claude --name "x"',
  bin: 'claude',
  continueConversation: false,
}))

describe('restartHarnessFleet — R42.7(c) safe-state gate', () => {
  it('SKIPS an agent with background subagents running instead of restarting it', async () => {
    const runRestartSequence = vi.fn(async () => ({ status: 'ok' as const, command: 'c' }))
    const out = await restartHarnessFleet([{ sessionName: 'busy', agent: agent('busy') }], 'test', {
      prepareRelaunchCommand: readyPrep,
      runRestartSequence,
      readSubagentCount: () => 3,
      evaluateExitGate: (count, force) => ({ blocked: !force && count !== null && count > 0, subagentCount: count }),
      emitAgentOp: vi.fn(),
      log: () => {},
    })

    expect(out).toEqual([
      { sessionName: 'busy', disposition: 'skipped-busy', detail: '3 background subagent(s) running' },
    ])
    // The load-bearing half: it did not merely REPORT a skip, it never ran the sequence.
    expect(runRestartSequence).not.toHaveBeenCalled()
  })

  it('never passes force=true — a daemon that can force can interrupt a working agent', async () => {
    const evaluateExitGate = vi.fn(
      (_count: number | null, _force: boolean) => ({ blocked: false, subagentCount: 0 as number | null }),
    )
    await restartHarnessFleet([{ sessionName: 'a', agent: agent('a') }], 'test', {
      prepareRelaunchCommand: readyPrep,
      runRestartSequence: vi.fn(async () => ({ status: 'ok' as const, command: 'c' })),
      readSubagentCount: () => 0,
      evaluateExitGate,
      emitAgentOp: vi.fn(),
      log: () => {},
    })
    expect(evaluateExitGate).toHaveBeenCalledWith(0, false)
    // Pinned as an ABSENCE too: `force` has no caller-supplied route into the driver,
    // so no invocation may ever carry true. A future `force` option reddens here.
    for (const call of evaluateExitGate.mock.calls) expect(call[1]).toBe(false)
  })

  it('restarts an idle agent and records it in the ledger — R42.7(e)', async () => {
    const emitAgentOp = vi.fn()
    const out = await restartHarnessFleet([{ sessionName: 'idle', agent: agent('idle') }], 'plugin update', {
      prepareRelaunchCommand: readyPrep,
      runRestartSequence: vi.fn(async () => ({ status: 'ok' as const, command: 'c' })),
      readSubagentCount: () => 0,
      evaluateExitGate: () => ({ blocked: false, subagentCount: 0 }),
      emitAgentOp,
      log: () => {},
    })

    expect(out).toEqual([{ sessionName: 'idle', disposition: 'restarted' }])
    expect(emitAgentOp).toHaveBeenCalledTimes(1)
    const [op, diff] = emitAgentOp.mock.calls[0]
    expect(op).toBe('fleet_restart')
    // The REASON must be in the entry: an audit row that says "a restart happened"
    // cannot distinguish a plugin-update fan-out from anything else.
    expect(diff).toMatchObject({ sessionName: 'idle', agentId: 'id-idle', reason: 'plugin update' })
  })

  it('does NOT write a ledger entry when the restart failed', async () => {
    const emitAgentOp = vi.fn()
    const out = await restartHarnessFleet([{ sessionName: 'a', agent: agent('a') }], 'test', {
      prepareRelaunchCommand: readyPrep,
      runRestartSequence: vi.fn(async () => ({ status: 'timeout' as const })),
      readSubagentCount: () => 0,
      evaluateExitGate: () => ({ blocked: false, subagentCount: 0 }),
      emitAgentOp,
      log: () => {},
    })
    expect(out[0].disposition).toBe('failed')
    // An audit trail that claims restarts that never happened is worse than none.
    expect(emitAgentOp).not.toHaveBeenCalled()
  })

  it('one unpreparable agent does not stop the rest of the fleet', async () => {
    const runRestartSequence = vi.fn(async () => ({ status: 'ok' as const, command: 'c' }))
    const out = await restartHarnessFleet(
      [
        { sessionName: 'bad', agent: agent('bad') },
        { sessionName: 'good', agent: agent('good') },
      ],
      'test',
      {
        prepareRelaunchCommand: vi.fn(async (a: { name?: string } | null | undefined) =>
          a?.name === 'bad'
            ? { kind: 'persona-unresolved' as const, reason: 'no role-plugin' }
            : { kind: 'ready' as const, command: 'c', bin: 'claude', continueConversation: false },
        ),
        runRestartSequence,
        readSubagentCount: () => 0,
        evaluateExitGate: () => ({ blocked: false, subagentCount: 0 }),
        emitAgentOp: vi.fn(),
        log: () => {},
      },
    )
    expect(out.map(o => o.disposition)).toEqual(['skipped-unprepared', 'restarted'])
    expect(out[0].detail).toBe('no role-plugin')
    expect(runRestartSequence).toHaveBeenCalledTimes(1)
  })
})

describe('the fan-out layer — R42.7(a) uniform + R42.7(d) harness-only', () => {
  const twoAgents = [agent('alpha'), agent('beta')]

  it('drops a named session that no AUTHORIZED agent claims', async () => {
    const restartHarnessFleetSpy = vi.fn(
      async (_t: readonly FleetRestartTarget[], _r: string, _d?: unknown): Promise<FleetRestartOutcome[]> => [],
    )
    await restartFleetForSessions(['alpha', 'ghost'], 'test', {
      loadAgents: () => twoAgents as unknown as Array<Record<string, unknown>>,
      checkAuthorizedAgentWorkdir: () => ({ ok: true }),
      restartHarnessFleet: restartHarnessFleetSpy,
      log: () => {},
    })
    const targets = restartHarnessFleetSpy.mock.calls[0][0] as readonly { sessionName: string }[]
    expect(targets.map(t => t.sessionName)).toEqual(['alpha'])
  })

  it('consults the ONE workdir authority — a rejected workdir is never a target', async () => {
    const restartHarnessFleetSpy = vi.fn(
      async (_t: readonly FleetRestartTarget[], _r: string, _d?: unknown): Promise<FleetRestartOutcome[]> => [],
    )
    await restartFleetForSessions(['alpha', 'beta'], 'test', {
      loadAgents: () => twoAgents as unknown as Array<Record<string, unknown>>,
      // Exactly the real hazard: a legacy `default` agent carries workingDirectory "/".
      checkAuthorizedAgentWorkdir: (cwd) => ({ ok: cwd !== '/Users/tester/agents/beta', reason: 'forbidden' }),
      restartHarnessFleet: restartHarnessFleetSpy,
      log: () => {},
    })
    const targets = restartHarnessFleetSpy.mock.calls[0][0] as readonly { sessionName: string }[]
    expect(targets.map(t => t.sessionName)).toEqual(['alpha'])
  })

  it('skips soft-deleted agents', async () => {
    const restartHarnessFleetSpy = vi.fn(
      async (_t: readonly FleetRestartTarget[], _r: string, _d?: unknown): Promise<FleetRestartOutcome[]> => [],
    )
    await restartEntireHarnessFleet('test', {
      loadAgents: () =>
        [agent('alive'), agent('dead', { deletedAt: '2026-07-30T00:00:00+0200' })] as unknown as Array<Record<string, unknown>>,
      checkAuthorizedAgentWorkdir: () => ({ ok: true }),
      restartHarnessFleet: restartHarnessFleetSpy,
      log: () => {},
    })
    const targets = restartHarnessFleetSpy.mock.calls[0][0] as readonly { sessionName: string }[]
    expect(targets.map(t => t.sessionName)).toEqual(['alive'])
  })

  it('an empty session list restarts nothing at all', async () => {
    const restartHarnessFleetSpy = vi.fn(
      async (_t: readonly FleetRestartTarget[], _r: string, _d?: unknown): Promise<FleetRestartOutcome[]> => [],
    )
    const out = await restartFleetForSessions([], 'test', {
      loadAgents: () => twoAgents as unknown as Array<Record<string, unknown>>,
      checkAuthorizedAgentWorkdir: () => ({ ok: true }),
      restartHarnessFleet: restartHarnessFleetSpy,
      log: () => {},
    })
    expect(out).toEqual([])
    expect(restartHarnessFleetSpy).not.toHaveBeenCalled()
  })
})

describe('R42.7(f) — no agent-reachable surface may invoke the fleet restart', () => {
  // This constraint is about who CAN call the driver, which no test OF the driver can
  // show. So it is a source scan: the fleet-restart modules must be imported by the
  // server's own tick and by `lib/` only — never from a route, a service, or a
  // script, each of which an agent can reach (a route by curl, a script by shell).
  const ROOT = join(__dirname, '..', '..')
  const FORBIDDEN_DIRS = ['app', 'services', 'scripts']
  const NEEDLE = /fleet-restart-(driver|fanout)/

  const walk = (dir: string, acc: string[] = []): string[] => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return acc
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p, acc)
      else if (/\.(ts|tsx|mjs|js|sh)$/.test(e)) acc.push(p)
    }
    return acc
  }

  it('no file under app/ services/ scripts/ imports the fleet-restart modules', () => {
    const scanned: string[] = []
    const offenders: string[] = []
    for (const d of FORBIDDEN_DIRS) {
      for (const f of walk(join(ROOT, d))) {
        scanned.push(f)
        if (NEEDLE.test(readFileSync(f, 'utf-8'))) offenders.push(f.slice(ROOT.length + 1))
      }
    }
    // NON-VACUITY: a broken walk would scan nothing and report "clean" — the exact
    // shape of a gate that passes because it read nothing.
    expect(scanned.length).toBeGreaterThan(200)
    expect(offenders).toEqual([])
  })

  it('server.mjs DOES wire it — the positive control for the scan above', () => {
    // Without this, the previous test also passes when the feature is not wired at
    // all, which is precisely the dead-seam bug this whole card exists to fix.
    const server = readFileSync(join(ROOT, 'server.mjs'), 'utf-8')
    expect(server).toMatch(/fleet-restart-fanout/)
    expect(server).toMatch(/restartFleetForSessions/)
    expect(server).toMatch(/restartEntireHarnessFleet/)
  })
})
