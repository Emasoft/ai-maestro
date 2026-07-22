import { describe, it, expect } from 'vitest'
import { enforceLaunchAgentFlag, resolveLaunchArgs } from '@/services/agent-launch-args'

// TRDD-GZ1KOHNR — a titled Claude agent must launch with `--agent <persona>`,
// never generic claude. These prove the enforcement decision directly (the pure
// fn) and through the wired resolver with an injected scanner (no real scan).
const MAIN_AGENT = 'ai-maestro-assistant-manager-agent-main-agent'

describe('enforceLaunchAgentFlag (pure decision)', () => {
  it('passes a non-Claude program through unchanged (persona via manifest, not --agent)', () => {
    const r = enforceLaunchAgentFlag('codex', '--dangerously-skip-permissions', MAIN_AGENT)
    expect(r).toEqual({ kind: 'ok', args: '--dangerously-skip-permissions' })
  })

  it('injects --agent for a Claude program when a main-agent resolves', () => {
    const r = enforceLaunchAgentFlag('claude code', '--dangerously-skip-permissions', MAIN_AGENT)
    expect(r).toEqual({ kind: 'ok', args: `--agent ${MAIN_AGENT} --dangerously-skip-permissions` })
  })

  it('replaces a stale --agent in place (idempotent, other tokens preserved)', () => {
    const r = enforceLaunchAgentFlag('claude', '--agent old-main-agent --dangerously-skip-permissions', MAIN_AGENT)
    expect(r).toEqual({ kind: 'ok', args: `--agent ${MAIN_AGENT} --dangerously-skip-permissions` })
  })

  it('REFUSES a Claude program when no main-agent resolves (fail-fast, R9.13)', () => {
    const r = enforceLaunchAgentFlag('claude code', '--dangerously-skip-permissions', null)
    expect(r.kind).toBe('refuse')
    if (r.kind === 'refuse') expect(r.reason).toMatch(/role-plugin/)
  })
})

describe('resolveLaunchArgs (wired, injected scanner)', () => {
  it('passes an agentless (raw) session through unchanged', async () => {
    const r = await resolveLaunchArgs(undefined, 'claude', '--dangerously-skip-permissions', {
      resolveMainAgent: () => null,
    })
    expect(r).toEqual({ kind: 'ok', args: '--dangerously-skip-permissions' })
  })

  it('injects --agent for a registered Claude agent whose role-plugin resolves', async () => {
    const r = await resolveLaunchArgs('agent-1', 'claude code', '--dangerously-skip-permissions', {
      resolveMainAgent: () => MAIN_AGENT,
    })
    expect(r).toEqual({ kind: 'ok', args: `--agent ${MAIN_AGENT} --dangerously-skip-permissions` })
  })

  it('REFUSES a registered Claude agent with no resolvable role-plugin', async () => {
    const r = await resolveLaunchArgs('agent-1', 'claude', '--dangerously-skip-permissions', {
      resolveMainAgent: () => null,
    })
    expect(r.kind).toBe('refuse')
  })

  it('passes a non-Claude registered agent through even when no persona resolves', async () => {
    const r = await resolveLaunchArgs('agent-1', 'codex', '', { resolveMainAgent: () => null })
    expect(r).toEqual({ kind: 'ok', args: '' })
  })

  it('awaits an async resolver (the real scanner path is async)', async () => {
    const r = await resolveLaunchArgs('agent-1', 'claude', '', {
      resolveMainAgent: async () => MAIN_AGENT,
    })
    expect(r).toEqual({ kind: 'ok', args: `--agent ${MAIN_AGENT}` })
  })
})
