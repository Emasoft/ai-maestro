/**
 * User presence — last-user-input timestamp.
 *
 * Backs the `POST /api/sessions/me/user-input` and
 * `GET /api/users/me/presence` endpoints requested by AMAMA
 * (the AI Maestro Assistant Manager Agent plugin) for computing
 * user idle time on approval-request decisions.
 *
 * Spec: design/handoffs/aimaestro-server-presence-api.md (handoff
 * from the AMAMA design team, 2026-05-06).
 *
 * Storage shape:
 *   { last_user_input_epoch: number | null }
 *
 * AI Maestro is single-tenant per host (one human user owns the
 * dashboard), so the spec's `users[<user_id>]` collection collapses
 * to a single global record. If multi-user mode is added later, the
 * shape extends to a Record keyed by user id without breaking the
 * existing contract.
 *
 * I/O hardening (mirrors the round-1 element-mgmt MAJ-01/MAJ-02
 * fixes):
 *   - atomic write via tmp + rename so a crash mid-write cannot
 *     leave a half-written JSON file
 *   - cross-process file lock so two server processes (PM2 cluster,
 *     full + headless mode running side by side) cannot interleave
 *     reads and writes
 *
 * Auth is enforced at the route layer (Bearer AID_AUTH or session
 * cookie). This module does not authenticate — it just persists.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { rename, rm, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { statePath } from '@/lib/ecosystem-constants'

const PRESENCE_FILE = statePath('user-presence.json')

interface PresenceFile {
  /** Unix epoch in SECONDS — matches the spec's `last_user_input_epoch`. */
  last_user_input_epoch: number | null
}

const EMPTY: PresenceFile = { last_user_input_epoch: null }

// ── Cross-process lock (mirror of element-management-service helper) ──
const STALE_LOCK_MS = 30_000
const LOCK_POLL_MS = 50
const LOCK_MAX_WAIT_MS = 10_000

async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockDir = `${filePath}.lock`
  const start = Date.now()
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false })
      return async () => {
        try { await rm(lockDir, { recursive: true, force: true }) } catch {}
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EEXIST') throw err
      try {
        const st = statSync(lockDir)
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          try { await rm(lockDir, { recursive: true, force: true }) } catch {}
          continue
        }
      } catch {
        continue
      }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        throw new Error(`user-presence: timeout waiting for ${lockDir}`)
      }
      await new Promise(r => setTimeout(r, LOCK_POLL_MS))
    }
  }
}

let _atomicWriteCounter = 0

/**
 * Read the presence record. Returns the EMPTY record if the file
 * doesn't exist or is unreadable. Synchronous read because the file
 * is tiny (< 100 bytes) and called on every approval-decision GET —
 * the cost of an async hop dwarfs the read time.
 */
export function getPresence(): PresenceFile {
  try {
    if (!existsSync(PRESENCE_FILE)) return { ...EMPTY }
    const raw = readFileSync(PRESENCE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PresenceFile>
    const ts = parsed?.last_user_input_epoch
    return {
      last_user_input_epoch:
        typeof ts === 'number' && Number.isFinite(ts) && ts >= 0 ? ts : null,
    }
  } catch {
    // Corrupt or unreadable — treat as no recorded presence.
    return { ...EMPTY }
  }
}

/**
 * Write the presence record atomically. Holds the cross-process lock
 * for the read-modify-write cycle so concurrent POSTs from multiple
 * sessions don't interleave.
 */
export async function recordUserInput(epochSeconds: number): Promise<number> {
  if (!Number.isFinite(epochSeconds) || epochSeconds < 0) {
    throw new Error('recordUserInput: epochSeconds must be a non-negative finite number')
  }
  const dir = dirname(PRESENCE_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const release = await acquireLock(PRESENCE_FILE)
  try {
    const current = getPresence()
    // Monotonic guard: if a concurrent writer recorded a LATER
    // timestamp we would otherwise clobber, keep the later one. Two
    // hooks firing within the same second is harmless — both succeed.
    const next: PresenceFile = {
      last_user_input_epoch:
        current.last_user_input_epoch && current.last_user_input_epoch > epochSeconds
          ? current.last_user_input_epoch
          : epochSeconds,
    }
    const tmpPath = `${PRESENCE_FILE}.tmp.${process.pid}.${++_atomicWriteCounter}`
    const payload = JSON.stringify(next, null, 2) + '\n'
    try {
      await writeFile(tmpPath, payload, 'utf-8')
      await rename(tmpPath, PRESENCE_FILE)
    } catch (err) {
      try { await rm(tmpPath, { force: true }) } catch {}
      throw err
    }
    return next.last_user_input_epoch ?? epochSeconds
  } finally {
    await release()
  }
}

/** Server clock now, in seconds since epoch — what the spec calls `server_now_epoch`. */
export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
