/**
 * Janitor presence detection — "is the ai-maestro-janitor installed AND
 * armed on this host?" (ai-maestro#102, TRDD-5X3P79Q6).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this server absorbed the janitor daemon's update chores
 * (`version-update`, `marketplace-refresh` — `user-plugins-update` was also
 * absorbed until 2026-08-19, then returned per TRDD-PE54D95Q AC6), the
 * janitor kept itself current on its own. The user's act of installing AND
 * arming the janitor WAS their consent for that upkeep to happen. When the
 * server absorbed those chores, it gated them behind this server's OWN
 * user-facing preference — `auto-update-settings.json`'s master `enabled`
 * toggle, which defaults OFF — so a user who had already consented (via the
 * janitor) found the duty silently stopped until they opted in to a SEPARATE
 * toggle they never knew they needed. That is `consent-to-add` masquerading
 * as `consent-to-remove` (ai-maestro#102 §3).
 *
 * The fix is NOT to flip the master toggle's default (that would silently
 * enable several OTHER, genuinely-new categories nobody asked for). It is to
 * let the absorbed duties check THIS module — "is the original consent still
 * in force?" — instead of the master toggle. See
 * `services/auto-update-service.ts`'s absorbed-duty lane.
 *
 * "INSTALLED" — read from `~/.claude/settings.json`'s `enabledPlugins` map,
 * which is Claude Code's own USER-scope enablement record. This is
 * deliberately NOT `installed_plugins.json`: ai-maestro#102 found that file's
 * LOCAL-scope rows are per-agent-workdir install records this very server
 * writes (and currently leaks on agent deletion — TRDD-AQTGAY60) and that a
 * host can be user-scope ENABLED while carrying zero matching rows there.
 * `settings.json` is the one record that answers "does the user have the
 * janitor" rather than "did some agent workdir once install it".
 *
 * "ARMED" — mirrors the EXACT disarm contract every janitor-shipped rule
 * file already documents (see e.g. `~/.claude/rules/janitor-footprint.md`,
 * `janitor-heartbeat-protocol.md`): the janitor is DISARMED when
 * `<janitor-data-dir>/global-state/kill-switch.flag` exists, OR the legacy
 * `~/.claude/janitor-global-state/kill-switch.flag` exists. We reuse that
 * SAME pair of paths rather than inventing a third name/location for
 * "disarmed" — a foreign reader guessing at a control-plane path is exactly
 * the class of silent-failure bug ai-maestro#102 is about (a wrong filename
 * or directory reads as "absent" and nothing errors).
 *
 * Fail-safe direction: any read trouble (missing file, unreadable JSON,
 * permission error) is read as "not installed" / "not disarmed" respectively
 * — i.e. this module never claims MORE consent than it can prove, and never
 * claims the janitor is disarmed on a transient glitch. A transient error
 * therefore skips the absorbed-duty tick this one time (fail toward doing
 * nothing) rather than either forging consent or freezing a real install.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Every `enabledPlugins` key naming the janitor is `ai-maestro-janitor@<marketplace>` —
 *  match on the plugin-name prefix so a marketplace rename doesn't silently break this. */
const JANITOR_PLUGIN_NAME = 'ai-maestro-janitor'

/** Claude Code's own USER-scope settings file. Resolved at CALL time (not module-load) so
 *  a test that repoints `$HOME` after import still lands in the right place. */
function claudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

/** The janitor's own DATA dir. Fixed, package-slug-derived name — see the janitor's shipped
 *  rule files (`janitor-footprint.md`) for the canonical description of this path. */
function janitorDataDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'ai-maestro-janitor-ai-maestro-plugins')
}

/** The legacy pre-migration daemon-state dir the janitor's own docs still name as a
 *  read-fallback for the disarm flag (kept until every session has migrated off it). */
function legacyJanitorGlobalStateDir(): string {
  return path.join(os.homedir(), '.claude', 'janitor-global-state')
}

/**
 * True iff Claude Code's user-scope settings enable ANY `ai-maestro-janitor@<marketplace>`
 * plugin key. Never throws — a missing/corrupt/unreadable file reads as "not installed",
 * the fail-safe direction (a transient read error must not forge consent that isn't there).
 */
export function isJanitorInstalled(): boolean {
  try {
    const text = fs.readFileSync(claudeSettingsPath(), 'utf8')
    const json = JSON.parse(text) as { enabledPlugins?: Record<string, unknown> }
    const enabled = json.enabledPlugins || {}
    return Object.entries(enabled).some(
      ([key, isEnabled]) => isEnabled === true && key.startsWith(`${JANITOR_PLUGIN_NAME}@`),
    )
  } catch {
    return false
  }
}

/**
 * True iff the janitor is globally DISARMED — the exact two-path contract every janitor rule
 * file documents. Never throws; any read trouble is treated as "not disarmed" (fail-safe
 * toward the janitor's original duty continuing to run, never toward silently halting it).
 */
export function isJanitorDisarmed(): boolean {
  try {
    if (fs.existsSync(path.join(janitorDataDir(), 'global-state', 'kill-switch.flag'))) return true
  } catch {
    // fall through — a read error on the primary path is not evidence of disarm
  }
  try {
    if (fs.existsSync(path.join(legacyJanitorGlobalStateDir(), 'kill-switch.flag'))) return true
  } catch {
    // fail-safe: treat as armed
  }
  return false
}

/**
 * THE gate the absorbed-duty scheduler consults: installed AND not disarmed. This is what
 * `services/auto-update-service.ts` checks INSTEAD of the master `enabled` toggle for the
 * three chores the janitor daemon used to run unconditionally (see the module doc above).
 */
export function isJanitorInstalledAndArmed(): boolean {
  return isJanitorInstalled() && !isJanitorDisarmed()
}
