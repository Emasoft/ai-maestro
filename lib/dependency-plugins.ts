/**
 * Curated list of "dependency plugins" — third-party plugins that AI Maestro
 * itself relies on for its development / authoring workflow but that are NOT
 * core to the runtime (so they live OUTSIDE the R17 core-plugin guarantee).
 *
 * The auto-update settings page exposes this list as a single checkbox
 * ("Dependency plugins"). When the checkbox is enabled, every plugin in the
 * registered marketplaces whose name matches one of these entries gets the
 * same "check version → update if outdated" treatment as the other
 * categories.
 *
 * Editing this list:
 * - Add an entry only if the plugin is genuinely a development dependency
 *   (the user runs it during their authoring loop). Don't add user
 *   convenience plugins here — those belong in the user's own opt-in list.
 * - The match is by `plugin.name` (NOT key, NOT marketplace) so any
 *   marketplace that vendors the same plugin name is treated the same.
 *   Multi-marketplace plugins (the same name in two marketplaces) get
 *   updated in every marketplace where they appear.
 */

/**
 * Names recognised as AI Maestro dependency plugins.
 *
 * Kept lowercase / kebab-case to match how Claude Code stores plugin names
 * in its marketplace manifests.
 */
export const DEPENDENCY_PLUGIN_NAMES = [
  'perfect-skill-suggester',  // PSS — agent profile builder + skill matcher
  'pss',                      // PSS — short alias used in some marketplaces
  'claude-plugins-validation', // CPV — plugin/marketplace validation
  'cpv',                       // CPV — short alias
  'llm-externalizer',         // External-LLM offload MCP (cheaper than Haiku)
  'code-auditor',             // Multi-stage codebase auditor
  'serena',                   // Symbol-aware code navigation MCP
  'grepika',                  // Token-efficient code search MCP
] as const

/**
 * Returns true when the given plugin name is a recognised dependency plugin.
 *
 * Case-insensitive match. The auto-update service uses this to filter
 * plugins discovered in marketplace manifests when the "Dependency plugins"
 * category is enabled.
 */
export function isDependencyPlugin(pluginName: string): boolean {
  if (!pluginName) return false
  const needle = pluginName.toLowerCase()
  return DEPENDENCY_PLUGIN_NAMES.includes(needle as typeof DEPENDENCY_PLUGIN_NAMES[number])
}
