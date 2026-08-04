/**
 * TRDD-JAU1ES1C — the WRITER half of the boot-restore ↔ `status` bridge.
 *
 * WHY THIS FILE EXISTS. `boot-restore-status.test.ts` pins the bridge module thoroughly, and that
 * is exactly what makes this gap easy to miss: with the reader fully covered, the wiring LOOKS
 * tested. It was not. Measured before writing this file — deleting `clearBootRestore()` from the
 * service's `finally` left the FULL suite green (359 files, 5051 tests, zero red). So the stamp
 * could have been left up after every restore, and for the whole 120 s age window the status verb
 * would answer `restoring` on a host that was already live — the precise dishonesty the bridge was
 * added to remove.
 *
 * `restoreActiveAgentsOnBoot` had no tests at all; these are the first, and they are deliberately
 * scoped to the in-flight claim rather than to the restore's own behaviour.
 *
 * 0-IMPACT: `os.homedir()` is redirected to a temp dir, so the real `~/.aimaestro` is never read
 * or written. The registry, the wake, and the workdir authority are mocked; the STAMP is real,
 * because the stamp is the thing under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const H = vi.hoisted(() => {
  // `require` inline: vi.hoisted runs above every static import, so the top-of-file `fs`/`path`
  // bindings are not initialised yet.
  const { mkdtempSync, mkdirSync } = require('fs') as typeof import('fs')
  const { join } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mkdtempSync(join(root, 'aim-boot-wiring-'))
  const WORKDIR = join(FAKE_HOME, 'agents', 'alpha')
  mkdirSync(WORKDIR, { recursive: true })
  // Read at MODULE LOAD by the service, so it must be set before its import is evaluated.
  // Note `Number('0') || 1500` is 1500 — a zero stagger is unreachable by design, so use 1 ms.
  process.env.AIM_BOOT_RESTORE_STAGGER_MS = '1'
  process.env.AIM_BOOT_RESTORE_WAKE_ATTEMPTS = '1'
  return { FAKE_HOME, WORKDIR }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const homedir = () => H.FAKE_HOME
  return { ...actual, homedir, default: { ...actual, homedir } }
})

const m = vi.hoisted(() => ({
  loadAgents: vi.fn(),
  wakeAgent: vi.fn(),
  checkAuthorizedAgentWorkdir: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => ({ loadAgents: (...a: unknown[]) => m.loadAgents(...a) }))
vi.mock('@/services/agents-core-service', () => ({ wakeAgent: (...a: unknown[]) => m.wakeAgent(...a) }))
vi.mock('@/lib/agent-workdir-policy', () => ({
  checkAuthorizedAgentWorkdir: (...a: unknown[]) => m.checkAuthorizedAgentWorkdir(...a),
}))

import { restoreActiveAgentsOnBoot } from '@/services/boot-restore-service'
import { isBootRestoreInFlight } from '@/lib/boot-restore-status'

const STAMP = () => path.join(H.FAKE_HOME, '.aimaestro', 'boot-restore-in-flight.json')

function agent(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'alpha',
    status: 'active',
    workingDirectory: H.WORKDIR,
    sessions: [{ index: 0 }],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks resets CALLS, never IMPLEMENTATIONS — re-bind every default here so one test's
  // override can never leak into the next.
  m.loadAgents.mockImplementation(() => [agent()])
  m.wakeAgent.mockImplementation(async () => ({ data: { alreadyRunning: false } }))
  m.checkAuthorizedAgentWorkdir.mockImplementation(() => ({ ok: true }))
  fs.rmSync(STAMP(), { force: true })
  delete process.env.AIM_DISABLE_BOOT_RESTORE
})

afterEach(() => {
  fs.rmSync(STAMP(), { force: true })
})

describe('boot-restore publishes its in-flight claim (TRDD-JAU1ES1C)', () => {
  it('the stamp is UP during the walk and DOWN when it returns', async () => {
    // Observed from INSIDE the wake, which is the only vantage point that can see mid-walk. An
    // after-the-fact assertion cannot tell "raised then cleared" from "never raised at all".
    const seen: boolean[] = []
    m.wakeAgent.mockImplementation(async () => {
      seen.push(isBootRestoreInFlight())
      return { data: { alreadyRunning: false } }
    })

    expect(isBootRestoreInFlight()).toBe(false) // and it starts down
    const res = await restoreActiveAgentsOnBoot()

    expect(seen, 'the wake must have run, or the mid-walk reading proves nothing').toEqual([true])
    expect(isBootRestoreInFlight(), 'the finally must take the claim back down').toBe(false)
    expect(fs.existsSync(STAMP())).toBe(false)
    expect(res.restored).toEqual(['alpha[0]'])
  })

  it('re-stamps on EVERY session — the heartbeat a long fleet restore rides', async () => {
    m.loadAgents.mockImplementation(() => [agent({ sessions: [{ index: 0 }, { index: 1 }] })])
    const stampedAt: string[] = []
    m.wakeAgent.mockImplementation(async () => {
      stampedAt.push(JSON.parse(fs.readFileSync(STAMP(), 'utf8')).at)
      return { data: { alreadyRunning: false } }
    })

    await restoreActiveAgentsOnBoot()

    // Two observations, each taken after that session's own re-stamp. A single start-of-walk
    // marker would age out mid-restore on a large fleet and the verb would claim the host live.
    expect(stampedAt).toHaveLength(2)
    expect(Date.parse(stampedAt[1])).toBeGreaterThanOrEqual(Date.parse(stampedAt[0]))
  })

  it('the claim comes DOWN even when the walk THROWS — that is what the finally is for', async () => {
    // The per-session try/catch swallows a wake failure, so the throw is injected at the workdir
    // authority, which sits OUTSIDE it and genuinely propagates.
    m.checkAuthorizedAgentWorkdir.mockImplementation(() => {
      throw new Error('workdir authority exploded')
    })

    await expect(restoreActiveAgentsOnBoot()).rejects.toThrow('workdir authority exploded')
    expect(isBootRestoreInFlight(), 'a crashed walk must not leave a stamp claiming forever').toBe(false)
    expect(fs.existsSync(STAMP())).toBe(false)
  })

  it('no stamp when boot restore is DISABLED — nothing is restoring', async () => {
    process.env.AIM_DISABLE_BOOT_RESTORE = '1'
    const res = await restoreActiveAgentsOnBoot()
    expect(res.enabled).toBe(false)
    expect(fs.existsSync(STAMP()), 'a disabled restore must not claim to be running').toBe(false)
    expect(m.wakeAgent).not.toHaveBeenCalled()
  })

  it('no stamp when there is nothing to restore — an empty walk is not a restore', async () => {
    m.loadAgents.mockImplementation(() => [])
    await restoreActiveAgentsOnBoot()
    expect(fs.existsSync(STAMP())).toBe(false)
  })

  it('CONTAINMENT: the real ~/.aimaestro never received a stamp', async () => {
    // Proves the os.homedir() redirect reached the bridge. Without it every assertion above would
    // pass while writing the developer's real state dir.
    await restoreActiveAgentsOnBoot()
    const real = path.join(
      (await vi.importActual<typeof import('os')>('os')).homedir(),
      '.aimaestro',
      'boot-restore-in-flight.json',
    )
    expect(fs.existsSync(real)).toBe(false)
  })
})
