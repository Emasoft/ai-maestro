import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { identifyFiles, diffIdentities, isFresh } from '@/lib/pillar/freshness'
import { listDocuments } from '@/lib/pillar/store'
import { TRDD_KIND } from '@/lib/pillar/kinds'

/**
 * TRDD-L55IYKL4 — per-file identity, the thing that makes index repair INCREMENTAL.
 *
 * The measured reason this module exists: a full-walk fallback costs ~37 s / 3.3 GB
 * at HALF the target corpus, so at 10⁵ the fallback IS the outage. Identity has to
 * be per file, and it has to be cheap — two git calls for the whole corpus, never
 * one per file.
 *
 * The failure direction that matters is asymmetric, and the tests are weighted to
 * it: identifying a CHANGED file as unchanged loses an edit silently, while
 * identifying an unchanged file as changed merely costs a re-index. Every test
 * below that could only fail in the safe direction says so.
 */

const REPO = process.cwd()
let tmp: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A throwaway repo — never touches the developer's global git config. */
function initRepo(dir: string): void {
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'user.email', 'test@example.invalid')
}

function commitAll(dir: string, msg: string): void {
  git(dir, 'add', '-A')
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freshness-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('identity on the LIVE corpus (positive control — without it every case below is vacuous)', () => {
  it('identifies every TRDD file, and the committed ones by git blob sha', () => {
    const files = TRDD_KIND.zones.flatMap((z) => listDocuments(path.join(REPO, 'design'), TRDD_KIND, z))
    expect(files.length).toBeGreaterThan(100)
    const ids = identifyFiles(files, path.join(REPO, 'design'))
    expect(ids.size).toBe(files.length)
    // The corpus is committed, so the overwhelming majority resolve through git.
    // Not `all`: a card edited in this working tree is correctly stat-identified.
    const gitCount = [...ids.values()].filter((v) => v.source === 'git').length
    expect(gitCount).toBeGreaterThan(files.length * 0.9)
  })

  it('a snapshot of the live corpus is FRESH against itself', () => {
    const files = listDocuments(path.join(REPO, 'design'), TRDD_KIND, 'tasks')
    const ids = identifyFiles(files, path.join(REPO, 'design'))
    const snap = new Map([...ids].map(([f, v]) => [f, v.id]))
    expect(isFresh(diffIdentities(snap, ids))).toBe(true)
  })
})

describe('the failure direction that loses data', () => {
  it('a tracked file MODIFIED in the working tree is NOT identified by its stale staged sha', () => {
    // Without the `git status` call this is the bug: `git ls-files -s` reports the
    // STAGED blob, so an edited file would look unchanged and the index would skip
    // it. A dirty working tree is the normal state while anyone is working.
    initRepo(tmp)
    const f = path.join(tmp, 'a.md')
    fs.writeFileSync(f, 'original\n')
    commitAll(tmp, 'init')

    const before = identifyFiles([f], tmp).get(f)!
    expect(before.source).toBe('git')

    fs.writeFileSync(f, 'EDITED\n')
    const after = identifyFiles([f], tmp).get(f)!
    expect(after.source).toBe('stat')
    expect(after.id).not.toBe(before.id)
  })

  it('rewriting a committed file with DIFFERENT content changes its identity', () => {
    initRepo(tmp)
    const f = path.join(tmp, 'a.md')
    fs.writeFileSync(f, 'one\n')
    commitAll(tmp, 'one')
    const first = identifyFiles([f], tmp).get(f)!.id
    fs.writeFileSync(f, 'two\n')
    commitAll(tmp, 'two')
    expect(identifyFiles([f], tmp).get(f)!.id).not.toBe(first)
  })

  it('a committed file whose content is UNCHANGED keeps its identity across a touch', () => {
    // The git form is content-exact, so a touch that moves mtime does not force a
    // re-index. Failing this only costs work; it is the safe direction.
    initRepo(tmp)
    const f = path.join(tmp, 'a.md')
    fs.writeFileSync(f, 'stable\n')
    commitAll(tmp, 'init')
    const first = identifyFiles([f], tmp).get(f)!.id
    const future = new Date(Date.now() + 10_000)
    fs.utimesSync(f, future, future)
    expect(identifyFiles([f], tmp).get(f)!.id).toBe(first)
  })
})

describe('paths git would QUOTE without -z', () => {
  it('a committed filename containing spaces is still matched by blob sha', () => {
    // Without `-z`, git quotes such a path and the parse yields a path that does not
    // exist — so the file silently falls through to stat. Same class as splitting
    // `git worktree list` on whitespace, and this corpus lives under GUI-named dirs.
    initRepo(tmp)
    const f = path.join(tmp, 'a file with spaces.md')
    fs.writeFileSync(f, 'x\n')
    commitAll(tmp, 'init')
    const got = identifyFiles([f], tmp).get(f)!
    expect(got.source).toBe('git')
  })
})

describe('corpora with no git answer at all', () => {
  it('a directory outside any repo identifies everything by stat, without throwing', () => {
    // Every LOCAL-scope corpus is in this case by design:
    // ~/.claude/projects/<slug>/design/ is deliberately outside the repo.
    const f = path.join(tmp, 'a.md')
    fs.writeFileSync(f, 'x\n')
    const got = identifyFiles([f], tmp).get(f)!
    expect(got.source).toBe('stat')
    expect(got.id).toMatch(/^stat:\d+:\d+$/)
  })

  it('an untracked file inside a repo is identified by stat', () => {
    initRepo(tmp)
    fs.writeFileSync(path.join(tmp, 'committed.md'), 'x\n')
    commitAll(tmp, 'init')
    const u = path.join(tmp, 'untracked.md')
    fs.writeFileSync(u, 'y\n')
    expect(identifyFiles([u], tmp).get(u)!.source).toBe('stat')
  })

  it('a file that vanished mid-pass is omitted rather than throwing', () => {
    // A concurrent `git mv` lifecycle transition is normal traffic on this corpus.
    const gone = path.join(tmp, 'never-existed.md')
    const ids = identifyFiles([gone], tmp)
    expect(ids.has(gone)).toBe(false)
  })
})

describe('diffIdentities', () => {
  const live = (m: Record<string, string>) =>
    new Map(Object.entries(m).map(([k, v]) => [k, { id: v, source: 'stat' as const }]))

  it('separates added, changed and removed', () => {
    const indexed = new Map([['a', '1'], ['b', '2'], ['c', '3']])
    const d = diffIdentities(indexed, live({ a: '1', b: 'CHANGED', d: '4' }))
    expect(d.added).toEqual(['d'])
    expect(d.changed).toEqual(['b'])
    expect(d.removed).toEqual(['c'])
    expect(isFresh(d)).toBe(false)
  })

  it('reports fresh only when nothing moved', () => {
    const indexed = new Map([['a', '1']])
    expect(isFresh(diffIdentities(indexed, live({ a: '1' })))).toBe(true)
  })

  it('an emptied corpus reports every file removed — never silently fresh', () => {
    const indexed = new Map([['a', '1'], ['b', '2']])
    const d = diffIdentities(indexed, live({}))
    expect(d.removed.sort()).toEqual(['a', 'b'])
    expect(isFresh(d)).toBe(false)
  })
})
