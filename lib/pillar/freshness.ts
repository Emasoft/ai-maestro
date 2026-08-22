/**
 * TRDD-L55IYKL4 — per-file identity, so a stale index repairs INCREMENTALLY.
 *
 * memgrep answers staleness with a corpus-wide fingerprint and, on any mismatch or
 * any error, falls back to a full live walk. At 298 documents that fallback is a
 * rounding error. At 10⁵ it is measured at ~37 s / 3.3 GB for HALF the target
 * corpus, i.e. **the fallback IS the outage**. So this module deliberately does not
 * copy that posture: freshness is PER FILE, a changed file re-indexes only itself,
 * and a full rebuild is reserved for schema/integrity failure — where it is the
 * only correct answer anyway.
 *
 * The second deliberate deviation is cost. memgrep shells out to `git hash-object`
 * once per file; at 10⁵ that is a fork storm that would dwarf the indexing itself.
 * Here git is consulted exactly TWICE for the whole corpus, regardless of size.
 *
 * IDENTITY, and what each case actually guarantees:
 *
 *   tracked + clean  → `git:<blob-sha>`   content-exact. A file that reverts to a
 *                                          previously indexed state is recognised
 *                                          as unchanged even if its mtime moved.
 *   otherwise        → `stat:<size>:<mtime-ns>`
 *
 * The stat form is what a dirty or untracked file gets — including every LOCAL-scope
 * corpus, which lives outside any repo (`~/.claude/projects/<slug>/design/`) and so
 * has no git answer at all. It changes on every write, which is exactly when a
 * re-index is wanted. Its one blind spot is a rewrite that preserves BOTH size and
 * nanosecond mtime; that is vanishingly rare and, unlike the reverse error, the
 * failure mode of the git form (a spurious re-index) is safe while this one is not —
 * so it is documented here rather than hidden.
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

export type IdentitySource = 'git' | 'stat'

export interface FileIdentity {
  /** Opaque; compare for equality only. Never parse it. */
  id: string
  source: IdentitySource
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

function gitRoot(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // Not a git repo — every LOCAL-scope corpus is in this case, by design.
    return null
  }
}

/**
 * Blob sha per tracked file, from ONE `git ls-files` call.
 *
 * `-z` is not optional: without it git QUOTES any path containing a space or a
 * non-ASCII byte, and the parse silently yields a path that does not exist. Same
 * class of defect as splitting `git worktree list` on whitespace — and this corpus
 * lives under paths a user names in a GUI.
 */
function gitBlobShas(repoRoot: string): Map<string, string> {
  const out = new Map<string, string>()
  let raw: string
  try {
    raw = execFileSync('git', ['ls-files', '-s', '-z', '--full-name'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return out
  }
  for (const entry of raw.split('\0')) {
    if (!entry) continue
    // `<mode> <sha> <stage>\t<path>`
    const tab = entry.indexOf('\t')
    if (tab === -1) continue
    const meta = entry.slice(0, tab).split(' ')
    if (meta.length < 2) continue
    out.set(path.join(repoRoot, entry.slice(tab + 1)), meta[1])
  }
  return out
}

/**
 * Paths whose working-tree content differs from the index, from ONE `git status`.
 *
 * Without this, a tracked-but-MODIFIED file would be identified by its STAGED blob
 * sha — which is not what is on disk. The index would then believe an edited file
 * was unchanged and skip it. That is the one failure direction that loses data, and
 * a dirty working tree is the normal state while anyone is working.
 */
function gitDirtyPaths(repoRoot: string): Set<string> {
  const out = new Set<string>()
  let raw: string
  try {
    // `--no-optional-locks`: a plain `git status` REFRESHES the index and takes
    // `.git/index.lock` to do it. This probe runs on EVERY index sync — every
    // `trddgrep`, every `pillars-lint`, every server-side freshness check — so without
    // the flag a routine read contends with whatever else is committing in the same
    // checkout, and an interrupted run leaves a 0-byte orphan lock that blocks every
    // later commit until someone removes it by hand. Measured 2026-08-22 (TRDD-IMCEYV9F):
    // three such locks in ten minutes while running the pillar CLIs alongside commits,
    // each 0 bytes with no holder — the same signature `server-liveness.ts` already
    // records for the boot probe on 2026-08-19. A FRESHNESS PROBE MUST NOT TAKE A WRITE
    // LOCK ON THE REPO IT PROBES; the sibling in `server-liveness.ts` states the same
    // rule for the liveness probe, and this was the one call site that never got it.
    raw = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return out
  }
  // `XY <path>\0`, and for renames a second NUL-terminated field follows. Treating
  // that extra field as another entry is harmless here: it only ever marks one more
  // path dirty, which costs a re-index and never misses one.
  for (const entry of raw.split('\0')) {
    if (entry.length < 4) continue
    out.add(path.join(repoRoot, entry.slice(3)))
  }
  return out
}

function statIdentity(file: string): FileIdentity | null {
  try {
    const st = fs.statSync(file, { bigint: true })
    return { id: `stat:${st.size}:${st.mtimeNs}`, source: 'stat' }
  } catch (err) {
    // ENOENT ONLY. The file vanished between listing and stat — a concurrent `git mv`
    // lifecycle transition is normal traffic here, and the caller drops it from this pass.
    //
    // Every OTHER errno must propagate, because "absent from `live`" is not a neutral
    // observation downstream: `index-build.ts` puts such a path in `delta.removed` and
    // EVICTS its records and edges from the index. So a transient EIO on a network mount,
    // or an EACCES after a permission change, silently DELETES a live document from the
    // index — `board`/`why`/`unblocks` then answer as if the card does not exist and every
    // `blocked-by` pointing at it becomes a dangling reference the doctor reports as real.
    // `store.ts:153` already draws this exact line for the same reason; a catch-all here
    // was the one place in the pillar that did not.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw new Error(`cannot stat ${file}: ${(err as Error).message}`)
  }
}

/**
 * Identity for every file, using exactly two git calls for the whole corpus.
 *
 * A file missing from the result vanished mid-pass; the caller treats that as a
 * deletion rather than an error.
 */
export function identifyFiles(files: readonly string[], corpusRoot: string): Map<string, FileIdentity> {
  const out = new Map<string, FileIdentity>()
  const absRoot = path.resolve(corpusRoot)
  // git ALWAYS answers in realpath terms, while a caller legitimately holds the
  // symlinked form — on macOS `/tmp` and `/var/folders` are symlinks, so this is the
  // normal case, not an exotic one. Comparing the two forms directly matches nothing
  // and every file silently degrades to `stat`: the safe direction, which is exactly
  // why it would have gone unnoticed. The git fast path was 100% dead in tmp dirs
  // until a test asserted `source === 'git'` and failed.
  const realRoot = realpathOrSelf(absRoot)
  const needsRemap = absRoot !== realRoot

  const root = gitRoot(realRoot)
  const shas = root ? gitBlobShas(root) : new Map<string, string>()
  const dirty = root && shas.size > 0 ? gitDirtyPaths(root) : new Set<string>()
  // With no git shas there is no key to look one up BY, so neither the remap nor the
  // two map probes below can change any answer. Hoisting that out of the loop is what
  // keeps a LOCAL-scope corpus — which is in no repo AT ALL, `gitRoot` returning null
  // by design — from paying per-file for a fast path it can never take. Measured at
  // 10^5 (TRDD-YHYP5XIZ): 43 ms of 302 ms, on the only path a non-git corpus has.
  const canBeGit = shas.size > 0

  for (const file of files) {
    if (canBeGit) {
      // Prefix-remap rather than a per-file realpath: ONE syscall for the whole corpus
      // keeps the all-clean fast path free of per-file I/O, which is the entire point
      // of checking freshness before doing any work.
      // `path.resolve` and NOT `isAbsolute(file) ? file : …`: resolve also NORMALIZES,
      // so an absolute path carrying `..` still prefix-matches `absRoot`. Skipping it
      // for absolute inputs would save ~28 ms/10^5 and silently change which files the
      // git fast path can match — the hoist above already avoids the cost where it is
      // provably pointless, which is the whole win without touching the semantics.
      const abs = path.resolve(file)
      const key = needsRemap && abs.startsWith(absRoot) ? realRoot + abs.slice(absRoot.length) : abs
      const sha = shas.get(key)
      if (sha && !dirty.has(key)) {
        out.set(file, { id: `git:${sha}`, source: 'git' })
        continue
      }
    }
    const st = statIdentity(file)
    if (st) out.set(file, st)
  }
  return out
}

/** What changed between an indexed snapshot and the live corpus. */
export interface FreshnessDelta {
  added: string[]
  changed: string[]
  removed: string[]
}

export function diffIdentities(
  indexed: ReadonlyMap<string, string>,
  live: ReadonlyMap<string, FileIdentity>,
): FreshnessDelta {
  const added: string[] = []
  const changed: string[] = []
  for (const [file, ident] of live) {
    const was = indexed.get(file)
    if (was === undefined) added.push(file)
    else if (was !== ident.id) changed.push(file)
  }
  const removed: string[] = []
  for (const file of indexed.keys()) if (!live.has(file)) removed.push(file)
  return { added, changed, removed }
}

export function isFresh(d: FreshnessDelta): boolean {
  return d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0
}
