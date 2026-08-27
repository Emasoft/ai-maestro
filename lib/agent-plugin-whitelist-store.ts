// The CONFIGURABLE whitelist of user-scope plugins agents may use (R17.24, TRDD-C455WHV3).
//
// The USER's correction (2026-08-27): the whitelist is a SETTING, not a constant. The five
// USER-named plugins are DEFAULTS that will rarely change; more are added from the dashboard
// (Settings → Extensions → Plugins, the "Agents" column). This module is the single read/write
// path for the effective list. The gate (`lib/user-scope-plugin-whitelist.ts`) reads it on
// every wake; the settings API writes it; nothing else touches the key.
//
// Store: `~/.aimaestro/system-settings.json`, key `agentPluginWhitelist: string[]`. That file
// is ai-maestro's own (already holds `conversationIndexerEnabled`), never the host user's
// ~/.claude/settings.json — the IRON no-user-scope-writes rule is untouched.
//
// Semantics of an ABSENT key vs an EMPTY list, both deliberate:
//   - key absent  → the defaults. A fresh install, or one that predates this setting, gets the
//                   five without anyone having to configure anything.
//   - key present → that list, verbatim, even if empty. An operator who removes every entry has
//                   made a decision ("agents get NO user-scope plugins"), and reading `[]` as
//                   "fall back to defaults" would silently overrule it. The store never
//                   confuses "not configured" with "configured to nothing".
// Reads FAIL CLOSED like the gate itself: a corrupt store throws rather than yielding the
// defaults, because the defaults would be a silent DOWNGRADE of an operator's explicit list.

import os from 'os'
import path from 'path'

import { DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS } from '@/lib/ecosystem-constants'
import { readJson, updateJson } from '@/lib/json-io'

export const AGENT_PLUGIN_WHITELIST_KEY = 'agentPluginWhitelist'

export function systemSettingsPath(): string {
  return path.join(os.homedir(), '.aimaestro', 'system-settings.json')
}

/** A plugin key is `name@marketplace`, both halves non-empty, no whitespace. */
export const PLUGIN_KEY_RE = /^[^\s@]+@[^\s@]+$/

/** The effective whitelist. `storePath` is injectable for tests. */
export async function readAgentPluginWhitelist(storePath: string = systemSettingsPath()): Promise<{
  list: string[]
  /** true when the key was absent and the defaults were returned. */
  isDefault: boolean
}> {
  const r = await readJson(storePath)
  if (!r.ok) {
    // readJson distinguishes a MISSING file (legal — defaults) from an unparseable one (refuse).
    if (r.reason === 'missing') return { list: [...DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS], isDefault: true }
    throw new Error(`cannot read ${storePath}: ${r.reason}`)
  }
  const raw = (r.data as Record<string, unknown>)[AGENT_PLUGIN_WHITELIST_KEY]
  if (raw === undefined) return { list: [...DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS], isDefault: true }
  if (!Array.isArray(raw) || !raw.every(k => typeof k === 'string' && PLUGIN_KEY_RE.test(k))) {
    throw new Error(`${AGENT_PLUGIN_WHITELIST_KEY} in ${storePath} is not a list of name@marketplace keys`)
  }
  return { list: Array.from(new Set(raw as string[])), isDefault: false }
}

/** Replace the whitelist wholesale. Validates every key; dedupes; atomic via updateJson. */
export async function writeAgentPluginWhitelist(list: string[], storePath: string = systemSettingsPath()): Promise<string[]> {
  const bad = list.filter(k => typeof k !== 'string' || !PLUGIN_KEY_RE.test(k))
  if (bad.length) throw new Error(`invalid plugin key(s): ${bad.join(', ')}`)
  const clean = Array.from(new Set(list))
  await updateJson(storePath, data => { data[AGENT_PLUGIN_WHITELIST_KEY] = clean }, { createIfMissing: true })
  return clean
}
