/**
 * Where a statusline observation lives: `~/.aimaestro/statusline-state/<session_id>.json`.
 *
 * TRDD-D8OYFG35. This follows the `chat-state` precedent exactly (hook → file → server → API), and
 * for the same reason: one small file per session, written by whoever observed it and readable by
 * anything on the host without a running query engine.
 *
 * ⚠ EVERY WRITE GOES THROUGH `lib/json-io.ts::updateJson`. Never `writeFile`, never `saveJsonSafe`,
 * never a hand-rolled tmp+rename. That module is THE one writer (`tests/governance/
 * one-json-io-implementation.test.ts` fails if a fifth copy is hand-written) and it is what makes a
 * write locked, fsync'd, atomic, backed-up and guarded against clobbering a file it could not read.
 * Several Claude Code sessions can hit the same file — a resumed session keeps its id — so the lock
 * is not theoretical.
 *
 * ⚠ THE PATH IS COMPUTED PER CALL, NOT AT MODULE LOAD. `os.homedir()` honours `$HOME` on POSIX, so
 * a lazily-resolved path is what lets a test redirect the whole store into a temp dir. A
 * module-level `const DIR = statePath(...)` would freeze the developer's REAL `~/.aimaestro` into
 * the module at import time and every test would write there — the failure mode recorded in
 * `tests/unit/password-invalidation.test.ts`'s own setup comment.
 */
import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { readJson, updateJson } from '@/lib/json-io'
import { isValidStatuslineSessionId } from '@/lib/statusline-normalize'
import type { StatuslineSnapshot } from '@/types/statusline'
import { STATUSLINE_SNAPSHOT_KEYS } from '@/types/statusline'

/**
 * The cap on how many session files the store keeps.
 *
 * Without it the directory grows by one file per Claude Code session, forever — a slow unbounded
 * leak that nobody notices until a `readdir` over it costs real time. 500 is far above any
 * plausible number of LIVE sessions on one host, so the prune only ever reaches files whose session
 * ended long ago.
 */
export const MAX_STATUSLINE_SNAPSHOTS = 500

/** How old a snapshot may be and still count as describing a live session. */
export const STATUSLINE_FRESH_MS = 15 * 60_000

/**
 * 256 KB — the cap on ONE ingested payload. The real payload is ~2 KB; the cap exists so a local
 * process cannot push an arbitrary blob into the state directory, not to constrain any legitimate
 * sender. It is the per-file twin of `MAX_STATUSLINE_SNAPSHOTS` above (that one bounds the
 * directory, this one bounds a file), which is why it lives here rather than beside the check.
 *
 * IT LIVES HERE BECAUSE A NEXT.JS ROUTE MAY NOT EXPORT IT. It was `export const MAX_INGEST_BYTES`
 * in `app/api/statusline/ingest/route.ts`, and a route module's exports are a CLOSED set (the HTTP
 * verbs plus a fixed config list like `dynamic`/`revalidate`) — so that export failed the build
 * with *"MAX_INGEST_BYTES is not a valid Route export field"*. `tsc --noEmit` does NOT see it: the
 * constraint is applied by Next.js's own generated route types at build time, so the only gate that
 * catches it is `yarn build`. Do not move a shared constant back into a route file.
 */
export const MAX_INGEST_BYTES = 256 * 1024

/** `~/.aimaestro/statusline-state` — resolved per call; see the module header. */
export function statuslineStateDir(): string {
  return statePath('statusline-state')
}

/** The file backing one session. Throws on an id that is not filename-safe — see below. */
export function statuslineStatePath(sessionId: string): string {
  // A THROW, not a sanitise. Silently rewriting a bad id would store the record under a name the
  // caller cannot ask for again, so the observation is kept and simultaneously lost. The id is
  // validated at the ingest boundary; reaching here with a bad one is a bug, and a bug that would
  // otherwise write outside the state dir.
  if (!isValidStatuslineSessionId(sessionId)) {
    throw new Error(`invalid statusline session id: ${JSON.stringify(sessionId)}`)
  }
  return join(statuslineStateDir(), `${sessionId}.json`)
}

/**
 * Persist one observation, replacing whatever was there.
 *
 * The mutator ASSIGNS every top-level key onto the object it was handed, and never rebuilds it.
 * Both halves matter: assigning all seven keys means the key-loss tripwire has nothing to lose, and
 * mutating in place is the contract `updateJson` documents ("`mutator` MUST mutate the object it is
 * given … the minimal-object rebuild that wiped a 57.8 KB config").
 */
export async function writeStatuslineSnapshot(snapshot: StatuslineSnapshot): Promise<void> {
  const path = statuslineStatePath(snapshot.sessionId)
  await updateJson(
    path,
    (data) => {
      for (const key of STATUSLINE_SNAPSHOT_KEYS) {
        ;(data as Record<string, unknown>)[key] = snapshot[key]
      }
    },
    { createIfMissing: true },
  )
}

/**
 * Read one observation back, or null when there is none.
 *
 * Uses the STRICT reader so an unreadable file is not reported as an absent one. Both answer null
 * to the caller — there is nothing useful to serve either way — but the unreadable case is logged,
 * because a corrupt state file is a fault and a missing one is the normal state of a host whose
 * statusline has not fired yet.
 */
export async function readStatuslineSnapshot(sessionId: string): Promise<StatuslineSnapshot | null> {
  if (!isValidStatuslineSessionId(sessionId)) return null
  const read = await readJson(statuslineStatePath(sessionId))
  if (!read.ok) {
    if (read.reason === 'unreadable') {
      console.warn(`[statusline-store] ${sessionId}.json exists but does not parse: ${read.error}`)
    }
    return null
  }
  return read.data as unknown as StatuslineSnapshot
}

/** Every stored observation, newest first. A missing directory is EMPTY, never an error. */
export async function listStatuslineSnapshots(): Promise<StatuslineSnapshot[]> {
  let entries: string[]
  try {
    entries = await readdir(statuslineStateDir())
  } catch {
    return [] // The dir does not exist until the first ingest. That is not a fault.
  }
  const out: StatuslineSnapshot[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue // skip .tmp.* and .bak.* left by json-io
    const snap = await readStatuslineSnapshot(entry.slice(0, -'.json'.length))
    if (snap) out.push(snap)
  }
  return out.sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0))
}

/**
 * Drop the oldest snapshots once the directory exceeds `MAX_STATUSLINE_SNAPSHOTS`.
 *
 * BEST-EFFORT BY CONSTRUCTION: it returns a count and never throws. Pruning is housekeeping, and an
 * ingest that failed because housekeeping failed would trade a bounded disk cost for a lost
 * observation — the wrong way round. Deletion is by mtime because these files are pure regenerable
 * runtime state (the next statusline tick rewrites any session that is still alive), which is
 * exactly the "trivially recoverable" class where a plain unlink is the correct tool.
 */
export async function pruneStatuslineSnapshots(max = MAX_STATUSLINE_SNAPSHOTS): Promise<number> {
  const dir = statuslineStateDir()
  let entries: string[]
  try {
    entries = (await readdir(dir)).filter((e) => e.endsWith('.json'))
  } catch {
    return 0
  }
  if (entries.length <= max) return 0

  const withTimes: Array<{ path: string; mtimeMs: number }> = []
  for (const entry of entries) {
    const path = join(dir, entry)
    try {
      withTimes.push({ path, mtimeMs: (await stat(path)).mtimeMs })
    } catch {
      // Vanished between readdir and stat — another pruner, or a manual cleanup. Nothing to do.
    }
  }
  withTimes.sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest first
  const doomed = withTimes.slice(0, Math.max(0, withTimes.length - max))

  let removed = 0
  for (const { path } of doomed) {
    try {
      await unlink(path)
      removed++
    } catch {
      // Best effort — see the docstring.
    }
  }
  return removed
}
