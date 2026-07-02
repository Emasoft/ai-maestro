/**
 * Program-args mutators for the role-plugin pipeline.
 *
 * Background. Each agent has a single `programArgs` string concatenated
 * after the binary name when the agent is woken
 * (`services/agents-core-service.ts:wakeAgent → fullCommand`). For Claude
 * Code agents the persona is selected via `--agent <main-agent>`. The
 * canonical main-agent name is `<plugin-name>-main-agent` (the
 * quad-match rule from `services/role-plugin-service.ts`).
 *
 * The bug fix this module ships fixes:
 * before — when ChangeTitle (or ChangePlugin) installed a new role-plugin,
 * the agent's `programArgs` `--agent <oldName>` token was NEVER rewritten.
 * Result: a MANAGER agent could come up running an unrelated persona
 * (or fall back to default Claude when the old plugin had been
 * uninstalled and the named main-agent no longer resolved). Witnessed
 * 2026-05-06: jack-bot installed `ai-maestro-assistant-manager-agent`
 * yet kept `--agent backend-infrastructure-engineer-main-agent`, so
 * Claude reported "no special role/plugin persona is active".
 *
 * Why Claude-only.
 * Codex / Gemini / OpenCode / Kiro do NOT load personas via a CLI flag —
 * they read per-client manifest files installed by the corresponding
 * adapter under `lib/client-plugin-adapters/`. So callers must opt in by
 * checking the agent's client type before calling `setClaudeAgentFlag`.
 */

const AGENT_FLAG_REGEX = /(^|\s)--agent\s+(\S+)/

/**
 * Set, replace, or strip the `--agent <name>` flag inside `programArgs`.
 *
 * @param programArgs Existing CLI string, possibly empty.
 * @param mainAgent   The new main-agent file basename (e.g.
 *                    `ai-maestro-assistant-manager-agent-main-agent`),
 *                    or `null` to strip the flag entirely.
 * @returns The rewritten args, with whitespace normalized.
 *
 * Invariants:
 * - All other tokens (`--name`, `--continue`, `--dangerously-skip-permissions`,
 *   user-set flags) are preserved verbatim.
 * - Idempotent — calling with the same `mainAgent` twice yields the same
 *   string.
 * - Order is preserved when replacing in place; when no flag exists the
 *   new flag is prepended (so it lands before any user-supplied args).
 */
export function setClaudeAgentFlag(
  programArgs: string,
  mainAgent: string | null,
): string {
  const args = (programArgs || '').trim()
  if (mainAgent) {
    if (AGENT_FLAG_REGEX.test(args)) {
      // Replace in place (preserves leading whitespace via the `(^|\s)` group).
      return args.replace(AGENT_FLAG_REGEX, `$1--agent ${mainAgent}`)
    }
    return args ? `--agent ${mainAgent} ${args}` : `--agent ${mainAgent}`
  }
  // mainAgent === null → strip the flag and collapse extra spaces.
  return args.replace(AGENT_FLAG_REGEX, '$1').replace(/\s{2,}/g, ' ').trim()
}

/**
 * Derive the canonical Claude main-agent name from a role-plugin name.
 *
 * Convention: `agents/<plugin-name>-main-agent.md` (quad-match rule). Keep
 * this constant in sync with the same string in
 * `services/role-plugin-service.ts`.
 */
export function mainAgentNameForPlugin(pluginName: string): string {
  return `${pluginName}-main-agent`
}
