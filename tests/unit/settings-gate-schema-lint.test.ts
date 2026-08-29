/**
 * TRDD-TS4G74XA GAP B — spec step 4: the edited copy is linted, and the lint is NARROW.
 *
 * The narrowness is the whole design: there is no published claude-code settings schema, so the
 * lint checks only key paths this repo writes. The second test is the one that matters — it pins
 * that a pre-existing oddity in an UNRELATED key does not block an edit, which is the boundary
 * most likely to be widened by someone "improving" the check into a whole-file audit.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editSettings, SettingsSchemaError } from '@/lib/settings-gate'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'settings-lint-'))
  // `resolveSettingsPath` requires the parent directory to be named `.claude` — the fixture
  // satisfies the real gate rather than bypassing it.
  await mkdir(join(dir, '.claude'), { recursive: true })
  file = join(dir, '.claude', 'settings.json')
})
afterEach(async () => rm(dir, { recursive: true, force: true }))

describe('GAP B — post-edit schema lint', () => {
  it('a set writing an invalid value for a COVERED key fails, typed, with the file untouched', async () => {
    const before = JSON.stringify({ permissions: { deny: ['Bash(rm:*)'] } }, null, 2)
    await writeFile(file, before, 'utf-8')

    await expect(
      editSettings(file, [{ op: 'set', keyPath: ['permissions', 'deny'], value: 'not-an-array' }]),
    ).rejects.toBeInstanceOf(SettingsSchemaError)

    // No retry, and nothing written: the throw happens inside the mutator, before serialisation.
    expect(await readFile(file, 'utf-8')).toBe(before)
  })

  it('THE NARROWNESS BOUNDARY — a pre-existing oddity in an UNRELATED key does not block the edit', async () => {
    // `hooks` is nonsense here, and Claude Code may well reject it. It is not ours to police, and
    // policing it would brick an unrelated, valid edit. This is the assertion to read before
    // widening the lint.
    await writeFile(file, JSON.stringify({ hooks: 12345, permissions: { deny: [] } }), 'utf-8')

    const res = await editSettings(file, [
      { op: 'set', keyPath: ['permissions', 'deny'], value: ['Bash(curl:*)'] },
    ])

    expect(res.changed).toBe(true)
    const after = JSON.parse(await readFile(file, 'utf-8'))
    expect(after.permissions.deny).toEqual(['Bash(curl:*)'])
    expect(after.hooks).toBe(12345) // untouched, not "fixed"
  })

  it('an UNKNOWN key is not policed — we cannot validate what we do not define', async () => {
    await writeFile(file, '{}', 'utf-8')
    const res = await editSettings(file, [
      { op: 'set', keyPath: ['someFutureClaudeKey'], value: { anything: true } },
    ])
    expect(res.changed).toBe(true)
  })

  it('a delete is never schema-invalid — there is no value to check', async () => {
    await writeFile(file, JSON.stringify({ permissions: { deny: ['x'] } }), 'utf-8')
    const res = await editSettings(file, [{ op: 'delete', keyPath: ['permissions', 'deny'] }])
    expect(res.changed).toBe(true)
  })

  it('a VALID value for a covered key still commits (the lint is not a blanket refusal)', async () => {
    await writeFile(file, '{}', 'utf-8')
    const res = await editSettings(file, [
      { op: 'set', keyPath: ['extraKnownMarketplaces', 'acme'], value: { source: 'github' } },
    ])
    expect(res.changed).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf-8')).extraKnownMarketplaces.acme).toEqual({ source: 'github' })
  })
})
