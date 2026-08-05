/**
 * The PURE path policy for agent working directories (TRDD-QMD7X3FB).
 *
 * "Could ANY agent legitimately own this directory?" — decided from the path
 * alone, with no registry read and therefore no dependency on anything.
 *
 * WHY IT IS ITS OWN MODULE. `lib/agent-workdir-policy.ts` (the authority for the
 * two *authorization* questions) reads the registry, so `lib/agent-registry.ts`
 * cannot import it — a cycle. But the registry is exactly where the policy has to
 * bite: `createAgent` there is the ONE writer every path funnels through, and it
 * validated the working directory not at all. So the pure half lives here, with no
 * imports of its own, and both the authority and the registry depend on it.
 *
 * The forbidden set is not a style preference. An agent whose workdir is:
 *   - `/`            — owns the entire filesystem;
 *   - `$HOME`        — owns the user's whole home, every project, every dotfile;
 *   - Desktop/Documents/Downloads/Library — owns a whole user-data root;
 *   - the ai-maestro install tree — rebuilds and restarts the server managing it;
 *   - anything outside `$HOME` — is off the map entirely;
 *   - empty          — inherits the SERVER's cwd, which IS the install tree.
 * Every one of those is a directory the agent was never handed, and the shell guard
 * permits writes anywhere under the workdir — so the workdir IS the write boundary.
 *
 * SECURITY POSTURE: on a shared UID this is an AUTHORIZATION check (the system
 * agreeing with itself about what it handed an agent), not containment. A same-uid
 * process can chdir and write anywhere the kernel allows. Real containment is
 * TRDD-a1019073. Do not read this module as a sandbox.
 */
import { homedir } from 'os'
import { join, resolve, sep } from 'path'

const HOME = homedir()

/** The canonical home for agent-owned working directories. */
export const AGENTS_ROOT = join(HOME, 'agents')

/**
 * The ai-maestro installation itself. Captured once at module load.
 *
 * An agent must never adopt this tree: it is the source of the server that manages
 * it, sharing `~/.aimaestro` state, port 23000 and the tmux namespace with every
 * other agent. An agent editing/rebuilding it would destabilize the system it runs
 * inside. Developing ai-maestro FROM an agent needs a container, not an in-place
 * workdir.
 */
export const INSTALL_ROOT = resolve(process.cwd())

/**
 * Directories that are never a valid agent workdir, matched EXACTLY (children are
 * fine — `~/agents/foo` is valid even though `$HOME` is not).
 */
export const BLOCKED_EXACT: ReadonlySet<string> = new Set([
  resolve('/'),
  resolve(HOME),
  resolve(join(HOME, 'Desktop')),
  resolve(join(HOME, 'Documents')),
  resolve(join(HOME, 'Downloads')),
  resolve(join(HOME, 'Library')),
])

export interface WorkdirVerdict {
  ok: boolean
  /** Human-readable reason when `ok` is false. Surfaced to callers — never opaque. */
  reason?: string
}

export function isUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep)
}

/**
 * The path policy. Takes a RAW (unresolved) path so the caller cannot accidentally
 * hand it something already normalized by a different rule set; `resolve` here
 * neutralizes `..` traversal before any comparison.
 */
export function checkWorkdirPathPolicy(dir: unknown): WorkdirVerdict {
  // An empty/absent workdir is NOT a harmless default. tmux would inherit the
  // SERVER's cwd — the ai-maestro install tree — which is the one directory this
  // policy most needs to keep an agent out of. Absence must be a refusal, never a
  // fallback.
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    return { ok: false, reason: 'working directory is required (an empty one would inherit the server\'s own directory)' }
  }

  const resolved = resolve(dir.startsWith('~') ? dir.replace(/^~/, HOME) : dir)

  // The ordinary case: anything under ~/agents/ is fine.
  if (isUnder(resolved, AGENTS_ROOT)) return { ok: true }

  if (BLOCKED_EXACT.has(resolved)) {
    return {
      ok: false,
      reason:
        resolved === resolve('/')
          ? 'the filesystem root (/) — an agent may never own the whole filesystem'
          : resolved === resolve(HOME)
            ? `$HOME (${resolved}) — an agent may never own the user's entire home directory`
            : `a protected user-data root, not a project (${resolved})`,
    }
  }

  // THE RECURSION GUARD RUNS BEFORE THE OUTSIDE-$HOME CATCH-ALL, and the order is
  // load-bearing even though both arms deny.
  //
  // `INSTALL_ROOT` is `process.cwd()` at module load, so it is only USUALLY under $HOME
  // (`~/ai-maestro`). A checkout at `/opt/ai-maestro`, a container at `/app`, or a scratch
  // worktree under `/tmp` puts it outside — and with the generic check first, asking for the
  // install tree itself was answered `outside $HOME`. Still a denial, so nothing was ever
  // unsafe; but the caller was told the least useful of the two true reasons, and the one
  // hazard this policy most needs to NAME went unnamed exactly where the layout is unusual
  // enough that a human would need it named.
  //
  // Reordering cannot change any verdict — both arms return `ok: false` — only which reason
  // is reported. Specific beats generic when both apply. (TRDD-ZR5WUQJZ; found when two
  // "must never regress" tests went red from a /tmp worktree, asserting the message they
  // were written to pin.)
  if (isUnder(resolved, INSTALL_ROOT)) {
    return {
      ok: false,
      reason:
        `inside the ai-maestro installation (${INSTALL_ROOT}). An agent cannot adopt the ` +
        `source tree of the server that manages it — that is a recursion, not a project. ` +
        `Use an isolated container to develop ai-maestro itself.`,
    }
  }

  if (!isUnder(resolved, HOME)) {
    return { ok: false, reason: `outside $HOME (${resolved})` }
  }

  return { ok: true }
}
