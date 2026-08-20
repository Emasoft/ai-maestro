/**
 * TRDD-ZLBBD4E3 — the non-self activity probe's two load-bearing claims:
 *   - in_turn NULL when no hook state exists (absence is UNKNOWN, never "safe");
 *   - the status → in_turn mapping (a gate keying on it must not read a waiting
 *     prompt as a running turn, or it will refuse to act exactly when acting is safe).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

let workdir: string
const stateFile = () => join(workdir, '.aim-chat-state.json')

vi.mock('@/lib/agent-registry', () => ({
  getAgentBySession: vi.fn((name: string) =>
    name === 'known' ? { id: 'agent-1', workingDirectory: workdir } : null),
}))
vi.mock('@/lib/chat-state-path', () => ({
  chatStateFileFor: vi.fn(() => stateFile()),
}))
vi.mock('@/lib/user-presence', () => ({
  getPresence: vi.fn(() => ({ last_user_input_epoch: 1755000000 })),
}))

import { sessionActivitySignals } from '@/lib/session-activity-signals'

beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'sas-')) })
afterEach(() => { rmSync(workdir, { recursive: true, force: true }) })

describe('sessionActivitySignals', () => {
  it('returns null for a session no registered agent owns', async () => {
    expect(await sessionActivitySignals('stranger')).toBeNull()
  })

  it('reports in_turn NULL (unknown) when no hook state file exists — absence is not safety', async () => {
    const s = await sessionActivitySignals('known')
    expect(s).not.toBeNull()
    expect(s!.in_turn).toBeNull()
    expect(s!.hook_status).toBeNull()
    expect(s!.last_user_input_epoch).toBe(1755000000)
  })

  it('maps a running-turn status to true and a waiting/idle status to false', async () => {
    for (const [status, want] of [
      ['busy', true], ['active', true], ['subagents_running', true], ['compacting', true],
      ['idle', false], ['waiting_for_input', false], ['permission_request', false],
      ['error', false], ['stopped', false],
    ] as const) {
      writeFileSync(stateFile(), JSON.stringify({ status, updatedAt: '2026-08-20T08:00:00+02:00' }))
      const s = await sessionActivitySignals('known')
      expect(s!.in_turn, status).toBe(want)
      expect(s!.hook_status, status).toBe(status)
      expect(s!.hook_updated_at_epoch, status).toBeGreaterThan(0)
    }
  })

  it('treats an unreadable state file as unknown, never as a crash or a false', async () => {
    writeFileSync(stateFile(), '{ not json')
    const s = await sessionActivitySignals('known')
    expect(s!.in_turn).toBeNull()
  })
})
