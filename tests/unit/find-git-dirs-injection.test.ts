/**
 * A crafted directory name under an agent's workdir must execute NOTHING (TRDD-JIHK7SWH).
 *
 * `app/api/agents/[id]/repos/route.ts` used to build four shell command strings by
 * interpolating paths. Two of the interpolated values were never metacharacter-checked:
 * `resolvedWorkDir` (the blocklist ran on `workDir` BEFORE `realpathSync`) and
 * `resolvedRepoDir` (a directory name DISCOVERED by `find`, constrained by nothing).
 * `path.resolve` normalises a path; it does not escape a single shell character. So an
 * agent creating a directory with an embedded quote inside its OWN workdir got command
 * execution in the SERVER process — an escalation, since the server holds governance
 * state, the registry and AMP keys.
 *
 * THE POSITIVE CONTROL IS THE LOAD-BEARING TEST HERE. "No sentinel appeared" is equally
 * true when the fixture's name never reached anything at all, so this file first proves
 * the OLD shape DOES fire on this exact fixture, and only then asserts the new one does
 * not. Without that pair, both assertions pass against a directory name that was never
 * hostile and the file certifies nothing.
 *
 * The injected command only ever writes a sentinel inside the test's own temp dir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, execSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { findGitDirs } from '@/lib/find-git-dirs'

let root: string
let sentinel: string
/** The payload shape an agent could create in its own workdir. */
let hostileRepo: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'jihk7swh-'))
  sentinel = path.join(root, 'PWNED')
  // A name that closes the `"` the old command opened, runs a command, and reopens it.
  //
  // The payload writes a RELATIVE sentinel and both exec calls run with `cwd: root`.
  // An earlier draft interpolated the ABSOLUTE sentinel path into the directory name,
  // whose slashes made `mkdirSync` build a nested TREE instead of one hostile directory
  // — so the walk correctly found nothing and the failure looked like a bug in
  // `findGitDirs`. A directory name cannot contain a path separator; a fixture that
  // needs one is testing something other than what it claims.
  hostileRepo = path.join(root, 'x"; touch PWNED; echo "')
  mkdirSync(path.join(hostileRepo, '.git'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('a hostile directory name executes nothing (TRDD-JIHK7SWH)', () => {
  it('POSITIVE CONTROL — the OLD shell shape DOES fire on this fixture', () => {
    // If this ever stops passing, the fixture stopped being hostile and every other
    // assertion in this file became vacuous. It is not testing production code; it is
    // testing that the test has teeth.
    expect(existsSync(sentinel)).toBe(false)
    try {
      execSync(`git -C "${hostileRepo}" status --porcelain 2>/dev/null`, { encoding: 'utf-8', cwd: root })
    } catch {
      /* git itself fails; the injected `touch` has already run */
    }
    expect(existsSync(sentinel)).toBe(true)
  })

  it('the NEW execFileSync shape does not execute it', () => {
    expect(existsSync(sentinel)).toBe(false)
    try {
      execFileSync('git', ['-C', hostileRepo, '--no-optional-locks', 'status', '--porcelain'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      /* not a repo — irrelevant; what matters is that nothing was executed */
    }
    expect(existsSync(sentinel)).toBe(false)
  })

  it('findGitDirs discovers the hostile repo without a shell', () => {
    // The walk must still FIND it — a "fix" that simply stopped listing awkward names
    // would pass the assertion above while breaking the feature.
    const found = findGitDirs(root, 3)
    expect(found).toContain(path.join(hostileRepo, '.git'))
    expect(existsSync(sentinel)).toBe(false)
  })

  it('the ROUTE itself uses no shell — the link the behavioural tests above cannot make', () => {
    // The three tests above exercise the SHAPES, not the route, so every one of them
    // stays green if the route reverts to `execSync`. Without this assertion the file
    // proves that a safe pattern is safe and says nothing about whether the code under
    // discussion uses it — and the neuter for this fix would redden nothing at all.
    const src = readFileSync(path.join(__dirname, '..', '..', 'app/api/agents/[id]/repos/route.ts'), 'utf-8')
    expect(src).not.toMatch(/\bexecSync\b/)
    // A template literal containing `git ` is the exact shape that was vulnerable.
    expect(src).not.toMatch(/`[^`]*\bgit\b[^`]*\$\{/)
    // Positive control: the file really was read and really does invoke git.
    expect(src).toMatch(/execFileSync\('git'/)
  })

  it('findGitDirs respects maxDepth and does not descend into a matched .git', () => {
    // Pins the two behaviours carried over from `find -maxdepth 3 -name .git -type d`,
    // so the shell-removal stays a security fix and not a behaviour change.
    mkdirSync(path.join(root, 'a', 'b', 'c', 'd', '.git'), { recursive: true })
    mkdirSync(path.join(root, 'shallow', '.git'), { recursive: true })
    mkdirSync(path.join(root, 'shallow', '.git', 'modules', 'inner', '.git'), { recursive: true })
    const found = findGitDirs(root, 3)
    expect(found).toContain(path.join(root, 'shallow', '.git'))
    expect(found).not.toContain(path.join(root, 'a', 'b', 'c', 'd', '.git')) // too deep
    expect(found).not.toContain(path.join(root, 'shallow', '.git', 'modules', 'inner', '.git'))
  })
})
