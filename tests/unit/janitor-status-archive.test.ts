/**
 * The janitor status-document archive (TRDD-TCKNOA72).
 *
 * WHAT MAKES THIS SUITE DANGEROUS, AND HOW IT IS CONTAINED. Every function under test writes to,
 * or DELETES from, `~/.aimaestro/janitor-reports/` — a real directory holding real preserved audit
 * documents. `archiveDir()` resolves through `statePath()` → `os.homedir()` at CALL time, and on
 * POSIX `os.homedir()` reads `$HOME`, so repointing HOME redirects it.
 *
 * That claim is not taken on trust. `beforeEach` asserts `archiveDir()` actually lands inside the
 * temp root BEFORE any test writes a byte, and a final test counts the REAL archive across the
 * whole suite to prove nothing leaked into it. Proving containment by measurement rather than by
 * reading the code that was supposed to contain it is the whole point — a suite that merely SET
 * `process.env.HOME` and assumed it worked would silently prune the developer's real archive, and
 * these documents cannot be regenerated.
 *
 * NEUTER RUNS — ACTUALLY RUN 2026-08-05 via scripts/dev/neuter, results as observed (two of the
 * three predictions were wrong, which is the reason to run them rather than assert them):
 *
 *   · `listArchive` sorting ASCENDING instead of descending
 *     → 2 red (predicted 1): "keeps exactly the newest N" AND "returns newest first". The prune
 *       reads its order from `listArchive`, so one mutation reaches both — which is what makes
 *       "keeps the newest" a real claim rather than a restatement of the count.
 *   · the anchored filename regex → a match-anything pattern
 *     → 2 red: "rejects names that are merely close to the archive shape" AND "returns newest
 *       first and ignores foreign files" (the listing filters on the same predicate).
 *   · `archiveDiscovered` dropping its `existsSync` skip
 *     → 1 red: "a second sweep adds nothing".
 *
 *   · removing ALL THREE `includes('/')` / `('\\')` / `('..')` checks, keeping the regex
 *     → **0 red.** That is a measurement, not a pass: those three are strictly redundant with the
 *       anchored regex (nothing containing a separator can match it), so they are unpinnable by
 *       construction. They stay as the defence that survives a future regex loosening; the reason
 *       is recorded on `isValidArchiveName` itself so nobody mistakes them for the working guard.
 *       The complementary neuter above is what proves the regex IS the working guard.
 */

import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ARCHIVE_KEEP,
  archiveDir,
  archiveDiscovered,
  archiveNameFor,
  isValidArchiveName,
  listArchive,
  pruneArchive,
  stampFor,
} from '@/lib/janitor-status-archive'

const REAL_HOME = os.homedir()
const REAL_ARCHIVE = path.join(REAL_HOME, '.aimaestro', 'janitor-reports')

/** Snapshot of the developer's real archive, taken once before anything runs. */
let realArchiveBefore: string[] = []

function realArchiveNames(): string[] {
  try {
    return fs.readdirSync(REAL_ARCHIVE).sort()
  } catch {
    return []
  }
}

beforeAll(() => {
  realArchiveBefore = realArchiveNames()
})

let tmpHome: string
let tmpSrc: string
const savedHome = process.env.HOME

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-arch-home-'))
  tmpSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-arch-src-'))
  process.env.HOME = tmpHome

  // THE CONTAINMENT ASSERTION. If HOME did not take effect, this fails here — before any test has
  // written or deleted anything — rather than after the suite has pruned the real archive.
  expect(archiveDir().startsWith(tmpHome)).toBe(true)
  fs.mkdirSync(archiveDir(), { recursive: true })
})

afterEach(() => {
  process.env.HOME = savedHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
  fs.rmSync(tmpSrc, { recursive: true, force: true })
})

/** Write an archive-shaped file with a controlled mtime. */
function seedArchived(name: string, mtimeMs: number, body = 'x'): void {
  const p = path.join(archiveDir(), name)
  fs.writeFileSync(p, body, 'utf8')
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs))
}

function seedSource(unique: string, body: string, mtimeMs?: number): string {
  const p = path.join(tmpSrc, `janitor-global-status-${unique}.html`)
  fs.writeFileSync(p, body, 'utf8')
  if (mtimeMs) fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs))
  return p
}

describe('stampFor / archiveNameFor', () => {
  it('stamps local time with a filesystem-safe GMT offset, never UTC and never a colon', () => {
    const s = stampFor(new Date(2026, 7, 5, 9, 14, 22))
    expect(s).toMatch(/^20260805_091422[+-]\d{4}$/)
    // A `:` in the offset is rejected by Windows filesystems; UTC would make a reader do timezone
    // arithmetic to tie a document to their own workday.
    expect(s).not.toContain(':')
  })

  it('carries the source suffix through, so the same document maps to the same archive name', () => {
    const when = new Date(2026, 7, 5, 9, 14, 22)
    const a = archiveNameFor('janitor-global-status-mv5m1ggl.html', when)
    const b = archiveNameFor('janitor-global-status-mv5m1ggl.html', when)
    const c = archiveNameFor('janitor-global-status-9hhln44k.html', when)
    // Stable for one source: that is what lets "already archived?" be a plain existence check
    // instead of a sidecar index that could drift from the directory it describes.
    expect(a).toBe(b)
    // Distinct for another source in the same second — two documents must never collapse into one.
    expect(a).not.toBe(c)
    expect(isValidArchiveName(a)).toBe(true)
  })
})

describe('isValidArchiveName — the traversal gate', () => {
  it('rejects traversal, separators and absolute paths', () => {
    // This name is turned into a filesystem path from untrusted request input, so the allowlist is
    // the first of three checks in the route. Each of these would escape the archive dir.
    expect(isValidArchiveName('../../../etc/passwd')).toBe(false)
    expect(isValidArchiveName('/etc/passwd')).toBe(false)
    expect(isValidArchiveName('20260805_091422+0200-janitor-global-status-a/../../x.html')).toBe(false)
    expect(isValidArchiveName('..')).toBe(false)
  })

  it('rejects names that are merely close to the archive shape', () => {
    expect(isValidArchiveName('janitor-global-status-abc.html')).toBe(false) // no stamp
    expect(isValidArchiveName('20260805_091422+0200-something-else.html')).toBe(false)
    expect(isValidArchiveName('20260805_091422+0200-janitor-global-status-abc.txt')).toBe(false)
    expect(isValidArchiveName('')).toBe(false)
  })

  it('accepts exactly what the archive produces — the positive control', () => {
    // Without this, a validator that rejects everything passes every assertion above and the whole
    // feature is broken.
    expect(isValidArchiveName('20260805_091422+0200-janitor-global-status-mv5m1ggl.html')).toBe(true)
    expect(isValidArchiveName('20260805_091422-0800-janitor-global-status-a1B2c3.html')).toBe(true)
  })
})

describe('pruneArchive', () => {
  it('keeps exactly the newest N and removes the rest', () => {
    for (let i = 0; i < 8; i++) {
      seedArchived(`2026080${i}_091422+0200-janitor-global-status-doc${i}.html`, 1_700_000_000_000 + i * 1000)
    }
    expect(listArchive()).toHaveLength(8)

    const removed = pruneArchive(5, () => {})
    expect(removed).toBe(3)

    const kept = listArchive()
    expect(kept).toHaveLength(5)
    // Newest kept, oldest gone — the direction matters, and an ascending sort would invert it
    // while still leaving exactly 5 files behind.
    expect(kept.map(e => e.name)).toContain('20260807_091422+0200-janitor-global-status-doc7.html')
    expect(kept.map(e => e.name)).not.toContain('20260800_091422+0200-janitor-global-status-doc0.html')
  })

  it('does nothing when the archive is at or under the limit', () => {
    seedArchived('20260805_091422+0200-janitor-global-status-a.html', 1_700_000_000_000)
    expect(pruneArchive(5, () => {})).toBe(0)
    expect(listArchive()).toHaveLength(1)
  })

  it('logs every removal — these documents cannot be regenerated', () => {
    for (let i = 0; i < 3; i++) {
      seedArchived(`2026080${i}_091422+0200-janitor-global-status-d${i}.html`, 1_700_000_000_000 + i * 1000)
    }
    const lines: string[] = []
    pruneArchive(1, m => lines.push(m))
    // The log is the only trace that a pruned document ever existed, so it must name the file and
    // its size rather than just counting.
    expect(lines).toHaveLength(2)
    expect(lines.every(l => /pruned .*janitor-global-status-d\d\.html \(\d+ bytes\)/.test(l))).toBe(true)
  })

  it('defaults to the ratified retention bound', () => {
    expect(ARCHIVE_KEEP).toBe(50)
  })
})

describe('archiveDiscovered', () => {
  it('preserves a document byte-for-byte', () => {
    const body = '<!doctype html><html><head></head><body>fleet</body></html>'
    seedSource('mv5m1ggl', body)

    const added = archiveDiscovered(tmpSrc, () => {})
    expect(added).toHaveLength(1)

    const archived = path.join(archiveDir(), added[0].name)
    // Byte-fidelity is the entire requirement: an audit artifact that went through any
    // transformation is no longer the artifact.
    expect(fs.readFileSync(archived, 'utf8')).toBe(body)
  })

  it('a second sweep adds nothing — it runs every 60 seconds', () => {
    seedSource('mv5m1ggl', 'doc')
    expect(archiveDiscovered(tmpSrc, () => {})).toHaveLength(1)
    expect(archiveDiscovered(tmpSrc, () => {})).toHaveLength(0)
    expect(listArchive()).toHaveLength(1)
  })

  it('ignores files in the temp dir that are not janitor status documents', () => {
    fs.writeFileSync(path.join(tmpSrc, 'unrelated.html'), 'x', 'utf8')
    fs.writeFileSync(path.join(tmpSrc, 'janitor-global-status-a.txt'), 'x', 'utf8')
    expect(archiveDiscovered(tmpSrc, () => {})).toHaveLength(0)
    expect(listArchive()).toHaveLength(0)
  })

  it('leaves no .tmp file behind — the copy is atomic', () => {
    seedSource('mv5m1ggl', 'doc')
    archiveDiscovered(tmpSrc, () => {})
    // A half-copied 26 MB document served into the iframe would render as a truncated page that
    // looks like a real (but wrong) fleet state.
    expect(fs.readdirSync(archiveDir()).filter(f => f.includes('.tmp.'))).toEqual([])
  })

  it('returns [] when the source directory does not exist', () => {
    expect(archiveDiscovered(path.join(tmpSrc, 'nope'), () => {})).toEqual([])
  })

  it('prunes after a discovery, so the archive cannot grow without bound', () => {
    for (let i = 0; i < ARCHIVE_KEEP + 2; i++) {
      seedArchived(
        `20260805_0914${String(i).padStart(2, '0')}+0200-janitor-global-status-old${i}.html`,
        1_700_000_000_000 + i * 1000,
      )
    }
    seedSource('brandnew', 'doc')
    archiveDiscovered(tmpSrc, () => {})
    expect(listArchive()).toHaveLength(ARCHIVE_KEEP)
  })
})

describe('listArchive', () => {
  it('returns newest first and ignores foreign files', () => {
    seedArchived('20260801_091422+0200-janitor-global-status-old.html', 1_700_000_000_000)
    seedArchived('20260805_091422+0200-janitor-global-status-new.html', 1_700_000_009_000)
    fs.writeFileSync(path.join(archiveDir(), 'notes.txt'), 'x', 'utf8')

    const list = listArchive()
    expect(list).toHaveLength(2)
    expect(list[0].name).toContain('-new.html')
  })

  it('returns [] when the archive directory does not exist', () => {
    fs.rmSync(archiveDir(), { recursive: true, force: true })
    expect(listArchive()).toEqual([])
  })
})

describe('containment', () => {
  afterAll(() => {
    process.env.HOME = savedHome
  })

  it('wrote to and deleted from NOTHING in the real archive', () => {
    // The measurement that makes this suite safe to run. Every test above prunes and deletes; if
    // the HOME redirect had failed for any of them, the developer's real preserved documents would
    // be gone and no other assertion here would have noticed.
    expect(realArchiveNames()).toEqual(realArchiveBefore)
  })
})
