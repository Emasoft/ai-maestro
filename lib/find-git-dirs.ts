import { readdirSync, type Dirent } from 'fs'
import path from 'path'

/**
 * Every `.git` directory at most `maxDepth` levels under `root` (TRDD-JIHK7SWH).
 *
 * Replaces a `find` shell-out whose argument was interpolated into a command string.
 * A walk takes PATHS, so there is no command to inject into — the whole class of
 * quoting bug is removed rather than blocked.
 *
 * Deliberately mirrors what the old `find "$root" -maxdepth 3 -name .git -type d` did,
 * including its quirks, so this stays a security fix and not a behaviour change:
 *   - depth is measured from `root`, and `root` itself is depth 0;
 *   - a `.git` DIRECTORY matches; a `.git` FILE (a submodule or worktree pointer) does
 *     not, exactly as `-type d` required;
 *   - it does NOT descend into a directory it has already matched, because a repo
 *     inside `.git/` is not a repo the dashboard should list;
 *   - unreadable directories are skipped rather than fatal, which is what `2>/dev/null`
 *     bought — an agent workdir routinely contains something the server cannot read.
 * Symlinks are NOT followed: `withFileTypes` reports a link as a link, so a symlinked
 * directory is never walked. `find` without `-L` behaved the same way, and following
 * them would let a link inside the workdir escape the sandbox the caller then verifies.
 */
export function findGitDirs(root: string, maxDepth: number): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    // `Dirent[]`, not `ReturnType<typeof readdirSync>` — that resolves to the Buffer
    // overload and makes every `e.name` a Buffer, which type-checks as a silent
    // path-comparison bug rather than an error at the call site.
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable — the old `2>/dev/null`
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      if (e.name === '.git') {
        found.push(full)
        continue // do not descend into a matched .git
      }
      walk(full, depth + 1)
    }
  }
  walk(root, 1)
  return found
}
