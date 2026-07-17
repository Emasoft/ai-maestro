// The janitor's machine-wide global-state directory — resolved the SAME way the
// janitor's Python global_state.py resolves it, so the ai-maestro server's OAuth-rotator
// latch (Phase B) and flock (Phase C) land in the EXACT directory the janitor daemon uses.
// If the two diverged, the server and any residual janitor `#N` fallback would hold
// DIFFERENT locks / read DIFFERENT latches and could both write the live credential —
// the corruption this whole coordination exists to prevent.
//
// Faithful port of scripts/lib/global_state.py::global_state_dir (TRDD-2U8AH82F,
// TRDD-1GGQ4HWY). Ladder, in order:
//   1. $JANITOR_GLOBAL_STATE_DIR (absolute priority — a TEST-ONLY isolation hatch, see below)
//   2. $XDG_STATE_HOME/janitor  (Linux default when set)
//   3. <DATA>/global-state      (once the daemon stamped the migration marker there, OR a
//      fresh install with no legacy dir to migrate)
//   4. ~/.claude/janitor-global-state  (legacy, while a not-yet-migrated install still has it)
//
// SECURITY (TRDD-CC9PY337): $JANITOR_GLOBAL_STATE_DIR is read through testOnlyEnv() — honored
// only inside the test runner, IGNORED in dev and production. Outside a test it redirects the
// rotator/daemon state dir (locks, the keychain-denied latch, the slot state index), so an
// inherited `export` could point the SERVER's rotation state somewhere an attacker controls.
//
// WHY GATING IT IS SAFE ACROSS THE TS↔PYTHON BOUNDARY (the landmine): this string MUST match
// global_state.py::global_state_dir exactly, or the server and the janitor `#N` fallback would
// hold DIFFERENT locks / read DIFFERENT latches and could both write the live credential. The
// Python side honors this var UNCONDITIONALLY; the TS side now honors it only in a test. They
// diverge ONLY if the var is set while a NON-test server AND the daemon both run — but nothing
// in ai-maestro or the janitor sets it in production (grepped: zero setters; step 1 is a test
// hatch on BOTH sides), so in production both take the same default ladder and agree. The shared
// branch that must never diverge is step 2, $XDG_STATE_HOME — a standard OS var both honor
// identically, deliberately NOT gated.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { testOnlyEnv } from '../test-only-env'

const MIGRATION_MARKER = 'migrated-from-legacy.ts'

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** The legacy (pre-TRDD-2U8AH82F) global-state dir. Read-only compatibility. */
export function legacyGlobalStateDir(): string {
  return path.join(os.homedir(), '.claude', 'janitor-global-state')
}

/** The CANONICAL global-state dir: the janitor plugin's DATA dir + `/global-state`. */
export function dataGlobalStateDir(): string {
  return path.join(
    os.homedir(),
    '.claude',
    'plugins',
    'data',
    'ai-maestro-janitor-ai-maestro-plugins',
    'global-state',
  )
}

/**
 * Resolve the machine-wide janitor global-state directory. Matches
 * global_state.py::global_state_dir exactly (the resolution flips machine-wide only
 * when the daemon has stamped the migration marker, so reads/writes stay consistent
 * with a possibly-older daemon until then).
 */
export function globalStateDir(): string {
  const override = (testOnlyEnv('JANITOR_GLOBAL_STATE_DIR') ?? '').trim()
  // path.resolve gives an absolute path; Python's .resolve() also chases symlinks, but a
  // state dir that may not exist yet cannot be realpath'd, and the coordination only needs
  // the two implementations to agree on the STRING — which an absolute non-symlink path does.
  if (override) return path.resolve(expandHome(override))

  const xdg = (process.env.XDG_STATE_HOME ?? '').trim()
  if (xdg) return path.join(path.resolve(expandHome(xdg)), 'janitor')

  const dataDir = dataGlobalStateDir()
  const legacy = legacyGlobalStateDir()
  if (isFile(path.join(dataDir, MIGRATION_MARKER)) || !isDir(legacy)) return dataDir
  return legacy
}

/**
 * The legacy path for a per-name flag, active only during the dual-read window (a legacy
 * dir still exists AND resolution has already flipped to the DATA dir). Returns null under
 * the env override (test isolation has no legacy notion) or once the legacy dir is gone.
 * Mirrors global_state.py::_legacy_read_path — a flag/latch written by an older build must
 * still be honored, or the fix would silently un-protect a machine mid-migration.
 */
export function legacyReadPath(name: string): string | null {
  // Same gate as globalStateDir(): the two MUST agree on whether the override is active, or a
  // latch written under the override would be sought at the legacy path (or vice-versa).
  if ((testOnlyEnv('JANITOR_GLOBAL_STATE_DIR') ?? '').trim()) return null
  const legacy = legacyGlobalStateDir()
  if (isDir(legacy) && globalStateDir() !== legacy) return path.join(legacy, name)
  return null
}
