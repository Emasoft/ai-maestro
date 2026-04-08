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

  // Map interface metadata (Codex display)
  const iface: UniversalInterface | undefined = project.pluginMeta?.interface ? {
    display_name: project.pluginMeta.interface.displayName,
    short_description: project.pluginMeta.interface.shortDescription,
    long_description: project.pluginMeta.interface.longDescription,
    developer_name: project.pluginMeta.interface.developerName,
    category: project.pluginMeta.interface.category,
    capabilities: project.pluginMeta.interface.capabilities,
    website_url: project.pluginMeta.interface.websiteURL,
    brand_color: project.pluginMeta.interface.brandColor,
    logo: project.pluginMeta.interface.logo,
    screenshots: project.pluginMeta.interface.screenshots,
  } : undefined

  const hooks: UniversalHookEntry[] = project.hooks.map(h => ({
    event: h.event,
    type: h.type as 'command' | 'http' | 'prompt' | 'agent',
    command: nu(h.command),
    url: nu(h.url),
    prompt: h.prompt,
    model: h.model,
    matcher: nu(h.matcher),
    timeout: h.timeout,
    async: h.async,
    platforms: targetPlatforms,
  }))

  const commands: UniversalCommandEntry[] = project.commands.map(c => ({
    name: c.name,
    body_file: `commands/${c.name}.md`,
    platforms: targetPlatforms,
  }))

  const mcp: UniversalMCPEntry[] = project.mcp?.servers.map(s => ({
    name: s.name,
    command: nu(s.command),
    args: nu(s.args),
    env: nu(s.env),
    cwd: nu(s.cwd),
    type: nu(s.type) as 'stdio' | 'http' | undefined,
    url: nu(s.url),
    headers: nu(s.headers),
    platforms: targetPlatforms,
  })) || []

  const resources: UniversalResourceEntry[] = (project.resources || []).map(r => ({
    relative_path: r.relativePath,
    referenced_by: 'mcp' as const,
    platforms: targetPlatforms,
  }))

  return {
    meta,
    interface: iface,
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

// ═══════════════════════════════════════════════════════════════
// Reverse Converter: UniversalPluginIR → ProjectIR
// ═══════════════════════════════════════════════════════════════

import type { SkillIR, AgentIR, HookIR, InstructionIR, CommandIR, MCPServerDef, PluginMeta } from './types'

/** Convert universal IR back to our ProjectIR for re-emission */
export function universalIRToProjectIR(ir: UniversalPluginIR): ProjectIR {
  const skills: SkillIR[] = ir.skills.map(s => ({
    name: s.name,
    description: s.description || '',
    userInvokable: s.user_invocable ?? false,
    args: s.args?.map(a => ({ name: a.name, description: a.description, required: a.required })) ?? [],
    license: s.license ?? null,
    compatibility: s.compatibility ?? null,
    metadata: s.metadata ?? null,
    allowedTools: s.allowed_tools ?? null,
    paths: s.paths ?? null,
    body: '', // body is stored in the .md file, not in the IR manifest
    references: s.references?.map(r => ({ path: r.path, content: '' })) ?? [],
    auxFiles: s.aux_files?.map(a => ({ relativePath: a.relative_path, content: '' })) ?? [],
    dirName: s.name,
    sourcePath: s.body_file,
  }))

  const agents: AgentIR[] = ir.agents.map(a => ({
    name: a.name,
    description: a.description || '',
    body: '', // stored in .md file
    model: a.model ?? null,
    temperature: a.temperature ?? null,
    reasoningEffort: a.effort ?? null,
    tools: a.tools ?? null,
    disallowedTools: a.disallowed_tools ?? null,
    permissionMode: null,
    maxTurns: a.max_turns ?? null,
    timeoutMins: null,
    background: a.background ?? false,
    isolation: a.isolation ?? null,
    mcpServers: null,
    skills: a.skills ?? null,
    hooks: null,
    memory: a.memory ?? null,
    extras: {},
    fileName: a.name,
    sourcePath: a.body_file,
  }))

  const hooks: HookIR[] = ir.hooks.map(h => ({
    event: h.event,
    type: h.type,
    command: h.command,
    url: h.url,
    prompt: h.prompt,
    model: h.model,
    matcher: h.matcher,
    timeout: h.timeout,
    async: h.async,
  }))

  const commands: CommandIR[] = ir.commands.map(c => ({
    name: c.name,
    content: '', // stored in .md file
    sourcePath: c.body_file,
  }))

  const servers: MCPServerDef[] = ir.mcp.map(m => ({
    name: m.name,
    command: m.command,
    args: m.args,
    env: m.env,
    cwd: m.cwd,
    type: m.type,
    url: m.url,
    headers: m.headers,
  }))

  const instructions: InstructionIR[] = ir.instructions.map(i => ({
    fileName: i.name,
    content: '', // stored in .md file
    isRule: i.is_rule ?? false,
    sourcePath: i.body_file,
  }))

  const pluginMeta: PluginMeta = {
    name: ir.meta.name,
    description: ir.meta.description,
    version: ir.meta.version,
    author: ir.meta.author,
    homepage: ir.meta.homepage,
    repository: ir.meta.repository,
    license: ir.meta.license,
    keywords: ir.meta.keywords,
    interface: ir.interface ? {
      displayName: ir.interface.display_name,
      shortDescription: ir.interface.short_description,
      longDescription: ir.interface.long_description,
      developerName: ir.interface.developer_name,
      category: ir.interface.category,
      capabilities: ir.interface.capabilities,
      websiteURL: ir.interface.website_url,
      brandColor: ir.interface.brand_color,
      logo: ir.interface.logo,
      screenshots: ir.interface.screenshots,
    } : undefined,
  }

  return {
    skills,
    agents,
    instructions,
    mcp: servers.length > 0 ? { servers, sourcePath: '' } : null,
    commands,
    hooks,
    pluginMeta,
    resources: ir.resources.map(r => ({ relativePath: r.relative_path, content: '' })),
    sourceProvider: (ir.meta.source_client as 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'kiro') || 'claude-code',
    rootDir: '',
  }
}
