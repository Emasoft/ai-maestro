/**
 * Types for the Agent Profile Panel's local-config scanner.
 * Used by GET /api/agents/[id]/local-config and useAgentLocalConfig hook.
 */

export interface LocalSkill {
  name: string
  path: string
  description?: string
  /** All frontmatter key-value pairs from SKILL.md */
  frontmatter?: Record<string, string | string[]>
  /** Plugin this element belongs to (undefined = individually installed) */
  sourcePlugin?: string
}

export interface LocalAgent {
  name: string
  path: string
  description?: string
  frontmatter?: Record<string, string | string[]>
  sourcePlugin?: string
}

export interface LocalHook {
  /** Auto-generated kebab slug: <event>-<matcher>-<hookType>-<cmd40> */
  name: string
  path: string
  /** Claude Code hook event (PreToolUse, PostToolUse, Notification, Stop, SessionStart, etc.) */
  eventType?: string
  /** Optional regex used by Claude Code to decide when the hook fires */
  matcher?: string
  /** Hook type — almost always 'command' */
  hookType?: string
  /** Full raw command (before truncation) */
  command?: string
  /** Optional timeout in seconds */
  timeout?: number
  sourcePlugin?: string
}

export interface LocalRule {
  name: string
  path: string
  preview?: string
  sourcePlugin?: string
}

export interface LocalCommand {
  name: string
  path: string
  trigger?: string
  frontmatter?: Record<string, string | string[]>
  sourcePlugin?: string
}

export interface LocalMcpServer {
  name: string
  command?: string
  args?: string[]
  sourcePlugin?: string
}

export interface LocalLspServer {
  name: string
  command: string
  languages: string[]
  sourcePlugin?: string
}

export interface LocalOutputStyle {
  name: string
  path: string
  sourcePlugin?: string
}

export interface LocalPlugin {
  name: string
  /** Full plugin key in "name@marketplace" format, used for enable/disable toggle */
  key?: string
  path: string
  description?: string
  version?: string
  author?: string
  authorEmail?: string
  license?: string
  homepage?: string
  repository?: string
  keywords?: string[]
  /** Marketplace name extracted from key */
  marketplace?: string
  /** Source URL (marketplace git URL or local path) */
  sourceUrl?: string
  enabled: boolean
  /** True if this plugin matches the Role-Plugin quad-match but is NOT the official one */
  isConflictingRolePlugin?: boolean
  /** Bundled elements — populated by scanner for Plugins section element listing */
  elements?: {
    skills: LocalSkill[]
    agents: LocalAgent[]
    commands: LocalCommand[]
    hooks: LocalHook[]
    rules: LocalRule[]
    mcpServers: LocalMcpServer[]
    lspServers: LocalLspServer[]
    outputStyles: LocalOutputStyle[]
  }
}

export interface RolePlugin {
  name: string
  profilePath: string
  mainAgentName: string
  mainAgentPath: string
  marketplace?: string  // MARKETPLACE_NAME for defaults, LOCAL_MARKETPLACE_NAME for custom (see lib/ecosystem-constants.ts)
  compatibleTitles?: string[]   // From .agent.toml: which governance titles can use this plugin
  compatibleClients?: string[]  // From .agent.toml: which AI clients can use this plugin
}

export interface GlobalDependencies {
  plugins: string[]
  skills: string[]
  mcpServers: string[]
  scripts: string[]
  hooks: string[]
  tools: string[]
  output_styles: string[]
}

export interface AgentLocalConfig {
  workingDirectory: string
  skills: LocalSkill[]
  agents: LocalAgent[]
  hooks: LocalHook[]
  rules: LocalRule[]
  commands: LocalCommand[]
  mcpServers: LocalMcpServer[]
  lspServers: LocalLspServer[]
  outputStyles: LocalOutputStyle[]
  plugins: LocalPlugin[]
  rolePlugin: RolePlugin | null
  globalDependencies: GlobalDependencies | null
  /** Project-scoped `.claude/settings.local.json` (author-level overrides for this agent's workdir). */
  settings: Record<string, unknown>
  /**
   * User-global `~/.claude/settings.json` (TRDD-7123d51a §3.2). Some plugin
   * enables and CLI defaults live here, outside the agent's own workdir.
   * `null` when the file is absent (fresh install or user never opened Claude
   * Code). The subconscious config-change tracker diffs this sub-tree on
   * every tick; drift emits a ledger `update` entry scoped to the agent.
   */
  userGlobalSettings: Record<string, unknown> | null
  /**
   * Project-scoped `.claude/keybindings.json` (TRDD-7123d51a §3.2).
   * `null` when the file is absent. Tracked so that keybinding edits the
   * user performs from Claude Code settings land in the ledger.
   */
  keybindings: Record<string, unknown> | null
  lastScanned: string
}
