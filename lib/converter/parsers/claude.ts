/**
 * Claude Code Parser — parses all 6 element types from a Claude project.
 *
 * Claude Code is the richest source — it supports every IR field natively.
 * Ported from crucible parsers/claude-code.js + acplugin scanner/claude.ts.
 */

import path from 'path'
import type {
  Parser, ProjectIR, SkillIR, AgentIR, InstructionIR,
  MCPIR, MCPServerDef, CommandIR, HookIR,
  PluginMeta, LSPIR, LspServerDef, OutputStyleIR, ExecutableIR
} from '../types'
import { parseSkillsDir, normalizeArgs, parseMarkdownAgentsDir, asStringOrNull, asRecordOrNull, asPathsOrNull } from './shared'
import { readFileOr, listDir } from '../utils/fs'

/** Map Claude frontmatter + body into SkillIR */
function mapSkillToIR(
  dirName: string,
  fm: Record<string, unknown>,
  body: string,
  refs: { path: string; content: string }[],
  auxFiles: { relativePath: string; content: string }[],
  sourcePath: string
): SkillIR {
  return {
    name: String(fm.name ?? dirName),
    description: String(fm.description ?? ''),
    userInvokable: Boolean(fm['user-invocable'] ?? false),
    args: normalizeArgs(fm.args),
    license: asStringOrNull(fm.license),
    compatibility: asStringOrNull(fm.compatibility),
    metadata: asRecordOrNull(fm.metadata),
    allowedTools: asStringOrNull(fm['allowed-tools']),
    paths: asPathsOrNull(fm.paths),
    body,
    references: refs,
    auxFiles,
    dirName,
    sourcePath,
  }
}

/** Scan instructions: CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md */
async function scanInstructions(rootDir: string): Promise<InstructionIR[]> {
  const instructions: InstructionIR[] = []

  for (const name of ['CLAUDE.md', '.claude/CLAUDE.md']) {
    const filePath = path.join(rootDir, name)
    const content = await readFileOr(filePath)
    if (content) {
      instructions.push({ fileName: path.basename(name), content, isRule: false, sourcePath: filePath })
    }
  }

  // Rules directory
  const rulesDir = path.join(rootDir, '.claude', 'rules')
  try {
    const { readdir } = await import('fs/promises')
    const entries = await readdir(rulesDir)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const filePath = path.join(rulesDir, entry)
      const content = await readFileOr(filePath)
      if (content) {
        instructions.push({ fileName: entry, content, isRule: true, sourcePath: filePath })
      }
    }
  } catch { /* rules dir doesn't exist */ }

  return instructions
}

/** Scan .mcp.json for MCP server definitions */
async function scanMCP(rootDir: string): Promise<MCPIR | null> {
  const mcpPath = path.join(rootDir, '.mcp.json')
  const content = await readFileOr(mcpPath)
  if (!content) return null

  try {
    const data = JSON.parse(content)
    const mcpServers = data.mcpServers || {}
    const servers: MCPServerDef[] = Object.entries(mcpServers).map(
      ([name, config]) => {
        const c = config as Record<string, unknown>
        return {
          name,
          command: c.command as string | undefined,
          args: c.args as string[] | undefined,
          env: c.env as Record<string, string> | undefined,
          type: c.type as string | undefined,
          url: c.url as string | undefined,
          headers: c.headers as Record<string, string> | undefined,
        }
      }
    )
    return { servers, sourcePath: mcpPath }
  } catch {
    return null
  }
}

/** Scan .claude/commands/ for slash commands */
async function scanCommands(rootDir: string): Promise<CommandIR[]> {
  const commandsDir = path.join(rootDir, '.claude', 'commands')
  const commands: CommandIR[] = []
  try {
    const { readdir } = await import('fs/promises')
    const entries = await readdir(commandsDir)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const filePath = path.join(commandsDir, entry)
      const content = await readFileOr(filePath)
      if (content) {
        commands.push({ name: entry.replace(/\.md$/, ''), content, sourcePath: filePath })
      }
    }
  } catch { /* commands dir doesn't exist */ }
  return commands
}

/** Scan commands/ at plugin root (flat layout) */
async function scanCommandsFlat(rootDir: string): Promise<CommandIR[]> {
  const commandsDir = path.join(rootDir, 'commands')
  const commands: CommandIR[] = []
  try {
    const { readdir } = await import('fs/promises')
    const entries = await readdir(commandsDir)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const filePath = path.join(commandsDir, entry)
      const content = await readFileOr(filePath)
      if (content) {
        commands.push({ name: entry.replace(/\.md$/, ''), content, sourcePath: filePath })
      }
    }
  } catch { /* commands dir doesn't exist */ }
  return commands
}

/** Scan hooks from .claude/settings.json */
async function scanHooks(rootDir: string): Promise<HookIR[]> {
  const hooks: HookIR[] = []

  // Try settings.json
  const settingsPath = path.join(rootDir, '.claude', 'settings.json')
  const settingsContent = await readFileOr(settingsPath)
  if (settingsContent) {
    try {
      const data = JSON.parse(settingsContent)
      if (data.hooks) {
        for (const [event, matchers] of Object.entries(data.hooks)) {
          if (!Array.isArray(matchers)) continue
          for (const matcher of matchers as Array<{ matcher?: string; hooks?: Array<{ type: string; command?: string; url?: string; prompt?: string; model?: string; timeout?: number; async?: boolean }> }>) {
            if (!matcher.hooks || !Array.isArray(matcher.hooks)) continue
            for (const hook of matcher.hooks) {
              hooks.push({
                event,
                matcher: matcher.matcher,
                type: hook.type || 'command',
                command: hook.command,
                url: hook.url,
                prompt: hook.prompt,
                model: hook.model,
                timeout: hook.timeout,
                async: hook.async,
              })
            }
          }
        }
      }
    } catch { /* invalid JSON */ }
  }

  return hooks
}

/** Scan .claude-plugin/plugin.json for plugin metadata */
async function scanPluginMeta(rootDir: string): Promise<PluginMeta | undefined> {
  const metaPath = path.join(rootDir, '.claude-plugin', 'plugin.json')
  const content = await readFileOr(metaPath)
  if (!content) return undefined
  try {
    const data = JSON.parse(content)
    return {
      name: data.name,
      description: data.description,
      version: data.version,
      author: data.author,
      homepage: data.homepage,
      repository: data.repository,
      license: data.license,
      keywords: data.keywords,
      category: data.category,
      interface: data.interface,
      userConfig: data.userConfig,
      channels: data.channels,
    }
  } catch { return undefined }
}

/** Scan .lsp.json for LSP server definitions */
async function scanLSP(rootDir: string): Promise<LSPIR | null> {
  const lspPath = path.join(rootDir, '.lsp.json')
  const content = await readFileOr(lspPath)
  if (!content) return null
  try {
    const data = JSON.parse(content) as Record<string, Record<string, unknown>>
    const servers: LspServerDef[] = Object.entries(data).map(([name, config]) => ({
      name,
      command: config.command as string,
      args: config.args as string[] | undefined,
      transport: config.transport as 'stdio' | 'socket' | undefined,
      env: config.env as Record<string, string> | undefined,
      initializationOptions: config.initializationOptions as Record<string, unknown> | undefined,
      settings: config.settings as Record<string, unknown> | undefined,
      extensionToLanguage: (config.extensionToLanguage || {}) as Record<string, string>,
      workspaceFolder: config.workspaceFolder as string | undefined,
      startupTimeout: config.startupTimeout as number | undefined,
      shutdownTimeout: config.shutdownTimeout as number | undefined,
      restartOnCrash: config.restartOnCrash as boolean | undefined,
      maxRestarts: config.maxRestarts as number | undefined,
    }))
    return { servers, sourcePath: lspPath }
  } catch { return null }
}

/** Scan output-styles/*.md for output style definitions */
async function scanOutputStyles(rootDir: string): Promise<OutputStyleIR[]> {
  const stylesDir = path.join(rootDir, 'output-styles')
  const entries = await listDir(stylesDir)
  const styles: OutputStyleIR[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const fullPath = path.join(stylesDir, entry)
    const content = await readFileOr(fullPath)
    if (content) {
      styles.push({ name: entry.replace('.md', ''), content, sourcePath: fullPath })
    }
  }
  return styles
}

/** Scan bin/ for executable files bundled with the plugin */
async function scanExecutables(rootDir: string): Promise<ExecutableIR[]> {
  const binDir = path.join(rootDir, 'bin')
  const entries = await listDir(binDir)
  const executables: ExecutableIR[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const fullPath = path.join(binDir, entry)
    const content = await readFileOr(fullPath)
    if (content) {
      executables.push({ name: entry, relativePath: `bin/${entry}`, content, sourcePath: fullPath })
    }
  }
  return executables
}

/** Scan for .agent.toml profile (role-plugin marker) */
async function scanAgentProfile(rootDir: string): Promise<ProjectIR['agentProfile']> {
  const { existsSync, readdirSync } = await import('fs')
  // Find *.agent.toml in root
  if (!existsSync(rootDir)) return undefined
  const entries = readdirSync(rootDir)
  const tomlFile = entries.find(e => e.endsWith('.agent.toml'))
  if (!tomlFile) return undefined

  const tomlPath = path.join(rootDir, tomlFile)
  const content = await readFileOr(tomlPath)
  if (!content) return undefined

  // Extract [agent].name
  const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m)
  const agentName = nameMatch?.[1] || tomlFile.replace('.agent.toml', '')

  // Extract compatible-titles
  const titlesMatch = content.match(/^\s*compatible-titles\s*=\s*\[([^\]]*)\]/m)
    || content.match(/^\s*compatible-titles\s*=\s*"([^"]*)"/m)
  const titles = titlesMatch?.[1]
    ? titlesMatch[1].replace(/["\s]/g, '').split(',').filter(Boolean)
    : []

  // Extract compatible-clients
  const clientsMatch = content.match(/^\s*compatible-clients\s*=\s*\[([^\]]*)\]/m)
    || content.match(/^\s*compatible-clients\s*=\s*"([^"]*)"/m)
  const clients = clientsMatch?.[1]
    ? clientsMatch[1].replace(/["\s]/g, '').split(',').filter(Boolean)
    : []

  return { tomlContent: content, agentName, compatibleTitles: titles, compatibleClients: clients }
}

/** Claude Code parser — all 6 element types + plugin metadata, LSP, output styles, executables */
const claudeParser: Parser = {
  providerId: 'claude-code',

  async parse(dir: string): Promise<ProjectIR> {
    // Detect layout: project (.claude/skills/) vs plugin (skills/ at root)
    const { fileExists } = await import('../utils/fs')
    const isPluginLayout = await fileExists(path.join(dir, 'skills'))
      && !await fileExists(path.join(dir, '.claude', 'skills'))

    const skillsDir = isPluginLayout
      ? path.join(dir, 'skills')
      : path.join(dir, '.claude', 'skills')
    const agentsDir = isPluginLayout
      ? path.join(dir, 'agents')
      : path.join(dir, '.claude', 'agents')

    const [skills, agents, instructions, mcp, commands, hooks, pluginMeta, lsp, outputStyles, executables, agentProfile] = await Promise.all([
      parseSkillsDir(skillsDir, mapSkillToIR),
      parseMarkdownAgentsDir(agentsDir),
      scanInstructions(dir),
      scanMCP(dir),
      isPluginLayout ? scanCommandsFlat(dir) : scanCommands(dir),
      scanHooks(dir),
      scanPluginMeta(dir),
      scanLSP(dir),
      scanOutputStyles(dir),
      scanExecutables(dir),
      scanAgentProfile(dir),
    ])

    return {
      skills,
      agents,
      instructions,
      mcp,
      commands,
      hooks,
      pluginMeta,
      lsp,
      outputStyles,
      executables,
      agentProfile,
      sourceProvider: 'claude-code',
      rootDir: dir,
    }
  },
}

export default claudeParser
