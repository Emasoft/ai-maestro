/**
 * TRDD-K71FV649 — a write must never destroy a file it could not read.
 *
 * MEASURED 2026-07-31: **21 of 21** `saveJsonSafe` calls in element-management-service are
 * read-modify-write fed by `loadJsonSafe` of the same path, and 4 of them target
 * `~/.claude/settings.json` — the human user's own global Claude Code config. The lenient reader
 * answers `{}` to "does not parse", so on a corrupt file each of those sites built a minimal object
 * out of nothing and the atomic write REPLACED the file. ChangePlugin's G10 is the worst shape: it
 * read `{}`, concluded "plugin missing after install", logged `writing safeguard`, and truncated the
 * file — an ops line that reads like a repair.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IS THE BYTES, NOT THE THROW. A test asserting only that the call
 * rejects passes on a `saveJsonSafe` that throws for every reason (a bad dir, a full disk) and
 * equally on one that throws AFTER clobbering. `readFileSync(...) === the corrupt bytes` is the one
 * assertion that can only pass if nothing was written — so it is the one the neuter must red.
 *
 * ⚠ REAL FILES, NO `fs` MOCK. The property under test is what is on disk afterward; a mocked `fs`
 * has no disk, so it would assert the mock — the same way `lib/claude-settings-enforcer.ts` pins its
 * identical ruling.
 *
 * The subject moved to `lib/json-io.ts` with TRDD-CS25TA6W: three sibling modules carried their own
 * unguarded copy of this writer, two of them writing `~/.claude/settings.json` NON-ATOMICALLY — the
 * very way the corrupt target this guard refuses gets created. `one-json-io-implementation.test.ts`
 * is what now forbids a fifth copy.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'k71-clobber-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Truncated mid-write, and carrying a key nobody wants to lose — the shape MAJ-01's own comment
 *  says the pre-2026-05-04 non-atomic writer used to leave behind. */
const CORRUPT = '{\n  "enabledPlugins": {\n    "someone-elses-plugin@mk": true\n'

let n = 0
const freshCorruptFile = () => {
  const p = join(dir, `settings-${++n}.json`)
  writeFileSync(p, CORRUPT, 'utf-8')
  return p
}

describe('saveJsonSafe — refuses to overwrite a target it cannot read', () => {
  let saveJsonSafe: (p: string, d: Record<string, unknown>) => Promise<void>

  beforeEach(async () => {
    ;({ saveJsonSafe } = await import('@/lib/json-io'))
  })

  it('LEAVES THE BYTES UNTOUCHED — the assertion the whole guard exists for', async () => {
    const p = freshCorruptFile()
    await expect(saveJsonSafe(p, { enabledPlugins: { 'mine@mk': true } })).rejects.toThrow()
    expect(readFileSync(p, 'utf-8')).toBe(CORRUPT)
  })

  it('names the REASON, so a caller can tell this refusal from any other write failure', async () => {
    const p = freshCorruptFile()
    await expect(saveJsonSafe(p, { a: 1 })).rejects.toThrow(/does not parse[\s\S]*refusing to overwrite/)
  })

  it('leaves no orphan .tmp file behind — the refusal happens BEFORE the atomic write starts', async () => {
    const p = freshCorruptFile()
    await expect(saveJsonSafe(p, { a: 1 })).rejects.toThrow()
    // A `.tmp.<pid>.<n>` sibling would mean the write began and was abandoned mid-flight.
    const strays = require('fs').readdirSync(dir).filter((f: string) => f.startsWith(`${p.split('/').pop()}.tmp`))
    expect(strays).toEqual([])
  })

  it('POSITIVE CONTROL — a MISSING file is still created (first-run must keep working)', async () => {
    const p = join(dir, 'brand-new.json')
    expect(existsSync(p)).toBe(false)
    await saveJsonSafe(p, { enabledPlugins: { 'mine@mk': true } })
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual({ enabledPlugins: { 'mine@mk': true } })
  })

  it('POSITIVE CONTROL — a VALID file is still overwritten, so the guard is not refusing everything', async () => {
    const p = join(dir, 'valid.json')
    writeFileSync(p, JSON.stringify({ enabledPlugins: { old: true } }), 'utf-8')
    await saveJsonSafe(p, { enabledPlugins: { fresh: true } })
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual({ enabledPlugins: { fresh: true } })
  })

  // The reader's own hole, closed in the same slice: `JSON.parse` SUCCEEDS for `[]`, `null`, `42`
  // and `"str"`, so `readJson`'s `data: Record<string, unknown>` was a type LIE for each of them and
  // the caller's `settings.enabledPlugins = ep` would attach a key to an array (or throw on null)
  // and then write the result. `lib/claude-settings-enforcer.ts:121-128` already refuses this shape.
  for (const [label, body] of [['an array', '[]'], ['null', 'null'], ['a number', '42'], ['a string', '"str"']] as const) {
    it(`refuses a target that parses as ${label} — valid JSON is not a usable settings object`, async () => {
      const p = join(dir, `notobj-${label.replace(/\W/g, '')}.json`)
      writeFileSync(p, body, 'utf-8')
      await expect(saveJsonSafe(p, { a: 1 })).rejects.toThrow(/not a JSON object|refusing to overwrite/)
      expect(readFileSync(p, 'utf-8')).toBe(body)
    })
  }
})
