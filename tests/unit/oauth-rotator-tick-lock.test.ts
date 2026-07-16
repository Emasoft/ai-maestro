import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { tryAcquireTickLock, withTickLock } from '@/lib/oauth-rotator/tick-lock'

// 0-IMPACT: the lock lives under an isolated temp dir (JANITOR_GLOBAL_STATE_DIR), never the
// real global-state. No keychain, no network, no shared files.

const LOCK_NAME = 'oauth-rotator-server-tick.lock'
let savedEnv: string | undefined
let tmpDir: string
let lockFile: string

beforeEach(() => {
  savedEnv = process.env.JANITOR_GLOBAL_STATE_DIR
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-tick-lock-'))
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir
  lockFile = path.join(tmpDir, LOCK_NAME)
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

describe('tryAcquireTickLock', () => {
  it('acquires, blocks a second acquire while held, and re-acquires after release', () => {
    const a = tryAcquireTickLock()
    expect(a).not.toBeNull()
    expect(fs.existsSync(lockFile)).toBe(true)
    // Held by a live pid (ours) and fresh → a second attempt is refused.
    expect(tryAcquireTickLock()).toBeNull()
    a!.release()
    expect(fs.existsSync(lockFile)).toBe(false)
    const b = tryAcquireTickLock()
    expect(b).not.toBeNull()
    b!.release()
  })

  it('release is idempotent (double release never throws)', () => {
    const a = tryAcquireTickLock()
    expect(a).not.toBeNull()
    a!.release()
    expect(() => a!.release()).not.toThrow()
  })

  it('records the holder pid in the lockfile', () => {
    const a = tryAcquireTickLock()
    const content = fs.readFileSync(lockFile, 'utf8')
    expect(parseInt(content.split('\t')[0], 10)).toBe(process.pid)
    a!.release()
  })

  it('reclaims a lock whose mtime is older than the stale threshold', () => {
    // A crashed holder left a fresh-pid lock but never released; backdate it past 5 min.
    fs.writeFileSync(lockFile, `${process.pid}\t${new Date().toISOString()}\n`)
    const old = new Date(Date.now() - 10 * 60_000)
    fs.utimesSync(lockFile, old, old)
    const a = tryAcquireTickLock()
    expect(a).not.toBeNull() // reclaimed the stale lock
    a!.release()
  })

  it('reclaims a lock whose holder pid is dead (fresh mtime)', () => {
    // A pid far above any real PID_MAX — process.kill(pid, 0) → ESRCH → treated as dead.
    fs.writeFileSync(lockFile, `2147483646\t${new Date().toISOString()}\n`)
    const a = tryAcquireTickLock()
    expect(a).not.toBeNull()
    a!.release()
  })

  it('reclaims a corrupt/empty lockfile', () => {
    fs.writeFileSync(lockFile, '')
    const a = tryAcquireTickLock()
    expect(a).not.toBeNull()
    a!.release()
  })

  it('does NOT reclaim a fresh lock held by a live pid', () => {
    // Our own live pid + fresh mtime → genuinely held → refused.
    fs.writeFileSync(lockFile, `${process.pid}\t${new Date().toISOString()}\n`)
    expect(tryAcquireTickLock()).toBeNull()
  })
})

describe('withTickLock', () => {
  it('runs fn under the lock and releases afterward', async () => {
    const r = await withTickLock(async () => 'ran')
    expect(r).toBe('ran')
    expect(fs.existsSync(lockFile)).toBe(false) // released
  })

  it('skips (returns null) when the lock is already held, and releases on the inner run', async () => {
    const r = await withTickLock(async () => {
      // Re-entrant attempt while the outer lock is held → skipped.
      const inner = await withTickLock(async () => 'inner')
      expect(inner).toBeNull()
      return 'outer'
    })
    expect(r).toBe('outer')
    expect(fs.existsSync(lockFile)).toBe(false)
  })

  it('releases even when fn throws', async () => {
    await expect(withTickLock(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(fs.existsSync(lockFile)).toBe(false)
  })
})
