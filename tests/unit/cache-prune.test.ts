// TRDD-B8B6D56P — the absorbed cache-prune lane, ported line-faithful from the janitor's
// cache_prune.py. What each closure discriminates:
//
//  - isClaudeSession ports the janitor's own doc cases: basename-exact `claude` and the
//    versioned binary path match; `.claude` paths, `claude-plugins-validation`, and a python
//    argv ABOUT claude must NOT (substring matching is the documented trap).
//  - the CARDINAL SAFETY closure is the one this absorption exists to carry: a version dir
//    whose mtime is newer than (oldest live session start − margin) survives even when it is
//    far past the min-age floor — neutering the session term out of pruneCutoff reds exactly
//    this test.
//  - pinned protection uses SET semantics (janitor issue #137): BOTH of two records' versions
//    survive, not just the first.
//  - the lane test runs against a REAL tmp fixture tree (0-IMPACT: never the developer's
//    ~/.claude) with injected sessions/now/stamp, and pins stamp-on-attempt (called even when
//    a delete fails).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  isClaudeSession,
  parseEtimeSeconds,
  oldestClaudeSessionStart,
  pruneCutoff,
  planPluginPrune,
  pinnedVersionsFor,
  semverSorted,
  planCachePrune,
  runCachePrune,
} from '@/lib/cache-prune'

describe('isClaudeSession (ported doc cases)', () => {
  it('matches the launcher basename and the versioned binary path', () => {
    expect(isClaudeSession('claude --continue')).toBe(true)
    expect(isClaudeSession('/Users/x/.local/bin/claude -p hi')).toBe(true)
    expect(isClaudeSession('node /Users/x/.local/share/claude/versions/2.1.221/cli.js')).toBe(true)
  })
  it('never substring-matches claude', () => {
    expect(isClaudeSession('python3 /Users/x/.claude/plugins/cache/janitor/scripts/daemon.py')).toBe(false)
    expect(isClaudeSession('node build claude-plugins-validation')).toBe(false)
    expect(isClaudeSession('')).toBe(false)
  })
})

describe('parseEtimeSeconds', () => {
  it('parses mm:ss, hh:mm:ss, dd-hh:mm:ss', () => {
    expect(parseEtimeSeconds('05:33')).toBe(333)
    expect(parseEtimeSeconds('1:02:03')).toBe(3723)
    expect(parseEtimeSeconds('2-03:04:05')).toBe(183845)
  })
  it('unparseable → 0 (start ≈ now; the min-age floor still guards)', () => {
    expect(parseEtimeSeconds('garbage')).toBe(0)
  })
})

describe('pruneCutoff — the cardinal safety rule', () => {
  const now = 1_000_000
  it('with no live session, the min-age floor decides', () => {
    expect(pruneCutoff({ now, minAgeS: 7 * 86400, oldestSessionStart: null, sessionMarginS: 86400 })).toBe(
      now - 7 * 86400,
    )
  })
  it('a long-lived session pulls the cutoff BEHIND its start minus the margin', () => {
    const start = now - 10 * 86400 // 10-day session, older than the 7-day floor
    const cutoff = pruneCutoff({ now, minAgeS: 7 * 86400, oldestSessionStart: start, sessionMarginS: 86400 })
    expect(cutoff).toBe(start - 86400)
    // The consequence the rule exists for: a version 8 days old (past the floor) but loaded
    // by that session (mtime ≈ its start) is NOT prunable under this cutoff.
    const loadedMtime = start + 3600
    expect(loadedMtime < cutoff).toBe(false)
  })
  it('a young session never RAISES the cutoff above the floor (min semantics)', () => {
    const start = now - 3600
    expect(pruneCutoff({ now, minAgeS: 7 * 86400, oldestSessionStart: start, sessionMarginS: 86400 })).toBe(
      now - 7 * 86400,
    )
  })
})

describe('oldestClaudeSessionStart', () => {
  it('picks the oldest claude row and ignores non-claude rows', () => {
    const now = 500_000
    expect(
      oldestClaudeSessionStart(
        [
          { command: 'claude', etimeS: 1000 },
          { command: 'claude --continue', etimeS: 5000 },
          { command: 'python3 not-claude.py', etimeS: 99999 },
        ],
        now,
      ),
    ).toBe(now - 5000)
    expect(oldestClaudeSessionStart([{ command: 'vim', etimeS: 10 }], now)).toBeNull()
  })
})

describe('planPluginPrune', () => {
  const now = 1_000_000
  const versions = ['1.0.0', '1.1.0', '1.2.0', '1.3.0']
  it('keeps the newest N and EVERY pinned version (set semantics, issue #137)', () => {
    const { prune, keep } = planPluginPrune({
      versions,
      versionMtime: { '1.0.0': 1, '1.1.0': 1, '1.2.0': 1, '1.3.0': 1 },
      pinned: new Set(['1.0.0', '1.1.0']), // two records on two old versions — BOTH survive
      keepRecent: 1,
      cutoffEpoch: now,
      now,
    })
    expect(keep).toEqual(['1.0.0', '1.1.0', '1.3.0'])
    expect(prune).toEqual(['1.2.0'])
  })
  it('keeps anything at/after the cutoff and anything undateable', () => {
    const cutoff = 500
    const { prune, keep } = planPluginPrune({
      versions,
      versionMtime: { '1.0.0': 499, '1.1.0': 500 /* 1.2.0 undated */, '1.3.0': 1 },
      pinned: new Set(),
      keepRecent: 1, // protects 1.3.0 despite its old mtime
      cutoffEpoch: cutoff,
      now,
    })
    expect(prune).toEqual(['1.0.0'])
    expect(keep).toEqual(['1.1.0', '1.2.0', '1.3.0'])
  })
})

describe('pinnedVersionsFor', () => {
  const installed = {
    plugins: {
      'p@m': [
        { version: '0.64.1' },
        { installPath: '/x/cache/m/p/0.60.1/' },
        { path: '/x/cache/m/p/0.55.0' },
        { junk: true },
      ],
      'bare@m': { version: '1.2.3' },
      'bad@m': { version: 'not a version' },
    },
  }
  it('collects versions from field, installPath leaf, and legacy path leaf', () => {
    expect(pinnedVersionsFor(installed, 'p', 'm')).toEqual(new Set(['0.64.1', '0.60.1', '0.55.0']))
  })
  it('tolerates a bare-dict record and rejects non-semverish values', () => {
    expect(pinnedVersionsFor(installed, 'bare', 'm')).toEqual(new Set(['1.2.3']))
    expect(pinnedVersionsFor(installed, 'bad', 'm')).toEqual(new Set())
    expect(pinnedVersionsFor(null, 'p', 'm')).toEqual(new Set())
    expect(pinnedVersionsFor({ plugins: [] }, 'p', 'm')).toEqual(new Set())
  })
})

describe('semverSorted', () => {
  it('sorts numerically (0.9.0 < 0.10.0), non-digit names first', () => {
    expect(semverSorted(['0.10.0', '0.9.0', 'weird', '1.0.0-rc1', '1.0.0'])).toEqual([
      'weird',
      '0.9.0',
      '0.10.0',
      '1.0.0-rc1',
      '1.0.0',
    ])
  })
})

describe('the lane over a real fixture tree (0-IMPACT tmp dir)', () => {
  let root: string
  const now = 2_000_000_000
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-cache-prune-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function seed(market: string, plugin: string, version: string, mtimeS: number): string {
    const d = path.join(root, 'cache', market, plugin, version)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'plugin.json'), '{}')
    fs.utimesSync(d, mtimeS, mtimeS)
    return d
  }

  it('prunes only past-cutoff, unprotected versions; plan and delete agree', async () => {
    const old = now - 30 * 86400
    seed('m', 'p', '1.0.0', old)
    seed('m', 'p', '1.1.0', old)
    for (let i = 0; i < 5; i++) seed('m', 'p', `2.${i}.0`, now - 3600) // the newest 5, recent
    fs.mkdirSync(path.join(root, 'cache', 'm', 'empty-plugin'), { recursive: true })
    const stamps: string[] = []
    const r = await runCachePrune({
      cacheRoot: path.join(root, 'cache'),
      installedPluginsPath: path.join(root, 'installed_plugins.json'), // absent → {}
      sessions: async () => [{ command: 'claude', etimeS: 3600 }], // young session: floor decides
      now: () => now,
      stamp: () => stamps.push('cache-prune'),
    })
    expect(r.removed.sort()).toEqual(['m/p/1.0.0', 'm/p/1.1.0'])
    expect(r.failed).toEqual([])
    expect(fs.existsSync(path.join(root, 'cache', 'm', 'p', '2.0.0'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'cache', 'm', 'p', '1.0.0'))).toBe(false)
    expect(stamps).toEqual(['cache-prune'])
  })

  it('a pinned old version survives the same prune', async () => {
    const old = now - 30 * 86400
    seed('m', 'p', '1.0.0', old)
    for (let i = 0; i < 5; i++) seed('m', 'p', `2.${i}.0`, now - 3600)
    fs.writeFileSync(
      path.join(root, 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'p@m': [{ version: '1.0.0' }] } }),
    )
    const r = await runCachePrune({
      cacheRoot: path.join(root, 'cache'),
      installedPluginsPath: path.join(root, 'installed_plugins.json'),
      sessions: async () => [],
      now: () => now,
      stamp: () => {},
    })
    expect(r.removed).toEqual([])
    expect(fs.existsSync(path.join(root, 'cache', 'm', 'p', '1.0.0'))).toBe(true)
  })

  it('a LONG-LIVED session protects a version past the floor (the absorption safety box)', async () => {
    const sessionAge = 20 * 86400
    const loaded = now - sessionAge + 3600 // mtime ≈ the session's start: what it loaded
    seed('m', 'p', '1.0.0', loaded)
    for (let i = 0; i < 5; i++) seed('m', 'p', `2.${i}.0`, now - 3600)
    const r = await runCachePrune({
      cacheRoot: path.join(root, 'cache'),
      installedPluginsPath: path.join(root, 'installed_plugins.json'),
      sessions: async () => [{ command: 'claude --continue', etimeS: sessionAge }],
      now: () => now,
      stamp: () => {},
    })
    expect(r.removed).toEqual([]) // 20 days old, WAY past the 7-day floor — still protected
    expect(fs.existsSync(path.join(root, 'cache', 'm', 'p', '1.0.0'))).toBe(true)
  })

  it('stamps on ATTEMPT even when a delete fails (stamp = ownership, not success)', async () => {
    const old = now - 30 * 86400
    const doomed = seed('m', 'p', '1.0.0', old)
    for (let i = 0; i < 5; i++) seed('m', 'p', `2.${i}.0`, now - 3600)
    // Make the delete fail: replace the version DIR with a plain file after planning would
    // still see it… simplest deterministic failure: remove it and put a file at the path —
    // rmSync(force:false, recursive:true) on a FILE succeeds, so instead deny by nesting an
    // unwritable dir is unreliable under root. Use a non-dir plugin_dir trick: delete the
    // dir contents and the dir itself mid-flight is racy — so fail via a read-only PARENT.
    fs.rmSync(doomed, { recursive: true })
    fs.mkdirSync(doomed)
    fs.chmodSync(path.dirname(doomed), 0o555) // parent read-only: rmSync(child) fails, even for the plan
    const stamps: string[] = []
    let r
    try {
      r = await runCachePrune({
        cacheRoot: path.join(root, 'cache'),
        installedPluginsPath: path.join(root, 'installed_plugins.json'),
        sessions: async () => [],
        now: () => now,
        stamp: () => stamps.push('cache-prune'),
      })
    } finally {
      fs.chmodSync(path.dirname(doomed), 0o755)
    }
    // Under a root-privileged CI the chmod may not bite (the vacuous-permissions lesson) —
    // in that case the delete SUCCEEDS and the assertion below still holds either way for
    // the stamp; assert the failure branch only when it actually failed.
    if (r.failed.length > 0) expect(r.failed).toEqual(['m/p/1.0.0'])
    expect(stamps).toEqual(['cache-prune'])
  })
})

describe('planCachePrune non-vacuity', () => {
  it('an empty/missing root plans nothing (and does not throw)', () => {
    expect(planCachePrune('/nonexistent/path/xyz', {}, { keepRecent: 5, cutoffEpoch: 0, now: 0 })).toEqual([])
  })
})
