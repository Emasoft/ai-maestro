/**
 * TRDD-CS25TA6W — there is exactly ONE JSON read/write implementation.
 *
 * This replaces `save-json-safe-not-an-api.test.ts`, whose subject (the service's writer is exported
 * for its test, not as an API) stopped being true the moment `lib/json-io.ts` existed. Re-pointing
 * it would have asserted the opposite of what it was written to say, so it is rewritten rather than
 * moved — and the rewrite guards the bigger thing.
 *
 * WHAT WENT WRONG, so the next reader knows what this is defending (measured 2026-07-31): four
 * modules each carried a hand-copied `loadJsonSafe`/`saveJsonSafe` pair, and they were not four
 * copies — they were four DIFFERENT correctness levels of the same two functions. Two of them wrote
 * the human user's own `~/.claude/settings.json` with a DIRECT `writeFile`, non-atomically, which is
 * precisely how the torn file gets created that the other half then reads as `{}` and REPLACES. One
 * defect produced the damage the other completed.
 *
 * A family that drifted into four levels once will do it again. The only durable fix is that there
 * is nothing left to drift — so what this test forbids is a FIFTH copy, not a fourth.
 *
 * ⚠ NON-VACUITY. Every assertion below is over "offending" sets, and a set is empty both when the
 * codebase is clean and when the scan never ran. The floor + the owner check + the positive controls
 * are what separate those two answers; without them a broken walk reports success.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')
const SEARCH_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'types']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build'])
const OWNER = join('lib', 'json-io.ts')

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) sources(p, acc)
    else if (/\.tsx?$/.test(e)) acc.push(p)
  }
  return acc
}

/** A local DEFINITION of one of the helpers — `function foo(`, with or without export/async. */
const DEFINES = /^\s*(?:export\s+)?(?:async\s+)?function\s+(loadJsonSafe|saveJsonSafe|readJson)\s*\(/m

describe('one JSON read/write implementation', () => {
  const files = SEARCH_DIRS.flatMap(d => sources(join(ROOT, d)))
  const rel = (f: string) => f.slice(ROOT.length + 1)

  it('SCAN IS NON-VACUOUS — the sweep really reads the source tree', () => {
    // A floor, not an exact count: this repo grows. Without it a broken walk reports "clean".
    expect(files.length).toBeGreaterThan(200)
    expect(files.map(rel)).toContain(OWNER)
  })

  it('THE OWNER DEFINES ALL THREE — otherwise the "no other copy" rule guards nothing', () => {
    const src = readFileSync(join(ROOT, OWNER), 'utf-8')
    for (const fn of ['readJson', 'loadJsonSafe', 'saveJsonSafe']) {
      expect(src).toMatch(new RegExp(`^export async function ${fn}\\(`, 'm'))
    }
  })

  it('no other source file DEFINES loadJsonSafe / saveJsonSafe / readJson', () => {
    const offenders = files
      .filter(f => rel(f) !== OWNER)
      .filter(f => DEFINES.test(readFileSync(f, 'utf-8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('the owner WRITES ATOMICALLY — the half two of the four copies were missing', () => {
    const src = readFileSync(join(ROOT, OWNER), 'utf-8')
    // tmp + rename, not a direct writeFile to the target.
    expect(src).toMatch(/rename\(tmpPath, path\)/)
    expect(src).not.toMatch(/writeFile\(path,/)
  })

  it('the owner GUARDS THE WRITE — it reads the target before replacing it', () => {
    const src = readFileSync(join(ROOT, OWNER), 'utf-8')
    expect(src).toMatch(/export async function saveJsonSafe[\s\S]{0,2000}?readJson\(path\)[\s\S]{0,400}?throw new UnreadableTargetError/)
  })

  it('POSITIVE CONTROL — the DEFINES detector really matches a definition', () => {
    // Without this, "offenders is empty" is equally satisfied by a regex that matches nothing.
    for (const s of [
      'async function loadJsonSafe(filePath: string) {',
      'export async function saveJsonSafe(path: string, data: unknown) {',
      'function readJson(p) {',
    ]) expect(DEFINES.test(s)).toBe(true)
  })

  it('POSITIVE CONTROL — the detector does NOT match an IMPORT or a call', () => {
    // The rule is "one definition", not "one mention" — every consumer names these symbols.
    for (const s of [
      `import { loadJsonSafe, saveJsonSafe } from '@/lib/json-io'`,
      'const settings = await loadJsonSafe(path)',
      'await saveJsonSafe(settingsPath, settings)',
    ]) expect(DEFINES.test(s)).toBe(false)
  })
})
