/**
 * The agent-workdir invariant registry (TRDD-VYQ8N4KR).
 *
 * The LIST is the contract now — "what does ai-maestro guarantee about an agent
 * workdir, and where is each guarantee enforced?" is answered by reading one
 * array instead of grepping three call sites. So the list itself is under test:
 * its shape, its trigger declarations, and the two properties that make a single
 * runner safe (one failing invariant must not cancel the rest; a throwing
 * invariant is a `failed` outcome, not an exception).
 *
 * The `core-plugin` trigger set is asserted explicitly. It is the one invariant
 * excluded from the periodic loop, and that exclusion is a deliberate decision
 * (its repair shells out to `claude plugin install` — network I/O and a package
 * manager, which must not run unattended on a timer). A future edit that quietly
 * adds 'periodic' to it would turn the watchdog into a background plugin
 * installer; this test is the wall in front of that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AGENT_INVARIANTS,
  enforceAgentInvariants,
  formatEnforceResult,
  startAgentInvariantsWatchdog,
  stopAgentInvariantsWatchdog,
} from '@/lib/agent-invariants'
import { RULE_FILE_MODE } from '@/lib/agent-rules-seed'

// ── Mocks for the role-plugin row (TRDD-CNF1X3J7 Gate 2) ────────────────────
// The row resolves its dependencies via dynamic import, so these file-level
// mocks intercept them. No other test in this file touches these modules.
vi.mock('@/services/agent-local-config-service', () => ({
  // The quad-match only sees plugins whose files exist on disk, so in the
  // enabled-but-not-installed state it returns null — the default here.
  scanAgentLocalConfig: vi.fn(() => ({ data: { rolePlugin: null } })),
}))
vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(() => ({ programArgs: '--agent ai-maestro-programmer-agent-main-agent' })),
}))
vi.mock('@/lib/claude-plugin-list', () => ({
  listInstalledClaudePlugins: vi.fn(async () => []),
}))
vi.mock('@/services/element-management-service', () => ({
  InstallElement: vi.fn(async () => ({ success: true, operations: [] })),
}))
vi.mock('@/lib/agent-auth', () => ({
  buildSystemAuthContext: vi.fn(() => ({ kind: 'system' })),
}))
// The watchdog interval dynamically imports the fleet-level keychain sweep
// (TRDD-78J4I4QS). Unmocked, the watchdog tests below would run the REAL
// TmuxRuntime against this machine's live tmux server (creating/killing a
// real `aim-kc-watchdog` session and probing the real macOS keychain) — a
// unit test must stay hermetic. The sweep has its own dedicated test file.
vi.mock('@/lib/tmux-server-keychain-watchdog', () => ({
  sweepTmuxServerKeychain: vi.fn(async () => {}),
}))

const AGENT_RULES_FILE = 'aimaestro-agent-rules.md'

let workdir: string

const ctx = (trigger: 'create' | 'wake' | 'periodic') => ({
  agentId: 'agent-1',
  agentName: 'test-agent',
  workdir,
  clientType: 'claude' as const,
  trigger,
})

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'invariants-'))
})

afterEach(async () => {
  // AWAIT the stop. The sweep is a WRITER (it re-creates .claude/ and rewrites the
  // shipped rules), so removing the workdir while one is in flight raced it and
  // failed intermittently with ENOTEMPTY under full-suite load — only ever in the
  // whole suite, never in isolation, which is what made it look like noise.
  // TRDD-F4UUM8RZ made stop() resolve once the sweep has settled.
  await stopAgentInvariantsWatchdog()
  rmSync(workdir, { recursive: true, force: true })
})

describe('the invariant list', () => {
  it('declares a unique id, a description, and at least one trigger for every entry', () => {
    const ids = AGENT_INVARIANTS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const inv of AGENT_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(0)
      expect(inv.triggers.length).toBeGreaterThan(0)
    }
  })

  it('keeps the core-plugin repair OFF the periodic loop (it shells out to a package manager)', () => {
    const core = AGENT_INVARIANTS.find((i) => i.id === 'core-plugin')
    expect(core).toBeDefined()
    expect(core!.triggers).not.toContain('periodic')
    // ...and off `create` too: the core plugin is installed on first wake, and a
    // consolidation must not smuggle in a behavior change.
    expect(core!.triggers).toEqual(['wake'])
  })

  it('runs the file-level invariants on every trigger, including periodic', () => {
    for (const id of ['claude-dir', 'dep-rules', 'git-exclude']) {
      const inv = AGENT_INVARIANTS.find((i) => i.id === id)
      expect(inv, id).toBeDefined()
      expect(inv!.triggers, id).toEqual(['create', 'wake', 'periodic'])
    }
  })
})

describe('enforceAgentInvariants', () => {
  it('establishes the workdir guarantees on create', async () => {
    const r = await enforceAgentInvariants(ctx('create'))

    expect(existsSync(join(workdir, '.claude'))).toBe(true)
    expect(existsSync(join(workdir, '.claude', 'rules', AGENT_RULES_FILE))).toBe(true)
    expect(r.failed).toEqual([])
    // Not a git repo — the git-exclude invariant reports skipped, not failed.
    expect(r.outcomes.find((o) => o.id === 'git-exclude')?.status).toBe('skipped')
  })

  it('only runs invariants whose triggers include the one it was given', async () => {
    const periodic = await enforceAgentInvariants(ctx('periodic'))
    // core-plugin is wake-only: it must not even be attempted here, or the sweep
    // would try to install a plugin for every agent on every tick.
    expect(periodic.outcomes.map((o) => o.id)).not.toContain('core-plugin')
    expect(periodic.outcomes.map((o) => o.id).sort()).toEqual(['amp-only-messaging', 'claude-dir', 'dep-rules', 'git-exclude'])
  })

  it('is idempotent — a second run reports everything already holding', async () => {
    await enforceAgentInvariants(ctx('periodic'))
    const second = await enforceAgentInvariants(ctx('periodic'))
    expect(second.repaired).toEqual([])
    expect(second.failed).toEqual([])
  })

  it('reports a repair, and formats one line only when something drifted', async () => {
    const first = await enforceAgentInvariants(ctx('periodic'))
    expect(first.repaired.map((o) => o.id)).toContain('dep-rules')
    expect(formatEnforceResult('test-agent', first)).toContain('dep-rules=repaired')

    const second = await enforceAgentInvariants(ctx('periodic'))
    // Silence is the steady state — a clean sweep must not log.
    expect(formatEnforceResult('test-agent', second)).toBeNull()
  })

  it('records a throwing invariant as failed and still runs the others', async () => {
    // `.claude` as a FILE makes the claude-dir mkdir throw ENOTDIR. The point is
    // that dep-rules and git-exclude are still attempted: a single broken
    // guarantee must not cancel the rest — the whole reason the old code wrapped
    // each one in its own try/catch, now written once in the runner.
    writeFileSync(join(workdir, '.claude'), 'not a directory')

    const r = await enforceAgentInvariants(ctx('periodic'))

    expect(r.failed.map((o) => o.id)).toContain('claude-dir')
    expect(r.outcomes.map((o) => o.id)).toContain('git-exclude')
    expect(r.outcomes).toHaveLength(4)
  })
})

describe('the role-plugin invariant (TRDD-CNF1X3J7 Gate 2)', () => {
  const row = () => AGENT_INVARIANTS.find((i) => i.id === 'role-plugin')!

  it('exists and is pinned to wake-only — its repair is a package manager, never a background loop', () => {
    expect(row()).toBeDefined()
    // Deep-equal, not "contains": a future edit adding 'periodic' would turn
    // the watchdog into a background plugin installer; adding 'create' would
    // smuggle in a behavior change. Same wall as core-plugin's.
    expect(row().triggers).toEqual(['wake'])
  })

  it('detects enabled-but-not-installed (the settings file lies; `claude plugin list` is truth) and repairs via a local-scope install', async () => {
    const { listInstalledClaudePlugins } = await import('@/lib/claude-plugin-list')
    const { InstallElement } = await import('@/services/element-management-service')
    vi.mocked(InstallElement).mockClear()
    // The outage state: scan.rolePlugin is null (files absent), the launch
    // args still name the role, and `claude plugin list` does NOT show it.
    vi.mocked(listInstalledClaudePlugins).mockResolvedValueOnce([])

    const r = await row().enforce(ctx('wake'))

    expect(r.status).toBe('repaired')
    expect(vi.mocked(InstallElement)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ai-maestro-programmer-agent',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'local',
      }),
      expect.anything(),
    )
  })

  it('reports ok WITHOUT reinstalling when `claude plugin list` shows the plugin installed and enabled', async () => {
    const { listInstalledClaudePlugins } = await import('@/lib/claude-plugin-list')
    const { InstallElement } = await import('@/services/element-management-service')
    vi.mocked(InstallElement).mockClear()
    vi.mocked(listInstalledClaudePlugins).mockResolvedValueOnce([
      { id: 'ai-maestro-programmer-agent@ai-maestro-plugins', scope: 'local', enabled: true },
    ])

    const r = await row().enforce(ctx('wake'))

    expect(r.status).toBe('ok')
    expect(vi.mocked(InstallElement)).not.toHaveBeenCalled()
  })

  it('skips on non-claude clients — no CLI check exists there, and a skip can never falsely refuse', async () => {
    const r = await row().enforce({ ...ctx('wake'), clientType: 'codex' as never })
    expect(r.status).toBe('skipped')
  })
})

describe('the single invariants watchdog', () => {
  it('repairs a deleted rule without waiting for the agent to be woken', async () => {
    // Without the loop, the repair only runs on the tampering agent's next wake —
    // i.e. the agent that broke the guarantee decides when the fix lands.
    await enforceAgentInvariants(ctx('periodic'))
    const victim = join(workdir, '.claude', 'rules', AGENT_RULES_FILE)
    rmSync(victim)

    const fleet = () => [{ agentId: 'agent-1', agentName: 'test-agent', workdir, clientType: 'claude' as const }]
    expect(startAgentInvariantsWatchdog(fleet, 20)).toBe(true)
    // A second start is a no-op — two loops would double every sweep.
    expect(startAgentInvariantsWatchdog(fleet, 20)).toBe(false)

    await vi.waitFor(() => expect(existsSync(victim)).toBe(true), { timeout: 2000, interval: 20 })
    expect(statSync(victim).mode & 0o777).toBe(RULE_FILE_MODE)
  })

  it('does not start when the interval is 0 (the loop is disableable)', () => {
    expect(startAgentInvariantsWatchdog(() => [], 0)).toBe(false)
  })

  it('never runs two sweeps at once — a tick arriving mid-sweep is SKIPPED', async () => {
    // TRDD-L541EREU. A bare setInterval joins a still-running sweep with the next
    // tick, and two concurrent sweeps break this loop in two ways:
    //
    //   1. THE REPAIR OPENS THE TAMPER WINDOW IT EXISTS TO CLOSE. `writeProtected`
    //      must `chmod 0o644` to overwrite its own 0444 protection, and `writeFile`
    //      is not atomic — so a concurrent sweep reads a PARTIALLY-written rule,
    //      concludes "bytes differ", and chmods it writable. That is the
    //      `expected 420 to be 292` (0o644 vs 0o444) this file used to fail with
    //      under full-suite load while passing in isolation — the signature of a
    //      concurrency defect, not of a slow machine.
    //   2. `stop()` LIES: the `.finally` nulls a SHARED variable, so sweep A
    //      finishing cleared sweep B's handle and stop() returned while B was still
    //      writing (the very bug TRDD-F4UUM8RZ fixed, surviving in the overlap case).
    //
    // ⚠ WHAT THIS COUNTS AND WHY. `listAgents` is called exactly once per sweep, at
    // the top of the per-agent loop, so it IS the sweep-start counter. Without the
    // guard, starts scale with elapsed/interval (hundreds here); with it, starts are
    // bounded by sweeps COMPLETED, and a 40-workdir sweep is far longer than 1ms.
    // A test asserting only "the rules got seeded" would pass either way.
    const FLEET = 40
    const root = mkdtempSync(join(tmpdir(), 'invariants-reentrancy-'))
    const dirs = Array.from({ length: FLEET }, (_, i) => {
      const d = join(root, `a${i}`)
      mkdirSync(d, { recursive: true })
      return d
    })

    let starts = 0
    const fleet = () => {
      starts++
      return dirs.map((d, i) => ({ agentId: `a${i}`, agentName: `a${i}`, workdir: d, clientType: 'claude' as const }))
    }

    try {
      expect(startAgentInvariantsWatchdog(fleet, 1)).toBe(true)
      await new Promise(r => setTimeout(r, 300))
      await stopAgentInvariantsWatchdog()

      // NON-VACUITY: "few starts" is equally satisfied by a watchdog that never ran.
      expect(starts, 'the watchdog never swept, so the bound below proves nothing').toBeGreaterThan(0)
      // 300ms at a 1ms interval is ~300 ticks. Anything near that means ticks were
      // joining sweeps already in flight; the guard caps starts at sweeps completed.
      expect(starts, 'ticks joined an in-flight sweep — the re-entrancy guard is gone').toBeLessThan(50)
    } finally {
      await stopAgentInvariantsWatchdog()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stop() resolves only once the in-flight sweep has finished writing — "stopped" must mean the work stopped, not just the timer', async () => {
    // The bug this pins (TRDD-F4UUM8RZ): the sweep was fire-and-forget, so stop()
    // cleared the interval and returned WHILE a sweep was still re-creating files.
    // A caller that stopped the watchdog and then removed the workdir raced a
    // writer putting files back — the re-appearing-workdir class (TRDD-KERM18NX).
    // It surfaced only as an intermittent ENOTEMPTY in this file's own afterEach
    // under full-suite load, which is exactly why it needs a test that states the
    // CONTRACT rather than one that merely stops flaking.
    //
    // The fleet is large on purpose. With a single agent the post-stop window is
    // one file-write wide, so a test would pass with or without the fix and pin
    // nothing (the first version of this test did exactly that). With 40 agents,
    // "the rest of the sweep" is hundreds of writes — the difference between
    // awaiting it and not is unmissable.
    const FLEET = 40
    const root = mkdtempSync(join(tmpdir(), 'invariants-fleet-'))
    const dirs = Array.from({ length: FLEET }, (_, i) => {
      const d = join(root, `a${i}`)
      mkdirSync(d, { recursive: true })
      return d
    })
    const seeded = () => dirs.filter(d => existsSync(join(d, '.claude', 'rules', AGENT_RULES_FILE))).length
    const fleet = () =>
      dirs.map((d, i) => ({ agentId: `a${i}`, agentName: `a${i}`, workdir: d, clientType: 'claude' as const }))

    try {
      expect(startAgentInvariantsWatchdog(fleet, 10)).toBe(true)
      // Stop the moment the sweep is demonstrably mid-flight.
      await vi.waitFor(() => expect(seeded()).toBeGreaterThan(0), { timeout: 3000, interval: 5 })

      await stopAgentInvariantsWatchdog()
      const atStop = seeded()
      await new Promise(r => setTimeout(r, 300))

      // The contract: once the promise resolves, no further write happens.
      expect(seeded()).toBe(atStop)
      // Non-vacuity: prove we really caught it mid-sweep. Had the whole fleet been
      // swept before we sampled, "nothing changed afterwards" would be trivially
      // true and would test nothing.
      expect(atStop).toBeLessThan(FLEET)
    } finally {
      await stopAgentInvariantsWatchdog()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ── amp-only-messaging (USER directive 2026-08-20) ──────────────────────────
// Inside the harness an agent may only talk over AMP, so the client's own
// cross-session peer-messaging tool is denied in the workdir's settings.
describe('the amp-only-messaging invariant', () => {
  const row = () => AGENT_INVARIANTS.find((i) => i.id === 'amp-only-messaging')!
  const settingsPath = () => join(workdir, '.claude', 'settings.local.json')
  const readDeny = () =>
    JSON.parse(readFileSync(settingsPath(), 'utf8')).permissions?.deny as string[] | undefined

  const seed = (data: unknown) => {
    mkdirSync(join(workdir, '.claude'), { recursive: true })
    writeFileSync(settingsPath(), typeof data === 'string' ? data : JSON.stringify(data))
  }

  it('runs on every trigger — a settings write is safe on the timer', () => {
    expect(row().triggers).toEqual(['create', 'wake', 'periodic'])
  })

  it('denies the peer-messaging tool AND refuses cross-session inbound in a fresh workdir', async () => {
    const out = await row().enforce(ctx('create'))
    expect(out.status).toBe('repaired')
    expect(readDeny()).toContain('SendMessage')
    // The INBOUND half (USER directive 2026-08-20, TRDD-027HZOYN)
    expect(JSON.parse(readFileSync(settingsPath(), 'utf8')).crossSessionInbound).toBe('refuse')
  })

  it('repairs a drifted crossSessionInbound even when the deny list is already correct', async () => {
    seed({ permissions: { deny: ['SendMessage'] }, crossSessionInbound: 'allow' })
    const out = await row().enforce(ctx('periodic'))
    expect(out.status).toBe('repaired')
    expect(out.detail).toBe('crossSessionInbound=refuse')
    const data = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    expect(data.crossSessionInbound).toBe('refuse')
    expect(data.permissions.deny).toEqual(['SendMessage']) // untouched — only the drifted key moved
  })

  it('UNIONS with the deny entries already there — it never replaces them', async () => {
    seed({ permissions: { deny: ['Bash(rm:*)'] }, enabledPlugins: { 'a@b': true } })

    const out = await row().enforce(ctx('periodic'))

    expect(out.status).toBe('repaired')
    // Both survive, and the write did not eat the sibling key.
    expect(readDeny()).toEqual(['Bash(rm:*)', 'SendMessage'])
    expect(JSON.parse(readFileSync(settingsPath(), 'utf8')).enabledPlugins).toEqual({ 'a@b': true })
  })

  it('is a no-op once BOTH halves are present (no churn on every beat)', async () => {
    seed({ permissions: { deny: ['SendMessage'] }, crossSessionInbound: 'refuse' })
    const before = readFileSync(settingsPath(), 'utf8')

    const out = await row().enforce(ctx('periodic'))

    expect(out.status).toBe('ok')
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before)
  })

  it('REFUSES on a corrupt settings file rather than rebuilding it from {}', async () => {
    seed('{ this is not json')

    const out = await row().enforce(ctx('wake'))

    expect(out.status).toBe('failed')
    expect(out.detail).toMatch(/unreadable/i)
    // The whole point: whatever the agent had is still on disk, untouched.
    expect(readFileSync(settingsPath(), 'utf8')).toBe('{ this is not json')
  })
})
