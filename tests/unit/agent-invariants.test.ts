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
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync } from 'fs'
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

afterEach(() => {
  stopAgentInvariantsWatchdog()
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
    expect(periodic.outcomes.map((o) => o.id).sort()).toEqual(['claude-dir', 'dep-rules', 'git-exclude'])
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
    expect(r.outcomes).toHaveLength(3)
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
})
