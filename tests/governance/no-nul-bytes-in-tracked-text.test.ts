/**
 * NO TRACKED TEXT FILE MAY CONTAIN A RAW NUL BYTE.
 *
 * ── WHAT HAPPENED (2026-08-05) ──────────────────────────────────────────────────────────────────
 * `grep -n "A note you wrote in your OWN task description" .claude/rules/lessons-verification.md`
 * returned NOTHING. So did `grep -c "neuter"` on the same file — a word that occurs 65 times in it.
 * The file was not missing and the pattern was not wrong: a single raw 0x00 byte at offset 103074
 * made ugrep classify the whole file as BINARY and skip it in silence. `--text` gave 45 matching
 * lines immediately.
 *
 * A repo-wide sweep found the same defect in FOUR tracked files, every one a raw NUL sitting where
 * the four-character escape was meant:
 *
 *   .claude/rules/lessons-verification.md           the lesson that WARNS about NUL bytes
 *   lib/command-queue.ts                            a NUL-joined composite key
 *   scripts/trdd-doctor.mjs                         a NUL-joined finding key + its split
 *   tests/unit/oauth-rotator-cookie-vault.test.ts   a NUL-joined test key
 *
 * ── WHY IT IS WORSE THAN A COSMETIC DEFECT ──────────────────────────────────────────────────────
 * The runtime behaviour is IDENTICAL — a raw NUL in a template literal and the escape both produce
 * U+0000 — so nothing fails, no test goes red, and no output anywhere says a word. What breaks is
 * the TOOLING every agent depends on, in the direction that is hardest to notice:
 *
 *   1. SEARCH RETURNS A FALSE ABSENCE. Not "an error" — "no match", for every pattern, over the
 *      entire file. 789 lines across those three code files were invisible to `grep`, including a
 *      governance tool (`scripts/trdd-doctor.mjs`) and the lessons file agents are told to consult.
 *      An agent greps for a symbol, gets nothing, and concludes the symbol does not exist.
 *   2. GIT SHOWS NO DIFF — but only sometimes, which is worse than always. Git sniffs the first
 *      8000 bytes only. The three code files are ~8 KB with the NUL near the top, so git called
 *      them binary and every `git diff` / `git log -p` / code review of them rendered
 *      `Bin 8440 -> 8446 bytes, 0 insertions(+), 0 deletions(-)`. The 136 KB markdown file has its
 *      NUL at byte 103074, past the window, so ITS diffs worked fine. Same defect, opposite
 *      symptom, decided by a byte offset.
 *
 * ── HOW THE NULs GET IN, WHICH IS WHY A WRITTEN RULE CANNOT STOP THEM ───────────────────────────
 * Nobody typed a raw NUL. Writing the escape through an agent's file-write tool can MATERIALIZE it
 * as the byte: the first draft of this very file asked for the escape in three places and got three
 * raw NULs, and the corpus test below failed on its own test file.
 *
 * And it is NOT reliably predictable which way a given occurrence goes — in the same write, the one
 * inside a `String.raw` template came through as text while the one in a plain string literal became
 * a byte. So "escape it more carefully" is not a rule anyone can follow.
 *
 * Two things that DO work, both used in this file: build a NUL from a NUMERIC literal
 * (`String.fromCharCode(0)`, `Buffer.from([0])`) so no escape is involved at all, and VERIFY BY BYTE
 * COUNT rather than by reading — a NUL is invisible in every terminal and every editor that would
 * otherwise show it to you. That is also why the instruction "do not put a raw NUL in source" is not
 * actionable on its own: the author's intent was already correct. Only a check on the bytes catches
 * it, which is what this file is.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(__dirname, '../..')

/**
 * The delimiter `git ls-files -z` emits, built WITHOUT a string escape.
 *
 * Writing it as an escape is what plants the very byte this file forbids — the header explains
 * why — so this guard would fail on itself. `String.fromCharCode(0)` says the same thing in
 * characters that survive any write path, and is the workaround this file recommends to others.
 */
const NUL_BYTE = String.fromCharCode(0)

/**
 * Extensions whose files are legitimately binary. Everything NOT on this list is scanned — the
 * default is "text", so a new source extension is covered the day it appears rather than the day
 * someone remembers to add it. Measured 2026-08-05: 360 of 2572 tracked files skipped here, and
 * every one is an image, a video, or an archive.
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z',
  '.mp4', '.mov', '.avi', '.webm', '.mp3', '.wav', '.ogg', '.m4a',
  '.node', '.wasm', '.jar', '.class', '.o', '.so', '.dylib', '.dll', '.exe',
  '.db', '.sqlite', '.sqlite3',
])

/**
 * Tracked BINARIES that carry no extension, so the list above cannot classify them.
 *
 * Exactly one exists: `public/images` is a 3.2 MB PNG committed without a `.png` suffix (verified
 * by magic number — it opens with the PNG signature). It is listed here rather than sniffed,
 * because an extension-less binary is a latent defect in its own right — every tool that keys on
 * extension mishandles it, a static server infers no Content-Type — so a NEW one appearing should
 * redden this build and get a human's attention, not be silently absorbed by a cleverer heuristic.
 * That is how this one was found. The other eleven extension-less tracked files (the githooks,
 * LICENSE, Dockerfile, CNAME, `scripts/dev/*`, NEXT_SCEN_NUMBER) are all genuine text and stay in
 * scope.
 */
const EXTENSIONLESS_BINARIES = new Set(['public/images'])

/** The whole detector, so the positive control below can drive it on a buffer we control. */
function hasNulByte(buf: Buffer): boolean {
  return buf.includes(0x00)
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split(NUL_BYTE)
    .filter(Boolean)
}

function trackedTextFiles(): string[] {
  return trackedFiles()
    .filter((p) => !EXTENSIONLESS_BINARIES.has(p))
    .filter((p) => {
      const dot = p.lastIndexOf('.')
      const ext = dot > p.lastIndexOf('/') ? p.slice(dot).toLowerCase() : ''
      return !BINARY_EXTENSIONS.has(ext)
    })
}

describe('no raw NUL byte in any tracked text file', () => {
  /**
   * The detector's own positive control. Without it, "no file had a NUL" is satisfied just as well
   * by a predicate that can never return true — and this guard's entire job is to return true for a
   * byte nobody can see in a diff or a terminal.
   *
   * The seeded NUL is built from a NUMERIC byte literal, never from a string escape in this source.
   * That is deliberate: the escape form is exactly what materializes as a raw byte through the
   * write path described in the header, so a control written that way would plant the defect it
   * exists to detect. It did, in the first draft.
   */
  it('the detector FIRES on a seeded NUL and stays quiet without one', () => {
    expect(hasNulByte(Buffer.from([0x61, 0x00, 0x62]))).toBe(true)
    expect(hasNulByte(Buffer.concat([Buffer.from('key = a'), Buffer.from([0]), Buffer.from('b')]))).toBe(true)
    expect(hasNulByte(Buffer.from('const key = `${a} ${b}`', 'utf8'))).toBe(false)
    // The ESCAPE — four ordinary characters — must NOT trip the guard, or the only correct
    // spelling of a NUL delimiter would be unwritable. This is what the four repaired sites hold.
    expect(hasNulByte(Buffer.from(String.raw`key.split('\x00')`, 'utf8'))).toBe(false)
  })

  /**
   * Positive control on the SCAN SET, not just the detector: a `git ls-files` that returned nothing
   * (wrong cwd, git absent, a filter typo) would make the corpus assertion below pass over an EMPTY
   * list and read as a clean repo. Floor derived by measurement on 2026-08-05 — 2212 text files of
   * 2572 tracked — and set far below it so ordinary deletions never redden this.
   */
  it('scans a plausible corpus, including the four files that carried the defect', () => {
    const files = trackedTextFiles()
    expect(files.length).toBeGreaterThan(1500)
    for (const p of [
      '.claude/rules/lessons-verification.md',
      'lib/command-queue.ts',
      'scripts/trdd-doctor.mjs',
      // `tests/unit/oauth-rotator-cookie-vault.test.ts` was the 4th defect-carrier and was DELETED
      // 2026-08-07 with its module (TRDD-XV9BLQC5 — 16/16 exports had zero production callers).
      // Dropped from this pin rather than kept: a pinned path that no longer exists is a stale
      // assertion that reddens forever and teaches the next reader to weaken the guard.
      'tests/governance/no-nul-bytes-in-tracked-text.test.ts', // this file is in its own scope
    ]) {
      expect(files).toContain(p)
    }
  })

  /**
   * The exception list must stay honest in BOTH directions: an entry that is no longer tracked is a
   * stale exception silently protecting nothing, and a list that grew means a new extension-less
   * binary landed and nobody looked at it.
   */
  it('every extension-less-binary exception is still tracked and really is binary, and there is still only one', () => {
    const tracked = new Set(trackedFiles())
    expect(EXTENSIONLESS_BINARIES.size).toBe(1)
    for (const p of EXTENSIONLESS_BINARIES) {
      expect(tracked.has(p)).toBe(true)
      expect(hasNulByte(readFileSync(resolve(ROOT, p)))).toBe(true)
    }
  })

  it('every tracked text file is NUL-free', () => {
    const offenders: string[] = []
    for (const rel of trackedTextFiles()) {
      let buf: Buffer
      try {
        buf = readFileSync(resolve(ROOT, rel))
      } catch {
        continue // deleted between ls-files and read; nothing to judge
      }
      if (hasNulByte(buf)) {
        const at = buf.indexOf(0x00)
        const line = buf.subarray(0, at).toString('utf8').split('\n').length
        offenders.push(`${rel}:${line} (byte ${at}, ${buf.filter((b) => b === 0).length} total)`)
      }
    }
    expect(
      offenders,
      'A raw NUL byte makes `grep` report NO MATCH for the entire file and can make `git diff` show\n' +
        'nothing at all. Write the escape as text instead — it is byte-identical at runtime.\n' +
        'Offenders:\n  ' + offenders.join('\n  '),
    ).toEqual([])
  })
})
