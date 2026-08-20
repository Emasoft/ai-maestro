// TRDD-JBFM8XR0 — the absorbed fleet-plugins-update lane, ported line-faithful from the janitor's
// fleet_plugin_updates.py. What each closure pins (0-IMPACT: real tmp fixture trees, injected
// update/stamp doubles — never the developer's ~/.claude, never a real `claude` subprocess):
//
//  - THE FIX THE LANE EXISTS FOR: updateTarget passes cwd=<projectPath> to the CLI — the one
//    keyword the janitor module was written to add; neuter dropping `cwd` reds exactly that test;
//  - the enabled gate: value must be EXACTLY true; both id spellings (qualified + bare) match;
//  - enumerateTargets: scope filter, dead-path skip (fail-open = SKIP), dedupe, enabled gate;
//  - the sweep: cap is SAID (no silent caps), failures logged and counted, stamp on ATTEMPT
//    (even when every update fails);
//  - incident requirement 1/2 (no direct cache writes, no quarantine): the module contains NO fs
//    write primitive at all — pinned by a source scan with a positive control.

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  enabledPlugins,
  enumerateTargets,
  pluginIsEnabled,
  readRegistry,
  registryPath,
  runFleetPluginsUpdate,
  settingsPathFor,
  updateTarget,
  MAX_TARGETS_PER_SWEEP,
  type Target,
} from '@/lib/fleet-plugins-update'

function tmpProject(scope: 'local' | 'project', enabled: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpu-proj-'))
  const rel = scope === 'local' ? '.claude/settings.local.json' : '.claude/settings.json'
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), JSON.stringify({ enabledPlugins: enabled }))
  return dir
}

describe('registryPath — requirement 3 (explicit root resolution)', () => {
  it('anchors on the HOME dir, never on __dirname or cwd', () => {
    expect(registryPath()).toBe(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'))
  })
})

describe('enabledPlugins — the shared gate (value must be exactly true)', () => {
  it('reads only `=== true` entries; junk values and shapes yield []', () => {
    const dir = tmpProject('project', { 'a@m': true, 'b@m': 'true', 'c@m': 1, 'd@m': false })
    expect(enabledPlugins(path.join(dir, '.claude/settings.json'))).toEqual(['a@m'])
    expect(enabledPlugins(path.join(dir, 'missing.json'))).toEqual([])
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json')
    expect(enabledPlugins(path.join(dir, 'bad.json'))).toEqual([])
    fs.writeFileSync(path.join(dir, 'arr.json'), JSON.stringify({ enabledPlugins: ['a@m'] }))
    expect(enabledPlugins(path.join(dir, 'arr.json'))).toEqual([])
  })
})

describe('pluginIsEnabled — both spellings in the wild', () => {
  it('matches qualified, bare, and bare-with-other-marketplace; rejects strangers', () => {
    expect(pluginIsEnabled('tool@market', ['tool@market'])).toBe(true)
    expect(pluginIsEnabled('tool@market', ['tool'])).toBe(true)
    expect(pluginIsEnabled('tool@market', ['tool@other'])).toBe(true)
    expect(pluginIsEnabled('tool@market', ['other-tool'])).toBe(false)
  })
})

describe('enumerateTargets', () => {
  it('keeps only enabled local/project records whose projectPath is a live directory, deduped', () => {
    const live = tmpProject('local', { 'tool@m': true, 'off@m': false })
    const registry = {
      plugins: {
        'tool@m': [
          { scope: 'local', projectPath: live },
          { scope: 'local', projectPath: live }, // duplicate record → deduped
          // dead path → skip. NOTE (measured neuter, 2026-08-20): removing the catch's
          // `continue` reds NOTHING, because a non-directory project can never pass the
          // enabled gate either (its settings file cannot exist) — the directory filter is
          // DEFENSE IN DEPTH resting on that invariant, kept because the day enabledPlugins
          // grows a default-allow the filter becomes the only thing standing.
          { scope: 'local', projectPath: path.join(live, 'does-not-exist') },
          { scope: 'user' }, // wrong scope → skip
        ],
        'off@m': [{ scope: 'local', projectPath: live }], // disabled in settings → skip
        'ghost@m': [{ scope: 'project', projectPath: live }], // not in enabledPlugins → skip
      },
    }
    const targets = enumerateTargets(registry)
    expect(targets).toEqual([{ pluginId: 'tool@m', scope: 'local', projectPath: live }])
    expect(settingsPathFor(targets[0])).toBe(path.join(live, '.claude/settings.local.json'))
  })
  it('tolerates the single-record dict spelling and a malformed registry', () => {
    const live = tmpProject('project', { solo: true })
    expect(enumerateTargets({ plugins: { 'solo@m': { scope: 'project', projectPath: live } } })).toHaveLength(1)
    expect(enumerateTargets({})).toEqual([])
    expect(enumerateTargets({ plugins: 'junk' })).toEqual([])
  })
  it('readRegistry fails open to {} on a missing/garbage file', () => {
    expect(readRegistry('/nonexistent/registry.json')).toEqual({})
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fpu-reg-')), 'r.json')
    fs.writeFileSync(f, '[1,2]')
    expect(readRegistry(f)).toEqual({})
  })
})

describe('updateTarget — THE fix: cwd is the project', () => {
  it('spawns `claude plugin update <id> --scope <scope>` with cwd=<projectPath>', async () => {
    // A real subprocess, but a harmless one: a fake `claude` shim on PATH that prints its own
    // cwd — proving the option actually reaches the spawn (a mocked execFile would prove only
    // the mock). The shim exits 0, so `ok` is the CLI-contract half of the assertion.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fpu-bin-'))
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "argv:$@"\necho "cwd:$(pwd)"\n', { mode: 0o755 })
    const project = tmpProject('local', { 'tool@m': true })
    const prevPath = process.env.PATH
    process.env.PATH = `${bin}:${prevPath}`
    try {
      const r = await updateTarget({ pluginId: 'tool@m', scope: 'local', projectPath: project })
      expect(r.ok).toBe(true)
      expect(r.detail).toBe(`cwd:${fs.realpathSync(project)}`)
    } finally {
      process.env.PATH = prevPath
    }
  })
  it('a failing CLI yields ok=false with the last output line, never a throw', async () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fpu-bin-'))
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "boom: no such plugin" >&2\nexit 1\n', { mode: 0o755 })
    const project = tmpProject('local', { 'tool@m': true })
    const prevPath = process.env.PATH
    process.env.PATH = `${bin}:${prevPath}`
    try {
      const r = await updateTarget({ pluginId: 'tool@m', scope: 'local', projectPath: project })
      expect(r.ok).toBe(false)
      expect(r.detail).toContain('boom: no such plugin')
    } finally {
      process.env.PATH = prevPath
    }
  })
})

describe('runFleetPluginsUpdate — the sweep', () => {
  const t = (n: number): Target => ({ pluginId: `p${n}@m`, scope: 'local', projectPath: `/proj/${n}` })

  it('updates every target under the cap, logs failures, stamps on ATTEMPT even when all fail — and publishes the reload signal with exactly the updated ids', async () => {
    const logs: string[] = []
    const stamp = vi.fn()
    const signal = vi.fn()
    // trail MUST be injected in every sweep test: the default appender writes the
    // developer's REAL ~/.aimaestro (measured 2026-08-20 — 919 bytes of fixture rows
    // landed there before this spy existed; the recorded lesson, recurring).
    const trail = vi.fn()
    const r = await runFleetPluginsUpdate({
      targets: () => [t(1), t(2)],
      update: async (x) => (x.pluginId === 'p1@m' ? { ok: true, detail: '' } : { ok: false, detail: 'nope' }),
      stamp,
      signal,
      trail,
      log: (m) => {
        logs.push(m)
      },
    })
    expect(r).toEqual({ targets: 2, updated: ['p1@m'], failed: 1, capped: false })
    expect(stamp).toHaveBeenCalledTimes(1)
    expect(logs.some((l) => /p2@m @ \/proj\/2: FAILED nope/.test(l))).toBe(true)
    // the janitor-named reload contract: the sweep hands its updated set to the publisher
    expect(signal).toHaveBeenCalledWith(['p1@m'])
    // TRDD-MNN0VAS6: one trail row per INVOCATION, success and failure alike
    expect(trail).toHaveBeenCalledTimes(2)
    expect(trail.mock.calls.map((c) => [c[0].target, c[0].ok])).toEqual([['p1@m', true], ['p2@m', false]])
    expect(trail.mock.calls[0][0].by).toBe('fleet-plugins-update')

    const rAllFail = await runFleetPluginsUpdate({
      targets: () => [t(3)],
      update: async () => ({ ok: false, detail: 'x' }),
      stamp,
      signal,
      trail,
      log: () => {},
    })
    expect(rAllFail.updated).toEqual([])
    expect(stamp).toHaveBeenCalledTimes(2) // attempted ⇒ owned ⇒ stamped
    expect(signal).toHaveBeenLastCalledWith([]) // helper no-ops on [] — the file is untouched
  })

  it('a capped sweep SAYS so and stops at the cap (no silent truncation)', async () => {
    const logs: string[] = []
    const update = vi.fn(async () => ({ ok: true, detail: '' }))
    const many = Array.from({ length: 5 }, (_, i) => t(i))
    const r = await runFleetPluginsUpdate({
      targets: () => many,
      update,
      stamp: () => {},
      signal: () => {},
      trail: () => {},
      log: (m) => {
        logs.push(m)
      },
      maxTargets: 3,
    })
    expect(r.capped).toBe(true)
    expect(update).toHaveBeenCalledTimes(3)
    expect(logs.some((l) => /capped at 3\/5 targets — rest next pass/.test(l))).toBe(true)
    expect(MAX_TARGETS_PER_SWEEP).toBe(60) // the janitor's bound, kept verbatim
  })
})

describe('incident requirements 1+2 — the lane never writes a cache and never quarantines', () => {
  it('the module source contains no fs write/move/delete primitive (its mutation channels are exactly the CLI subprocess and the plugins-updated signal helper — whose one target is our own ~/.aimaestro state root, outside every cache and scanned tree)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../lib/fleet-plugins-update.ts'), 'utf8')
    const writers = /\bfs\.(writeFileSync|writeFile|appendFile|appendFileSync|renameSync|rename|rmSync|rm\b|rmdirSync|unlinkSync|unlink|mkdirSync|mkdir|cpSync|copyFileSync)\b/g
    expect(src.match(writers) ?? []).toEqual([])
    // positive control: the scanner sees a writer when one exists
    expect('fs.writeFileSync(p, s)'.match(writers)).toHaveLength(1)
  })
})

/*
 * NEUTER RUNS (2026-08-20 — OBSERVED via scripts/dev/neuter, restores verified by blob hash):
 *   s/ *;\(deps\.signal \?\? writePluginsUpdatedSignal\)\(updated\)/(neutered)/  (lib/fleet-plugins-update.ts)
 *   → 1 red / 11 green: "updates every target under the cap … and publishes the reload signal"
 *   s/if \(updated\.length === 0\) return/if (false) return/  (lib/plugins-updated-signal.ts)
 *   → 1 red / 11 green: "publishes the exact shape atomically, and an empty sweep never touches the file"
 */
describe('writePluginsUpdatedSignal — the janitor-named reload contract', () => {
  it('publishes the exact shape atomically, and an empty sweep never touches the file', async () => {
    const { writePluginsUpdatedSignal } = await import('@/lib/plugins-updated-signal')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpu-signal-'))
    const dest = path.join(dir, 'state', 'plugins-updated.json')
    writePluginsUpdatedSignal([], 1_787_179_701_000, dest)
    expect(fs.existsSync(dest)).toBe(false) // empty sweep = no write (consumer semantics)
    // the sweep's list is per-TARGET (duplicates when one plugin is installed in N projects);
    // the published field means "which plugins changed" — deduped at this boundary
    writePluginsUpdatedSignal(['a@m', 'a@m', 'b@m'], 1_787_179_701_000, dest)
    expect(JSON.parse(fs.readFileSync(dest, 'utf8'))).toEqual({
      updated_at_epoch: 1_787_179_701, // SECONDS, not ms — the consumer compares epochs
      updated: ['a@m', 'b@m'],
      by: 'fleet-plugins-update',
      count: 2,
    })
    // no half-written residue: the temp file was renamed away
    expect(fs.readdirSync(path.dirname(dest)).filter((f) => f.includes('.tmp.'))).toEqual([])
  })
})
