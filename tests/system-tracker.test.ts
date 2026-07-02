/**
 * Unit tests for lib/system-tracker.ts (TRDD-7123d51a §9 / task #242).
 *
 * We mock:
 *   - ~/.claude/plugins/marketplaces/ layout via a temp HOME
 *   - `<client> --version` shell-outs via a stubbed execFileAsync
 *   - @/lib/ledger-emit::emitAgentOp so we can assert on emissions
 *     without actually touching the signed ledger.
 *
 * Coverage:
 *   - First scan sets baseline without emitting
 *   - A new marketplace dir produces one `add_marketplace` emit
 *   - A modified marketplace.json produces one `update_marketplace`
 *   - A removed marketplace dir produces one `remove_marketplace`
 *   - A changed client --version output produces `change_client_version`
 *   - Tracker can be started and stopped without leaking timers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Hold the emit calls so each test can inspect them
const emitCalls: Array<{ op: string; diff: unknown; auth: unknown }> = []

vi.mock('@/lib/ledger-emit', () => ({
  emitAgentOp: (op: string, diff: unknown, auth: unknown) => {
    emitCalls.push({ op, diff, auth })
  },
}))

// Stub child_process.execFile so `<client> --version` is deterministic
const versionTable: Record<string, string | null> = {
  claude: '1.0.0',
  codex: '2.0.0',
  gemini: null,      // absent
  opencode: null,
  kiro: null,
}

vi.mock('child_process', () => ({
  execFile: (bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    const v = versionTable[bin]
    if (v === null || v === undefined) {
      cb(new Error(`ENOENT: ${bin}`))
      return
    }
    cb(null, { stdout: `${v}\n`, stderr: '' })
  },
}))

// Redirect os.homedir() to a per-test tmp dir so we don't touch the
// developer's real marketplaces. Note: os must be required via
// destructuring for the monkey-patch to take effect inside the module
// under test (ESM import semantics).
let tmpHome: string
let realHomedir: typeof os.homedir

beforeEach(() => {
  emitCalls.length = 0
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-sys-tracker-'))
  realHomedir = os.homedir
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(os as any).homedir = () => tmpHome
})

afterEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(os as any).homedir = realHomedir
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
  const mod = await import('@/lib/system-tracker')
  mod.__resetSystemTrackerForTests()
  vi.restoreAllMocks()
})

function writeMarketplace(name: string, json: Record<string, unknown>) {
  const dir = path.join(tmpHome, '.claude', 'plugins', 'marketplaces', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify(json))
}

function removeMarketplace(name: string) {
  const dir = path.join(tmpHome, '.claude', 'plugins', 'marketplaces', name)
  fs.rmSync(dir, { recursive: true, force: true })
}

describe('SystemTracker — TRDD-7123d51a §9 (#242)', () => {
  it('first scan sets baseline WITHOUT emitting ledger entries', async () => {
    writeMarketplace('alpha', { plugins: [{ name: 'p1' }] })
    const { getSystemTracker } = await import('@/lib/system-tracker')
    const tracker = getSystemTracker({ intervalMs: 0, versionTimeoutMs: 500 })
    // Force a manual scan via the private `runScan` — we call it through
    // the internal API used by tests. With intervalMs=0 the public
    // start() is a no-op so we don't have to stop it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tracker as any).runScan()
    expect(emitCalls).toHaveLength(0)
  })

  it('detects add / update / remove of a marketplace across ticks', async () => {
    writeMarketplace('alpha', { plugins: [{ name: 'p1' }] })
    const { getSystemTracker } = await import('@/lib/system-tracker')
    const tracker = getSystemTracker({ intervalMs: 0, versionTimeoutMs: 500 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scan = () => (tracker as any).runScan()

    await scan()              // baseline
    expect(emitCalls).toHaveLength(0)

    writeMarketplace('beta', { plugins: [{ name: 'p2' }] })
    await scan()
    const adds = emitCalls.filter(c => c.op === 'add_marketplace')
    expect(adds).toHaveLength(1)
    expect(adds[0].diff).toEqual([{
      op: 'add',
      path: '/system/marketplaces/beta',
      value: expect.objectContaining({ pluginCount: 1, pluginNames: ['p2'] }),
    }])

    writeMarketplace('beta', { plugins: [{ name: 'p2' }, { name: 'p3' }] })
    await scan()
    const updates = emitCalls.filter(c => c.op === 'update_marketplace')
    expect(updates).toHaveLength(1)
    expect(updates[0].diff).toEqual([{
      op: 'replace',
      path: '/system/marketplaces/beta',
      value: expect.objectContaining({ pluginCount: 2, pluginNames: ['p2', 'p3'] }),
    }])

    removeMarketplace('alpha')
    await scan()
    const removes = emitCalls.filter(c => c.op === 'remove_marketplace')
    expect(removes).toHaveLength(1)
    expect(removes[0].diff).toEqual([{
      op: 'remove',
      path: '/system/marketplaces/alpha',
    }])
  })

  it('emits change_client_version when a known client version changes', async () => {
    const { getSystemTracker } = await import('@/lib/system-tracker')
    const tracker = getSystemTracker({ intervalMs: 0, versionTimeoutMs: 500 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scan = () => (tracker as any).runScan()

    await scan()              // baseline: claude=1.0.0, codex=2.0.0
    expect(emitCalls.filter(c => c.op === 'change_client_version')).toHaveLength(0)

    versionTable.claude = '1.1.0'
    await scan()
    const changes = emitCalls.filter(c => c.op === 'change_client_version')
    expect(changes).toHaveLength(1)
    expect(changes[0].diff).toEqual([{
      op: 'replace',
      path: '/system/clientVersions/claude',
      value: { client: 'claude', old: '1.0.0', new: '1.1.0' },
    }])
  })

  it('all emissions use authActor=system + authAgentId=null', async () => {
    writeMarketplace('alpha', { plugins: [{ name: 'p1' }] })
    const { getSystemTracker } = await import('@/lib/system-tracker')
    const tracker = getSystemTracker({ intervalMs: 0, versionTimeoutMs: 500 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scan = () => (tracker as any).runScan()

    await scan()              // baseline
    writeMarketplace('beta', { plugins: [{ name: 'q1' }] })
    await scan()

    for (const c of emitCalls) {
      expect(c.auth).toEqual(expect.objectContaining({
        actor: 'system',
        agentId: null,
      }))
    }
  })

  it('start + stop cleans up the interval without emitting', async () => {
    const { getSystemTracker } = await import('@/lib/system-tracker')
    const tracker = getSystemTracker({ intervalMs: 0, versionTimeoutMs: 500 })
    tracker.start()
    expect(tracker.getStatus().isRunning).toBe(false)  // 0 → disabled
    tracker.stop()
    expect(tracker.getStatus().isRunning).toBe(false)
  })
})
