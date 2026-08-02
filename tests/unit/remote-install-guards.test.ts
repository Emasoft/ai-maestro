import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync, mkdtempSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The two pure guards inside `scripts/remote-install.sh` (TRDD-95IKXQI6).
 *
 * WHY THIS FILE EXISTS: the card's Verification says *"`_normalize_repo_url` / `_version_gt`
 * isolated logic tests → all cases correct ✓"*. Those tests were ad hoc and are gone; nothing in
 * the tree pinned either function. `_version_gt` IS the downgrade guard the USER's mandate asked
 * for by name (*"watch out for installing a previous version on a new version by error"*), and its
 * failure mode is SILENT: a broken comparison does not error, it just lets the older version
 * install over the newer one.
 *
 * WHY IT TESTS BY EXTRACTION rather than by sourcing: `remote-install.sh` is a `curl | bash`
 * installer, so being ONE self-contained file is a design constraint, not an accident — and its
 * last line is `main "$@"`, so sourcing it would RUN THE INSTALLER. Extracting the two function
 * bodies from the shipped text and eval'ing those keeps the single-file property intact while
 * still testing the bytes that actually ship. The extraction is bounded `^_name() {$` → the first
 * line that is exactly `}`, because brace-COUNTING desyncs here: both functions contain `${r%.git}`
 * and `${r/#\~\//$HOME/}`, whose braces are not block braces.
 */

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'remote-install.sh')

function extract(name: string, source: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l === `${name}() {`)
  if (start === -1) throw new Error(`function ${name}() not found in remote-install.sh`)
  const end = lines.findIndex((l, i) => i > start && l === '}')
  if (end === -1) throw new Error(`no closing brace for ${name}()`)
  return lines.slice(start, end + 1).join('\n')
}

let NORMALIZE = ''
let VERSION_GT = ''

beforeAll(() => {
  const src = readFileSync(SCRIPT, 'utf-8')
  NORMALIZE = extract('_normalize_repo_url', src)
  VERSION_GT = extract('_version_gt', src)
})

/** Run one call against the extracted function and return its stdout. */
function normalize(arg: string, opts: { cwd?: string; home?: string } = {}): string {
  return execFileSync('bash', ['-c', `${NORMALIZE}\n_normalize_repo_url "$1"`, '_', arg], {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.home ? { HOME: opts.home } : {}) },
    encoding: 'utf-8',
  })
}

/** True/false from the guard's exit status — the way the installer itself consumes it. */
function versionGt(a: string, b: string): boolean {
  const out = execFileSync(
    'bash',
    ['-c', `${VERSION_GT}\nif _version_gt "$1" "$2"; then echo yes; else echo no; fi`, '_', a, b],
    { encoding: 'utf-8' },
  )
  return out.trim() === 'yes'
}

describe('the extraction itself — a scanner that pulls nothing tests nothing', () => {
  it('found both functions, with their load-bearing lines intact', () => {
    // Non-vacuity. Without this an extraction that silently returned '' would make every case below
    // fail with "command not found" — noisy — but a partial one would fail SUBTLY, which is worse.
    expect(NORMALIZE).toContain('_normalize_repo_url() {')
    expect(NORMALIZE).toContain('https://github.com/%s.git')
    expect(NORMALIZE.trimEnd().endsWith('}')).toBe(true)
    expect(VERSION_GT).toContain('sort -V')
    expect(VERSION_GT.trimEnd().endsWith('}')).toBe(true)
  })
})

describe('_normalize_repo_url — owner/repo becomes a URL, everything already resolvable passes through', () => {
  it('expands an owner/repo shorthand', () => {
    expect(normalize('Emasoft/ai-maestro')).toBe('https://github.com/Emasoft/ai-maestro.git')
  })

  it('is idempotent about the .git suffix — no owner/repo.git.git', () => {
    expect(normalize('Emasoft/ai-maestro.git')).toBe('https://github.com/Emasoft/ai-maestro.git')
  })

  it.each([
    ['https://github.com/o/r.git'],
    ['http://example.com/o/r.git'],
    ['git@github.com:o/r.git'],
    ['ssh://git@example.com/o/r.git'],
    ['file:///srv/mirror/ai-maestro.git'],
  ])('passes a URL through untouched: %s', (url) => {
    expect(normalize(url)).toBe(url)
  })

  it.each([
    ['/Users/someone/ai-maestro'],
    ['./ai-maestro'],
    ['../ai-maestro'],
  ])('passes an explicit local path through untouched: %s', (p) => {
    // THE documented bug this ordering exists to prevent: an absolute path contains slashes, so if
    // the owner/repo case ran first, "/Users/me/ai-maestro" would become
    // "https://github.com//Users/me/ai-maestro.git" — a URL that clones nothing, from a flag the
    // USER added specifically so a dev could install from a LOCAL checkout.
    expect(normalize(p)).toBe(p)
  })

  it('a relative path WITH slashes that EXISTS is a local repo, not an owner/repo', () => {
    // The discriminator for the `[ -d "$r" ]` branch. A no-slash name would fall through to the
    // same answer via the catch-all case, so it could not tell the branch from its absence;
    // "sub/repo" can only come out unchanged if the directory test ran.
    const root = mkdtempSync(join(tmpdir(), 'aim-norm-'))
    mkdirSync(join(root, 'sub', 'repo'), { recursive: true })
    expect(normalize('sub/repo', { cwd: root })).toBe('sub/repo')
    // …and the same string, when no such directory exists, IS an owner/repo.
    expect(normalize('sub/repo', { cwd: tmpdir() })).toBe('https://github.com/sub/repo.git')
  })

  it('expands a QUOTED literal ~/ to $HOME', () => {
    // `--repo "~/ai-maestro"` reaches the function as a literal tilde (the shell never expanded it,
    // because it was quoted). The function's own comment records why this is a substitution and not
    // a `~/*` case pattern: that pattern would tilde-EXPAND at match time and never fire.
    const home = mkdtempSync(join(tmpdir(), 'aim-home-'))
    expect(normalize('~/ai-maestro', { home })).toBe(`${home}/ai-maestro`)
  })
})

describe('_version_gt — the downgrade guard, and it must compare NUMERICALLY', () => {
  it('0.57.10 is greater than 0.57.3 — the case a string compare gets backwards', () => {
    // The load-bearing case. Lexicographically "0.57.10" < "0.57.3" (because '1' < '3'), so a plain
    // `[ "$a" \> "$b" ]` would report the newer version as older and let the installer downgrade —
    // exactly the accident the USER asked to be caught. `sort -V` is what makes it right.
    expect(versionGt('0.57.10', '0.57.3')).toBe(true)
    expect(versionGt('0.57.3', '0.57.10')).toBe(false)
  })

  it('is STRICT — equal versions are not greater, so a re-install of the same version is allowed', () => {
    expect(versionGt('1.2.3', '1.2.3')).toBe(false)
  })

  it('orders across a major/minor rollover', () => {
    expect(versionGt('1.0.0', '0.99.99')).toBe(true)
    expect(versionGt('0.99.99', '1.0.0')).toBe(false)
    expect(versionGt('0.58.0', '0.57.99')).toBe(true)
  })
})

/**
 * NEUTER RECORD — 2026-08-02
 *
 * (a) `_version_gt` → replace the `sort -V` comparison with a lexicographic `[ "$1" \> "$2" ]`.
 *     Reds exactly 2, by name:
 *       × 0.57.10 is greater than 0.57.3 — the case a string compare gets backwards
 *       × orders across a major/minor rollover
 *     The strictness test stays green (both forms agree that equal is not greater) — which is why
 *     it could never have caught this on its own.
 *
 * (b) `_normalize_repo_url` → move the explicit local-path case (the one matching a leading slash,
 *     dot-slash or dotdot-slash) BELOW the owner/repo case. Reds exactly 1:
 *       × passes an explicit local path through untouched: /Users/someone/ai-maestro
 *     `./ai-maestro` and `../ai-maestro` survive it, because the `*)` branch's `[ -d ]` test still
 *     catches an existing relative dir — so ONLY the absolute case discriminates the ordering, and
 *     a suite carrying just the relative ones would have passed the bug through.
 */
