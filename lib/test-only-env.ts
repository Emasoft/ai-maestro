/**
 * Test-only env hatches — honored ONLY inside the test runner (TRDD-CC9PY337).
 *
 * A handful of env vars exist so a unit test can avoid touching the developer's REAL keychain,
 * state directory, or binaries: point the credential store at a temp dir, force the plaintext
 * backend, spawn a stub reader. That is the 0-IMPACT discipline, and it is worth keeping — a
 * test suite that writes to your live keychain is a worse bug than the one this module closes.
 *
 * Every one of them, if honored outside a test, silently WEAKENS what it redirects:
 *
 *   AIM_JSONL_READER_PATH=/tmp/evil     -> that binary is spawned as the server's UID (RCE)
 *   CLAUDE_SAFE_STORAGE_BACKEND=none    -> OAuth tokens stop being encrypted at rest
 *   AIM_SMTP_CRED_BACKEND=file          -> the SMTP password leaves the OS keychain
 *   CLAUDE_ROTATOR_*_KEYCHAIN_SERVICE   -> tokens read/written under an attacker's service
 *
 * THE RULE (USER, 2026-07-17). An env var that can weaken a security property is DELETED, not
 * gated and not documented; doubt resolves toward removal; the setting lives in the dashboard's
 * encrypted store. The vars in this module are the ONE relaxation the USER granted — "you can
 * slightly relax the criteria for those env var needed for testing and scenarios runs" — because
 * they are needed for tests and have NO dashboard equivalent: they are not settings at all, they
 * are test seams. So they survive, on the tightest terms available.
 *
 * WHY AN ALLOWLIST, NOT A RELEASE GATE. The first cut of this module (release-env-guard.ts)
 * ignored these vars when NODE_ENV=production and honored them everywhere else. That was wrong,
 * and the USER named it: "even a dev environment is at risk of being exploited." A release gate
 * leaves the hatches live on every dev box — and a dev box runs agents under the same UID as the
 * server, which IS the vector. So the predicate is an ALLOWLIST on the test runner:
 *
 *   NODE_ENV=test        (vitest sets this itself)  -> honored
 *   NODE_ENV unset       (`yarn dev`)               -> IGNORED
 *   NODE_ENV=production  (pm2 --env production)     -> IGNORED
 *
 * The set of processes where an exported hatch does anything shrinks from "every dev box" to
 * "one the test runner already controls" — and a test that could not set its own environment
 * could not be a test.
 *
 * THE VECTOR is the environment the server INHERITS, not a remote attacker. Agents run as the
 * SAME UID as the server, so a prompt-injected agent can append one `export` to ~/.zshrc — a
 * low-suspicion write — and the next restart picks it up. A stale export from a debugging
 * session does the same by accident. Both are silent: nothing in the UI says the keychain was
 * bypassed. Neither `yarn dev` nor pm2 sets NODE_ENV=test, so neither reaches these hatches.
 *
 * HONEST LIMIT. This closes the inherited-environment vector, and only that. It is NOT a
 * boundary against anyone who can write to the install tree — they can edit this file. It is
 * worth having because a dotfile is a far softer target than the source, and because a
 * credential downgrade should never be one stray export away. Real isolation needs per-agent
 * UIDs (TRDD-a1019073). Not a sandbox; do not describe it as one.
 *
 * FAIL-SAFE. An ignored hatch returns undefined, so the call site's existing `?? default`
 * yields the SAFE built-in (the real keychain, the bundled binary, the encrypted backend). The
 * failure mode is "the secure default", never "no configuration".
 */

/** One test-only hatch: why it must not be honored outside a test. */
interface TestOnlyVar {
  /** What honoring it outside a test would buy an attacker. Present tense, concrete. */
  risk: string
}

/**
 * The hatches. Membership requires ALL THREE:
 *   1. a test genuinely needs it for 0-IMPACT isolation,
 *   2. it has NO dashboard equivalent (it is a seam, not a setting), and
 *   3. honoring it outside a test weakens a security property.
 *
 * A var that fails (2) is a SETTING: delete its env read and let the dashboard own it — that is
 * what happened to AIM_SMTP_HOST/PORT/USER/PASS/FROM/SECURE, which are gone entirely rather
 * than listed here. A var that fails (3) is ordinary config (PORT, MAESTRO_MODE) and needs no
 * gate at all — gating those would break deployments and buy no security.
 */
export const TEST_ONLY_ENV: Readonly<Record<string, TestOnlyVar>> = Object.freeze({
  // --- Arbitrary code execution -------------------------------------------------------
  AIM_JSONL_READER_PATH: {
    risk: 'spawns an arbitrary binary as the server UID instead of the bundled reader',
  },
  CLAUDE_MARKETPLACE_PLUGINS_DIR: {
    risk: 'loads plugins from an attacker-chosen directory',
  },

  // --- Credential-store downgrade / redirect ------------------------------------------
  CLAUDE_SAFE_STORAGE_BACKEND: {
    risk: '"none" stores OAuth tokens in plaintext instead of the OS keychain',
  },
  AIM_SMTP_CRED_BACKEND: {
    risk: '"file" moves the SMTP password out of the OS keychain into a file',
  },
  CLAUDE_ROTATOR_SLOT_KEYCHAIN_SERVICE: {
    risk: 'redirects OAuth slot tokens to an attacker-named keychain service',
  },
  CLAUDE_ROTATOR_SLOT_BACKUP_KEYCHAIN_SERVICE: {
    risk: 'redirects OAuth slot backups to an attacker-named keychain service',
  },
  CLAUDE_ROTATOR_LIVE_BACKUP_KEYCHAIN_SERVICE: {
    risk: 'redirects the live-token backup to an attacker-named keychain service',
  },
  JANITOR_ROTATOR_KEYCHAIN: {
    risk: 'confines rotator keychain ops to an attacker-chosen keychain',
  },
  JANITOR_GLOBAL_STATE_DIR: {
    risk: 'redirects the rotator/daemon state directory',
  },

  // --- Session hijack ------------------------------------------------------------------
  OPENCLAW_TMUX_SOCKET_DIR: {
    risk: 'discovers agent sessions through an attacker-controlled socket directory',
  },
})

export type TestOnlyEnvName = keyof typeof TEST_ONLY_ENV

/**
 * True only inside the test runner.
 *
 * Vitest sets NODE_ENV=test itself — verified empirically, because vitest.config.ts does NOT
 * set it, so this rests on the runner's own default rather than on our config. A test pins the
 * property so an upstream change cannot silently disable every hatch and leave the suite
 * writing to the developer's real keychain.
 */
export function isTestRunner(): boolean {
  return process.env.NODE_ENV === 'test'
}

/** Names already logged, so a hatch read in a loop does not flood the log. */
const _warned = new Set<string>()

/** Names actually ignored this process — the evidence reportIgnoredTestEnv() prints. */
const _ignored = new Set<string>()

/**
 * Read a test-only hatch: its value inside the test runner, undefined everywhere else.
 *
 * Drop-in for `process.env.X` at any site whose var is in TEST_ONLY_ENV. Returning undefined
 * lets the caller's existing `?? default` / `|| default` produce the safe built-in, so no call
 * site needs to learn about this module beyond swapping the accessor.
 *
 * An unset var returns undefined and is NOT logged: absence is the normal state, not an event.
 */
export function testOnlyEnv(name: TestOnlyEnvName): string | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  if (isTestRunner()) return raw

  _ignored.add(name)
  if (!_warned.has(name)) {
    _warned.add(name)
    console.warn(
      `[SECURITY] Ignoring ${name} — it is a test-only override and this is not the test ` +
      `runner. Honored here, it ${TEST_ONLY_ENV[name].risk}. Using the built-in default ` +
      `instead. If you did not set this, something exported it into this process's ` +
      `environment (check your shell profile) — that is worth investigating.`
    )
  }
  return undefined
}

/** The hatches ignored so far this process. Sorted, for a stable boot summary + tests. */
export function ignoredTestEnvNames(): string[] {
  return [..._ignored].sort()
}

/**
 * Boot-time sweep: touch every hatch so the operator gets ONE summary at startup rather than a
 * warning scattered whenever a subsystem happens to read one.
 *
 * This is the tamper-evidence half, and it is why the module is not merely silent hardening: a
 * clean host prints nothing and an affected host prints a list, so the difference is visible in
 * the log without anyone knowing to look for it.
 *
 * A no-op inside the test runner, where the hatches are legitimate.
 */
export function reportIgnoredTestEnv(): string[] {
  for (const name of Object.keys(TEST_ONLY_ENV) as TestOnlyEnvName[]) testOnlyEnv(name)
  const names = ignoredTestEnvNames()
  if (names.length > 0) {
    console.warn(
      `[SECURITY] ${names.length} test-only env override(s) were present and IGNORED in this ` +
      `process: ${names.join(', ')}. Each is listed above with its risk.`
    )
  }
  return names
}

/** Test-only: clear the once-per-process log/evidence state between cases. */
export function resetTestOnlyEnvStateForTests(): void {
  _warned.clear()
  _ignored.clear()
}
