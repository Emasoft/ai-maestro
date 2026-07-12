/**
 * Atomic installer for the agent-launch keychain preflight probe (TRDD-CNF1X3J7).
 * Writes `~/.aimaestro/agent-keychain-probe.sh` once (idempotent), then re-uses
 * the file for every launch. Mirrors agent-shell-guard-install.ts.
 *
 * WHY a script FILE and not an inline command: the probe must pass the exact
 * arg `-s "Claude Code-credentials"`. During the 2026-07-12 investigation, that
 * arg run through NESTED shell quoting (`sh -c "… \"…\" …"`) was mangled into an
 * `errSecParam` that read exactly like a genuine keychain denial and cost hours.
 * Keeping the `security` call inside a file means the pane only ever types
 * `sh "<path>"` — no nested quoting, nothing to mangle. The success stdout of
 * `-w` (the secret itself) is redirected to /dev/null so the credential is
 * NEVER echoed into the pane; only the READY/BLIND sentinel is printed.
 */

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

/** Bump when the probe script body changes, so a stale copy is rewritten. */
export const KEYCHAIN_PROBE_VERSION = 1

/** Sentinels the probe prints. Kept in sync with the parser in agent-runtime.ts. */
export const KEYCHAIN_PROBE_READY = 'AIM_KC_READY'
export const KEYCHAIN_PROBE_BLIND = 'AIM_KC_BLIND'

/**
 * The probe body. Because both the `-s` arg and the sentinels live in this
 * file, the command typed into the pane (`sh "<path>"`) contains neither — so
 * capturePane can never match a sentinel off the echoed command line, and the
 * `-s` arg can never be mangled by quoting.
 */
const KEYCHAIN_PROBE_SCRIPT = `#!/bin/sh
# ai-maestro agent keychain preflight — version ${KEYCHAIN_PROBE_VERSION} (TRDD-CNF1X3J7)
# Can THIS pane read the Claude Code OAuth item from the login keychain? Every
# agent pane is forked by one tmux server and inherits its security session; a
# keychain-blind session makes 'claude' print "Not logged in" while the agent
# still looks alive. stdout of the secret is discarded — never echo it.
if security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
  echo ${KEYCHAIN_PROBE_READY}
else
  echo ${KEYCHAIN_PROBE_BLIND}
fi
`

/** Canonical install path. Exported so the wake path can `sh` it. */
export const KEYCHAIN_PROBE_INSTALL_PATH = path.join(
  os.homedir(),
  '.aimaestro',
  'agent-keychain-probe.sh',
)

let installed = false

export function resetKeychainProbeInstallForTests() {
  installed = false
}

/**
 * Idempotent installer. Writes the probe to KEYCHAIN_PROBE_INSTALL_PATH only if
 * missing or version-stale, using tmp+rename so concurrent installers cannot
 * tear the file.
 */
export async function ensureKeychainProbeInstalled(): Promise<void> {
  if (installed) return
  const dir = path.dirname(KEYCHAIN_PROBE_INSTALL_PATH)
  await fs.mkdir(dir, { recursive: true })

  let needsWrite = true
  try {
    const existing = await fs.readFile(KEYCHAIN_PROBE_INSTALL_PATH, 'utf8')
    if (existing.includes(`keychain preflight — version ${KEYCHAIN_PROBE_VERSION} `)) {
      needsWrite = false
    }
  } catch {
    // Missing or unreadable — write fresh.
  }

  if (needsWrite) {
    const tmpPath = `${KEYCHAIN_PROBE_INSTALL_PATH}.tmp.${process.pid}`
    await fs.writeFile(tmpPath, KEYCHAIN_PROBE_SCRIPT, { encoding: 'utf8', mode: 0o700 })
    await fs.rename(tmpPath, KEYCHAIN_PROBE_INSTALL_PATH)
  }
  installed = true
}
