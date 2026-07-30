import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { SCHEMA_VERSION, openIndex, readHealLedger } from '@/lib/pillar/index-db'
import {
  verifyIndexFile,
  listIndexFiles,
  runIndexVerifySweep,
  runIndexVerifyTick,
  startPillarIndexVerifyWatchdog,
  ledgerFileFor,
  SWEEP_LEDGER_REASON,
  type IndexVerdict,
} from '@/lib/pillar/index-verify'

/**
 * TRDD-C4YJAUD9 — the caller the expensive verify never had.
 *
 * These tests are weighted toward the two ways a scheduled verifier goes wrong, because
 * both would be INVISIBLE in a suite that only proved "damage is detected":
 *
 *  1. IT REPAIRS. `3P-IDX-07` forbids it, and a sweep that healed would make a
 *     recurring corruption invisible to the very tool asked whether corruption recurs.
 *     Worse, it CANNOT rebuild what it deletes (`corpusKeyFor` is one-way), so a nuking
 *     sweep would leave the host with N deleted indexes and no way to restore them.
 *  2. IT SPAMS ITS OWN LEDGER. The ledger holds 50 entries. A 6-hourly sweep over one
 *     unrepaired damaged index would append the same event until all 50 slots were
 *     copies of it and every real heal had been evicted — destroying the exact signal
 *     `3P-IDX-09` exists to preserve, while looking busy with history.
 *
 * 0-IMPACT BY CONSTRUCTION: every sweep here is given an explicit `dir`, so nothing
 * resolves `statePath()` and the developer's real `~/.aimaestro` is never touched.
 * (That is not hypothetical hygiene — 44 leaked indexes in the real state dir are
 * exactly what two sibling test files produced by NOT doing this. See TRDD-0GCIMQ9F.)
 */

let tmp: string
let idx: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-verify-'))
  idx = path.join(tmp, 'corpus-aaaaaaaaaaaa.sqlite')
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** A valid, current index. */
function healthy(file = idx): void {
  openIndex(file).close()
}

/** Stamp an otherwise-valid index at `v`. Shape stays correct FOR that version. */
function stampVersion(file: string, v: number): void {
  const db = new Database(file)
  db.pragma(`user_version = ${v}`)
  db.close()
}

describe('verifyIndexFile — the FULL pass, on one file, repairing nothing', () => {
  it('reports ok for a healthy current index', () => {
    healthy()
    expect(verifyIndexFile(idx)).toEqual({ file: idx, state: 'ok', faults: [] })
  })

  it('reports `behind` — NOT damaged — for an index that merely predates the ladder', () => {
    // THE janitor#123 BUG, at the sweep level. A behind index is healthy; calling it
    // damaged is how a repair deletes a file whose only problem was being old. The
    // discriminator is the version stamp, and it has to be consulted BEFORE the shape
    // verdict is allowed to mean anything.
    healthy()
    stampVersion(idx, SCHEMA_VERSION - 1)
    const v = verifyIndexFile(idx)
    expect(v.state).toBe('behind')
    expect(v.faults.map((f) => f.code)).toEqual(['behind'])
  })

  it('reports `downgrade` for an index written by a NEWER binary', () => {
    // The repair here is the OPPOSITE of every other one: upgrade the code. A rebuild
    // would destroy an index that is not broken, only ahead of us.
    healthy()
    stampVersion(idx, SCHEMA_VERSION + 1)
    expect(verifyIndexFile(idx).state).toBe('downgrade')
  })

  it('reports `damaged` when the stamp is CURRENT and the shape is still wrong', () => {
    healthy()
    const db = new Database(idx)
    db.exec('DROP TABLE edges')
    db.close()
    const v = verifyIndexFile(idx)
    expect(v.state).toBe('damaged')
    expect(v.faults[0].code).toBe('shape')
  })

  it('reports `unreadable` — never `damaged` — for a file that is not a database', () => {
    // "I could not look" must not read as "I looked and it was broken". A `.sqlite` file
    // we cannot open is not provably OUR derived index; it could be anything a process
    // dropped in the directory, and judging it damaged is the first step toward
    // deleting something we never identified.
    fs.writeFileSync(idx, 'this is not a sqlite database')
    const v = verifyIndexFile(idx)
    expect(v.state).toBe('unreadable')
    expect(v.detail).toBeTruthy()
  })

  it('NEVER CREATES the file it was asked about', () => {
    // `fileMustExist: true`. Without it `new Database(p)` materializes an empty database
    // at any path — so a sweep with one typo would leave litter shaped exactly like the
    // thing it audits, and an observer would have become a writer.
    const missing = path.join(tmp, 'does-not-exist.sqlite')
    expect(verifyIndexFile(missing).state).toBe('unreadable')
    expect(fs.existsSync(missing)).toBe(false)
  })

  it('does NOT convert the file to WAL — the only pragma it sets is busy_timeout', () => {
    // `applyPragmas` would set `journal_mode = WAL`, which is a PERSISTENT change to a
    // file we are only supposed to be reading. On a rollback-journal index the observer
    // would silently convert it, i.e. modify what it measures by a different route than
    // healing.
    healthy()
    const before = new Database(idx)
    before.pragma('journal_mode = delete')
    const mode = (before.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
    before.close()
    expect(mode).toBe('delete')

    verifyIndexFile(idx)

    const after = new Database(idx)
    const still = (after.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
    after.close()
    expect(still).toBe('delete')
  })

  it('LEAVES A DAMAGED INDEX EXACTLY AS IT FOUND IT, and writes no ledger entry (3P-IDX-07)', () => {
    healthy()
    const db = new Database(idx)
    db.exec('DROP TABLE edges')
    db.close()
    const sizeBefore = fs.statSync(idx).size

    expect(verifyIndexFile(idx).state).toBe('damaged')

    // Still there, still damaged, still unrecorded. `verifyIndexFile` is the OBSERVER;
    // recording is the sweep's job and repairing is the CLI's, and keeping the three
    // separate is what lets the observer be pointed at any corpus on the host safely.
    expect(fs.existsSync(idx)).toBe(true)
    expect(fs.statSync(idx).size).toBe(sizeBefore)
    expect(verifyIndexFile(idx).state).toBe('damaged')
    expect(readHealLedger(ledgerFileFor(idx))).toEqual([])
  })
})

describe('verifyIndexFile under contention — skip, never judge', () => {
  /** Hold the write lock the way a mid-build `syncIndex` does. */
  function held(): Database.Database {
    healthy()
    const holder = new Database(idx)
    holder.pragma('journal_mode = WAL')
    holder.exec('BEGIN IMMEDIATE')
    return holder
  }

  it('reports `busy` rather than a verdict about the file', () => {
    // The whole reason `BEGIN IMMEDIATE` comes BEFORE the validate: taking the write
    // lock is the only way to know that what we are about to call damage is not simply
    // a file another process is mid-build on.
    const holder = held()
    try {
      const v = verifyIndexFile(idx, { busyTimeoutMs: 1 })
      expect(v.state).toBe('busy')
      expect(v.faults).toEqual([])
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
    }
  })

  it('a sweep records NOTHING for a busy file — a false alarm discredits the true ones', () => {
    const holder = held()
    try {
      const r = runIndexVerifySweep({ dir: tmp, busyTimeoutMs: 1 })
      expect(r.verdicts.map((v) => v.state)).toEqual(['busy'])
      expect(r.recorded).toEqual([])
      expect(readHealLedger(ledgerFileFor(idx))).toEqual([])
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
    }
  })
})

describe('listIndexFiles', () => {
  it('lists only *.sqlite, sorted — so -wal, -shm and .heal.json cannot be mistaken for indexes', () => {
    healthy(path.join(tmp, 'b.sqlite'))
    healthy(path.join(tmp, 'a.sqlite'))
    fs.writeFileSync(path.join(tmp, 'a.sqlite-wal'), '')
    fs.writeFileSync(path.join(tmp, 'a.sqlite-shm'), '')
    fs.writeFileSync(path.join(tmp, 'a.sqlite.heal.json'), '[]')
    expect(listIndexFiles(tmp).map((f) => path.basename(f))).toEqual(['a.sqlite', 'b.sqlite'])
  })

  it('treats a MISSING directory as legal absence — a host that has never indexed', () => {
    expect(listIndexFiles(path.join(tmp, 'never-existed'))).toEqual([])
  })

  it('THROWS on any other errno instead of reporting an empty host', () => {
    // A reader that returns [] on an I/O error turns its caller into a gate that passes
    // because it read nothing. ENOTDIR is used rather than chmod: a permissions fixture
    // passes VACUOUSLY when the suite runs as root, and CI often does.
    const notADir = path.join(tmp, 'a-file')
    fs.writeFileSync(notADir, 'x')
    expect(() => listIndexFiles(path.join(notADir, 'sub'))).toThrow()
  })
})

describe('the sweep records damage in the heal ledger — and records a TRANSITION, not a poll', () => {
  function damaged(file = idx): void {
    healthy(file)
    const db = new Database(file)
    db.exec('DROP TABLE edges')
    db.close()
  }

  it('appends the fault so a corruption that recurs is visible (3P-IDX-09)', () => {
    damaged()
    const r = runIndexVerifySweep({ dir: tmp, now: () => '2026-07-30T00:00:00Z' })
    expect(r.recorded).toEqual([idx])
    const events = readHealLedger(ledgerFileFor(idx))
    expect(events).toHaveLength(1)
    expect(events[0].reason).toBe(SWEEP_LEDGER_REASON)
    // The FAULT, not just "something happened" — a ledger entry with no fault text
    // cannot tell a recurrence of the same damage from a different one.
    expect(events[0].faults.join(' ')).toMatch(/shape/)
    expect(events[0].at).toBe('2026-07-30T00:00:00Z')
  })

  it('does NOT append the same damage twice — the 50-slot ledger must not fill with copies', () => {
    // THE ANTI-SPAM GUARD, and the reason it is load-bearing rather than tidy: at the
    // 6-hourly default an unrepaired index would be re-recorded ~4x/day, so within two
    // weeks all 50 slots are one event and every genuine heal has been evicted. The
    // ledger would look full of history and contain none.
    damaged()
    const first = runIndexVerifySweep({ dir: tmp, now: () => 't1' })
    const second = runIndexVerifySweep({ dir: tmp, now: () => 't2' })
    expect(first.recorded).toEqual([idx])
    expect(second.recorded).toEqual([])
    expect(readHealLedger(ledgerFileFor(idx))).toHaveLength(1)
  })

  it('DOES append again when a heal happened in between — that is how recurrence stays legible', () => {
    // The de-dup must not degrade into "record it once, ever". A repair followed by fresh
    // damage is the single most important thing the ledger has to be able to show.
    damaged()
    runIndexVerifySweep({ dir: tmp, now: () => 't1' })
    // The repair: a full-depth open heals and records its own event.
    openIndex(idx, { verify: 'full', now: () => 't2' }).close()
    damaged()
    const third = runIndexVerifySweep({ dir: tmp, now: () => 't3' })
    expect(third.recorded).toEqual([idx])
    const events = readHealLedger(ledgerFileFor(idx))
    expect(events.map((e) => e.at)).toEqual(['t1', 't2', 't3'])
  })

  it('records nothing for `behind` — it is not damage, and polling it would spam too', () => {
    healthy()
    stampVersion(idx, SCHEMA_VERSION - 1)
    const r = runIndexVerifySweep({ dir: tmp })
    expect(r.verdicts.map((v) => v.state)).toEqual(['behind'])
    expect(r.recorded).toEqual([])
    expect(readHealLedger(ledgerFileFor(idx))).toEqual([])
  })

  it('one unreadable index does not stop the check on the others', () => {
    const good = path.join(tmp, 'aa-good.sqlite')
    healthy(good)
    fs.writeFileSync(path.join(tmp, 'zz-garbage.sqlite'), 'nope')
    const r = runIndexVerifySweep({ dir: tmp })
    // `idx` itself was never created in this test, so the two seeded files are the set.
    expect(r.verdicts.map((v) => v.state).sort()).toEqual(['ok', 'unreadable'])
  })
})

describe('the tick reports honestly, and never throws', () => {
  const verdict = (file: string, state: IndexVerdict['state']): IndexVerdict => ({
    file,
    state,
    faults: state === 'damaged' ? [{ code: 'corrupt', detail: 'seeded' }] : [],
  })

  it('stays SILENT on an all-ok sweep', () => {
    healthy()
    const lines: string[] = []
    runIndexVerifyTick({ dir: tmp, log: (m) => lines.push(m) })
    expect(lines).toEqual([])
  })

  it('names a damaged index AND the command that repairs it', () => {
    // A finding an operator cannot act on is a finding that gets ignored. The sweep
    // cannot repair, so the least it owes is the name of the thing that can.
    const lines: string[] = []
    healthy()
    runIndexVerifyTick({
      dir: tmp,
      log: (m) => lines.push(m),
      verify: (f) => verdict(f, 'damaged'),
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('DAMAGED')
    expect(lines[0]).toContain('greptrdd index-verify --repair')
  })

  it('reports `behind` and `unreadable` too — silence is not success', () => {
    const lines: string[] = []
    healthy(path.join(tmp, 'a.sqlite'))
    runIndexVerifyTick({ dir: tmp, log: (m) => lines.push(m), verify: (f) => verdict(f, 'behind') })
    expect(lines[0]).toMatch(/behind the ladder/)
  })

  it('a busy-only sweep is quiet — a skipped file is the expected outcome, not a finding', () => {
    const lines: string[] = []
    healthy(path.join(tmp, 'a.sqlite'))
    runIndexVerifyTick({ dir: tmp, log: (m) => lines.push(m), verify: (f) => verdict(f, 'busy') })
    expect(lines).toEqual([])
  })

  it('returns null and logs instead of throwing when the sweep itself cannot run', () => {
    const lines: string[] = []
    const notADir = path.join(tmp, 'file')
    fs.writeFileSync(notADir, 'x')
    const r = runIndexVerifyTick({ dir: path.join(notADir, 'sub'), log: (m) => lines.push(m) })
    expect(r).toBeNull()
    expect(lines[0]).toMatch(/sweep failed/)
  })
})

describe('the watchdog', () => {
  it('is disabled by an interval of 0', () => {
    expect(startPillarIndexVerifyWatchdog({ dir: tmp, intervalMs: 0 })).toBeNull()
  })

  it('does NOT sweep before its initial delay — boot must not pay for it', () => {
    // The sweep is synchronous and costs ~370 ms per 10 000-card index, so running it
    // inline at startup would add N x that to a boot where a client is most likely to be
    // waiting. The delay is the whole reason the wiring is safe to start unconditionally.
    healthy()
    const lines: string[] = []
    const stop = startPillarIndexVerifyWatchdog({
      dir: tmp,
      intervalMs: 60_000,
      initialDelayMs: 60_000,
      log: (m) => lines.push(m),
      verify: (f) => ({ file: f, state: 'damaged', faults: [{ code: 'corrupt', detail: 'x' }] }),
    })
    expect(stop).toBeTypeOf('function')
    expect(lines).toEqual([])
    stop?.()
  })
})
