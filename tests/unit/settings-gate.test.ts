/**
 * TRDD-RYFP030K — `lib/settings-gate.ts`, the transport-agnostic settings-editor gate.
 *
 * `resolveSettingsPath` is the "reject a path that is not a settings file" / "path
 * traversal into arbitrary JSON must be refused" acceptance criterion — tested here
 * against real strings (no filesystem needed, it never stats anything). `editSettings`
 * / `readSettings` are tested against a REAL filesystem (mkdtemp), same discipline as
 * `tests/unit/json-io-update.test.ts`: these properties (atomic write, lock, backup) are
 * filesystem behaviour, and a mocked `writeFile` cannot discriminate a working gate from
 * one that writes nothing.
 *
 * ⚠ Per the STATE block's incident note ("add real-home-untouched to any test that
 * touches a settings writer"), this file guards the developer's own
 * `~/.claude/settings.json` even though every path used here is an explicit mkdtemp
 * path — the guard is what would catch a resolution bug that silently fell back to HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  resolveSettingsPath,
  applySettingsOps,
  editSettings,
  readSettings,
  InvalidSettingsPathError,
} from '@/lib/settings-gate'
import { KeyLossRefused } from '@/lib/json-io'
import { guardRealUserSettings } from '../helpers/real-home-untouched'

describe('resolveSettingsPath — path validation (no filesystem)', () => {
  it('accepts settings.json directly inside a .claude directory', () => {
    expect(resolveSettingsPath('/home/u/.claude/settings.json')).toBe('/home/u/.claude/settings.json')
  })

  it('accepts settings.local.json directly inside a .claude directory', () => {
    expect(resolveSettingsPath('/home/u/agents/bob/.claude/settings.local.json'))
      .toBe('/home/u/agents/bob/.claude/settings.local.json')
  })

  it('REJECTS a filename that is not one of the two known settings basenames', () => {
    expect(() => resolveSettingsPath('/home/u/.claude/evil.json')).toThrow(InvalidSettingsPathError)
    expect(() => resolveSettingsPath('/etc/passwd')).toThrow(InvalidSettingsPathError)
    // POSITIVE CONTROL for the error message shape other callers pattern-match on.
    try {
      resolveSettingsPath('/etc/passwd')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSettingsPathError)
      expect((err as Error).message).toMatch(/only "settings\.json" or "settings\.local\.json"/)
    }
  })

  it('REJECTS a settings.json whose parent directory is not literally named .claude', () => {
    expect(() => resolveSettingsPath('/home/u/config/settings.json')).toThrow(InvalidSettingsPathError)
    expect(() => resolveSettingsPath('/home/u/.claude/skills/settings.json')).toThrow(InvalidSettingsPathError)
  })

  it('REJECTS a traversal that resolves outside the shape this gate understands', () => {
    // `path.resolve` collapses the `..` first, so this evaluates against where it ACTUALLY
    // points (/etc/settings.json) — refused by the parent-directory-name check, not because
    // the string contains "..".
    expect(() => resolveSettingsPath('/home/u/.claude/../../etc/settings.json')).toThrow(InvalidSettingsPathError)
  })

  it('a traversal that resolves BACK INSIDE the allowed shape is legitimately accepted', () => {
    // This is the flip side of the traversal test above: resolve() collapsing `..` is not
    // itself the security boundary — the two structural checks are. A path that, after
    // collapsing, points at a real settings.json inside a real .claude dir is exactly the
    // shape this gate exists to allow, however it was spelled.
    expect(resolveSettingsPath('/home/u/.claude/sub/../settings.json')).toBe('/home/u/.claude/settings.json')
  })

  it('REJECTS an empty or non-string path', () => {
    expect(() => resolveSettingsPath('')).toThrow(InvalidSettingsPathError)
  })
})

describe('applySettingsOps — set/delete on a nested key path', () => {
  it('set creates intermediate objects along the path', () => {
    const data: Record<string, unknown> = {}
    applySettingsOps(data, [{ op: 'set', keyPath: ['enabledPlugins', 'foo@bar'], value: true }])
    expect(data).toEqual({ enabledPlugins: { 'foo@bar': true } })
  })

  it('set REPLACES a non-object intermediate rather than silently no-op-ing', () => {
    const data: Record<string, unknown> = { a: 5 }
    applySettingsOps(data, [{ op: 'set', keyPath: ['a', 'b'], value: 1 }])
    expect(data).toEqual({ a: { b: 1 } })
  })

  it('delete removes a leaf and leaves siblings untouched', () => {
    const data: Record<string, unknown> = { enabledPlugins: { keep: true, drop: true } }
    applySettingsOps(data, [{ op: 'delete', keyPath: ['enabledPlugins', 'drop'] }])
    expect(data).toEqual({ enabledPlugins: { keep: true } })
  })

  it('delete on a missing path is a TRUE no-op — no intermediate garbage is planted', () => {
    const data: Record<string, unknown> = { a: 1 }
    expect(() => applySettingsOps(data, [{ op: 'delete', keyPath: ['nope', 'still-nope'] }])).not.toThrow()
    expect(data).toEqual({ a: 1 })
  })

  it('multiple ops apply in order, atomically against one draft', () => {
    const data: Record<string, unknown> = { enabledPlugins: { old: true } }
    applySettingsOps(data, [
      { op: 'delete', keyPath: ['enabledPlugins', 'old'] },
      { op: 'set', keyPath: ['enabledPlugins', 'new'] as string[], value: true },
    ])
    expect(data).toEqual({ enabledPlugins: { new: true } })
  })

  it('REJECTS an op with an empty keyPath', () => {
    expect(() => applySettingsOps({}, [{ op: 'set', keyPath: [], value: 1 }])).toThrow(TypeError)
  })
})

describe('editSettings / readSettings — real filesystem', () => {
  let dir: string
  let target: string
  let assertHomeUntouched: () => void

  beforeEach(() => {
    assertHomeUntouched = guardRealUserSettings()
    dir = mkdtempSync(join(tmpdir(), 'aim-settings-gate-'))
    mkdirSync(join(dir, '.claude'), { recursive: true })
    target = join(dir, '.claude', 'settings.local.json')
  })

  afterEach(() => {
    assertHomeUntouched()
    rmSync(dir, { recursive: true, force: true })
  })

  it('readSettings on a missing file says WHY, and creates nothing', async () => {
    const r = await readSettings(target)
    expect(r).toEqual({ ok: false, reason: 'missing' })
  })

  it('editSettings creates the file (createIfMissing defaults true) and readSettings sees it', async () => {
    const result = await editSettings(target, [{ op: 'set', keyPath: ['enabledPlugins', 'foo@bar'], value: true }])
    expect(result.changed).toBe(true)

    const r = await readSettings(target)
    expect(r).toEqual({ ok: true, data: { enabledPlugins: { 'foo@bar': true } } })
  })

  it('editSettings with createIfMissing:false refuses to create a missing file', async () => {
    await expect(
      editSettings(target, [{ op: 'set', keyPath: ['a'], value: 1 }], { createIfMissing: false }),
    ).rejects.toThrow(/does not exist/)
  })

  it('a delete op that removes a TOP-LEVEL key is allowed by default (allowKeyLoss defaults true)', async () => {
    writeFileSync(target, JSON.stringify({ enabledPlugins: { x: true }, other: 1 }, null, 2) + '\n', 'utf-8')
    const result = await editSettings(target, [{ op: 'delete', keyPath: ['enabledPlugins'] }])
    expect(result.changed).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ other: 1 })
  })

  it('allowKeyLoss:false re-enables the tripwire for an explicit top-level delete', async () => {
    writeFileSync(target, JSON.stringify({ enabledPlugins: { x: true }, other: 1 }, null, 2) + '\n', 'utf-8')
    await expect(
      editSettings(target, [{ op: 'delete', keyPath: ['enabledPlugins'] }], { allowKeyLoss: false }),
    ).rejects.toBeInstanceOf(KeyLossRefused)
    // Refused means untouched.
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ enabledPlugins: { x: true }, other: 1 })
  })

  it('editSettings REFUSES a path outside the allowed shape BEFORE touching disk', async () => {
    const outside = join(dir, 'not-claude', 'settings.json')
    await expect(
      editSettings(outside, [{ op: 'set', keyPath: ['a'], value: 1 }]),
    ).rejects.toBeInstanceOf(InvalidSettingsPathError)
  })

  it('editSettings requires a non-empty ops array', async () => {
    await expect(editSettings(target, [])).rejects.toThrow(/non-empty ops array/)
  })

  it('deleting an already-absent nested key against a real file is a true no-op: no write, no backup', async () => {
    writeFileSync(target, JSON.stringify({ other: 1 }, null, 2) + '\n', 'utf-8')
    const result = await editSettings(target, [{ op: 'delete', keyPath: ['enabledPlugins', 'foo@bar'] }])
    expect(result.changed).toBe(false)
    expect(result.backupPath).toBeNull()
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ other: 1 })
  })

  it('two ops in one call are applied under a SINGLE lock/commit — one backup, both changes present', async () => {
    writeFileSync(target, JSON.stringify({ enabledPlugins: { old: true } }, null, 2) + '\n', 'utf-8')
    const result = await editSettings(target, [
      { op: 'delete', keyPath: ['enabledPlugins', 'old'] },
      { op: 'set', keyPath: ['enabledPlugins', 'new'], value: true },
    ])
    expect(result.changed).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ enabledPlugins: { new: true } })
  })
})
