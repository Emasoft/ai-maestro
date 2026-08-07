/**
 * The settings-ledger WATCHER — TRDD-MN0Q1IA2 items 8 + 9, the half that observes.
 *
 * `settings-watch-targets.ts` answers WHICH files to observe. This answers HOW, and records each
 * real change to the signed ledger. It is NOT wired into the server: like the discovery half and
 * the model-fallback leg, it ships DARK, because a watcher's failure mode is SILENCE and a
 * half-wired one reports "no changes" while missing writes. Importing this module arms nothing.
 *
 * ── WHY THE EVENT SOURCE IS INJECTABLE ───────────────────────────────────────────────────────
 * `fs.watch` timing is not deterministic, and a test that sleeps for an event is a test that
 * flakes on a loaded machine — this suite already carries 13 load-dependent timeouts, so adding
 * more would be adding noise to a signal people already discount. The arming shell therefore
 * funnels every raw event through ONE entry point (`handle.onRawEvent`), which a test can call
 * directly. The pure core below (`fingerprintOf` / `classifyChange` / `changeToPatch`) has no I/O
 * timing at all. Real `fs.watch` arming is still performed — it is the same function the test
 * drives, so the seam does not fake away the thing under test.
 *
 * ── THE INODE TRAP, INHERITED ────────────────────────────────────────────────────────────────
 * A safe write is `write <path>.tmp.N` then RENAME OVER the target (this repo's `saveJsonSafe`).
 * `fs.watch` on a FILE binds the inode, so the first such write orphans the watcher: it reports
 * nothing, forever, while the file keeps changing. We therefore watch `target.dir` and filter by
 * `target.basename`. `WatchTarget`'s shape already forces this; the watcher must not undo it by
 * "conveniently" watching `target.file`.
 *
 * ── WHAT GOES IN THE LEDGER: A HASH, NEVER THE CONTENT ───────────────────────────────────────
 * A settings file legitimately carries an `env` block, tokens, and machine-private paths. The
 * ledger is SIGNED and long-lived, so writing file contents into it would republish precisely the
 * material that must not be republished — the same class of mistake as the PII that reached this
 * PUBLIC repo (see `tests/governance/no-personal-addresses-in-tracked-files.test.ts`). A SHA-256
 * plus a byte length proves a change occurred and detects tampering, and reveals nothing. If a
 * future requirement genuinely needs the before/after VALUES, that is a separate decision with a
 * separate threat model — do not reach for it by widening `changeToPatch`.
 *
 * ── WHY HASH AT ALL, RATHER THAN TRUST THE EVENT ─────────────────────────────────────────────
 * `fs.watch` is chatty and lies in both directions: one logical save can emit several events
 * (`rename` for the temp file, `change` for the target), editors touch files without changing
 * them, and `mtime` moves when content does not. An event is a HINT to go look. Only a changed
 * digest is a change — otherwise the ledger fills with duplicates of one save and stops being
 * readable, which is the same end state as recording nothing.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import type { JsonPatch } from '@/types/json-patch'
import type { LedgerOp } from '@/types/ledger'
import { discoverSettingsTargets, watchDirs, type WatchTarget, type DiscoverOptions } from '@/lib/settings-watch-targets'

/**
 * The ledger op for a settings-file change.
 *
 * Declared in `types/ledger.ts` rather than passed as a bare string: `verify()` deliberately does
 * NOT enum-check `op`, so an undeclared value would still verify — and would be invisible to the
 * external audit tools that group events by op, which is the whole reason that taxonomy is
 * curated. Additive by construction; existing ledger files verify byte-for-byte.
 */
export const SETTINGS_LEDGER_OP: LedgerOp = 'change_settings_file'

/** How often to re-discover targets. The set is dynamic — projects and agents come and go. */
export const DEFAULT_RESCAN_MS = 5 * 60_000

export type SettingsChangeKind = 'created' | 'modified' | 'deleted'

/** What we retain per file. Deliberately NOT the content — see the header. */
export interface FileFingerprint {
  sha256: string
  size: number
}

export interface SettingsChange {
  /** Absolute path of the settings file that changed. */
  file: string
  kind: SettingsChangeKind
  /** Fingerprint before the change; null when the file did not exist. */
  before: FileFingerprint | null
  /** Fingerprint after the change; null when the file was deleted. */
  after: FileFingerprint | null
}

/**
 * Fingerprint a file, or null when it is absent or unreadable.
 *
 * ABSENT and UNREADABLE deliberately collapse to the same answer HERE, and that is safe only
 * because of how the caller uses it: `classifyChange` compares two fingerprints and reports a
 * change only when they DIFFER. A transient read error therefore produces at worst one spurious
 * `deleted` followed by one `created` — noisy, never silent. The opposite choice (throw) would
 * kill the watcher on a momentary EACCES and turn a blip into permanent silence.
 */
export function fingerprintOf(file: string): FileFingerprint | null {
  try {
    const buf = fs.readFileSync(file)
    return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length }
  } catch {
    return null
  }
}

/**
 * Decide whether an event was a REAL change. Returns null when nothing actually moved — which is
 * the common case, since one save emits several events.
 */
export function classifyChange(
  file: string,
  before: FileFingerprint | null,
  after: FileFingerprint | null,
): SettingsChange | null {
  if (before === null && after === null) return null            // absent, still absent
  if (before && after && before.sha256 === after.sha256) return null // touched, not changed
  const kind: SettingsChangeKind = before === null ? 'created' : after === null ? 'deleted' : 'modified'
  return { file, kind, before, after }
}

/**
 * Render a change as a JSON Patch for the ledger.
 *
 * The patch path is the FILE path, so an auditor can group a file's history without parsing the
 * value. The value carries fingerprints only (see the header on why not content).
 */
export function changeToPatch(change: SettingsChange): JsonPatch {
  const path = `/settings${change.file}`
  if (change.kind === 'deleted') return [{ op: 'remove', path }]
  if (change.kind === 'created') return [{ op: 'add', path, value: { after: change.after } }]
  return [{ op: 'replace', path, value: { before: change.before, after: change.after } }]
}

/**
 * The minimum of `SignedLedger` this module needs.
 *
 * Structural rather than importing the class, for two reasons: the watcher stays dependency-light
 * and importable without constructing a ledger (it ships dark), and a test can drive the seam with
 * a plain object instead of a real signing key and an on-disk chain.
 */
export interface LedgerAppender {
  append(op: LedgerOp, path: string, diff: JsonPatch, opts?: { authActor?: 'user' | 'agent' | 'system' }): Promise<unknown>
}

/**
 * Record one change to the signed ledger.
 *
 * `authActor: 'system'` is the honest actor: no user or agent request initiated this. The watcher
 * OBSERVES a write that already happened, whoever made it — which is the point, since a change
 * nobody recorded is exactly the one worth having in the chain. Deliberately no `authAgentId`:
 * inventing one would attribute the write to an agent we did not observe making it.
 */
export async function recordChange(ledger: LedgerAppender, change: SettingsChange): Promise<void> {
  await ledger.append(SETTINGS_LEDGER_OP, change.file, changeToPatch(change), { authActor: 'system' })
}

export interface WatcherHandle {
  /** Feed a raw event in. Real `fs.watch` calls this; tests call it directly. */
  onRawEvent(dir: string, basename: string | null): void
  /** Re-discover targets and reconcile the armed set. Safe to call at any time. */
  rescan(): void
  /** Directories currently armed. */
  armedDirs(): string[]
  /** Close EVERY watcher and stop the re-scan timer. Idempotent. */
  close(): void
}

export interface WatchOptions extends DiscoverOptions {
  /** Called for each REAL change. Throwing here must not kill the watcher. */
  onChange: (change: SettingsChange) => void
  /** 0 disables the periodic re-scan (tests drive `rescan()` themselves). */
  rescanMs?: number
  /** Injectable for tests; defaults to `fs.watch`. */
  watchFn?: typeof fs.watch
}

/**
 * Arm the watcher over every discovered target.
 *
 * Returns a handle whose `close()` releases EVERY watcher and the timer. That is not politeness:
 * an fs watcher is an OS resource, this arms one per directory (27 measured on the live corpus),
 * and a suite that opens them without closing leaks handles into every later test.
 */
export function armSettingsWatchers(opts: WatchOptions): WatcherHandle {
  const watchFn = opts.watchFn ?? fs.watch
  const rescanMs = opts.rescanMs ?? DEFAULT_RESCAN_MS

  /** dir -> watcher. */
  const watchers = new Map<string, fs.FSWatcher>()
  /** absolute file -> last known fingerprint. The baseline a change is measured against. */
  const known = new Map<string, FileFingerprint | null>()
  /** dir -> the basenames we care about there. */
  const wanted = new Map<string, Set<string>>()
  let timer: NodeJS.Timeout | null = null
  let closed = false

  function indexTargets(targets: readonly WatchTarget[]): void {
    wanted.clear()
    for (const t of targets) {
      let set = wanted.get(t.dir)
      if (!set) { set = new Set(); wanted.set(t.dir, set) }
      set.add(t.basename)
      // Seed the baseline ONCE per file. Re-seeding on every rescan would overwrite the
      // pre-change fingerprint with the post-change one and swallow the very edit we exist to
      // record — a watcher that reports nothing looks exactly like a quiet file.
      if (!known.has(t.file)) known.set(t.file, fingerprintOf(t.file))
    }
  }

  function onRawEvent(dir: string, basename: string | null): void {
    if (closed) return
    const names = wanted.get(dir)
    if (!names) return
    // `fs.watch` may hand back a null filename on some platforms. Then we cannot tell WHICH file
    // moved, so check every file we care about in that directory rather than guessing — a missed
    // write is unrecoverable, a redundant hash is a few microseconds.
    const candidates = basename === null ? [...names] : names.has(basename) ? [basename] : []
    for (const name of candidates) {
      const file = dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
      const before = known.has(file) ? known.get(file)! : null
      const after = fingerprintOf(file)
      const change = classifyChange(file, before, after)
      known.set(file, after)
      if (!change) continue
      // A throwing consumer must not take the watcher down with it: the ledger append is async
      // I/O and can fail transiently, and one failed record is a gap while a dead watcher is
      // permanent blindness.
      try { opts.onChange(change) } catch { /* consumer's problem, not the watcher's */ }
    }
  }

  function rescan(): void {
    if (closed) return
    const targets = discoverSettingsTargets(opts)
    indexTargets(targets)
    const want = new Set(watchDirs(targets))

    for (const [dir, w] of watchers) {
      if (!want.has(dir)) { try { w.close() } catch { /* already gone */ } ; watchers.delete(dir) }
    }
    for (const dir of want) {
      if (watchers.has(dir)) continue
      try {
        const w = watchFn(dir, { persistent: false }, (_event, filename) => {
          onRawEvent(dir, filename === null || filename === undefined ? null : String(filename))
        })
        // A watcher that errors (dir deleted under us) must drop out rather than throw globally.
        w.on('error', () => { try { w.close() } catch { /* noop */ } ; watchers.delete(dir) })
        watchers.set(dir, w)
      } catch {
        // The directory vanished between discovery and arming. The next rescan retries it; a
        // throw here would abort arming for every remaining directory.
      }
    }
  }

  rescan()
  if (rescanMs > 0) {
    timer = setInterval(rescan, rescanMs)
    // Never hold the process open just because a watcher is armed.
    timer.unref?.()
  }

  return {
    onRawEvent,
    rescan,
    armedDirs: () => [...watchers.keys()].sort(),
    close() {
      closed = true
      if (timer) { clearInterval(timer); timer = null }
      for (const w of watchers.values()) { try { w.close() } catch { /* already gone */ } }
      watchers.clear()
    },
  }
}
