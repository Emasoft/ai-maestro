/**
 * The tripwire itself (TRDD-RYFP030K). A guard nobody has tripped is indistinguishable from a guard
 * that cannot trip — and this one's whole job is to fire in a situation that, by construction,
 * nobody is expecting. So it is exercised here against a TEMP path rather than the real
 * `~/.claude/settings.json`: the point is to prove the logic, not to reproduce the incident.
 *
 * The four cases are the four transitions the helper distinguishes, and it distinguishes them
 * because "created a file that should not exist" and "modified the user's config" are different
 * incidents with different clean-ups.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guardRealUserSettings, REAL_USER_SETTINGS } from '../helpers/real-home-untouched'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aim-guard-'))
  file = join(dir, 'settings.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('guardRealUserSettings', () => {
  it('passes when the file is untouched', async () => {
    await writeFile(file, '{"a":1}', 'utf-8')
    const check = guardRealUserSettings(file)
    expect(() => check()).not.toThrow()
  })

  it('passes when the file does not exist and still does not', () => {
    // ABSENT must not read as CHANGED, or the guard cries wolf in every suite that never had one.
    const check = guardRealUserSettings(file)
    expect(() => check()).not.toThrow()
  })

  it('FAILS, and says MODIFIED, when the bytes change', async () => {
    await writeFile(file, '{"a":1}', 'utf-8')
    const check = guardRealUserSettings(file)
    await writeFile(file, '{"a":1,"injected":true}', 'utf-8')
    // The byte counts are in the message on purpose: they are the first thing that tells a reader
    // whether a whole config was replaced or a key was appended.
    expect(() => check()).toThrow(/MODIFIED it \(7 → 23 bytes\)/)
  })

  it('FAILS, and says CREATED, when a file appears that was not there', async () => {
    const check = guardRealUserSettings(file)
    await writeFile(file, '{}', 'utf-8')
    expect(() => check()).toThrow(/CREATED it/)
  })

  it('FAILS, and says DELETED, when the file disappears', async () => {
    await writeFile(file, '{"a":1}', 'utf-8')
    const check = guardRealUserSettings(file)
    await unlink(file)
    expect(() => check()).toThrow(/DELETED it/)
  })

  it('names the real user settings path by default, so a caller cannot point it somewhere harmless by accident', () => {
    // The default is the whole value of the helper: a guard that has to be TOLD what to protect
    // gets pointed at a fixture and protects nothing.
    expect(REAL_USER_SETTINGS).toMatch(/\.claude[/\\]settings\.json$/)
    expect(REAL_USER_SETTINGS.startsWith('/')).toBe(true)
  })
})
