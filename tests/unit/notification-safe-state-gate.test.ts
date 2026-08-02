import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-YPIRL5RA DEFECT 2 — the safe-state gate in `notifyAgent`.
 *
 * WHY THIS FILE EXISTS: the gate shipped with `9d44c29c` and was pinned by NOTHING. Eight test
 * files reference `@/lib/notification-service`, and SEVEN of them `vi.mock(...)` the whole module —
 * mocking the guard to prove the guard, so every one of them survives its deletion. Zero tests in
 * the tree named `readHookNotification` or `BUSY_NOTIFICATION_TYPES`. A grep for the module reads
 * like coverage and is the opposite.
 *
 * What the gate is FOR: `sendTmuxNotification` injects `echo '…'` + Enter into the pane
 * unconditionally (NT-027), so a governance/teams/groups/transfer notification could land mid-turn
 * and corrupt an in-flight session. The gate skips ONLY on POSITIVE busy evidence and FAILS OPEN
 * otherwise — that asymmetry is the whole design, and it is what the two positive controls below
 * pin. Without them, a gate that skipped on ANY non-null hook state would pass every skip test.
 */

const mockGetAgent = vi.fn()
const mockGetAgentByName = vi.fn()
const mockSessionExists = vi.fn()
const mockSendKeys = vi.fn()
const mockReadHookNotification = vi.fn()

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (...a: unknown[]) => mockGetAgent(...a),
  getAgentByName: (...a: unknown[]) => mockGetAgentByName(...a),
}))

vi.mock('@/lib/hosts-config-server.mjs', () => ({
  getSelfHostId: () => 'self-host',
  isSelf: (h: string) => h === 'self-host' || h === 'local',
}))

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({
    sessionExists: (...a: unknown[]) => mockSessionExists(...a),
    sendKeys: (...a: unknown[]) => mockSendKeys(...a),
  }),
}))

vi.mock('@/lib/session-safe-state', () => ({
  readHookNotification: (...a: unknown[]) => mockReadHookNotification(...a),
}))

import { notifyAgent } from '@/lib/notification-service'

const AGENT = {
  id: 'agent-1',
  name: 'worker',
  workingDirectory: '/Users/test/agents/worker',
  sessions: [{ index: 0, status: 'online' }],
}

function opts() {
  return {
    agentId: 'agent-1',
    agentName: 'worker',
    fromName: 'manager',
    subject: 'a delegated mandate',
    messageId: 'msg-1',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAgent.mockReturnValue(AGENT)
  mockGetAgentByName.mockReturnValue(AGENT)
  mockSessionExists.mockResolvedValue(true)
  mockSendKeys.mockResolvedValue(undefined)
})

describe('notifyAgent safe-state gate (TRDD-YPIRL5RA DEFECT 2) — skip on PROVEN busy, fail open otherwise', () => {
  it('POSITIVE CONTROL — no hook state at all (null) FAILS OPEN and sends', async () => {
    // Non-vacuity for every `not.toHaveBeenCalled()` below: without this, a function that died at an
    // earlier return would satisfy all four skip assertions while proving nothing about the gate.
    mockReadHookNotification.mockReturnValue(null)

    const r = await notifyAgent(opts())

    expect(r).toMatchObject({ success: true, notified: true })
    expect(mockSendKeys).toHaveBeenCalledTimes(1)
  })

  it('POSITIVE CONTROL — an IDLE pane with hook state present still sends', async () => {
    // The discriminator. A gate that skipped whenever `hook !== null` would pass the null-state
    // control and all three skip tests; only this one tells "skip on busy evidence" apart from
    // "skip on any evidence". idle_prompt is the exact state the notification exists to reach.
    mockReadHookNotification.mockReturnValue({ status: 'idle', notificationType: 'idle_prompt' })

    const r = await notifyAgent(opts())

    expect(r).toMatchObject({ success: true, notified: true })
    expect(mockSendKeys).toHaveBeenCalledTimes(1)
  })

  it('skips a pane that is ACTIVE mid-turn — never types into a running turn', async () => {
    mockReadHookNotification.mockReturnValue({ status: 'active', notificationType: null })

    const r = await notifyAgent(opts())

    // Both halves matter: `notified:false` alone is produced by four EARLIER returns (disabled,
    // remote host, agent not found, session missing), so the reason pins WHICH refusal this was,
    // and the sendKeys assertion pins that nothing reached the pane.
    expect(r).toMatchObject({ success: true, notified: false })
    expect(r.reason).toMatch(/^Agent busy: active$/)
    expect(mockSendKeys).not.toHaveBeenCalled()
  })

  it('skips a pane blocked on a permission prompt — the user owns that pane', async () => {
    mockReadHookNotification.mockReturnValue({ status: 'idle', notificationType: 'permission_prompt' })

    const r = await notifyAgent(opts())

    expect(r).toMatchObject({ success: true, notified: false })
    expect(r.reason).toMatch(/^Agent busy: idle$/)
    expect(mockSendKeys).not.toHaveBeenCalled()
  })

  it('skips a pane blocked on an elicitation dialog', async () => {
    mockReadHookNotification.mockReturnValue({ status: 'idle', notificationType: 'elicitation_dialog' })

    const r = await notifyAgent(opts())

    expect(r).toMatchObject({ success: true, notified: false })
    expect(mockSendKeys).not.toHaveBeenCalled()
  })

  it('reads the hook state for the AGENT own workdir, not the session name', async () => {
    // The gate is only as good as what it asks about: passing a session name here would read some
    // other (or no) agent's state and fail open on every busy pane.
    mockReadHookNotification.mockReturnValue(null)

    await notifyAgent(opts())

    expect(mockReadHookNotification).toHaveBeenCalledWith(AGENT.workingDirectory)
  })

  it('an UNKNOWN notificationType is not busy evidence — fails open', async () => {
    // The busy set is a closed allowlist, deliberately: a hook that grows a new state must not
    // silently start suppressing notifications before anyone decides that state means "busy".
    mockReadHookNotification.mockReturnValue({ status: 'idle', notificationType: 'some_future_state' })

    const r = await notifyAgent(opts())

    expect(r).toMatchObject({ success: true, notified: true })
    expect(mockSendKeys).toHaveBeenCalledTimes(1)
  })
})

/**
 * NEUTER RECORD — 2026-08-02
 *
 * Mutation: delete the whole `if (hook && (hook.status === 'active' || …)) { … return … }` block
 * from `lib/notification-service.ts::notifyAgent` (the gate itself).
 *
 * Reddens exactly 3, by name:
 *   × skips a pane that is ACTIVE mid-turn — never types into a running turn
 *   × skips a pane blocked on a permission prompt — the user owns that pane
 *   × skips a pane blocked on an elicitation dialog
 *
 * Stays GREEN (correctly — they assert the fail-open half, which the deletion also produces):
 *   ✓ both POSITIVE CONTROLs, the workdir-argument test, the unknown-type test
 *
 * Complementary mutation — widen the condition to `if (hook)` (skip on ANY hook state). MEASURED,
 * and it corrects what I first wrote here: it reddens exactly 2, not 3.
 *   × POSITIVE CONTROL — an IDLE pane with hook state present still sends
 *   × an UNKNOWN notificationType is not busy evidence — fails open
 *
 * The null-state POSITIVE CONTROL stays GREEN under it, necessarily: its `hook` IS null, so
 * `if (hook)` is false and it sends either way. That test is the non-vacuity anchor for neuter A
 * and is BLIND to neuter B by construction — which is the whole reason the idle-pane control had to
 * exist as a separate test. Between the two mutations every branch of the gate is pinned by one
 * that reaches it, and no single mutation reds the whole file (a mutation that reds everything
 * tells you nothing about which half you broke).
 */
