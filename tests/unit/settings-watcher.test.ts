/**
 * The settings-ledger watcher (TRDD-MN0Q1IA2 items 8 + 9).
 *
 * Every test builds a REAL temp filesystem and injects it via `home`; nothing touches the
 * developer's `$HOME`. The EVENT SOURCE is injected too (`watchFn`), so no test waits on an
 * `fs.watch` callback — this suite already carries load-dependent timeouts, and a watcher test
 * that sleeps for an OS event would add noise to a signal people already discount. One test still
 * arms the REAL `fs.watch` to prove the default path works; it asserts on the armed set, not on
 * an event, so it cannot flake on timing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  fingerprintOf, classifyChange, changeToPatch, armSettingsWatchers, recordChange,
  SETTINGS_LEDGER_OP, DEFAULT_RESCAN_MS, type SettingsChange, type FileFingerprint,
} from '@/lib/settings-watcher'

let HOME: string

function writeGlobal(content: string): string {
  const dir = path.join(HOME, '.claude')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, content)
  return file
}

function makeAgent(name: string, content = '{}'): string {
  const dir = path.join(HOME, 'agents', name, '.claude')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, content)
  return file
}

/** A fake `fs.watch` that records what was armed and whether each watcher was closed. */
function fakeWatch() {
  const armed: { dir: string; closed: boolean }[] = []
  const fn = ((dir: string, _o: unknown, _cb: unknown) => {
    const rec = { dir: String(dir), closed: false }
    armed.push(rec)
    return { close() { rec.closed = true }, on() { /* no errors in the fake */ } } as unknown as fs.FSWatcher
  }) as unknown as typeof fs.watch
  return { fn, armed }
}

beforeEach(() => {
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'swatch-'))
  fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true })
})
afterEach(() => { fs.rmSync(HOME, { recursive: true, force: true }) })

/*
 * NEUTER RUNS (2026-08-07 — OBSERVED via scripts/dev/neuter, each restore verified by blob hash).
 * Three guards, three mutations, each reddening the test written for it:
 *
 *   1. s/if \(!known\.has\(t\.file\)\) known\.set\(…\)/known.set\(…\)/        → 1 red / 16 green
 *        does NOT re-seed a baseline on rescan — that would swallow the very edit it must record
 *
 *   2. s/…after: change\.after \} \}\]/…, content: fs.readFileSync\(change.file, "utf-8"\) } }]/
 *                                                                            → 2 red / 15 green
 *        NEVER puts file content in the ledger patch — fingerprints only     ← the intended pin
 *        renders add / replace / remove …                                    ← INCIDENTAL
 *      The second red is NOT a second independent pin and should not be read as one: that test
 *      uses the synthetic path `/f`, so the injected `readFileSync` throws ENOENT rather than
 *      leaking anything. Only the first red demonstrates the privacy invariant. Recorded because
 *      a raw "2 red" would overstate the coverage.
 *
 *   3. s/if \(before && after && before\.sha256 === after\.sha256\) return null/if \(false\) …/
 *                                                                            → 2 red / 15 green
 *        emits a change when content really moved, and stays silent when it did not
 *        reports NO change when the file was touched but its content is identical
 *      Both are genuine here — one drives the pure function, one drives it through the watcher.
 */
describe('settings watcher — pure core', () => {
  it('fingerprints a file, and returns null for one that is absent', () => {
    const f = writeGlobal('{"a":1}')
    const fp = fingerprintOf(f)
    expect(fp?.size).toBe(7)
    expect(fp?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprintOf(path.join(HOME, 'nope.json'))).toBeNull()
  })

  it('reports NO change when the file was touched but its content is identical', () => {
    // THE reason a digest exists. `fs.watch` fires on one logical save several times, and editors
    // rewrite files byte-identically; without this the ledger fills with duplicates of one save
    // and stops being readable — the same end state as recording nothing.
    const fp: FileFingerprint = { sha256: 'a'.repeat(64), size: 2 }
    expect(classifyChange('/x/settings.json', fp, { ...fp })).toBeNull()
  })

  it('classifies created / modified / deleted, and absent-to-absent as no change', () => {
    const a: FileFingerprint = { sha256: 'a'.repeat(64), size: 2 }
    const b: FileFingerprint = { sha256: 'b'.repeat(64), size: 3 }
    expect(classifyChange('/f', null, null)).toBeNull()
    expect(classifyChange('/f', null, a)?.kind).toBe('created')
    expect(classifyChange('/f', a, b)?.kind).toBe('modified')
    expect(classifyChange('/f', a, null)?.kind).toBe('deleted')
  })

  // THE PRIVACY INVARIANT. A settings file carries an `env` block and tokens, and the ledger is
  // signed and long-lived — so a patch that embedded content would republish the secret it exists
  // to protect. Asserting the SHAPE is not enough: this drives real content through and proves the
  // rendered patch cannot contain it.
  it('NEVER puts file content in the ledger patch — fingerprints only', () => {
    const secret = '{"env":{"ANTHROPIC_API_KEY":"sk-ant-SUPERSECRET-do-not-log"}}'
    const f = writeGlobal(secret)
    const after = fingerprintOf(f)!
    const change = classifyChange(f, { sha256: 'a'.repeat(64), size: 1 }, after)!
    const patch = JSON.stringify(changeToPatch(change))
    expect(patch).not.toContain('SUPERSECRET')
    expect(patch).not.toContain('ANTHROPIC_API_KEY')
    expect(patch).not.toContain('sk-ant')
    expect(patch).toContain(after.sha256)   // still actionable: the digest IS in there
  })

  it('renders add / replace / remove for created / modified / deleted', () => {
    const a: FileFingerprint = { sha256: 'a'.repeat(64), size: 2 }
    const b: FileFingerprint = { sha256: 'b'.repeat(64), size: 3 }
    expect(changeToPatch(classifyChange('/f', null, a)!)[0].op).toBe('add')
    expect(changeToPatch(classifyChange('/f', a, b)!)[0].op).toBe('replace')
    const del = changeToPatch(classifyChange('/f', a, null)!)[0]
    expect(del.op).toBe('remove')
    expect(del.path).toBe('/settings/f')
    // A `remove` carries no `value` at all — nothing to leak on the delete path either.
    expect(Object.keys(del)).toEqual(['op', 'path'])
  })

  it('declares its ledger op in the curated taxonomy', () => {
    // verify() does NOT enum-check `op`, so a bare string would still verify — and be invisible to
    // the audit tools that group by op, which is the only reason the taxonomy is curated.
    expect(SETTINGS_LEDGER_OP).toBe('change_settings_file')
  })
})

/*
 * NEUTER RUN (2026-08-07 — OBSERVED, restore verified by blob hash):
 *   s/changeToPatch\(change\), \{ authActor: 'system' \}/changeToPatch\(change\)/  → 1 red / 18 green
 *     appends the declared op, the file path, and the fingerprint patch as actor=system
 * i.e. dropping the actor reds exactly the test that asserts it. Worth pinning because an entry
 * with no actor is not merely less informative — `LedgerActor` is how an auditor separates a write
 * a human made from one the system observed, and an unlabelled entry silently joins neither group.
 */
describe('settings watcher — ledger seam', () => {
  function fakeLedger() {
    const calls: { op: string; path: string; diff: unknown; opts: unknown }[] = []
    const ledger = {
      async append(op: string, p: string, diff: unknown, opts?: unknown) {
        calls.push({ op, path: p, diff, opts }); return {}
      },
    }
    return { ledger: ledger as unknown as Parameters<typeof recordChange>[0], calls }
  }

  it('appends the declared op, the file path, and the fingerprint patch as actor=system', async () => {
    const f = writeGlobal('{"v":2}')
    const after = fingerprintOf(f)!
    const change = classifyChange(f, { sha256: 'a'.repeat(64), size: 1 }, after)!
    const { ledger, calls } = fakeLedger()
    await recordChange(ledger, change)
    expect(calls).toHaveLength(1)
    expect(calls[0].op).toBe('change_settings_file')
    expect(calls[0].path).toBe(f)
    // 'system' is the honest actor — the watcher observed a write it did not initiate. And there
    // must be NO authAgentId: inventing one attributes the write to an agent nobody observed.
    expect(calls[0].opts).toEqual({ authActor: 'system' })
  })

  it('carries no file content into the ledger call', async () => {
    const secret = '{"env":{"TOKEN":"tok-LEAKME-1234"}}'
    const f = writeGlobal(secret)
    const change = classifyChange(f, null, fingerprintOf(f)!)!
    const { ledger, calls } = fakeLedger()
    await recordChange(ledger, change)
    expect(JSON.stringify(calls[0])).not.toContain('LEAKME')
    expect(JSON.stringify(calls[0])).not.toContain('TOKEN')
  })
})

describe('settings watcher — arming', () => {
  it('arms ONE watcher per distinct directory, not per file', () => {
    writeGlobal('{}')
    fs.writeFileSync(path.join(HOME, '.claude', 'settings.local.json'), '{}')
    const { fn, armed } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: () => {}, rescanMs: 0, watchFn: fn })
    try {
      expect(h.armedDirs()).toEqual([path.join(HOME, '.claude')]) // two files, ONE directory
      expect(armed).toHaveLength(1)
    } finally { h.close() }
  })

  it('emits a change when content really moved, and stays silent when it did not', () => {
    const f = makeAgent('alpha', '{"v":1}')
    const dir = path.dirname(f)
    const seen: SettingsChange[] = []
    const { fn } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: c => seen.push(c), rescanMs: 0, watchFn: fn })
    try {
      h.onRawEvent(dir, 'settings.json')          // nothing changed yet
      expect(seen).toHaveLength(0)

      fs.writeFileSync(f, '{"v":2}')
      h.onRawEvent(dir, 'settings.json')
      expect(seen.map(c => c.kind)).toEqual(['modified'])

      h.onRawEvent(dir, 'settings.json')          // the second event of the same save
      expect(seen).toHaveLength(1)                // still one — the digest, not the event, decides
    } finally { h.close() }
  })

  it('survives an atomic rename-over, which is what the directory watch is FOR', () => {
    // saveJsonSafe writes `<path>.tmp.N` then renames over. A file-bound watcher would hold the
    // orphaned inode and report nothing forever; watching the DIR keeps working.
    const f = makeAgent('beta', '{"v":1}')
    const dir = path.dirname(f)
    const seen: SettingsChange[] = []
    const { fn } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: c => seen.push(c), rescanMs: 0, watchFn: fn })
    try {
      const tmp = `${f}.tmp.1`
      fs.writeFileSync(tmp, '{"v":9}')
      fs.renameSync(tmp, f)                        // new inode at the same path
      h.onRawEvent(dir, 'settings.json')
      expect(seen.map(c => c.kind)).toEqual(['modified'])
    } finally { h.close() }
  })

  it('checks every watched file in the directory when the platform gives no filename', () => {
    // fs.watch may hand back a null filename. Guessing would drop a write, which is unrecoverable;
    // re-hashing a few files costs microseconds.
    const f = makeAgent('gamma', '{"v":1}')
    const dir = path.dirname(f)
    const seen: SettingsChange[] = []
    const { fn } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: c => seen.push(c), rescanMs: 0, watchFn: fn })
    try {
      fs.writeFileSync(f, '{"v":2}')
      h.onRawEvent(dir, null)
      expect(seen.map(c => c.file)).toEqual([f])
    } finally { h.close() }
  })

  it('does NOT re-seed a baseline on rescan — that would swallow the very edit it must record', () => {
    // The subtle one. If rescan re-fingerprinted every known file, the pre-change baseline would be
    // replaced by the post-change value and the next event would compare equal — reporting nothing,
    // which is indistinguishable from a quiet file.
    const f = makeAgent('delta', '{"v":1}')
    const dir = path.dirname(f)
    const seen: SettingsChange[] = []
    const { fn } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: c => seen.push(c), rescanMs: 0, watchFn: fn })
    try {
      fs.writeFileSync(f, '{"v":2}')  // change lands BEFORE the rescan notices anything
      h.rescan()                      // must not adopt the new content as the baseline
      h.onRawEvent(dir, 'settings.json')
      expect(seen.map(c => c.kind)).toEqual(['modified'])
    } finally { h.close() }
  })

  it('picks up a directory that appears later, and drops one that goes away', () => {
    writeGlobal('{}')
    const { fn } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: () => {}, rescanMs: 0, watchFn: fn })
    try {
      expect(h.armedDirs()).toHaveLength(1)
      const late = makeAgent('epsilon')            // a new agent workdir appears
      h.rescan()
      expect(h.armedDirs()).toContain(path.dirname(late))
      expect(h.armedDirs()).toHaveLength(2)

      fs.rmSync(path.join(HOME, 'agents', 'epsilon'), { recursive: true, force: true })
      h.rescan()
      expect(h.armedDirs()).toHaveLength(1)        // and is disarmed when it vanishes
    } finally { h.close() }
  })

  it('a throwing consumer does not take the watcher down', () => {
    // One failed ledger append is a gap; a dead watcher is permanent blindness.
    const f = makeAgent('zeta', '{"v":1}')
    const dir = path.dirname(f)
    const calls: string[] = []
    const { fn } = fakeWatch()
    const h = armSettingsWatchers({
      home: HOME, rescanMs: 0, watchFn: fn,
      onChange: c => { calls.push(c.kind); throw new Error('ledger append failed') },
    })
    try {
      fs.writeFileSync(f, '{"v":2}')
      expect(() => h.onRawEvent(dir, 'settings.json')).not.toThrow()
      fs.writeFileSync(f, '{"v":3}')
      h.onRawEvent(dir, 'settings.json')
      expect(calls).toEqual(['modified', 'modified'])  // still delivering after the throw
    } finally { h.close() }
  })

  it('close() closes EVERY watcher and is idempotent', () => {
    // An fs watcher is an OS resource and this arms one per directory (27 on the live corpus).
    writeGlobal('{}')
    makeAgent('eta'); makeAgent('theta')
    const { fn, armed } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: () => {}, rescanMs: 0, watchFn: fn })
    expect(armed).toHaveLength(3)
    expect(armed.every(a => !a.closed)).toBe(true)
    h.close()
    expect(armed.every(a => a.closed)).toBe(true)
    expect(() => h.close()).not.toThrow()
    expect(h.armedDirs()).toEqual([])
  })

  it('ignores events after close instead of resurrecting itself', () => {
    const f = makeAgent('iota', '{"v":1}')
    const dir = path.dirname(f)
    const seen: SettingsChange[] = []
    const { fn } = fakeWatch()
    const h = armSettingsWatchers({ home: HOME, onChange: c => seen.push(c), rescanMs: 0, watchFn: fn })
    h.close()
    fs.writeFileSync(f, '{"v":2}')
    h.onRawEvent(dir, 'settings.json')
    h.rescan()
    expect(seen).toEqual([])
    expect(h.armedDirs()).toEqual([])
  })

  // POSITIVE CONTROL for the injected-watchFn tests above: they all drive a FAKE, so as a group
  // they would pass even if the DEFAULT path were broken. This one injects nothing.
  //
  // It is non-vacuous by construction: `armSettingsWatchers` records a directory only AFTER the
  // watch call returns, and a throwing call is caught and the directory skipped — so a correct
  // `armedDirs()` here can only mean the default callable really constructed a watcher on each
  // real directory, and that `close()` released them.
  //
  // WHAT IT DOES NOT PROVE, stated rather than implied: that the default is literally `fs.watch`.
  // `vi.spyOn(fs, 'watch')` cannot express that — an ESM namespace export is not configurable
  // ("Cannot redefine property: watch"), which is a limitation of the instrument, not of the
  // module. The type system carries the rest: `watchFn?: typeof fs.watch` with `?? fs.watch`.
  it('arms real watchers on real directories when nothing is injected, and releases them', () => {
    writeGlobal('{}')
    makeAgent('kappa')
    const h = armSettingsWatchers({ home: HOME, onChange: () => {}, rescanMs: 0 })
    try {
      expect(h.armedDirs()).toEqual(
        [path.join(HOME, '.claude'), path.join(HOME, 'agents', 'kappa', '.claude')].sort(),
      )
    } finally { h.close() }
    expect(h.armedDirs()).toEqual([])
  })

  it('exposes a re-scan default, because the target set is dynamic', () => {
    // Discovery costs ~54 MB of capped reads per scan on the live corpus, so the cadence is a real
    // trade, not a formality — a 30 s rescan would be ~6.5 GB/hour of disk reads.
    expect(DEFAULT_RESCAN_MS).toBe(300_000)
  })
})
