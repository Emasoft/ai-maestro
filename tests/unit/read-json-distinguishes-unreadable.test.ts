/**
 * TRDD-K71FV649 — a JSON read must say WHY it has no data.
 *
 * `loadJsonSafe` answers `{}` to two different questions: "the file is not there" and "the file is
 * there and does not parse". Every verification built on it therefore reads UNREADABLE as ABSENT —
 * which is what kept `InstallElement`'s PG01 outside its R51 window and `ChangePlugin`'s G11
 * un-promoted, because in both an aborting check would have destroyed correct state on the strength
 * of a file it could not read.
 *
 * ⚠ SEEDS BOTH FAILING CASES, NOT JUST THE CORRUPT ONE. A test that only feeds a corrupt file
 * passes on a reader that fails for EVERYTHING, including the missing file whose `{}` default every
 * write path in the service depends on. The assertion that matters is that the two answers DIFFER.
 *
 * Real files in a real tmp dir, no fs mocks: the behaviour under test IS the filesystem's, and a
 * mocked `readFile` would be asserting the mock.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'k71fv649-'))
  await writeFile(join(dir, 'valid.json'), JSON.stringify({ enabledPlugins: { 'a@b': true } }), 'utf-8')
  // Truncated mid-write — the exact shape a torn or partially-written settings file has.
  await writeFile(join(dir, 'corrupt.json'), '{ "enabledPlugins": { "a@b": tr', 'utf-8')
})

afterAll(async () => {
  // The suite that leaves files behind is a bug this repo has already paid for.
  await rm(dir, { recursive: true, force: true })
})

describe('readJson — "not there" and "does not parse" are different answers', () => {
  it('a MISSING file reports `missing` — the case whose {} default the write paths depend on', async () => {
    const { readJson } = await import('@/lib/json-io')
    const read = await readJson(join(dir, 'nope.json'))
    expect(read.ok).toBe(false)
    expect(read.ok === false && read.reason).toBe('missing')
  })

  it('an UNREADABLE file reports `unreadable`, carrying the parse error', async () => {
    const { readJson } = await import('@/lib/json-io')
    const read = await readJson(join(dir, 'corrupt.json'))
    expect(read.ok).toBe(false)
    expect(read.ok === false && read.reason).toBe('unreadable')
    expect(read.ok === false && read.error).toBeTruthy()
  })

  it('THE DISTINCTION — the two failures do not answer the same thing', async () => {
    const { readJson } = await import('@/lib/json-io')
    const missing = await readJson(join(dir, 'nope.json'))
    const corrupt = await readJson(join(dir, 'corrupt.json'))
    // A reader that collapses them (or that fails for everything) makes this equal.
    expect(missing.ok === false && missing.reason).not.toBe(corrupt.ok === false && corrupt.reason)
  })

  it('POSITIVE CONTROL — a valid file still parses, so the failures above are not universal', async () => {
    const { readJson } = await import('@/lib/json-io')
    const read = await readJson(join(dir, 'valid.json'))
    expect(read.ok).toBe(true)
    expect(read.ok === true && read.data.enabledPlugins).toEqual({ 'a@b': true })
  })

  it('loadJsonSafe keeps its lenient contract for BOTH failures — every write path depends on it', async () => {
    // Asserted on the REAL function now that `lib/json-io` owns it (TRDD-CS25TA6W). The earlier
    // version could only assert the contract indirectly, because the lenient reader was private to
    // the service — so it checked that the symbol was absent, which is a claim about MODULE SHAPE
    // and would have stayed green through any change to what the function actually returns.
    const { loadJsonSafe } = await import('@/lib/json-io')
    for (const f of ['nope.json', 'corrupt.json']) {
      expect(await loadJsonSafe(join(dir, f))).toEqual({})
    }
    // …and it is DERIVED, not parallel: the valid file's data comes back unchanged.
    expect(await loadJsonSafe(join(dir, 'valid.json'))).toEqual({ enabledPlugins: { 'a@b': true } })
  })
})
