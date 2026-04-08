/**
 * Universal Plugin IR — Provider-neutral intermediate representation
 * for cross-client plugin conversion.
 *
 * This is the boolean union of Claude Code + Codex + Hookbridge formats.
 * Every component type from every supported client is represented here.
 * The `platforms` field on each entry controls which clients receive it
 * during emission — entries without the target platform are skipped and
 * reported in the loss report.
 *
 * Serialized as `plugin-universal-ir.yaml` + provider-neutral `.md` files
 * in ~/agents/custom-plugins/.abstract/<plugin-name>/
 *
 * Specs:
 * - Claude: https://code.claude.com/docs/en/plugins-reference.md
 * - Codex: https://developers.openai.com/codex/plugins/build
 * - Hookbridge: https://github.com/REPOZY/Hookbridge
 */

// ═══════════════════════════════════════════════════════════════
// Meta
// ═══════════════════════════════════════════════════════════════

export interface UniversalMeta {
  name: string
  version: string
  description?: string
  author?: { name: string; email?: string; url?: string }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  /** Target platforms to compile for */
  platforms: string[]
  /** Original plugin name before conversion */
  source_plugin?: string
  /** Original client type */
  source_client?: string
  /** ISO timestamp of conversion */
  converted_at?: string
}

// ═══════════════════════════════════════════════════════════════
// Interface (Codex marketplace display metadata)
// ═══════════════════════════════════════════════════════════════

export interface UniversalInterface {
  display_name?: string
  short_description?: string
  long_description?: string
  developer_name?: string
  category?: string
  capabilities?: string[]
  website_url?: string
  privacy_policy_url?: string
  terms_of_service_url?: string
  default_prompt?: string[]
  brand_color?: string
  composer_icon?: string
  logo?: string
  screenshots?: string[]
}

// ═══════════════════════════════════════════════════════════════
// Hooks (Hookbridge format, Claude 26 events ∪ Codex 5 events)
// ═══════════════════════════════════════════════════════════════

export interface UniversalHookEntry {
  event: string
  type: 'command' | 'http' | 'prompt' | 'agent'
  command?: string
  url?: string
  prompt?: string
  model?: string
  matcher?: string
  timeout?: number
  async?: boolean
  status_message?: string  // Codex only
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Skills (Claude SKILL.md ∪ Codex SKILL.md)
// ═══════════════════════════════════════════════════════════════

export interface UniversalSkillArg {
  name: string
  description: string
  required: boolean
}

export interface UniversalSkillReference {
  path: string
  content_file: string
}

export interface UniversalSkillEntry {
  name: string
  description?: string
  user_invocable?: boolean
  args?: UniversalSkillArg[]
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowed_tools?: string
  paths?: string[]
  body_file: string
  references?: UniversalSkillReference[]
  aux_files?: { relative_path: string }[]
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Agents (Claude only)
// ═══════════════════════════════════════════════════════════════

export interface UniversalAgentEntry {
  name: string
  description?: string
  model?: string
  effort?: string
  max_turns?: number
  temperature?: number
  tools?: string[]
  disallowed_tools?: string[]
  skills?: string[]
  memory?: string
  background?: boolean
  isolation?: string
  body_file: string
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Commands (Claude only)
// ═══════════════════════════════════════════════════════════════

export interface UniversalCommandEntry {
  name: string
  description?: string
  body_file: string
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// MCP Servers (Claude + Codex)
// ═══════════════════════════════════════════════════════════════

export interface UniversalMCPEntry {
  name: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  type?: 'stdio' | 'http'
  url?: string
  headers?: Record<string, string>
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// LSP Servers (Claude only)
// ═══════════════════════════════════════════════════════════════

export interface UniversalLSPEntry {
  name: string
  command: string
  args?: string[]
  transport?: 'stdio' | 'socket'
  env?: Record<string, string>
  initialization_options?: Record<string, unknown>
  settings?: Record<string, unknown>
  extension_to_language: Record<string, string>
  workspace_folder?: string
  startup_timeout?: number
  shutdown_timeout?: number
  restart_on_crash?: boolean
  max_restarts?: number
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Output Styles (Claude only)
// ═══════════════════════════════════════════════════════════════

export interface UniversalOutputStyle {
  name: string
  body_file: string
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Instructions (Claude CLAUDE.md/rules, Codex AGENTS.md)
// ═══════════════════════════════════════════════════════════════

export interface UniversalInstructionEntry {
  name: string
  scope?: 'project' | 'global' | 'agent'
  is_rule?: boolean
  body_file: string
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Executables (Claude bin/ directory)
// ═══════════════════════════════════════════════════════════════

export interface UniversalExecutable {
  name: string
  relative_path: string
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Apps (Codex only — .app.json)
// ═══════════════════════════════════════════════════════════════

export interface UniversalAppEntry {
  name: string
  config_file: string
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// User Config (Claude userConfig — prompted at enable time)
// ═══════════════════════════════════════════════════════════════

export interface UniversalUserConfig {
  key: string
  description: string
  sensitive?: boolean
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Channels (Claude channels — message injection)
// ═══════════════════════════════════════════════════════════════

export interface UniversalChannel {
  server: string
  user_config?: UniversalUserConfig[]
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Resources (files referenced by MCP/hooks via ${PLUGIN_ROOT})
// ═══════════════════════════════════════════════════════════════

export interface UniversalResourceEntry {
  relative_path: string
  referenced_by?: 'mcp' | 'hook' | 'skill' | 'other'
  platforms: string[]
}

// ═══════════════════════════════════════════════════════════════
// Extensions (per-platform overrides — Hookbridge pattern)
// ═══════════════════════════════════════════════════════════════

export interface ClaudeExtensions {
  env_var?: string
  compatible_titles?: string[]
  compatible_clients?: string[]
  plugin_data_dir?: string
}

export interface CodexExtensions {
  install_path?: string
  apps_config?: string
  windows_hooks_supported?: boolean
}

// ═══════════════════════════════════════════════════════════════
// Complete Universal Plugin IR
// ═══════════════════════════════════════════════════════════════

export interface UniversalPluginIR {
  meta: UniversalMeta
  interface?: UniversalInterface
  hooks: UniversalHookEntry[]
  skills: UniversalSkillEntry[]
  agents: UniversalAgentEntry[]
  commands: UniversalCommandEntry[]
  mcp: UniversalMCPEntry[]
  lsp: UniversalLSPEntry[]
  output_styles: UniversalOutputStyle[]
  instructions: UniversalInstructionEntry[]
  executables: UniversalExecutable[]
  apps: UniversalAppEntry[]
  user_config: UniversalUserConfig[]
  channels: UniversalChannel[]
  resources: UniversalResourceEntry[]
  extensions: {
    'claude-code'?: ClaudeExtensions
    codex?: CodexExtensions
    [key: string]: unknown
  }
  settings?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════
// Loss Report (Hookbridge pattern)
// ═══════════════════════════════════════════════════════════════

export interface ConversionLoss {
  platform: string
  component: string
  feature: string
  severity: 'native' | 'shimmed' | 'hard-limit' | 'warn'
  reason: string
  shim_mechanism?: string
  workaround?: string
}

// ═══════════════════════════════════════════════════════════════
// Converters: ProjectIR ↔ UniversalPluginIR
// ═══════════════════════════════════════════════════════════════

import type { ProjectIR } from './types'

/** Convert null to undefined (IR uses null, universal uses undefined for optionals) */
function nu<T>(val: T | null | undefined): T | undefined {
  return val === null ? undefined : val
}

/** Convert our existing ProjectIR to the universal format */
export function projectIRToUniversal(project: ProjectIR, targetPlatforms: string[]): UniversalPluginIR {
  const meta: UniversalMeta = {
    name: project.pluginMeta?.name || 'unknown',
    version: project.pluginMeta?.version || '1.0.0',
    description: project.pluginMeta?.description,
    author: project.pluginMeta?.author,
    homepage: project.pluginMeta?.homepage,
    repository: project.pluginMeta?.repository,
    license: project.pluginMeta?.license,
    keywords: project.pluginMeta?.keywords,
    platforms: targetPlatforms,
    source_client: project.sourceProvider,
    converted_at: new Date().toISOString(),
  }

  const skills: UniversalSkillEntry[] = project.skills.map(s => ({
    name: s.name,
    description: s.description,
    user_invocable: s.userInvokable,
    args: nu(s.args)?.map(a => ({ name: a.name, description: a.description, required: a.required })),
    license: nu(s.license),
    compatibility: nu(s.compatibility),
    metadata: nu(s.metadata),
    allowed_tools: nu(s.allowedTools),
    paths: nu(s.paths),
    body_file: `skills/${s.dirName || s.name}/SKILL.md`,
    references: nu(s.references)?.map(r => ({ path: r.path, content_file: r.path })),
    aux_files: nu(s.auxFiles)?.map(a => ({ relative_path: a.relativePath })),
    platforms: targetPlatforms,
  }))

  const agents: UniversalAgentEntry[] = project.agents.map(a => ({
    name: a.name,
    description: a.description,
    model: a.model || undefined,
    max_turns: a.maxTurns || undefined,
    temperature: a.temperature || undefined,
    tools: a.tools || undefined,
    disallowed_tools: a.disallowedTools || undefined,
    skills: a.skills || undefined,
    memory: a.memory || undefined,
    background: a.background || undefined,
    isolation: a.isolation || undefined,
    body_file: `agents/${a.fileName || a.name}.md`,
    platforms: targetPlatforms,
  }))

  const hooks: UniversalHookEntry[] = project.hooks.map(h => ({
    event: h.event,
    type: h.type as 'command' | 'http' | 'prompt' | 'agent',
    command: h.command,
    url: h.url,
    matcher: h.matcher,
    platforms: targetPlatforms,
  }))

  const commands: UniversalCommandEntry[] = project.commands.map(c => ({
    name: c.name,
    body_file: `commands/${c.name}.md`,
    platforms: targetPlatforms,
  }))

  const mcp: UniversalMCPEntry[] = project.mcp?.servers.map(s => ({
    name: s.name,
    command: s.command,
    args: s.args,
    env: s.env,
    type: s.type as 'stdio' | 'http' | undefined,
    url: s.url,
    headers: s.headers,
    platforms: targetPlatforms,
  })) || []

  const resources: UniversalResourceEntry[] = (project.resources || []).map(r => ({
    relative_path: r.relativePath,
    referenced_by: 'mcp' as const,
    platforms: targetPlatforms,
  }))

  return {
    meta,
    hooks,
    skills,
    agents,
    commands,
    mcp,
    lsp: [],
    output_styles: [],
    instructions: project.instructions.map(i => ({
      name: i.fileName,
      scope: i.isRule ? 'agent' as const : 'project' as const,
      is_rule: i.isRule,
      body_file: i.isRule ? `rules/${i.fileName}` : `instructions/${i.fileName}`,
      platforms: targetPlatforms,
    })),
    executables: [],
    apps: [],
    user_config: [],
    channels: [],
    resources,
    extensions: {},
  }
}
