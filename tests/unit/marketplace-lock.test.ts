/**
 * Tests for the marketplace/plugin-update chore lock (TRDD-S5RUHJRP — Flock-D D4) and the shared
 * server-lockfile mechanism it is built on.
 *
 * The load-bearing invariant is NEGATIVE and easy to regress: the lock filename must stay
 * DISTINCT from the janitor's own `marketplace-op.lock`. Node cannot join the janitor's kernel
 * `fcntl.flock(2)`, so borrowing its filename would LOOK like cross-process coordination while
 * providing none — a silent failure that reads as correct. A test pins the name so a future
 * "let's just use the same file" edit fails loudly.
 *
 * 0-IMPACT: every lock lands under an isolated temp dir (JANITOR_GLOBAL_STATE_DIR), never the
 * real global-state. No network, no CLI, no shared files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  MARKETPLACE_OP_LOCK_NAME,
  tryAcquireMarketplaceLock,
  withMarketplaceLock,
} from '@/lib/marketplace-lock'
import { serverLockPath, tryAcquireServerLock, withServerLock } from '@/lib/server-lockfile'

let savedEnv: string | undefined
let tmpDir: string
let lockFile: string

beforeEach(() => {
  savedEnv = process.env.JANITOR_GLOBAL_STATE_DIR
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-mkt-lock-'))
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir
  lockFile = path.join(tmpDir, MARKETPLACE_OP_LOCK_NAME)
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.JANITOR_GLOBAL_STATE_DIR
  else process.env.JANITOR_GLOBAL_STATE_DIR = savedEnv
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('marketplace lock — the name is the honesty', () => {
  it('is DISTINCT from the janitor kernel-flock lock it cannot join', () => {
    // Borrowing 'marketplace-op.lock' would imply cross-process exclusion that an O_EXCL
    // lockfile cannot provide against fcntl.flock(2). Keep the names apart.
    expect(MARKETPLACE_OP_LOCK_NAME).not.toBe('marketplace-op.lock')
    expect(MARKETPLACE_OP_LOCK_NAME).toBe('marketplace-op-server.lock')
  })

  it('lands in the janitor global-state dir, so every server lock is in ONE place', () => {
    expect(serverLockPath(MARKETPLACE_OP_LOCK_NAME)).toBe(lockFile)
  })
})

describe('marketplace lock — mutual exclusion', () => {
  it('a second acquire is refused while the first is held, and works after release', () => {
    const a = tryAcquireMarketplaceLock()
    expect(a).not.toBeNull()
    expect(fs.existsSync(lockFile)).toBe(true)

    expect(tryAcquireMarketplaceLock()).toBeNull() // a live holder has it

    a!.release()
    expect(fs.existsSync(lockFile)).toBe(false)

    const b = tryAcquireMarketplaceLock()
    expect(b).not.toBeNull()
    b!.release()
  })

  it('release is idempotent', () => {
    const a = tryAcquireMarketplaceLock()
    a!.release()
    expect(() => a!.release()).not.toThrow()
  })

  it('withMarketplaceLock runs the body and releases afterwards', async () => {
    let ran = false
    const out = await withMarketplaceLock(async () => {
      ran = true
      expect(fs.existsSync(lockFile)).toBe(true) // held for the duration
      return 'done'
    })
    expect(ran).toBe(true)
    expect(out).toBe('done')
    expect(fs.existsSync(lockFile)).toBe(false)
  })

  it('withMarketplaceLock SKIPS (returns null, body never runs) when the lock is held', async () => {
    const held = tryAcquireMarketplaceLock()
    let ran = false
    const out = await withMarketplaceLock(async () => {
      ran = true
      return 'should not happen'
    })
    // The chore must SKIP rather than block — a maintenance chore never stalls the tick.
    expect(out).toBeNull()
    expect(ran).toBe(false)
    held!.release()
  })

  it('releases even when the body throws', async () => {
    await expect(
      withMarketplaceLock(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(fs.existsSync(lockFile), 'a throwing chore must not wedge the lock forever').toBe(false)
  })
})

describe('server-lockfile — stale reclaim', () => {
  it('reclaims a lock whose holder pid is dead', () => {
    // pid 2^22 is above every real pid on macOS/Linux, so it is reliably not running.
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(lockFile, `4194304\t${new Date().toISOString()}\n`)
    const a = tryAcquireMarketplaceLock()
    expect(a, 'a dead holder must not block the chore forever').not.toBeNull()
    a!.release()
  })

  it('reclaims a corrupt / empty lockfile', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(lockFile, '')
    const a = tryAcquireMarketplaceLock()
    expect(a).not.toBeNull()
    a!.release()
  })

  it('does NOT reclaim a fresh lock held by a LIVE pid (this process)', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(lockFile, `${process.pid}\t${new Date().toISOString()}\n`)
    expect(tryAcquireMarketplaceLock()).toBeNull()
  })

  it('reclaims a lock older than its stale window even if the pid is alive', () => {
    // A live-but-hung holder past the window is presumed abandoned. Uses a 1 ms window so the
    // test needs no clock injection; the real window is deliberately 30 min (see the module).
    fs.mkdirSync(tmpDir, { recursive: true })
    const name = 'stale-window-probe.lock'
    fs.writeFileSync(path.join(tmpDir, name), `${process.pid}\t${new Date().toISOString()}\n`)
    fs.utimesSync(path.join(tmpDir, name), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    const a = tryAcquireServerLock(name, 1)
    expect(a).not.toBeNull()
    a!.release()
  })

  it('two different lock NAMES do not exclude each other', async () => {
    // The rotation tick and the marketplace chore must be able to run at the same time.
    const held = tryAcquireMarketplaceLock()
    const other = await withServerLock('some-other-chore.lock', 60_000, async () => 'ok')
    expect(other).toBe('ok')
    held!.release()
  })
})
