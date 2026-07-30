/**
 * TRDD-C4YJAUD9 — give the index's expensive verify a caller that actually runs.
 *
 * `TRDD-4VCXRHAY` split validate by depth because running the FULL pass on every open
 * made the safety mechanism the scaling wall (an 11 ms graph query behind a 666 ms
 * open). The split was right and measured — warm `board` went 1.03 s → 0.37 s — but it
 * left the expensive half with no caller except a benchmark, and **a check nobody runs
 * is a check that does not exist.** `integrity_check` is the only check that detects a
 * genuinely damaged file rather than a wrong shape, so with no scheduled caller an
 * index created once and never migrated again was never fully checked for the rest of
 * its life.
 *
 * THIS FILE IS THE DETECTOR HALF, AND IT REPAIRS NOTHING. `3P-IDX-07`
 * (validate-never-heals) is not advice here, it is the whole design: *"an observer that
 * silently fixed things makes a recurring corruption invisible to the very tool asked
 * whether corruption recurs."* Three independent reasons land on the same shape:
 *
 *  1. **The spec forbids it.** A sweep IS the observer `3P-IDX-07` is about.
 *  2. **It COULD not rebuild even if allowed.** `corpusKeyFor` is a one-way
 *     `sha256(realpath)`, so from an index FILE you cannot recover the corpus it
 *     indexes. A host-wide sweep can detect and it can delete — it can never rebuild.
 *     Deleting what only somebody else can restore is not a repair, it is a handoff of
 *     a bill.
 *  3. **Deleting under a waiting writer is the exact disaster `TRDD-YN8EQWYP`
 *     recorded.** POSIX `unlink` succeeds against an open file, so a writer blocked at
 *     our `BEGIN IMMEDIATE` would proceed on an unlinked inode, write its whole build
 *     into a doomed file, and report success. That is why `busy` is a NEVER_HEALED
 *     fault one layer down, and it is why the window is closed here by not opening it.
 *
 * The repair lives where the corpus path lives: `greptrdd index-verify --repair`, which
 * reuses the ALREADY-TESTED self-heal in `openIndex` rather than adding a second
 * "is this healable?" decision. Two such decisions had already drifted apart once
 * (see NEVER_HEALED in `index-db.ts`), and the drift cost a healthy index.
 */
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { statePath } from '../ecosystem-constants'
import {
  SCHEMA_VERSION,
  validateAt,
  isBusyError,
  recordHeal,
  readHealLedger,
  type IndexFault,
} from './index-db'

/**
 * What one index file turned out to be. Five states, because the four non-ok ones
 * have four DIFFERENT repairs and collapsing any two of them is how a healthy index
 * gets deleted (`3P-IDX-05`, `3P-IDX-06`).
 */
export type IndexVerifyState =
  /** Full pass clean at the current schema version. */
  | 'ok'
  /** Another process holds the write lock. CONTENTION, NOT DAMAGE — skip, never judge. */
  | 'busy'
  /** Behind the ladder. The repair is to MIGRATE, which happens on that corpus's next open. */
  | 'behind'
  /** Written by a newer binary. The repair is the OPPOSITE one: upgrade the code. */
  | 'downgrade'
  /** Real damage: corrupt pages, a lying migration, orphaned rows. Needs a rebuild. */
  | 'damaged'
  /** Could not be opened as a SQLite database at all — or not read. NEVER judged as damage. */
  | 'unreadable'

export interface IndexVerdict {
  file: string
  state: IndexVerifyState
  faults: IndexFault[]
  /** Present when the state came from a thrown error rather than a fault list. */
  detail?: string
}

/** The ledger that belongs to an index file — the same path `openIndex` defaults to. */
export function ledgerFileFor(indexFile: string): string {
  return `${indexFile}.heal.json`
}

/**
 * How long to wait for another process's write lock before calling it `busy`.
 *
 * DELIBERATELY SHORT, and shorter than `DEFAULT_BUSY_TIMEOUT_MS` (5 s). A writer is
 * the point of the index and a background check is not: skipping this file costs
 * nothing (the next sweep looks again), while waiting out a cold build would hold a
 * lock a real query wants. "Come back later" is always the right answer here.
 */
export const VERIFY_BUSY_TIMEOUT_MS = 250

export interface VerifyFileOptions {
  readonly busyTimeoutMs?: number
}

/**
 * Verify ONE index file with the FULL pass, repairing nothing.
 *
 * Two properties make this safe to point at a file belonging to a corpus this process
 * knows nothing about:
 *
 *  · `fileMustExist: true` — so an observer can never CREATE an index. Without it,
 *    `new Database(p)` would materialize an empty database at any typo'd path, and a
 *    sweep would leave litter shaped exactly like the thing it is auditing.
 *  · `busy_timeout` is the ONLY pragma set. `applyPragmas` would also set
 *    `journal_mode = WAL`, which is a WRITE — a persistent change to a file we are
 *    only supposed to be looking at, and on a rollback-journal index it would silently
 *    convert it.
 *
 * `BEGIN IMMEDIATE` comes BEFORE the validate on purpose. It is not a transaction we
 * need — nothing here writes — it is the CONTENTION PROBE: taking the write lock is
 * the only way to know that what we are about to call damage is not simply a file
 * another process is mid-build on. A deferred `BEGIN` would read first and could then
 * fail `SQLITE_BUSY_SNAPSHOT` unretried, so the shape matters as much as the intent
 * (same reason `syncIndex` begins immediate).
 */
export function verifyIndexFile(file: string, opts: VerifyFileOptions = {}): IndexVerdict {
  const busyMs = opts.busyTimeoutMs ?? VERIFY_BUSY_TIMEOUT_MS
  let db: Database.Database | null = null
  try {
    db = new Database(file, { fileMustExist: true })
    db.pragma(`busy_timeout = ${Math.max(0, Math.floor(busyMs))}`)
    db.exec('BEGIN IMMEDIATE')
  } catch (err) {
    try {
      db?.close()
    } catch {
      /* the original error is the one that matters */
    }
    if (isBusyError(err)) {
      return {
        file,
        state: 'busy',
        faults: [],
        detail: `another process holds the write lock (waited ${busyMs}ms) — skipped; this is contention, NOT damage`,
      }
    }
    // Anything else — not a database, unreadable, gone between readdir and open. It is
    // NOT called damage: we never proved this file is our derived index, and "I could
    // not look" must never read as "I looked and it was broken" (the same trichotomy
    // the CLIs enforce with exit code 2).
    return { file, state: 'unreadable', faults: [], detail: (err as Error).message }
  }

  try {
    const result = validateAt(db, SCHEMA_VERSION, 'full')
    if (result.ok) return { file, state: 'ok', faults: [] }
    // Classify by the fault whose repair is NOT a rebuild first — `validateAt` returns
    // `downgrade` and `behind` as single-fault results, so this is a discriminator and
    // not a priority ranking. Getting it backwards is janitor#123 exactly: treat a
    // behind-the-ladder index as damaged and the repair deletes a healthy file.
    const codes = new Set(result.faults.map((f) => f.code))
    const state: IndexVerifyState = codes.has('downgrade')
      ? 'downgrade'
      : codes.has('behind')
        ? 'behind'
        : 'damaged'
    return { file, state, faults: result.faults }
  } catch (err) {
    // `integrity_check` can THROW on badly damaged pages instead of returning a row —
    // `validateAt` already translates that, so reaching here means something else went
    // wrong mid-probe. Report it as unreadable rather than guessing.
    return { file, state: 'unreadable', faults: [], detail: (err as Error).message }
  } finally {
    try {
      // ROLLBACK, never COMMIT: there is nothing to commit, and rolling back is the
      // statement that says so.
      db.exec('ROLLBACK')
    } catch {
      /* the connection is closing anyway */
    }
    try {
      db.close()
    } catch {
      /* ditto */
    }
  }
}

/**
 * Every index file on this host, in one directory, no recursion.
 *
 * `*.sqlite` exactly — which also excludes the `-wal`/`-shm` sidecars and the
 * `.heal.json` ledgers by construction rather than by an exclusion list that could
 * fall behind.
 *
 * ENOENT is LEGAL ABSENCE: a host where no index has ever been built has no directory,
 * and that is not a fault to report. Every OTHER errno THROWS, because a reader that
 * returns `[]` on an I/O error turns its caller into a gate that passes because it read
 * nothing — the exact defect Phase 1 removed from the corpus reader one layer down.
 */
export function listIndexFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return entries
    .filter((e) => e.endsWith('.sqlite'))
    .sort()
    .map((e) => path.join(dir, e))
}

export interface SweepOptions {
  /** Defaults to `statePath('pillar-index')`. */
  readonly dir?: string
  readonly busyTimeoutMs?: number
  /** Injectable for tests. Defaults to `new Date().toISOString()`. */
  readonly now?: () => string
  /** Injectable for tests, so a sweep can be driven over synthetic verdicts. */
  readonly verify?: (file: string, opts: VerifyFileOptions) => IndexVerdict
}

export interface SweepResult {
  dir: string
  verdicts: IndexVerdict[]
  /** Files whose damage was newly appended to their ledger this sweep. */
  recorded: string[]
}

/** The `reason` written to the ledger. Stable, because the de-dup below matches on it. */
export const SWEEP_LEDGER_REASON = 'scheduled full verify found damage (NOT repaired — the sweep cannot rebuild)'

/**
 * Record damage in the index's own heal ledger — but only on a TRANSITION.
 *
 * `3P-IDX-09` makes the ledger the thing that keeps a recurring corruption visible, and
 * a POLLING writer would destroy exactly that. The ledger holds 50 entries; a 6-hourly
 * sweep over one damaged index nobody has repaired yet would append the same event ~4
 * times a day until all 50 slots were copies of it and every real heal had been evicted.
 * The signal would be gone, and the file would still look busy with history.
 *
 * So: append only when this damage is not already the ledger's newest entry. A heal that
 * happens in between separates the two records, which is precisely how a RECURRENCE
 * stays legible.
 *
 * Nothing else is ever recorded. `busy` in particular writes NOTHING — a contention
 * logged as a heal is worse than an unlogged one, because it is a FALSE alarm in the one
 * place an operator looks for true ones (pinned by `pillar-index-db.test.ts`, and the
 * reason `busy` is in NEVER_HEALED at all).
 */
function recordDamageIfNew(v: IndexVerdict, now: () => string): boolean {
  const ledger = ledgerFileFor(v.file)
  const faults = v.faults.map((f) => `${f.code}: ${f.detail}`)
  const prior = readHealLedger(ledger)
  const last = prior[prior.length - 1]
  if (
    last &&
    last.reason === SWEEP_LEDGER_REASON &&
    last.faults.length === faults.length &&
    last.faults.every((f, i) => f === faults[i])
  ) {
    return false
  }
  recordHeal(ledger, { at: now(), reason: SWEEP_LEDGER_REASON, faults })
  return true
}

/**
 * One sweep of every index on this host. Synchronous — `better-sqlite3` is.
 *
 * Never throws for a per-file fault: one unreadable index must not stop the check on
 * the other N. A failure to LIST the directory does propagate, because that is the
 * sweep itself being unable to run.
 */
export function runIndexVerifySweep(opts: SweepOptions = {}): SweepResult {
  const dir = opts.dir ?? statePath('pillar-index')
  const now = opts.now ?? (() => new Date().toISOString())
  const verify = opts.verify ?? verifyIndexFile
  const verdicts: IndexVerdict[] = []
  const recorded: string[] = []
  for (const file of listIndexFiles(dir)) {
    const v = verify(file, { busyTimeoutMs: opts.busyTimeoutMs })
    verdicts.push(v)
    if (v.state === 'damaged' && recordDamageIfNew(v, now)) recorded.push(file)
  }
  return { dir, verdicts, recorded }
}

export interface VerifyWatchdogOptions extends SweepOptions {
  intervalMs?: number
  /** How long after start the FIRST sweep runs. Keeps boot off the critical path. */
  initialDelayMs?: number
  log?: (msg: string) => void
}

/**
 * Every 6 hours by default — `AIM_PILLAR_INDEX_VERIFY_INTERVAL_MS` overrides, 0 disables.
 *
 * Not the 5 minutes its sibling watchdogs use, and the difference is the point: those
 * watch a FLEET that changes minute to minute, while this watches for page corruption in
 * a derived file. The cost is real and scales with the corpus (~370 ms per 10 000-card
 * index, ~3.7 s at 10⁵) times every index on the host, so a 5-minute cadence would spend
 * measurable CPU forever to shorten a detection window that nothing acts on faster than
 * a human anyway.
 */
const DEFAULT_INTERVAL_MS = Number(process.env.AIM_PILLAR_INDEX_VERIFY_INTERVAL_MS) || 6 * 60 * 60 * 1000

/**
 * The first sweep is DELAYED, not run at boot.
 *
 * The sweep is synchronous, so running it inline at startup would add N × the full pass
 * to boot — and a server that has just started is the one most likely to have a client
 * waiting. A minute later nobody is waiting, and any server that lives longer than that
 * still gets its check. `AIM_PILLAR_INDEX_VERIFY_DELAY_MS` overrides (tests pass it).
 */
const DEFAULT_INITIAL_DELAY_MS = Number(process.env.AIM_PILLAR_INDEX_VERIFY_DELAY_MS) || 60_000

/**
 * One sweep + one honest report. Never throws.
 *
 * SILENCE IS NOT SUCCESS, so this logs whenever there is anything to say — including
 * `behind` and `unreadable`, which are not damage but are also not nothing. Only an
 * all-`ok` (or empty) sweep is quiet, and `busy` is folded into the counts rather than
 * being reported per file: a skipped file is the expected outcome on a busy host, not a
 * finding.
 */
export function runIndexVerifyTick(opts: VerifyWatchdogOptions = {}): SweepResult | null {
  const log = opts.log ?? ((m: string) => console.warn(m))
  try {
    const r = runIndexVerifySweep(opts)
    const by = (s: IndexVerifyState) => r.verdicts.filter((v) => v.state === s)
    const damaged = by('damaged')
    const behind = by('behind')
    const downgrade = by('downgrade')
    const unreadable = by('unreadable')
    const busy = by('busy')
    if (damaged.length || behind.length || downgrade.length || unreadable.length) {
      const parts: string[] = []
      // Damage first, and NAMED: it is the only state with an actionable repair, and the
      // operator needs the path to run it on.
      for (const v of damaged) {
        parts.push(
          `DAMAGED ${path.basename(v.file)} (${v.faults.map((f) => f.code).join(', ')}) — rebuild with: greptrdd index-verify --repair --design-dir <that corpus>/design`,
        )
      }
      if (behind.length) parts.push(`${behind.length} behind the ladder (migrate on next open — NOT damage)`)
      if (downgrade.length)
        parts.push(`${downgrade.length} written by a NEWER binary (upgrade the code; do NOT rebuild)`)
      if (unreadable.length)
        parts.push(`${unreadable.length} unreadable (not judged as damage): ${unreadable.map((v) => path.basename(v.file)).join(', ')}`)
      const skipped = busy.length ? `; ${busy.length} skipped (in use)` : ''
      const newly = r.recorded.length ? `; ${r.recorded.length} newly recorded in the heal ledger` : ''
      log(`[PillarIndexVerify] ${r.verdicts.length} index(es) in ${r.dir}: ${parts.join('; ')}${skipped}${newly}`)
    }
    return r
  } catch (err) {
    log(`[PillarIndexVerify] sweep failed (non-fatal): ${(err as Error)?.message || err}`)
    return null
  }
}

/**
 * Start the periodic verifier. Returns a stop function, or null when disabled
 * (interval <= 0). Both timers are `unref`'d so neither holds the process open —
 * a corruption check must never be the reason a server will not shut down.
 */
export function startPillarIndexVerifyWatchdog(
  opts: VerifyWatchdogOptions = {},
): (() => void) | null {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!intervalMs || intervalMs <= 0) return null // 0 disables
  const delayMs = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  let interval: NodeJS.Timeout | null = null
  const first = setTimeout(() => {
    runIndexVerifyTick(opts)
    interval = setInterval(() => {
      runIndexVerifyTick(opts)
    }, intervalMs)
    interval.unref?.()
  }, delayMs)
  first.unref?.()
  return () => {
    clearTimeout(first)
    if (interval) clearInterval(interval)
  }
}
