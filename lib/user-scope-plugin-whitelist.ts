// The user-scope plugin WHITELIST for agents (R17.24, TRDD-C455WHV3).
//
// The host user has many plugins enabled at user scope (~/.claude/settings.json)
// — LSPs, review tools, personal skills — and Claude Code loads every one of
// them into every process on the host, agents included. The USER's directive
// (2026-08-27): agents may use only an explicit, harness-enforced whitelist of
// those. Everything else at user scope must be invisible to an agent.
//
// HOW, and why it is the only legal how. Two standing rules forbid the naive
// fix of disabling the other plugins at user scope:
//   - the IRON no-user-scope-writes rule (TRDD-QZL828OD): the harness never
//     writes `enabledPlugins` at user scope — those are the HOST USER's own
//     tools for the host user's own sessions, and this file must never touch
//     ~/.claude/settings.json. It only READS it.
//   - R17.18: no startup audit, no periodic loop. This runs inside the Change*
//     pipelines that already own the agent's file, as a post-gate, on demand.
// The platform offers exactly one lever that satisfies both: settings
// PRECEDENCE. A `"<plugin>": false` in the agent's own
// .claude/settings.local.json overrides a `true` at user scope for THAT
// process alone (project-local > user in Claude Code's ladder). There is no
// per-plugin allowlist key and `--plugin-dir` does not exclude user-scope
// plugins (checked against the docs 2026-08-27), so this is not a shortcut —
// it is the mechanism.
//
// FAIL-CLOSED on the READ. `listUserScopePluginInstalls` in plugin-enumeration
// returns [] on ANY error, which would make a corrupt or unreadable user
// settings file read as "no user-scope plugins" and this gate silently write
// nothing while reporting success. That is the lenient-reader shape the
// lessons file warns about, so user scope is read here directly: ENOENT is
// legal (a pristine host has nothing to whitelist against); anything else is
// a refusal the caller must surface, never a quiet no-op.

import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import { USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS } from '@/lib/ecosystem-constants'
import { updateJson } from '@/lib/json-io'

export interface WhitelistResult {
  /** false only when the user-scope file could not be READ (corrupt / EACCES). */
  ok: boolean
  /** Keys newly set to false in the agent's local settings this run. */
  disabled: string[]
  /** Non-whitelisted keys that were already false locally (nothing written). */
  alreadyDisabled: string[]
  /** true when the local file was written; false on a clean idempotent pass. */
  wrote: boolean
  error?: string
}

/** Read the host's user-scope `enabledPlugins`. Returns null on ENOENT (legal: nothing to
 *  whitelist against) and THROWS on every other failure — see the header. */
async function readUserScopeEnabled(userSettingsPath: string): Promise<Record<string, boolean> | null> {
  let text: string
  try {
    text = await fs.readFile(userSettingsPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const json = JSON.parse(text) as { enabledPlugins?: unknown }
  const ep = json.enabledPlugins
  if (ep === undefined || ep === null) return {}
  if (typeof ep !== 'object' || Array.isArray(ep)) {
    throw new Error(`enabledPlugins in ${userSettingsPath} is not an object`)
  }
  return ep as Record<string, boolean>
}

/**
 * Enforce the whitelist for ONE agent: every plugin enabled at user scope that is not on
 * `USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS` gets `false` in that agent's
 * `.claude/settings.local.json`. Merge-only, idempotent (no write when nothing differs),
 * atomic via `updateJson`. Whitelisted keys are never written — the agent may still
 * disable one of them itself, and that choice is left alone.
 *
 * `userSettingsPath` is injectable so a test can seed a fake user scope without touching
 * the developer's real ~/.claude/settings.json; the default is the real one.
 */
export async function enforceUserScopePluginWhitelist(
  agentDir: string,
  userSettingsPath: string = path.join(os.homedir(), '.claude', 'settings.json'),
): Promise<WhitelistResult> {
  const resolvedDir = agentDir.startsWith('~') ? agentDir.replace('~', os.homedir()) : agentDir
  const localSettings = path.join(resolvedDir, '.claude', 'settings.local.json')
  const allowed = new Set<string>(USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS)

  let userEnabled: Record<string, boolean> | null
  try {
    userEnabled = await readUserScopeEnabled(userSettingsPath)
  } catch (err) {
    return {
      ok: false,
      disabled: [],
      alreadyDisabled: [],
      wrote: false,
      error: `cannot read user-scope settings ${userSettingsPath}: ${(err as Error).message}`,
    }
  }
  if (userEnabled === null) return { ok: true, disabled: [], alreadyDisabled: [], wrote: false }

  const toDisable = Object.entries(userEnabled)
    .filter(([key, on]) => on === true && !allowed.has(key))
    .map(([key]) => key)
    .sort()
  if (toDisable.length === 0) return { ok: true, disabled: [], alreadyDisabled: [], wrote: false }

  const disabled: string[] = []
  const alreadyDisabled: string[] = []
  // updateJson serializes the mutated object and short-circuits to `changed:false` — writing
  // NOTHING — when it is byte-identical to what was on disk. Idempotence therefore comes from
  // the primitive, and `wrote` reports its verdict rather than a flag of our own that could
  // disagree with what actually hit the disk.
  const res = await updateJson(localSettings, settings => {
    const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
    for (const key of toDisable) {
      if (ep[key] === false) { alreadyDisabled.push(key); continue }
      ep[key] = false
      disabled.push(key)
    }
    settings.enabledPlugins = ep
  }, { createIfMissing: true })

  return { ok: true, disabled, alreadyDisabled, wrote: res.changed }
}
