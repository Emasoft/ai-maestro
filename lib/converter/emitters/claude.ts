/**
 * Claude Code Emitter — emit all element types to Claude format.
 *
 * Claude Code is the richest target — nothing is lossy.
 * Ported from crucible emitters/claude-code.js.
 */

import type {
  Emitter, ProjectIR, ConvertedFile, ConversionProvenance
} from '../types'
import { emitSkill, emitSkillAuxFiles, emitMarkdownAgent } from './shared'
import { stringifyFrontmatter } from '../utils/frontmatter'

function getProvenance(sourceProvider: string): ConversionProvenance {
  return {
    from: sourceProvider as ConversionProvenance['from'],
    date: new Date().toISOString(),
  }
}

const claudeEmitter: Emitter = {
  providerId: 'claude-code',

  emit(project: ProjectIR): ConvertedFile[] {
    const files: ConvertedFile[] = []
    const provenance = project.sourceProvider !== 'claude-code'
      ? getProvenance(project.sourceProvider)
      : undefined

    // Skills
    for (const skill of project.skills) {
      const skillPath = `.claude/skills/${skill.dirName}/SKILL.md`
      files.push(emitSkill(skill, skillPath, { provenance }))
      files.push(...emitSkillAuxFiles(skill, `.claude/skills/${skill.dirName}`))
    }

    // Agents
    for (const agent of project.agents) {
      const agentPath = `.claude/agents/${agent.fileName}.md`
      files.push(emitMarkdownAgent(agent, agentPath, { provenance }))
    }

    // Instructions
    for (const instruction of project.instructions) {
      if (instruction.isRule) {
        files.push({
          path: `.claude/rules/${instruction.fileName}`,
          content: instruction.content,
          type: 'instructions',
          warnings: [],
        })
      } else {
        files.push({
          path: instruction.fileName === 'CLAUDE.md' ? 'CLAUDE.md' : `.claude/${instruction.fileName}`,
          content: instruction.content,
          type: 'instructions',
          warnings: [],
        })
      }
    }

    // MCP
    if (project.mcp && project.mcp.servers.length > 0) {
      const mcpServers: Record<string, Record<string, unknown>> = {}
      for (const server of project.mcp.servers) {
        const def: Record<string, unknown> = {}
        if (server.command) def.command = server.command
        if (server.args) def.args = server.args
        if (server.env) def.env = server.env
        if (server.url) def.url = server.url
        if (server.headers) def.headers = server.headers
        if (server.type) def.type = server.type
        mcpServers[server.name] = def
      }
      files.push({
        path: '.mcp.json',
        content: JSON.stringify({ mcpServers }, null, 2),
        type: 'mcp',
        warnings: [],
      })
    }

    // Commands
    for (const cmd of project.commands) {
      files.push({
        path: `.claude/commands/${cmd.name}.md`,
        content: cmd.content,
        type: 'commands',
        warnings: [],
      })
    }

    // Hooks
    if (project.hooks.length > 0) {
      const hooksConfig: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> = {}
      for (const hook of project.hooks) {
        if (!hooksConfig[hook.event]) {
          hooksConfig[hook.event] = []
        }
        // Group by matcher
        let group = hooksConfig[hook.event].find(g => g.matcher === hook.matcher)
        if (!group) {
          group = { matcher: hook.matcher, hooks: [] }
          hooksConfig[hook.event].push(group)
        }
        const hookDef: Record<string, unknown> = { type: hook.type }
        if (hook.command) hookDef.command = hook.command
        if (hook.url) hookDef.url = hook.url
        if (hook.prompt) hookDef.prompt = hook.prompt
        if (hook.model) hookDef.model = hook.model
        if (hook.timeout) hookDef.timeout = hook.timeout
        if (hook.async) hookDef.async = hook.async
        group.hooks.push(hookDef)
      }

      // Merge into settings.json structure
      files.push({
        path: '.claude/settings.local.json',
        content: JSON.stringify({ hooks: hooksConfig }, null, 2),
        type: 'hooks',
        warnings: ['Hooks written to .claude/settings.local.json — merge manually with existing settings'],
      })
    }

    // Emit plugin resource files
    if (project.resources) {
      for (const res of project.resources) {
        files.push({ path: res.relativePath, content: res.content, type: 'resource' as const, warnings: [] })
      }
    }

    // Plugin manifest
    if (project.pluginMeta) {
      const manifest: Record<string, unknown> = { name: project.pluginMeta.name }
      if (project.pluginMeta.version) manifest.version = project.pluginMeta.version
      if (project.pluginMeta.description) manifest.description = project.pluginMeta.description
      if (project.pluginMeta.author) manifest.author = project.pluginMeta.author
      if (project.pluginMeta.homepage) manifest.homepage = project.pluginMeta.homepage
      if (project.pluginMeta.repository) manifest.repository = project.pluginMeta.repository
      if (project.pluginMeta.license) manifest.license = project.pluginMeta.license
      if (project.pluginMeta.keywords?.length) manifest.keywords = project.pluginMeta.keywords
      files.push({ path: '.claude-plugin/plugin.json', content: JSON.stringify(manifest, null, 2), type: 'manifest' as const, warnings: [] })
    }

    // LSP server configurations
    if (project.lsp && project.lsp.servers.length > 0) {
      const lspConfig: Record<string, unknown> = {}
      for (const s of project.lsp.servers) {
        const entry: Record<string, unknown> = {
          command: s.command,
          extensionToLanguage: s.extensionToLanguage,
        }
        if (s.args) entry.args = s.args
        if (s.transport) entry.transport = s.transport
        if (s.env) entry.env = s.env
        if (s.initializationOptions) entry.initializationOptions = s.initializationOptions
        if (s.settings) entry.settings = s.settings
        if (s.workspaceFolder) entry.workspaceFolder = s.workspaceFolder
        if (s.startupTimeout) entry.startupTimeout = s.startupTimeout
        if (s.shutdownTimeout) entry.shutdownTimeout = s.shutdownTimeout
        if (s.restartOnCrash !== undefined) entry.restartOnCrash = s.restartOnCrash
        if (s.maxRestarts) entry.maxRestarts = s.maxRestarts
        lspConfig[s.name] = entry
      }
      files.push({ path: '.lsp.json', content: JSON.stringify(lspConfig, null, 2), type: 'resource' as const, warnings: [] })
    }

    // Output styles
    if (project.outputStyles) {
      for (const style of project.outputStyles) {
        files.push({ path: `output-styles/${style.name}.md`, content: style.content, type: 'resource' as const, warnings: [] })
      }
    }

    // Executables (bin/)
    if (project.executables) {
      for (const exe of project.executables) {
        files.push({ path: exe.relativePath, content: exe.content, type: 'resource' as const, warnings: [] })
      }
    }

    return files
  },
}

export default claudeEmitter
