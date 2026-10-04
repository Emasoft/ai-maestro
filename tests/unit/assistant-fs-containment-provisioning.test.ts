/**
 * TRDD-U7MJUHWJ box 3 — "the containment hook installs AUTOMATICALLY as part of
 * ASSISTANT provisioning; no manual opt-in step exists."
 *
 * This file proves that claim as an EXECUTABLE fact rather than a reading of the
 * source: it drives the real invariant ROW (`assistant-fs-containment` in
 * lib/agent-invariants.ts) through the PROVISIONING trigger path (create), with a
 * registry entry whose title is `assistant`, and asserts the OBSERVABLE
 * post-condition — the guard script lands on disk at the path the seeder owns,
 * byte-identical to the shipped script. No manual install call is made: the only
 * entry point invoked is `enforceAgentInvariants`, i.e. the create/wake hook a
 * provisioning pipeline runs.
 *
 * The negative half pins the discriminator: a non-`assistant` title reaches the
 * same row and the row SKIPS, writing nothing — so the install is title-gated, not
 * a blanket side effect of provisioning.
 *
 * $HOME is redirected to a temp dir (same harness shape as
 * tests/unit/assistant-fs-containment.test.ts) so the run never touches the
 * developer's real state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AGENT_INVARIANTS, enforceAgentInvariants } from '@/lib/agent-invariants'
import {
  CONTAINMENT_INVARIANT_ID,
  CONTAINMENT_HOOK_SCRIPT_NAME,
} from '@/lib/assistant-fs-containment-seed'

// The row self-resolves the ASSISTANT title from the agent registry. This mock is
// the SAME seam the sibling test uses; each test overrides it for its own title.
vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(() => ({ governanceTitle: 'assistant' })),
}))

const SHIPPED_GUARD = join(process.cwd(), 'rules', 'aimaestro-hooks', CONTAINMENT_HOOK_SCRIPT_NAME)

let workdir: string
let homeDir: string
let realHome: string | undefined

const ctx = (trigger: 'create' | 'wake') => ({
  agentId: 'agent-assistant-prov',
  agentName: 'test-assistant',
  workdir,
  clientType: 'claude' as const,
  trigger,
})

beforeEach(() => {
  realHome = process.env.HOME
  homeDir = mkdtempSync(join(tmpdir(), 'u7mju-home-'))
  process.env.HOME = homeDir
  workdir = mkdtempSync(join(tmpdir(), 'u7mju-workdir-'))
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(workdir, { recursive: true, force: true })
  rmSync(homeDir, { recursive: true, force: true })
})

describe('ASSISTANT provisioning installs the containment hook automatically', () => {
  it('the create-triggered invariant row lands the shipped guard script on disk, byte-identical, for an assistant-titled agent', async () => {
    const { getAgent } = await import('@/lib/agent-registry')
    vi.mocked(getAgent).mockReturnValue({ governanceTitle: 'assistant' } as never)

    const row = AGENT_INVARIANTS.find((i) => i.id === CONTAINMENT_INVARIANT_ID)
    expect(row, 'the containment row exists').toBeDefined()
    expect(row!.triggers).toContain('create')

    const installPath = join(workdir, '.claude', 'hooks', CONTAINMENT_HOOK_SCRIPT_NAME)
    expect(existsSync(installPath), 'nothing installed before the invariant runs').toBe(false)

    const r = await enforceAgentInvariants(ctx('create'))

    // The row RAN through provisioning (not a manual seeder call) and installed.
    const outcome = r.outcomes.find((o) => o.id === CONTAINMENT_INVARIANT_ID)
    expect(outcome?.status).toBe('repaired')

    // The OBSERVABLE post-condition: the hook file exists at the seeder-owned path.
    expect(existsSync(installPath), 'hook landed on disk').toBe(true)

    // ...and it is the byte-identical shipped script, not a stub.
    expect(readFileSync(installPath)).toEqual(readFileSync(SHIPPED_GUARD))

    // The guard was NOT reached through any developer $HOME path.
    expect(existsSync(join(homeDir, '.claude', 'hooks', CONTAINMENT_HOOK_SCRIPT_NAME))).toBe(false)
  })

  it('the SAME provisioning row skips a non-assistant-titled agent, installing nothing', async () => {
    const { getAgent } = await import('@/lib/agent-registry')
    vi.mocked(getAgent).mockReturnValue({ governanceTitle: 'maintainer' } as never)

    const installPath = join(workdir, '.claude', 'hooks', CONTAINMENT_HOOK_SCRIPT_NAME)
    const r = await enforceAgentInvariants(ctx('create'))

    expect(r.outcomes.find((o) => o.id === CONTAINMENT_INVARIANT_ID)?.status).toBe('skipped')
    expect(existsSync(installPath), 'non-ASSISTANT gets no hook').toBe(false)
  })
})
