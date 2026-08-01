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
import { readFile, writeFile, rename, mkdir, rm, open, readdir, unlink, stat } from 'fs/promises'
import { AsyncLocalStorage } from 'async_hooks'
import { join, basename, dirname } from 'path'

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

/** TEST-ONLY. Pins the counter so a backup-pruning fixture can STRADDLE a digit-width boundary
 *  (…9 → …10), which is the ONLY place the zero-padding in `keepBackup` changes the sort order.
 *  Without this the fixture's discriminating power depends on how many writes happened earlier in
 *  the same process — i.e. on test ORDER — and a run that starts past 40 produces thirteen 2-digit
 *  counters that sort correctly with or without the padding. Measured: the un-pinned version of that
 *  test passed with the padding DELETED. */
export function _setAtomicWriteCounterForTests(n: number): void { _atomicWriteCounter = n }

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE GATE (TRDD-RYFP030K) — one lock + one write path for every settings mutation.
//
// WHAT THIS UNIFIES. ai-maestro already had these guarantees; it had them in TWO PLACES, so whether
// a writer was protected depended on which module it happened to live in:
//   - `lib/json-io.ts`  — refuse-unparseable, refuse-non-object, atomic tmp+rename
//   - `withSettingsLock` (PRIVATE to services/element-management-service.ts) — in-process queue +
//     cross-process lock + stale-break
// The route hardened in TRDD-ZT3P02PO got the safe write and ZERO locking, which is the proof the
// split was real. Everything now lives here, plus the guarantees adopted from AgentlensPro's
// `safe_config_edit.py` (issue #105): fsync, a kept backup, a concurrent-modification check, and a
// post-commit audit.
//
// ⚠ THE LOCK PATH AND MECHANISM ARE LOAD-BEARING AND DELIBERATELY UNCHANGED. The pre-existing lock
// is a DIRECTORY at `${file}.lock` taken with `mkdir(recursive:false)`. AgentlensPro's is a FILE at
// `${file}.agentlens-lock` taken with O_EXCL. Two different paths AND two different mechanisms do
// NOT exclude each other — so adopting theirs would have left every not-yet-migrated
// `withSettingsLock` caller silently unprotected against this module, which is the very split this
// card exists to close. We keep ai-maestro's convention; `withSettingsLock` now delegates here.
//
// ⚠ WHAT THIS CANNOT PROMISE — say this, never "100% safe". The `claude` CLI writes settings.json
// itself and takes no lock of ours, so it is a NON-PARTICIPATING writer; and a TOCTOU window
// between the staleness compare and the rename is irreducible. The honest ceiling, which IS
// delivered: no torn writes · no rebuild-from-corrupt · no lost updates AMONG PARTICIPATING
// WRITERS · every mutation recoverable from a kept backup.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** DEFAULTS ONLY — both are overridable per call, and that is load-bearing rather than tidy:
 *  `claude plugin install` legitimately holds the settings lock for ~120s, so a fixed 30s
 *  stale-break would DECLARE A LIVE HOLDER DEAD and break the lock out from under it. The
 *  pre-existing `withSettingsLock` carried these as opts for exactly that reason; dropping them in
 *  the merge would have re-introduced the bug its comment documents. */
const STALE_LOCK_MS = 30_000
const LOCK_MAX_WAIT_MS = 20_000
const LOCK_POLL_MS = 50

export interface JsonLockOpts { staleMs?: number; maxWaitMs?: number }
/** Keep this many backups per file. Unbounded backups silently fill the user's home. */
const BACKUP_KEEP = 10

/** In-process serialisation, per resolved path. A Node server needs this and AgentlensPro's Python
 *  editor does not — separate processes never share a heap. Without it, N concurrent async writers
 *  in ONE process all queue on the cross-process lock and thrash. */
const inProcessQueue = new Map<string, Promise<unknown>>()

/** TEST-ONLY probe. The queue is module-private because nothing outside may schedule on it — but
 *  "the map is empty once every caller has returned" is a real invariant, not bookkeeping: a leaked
 *  entry per path is an unbounded map for the life of the process, and it is the ONLY observable
 *  tell for the identity bug documented in `withJsonLock`. A test that cannot see this asserts only
 *  behaviour that a leaking implementation satisfies just as well. */
export function _inProcessQueueSizeForTests(): number { return inProcessQueue.size }

/** Paths whose lock is already held by the CURRENT async call chain.
 *
 *  REENTRANCY IS NOT OPTIONAL: a pipeline that read-modify-writes the same settings file twice
 *  (via a nested helper) would otherwise wait on a lock it is itself holding — a self-deadlock that
 *  only appears under the nesting, i.e. exactly where it is hardest to notice. AsyncLocalStorage
 *  propagates across `await`, so the inner call sees the outer's held set. */
const heldLocks = new AsyncLocalStorage<Set<string>>()

async function acquireLock(filePath: string, opts: JsonLockOpts = {}): Promise<() => Promise<void>> {
  const staleMs = opts.staleMs ?? STALE_LOCK_MS
  const maxWaitMs = opts.maxWaitMs ?? LOCK_MAX_WAIT_MS
  const lockDir = `${filePath}.lock`
  // A fresh machine may not have ~/.claude/ yet, so `mkdir(lockDir)` would throw ENOENT — which the
  // EEXIST-only catch below would propagate as a hard failure. Idempotent once it exists.
  await mkdir(dirname(filePath), { recursive: true })
  const start = Date.now()
  for (;;) {
    try {
      // mkdir WITHOUT recursive is atomic: EEXIST is the lock-held signal.
      await mkdir(lockDir, { recursive: false })
      // ⚠ KNOWN RESIDUAL HAZARD, inherited with this design and worth stating because the code it
      // was documented beside has been deleted: if a waiter declares this lock stale and takes it
      // while we are STILL RUNNING, two holders exist at once AND our release below deletes the NEW
      // holder's lockdir. That is why `staleMs` must always exceed the guarded operation's own
      // timeout — `claude plugin install` clones a repo and is allowed 120s, so a caller wrapping it
      // MUST pass a larger `staleMs` rather than accept the default.
      return async () => { try { await rm(lockDir, { recursive: true, force: true }) } catch { /* already gone */ } }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
      try {
        const st = await stat(lockDir)
        if (Date.now() - st.mtimeMs > staleMs) {
          // The owner died mid-transaction. Breaking it races other breakers, which is fine — the
          // mkdir on the next iteration is what actually arbitrates.
          try { await rm(lockDir, { recursive: true, force: true }) } catch { /* raced */ }
          continue
        }
      } catch { continue /* lock vanished under us — retry immediately */ }
      if (Date.now() - start > maxWaitMs) {
        throw new Error(`settings gate: timed out after ${maxWaitMs}ms waiting for ${lockDir}`)
      }
      await new Promise(r => setTimeout(r, LOCK_POLL_MS))
    }
  }
}

/** Run `fn` holding BOTH the in-process queue slot and the cross-process lock for `filePath`.
 *  Re-entrant: if this async chain already holds the path, `fn` runs directly. */
export async function withJsonLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  opts: JsonLockOpts = {},
): Promise<T> {
  const held = heldLocks.getStore()
  if (held?.has(filePath)) return fn()

  const prev = inProcessQueue.get(filePath) ?? Promise.resolve()
  let release!: () => void
  // STORE `mine` ITSELF, never a derived `prev.then(...)`: the cleanup below compares by IDENTITY,
  // so storing a derived promise makes `get(filePath) === mine` permanently false — the entry is
  // never deleted and the map grows one entry per path for the life of the process.
  const mine = new Promise<void>(r => { release = r })
  inProcessQueue.set(filePath, mine)
  try {
    await prev.catch(() => { /* a previous holder's failure must not cascade */ })
    const unlock = await acquireLock(filePath, opts)
    try {
      const nextHeld = new Set(held ?? []); nextHeld.add(filePath)
      return await heldLocks.run(nextHeld, fn)
    } finally { await unlock() }
  } finally {
    release()
    if (inProcessQueue.get(filePath) === mine) inProcessQueue.delete(filePath)
  }
}

/** Write `raw` to `path` durably: fsync the tmp BEFORE the rename, so a crash cannot leave a
 *  renamed-but-empty file (rename is atomic w.r.t. readers; it is NOT a durability barrier). */
async function fsyncWrite(path: string, raw: string): Promise<void> {
  const fh = await open(path, 'w', 0o600)
  try { await fh.writeFile(raw, 'utf-8'); await fh.sync() } finally { await fh.close() }
}

/** Parse bytes we ALREADY hold into a settings object, or refuse. Separate from `readJson` because
 *  the caller must read the file exactly ONCE — see the note in `updateJson`. */
function parseOrRefuse(path: string, raw: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (err) {
    throw new UnreadableTargetError(path, err instanceof Error ? err.message : String(err))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UnreadableTargetError(
      path,
      `parses as ${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed}, not a JSON object`,
    )
  }
  return parsed as Record<string, unknown>
}

/** Copy the current bytes aside before replacing them, keeping the newest BACKUP_KEEP.
 *  Written tmp+rename like every other write here: a backup torn by a crash is worse than none,
 *  because it is the artifact recovery depends on. The counter disambiguates two backups taken by
 *  the same pid within the same second, which would otherwise overwrite each other. */
async function keepBackup(path: string, raw: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15)
  // ZERO-PADDED, because the prune below sorts these names LEXICOGRAPHICALLY to decide what to keep.
  // The stamp is second-precision, so a burst inside one second is ordered by the counter alone —
  // and unpadded, "10" sorts before "2". The retained set then stops being "the newest BACKUP_KEEP":
  // at 21 backups it keeps 2-9 and 20-21 while deleting 10-19, i.e. it discards the MIDDLE and keeps
  // the oldest. Padding is what makes "we keep the most recent N" true rather than approximately true.
  const backup = `${path}.aim-bak-${stamp}-${process.pid}-${String(++_atomicWriteCounter).padStart(6, '0')}`
  try {
    const tmp = `${backup}.tmp`
    await fsyncWrite(tmp, raw)
    await rename(tmp, backup)
    const dir = dirname(path), prefix = `${basename(path)}.aim-bak-`
    const mine = (await readdir(dir)).filter(f => f.startsWith(prefix)).sort()
    for (const old of mine.slice(0, Math.max(0, mine.length - BACKUP_KEEP))) {
      try { await unlink(join(dir, old)) } catch { /* raced with another pruner */ }
    }
    return backup
  } catch {
    // A backup we could not take is NOT a reason to abort the write: refusing here would make an
    // unwritable directory block every settings change. The caller still has the atomic rename.
    return null
  }
}

export interface UpdateJsonResult {
  /** false when the mutator produced no change — nothing was written, no backup taken. */
  changed: boolean
  backupPath: string | null
  /** 1 on a clean first pass; >1 means a non-participating writer forced a re-read. */
  attempts: number
  /** false when the post-commit re-read did NOT match what we wrote. See the audit note below. */
  auditOk: boolean
}

export class ConcurrentModificationError extends Error {
  constructor(public readonly path: string, public readonly attempts: number) {
    super(`${path} kept changing underneath us across ${attempts} attempts — giving up rather than clobbering a writer we do not control`)
    this.name = 'ConcurrentModificationError'
  }
}

export class KeyLossRefused extends Error {
  constructor(public readonly path: string, public readonly lost: string[]) {
    super(`refusing to write ${path}: the mutation drops top-level keys ${JSON.stringify(lost)} — pass { allowKeyLoss: true } if that is genuinely intended`)
    this.name = 'KeyLossRefused'
  }
}

/**
 * THE ONE WAY to modify a settings file. Read-modify-write as a single locked, verified operation.
 *
 * WHY THIS EXISTS AND `saveJsonSafe` IS NOT ENOUGH. `loadJsonSafe(p)` then `saveJsonSafe(p, obj)`
 * are TWO calls, so the baseline never travels between them: nothing can tell whether the file
 * changed in the gap, and the second write silently discards the other writer's change. That is a
 * LOST UPDATE, and our 33 read-modify-write call sites can already race each other in-process
 * today. Here the mutator runs INSIDE the lock, against bytes we just read, and the bytes are
 * re-checked immediately before the commit.
 *
 * ⚠ THE POST-COMMIT AUDIT DETECTS AND LOGS — IT MUST NEVER AUTO-ROLLBACK. AgentlensPro's editor
 * restores its backup when the audit disagrees (`safe_config_edit.py:438`), which is right for a
 * tool that owns the file. It is a HAZARD here: the `claude` CLI writes settings.json without our
 * lock, so an audit mismatch is more likely to be its legitimate write than our corruption — and
 * rolling back would DESTROY it. We surface `auditOk: false` and log loudly; the caller decides.
 *
 * ⚠ `mutator` MUST mutate the object it is given (or return void). Building a fresh object and
 * returning it is the 2026-07-07 shape — the minimal-object rebuild that wiped a 57.8 KB config —
 * so the return value is deliberately ignored, and the key-loss tripwire catches it anyway.
 */
export async function updateJson(
  path: string,
  mutator: (data: Record<string, unknown>) => void | Promise<void>,
  // `JsonLockOpts` is part of the surface and is FORWARDED below. Without it the lock windows are
  // unreachable from the only function anyone is supposed to call, so a caller whose mutator runs
  // something long (`claude plugin install` clones a repo and is allowed ~120s) could not raise
  // `staleMs` above it — and a waiter would then declare the live holder stale, which is the
  // two-holders hazard documented on `acquireLock`. An option that exists only on the primitive
  // nobody calls directly is not an option.
  opts: { createIfMissing?: boolean; retries?: number; allowKeyLoss?: boolean } & JsonLockOpts = {},
): Promise<UpdateJsonResult> {
  const maxAttempts = Math.max(1, opts.retries ?? 3)

  return withJsonLock(path, async () => {
    for (let attempt = 1; ; attempt++) {
      // ⚠ EXACTLY ONE READ. Reading via `readJson` and then again via `readFile` is TWO reads, and a
      // non-participating writer landing between them makes `before.data` the OLD version while
      // `rawBefore` holds the NEW bytes — so the staleness gate compares equal, sees no conflict,
      // and commits a write derived from the version we no longer have. That is a silent lost
      // update of exactly the class this gate advertises closing. (It also removes the
      // existsSync→readFile TOCTOU that would report a vanished file as `unreadable`.)
      let rawBefore: string | null = null
      try {
        rawBefore = await readFile(path, 'utf-8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
        if (!opts.createIfMissing) {
          throw new Error(`${path} does not exist (pass { createIfMissing: true } to allow creation)`)
        }
      }
      const baseData = rawBefore === null ? {} : parseOrRefuse(path, rawBefore)
      const data = structuredClone(baseData)

      // A mutator that RETURNS a new object instead of mutating in place leaves `data` untouched,
      // which would silently short-circuit to `changed:false` and write NOTHING — the caller's
      // change vanishing with no error at all. Refuse it loudly; returning a rebuilt object is also
      // the 2026-07-07 shape this module exists to prevent.
      const ret = await mutator(data)
      if (ret !== undefined) {
        throw new TypeError(
          `updateJson(${path}): the mutator RETURNED a value. It must MUTATE the object it is given ` +
          `and return nothing — a returned object is silently discarded, and rebuilding one is the ` +
          `minimal-object shape that wipes configs.`,
        )
      }

      const serialized = JSON.stringify(data, null, 2) + '\n'
      if (rawBefore !== null && serialized === rawBefore) {
        return { changed: false, backupPath: null, attempts: attempt, auditOk: true }
      }

      // TRIPWIRE for the failure this module exists to prevent: a caller that rebuilt a minimal
      // object instead of mutating in place.
      // ⚠ HONEST LIMIT — it compares TOP-LEVEL keys only. It catches the 2026-07-07 shape (whole
      // config replaced by a minimal object) and does NOT catch a nested rebuild such as
      // `data.env = { ONLY_MINE: 1 }`, which drops sibling env vars while every top-level key
      // survives. Do not read this as structural verification; it is a cheap net for the one shape
      // that has actually caused an incident.
      if (!opts.allowKeyLoss && rawBefore !== null) {
        const lost = Object.keys(baseData).filter(k => !(k in data))
        if (lost.length > 0) throw new KeyLossRefused(path, lost)
      }

      const backupPath = rawBefore !== null ? await keepBackup(path, rawBefore) : null

      const tmp = `${path}.tmp.${process.pid}.${++_atomicWriteCounter}`
      try {
        await fsyncWrite(tmp, serialized)

        // STALENESS GATE — the last look before committing. We hold the lock, so a PARTICIPATING
        // writer cannot be here; this catches the ones that never took it (the `claude` CLI).
        const rawNow = await readFile(path, 'utf-8').catch(() => null)
        if (rawNow !== rawBefore) {
          await rm(tmp, { force: true })
          if (attempt >= maxAttempts) throw new ConcurrentModificationError(path, attempt)
          // BACK OFF between attempts. Three immediate retries are consumed within milliseconds
          // against a bursty non-participating writer, turning a recoverable race into a hard
          // failure. We keep HOLDING the lock across attempts on purpose: dropping it would let
          // PARTICIPATING writers interleave, which is the larger hazard and the one we can control.
          await new Promise(r => setTimeout(r, 200 * attempt))
          continue // re-read and re-apply the mutator against the NEW base — never clobber
        }

        await rename(tmp, path) // COMMIT (atomic for readers)
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => { /* best effort */ })
        throw err
      }

      const after = await readJson(path)
      const auditOk = after.ok && JSON.stringify(after.data) === JSON.stringify(data)
      if (!auditOk) {
        console.warn(
          `[json-io] POST-COMMIT AUDIT MISMATCH on ${path} — the file does not match what we just ` +
          `wrote. NOT rolling back: the most likely cause is a non-participating writer (the ` +
          `claude CLI takes no lock of ours) whose change would be destroyed by a restore. ` +
          `Backup: ${backupPath ?? '(none)'}`,
        )
      }
      return { changed: true, backupPath, attempts: attempt, auditOk }
    }
  }, opts)
}

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
