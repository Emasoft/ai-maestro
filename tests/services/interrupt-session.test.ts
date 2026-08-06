/**
 * `interruptSession` — the raw-interrupt primitive of the ABSORBED daemon (ai-maestro#60).
 *
 * ⚠ READ THIS BEFORE ADDING A ROUTE TEST. This function has no HTTP surface and must not get one.
 * The janitor's continuity daemon was absorbed into this server so that no external process could
 * drive the agents in the harness — the absorbed daemon is `startFleetLivenessWatchdog` plus the
 * fleet-recovery runner/actuator, running IN this process, and `lib/janitor-daemon-publisher.ts`
 * states the ruling: janitor processes never call in, they RECEIVE a file the server deposits.
 * An inbound authenticated "daemon injection" route was built on 2026-08-06 and reverted the same
 * hour by the USER: authenticating an external daemon re-opens, with ceremony, the hole the
 * absorption closed. The caller here is the server itself.
 *
 * WHAT IS PINNED, and why each is easy to ship broken:
 *   1. it sends a RAW (non-literal) key. The capability lives at `AgentRuntime.sendKeys`
 *      (lib/agent-runtime.ts:351) and was unreachable only because `sendCommand` hardcodes
 *      `literal: true`. A regression routing this through the literal path would TYPE the word
 *      Escape into the pane and report success — indistinguishable from working, from outside.
 *   2. it marks `injectedPrompts` (#117). Without the mark the target's UserPromptSubmit hook
 *      records a HUMAN at the keyboard and fleet-recovery stands down — a recovery primitive
 *      defeating the recovery it performs, silently.
 *   3. `interrupted` is MEASURED, not assumed: false when the session was already idle (nothing
 *      was broken, so claiming otherwise would be a false success report) and false when a busy
 *      session stays busy.
 *
 * NEUTER RUNS (2026-08-06 — OBSERVED via scripts/dev/neuter, restore blob-verified; recorded
 * against the pre-revert file, which drove the same two assertions through the same primitive):
 *   · `sendKeys(sessionName, 'Escape')` → `sendKeys(…, 'Escape', { literal: true })`
 *     → red: 'interrupt sends a RAW non-literal key'.
 *   · `injectedPrompts.set(...)` deleted from `interruptSession`
 *     → red: 'interrupt marks the injection (#117)'. sendCommand's own mark is untouched and its
 *       tests stay green — which is what shows the two doors are pinned SEPARATELY.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockRuntime, mockRegistry, mockSharedState } = vi.hoisted(() => ({
  mockRuntime: {
    sessionExists: vi.fn(async () => true),
    sendKeys: vi.fn(async () => undefined),
    cancelCopyMode: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    createSession: vi.fn(async () => undefined),
    killSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    capturePane: vi.fn(async () => ''),
    setEnvironment: vi.fn(async () => undefined),
    unsetEnvironment: vi.fn(async () => undefined),
  },
  mockRegistry: {
    getAgent: vi.fn(),
    getAgentBySession: vi.fn(),
    getAgentByName: vi.fn(),
    createAgent: vi.fn(),
    deleteAgentBySession: vi.fn(),
    renameAgentSession: vi.fn(),
    loadAgents: vi.fn(() => []),
    linkSession: vi.fn(),
    unlinkSession: vi.fn(),
  },
  mockSharedState: {
    // The REAL Maps: `interrupted` is derived from sessionActivity and the #117 assertion reads
    // injectedPrompts, so vi.fn() no-ops would make BOTH unobservable — the "a mocked write is a
    // no-op, so no post-condition can discriminate" trap.
    sessionActivity: new Map<string, number>(),
    injectedPrompts: new Map<string, number>(),
    broadcastStatusUpdate: vi.fn(),
  },
}))

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => mockRuntime,
  prepareShellForLaunch: vi.fn(async () => ({ ready: true, interrupted: false })),
  preflightPaneKeychain: vi.fn(async () => ({ status: 'ok' as const })),
  SHELL_READY_TIMEOUT_MS: 15000,
}))
vi.mock('@/lib/agent-registry', () => mockRegistry)
vi.mock('@/services/shared-state', () => mockSharedState)

import { interruptSession } from '@/services/sessions-service'

const AGENT = { id: 'agent-uuid-1', name: 'probe-agent' }
const SESSION = 'probe-agent'
const SERVER = { isSystemOwner: true, agentId: undefined } // the absorbed daemon IS the server

beforeEach(() => {
  vi.clearAllMocks()
  mockSharedState.sessionActivity.clear()
  mockSharedState.injectedPrompts.clear()
  mockRuntime.sessionExists.mockResolvedValue(true)
  mockRegistry.getAgentBySession.mockReturnValue(AGENT)
})

describe('interruptSession — the raw-key primitive', () => {
  it('sends a RAW non-literal key, never the literal text', async () => {
    const r = await interruptSession(SESSION, { authContext: SERVER, observeMs: 0 })
    expect(r.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith(SESSION, 'Escape')
    // The absence of an options object is the load-bearing half: `literal: true` is what would
    // turn this into typed text.
    const [, , opts] = mockRuntime.sendKeys.mock.calls[0] as unknown[]
    expect(opts).toBeUndefined()
  })

  it('marks the injection (#117) so the target is not read as a human at the keyboard', async () => {
    await interruptSession(SESSION, { authContext: SERVER, observeMs: 0 })
    expect(mockSharedState.injectedPrompts.has(SESSION)).toBe(true)
  })

  it('reports interrupted=false for a session that was already idle — an honest report', async () => {
    const r = await interruptSession(SESSION, { authContext: SERVER, observeMs: 0 })
    expect(r.data).toMatchObject({ delivered: true, interrupted: false })
  })

  it('reports interrupted=true when a BUSY session goes idle inside the window', async () => {
    mockSharedState.sessionActivity.set(SESSION, Date.now())
    const p = interruptSession(SESSION, { authContext: SERVER, observeMs: 1000 })
    setTimeout(() => mockSharedState.sessionActivity.set(SESSION, Date.now() - 60_000), 50)
    expect((await p).data).toMatchObject({ delivered: true, interrupted: true })
  })

  it('reports interrupted=false when a BUSY session stays busy — measured, not assumed', async () => {
    mockSharedState.sessionActivity.set(SESSION, Date.now())
    const r = await interruptSession(SESSION, { authContext: SERVER, observeMs: 400 })
    expect(r.data).toMatchObject({ delivered: true, interrupted: false })
  })

  it('a missing tmux session is 404, and nothing is typed', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    const r = await interruptSession(SESSION, { authContext: SERVER, observeMs: 0 })
    expect(r.status).toBe(404)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('refuses without an auth context — 401, nothing typed', async () => {
    const r = await interruptSession(SESSION, { authContext: null as never, observeMs: 0 })
    expect(r.status).toBe(401)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('an AGENT may not interrupt a PEER — R42 send-command is self-only', async () => {
    // The one authorization case that matters now that there is no external caller: the primitive
    // is reachable in-process by the server, and by an agent only against itself.
    const r = await interruptSession(SESSION, {
      authContext: { isSystemOwner: false, agentId: 'some-other-agent' },
      observeMs: 0,
    })
    expect(r.status).toBe(403)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })
})
