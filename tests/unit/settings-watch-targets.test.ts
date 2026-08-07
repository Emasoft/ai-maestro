/**
 * Discovery for the settings-ledger watcher (TRDD-MN0Q1IA2 items 8 + 9).
 *
 * Every test builds a REAL temp filesystem and injects it via `home`. Nothing here touches the
 * developer's `$HOME` — and that is not politeness: the module's whole job is to enumerate
 * `~/.claude` and `~/agents`, so a test that used the real one would both read private state and
 * produce assertions that differ per machine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  cwdFromTranscript, decodeProjectCwds, discoverSettingsTargets, watchDirs,
  SETTINGS_BASENAMES, BYTE_BUDGET,
} from '@/lib/settings-watch-targets'

let HOME: string

/** A workspace with a `.claude/` holding the named settings files. */
function makeWorkdir(abs: string, files: readonly string[]): string {
  fs.mkdirSync(path.join(abs, '.claude'), { recursive: true })
  for (const f of files) fs.writeFileSync(path.join(abs, '.claude', f), '{}')
  return abs
}

/**
 * A `~/.claude/projects/<slug>/` transcript dir. `cwd: null` writes lines carrying no cwd.
 * `name` lets one slug hold SEVERAL transcripts — the real shape when a worktree session is filed
 * under its parent project — and the call is idempotent on the directory itself.
 */
function makeProjectDir(
  slug: string,
  cwd: string | null,
  opts: { lines?: number; noJsonl?: boolean; name?: string } = {},
): string {
  const dir = path.join(HOME, '.claude', 'projects', slug)
  fs.mkdirSync(dir, { recursive: true })
  if (opts.noJsonl) return dir
  const pad = opts.lines ?? 0
  const rows: string[] = []
  for (let i = 0; i < pad; i++) rows.push(JSON.stringify({ type: 'noise', i }))
  if (cwd !== null) rows.push(JSON.stringify({ type: 'user', cwd }))
  fs.writeFileSync(path.join(dir, opts.name ?? 'session.jsonl'), rows.join('\n'))
  return dir
}

beforeEach(() => {
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'swt-'))
  fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true })
})
afterEach(() => { fs.rmSync(HOME, { recursive: true, force: true }) })

describe('settings watch-target discovery', () => {
  it('returns dir + basename, NEVER a file path to hand to fs.watch', () => {
    fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}')
    const [t] = discoverSettingsTargets({ home: HOME })
    // THE contract. `fs.watch` on a FILE binds the inode, so the first atomic rename-over orphans
    // the watcher: it reports nothing forever while the file keeps changing. A caller must be able
    // to arm the DIRECTORY, so `dir` must be the containing dir and not the file itself.
    expect(t.dir).toBe(path.join(HOME, '.claude'))
    expect(t.basename).toBe('settings.json')
    expect(t.dir).not.toBe(t.file)
    expect(path.join(t.dir, t.basename)).toBe(t.file)
  })

  it('finds both global settings files, and skips the one that does not exist', () => {
    fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}')
    const one = discoverSettingsTargets({ home: HOME })
    expect(one.map(t => t.basename)).toEqual(['settings.json'])

    fs.writeFileSync(path.join(HOME, '.claude', 'settings.local.json'), '{}')
    const two = discoverSettingsTargets({ home: HOME })
    expect(two.map(t => t.basename).sort()).toEqual([...SETTINGS_BASENAMES].sort())
    expect(two.every(t => t.source === 'global')).toBe(true)
  })

  it('finds settings in every agent workdir', () => {
    makeWorkdir(path.join(HOME, 'agents', 'alpha'), ['settings.json'])
    makeWorkdir(path.join(HOME, 'agents', 'beta'), ['settings.json', 'settings.local.json'])
    const t = discoverSettingsTargets({ home: HOME })
    expect(t.filter(x => x.source === 'agent-workdir')).toHaveLength(3)
  })

  it('decodes a project workdir from the transcript cwd, not from the slug', () => {
    // The slug cannot be un-mangled: every non-alphanumeric maps to `-`, so a path containing a
    // REAL `-` is unrecoverable. This workdir has one, so a slug-decoder would resolve it wrongly.
    const wd = makeWorkdir(path.join(HOME, 'Code', 'my-project'), ['settings.json'])
    makeProjectDir('-Users-x-Code-my-project', wd)
    const t = discoverSettingsTargets({ home: HOME })
    const hit = t.find(x => x.source === 'project-cwd')
    expect(hit?.file).toBe(path.join(wd, '.claude', 'settings.json'))
  })

  // NEUTER RUN (2026-08-07, OBSERVED): restoring `if (cwd) { found.add(cwd); break }` in
  // decodeProjectCwds reds THIS test and only this one — the discovery half returns [root] and the
  // worktree's settings file never becomes a target. That is the whole defect: with the break,
  // which cwd survives is decided by FILENAME SORT ORDER. `b-` sorts after `a-`, so the worktree is
  // the one silently dropped; naming it `a-` would have hidden the bug behind a passing test.
  it('collects EVERY cwd in a project dir — a worktree session is filed under its parent project', () => {
    const root = makeWorkdir(path.join(HOME, 'Code', 'repo'), ['settings.json'])
    const wt = makeWorkdir(path.join(HOME, 'Code', 'repo', '.claude', 'worktrees', 'wt-1'), ['settings.json'])
    makeProjectDir('-Users-x-Code-repo', root, { name: 'a-session.jsonl' })
    makeProjectDir('-Users-x-Code-repo', wt, { name: 'b-session.jsonl' })

    expect(decodeProjectCwds(path.join(HOME, '.claude', 'projects'))).toEqual([root, wt])

    // The consequence that actually matters to the ledger: BOTH settings files are watched.
    const files = discoverSettingsTargets({ home: HOME }).map(t => t.file)
    expect(files).toContain(path.join(root, '.claude', 'settings.json'))
    expect(files).toContain(path.join(wt, '.claude', 'settings.json'))
  })

  // The measurement that closed this card's open caveat: 49 of 97 project dirs have NO .jsonl at
  // all. Treating those as "undecodable" is what inflated the corpus estimate to ~100 files.
  it('treats a project dir with no .jsonl as ABSENT, not undecodable', () => {
    makeProjectDir('-empty-one', null, { noJsonl: true })
    expect(decodeProjectCwds(path.join(HOME, '.claude', 'projects'))).toEqual([])
  })

  it('reads a BYTE-bounded prefix — capped I/O, not a capped parse', () => {
    const wd = makeWorkdir(path.join(HOME, 'Code', 'deep'), ['settings.json'])
    // ~2000 noise lines puts `cwd` far past the first handful but well inside 512 KiB — the
    // realistic shape, and the default budget must still find it. (The earlier LINE cap sat on top
    // of a full-file read, so it bounded parsing and not I/O; see the module's BYTE_BUDGET note,
    // including the misdiagnosis that prompted the change.)
    makeProjectDir('-deep', wd, { lines: 2000 })
    expect(decodeProjectCwds(path.join(HOME, '.claude', 'projects'))).toEqual([wd])

    // And the bound is REAL: with a budget too small to reach it, the same file yields nothing.
    // Without this half, the assertion above would pass even if the budget were ignored entirely.
    const jl = path.join(HOME, '.claude', 'projects', '-deep', 'session.jsonl')
    expect(cwdFromTranscript(jl, 256)).toBeNull()
    expect(cwdFromTranscript(jl, BYTE_BUDGET)).toBe(wd)
  })

  it('survives a malformed transcript line instead of throwing', () => {
    const wd = makeWorkdir(path.join(HOME, 'Code', 'partial'), ['settings.json'])
    const dir = path.join(HOME, '.claude', 'projects', '-partial')
    fs.mkdirSync(dir, { recursive: true })
    // A half-written final line is normal for a session still in progress.
    fs.writeFileSync(path.join(dir, 'session.jsonl'),
      `{"type":"noise"}\n{"broken":\n${JSON.stringify({ cwd: wd })}`)
    expect(decodeProjectCwds(path.join(HOME, '.claude', 'projects'))).toEqual([wd])
  })

  it('drops a decoded cwd whose workdir no longer exists', () => {
    makeProjectDir('-gone', path.join(HOME, 'Code', 'deleted-project'))
    // The set is DYNAMIC — 8 of 46 decoded cwds were already gone when measured. A stale entry
    // must not become a watch target, or the watcher arms a directory that isn't there.
    expect(discoverSettingsTargets({ home: HOME }).filter(t => t.source === 'project-cwd')).toEqual([])
  })

  it('watches a workdir ONCE when it is both an agent dir and a decoded cwd', () => {
    const wd = makeWorkdir(path.join(HOME, 'agents', 'dual'), ['settings.json'])
    makeProjectDir('-dual', wd)
    const t = discoverSettingsTargets({ home: HOME })
    expect(t.filter(x => x.file === path.join(wd, '.claude', 'settings.json'))).toHaveLength(1)
    // It survives under the EARLIER source, so a per-source tally reads lower than a raw
    // filesystem count — which is what I briefly misread as missing coverage. Pin the label.
    expect(t.find(x => x.file === path.join(wd, '.claude', 'settings.json'))?.source)
      .toBe('agent-workdir')
  })

  // The collision that is easiest to misread, because the file is real and appears exactly once:
  // a session whose cwd IS $HOME decodes to a `.claude/settings.json` that IS the global file.
  it('dedupes a decoded cwd of $HOME against the global target', () => {
    fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}')
    makeProjectDir('-home', HOME)
    const t = discoverSettingsTargets({ home: HOME })
    const hits = t.filter(x => x.file === path.join(HOME, '.claude', 'settings.json'))
    expect(hits).toHaveLength(1)
    expect(hits[0].source).toBe('global')
  })

  // THE INVARIANT the misdiagnosis should have been checked against: dedupe may relabel a target,
  // never drop one. A per-source count can fall; total coverage cannot.
  it('dedupe relabels but never drops — every discovered settings file is still covered', () => {
    const dual = makeWorkdir(path.join(HOME, 'agents', 'dual'), ['settings.json'])
    const solo = makeWorkdir(path.join(HOME, 'Code', 'solo'), ['settings.json'])
    makeProjectDir('-dual', dual)
    makeProjectDir('-solo', solo)
    const files = new Set(discoverSettingsTargets({ home: HOME }).map(x => x.file))
    for (const wd of [dual, solo]) {
      expect(files.has(path.join(wd, '.claude', 'settings.json'))).toBe(true)
    }
  })

  it('collapses targets to distinct directories to arm', () => {
    makeWorkdir(path.join(HOME, 'agents', 'a'), ['settings.json', 'settings.local.json'])
    const t = discoverSettingsTargets({ home: HOME })
    expect(t).toHaveLength(2)
    expect(watchDirs(t)).toHaveLength(1) // two files, ONE directory to watch
  })

  it('returns empty — never throws — when the roots do not exist at all', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'swt-bare-'))
    try { expect(discoverSettingsTargets({ home: bare })).toEqual([]) }
    finally { fs.rmSync(bare, { recursive: true, force: true }) }
  })

  // POSITIVE CONTROL for the whole suite: without it every `toEqual([])` above passes if discovery
  // is broken and returns nothing for ANY reason — which is exactly what a dead scanner does.
  it('finds all three source kinds together', () => {
    fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}')
    makeWorkdir(path.join(HOME, 'agents', 'ag'), ['settings.json'])
    const wd = makeWorkdir(path.join(HOME, 'Code', 'proj'), ['settings.json'])
    makeProjectDir('-proj', wd)
    const t = discoverSettingsTargets({ home: HOME })
    expect(t.map(x => x.source).sort()).toEqual(['agent-workdir', 'global', 'project-cwd'])
  })
})
