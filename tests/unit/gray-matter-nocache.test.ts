import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import matter from 'gray-matter'
import { NO_MATTER_CACHE } from '@/lib/gray-matter-nocache'

/**
 * gray-matter keeps a MODULE-LEVEL cache keyed by each file's full text and stores the
 * parsed file including `orig`, with nothing ever evicting it. In a CLI that is a
 * bounded cost; in the long-lived AI Maestro server it is an UNBOUNDED leak, because
 * the corpora it parses are unbounded — every SKILL.md of every marketplace it browses,
 * every element of every plugin it converts.
 *
 * It was found in the pillar corpus reader (TRDD-BQC8NQSW), where it turned a 100 000-
 * document lint into an OOM crash. The reader was fixed first; this test exists because
 * the SAME one-argument call appeared in three other subsystems that had nothing to do
 * with that card, and nothing would have stopped a fourth.
 *
 * The check is SOURCE-LEVEL on purpose. The property being enforced is syntactic —
 * "every call site passes options" — and a behavioural test can only cover the call
 * sites someone remembered to exercise, which is exactly the set that was already
 * correct. This one fails on a call site nobody thought about.
 */

const REPO = process.cwd()
const SCAN_DIRS = ['app', 'lib', 'services', 'scripts', 'components']

/** `matter(x)` with a single argument. `matter.stringify(...)` is a different call. */
const ONE_ARG_CALL = /(?<![.\w])matter\(\s*[^),]*\)/

/**
 * Directory pathspecs + an extension filter in JS — deliberately NOT a `**` glob.
 *
 * The first version of this used `lib/**\/*.ts`, and git's wildmatch reads the `**\/`
 * as requiring a directory: it matched 71 NESTED files and ZERO top-level ones, so the
 * scan was blind to `lib/marketplace-skills.ts` — one of the three files this test was
 * written to protect. The neuter run caught it (reverting that call site left the suite
 * green), and the positive control did NOT, because I had picked `lib/pillar/store.ts`
 * to prove the list was non-empty and a nested path is exactly what the broken glob
 * still matched. A control has to be chosen to falsify the failure you fear.
 */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...SCAN_DIRS], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out.split('\0').filter((f) => /\.(ts|tsx|mjs)$/.test(f))
}

describe('gray-matter must never be called without options (TRDD-BQC8NQSW)', () => {
  it('the scan actually reads files — a positive control on its own inputs', () => {
    // Without this the whole suite passes vacuously the day the glob stops matching,
    // which is the failure mode of every source-scanning check.
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(200)
    // BOTH shapes, and that pairing is the whole point: a `**` glob that silently
    // dropped every top-level file passed a control that named only the nested one.
    expect(files).toContain('lib/pillar/store.ts') // nested
    expect(files).toContain('lib/marketplace-skills.ts') // top-level
    expect(files).toContain('services/plugin-builder-service.ts')
  })

  it('no production call site parses with a single argument', () => {
    const offenders: string[] = []
    for (const rel of trackedFiles()) {
      const text = fs.readFileSync(path.join(REPO, rel), 'utf8')
      if (!/from 'gray-matter'/.test(text)) continue
      text.split('\n').forEach((line, i) => {
        // Skip comments — this file's own prose quotes the defective form.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (ONE_ARG_CALL.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(offenders, `pass NO_MATTER_CACHE (lib/gray-matter-nocache.ts):\n${offenders.join('\n')}`).toEqual([])
  })

  it('positive control: the regex DOES catch the defective form', () => {
    // Otherwise the assertion above passes because the pattern matches nothing at all.
    expect(ONE_ARG_CALL.test('  const parsed = matter(content)')).toBe(true)
    expect(ONE_ARG_CALL.test('  const parsed = matter(raw, NO_MATTER_CACHE)')).toBe(false)
    // `matter.stringify` is a different function and must not be flagged.
    expect(ONE_ARG_CALL.test('  return matter.stringify(body)')).toBe(false)
  })

  it('the constant is falsy-proof: it must be an OBJECT, not undefined or null', () => {
    // gray-matter branches on `if (!options)`, so any falsy value silently restores
    // the cache while looking like the fix is in place.
    expect(NO_MATTER_CACHE).toBeTypeOf('object')
    expect(NO_MATTER_CACHE).not.toBeNull()
    expect(Boolean(NO_MATTER_CACHE)).toBe(true)
  })

  it('end-to-end: parsing with the constant leaves the cache empty, without it does not', () => {
    const cacheKeys = () =>
      Object.keys((matter as unknown as { cache: Record<string, unknown> }).cache ?? {})
    ;(matter as unknown as { clearCache(): void }).clearCache()
    matter('---\na: 1\n---\nbody one', NO_MATTER_CACHE)
    expect(cacheKeys()).toHaveLength(0)
    matter('---\na: 1\n---\nbody two')
    expect(cacheKeys()).toHaveLength(1)
    ;(matter as unknown as { clearCache(): void }).clearCache()
  })
})
