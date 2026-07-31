/**
 * The ONE JSON read/write pair for settings-shaped files (TRDD-CS25TA6W).
 *
 * ## Why this module exists
 *
 * Four modules carried a hand-copied `loadJsonSafe`/`saveJsonSafe` pair, and measuring them
 * (2026-07-31) found not four copies but **four different correctness levels of the same two
 * functions**:
 *
 * | module | reader | writer |
 * |---|---|---|
 * | `services/element-management-service.ts` | `existsSync` + discriminated + non-object check | atomic, mkdir, guarded |
 * | `lib/client-plugin-adapters/claude-adapter.ts` | parse only — no `existsSync` | atomic, no mkdir |
 * | `services/role-plugin-service.ts` | `existsSync` + parse | **NON-ATOMIC** direct `writeFile` |
 * | `services/plugin-storage-service.ts` | parse only | **NON-ATOMIC** direct `writeFile` |
 *
 * The two weakest write `~/.claude/settings.json` — the human user's own global Claude Code config
 * — with a direct `writeFile`, which is exactly the defect `element-management-service` was fixed
 * for on 2026-05-04 (MAJ-01: "a crash mid-write left the JSON file partially written, which is
 * unrecoverable for downstream loaders that strict-parse it").
 *
 * **The two defects compose into a loop.** A torn write PRODUCES a corrupt settings file; the
 * lenient reader then answers `{}` for it; and every read-modify-write in the family REPLACES the
 * file with a minimal object built from that `{}`. One half creates the damage the other half
 * completes. That is why this is one module rather than three patches: a family that drifted into
 * four correctness levels once will do it again, and the only durable fix is that there is nothing
 * left to drift.
 *
 * ## The contract
 *
 * - `readJson` — STRICT. Says WHY it has no data, so a caller can tell legal absence from a fault.
 * - `loadJsonSafe` — LENIENT, and DERIVED from `readJson` so the two cannot disagree. `{}` for both
 *   failures, which every write path depends on (a missing settings file genuinely means "nothing
 *   enabled", and every first-run path relies on that default).
 * - `saveJsonSafe` — ATOMIC (tmp + rename) and GUARDED (never overwrites a target it could not
 *   read).
 *
 * `tests/governance/one-json-io-implementation.test.ts` fails if a fifth copy is hand-written.
 */
import { existsSync } from 'fs'
import { readFile, writeFile, rename, mkdir, rm } from 'fs/promises'
import { join } from 'path'

/**
 * A JSON read that says WHY it has no data (TRDD-K71FV649).
 *
 * A lenient reader answers `{}` to two different questions — "the file is not there" and "the file
 * is there and does not parse" — and every verification built on it therefore reads UNREADABLE as
 * ABSENT. That is not hypothetical: it is what made `InstallElement`'s PG01 report a CORRECT
 * install as a failure (and, via the registry's `corePluginMissing`, brick the agent's wake) on the
 * strength of a settings file nothing could read.
 */
export type JsonRead =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'missing' | 'unreadable'; error?: string }

export async function readJson(path: string): Promise<JsonRead> {
  if (!existsSync(path)) return { ok: false, reason: 'missing' }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'))
  } catch (err) {
    return { ok: false, reason: 'unreadable', error: err instanceof Error ? err.message : String(err) }
  }
  // A PARSE that succeeds is not yet a USABLE settings object: `[]`, `null`, `42` and `"str"` all
  // parse, and `data: Record<string, unknown>` would be a type LIE for every one of them. Every
  // caller then does `settings.enabledPlugins = ep` — which silently attaches a key to an array, or
  // throws a TypeError on null, and in both cases the read-modify-write goes on to OVERWRITE the
  // file with the result. `lib/claude-settings-enforcer.ts:121-128` already refuses exactly this
  // shape ("settings.json is not a JSON object; refusing to write"); this is the same ruling,
  // applied at the reader so every consumer inherits it.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: 'unreadable',
      error: `parses as ${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed}, not a JSON object`,
    }
  }
  return { ok: true, data: parsed as Record<string, unknown> }
}

/**
 * The lenient reader, DERIVED from `readJson` rather than parallel to it — so there is exactly ONE
 * parse in one place and the strict and lenient answers cannot drift apart.
 */
export async function loadJsonSafe(path: string): Promise<Record<string, unknown>> {
  const read = await readJson(path)
  return read.ok ? read.data : {}
}

/** Thrown by `saveJsonSafe` when the target exists and cannot be read. Its own class so a caller can
 *  tell "I refused to clobber an unreadable file" from any other write failure. */
export class UnreadableTargetError extends Error {
  constructor(public readonly path: string, public readonly cause: string) {
    super(`${path} exists but does not parse (${cause}); refusing to overwrite it — the state is UNKNOWN, not absent`)
    this.name = 'UnreadableTargetError'
  }
}

// Module-local counter for atomic-write tmp filenames. Combined with process.pid this is unique per
// write within a single process.
let _atomicWriteCounter = 0

export async function saveJsonSafe(path: string, data: Record<string, unknown>): Promise<void> {
  // ── NEVER overwrite a file we could not read (TRDD-K71FV649) ──
  //
  // Every write in this family is a read-modify-write. On a corrupt file the read answers `{}`, the
  // caller builds a minimal object out of nothing, and this write REPLACES the file — destroying
  // every other key it held. The worst observed site logged `writing safeguard` while truncating
  // the user's settings; the ops line read like a REPAIR.
  //
  // The guard is HERE, not at the ~27 call sites, for one decisive reason: the R51 compensations
  // call this function DIRECTLY with a snapshot (an undo writing `c.prior`, `structuredClone`d from
  // the same blind read — so on a corrupt file the ROLLBACK restores `{}` and destroys the file it
  // exists to protect). A per-call-site read guard cannot see that path; the write primitive is the
  // only choke point both the forward and undo paths traverse, and it is the only fix that covers a
  // FUTURE call site.
  //
  // `missing` stays the normal create path: a first-run settings file must still be creatable.
  //
  // KNOWN over-report (accepted): when a forward gate throws here, its undo throws here too — the
  // file is still corrupt on disk — so a transaction runner reports a FAILED compensation (R51.5
  // CRITICAL) over a disk that is byte-identical to where it started. Alarming and true; the
  // alternative is the undo writing `{}` over the user's file, which is the bug.
  const existing = await readJson(path)
  if (!existing.ok && existing.reason === 'unreadable') {
    throw new UnreadableTargetError(path, existing.error ?? 'unknown parse error')
  }

  // MAJ-01 fix (2026-05-04) — atomic write via tmp + rename.
  // A direct write to `path` leaves a partially-written file when the process dies mid-write (OOM
  // kill, SIGKILL, power cut), which is unrecoverable for downstream loaders that strict-parse it.
  // write-tmp + rename is atomic on POSIX same-filesystem moves: a reader sees either the old
  // content or the new, never a torn file. The tmp filename embeds pid + a counter so two writes
  // (different files, or the same file serialised by a lock) cannot collide on the tmp slot.
  const dir = join(path, '..')
  await mkdir(dir, { recursive: true })
  const tmpPath = `${path}.tmp.${process.pid}.${++_atomicWriteCounter}`
  const payload = JSON.stringify(data, null, 2) + '\n'
  try {
    await writeFile(tmpPath, payload, 'utf-8')
    await rename(tmpPath, path)
  } catch (err) {
    // Best-effort cleanup of the orphan tmp file; ignore errors here because the caller already
    // knows the rename failed.
    try { await rm(tmpPath, { force: true }) } catch { /* ignore */ }
    throw err
  }
}
