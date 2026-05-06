/**
 * Atomic installer for the agent shell guard. Writes
 * `~/.aimaestro/agent-shell-guard.sh` once (idempotent), then re-uses
 * the file for every subsequent wake. See lib/agent-shell-guard.ts
 * for the rationale of the guard itself.
 *
 * Why a separate file from the script-string module:
 *   - The string module is a pure data export, safe to import from
 *     anywhere including test files that don't want filesystem side
 *     effects.
 *   - This installer module owns the side-effectful tmp+rename write
 *     so it can be lazy-imported from the wake path without dragging
 *     the install logic into module-load.
 */

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

import { SHELL_GUARD_SCRIPT, SHELL_GUARD_VERSION } from './agent-shell-guard'

/** Canonical install path. Exported so the wake path can `source` it. */
export const SHELL_GUARD_INSTALL_PATH = path.join(
  os.homedir(),
  '.aimaestro',
  'agent-shell-guard.sh',
)

/**
 * Once-per-process flag — install runs at most once per server
 * process. Cleared by `resetShellGuardInstallForTests()` when tests
 * need to re-run the install path.
 */
let installed = false

export function resetShellGuardInstallForTests() {
  installed = false
}

/**
 * Idempotent installer. Writes the canonical script to
 * `SHELL_GUARD_INSTALL_PATH` only if missing or version-stale, using
 * tmp+rename so concurrent installers cannot tear the file.
 */
export async function ensureShellGuardInstalled(): Promise<void> {
  if (installed) return
  const dir = path.dirname(SHELL_GUARD_INSTALL_PATH)
  await fs.mkdir(dir, { recursive: true })

  let needsWrite = true
  try {
    const existing = await fs.readFile(SHELL_GUARD_INSTALL_PATH, 'utf8')
    // Match against the version comment baked into SHELL_GUARD_SCRIPT.
    if (existing.includes(`agent shell guard — version ${SHELL_GUARD_VERSION}`)) {
      needsWrite = false
    }
  } catch {
    // Missing or unreadable — write fresh.
  }

  if (needsWrite) {
    const tmpPath = `${SHELL_GUARD_INSTALL_PATH}.tmp.${process.pid}`
    await fs.writeFile(tmpPath, SHELL_GUARD_SCRIPT, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(tmpPath, SHELL_GUARD_INSTALL_PATH)
  }
  installed = true
}
