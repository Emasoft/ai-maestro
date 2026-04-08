/**
 * Shared emitter logic: emit skills and agents to markdown files.
 * Ported from crucible emitters/shared.js + agents/emitters/shared.js.
 */

import type {
  ConvertedFile, SkillIR, AgentIR, InstructionIR,
  MCPIR, CommandIR, HookIR, ConversionProvenance, ProviderId,
  MCPServerDef, PluginResourceFile, PlatformPaths
} from '../types'
import { stringifyFrontmatter, stripClientSpecificFields } from '../utils/frontmatter'

/**
 * Emit a skill as a SKILL.md ConvertedFile.
 * Builds frontmatter from IR, applies provenance, returns file.
 */
export function emitSkill(
  skill: SkillIR,
  outputPath: string,
  options: {
    fieldsToStrip?: string[]
    extraFrontmatter?: Record<string, unknown>
    provenance?: ConversionProvenance
  } = {}
): ConvertedFile {
  const warnings: string[] = []

  // Guard: required fields must be non-empty
  if (!skill.name) warnings.push(`Skill has empty name — using dirName "${skill.dirName}"`)
  if (!skill.description) warnings.push(`Skill "${skill.name || skill.dirName}" has empty description`)
  if (skill.description && skill.description.length > 250) {
    warnings.push(`Skill "${skill.name}" description is ${skill.description.length} chars (Claude Code caps /skills listing at 250)`)
  }

  let fm: Record<string, unknown> = {
    name: skill.name || skill.dirName,
    description: skill.description || `Skill: ${skill.name || skill.dirName}`,
  }

  // Add optional fields if present
  if (skill.userInvokable) fm['user-invocable'] = skill.userInvokable
  if (skill.args.length > 0) fm.args = skill.args
  if (skill.license) fm.license = skill.license
  if (skill.compatibility) fm.compatibility = skill.compatibility
  if (skill.metadata) fm.metadata = skill.metadata
  if (skill.allowedTools) fm['allowed-tools'] = skill.allowedTools
  if (skill.paths) fm.paths = skill.paths

  // Apply extra frontmatter
  if (options.extraFrontmatter) {
    fm = { ...fm, ...options.extraFrontmatter }
  }

  // Strip client-specific fields
  if (options.fieldsToStrip) {
    fm = stripClientSpecificFields(fm, options.fieldsToStrip)
  }

  const content = stringifyFrontmatter(fm, skill.body, options.provenance)

  return { path: outputPath, content, type: 'skills', warnings }
}

/**
 * Emit a skill's auxiliary files (references, scripts, assets).
 */
export function emitSkillAuxFiles(
  skill: SkillIR,
  baseDir: string
): ConvertedFile[] {
  const files: ConvertedFile[] = []

  // References
  for (const ref of skill.references) {
    files.push({
      path: `${baseDir}/${ref.path}`,
      content: ref.content,
      type: 'skills',
      warnings: [],
    })
  }

  // Auxiliary files
  for (const aux of skill.auxFiles) {
    files.push({
      path: `${baseDir}/${aux.relativePath}`,
      content: aux.content,
      type: 'skills',
      warnings: [],
    })
  }

  return files
}

/**
 * Emit an agent as a markdown file with YAML frontmatter.
 */
export function emitMarkdownAgent(
  agent: AgentIR,
  outputPath: string,
  options: {
    fieldsToInclude?: string[]
    fieldMapping?: Record<string, string>
    provenance?: ConversionProvenance
  } = {}
): ConvertedFile {
  const warnings: string[] = []

  // Guard: required fields must be non-empty
  if (!agent.name) warnings.push(`Agent has empty name — using fileName "${agent.fileName}"`)
  if (!agent.description) warnings.push(`Agent "${agent.name || agent.fileName}" has empty description`)

  const fm: Record<string, unknown> = {
    name: agent.name || agent.fileName,
    description: agent.description || `Agent: ${agent.name || agent.fileName}`,
  }

  // Standard agent fields
  if (agent.model) fm.model = agent.model
  if (agent.temperature !== null) fm.temperature = agent.temperature
  if (agent.reasoningEffort) fm.effort = agent.reasoningEffort
  if (agent.tools) fm.tools = agent.tools
  if (agent.disallowedTools) fm.disallowedTools = agent.disallowedTools
  if (agent.permissionMode) fm.permissionMode = agent.permissionMode
  if (agent.maxTurns !== null) fm.maxTurns = agent.maxTurns
  if (agent.timeoutMins !== null) fm.timeoutMins = agent.timeoutMins
  if (agent.background) fm.background = agent.background
  if (agent.isolation) fm.isolation = agent.isolation
  if (agent.mcpServers) fm.mcpServers = agent.mcpServers
  if (agent.skills) fm.skills = agent.skills
  if (agent.hooks) fm.hooks = agent.hooks
  if (agent.memory) fm.memory = agent.memory

  // Apply field name mapping (e.g., effort → variant for OpenCode)
  if (options.fieldMapping) {
    for (const [from, to] of Object.entries(options.fieldMapping)) {
      if (fm[from] !== undefined) {
        fm[to] = fm[from]
        delete fm[from]
      }
    }
  }

  const content = stringifyFrontmatter(fm, agent.body, options.provenance)
  return { path: outputPath, content, type: 'agents', warnings }
}

/**
 * Build argument-hint string from args array.
 * Used by Codex and Copilot emitters.
 */
export function buildArgumentHint(args: { name: string; required: boolean }[]): string {
  return args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')
}

// ═══════════════════════════════════════════════════════════════
// MCP Path Transforms (from acplugin: src/converter/mcp.ts)
// ═══════════════════════════════════════════════════════════════

/**
 * Transform ${CLAUDE_PLUGIN_ROOT}/path and ${CLAUDE_PLUGIN_DATA}/path
 * to portable relative paths (./path) for non-Claude target platforms.
 */
export function transformPluginRootPaths(value: string): string {
  return value
    // Quoted: "${CLAUDE_PLUGIN_ROOT}/foo/bar" → "./foo/bar"
    .replace(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/g, '"./$1"')
    // Unquoted: ${CLAUDE_PLUGIN_ROOT}/foo → ./foo
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}\//g, './')
    // Bare: ${CLAUDE_PLUGIN_ROOT} → .
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '.')
    // Same for CLAUDE_PLUGIN_DATA
    .replace(/"\$\{CLAUDE_PLUGIN_DATA\}\/([^"]+)"/g, '"./$1"')
    .replace(/\$\{CLAUDE_PLUGIN_DATA\}\//g, './')
    .replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, '.')
}

/** Apply plugin root path transforms to all MCP server args */
export function transformMCPArgs(args: string[]): string[] {
  return args.map(transformPluginRootPaths)
}

/** Apply plugin root path transforms to all MCP server env values */
export function transformMCPEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(env)) {
    result[key] = transformPluginRootPaths(val)
  }
  return result
}

/** Transform an entire MCPServerDef's args and env in place */
export function transformMCPServerPaths(server: MCPServerDef): MCPServerDef {
  return {
    ...server,
    args: server.args ? transformMCPArgs(server.args) : server.args,
    env: server.env ? transformMCPEnv(server.env) : server.env,
    command: server.command ? transformPluginRootPaths(server.command) : server.command,
  }
}

// ═══════════════════════════════════════════════════════════════
// Plugin Resource File Scanning
// ═══════════════════════════════════════════════════════════════

import { existsSync, readFileSync, statSync, readdirSync } from 'fs'
import path from 'path'

/**
 * Scan MCP server definitions for files referenced via ${CLAUDE_PLUGIN_ROOT}.
 * Returns PluginResourceFile[] with content read from disk.
 */
export function scanMCPResourceFiles(
  servers: MCPServerDef[],
  pluginRoot: string
): PluginResourceFile[] {
  const resourcePaths = new Set<string>()

  for (const server of servers) {
    // Extract paths from args
    for (const arg of server.args || []) {
      const match = arg.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)/)
      if (match) resourcePaths.add(match[1])
    }
    // Extract paths from env values
    for (const val of Object.values(server.env || {})) {
      const match = val.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)/)
      if (match) resourcePaths.add(match[1])
    }
    // Extract paths from command
    if (server.command) {
      const match = server.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)/)
      if (match) resourcePaths.add(match[1])
    }
  }

  const resources: PluginResourceFile[] = []
  for (const relPath of resourcePaths) {
    // Clean up quotes and trailing args
    const cleanPath = relPath.replace(/^["']|["']$/g, '').split(/\s/)[0]
    const fullPath = path.resolve(pluginRoot, cleanPath)

    // Only include files that exist and are inside the plugin root
    if (!fullPath.startsWith(path.resolve(pluginRoot))) continue
    if (!existsSync(fullPath)) continue

    const stat = statSync(fullPath)
    if (stat.isFile()) {
      resources.push({ relativePath: cleanPath, content: readFileSync(fullPath, 'utf-8') })
    } else if (stat.isDirectory()) {
      // Scan directory recursively (max 3 levels) for script files
      scanDirForResources(fullPath, pluginRoot, resources, 0)
    }
  }

  return resources
}

function scanDirForResources(
  dir: string, pluginRoot: string,
  resources: PluginResourceFile[], depth: number
): void {
  if (depth > 3) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isFile()) {
      const rel = path.relative(pluginRoot, full)
      resources.push({ relativePath: rel, content: readFileSync(full, 'utf-8') })
    } else if (entry.isDirectory()) {
      scanDirForResources(full, pluginRoot, resources, depth + 1)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Platform Paths (single source of truth)
// ═══════════════════════════════════════════════════════════════

/** Output directory layout per target platform */
export const PLATFORM_PATHS: Record<ProviderId, PlatformPaths> = {
  'claude-code': {
    metaDir: '.claude-plugin',
    manifestFile: 'plugin.json',
    skills: 'skills',
    agents: 'agents',
    mcp: '.mcp.json',
  },
  'codex': {
    metaDir: '.codex-plugin',
    manifestFile: 'plugin.json',
    skills: 'skills',
    agents: '.agents',
    mcp: '.mcp.json',
  },
  'gemini': {
    metaDir: '.gemini-plugin',
    manifestFile: 'plugin.json',
    skills: '.gemini/skills',
    mcp: '.gemini/settings.json',
  },
  'opencode': {
    metaDir: '.opencode-plugin',
    manifestFile: 'plugin.json',
    skills: '.opencode/skills',
    mcp: 'opencode.json',
  },
  'kiro': {
    metaDir: '.kiro-plugin',
    manifestFile: 'plugin.json',
    skills: '.kiro/skills',
    agents: '.kiro/agents',
    mcp: '.kiro/mcp.json',
  },
}
