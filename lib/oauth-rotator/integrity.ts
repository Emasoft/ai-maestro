// File-integrity primitives for the ported OAuth rotator (TRDD-1GGQ4HWY Phase D).
//
// FAITHFUL TypeScript port of scripts/lib/janitor_integrity.py (TRDD-7100178d, Pillar 2).
// Every critical rotator state file (`state.json`, and in Phase E the live-blob sidecars)
// keeps TWO redundant copies of the SAME content plus a `.sha256` sidecar, so a torn or
// corrupt primary self-heals from the verified `.bak` instead of taking rotation down.
//
// WHY the byte-format must match the Python EXACTLY: the ai-maestro server and any residual
// janitor `#N` fallback share the SAME `state.json` (same global-state dir, presence/
// delegation — never concurrent). If the server wrote `state.json` WITHOUT refreshing the
// `.sha256` sidecar, a later janitor `readOrRestore` would see a stale sidecar, judge the
// primary corrupt, and RESTORE the stale `.bak` — silently reverting the server's latest
// committed state. So the suffixes, the sha256 (lowercase hex, no trailing newline), the
// mirror-first write ordering, and the 0600 mode are all load-bearing and match byte-for-byte.

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const BAK_SUFFIX = '.bak'
const SHA_SUFFIX = '.sha256'

/** Lowercase-hex sha256 of `data` — matches Python `hashlib.sha256(data).hexdigest()`. */
export function sha256Bytes(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Write `data` to `p` atomically: a uniquely-named tmp file in the SAME directory (so the
 * rename is a pure move, never a cross-device copy), chmod-ed to `mode` (owner-only by
 * default — these hold credential-adjacent state), then renamed into place. Matches the
 * Python `atomic_write_bytes`: write → chmod → replace.
 */
export function atomicWriteBytes(p: string, data: Buffer, mode = 0o600): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp.${process.pid}`
  fs.writeFileSync(tmp, data)
  fs.chmodSync(tmp, mode) // explicit chmod after write — writeFileSync's mode is umask-masked
  fs.renameSync(tmp, p) // atomic on POSIX + Windows: a crash leaves the old OR the new file
}

function sidecarOf(p: string): string {
  return p + SHA_SUFFIX
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** True iff `p` exists, its `.sha256` sidecar exists, and they agree. */
function matchesSidecar(p: string): boolean {
  const sidecar = sidecarOf(p)
  if (!isFile(p) || !isFile(sidecar)) return false
  let want: string
  try {
    want = fs.readFileSync(sidecar).toString('utf8').trim()
  } catch {
    return false
  }
  return want === sha256Bytes(fs.readFileSync(p))
}

/**
 * Critical write with a REDUNDANT MIRROR. `data` goes to BOTH the primary `p` and a
 * `<p>.bak` mirror, each with its own `.sha256` sidecar — two independent copies of the SAME
 * content (the CURRENT value, not a previous version), so a single-file corruption of either
 * is recovered from the other by {@link readOrRestore}. Ordering is crash-consistent: the
 * mirror (`.bak` + its sidecar) is committed FIRST, then the primary + its sidecar, so a crash
 * mid-save leaves either the older value or the newer one, never a torn pair.
 */
export function backupAndWrite(p: string, data: Buffer, mode = 0o600): void {
  const digest = Buffer.from(sha256Bytes(data), 'utf8')
  const bak = p + BAK_SUFFIX
  atomicWriteBytes(bak, data, mode)
  atomicWriteBytes(sidecarOf(bak), digest, mode)
  atomicWriteBytes(p, data, mode)
  atomicWriteBytes(sidecarOf(p), digest, mode)
}

/**
 * Read `p` with corruption recovery:
 *  - No sidecar at all → trust the primary as-is (a file written before this layer wrapped it,
 *    e.g. a freshly migrated `state.json`).
 *  - Sidecar present and matches → return the primary.
 *  - Primary missing/corrupt (sidecar present but mismatched) → RESTORE from `.bak` ONLY IF the
 *    backup verifies against its own sidecar, re-heal the primary's sidecar, return the bytes.
 *  - Nothing recoverable → null (the caller rebuilds from the authoritative source — the
 *    keychain slots — never trusting known-corrupt bytes).
 */
export function readOrRestore(p: string): Buffer | null {
  const sidecar = sidecarOf(p)
  if (isFile(p) && !isFile(sidecar)) return fs.readFileSync(p)
  if (matchesSidecar(p)) return fs.readFileSync(p)
  const bak = p + BAK_SUFFIX
  if (matchesSidecar(bak)) {
    const restored = fs.readFileSync(bak)
    atomicWriteBytes(p, restored)
    atomicWriteBytes(sidecar, Buffer.from(sha256Bytes(restored), 'utf8'))
    return restored
  }
  return null
}

/**
 * True iff `p` has a fully-established, self-consistent redundant mirror: the primary matches
 * its `.sha256` sidecar AND the `.bak` matches its own sidecar. False for a pre-integrity file
 * (no sidecar yet) or any torn/missing/corrupt copy — the caller should {@link backupAndWrite}
 * to (re-)establish the in-advance backup before relying on it.
 */
export function backupIsConsistent(p: string): boolean {
  const bak = p + BAK_SUFFIX
  return matchesSidecar(p) && matchesSidecar(bak)
}
