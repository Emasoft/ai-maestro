import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-U6AS2YWB (E4) — the `esc-then-command` continuity response: bounded ESCs with a frame
 * re-check between keystrokes, then ONE curated command; every unverifiable branch aborts
 * WITHOUT sending the command.
 *
 * Drives the REAL production injector (`continuityActuatorDeps(...).inject`) — exported for
 * exactly this reason: the tick-level suites replace `actuate` whole, so nothing else can reach
 * this loop's behavior. The registry is partially mocked (a fake client entry whose event
 * matches the fake menu frame); `agent-commands` stays REAL, so the curated key resolving to
 * the verbatim directive text is pinned against the live allowlist, not a fixture.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockSend = vi.fn()
vi.mock('@/services/agents-core-service', () => ({
  sendAgentSessionCommand: (...a: unknown[]) => mockSend(...a),
}))

const mockCapture = vi.fn()
vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({ capturePane: (...a: unknown[]) => mockCapture(...a) }),
}))

// The injector resolves the event for its re-check via findClientEntry; feed it a fake client
// whose single event matches the fake menu. ESC_KEYSTROKE stays real (the injected byte is part
// of what this suite pins).
const MENU_MARKER = 'FAKE-ASK-USER-QUESTION-MENU'
vi.mock('@/lib/continuity-registry', async (orig) => {
  const actual = await orig<typeof import('@/lib/continuity-registry')>()
  return {
    ...actual,
    findClientEntry: (program: string | null | undefined) =>
      program === 'claude'
        ? {
            program: 'claude',
            events: [
              {
                id: 'fake-menu',
                match: (obs: { frame: string }) => obs.frame.includes(MENU_MARKER),
                response: { kind: 'esc-then-command', commandKey: 'continuity-decide-yourself', maxEsc: 3 },
              },
              {
                id: 'throwing-menu',
                match: () => { throw new Error('matcher exploded') },
                response: { kind: 'esc-then-command', commandKey: 'continuity-decide-yourself', maxEsc: 2 },
              },
            ],
          }
        : null,
  }
})

// Modules fleet-continuity imports at top level but this suite never exercises.
vi.mock('@/lib/agent-registry', () => ({ listAgents: () => [], getAgent: () => undefined }))
vi.mock('@/lib/session-safe-state', () => ({ readHookNotification: () => null }))
vi.mock('@/lib/janitor-control', () => ({ fleetActuationBlocked: () => ({ blocked: false, reason: null }) }))
vi.mock('@/lib/agent-auth', () => ({ buildSystemAuthContext: () => ({ isSystemOwner: true }) }))

import { continuityActuatorDeps } from '@/lib/fleet-continuity'
import { ESC_KEYSTROKE } from '@/lib/continuity-registry'
import { getAgentCommand } from '@/lib/agent-commands'
import type { ContinuityAction } from '@/lib/fleet-recovery-actuator'

const DIRECTIVE = getAgentCommand('continuity-decide-yourself')!.command

function action(overrides: Partial<ContinuityAction> = {}): ContinuityAction {
  return {
    agentId: 'agent-1',
    name: 'agent-1',
    sessionName: 'agent-1',
    program: 'claude',
    eventId: 'fake-menu',
    response: { kind: 'esc-then-command', commandKey: 'continuity-decide-yourself', maxEsc: 3 },
    ...overrides,
  }
}

const MENU_FRAME = `some tui chrome\n${MENU_MARKER}\n❯ 1. option`
const CLEAN_FRAME = 'ordinary composer prompt, no menu'

describe('TRDD-U6AS2YWB — esc-then-command injector', () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockCapture.mockReset()
    mockSend.mockResolvedValue({ error: undefined, status: 200 })
  })

  it('ESCs until the menu leaves the frame, then sends the curated directive at idle', async () => {
    /** The happy path of the card's acceptance box 1: menu dismissed, directive lands */
    // Menu survives the first ESC, gone after the second.
    mockCapture.mockResolvedValueOnce(MENU_FRAME).mockResolvedValueOnce(CLEAN_FRAME)
    const { inject } = continuityActuatorDeps(Date.now())
    const r = await inject(action())

    expect(r.ok).toBe(true)
    // Exactly 2 ESCs (raw, no newline, no idle wait) + 1 command (the VERBATIM directive,
    // newline, requireIdle) — the send sequence IS the contract.
    const sends = mockSend.mock.calls.map((c) => c[1]) as Array<{ command: string; addNewline: boolean; requireIdle: boolean }>
    expect(sends).toHaveLength(3)
    expect(sends[0]).toMatchObject({ command: ESC_KEYSTROKE, addNewline: false, requireIdle: false })
    expect(sends[1]).toMatchObject({ command: ESC_KEYSTROKE, addNewline: false, requireIdle: false })
    expect(sends[2]).toMatchObject({ command: DIRECTIVE, addNewline: true, requireIdle: true })
  })

  it('BOUNDED: a menu that survives maxEsc ESCs aborts and the command is NOT sent', async () => {
    /** Acceptance box 3 — the ESC count is bounded, and the abort direction is no-command */
    mockCapture.mockResolvedValue(MENU_FRAME) // never dismissed
    const { inject } = continuityActuatorDeps(Date.now())
    const r = await inject(action())

    expect(r.ok).toBe(false)
    expect(String(r.detail)).toMatch(/command NOT sent/i)
    const sends = mockSend.mock.calls.map((c) => c[1]) as Array<{ command: string }>
    expect(sends).toHaveLength(3) // maxEsc exactly — not maxEsc+1, not unbounded
    expect(sends.every((s) => s.command === ESC_KEYSTROKE)).toBe(true)
  })

  it('refuses outright without a sessionName — zero keystrokes', async () => {
    /** An unverifiable pane must not be actuated at all */
    const { inject } = continuityActuatorDeps(Date.now())
    const r = await inject(action({ sessionName: undefined }))
    expect(r.ok).toBe(false)
    expect(String(r.detail)).toMatch(/no sessionName/i)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('a THROWING matcher counts as still-present — aborts without the command', async () => {
    /** Fail toward not-sending: an unevaluable re-check must never release the directive */
    mockCapture.mockResolvedValue(CLEAN_FRAME)
    const { inject } = continuityActuatorDeps(Date.now())
    const r = await inject(action({ eventId: 'throwing-menu', response: { kind: 'esc-then-command', commandKey: 'continuity-decide-yourself', maxEsc: 2 } }))
    expect(r.ok).toBe(false)
    const sends = mockSend.mock.calls.map((c) => c[1]) as Array<{ command: string }>
    expect(sends.every((s) => s.command === ESC_KEYSTROKE)).toBe(true)
  })
})

/**
 * NEUTER RUN (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(!stillPresent\) \{ dismissed = true; break \}/if (false) { … }/   [fleet-continuity.ts]
 *   → 1 red / 3 green, exactly as predicted:
 *       RED: ESCs until the menu leaves the frame, then sends the curated directive at idle
 *       green: the abort-direction tests (a loop that can never see "dismissed" aborts, which
 *       is those tests' expected behavior — they pin the SAFE half)
 */
