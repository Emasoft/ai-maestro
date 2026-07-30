// R17.17 — the core plugin must be LOCAL scope only, never user scope.
//
// WHY THIS FILE EXISTS: this guard used to sit inline in `server.mjs::startServer`,
// which binds sockets on import — so no test could reach it. It was ENFORCED and
// unobservable, which is one refactor away from silently not existing. Extracted
// here (precedent: lib/session-validate-server.mjs) so the interesting half can be
// driven directly. `.mjs` because server.mjs runs under plain `node` in full mode
// and cannot import TypeScript.
//
// The split is deliberate: the whole defect surface is the KEY MATCH, which needs
// no filesystem at all. `stripUserScopeCorePlugin` is pure and carries every
// interesting case; the shell around it only reads and writes a file.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const CORE_PLUGIN_NAME = 'ai-maestro-plugin'

/**
 * Decide what a user-scope settings object should become. PURE — no fs, no HOME.
 *
 * SCEN-012 REGRESSION, PINNED BY TEST: the original match was
 * `k.includes('ai-maestro-plugin')`, which false-positives on
 * `ai-maestro-autonomous-agent@ai-maestro-plugins` — the MARKETPLACE name contains
 * the PLUGIN name as a substring, so the startup guard disabled an agent's
 * role-plugin. The key is `<plugin>@<marketplace>`, so the plugin part must match
 * EXACTLY. Do not "simplify" this back to a substring test.
 */
export function stripUserScopeCorePlugin(settings) {
  const plugins = (settings && settings.enabledPlugins) || {}
  const key = Object.keys(plugins).find(k => {
    const at = k.indexOf('@')
    const pluginPart = at >= 0 ? k.substring(0, at) : k
    return pluginPart === CORE_PLUGIN_NAME
  })
  // Already false ⇒ nothing to do. Rewriting it would be a pointless write to the
  // user's own settings file on every boot.
  if (!key || plugins[key] === false) return { changed: false, key: key ?? null, next: settings }
  // Spread rather than mutate: overriding an existing key keeps its original
  // position, so the serialized file differs by exactly one value.
  return { changed: true, key, next: { ...settings, enabledPlugins: { ...plugins, [key]: false } } }
}

/**
 * Apply the guard to `<homeDir>/.claude/settings.json`. Returns whether it wrote.
 *
 * The target is settings.json, NOT settings.local.json: the latter is a
 * project-only override, so writing it at the user-home level is a silent no-op
 * the Claude CLI never reads (BUG-POLLUTION-001). R17.17's rule TEXT still says
 * settings.local.json and is wrong; correcting it is a governance edit.
 *
 * Swallows a malformed/unwritable file, as the inline version did: a broken
 * user settings file must not stop the server from booting.
 */
export function disableCorePluginAtUserScope(homeDir) {
  const userSettingsPath = join(homeDir, '.claude', 'settings.json')
  if (!existsSync(userSettingsPath)) return false
  try {
    const { changed, next } = stripUserScopeCorePlugin(JSON.parse(readFileSync(userSettingsPath, 'utf-8')))
    if (!changed) return false
    writeFileSync(userSettingsPath, JSON.stringify(next, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}
