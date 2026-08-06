/**
 * The daemon injection dispatch + the interrupt primitive (TRDD-APN5WB2L; ai-maestro#60).
 *
 * `tests/unit/daemon-principal.test.ts` pins the AUTH gates. This file pins what happens AFTER a
 * request verifies, and the two properties that are easy to ship broken because nothing observable
 * changes when they are:
 *
 *   1. the interrupt sends a RAW (non-literal) key, not the literal text "Escape". The capability
 *      already existed at `AgentRuntime.sendKeys` (lib/agent-runtime.ts:351) and was unreachable
 *      only because `sendCommand` hardcodes `literal: true`. A regression that routed the
 *      interrupt through the literal path would type the word Escape into the pane and report
 *      success — indistinguishable from working, from the outside.
 *   2. every server-injected keystroke marks `injectedPrompts` (#117). Without the mark the
 *      target's UserPromptSubmit hook records a HUMAN at the keyboard and fleet-recovery stands
 *      down — so a recovery primitive that skipped it would defeat the recovery it exists to
 *      perform, silently. The interrupt is a new door onto that same forgery.
 *
 * The runtime and the registry are mocked (they are the service's data sources); the service and
 * the real signature verification run REAL — a mocked verifier would test the mock.
 *
 * NEUTER RUNS (2026-08-06 — OBSERVED via scripts/dev/neuter, restore blob-verified):
 *   · A `runtime.sendKeys(sessionName, 'Escape')` → `sendKeys(sessionName, 'Escape', {literal: true})`
 *     (route the interrupt through the LITERAL path — the regression that types the word)
 *     → 1 red: 'interrupt sends a RAW non-literal key'.
 *   · B delete `injectedPrompts.set(...)` from `interruptSession`
 *     → 1 red: 'interrupt marks the injection (#117)'. sendCommand's own mark is untouched, so
 *       its test stays green — which is what shows the two doors are pinned separately.
 *   · C `requireIdle: false` → `requireIdle: true` in the submit-recovery-prompt dispatch
 *     → 1 red: 'a recovery prompt reaches a BUSY session'. This is the #110 trap: with the
 *       default, every recovery 409s exactly when it is needed.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const { TMP_STATE } = vi.hoisted(() => {
  const nodeFs = require('fs') as typeof import('fs')
  const nodeOs = require('os') as typeof import('os')
  const nodePath = require('path') as typeof import('path')
  return { TMP_STATE: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'daemon-inject-')) }
})

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
    // The REAL maps: the interrupt's `interrupted` report is derived from sessionActivity, and the
    // #117 assertion reads injectedPrompts. Mocking them as no-ops would make both unobservable —
    // the "a mocked write is a no-op, so no post-condition can discriminate" trap.
    sessionActivity: new Map<string, number>(),
    injectedPrompts: new Map<string, number>(),
    broadcastStatusUpdate: vi.fn(),
  },
}))

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  return { ...actual, getStateDir: () => TMP_STATE, statePath: (...s: string[]) => path.join(TMP_STATE, ...s) }
})
vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => mockRuntime,
  prepareShellForLaunch: vi.fn(async () => ({ ready: true, interrupted: false })),
  preflightPaneKeychain: vi.fn(async () => ({ status: 'ok' as const })),
  SHELL_READY_TIMEOUT_MS: 15000,
}))
vi.mock('@/lib/agent-registry', () => mockRegistry)
vi.mock('@/services/shared-state', () => mockSharedState)

import { daemonInject } from '@/services/daemon-inject-service'
import { interruptSession } from '@/services/sessions-service'
import { saveDaemonEnrollment, canonicalRequest, _resetNonceStoreForTests } from '@/lib/daemon-principal'

afterAll(() => {
  fs.rmSync(TMP_STATE, { recursive: true, force: true })
})

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_HEX = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex')

const AGENT = { id: 'agent-uuid-1', name: 'probe-agent' }
const SESSION = 'probe-agent' // computeSessionName(name, 0)

let nonce = 0
function signed(over: Record<string, unknown> = {}) {
  const base = {
    target: AGENT.id,
    action: 'submit-recovery-prompt',
    payload: '/janitor-arm',
    nonce: `n-${++nonce}`,
    issued_at: Math.floor(Date.now() / 1000),
    ...over,
  }
  return { ...base, signature: crypto.sign(null, Buffer.from(canonicalRequest(base as never)), privateKey).toString('base64') }
}

const OWNER = { isSystemOwner: true, agentId: undefined }

beforeEach(() => {
  vi.clearAllMocks()
  _resetNonceStoreForTests()
  mockSharedState.sessionActivity.clear()
  mockSharedState.injectedPrompts.clear()
  mockRuntime.sessionExists.mockResolvedValue(true)
  mockRegistry.getAgent.mockImplementation((id: string) => (id === AGENT.id ? AGENT : null))
  mockRegistry.getAgentBySession.mockReturnValue(AGENT)
  saveDaemonEnrollment({ publicKeyHex: PUBLIC_HEX, enrolledAt: new Date().toISOString() })
})

describe('interruptSession — the primitive', () => {
  it('interrupt sends a RAW non-literal key, never the literal text', async () => {
    // If this ever routed through the literal path it would TYPE the word "Escape" into the pane
    // and still report success.
    const r = await interruptSession(SESSION, { authContext: OWNER, observeMs: 0 })
    expect(r.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith(SESSION, 'Escape')
    // Asserting the ABSENCE of an options object is the load-bearing half: `literal: true` is
    // what would turn this into typed text, and toHaveBeenCalledWith above would still pass with
    // an extra argument present in some vitest matcher styles.
    const [, , opts] = mockRuntime.sendKeys.mock.calls[0] as unknown[]
    expect(opts).toBeUndefined()
  })

  it('interrupt marks the injection (#117) so the target is not read as a human at the keyboard', async () => {
    await interruptSession(SESSION, { authContext: OWNER, observeMs: 0 })
    expect(mockSharedState.injectedPrompts.has(SESSION)).toBe(true)
  })

  it('reports interrupted=false for a session that was already idle — an honest report, not a claim', async () => {
    // No activity recorded ⇒ idle. Nothing was broken, so saying so would be a false success.
    const r = await interruptSession(SESSION, { authContext: OWNER, observeMs: 0 })
    expect(r.data).toMatchObject({ delivered: true, interrupted: false })
  })

  it('reports interrupted=true when a BUSY session goes idle inside the window', async () => {
    mockSharedState.sessionActivity.set(SESSION, Date.now()) // busy now
    const p = interruptSession(SESSION, { authContext: OWNER, observeMs: 1000 })
    // The turn breaks: activity ages out past the idle threshold.
    setTimeout(() => mockSharedState.sessionActivity.set(SESSION, Date.now() - 60_000), 50)
    const r = await p
    expect(r.data).toMatchObject({ delivered: true, interrupted: true })
  })

  it('reports interrupted=false when a BUSY session stays busy — the report is measured, not assumed', async () => {
    mockSharedState.sessionActivity.set(SESSION, Date.now())
    const r = await interruptSession(SESSION, { authContext: OWNER, observeMs: 400 })
    expect(r.data).toMatchObject({ delivered: true, interrupted: false })
  })

  it('a missing tmux session is 404, and nothing is typed', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    const r = await interruptSession(SESSION, { authContext: OWNER, observeMs: 0 })
    expect(r.status).toBe(404)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('refuses without an auth context — 401, nothing typed', async () => {
    const r = await interruptSession(SESSION, { authContext: null as never, observeMs: 0 })
    expect(r.status).toBe(401)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })
})

describe('daemonInject — dispatch after a VERIFIED request', () => {
  it('a recovery prompt reaches a BUSY session — requireIdle:false is the point (#110 trap)', async () => {
    // A frozen agent is BY DEFINITION not idle. With the default requireIdle this 409s, i.e. every
    // recovery is refused exactly when it is needed.
    mockSharedState.sessionActivity.set(SESSION, Date.now()) // busy
    const r = await daemonInject(signed())
    expect(r.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith(SESSION, '/janitor-arm', { literal: true, enter: true })
  })

  it('the interrupt verb dispatches to the raw-key primitive', async () => {
    const r = await daemonInject(signed({ action: 'interrupt', payload: '' }))
    expect(r.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith(SESSION, 'Escape')
  })

  it('targets by agent UUID and lets the SERVER derive the pane', async () => {
    // A caller-supplied session name would be rename-unstable — after a rename it aims the
    // recovery at whatever now owns the old name.
    await daemonInject(signed())
    expect(mockRegistry.getAgent).toHaveBeenCalledWith(AGENT.id)
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith(SESSION, expect.anything(), expect.anything())
  })

  it('an unknown agent is 404 — nothing typed anywhere', async () => {
    const r = await daemonInject(signed({ target: 'no-such-agent' }))
    expect(r.status).toBe(404)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('an empty recovery payload is 400, not an empty keystroke', async () => {
    const r = await daemonInject(signed({ payload: '' }))
    expect(r.status).toBe(400)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('maps each auth failure to a DISTINCT status so a recovery loop can act on it', async () => {
    // 401 not-the-daemon / 409 replay / 403 ungranted verb — a loop that only ever saw one status
    // could not tell clock skew from a replay from a permission problem.
    const forged = { ...signed(), signature: 'AAAA' }
    expect((await daemonInject(forged)).status).toBe(401)

    const req = signed()
    expect((await daemonInject(req)).status).toBe(200)
    expect((await daemonInject(req)).status).toBe(409) // replay

    expect((await daemonInject(signed({ action: 'delete-agent' }))).status).toBe(403)
    expect((await daemonInject({ nope: true })).status).toBe(400)
  })

  it('a REFUSED request types nothing — the refusal is before any effect', async () => {
    await daemonInject({ ...signed(), signature: 'AAAA' })
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })
})
