/**
 * Release-mode environment guard (TRDD-QZL828OD sibling).
 *
 * A set of env vars exist ONLY as development/test escape hatches: they redirect where a
 * binary is spawned from, which keychain a token is read from, or which backend encrypts a
 * credential. They are indispensable for 0-IMPACT unit tests (point the store at a temp dir
 * so a test never touches the developer's real keychain) and have NO legitimate use in a
 * release install, where every one of them is configured through the dashboard instead.
 *
 * In a release they are pure liability. Each one silently WEAKENS the thing it redirects:
 *
 *   AIM_JSONL_READER_PATH=/tmp/evil     -> that binary is spawned as the server's UID (RCE)
 *   CLAUDE_SAFE_STORAGE_BACKEND=none    -> OAuth tokens stop being encrypted at rest
 *   AIM_SMTP_CRED_BACKEND=file          -> the SMTP password leaves the OS keychain
 *   CLAUDE_ROTATOR_*_KEYCHAIN_SERVICE   -> tokens read/written under an attacker's service
 *   AIM_SMTP_HOST=relay.evil            -> every password-reset code transits their relay
 *
 * THE THREAT MODEL — read this before judging the guard's strength.
 *
 * The vector is NOT a remote attacker; it is the environment the server INHERITS. Agents run
 * as the SAME UID as the server, so a prompt-injected agent can append one `export` line to
 * ~/.zshrc or ~/.profile — an unremarkable, low-suspicion write — and the next server restart
 * picks it up. A stale export left over from a debugging session does the same thing by
 * accident. Both are silent: nothing in the UI says the keychain was bypassed.
 *
 * WHAT THIS GUARD IS, HONESTLY. It closes the INHERITED-ENVIRONMENT vector, and only that. It
 * is NOT a security boundary against an attacker who can write to the install directory — that
 * party can edit ecosystem.config.js, this file, or the server source, and no runtime check can
 * stop them. It is worth having anyway because the dotfile is a far softer target than the
 * install tree, and because fail-safe defaults are the point: a downgrade should never be one
 * stray export away. Real isolation needs per-agent UIDs (TRDD-a1019073). Do not describe this
 * as a sandbox.
 *
 * WHY NODE_ENV IS A TRUSTWORTHY SIGNAL HERE, despite being an env var itself. A release is
 * started by `pm2 start ecosystem.config.js --env production` (scripts/remote-install.sh), and
 * PM2's `env` block sets NODE_ENV=production EXPLICITLY — it overrides whatever the shell
 * exported. So the same dotfile that carries `export CLAUDE_SAFE_STORAGE_BACKEND=none` cannot
 * also carry `export NODE_ENV=development` to unlock the gate: PM2 overwrites it. The signal is
 * exactly as trustworthy as ecosystem.config.js, which lives in the install tree — i.e. it
 * holds against everything this guard claims to defend against, and falls to the attacker who
 * already owns the install tree, against whom nothing here helps anyway.
 *
 * FAIL-SAFE, NOT FAIL-OPEN. An ignored var falls back to the code's built-in default, which is
 * always the SAFE value (the real keychain, the bundled binary, the encrypted backend). So the
 * guard's failure mode is "the secure default", never "no configuration at all".
 *
 * TAMPER-EVIDENT. Every ignore is logged once with the reason, and reportIgnoredEnv() prints a
 * boot-time summary. A silent guard would make an attacked host look identical to a clean one.
 */

/** One guarded var: why it is dangerous, for the log line that explains the ignore. */
interface GuardedVar {
  /** What an attacker (or a stale export) gains by setting it. Present tense, concrete. */
  risk: string
}

/**
 * The vars ignored in release. Membership requires BOTH: (a) setting it weakens a security
 * property, and (b) a release has another way to configure it (the dashboard) or does not need
 * it at all. A var that is merely operational (PORT, MAESTRO_MODE, NOTIFICATION_*) is NOT here
 * — gating those would break legitimate deployments and buy no security.
 */
export const GUARDED_ENV: Readonly<Record<string, GuardedVar>> = Object.freeze({
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

  // --- Password-recovery relay (account takeover) --------------------------------------
  // The dashboard (Settings -> Recovery Email) is the release path; it stores the password in
  // the keychain. An env relay override in release only serves to redirect reset codes.
  AIM_SMTP_HOST: { risk: 'routes password-reset codes through an attacker-chosen SMTP relay' },
  AIM_SMTP_PORT: { risk: 'alters the password-reset relay connection' },
  AIM_SMTP_USER: { risk: 'alters the password-reset relay account' },
  AIM_SMTP_PASS: { risk: 'alters the password-reset relay credential' },
  AIM_SMTP_FROM: { risk: 'spoofs the From address on password-reset mail' },
  AIM_SMTP_SECURE: { risk: 'downgrades the password-reset relay to an unencrypted connection' },
})

export type GuardedEnvName = keyof typeof GUARDED_ENV

/**
 * True when this process is a release install.
 *
 * Set explicitly by PM2's `env` block, so it cannot be flipped by an inherited shell export
 * (see the threat-model note above). `yarn dev` leaves NODE_ENV unset -> development.
 */
export function isReleaseMode(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** Names already logged, so a var read in a loop does not flood the log. */
const _warned = new Set<string>()

/** Names actually ignored this process — the evidence reportIgnoredEnv() prints. */
const _ignored = new Set<string>()

/**
 * Read an env var, honoring it in development and IGNORING it in release.
 *
 * Drop-in for `process.env.X` at any site whose var is in GUARDED_ENV. Returns undefined when
 * ignored, so the caller's existing `?? default` / `|| default` fallback yields the safe
 * built-in — no call site needs to learn about this module beyond swapping the accessor.
 *
 * An unset var returns undefined and is NOT logged: absence is the normal state, not an event.
 */
export function guardedEnv(name: GuardedEnvName): string | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  if (!isReleaseMode()) return raw

  _ignored.add(name)
  if (!_warned.has(name)) {
    _warned.add(name)
    console.warn(
      `[SECURITY] Ignoring ${name} — it is a development-only override and this is a release ` +
      `install. Set here, it ${GUARDED_ENV[name].risk}. Using the built-in default instead. ` +
      `If you did not set this, something exported it into the server's environment ` +
      `(check your shell profile) — that is worth investigating.`
    )
  }
  return undefined
}

/** The guarded vars ignored so far this process. Sorted, for a stable boot summary + tests. */
export function ignoredEnvNames(): string[] {
  return [..._ignored].sort()
}

/**
 * Boot-time sweep: touch every guarded var so the operator gets ONE summary at startup rather
 * than a warning scattered whenever a subsystem happens to read one.
 *
 * This is the tamper-evidence half. It is why the guard is not merely silent hardening: an
 * attacked host prints a list here and a clean host prints nothing, so the difference is
 * visible in the log without anyone knowing to look for it.
 *
 * Safe in development: guardedEnv() honors the var and logs nothing when not in release.
 */
export function reportIgnoredEnv(): string[] {
  for (const name of Object.keys(GUARDED_ENV) as GuardedEnvName[]) guardedEnv(name)
  const names = ignoredEnvNames()
  if (names.length > 0) {
    console.warn(
      `[SECURITY] ${names.length} development-only env override(s) were present and IGNORED ` +
      `in this release install: ${names.join(', ')}. Each is listed above with its risk.`
    )
  }
  return names
}

/** Test-only: clear the once-per-process log/evidence state between cases. */
export function resetGuardStateForTests(): void {
  _warned.clear()
  _ignored.clear()
}
