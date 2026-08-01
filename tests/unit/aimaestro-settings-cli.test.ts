/**
 * TRDD-RYFP030K — `scripts/aimaestro-settings.sh` end-to-end, in a REAL subprocess.
 *
 * This exercises the ACTUAL deliverable: the bash wrapper's ROOT-resolution (sibling
 * check, same technique measured on `scripts/pillar-cli` in
 * `tests/unit/pillar-cli-env.test.ts`), `pin-node.sh`, the tsx loader, and
 * `scripts/aimaestro-settings-cli.mjs` calling `lib/settings-gate.ts` in-process. A
 * subprocess is required, not an in-process import: the whole point of this CLI is that
 * it works with the ai-maestro SERVER down, and the fastest way to prove "no HTTP call is
 * involved" is to spawn it with nothing listening on :23000.
 *
 * Every invocation targets an explicit mkdtemp path, never `$HOME` — so this suite could
 * not touch the developer's real `~/.claude/settings.json` even on a resolution bug, but
 * `guardRealUserSettings()` is kept anyway (same discipline as every other test file
 * touching this gate) so a FUTURE regression that silently defaults to HOME is caught
 * loudly rather than corrupting a real config in CI.
 */
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { guardRealUserSettings } from '../helpers/real-home-untouched'

const REPO = path.resolve(__dirname, '..', '..')
const CLI = path.join(REPO, 'scripts', 'aimaestro-settings.sh')

function run(args: string[]): { code: number | null; out: unknown; rawOut: string; err: string } {
  const r = spawnSync('bash', [CLI, ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    timeout: 120_000,
  })
  const rawOut = r.stdout ?? ''
  let out: unknown
  try { out = JSON.parse(rawOut) } catch { out = undefined }
  return { code: r.status, out, rawOut, err: r.stderr ?? '' }
}

let dir: string
let target: string
let assertHomeUntouched: () => void

beforeEach(() => {
  assertHomeUntouched = guardRealUserSettings()
  dir = mkdtempSync(path.join(tmpdir(), 'aim-settings-cli-'))
  mkdirSync(path.join(dir, '.claude'), { recursive: true })
  target = path.join(dir, '.claude', 'settings.local.json')
})

afterEach(() => {
  assertHomeUntouched()
  rmSync(dir, { recursive: true, force: true })
})

describe('aimaestro-settings.sh (subprocess, no HTTP)', () => {
  it('get on a missing file exits 1 and reports reason:missing', () => {
    const r = run(['get', target])
    expect(r.code).toBe(1)
    expect(r.out).toEqual({ ok: false, reason: 'missing' })
  })

  it('set --key <dot.path> --value <json> creates the file; get then reads it back', () => {
    const s = run(['set', target, '--key', 'enabledPlugins.foo@bar', '--value', 'true'])
    expect(s.code).toBe(0)
    expect((s.out as { success: boolean }).success).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ enabledPlugins: { 'foo@bar': true } })

    const g = run(['get', target])
    expect(g.code).toBe(0)
    expect(g.out).toEqual({ ok: true, data: { enabledPlugins: { 'foo@bar': true } } })
  })

  it('--value parses JSON when it is JSON, and falls back to the raw string otherwise', () => {
    run(['set', target, '--key', 'a', '--value', '42'])
    run(['set', target, '--key', 'b', '--value', 'plain-string'])
    run(['set', target, '--key', 'c', '--value', '{"nested":true}'])
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ a: 42, b: 'plain-string', c: { nested: true } })
  })

  it('delete --key removes exactly the named key and leaves siblings', () => {
    run(['set', target, '--key', 'enabledPlugins.keep', '--value', 'true'])
    run(['set', target, '--key', 'enabledPlugins.drop', '--value', 'true'])
    const d = run(['delete', target, '--key', 'enabledPlugins.drop'])
    expect(d.code).toBe(0)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ enabledPlugins: { keep: true } })
  })

  it('--key-json handles a key containing a literal dot, which --key cannot express', () => {
    run(['set', target, '--key-json', '["enabledPlugins","name.with.dots@marketplace"]', '--value', 'true'])
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({
      enabledPlugins: { 'name.with.dots@marketplace': true },
    })
  })

  it('edit --ops applies multiple ops under one lock/commit', () => {
    run(['set', target, '--key', 'enabledPlugins.old', '--value', 'true'])
    const e = run(['edit', target, '--ops', JSON.stringify([
      { op: 'delete', keyPath: ['enabledPlugins', 'old'] },
      { op: 'set', keyPath: ['enabledPlugins', 'new'], value: true },
    ])])
    expect(e.code).toBe(0)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ enabledPlugins: { new: true } })
  })

  it('--no-create refuses to create a missing file', () => {
    const r = run(['set', target, '--key', 'a', '--value', '1', '--no-create'])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/does not exist/)
  })

  it('REJECTS a path that is not a settings file, before touching disk', () => {
    const evil = path.join(dir, '.claude', 'evil.json')
    const r = run(['get', evil])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/refusing to edit/)
    expect(r.err).toMatch(/only "settings\.json" or "settings\.local\.json"/)
  })

  it('help exits 0 and names every command', () => {
    const r = run(['help'])
    expect(r.code).toBe(0)
    for (const cmd of ['get', 'set', 'delete', 'edit']) expect(r.rawOut).toContain(cmd)
  })

  it('an unknown command exits 1 with a clear error', () => {
    const r = run(['bogus', target])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/unknown command "bogus"/)
  })
})
