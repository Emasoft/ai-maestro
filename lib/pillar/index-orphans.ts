/**
 * Orphaned pillar-index reaper — TRDD-IMCEYV9F.
 *
 * `~/.aimaestro/pillar-index/` is HOST-GLOBAL, so any repo on the machine can write into it,
 * and a corpus under `mkdtemp` leaves a permanent entry behind when the corpus is deleted.
 * Measured 2026-08-22: **102 files, 70 MB — 97 ephemeral against 5 real corpora**, four test
 * families at twelve runs each, minted by a pytest suite in a repo we do not own.
 *
 * WHY REAPING RATHER THAN A WRITE-TIME PREDICATE. The alternative was "refuse to persist an
 * index whose corpus realpath is under `os.tmpdir()`". That predicate is contestable in both
 * directions (a CI runner whose scratch root is not `$TMPDIR`; a long-lived corpus deliberately
 * kept under `/tmp`) and its blast radius is every caller of the index-open path. Reaping needs
 * NO predicate: `files.path` is stored ABSOLUTE, so "the corpus is gone" is a fact, not a guess.
 *
 * ⚠ THIS MODULE CLASSIFIES; IT DOES NOT DELETE. `~/.claude/rules/never_free_space.md` reserves
 * deleting-to-free-space to the owner, and this repo already has the matching house pattern in
 * `check-script-drift.mjs` ("REPORTS, it must never refresh"). The CLI is report-only and
 * removal is behind an explicit opt-in flag.
 */

/** One index file, with the absolute targets sampled out of its `files` table. */
export interface IndexRow {
  readonly file: string
  /** Absolute paths sampled from `files.path`. Empty is AMBIGUOUS on its own — see `readFailed`. */
  readonly targets: readonly string[]
  /**
   * Did reading THROW? This is the field that separates "I could not look" from "I looked and
   * it recorded nothing", which an empty `targets` alone cannot express. Both outcomes are
   * never reaped, so getting this wrong does not change a verdict — it makes the REPORT lie,
   * and a report that misnames the fault sends the next reader somewhere there is no bug.
   */
  readonly readFailed: boolean
  readonly bytes: number
}

export type IndexState = 'live' | 'orphan' | 'empty' | 'unreadable'

export interface ClassifiedIndex extends IndexRow {
  readonly state: IndexState
}

export interface ReapReport {
  readonly scanned: number
  readonly rows: readonly ClassifiedIndex[]
  readonly orphans: readonly ClassifiedIndex[]
  readonly liveCount: number
  /** Read fine, recorded nothing — indeterminate, never reaped. 26 of 102 on this host. */
  readonly emptyCount: number
  readonly unreadableCount: number
  /** Bytes held by orphans only — never the whole directory. */
  readonly reclaimableBytes: number
}

/**
 * Classify each index by whether ANY of its recorded targets still exists.
 *
 * FOUR STATES, NOT TWO, and the extra two are the point.
 *
 * An index we could not read yields no targets, and "no targets" is indistinguishable from
 * "every target is gone" if you only ask `targets.every(gone)` — `[].every(...)` is `true`, so
 * such a file would classify as an orphan and be deleted BECAUSE we failed to read it. That is
 * the lenient-reader failure this codebase has been bitten by before, with a delete on the end.
 *
 * `empty` is split out from `unreadable` because the first draft conflated them and was
 * therefore WRONG about 26 of 102 real files: they open perfectly and hold zero rows. Both are
 * kept either way, so the verdict never changed — only the stated reason, which was false.
 */
export function classifyIndexes(
  rows: readonly IndexRow[],
  exists: (path: string) => boolean,
): ReapReport {
  const classified = rows.map((row): ClassifiedIndex => {
    // FOUR states, and the last two are distinct on purpose. Both are never reaped, so a
    // three-state version would give the same VERDICT with a FALSE reason — measured
    // 2026-08-22: 26 of 102 indexes were reported `unreadable` when they open perfectly and
    // simply hold zero rows. A message that misnames why is the defect this repo fixed in
    // install-agent-cli.sh the same day; getting the right answer does not excuse it.
    if (row.readFailed) return { ...row, state: 'unreadable' }
    // Read fine, recorded nothing: INDETERMINATE. There is no path to test existence against,
    // so the corpus may or may not be alive and this method cannot say. Never reaped.
    if (row.targets.length === 0) return { ...row, state: 'empty' }
    // ONE surviving target is enough. A corpus mid-edit has deleted files; the index is
    // orphaned only when the WHOLE corpus is gone.
    const anyAlive = row.targets.some((t) => exists(t))
    return { ...row, state: anyAlive ? 'live' : 'orphan' }
  })

  const orphans = classified.filter((r) => r.state === 'orphan')
  return {
    scanned: classified.length,
    rows: classified,
    orphans,
    liveCount: classified.filter((r) => r.state === 'live').length,
    emptyCount: classified.filter((r) => r.state === 'empty').length,
    unreadableCount: classified.filter((r) => r.state === 'unreadable').length,
    reclaimableBytes: orphans.reduce((n, r) => n + r.bytes, 0),
  }
}

/**
 * Exit code. THREE codes, because two cannot express "I could not look".
 *
 * `2` is keyed on INPUT CONSUMED (`scanned === 0`), never on output produced. A guard written
 * over findings fires on SUCCESS — clearing the last orphan would move the exit 1 → 2 and the
 * criterion "exits 0 once clean" becomes unsatisfiable by any amount of correct work. Scanning
 * N > 0 files and finding nothing IS the clean case.
 */
export function reapExitCode(report: ReapReport): 0 | 1 | 2 {
  if (report.scanned === 0) return 2
  return report.orphans.length > 0 ? 1 : 0
}

const MB = 1024 * 1024

export function formatReapReport(report: ReapReport): string {
  if (report.scanned === 0) {
    return 'pillar-index-reap: COULD NOT RUN — scanned 0 index files (wrong dir, or unreadable)'
  }
  const lines = report.orphans.map(
    (r) => `ORPHAN   ${r.file} — corpus gone (${(r.bytes / MB).toFixed(1)} MB)`,
  )
  // Surfaced, never reaped — but named ACCURATELY, which is the difference between sending the
  // next reader at a real fault and sending them at a file that is working fine.
  for (const r of report.rows.filter((x) => x.state === 'unreadable')) {
    lines.push(`UNREADABLE ${r.file} — kept; reading it THREW, so it is NOT an orphan`)
  }
  for (const r of report.rows.filter((x) => x.state === 'empty')) {
    lines.push(`EMPTY      ${r.file} — kept; opens fine but records no paths, so nothing to test`)
  }
  lines.push(
    `pillar-index-reap: ${report.scanned} scanned — ${report.liveCount} live, ` +
      `${report.orphans.length} orphaned, ${report.emptyCount} empty, ` +
      `${report.unreadableCount} unreadable ` +
      `(${(report.reclaimableBytes / MB).toFixed(1)} MB reclaimable)`,
  )
  if (report.orphans.length > 0) {
    lines.push('  report-only by default — re-run with --reap to remove ONLY the ORPHAN rows')
  }
  return lines.join('\n')
}