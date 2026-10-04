/**
 * TRDD-U7MJUHWJ — ASSISTANT-role filesystem containment.
 *
 * The invariant row (`assistant-fs-containment` in lib/agent-invariants.ts)
 * and the seeder it calls (lib/assistant-fs-containment-seed.ts) are the
 * implementation; the hook script the seeder installs
 * (rules/aimaestro-hooks/assistant-fs-containment-guard.sh) is exercised
 * here THROUGH its real bash execution — a containment guard whose tests
 * only mock the filesystem would prove nothing about the shell logic that
 * decides a block.
 *
 * Non-vacuity is carried by the tamper test: if the seeder did nothing, the
 * "restores an agent-side edit" case would fail for want of an edit to
 * restore, and the "all-ok second run" case would fail for want of files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, chmodSync, statSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { AGENT_INVARIANTS, enforceAgentInvariants } from '@/lib/agent-invariants'
import {
  CONTAINMENT_INVARIANT_ID,
  CONTAINMENT_HOOK_SCRIPT_NAME,
  CONTAINMENT_HOOK_MATCHER,
  LOCAL_FOLDERS_ENV,
  PROJECT_FOLDERS_ENV,
  containmentHookCommand,
  ensureAssistantFsContainment,
  getAssistantCollabFolders,
} from '@/lib/assistant-fs-containment-seed'

vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(() => ({ governanceTitle: 'assistant' })),
}))

// The invariant reads project folders off the registry agent; the mock above
// fixes the title, and these tests pass the folder lists explicitly through
// the seeder where they matter. readAssistantLocalFolders reads process.env.
let workdir: string
const GUARD = join(process.cwd(), 'rules', 'aimaestro-hooks', CONTAINMENT_HOOK_SCRIPT_NAME)

const ctx = (trigger: 'create' | 'wake' | 'periodic') => ({
  agentId: 'agent-assistant-1',
  agentName: 'test-assistant',
  workdir,
  clientType: 'claude' as const,
  trigger,
})

function runGuard(payload: object, env: Record<string, string> = {}): { status: number | null; stderr: string } {
  const r = spawnSync('bash', [GUARD], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...env },
  })
  return { status: r.status, stderr: `${r.stderr ?? ''}` }
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'assistant-containment-'))
})

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true })
  delete process.env.AIM_ASSISTANT_LOCAL_FOLDERS
})

describe('the invariant row', () => {
  it('is declared on ALL THREE triggers — periodic is what bounds a tamper to one interval', () => {
    const row = AGENT_INVARIANTS.find((i) => i.id === CONTAINMENT_INVARIANT_ID)
    expect(row).toBeDefined()
    expect(row!.triggers).toEqual(['create', 'wake', 'periodic'])
  })

  it('is not a plugin invariant (R20.19: only core-plugin and role-plugin touch plugins)', () => {
    const pluginRows = AGENT_INVARIANTS.filter((i) => /plugin/i.test(i.id) || /plugin/i.test(i.description))
    expect(pluginRows.map((r) => r.id).sort()).toEqual(['core-plugin', 'role-plugin'])
  })

  it('installs the hook on create for an ASSISTANT (provisioning installs it, no opt-in)', async () => {
    const r = await enforceAgentInvariants(ctx('create'))
    expect(r.outcomes.find((o) => o.id === CONTAINMENT_INVARIANT_ID)?.status).toBe('repaired')
    expect(existsSync(join(workdir, '.claude', 'hooks', CONTAINMENT_HOOK_SCRIPT_NAME))).toBe(true)
    const settings = JSON.parse(readFileSync(join(workdir, '.claude', 'settings.local.json'), 'utf8'))
    expect(settings.hooks.PreToolUse[0].matcher).toBe(CONTAINMENT_HOOK_MATCHER)
  })

  it('skips without writing anything for a non-ASSISTANT agent', async () => {
    const { getAgent } = await import('@/lib/agent-registry')
    vi.mocked(getAgent).mockReturnValueOnce({ governanceTitle: 'maintainer' } as never)
    const r = await enforceAgentInvariants(ctx('wake'))
    expect(r.outcomes.find((o) => o.id === CONTAINMENT_INVARIANT_ID)?.status).toBe('skipped')
    expect(existsSync(join(workdir, '.claude', 'hooks', CONTAINMENT_HOOK_SCRIPT_NAME))).toBe(false)
    // The containment row wrote nothing — but amp-only-messaging (also on this
    // trigger) legitimately seeds settings.local.json, so assert the hook ENTRY
    // is absent rather than the file.
    const settings = existsSync(join(workdir, '.claude', 'settings.local.json'))
      ? JSON.parse(readFileSync(join(workdir, '.claude', 'settings.local.json'), 'utf8'))
      : {}
    expect(settings.hooks).toBeUndefined()
  })
})

describe('the seeder', () => {
  it('is idempotent — a second run reports ok with no repairs', async () => {
    await ensureAssistantFsContainment(workdir)
    const second = await ensureAssistantFsContainment(workdir)
    expect(second.status).toBe('ok')
  })

  it('restores tampered script bytes and an agent-side allowlist edit', async () => {
    await ensureAssistantFsContainment(workdir)
    const scriptPath = join(workdir, '.claude', 'hooks', CONTAINMENT_HOOK_SCRIPT_NAME)
    writeFileSync(scriptPath, '# agent rewrote the guard\nexit 0\n')
    // Also let the agent widen its own allowlist.
    const settingsPath = join(workdir, '.claude', 'settings.local.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    settings.env[PROJECT_FOLDERS_ENV] = '/ /etc /Users'
    writeFileSync(settingsPath, JSON.stringify(settings))

    const r = await ensureAssistantFsContainment(workdir, { projectFolders: [] })
    expect(r.status).toBe('repaired')
    // The script is back to the shipped bytes (the seeder's source of truth).
    expect(readFileSync(scriptPath)).toEqual(readFileSync(GUARD))
    // The allowlist projection is back to the server's value.
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).env[PROJECT_FOLDERS_ENV]).toBe('')
  })

  it('refuses to rebuild an unreadable settings file (same contract as amp-only-messaging)', async () => {
    await ensureAssistantFsContainment(workdir)
    const settingsPath = join(workdir, '.claude', 'settings.local.json')
    writeFileSync(settingsPath, '{ corrupt json !!')
    const r = await ensureAssistantFsContainment(workdir)
    expect(r.status).toBe('failed')
    expect(r.detail).toContain('unreadable')
    // The corrupt file is NOT silently replaced by a fresh minimal object.
    expect(readFileSync(settingsPath, 'utf8')).toBe('{ corrupt json !!')
  })

  it('projects server-side folder lists into the guard env keys', async () => {
    const r = await ensureAssistantFsContainment(workdir, {
      localFolders: ['/srv/shared'],
      projectFolders: ['/Users/x/Code/proj'],
    })
    expect(r.status).toBe('repaired')
    const settings = JSON.parse(readFileSync(join(workdir, '.claude', 'settings.local.json'), 'utf8'))
    expect(settings.env[LOCAL_FOLDERS_ENV]).toBe('/srv/shared')
    expect(settings.env[PROJECT_FOLDERS_ENV]).toBe('/Users/x/Code/proj')
  })

  it('reads local folders from the server env var (empty by default)', async () => {
    const { readAssistantLocalFolders } = await import('@/lib/assistant-fs-containment-seed')
    expect(readAssistantLocalFolders()).toEqual([])
    process.env.AIM_ASSISTANT_LOCAL_FOLDERS = '/srv/a /srv/b,/srv/c'
    expect(readAssistantLocalFolders()).toEqual(['/srv/a', '/srv/b', '/srv/c'])
  })

  it('collab folders: absent registry field means empty, non-strings filtered', () => {
    expect(getAssistantCollabFolders(undefined)).toEqual([])
    expect(getAssistantCollabFolders({})).toEqual([])
    expect(getAssistantCollabFolders({ assistantProjectFolders: ['/a', 5, null, '/b'] })).toEqual(['/a', '/b'])
  })
})

describe('the guard script (real bash execution)', () => {
  const WORKDIR_KEY = 'CLAUDE_PROJECT_DIR'

  it('allows write and read inside the workdir', () => {
    const inside = join(workdir, 'lib', 'x.ts')
    expect(runGuard({ tool_name: 'Write', tool_input: { file_path: inside } }, { [WORKDIR_KEY]: workdir }).status).toBe(0)
    expect(runGuard({ tool_name: 'Read', tool_input: { file_path: inside } }, { [WORKDIR_KEY]: workdir }).status).toBe(0)
  })

  it('blocks BOTH reads and writes outside the workdir — the ruling contains reads too', () => {
    const outside = join(homedir(), 'Documents', 'secret.txt')
    expect(runGuard({ tool_name: 'Write', tool_input: { file_path: outside } }, { [WORKDIR_KEY]: workdir }).status).toBe(2)
    const read = runGuard({ tool_name: 'Read', tool_input: { file_path: outside } }, { [WORKDIR_KEY]: workdir })
    expect(read.status).toBe(2)
    // The block message names reads specifically, so the reason is not a
    // generic refusal that a write-only guard would also emit.
    expect(read.stderr).toContain('reads are contained too')
  })

  it('allows the ASSISTANT own dot-state and blocks other HOME subtrees', () => {
    expect(runGuard({ tool_name: 'Read', tool_input: { file_path: join(homedir(), '.claude', 'settings.json') } }, { [WORKDIR_KEY]: workdir }).status).toBe(0)
    expect(runGuard({ tool_name: 'Read', tool_input: { file_path: join(homedir(), '.aimaestro', 'agents', 'registry.json') } }, { [WORKDIR_KEY]: workdir }).status).toBe(0)
    expect(runGuard({ tool_name: 'Bash', tool_input: { command: `cat ${join(homedir(), '.zshrc')}` } }, { [WORKDIR_KEY]: workdir }).status).toBe(2)
  })

  it('admits env-declared local and project folders and everything under them — but not a sibling-prefix dir', () => {
    const env = { [WORKDIR_KEY]: workdir, ASSISTANT_PROJECT_FOLDERS: '/tmp/contain-proj' }
    expect(runGuard({ tool_name: 'Read', tool_input: { file_path: '/tmp/contain-proj/a/b.txt' } }, env).status).toBe(0)
    // No sibling-prefix leak: "/tmp/contain-proj" must not admit "/tmp/contain-proj2".
    expect(runGuard({ tool_name: 'Read', tool_input: { file_path: '/tmp/contain-proj2/x' } }, env).status).toBe(2)
  })

  it('blocks a Bash command referencing an outside absolute path — reads included', () => {
    const env = { [WORKDIR_KEY]: workdir }
    expect(runGuard({ tool_name: 'Bash', tool_input: { command: 'ls /etc/passwd' } }, env).status).toBe(2)
    expect(runGuard({ tool_name: 'Bash', tool_input: { command: `cat ${homedir()}/.zshrc` } }, env).status).toBe(2)
    expect(runGuard({ tool_name: 'Bash', tool_input: { command: `ls ${workdir} > /dev/null` } }, env).status).toBe(0)
  })

  it('ignores paths inside heredoc bodies (literal stdin data, not shell)', () => {
    const cmd = "cat << 'EOF' > out.txt\n/etc/outside/heredoc\nEOF"
    expect(runGuard({ tool_name: 'Bash', tool_input: { command: cmd } }, { [WORKDIR_KEY]: workdir }).status).toBe(0)
    // ...but the same path ON the shell line is still blocked.
    const cmd2 = "cat /etc/outside/heredoc << 'EOF' > out.txt\nbody\nEOF"
    expect(runGuard({ tool_name: 'Bash', tool_input: { command: cmd2 } }, { [WORKDIR_KEY]: workdir }).status).toBe(2)
  })

  it('fails closed when no workdir is resolvable', () => {
    const r = runGuard({ tool_name: 'Write', tool_input: { file_path: '/tmp/x' } })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('cannot resolve the ASSISTANT workdir')
  })

  it('is installed executable by the seeder (0755) — a non-executable hook is a silent no-op', async () => {
    await ensureAssistantFsContainment(workdir)
    expect(statSync(join(workdir, '.claude', 'hooks', CONTAINMENT_HOOK_SCRIPT_NAME)).mode & 0o777).toBe(0o755)
  })
})

describe('the wired settings entry', () => {
  it('commands the workdir-local hook via $CLAUDE_PROJECT_DIR (no per-agent path baking)', () => {
    expect(containmentHookCommand()).toBe('"$CLAUDE_PROJECT_DIR"/.claude/hooks/' + CONTAINMENT_HOOK_SCRIPT_NAME)
  })
})
