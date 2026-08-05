/**
 * §6.4 of docs/SCRIPT-MANIFEST.md — `--help` is a LOCAL, OFFLINE operation and exits 0.
 *
 * TRDD-T3FXA0Y0 (ai-maestro#121). The exit status is the fleet's only machine-readable
 * success signal, and it was uncorrelated with the outcome in all three directions: exit 0
 * on an impossible filter (#114), exit 1 on a fully successful `create`, and exit 1 with no
 * message at all on a real failure.
 *
 * `--help` is the smallest total case of the contract, and the one every caller hits first.
 * It needs no server, no network and no credential, so there is no defensible reason for it
 * to fail — yet `aimaestro-agent.sh --help` exited 1, because `check_api_running || exit 1`
 * ran BEFORE the dispatch. An unauthenticated caller got a 401 diagnostic INSTEAD of the
 * help text: the CLI was undiscoverable at exactly the moment someone needed it.
 *
 * WHY THIS IS A RATCHET AND NOT A PASS/FAIL. Measured 2026-08-05: 29 of 50 deployed CLIs
 * violate. Asserting zero today would mean a permanently red suite, and a permanently red
 * test gets deleted or skipped — so it would protect nothing. Instead the KNOWN-BAD list is
 * pinned by name and the count may only FALL. Fixing one means deleting its line here; a
 * NEW violation fails immediately, because it is not on the list.
 *
 * It runs against the REPO's scripts, never `~/.local/bin` — a deployed dir is one machine's
 * snapshot, and SCRIPT-MANIFEST.md §5 documents that using it as truth is how this drifts.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'

const SCRIPTS = join(process.cwd(), 'scripts')

/**
 * The 28 scripts that still violate §6.4, by name. THIS LIST MAY ONLY SHRINK.
 *
 * All of them share ONE root: they `source amp-helper.sh`, which resolves AMP identity at
 * SOURCE time and exits when the session is not bound to an agent — so `--help` requires an
 * identity it has no reason to need. Fixing them is TRDD-3KJW8P6R and is deliberately
 * separate: the abort must not be weakened, because it is security code that purposefully
 * refuses to print a pickable uuid list (an error message must not hand the caller an
 * exploit).
 *
 * `aid-auth.sh` is here for a different reason — it PRINTS a token, so `--help` is not a
 * distinct verb for it. That is a design question, not the same bug.
 */
const KNOWN_VIOLATORS = new Set([
  'amp-clone-repo.sh', 'amp-create-branch.sh', 'amp-create-repo.sh', 'amp-delete.sh',
  'amp-download.sh', 'amp-fetch.sh', 'amp-helper.sh', 'amp-identity.sh',
  'amp-inbox.sh', 'amp-init.sh', 'amp-kanban-archive.sh', 'amp-kanban-create-task.sh',
  'amp-kanban-edit.sh', 'amp-kanban-get.sh', 'amp-kanban-list.sh', 'amp-kanban-move.sh',
  'amp-list-local-repos.sh', 'amp-project-info.sh', 'amp-project-repos.sh', 'amp-read.sh',
  'amp-register.sh', 'amp-reply.sh', 'amp-send.sh', 'amp-status.sh',
  'amp-task-blocked.sh', 'amp-task-done.sh', 'amp-team-members.sh', 'aid-auth.sh',
])

/** Tier-A + amp/aid surface: the scripts a plugin may invoke. */
const CANDIDATES = existsSync(SCRIPTS)
  ? readdirSync(SCRIPTS)
      .filter((f) => /^(aimaestro|amp|aid)-.*\.sh$/.test(f))
      .sort()
  : []

function helpExitCode(script: string): number {
  try {
    execFileSync('bash', [join(SCRIPTS, script), '--help'], {
      stdio: 'pipe',
      timeout: 20_000,
      // No AID_AUTH, no session: --help must work for a caller with NO credential.
      // That is the whole claim, so the environment has to actually lack one.
      env: { ...process.env, AID_AUTH: '', AIMAESTRO_SESSION: '', AIMAESTRO_SUDO_TOKEN: '' },
    })
    return 0
  } catch (err) {
    const e = err as { status?: number }
    return typeof e.status === 'number' ? e.status : 1
  }
}

describe('the scan is real — "0 violations" must not be what an empty list returns', () => {
  it('found the CLI surface', () => {
    expect(CANDIDATES.length).toBeGreaterThan(40)
  })

  it('includes the script this contract was written for', () => {
    expect(CANDIDATES).toContain('aimaestro-agent.sh')
  })
})

describe('SCRIPT-MANIFEST §6.4 — `--help` exits 0 with no server and no credential', () => {
  const compliant = CANDIDATES.filter((s) => !KNOWN_VIOLATORS.has(s))

  it.each(compliant)('%s --help exits 0', (script) => {
    expect(helpExitCode(script)).toBe(0)
  })

  it('the known-violator list may only SHRINK — no new violations', () => {
    // A name on the list that now PASSES is not a failure, it is progress that
    // nobody recorded; the list is stale and must be trimmed. Reported separately
    // from a genuine regression so the two are never confused.
    const fixed = [...KNOWN_VIOLATORS].filter((s) => CANDIDATES.includes(s) && helpExitCode(s) === 0)
    expect(
      fixed,
      `These are FIXED but still listed as known violators. Delete them from ` +
        `KNOWN_VIOLATORS — the list is a ratchet and must fall as they are fixed:\n` +
        fixed.join('\n'),
    ).toEqual([])
  })

  it('every listed violator still exists (no stale names hiding a deleted script)', () => {
    const ghosts = [...KNOWN_VIOLATORS].filter((s) => !CANDIDATES.includes(s))
    expect(ghosts, `KNOWN_VIOLATORS names scripts that no longer exist: ${ghosts.join(', ')}`).toEqual([])
  })
})
