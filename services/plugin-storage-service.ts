/**
 * Plugin Storage Service — Manages ~/agents/custom-plugins/ and ~/agents/role-plugins/
 *
 * Handles conversion from source plugins to universal IR format, storage of
 * abstract + client-specific emitted formats, and re-emission to new target
 * clients on demand.
 *
 * Container model (R20.1 v3.6.0):
 *
 *   ~/agents/custom-plugins/                   ← CONTAINER, not marketplace
 *     .abstract/<plugin-name>/                 ← shared IR hub (R20.8, R20.22)
 *       plugin-universal-ir.yaml
 *       skills/<name>/SKILL.md
 *       agents/<name>.md
 *       ...
 *     marketplace-claude/                      ← Claude-schema marketplace
 *       .claude-plugin/marketplace.json
 *       <plugin-name>/
 *     marketplace-codex/                       ← Codex-schema marketplace
 *       marketplace.json
 *       <plugin-name>/
 *     marketplace-<client>/                    ← future per-client marketplaces
 *
 *   ~/agents/role-plugins/                     ← CONTAINER, not marketplace
 *     .abstract/<plugin-name>/                 ← shared IR hub (R20.9)
 *     marketplace-claude/                      ← Claude-schema role-plugin marketplace
 *       .claude-plugin/marketplace.json
 *       plugins/<role-plugin-name>/
 *     marketplace-<client>/
 *
 * The container folders themselves are NEVER registered with any client CLI —
 * only the individual marketplace-<client>/ subfolders are. Per-client
 * manifest emission lives in lib/converter/marketplace-emitters.ts.
 */

import { homedir } from 'os'
import path from 'path'
import { mkdir, writeFile, readFile, readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import type { ClientType } from '@/lib/client-capabilities'
import { clientTypeToProviderId } from '@/lib/client-capabilities'
import type { UniversalPluginIR } from '@/lib/converter/universal-ir'
import { projectIRToUniversal } from '@/lib/converter/universal-ir'
import type { ProjectIR, ConvertedFile } from '@/lib/converter/types'
import {
  CUSTOM_MARKETPLACE_NAME,
  getCustomPluginsContainerPath,
  getRolePluginsContainerPath,
  getCustomAbstractDir,
  getRoleAbstractDir,
  getCustomMarketplacePathForClient,
  getRoleMarketplacePathForClient,
} from '@/lib/ecosystem-constants'
import { writeMarketplaceManifest, type MarketplacePluginEntry } from '@/lib/converter/marketplace-emitters'

// Container roots
const CUSTOM_PLUGINS_DIR = getCustomPluginsContainerPath()
const ROLE_PLUGINS_DIR = getRolePluginsContainerPath()

// Shared IR hubs — one per container (R20.8 + R20.9 v3.6.0)
//
//   CUSTOM_ABSTRACT_DIR — ordinary plugin IR
//     ~/agents/custom-plugins/.abstract/<name>/plugin-universal-ir.yaml
//   ROLE_ABSTRACT_DIR — role-plugin IR (isolated namespace)
//     ~/agents/role-plugins/.abstract/<name>/plugin-universal-ir.yaml
const CUSTOM_ABSTRACT_DIR = getCustomAbstractDir()
const ROLE_ABSTRACT_DIR = getRoleAbstractDir()

/**
 * Resolve the correct IR hub for a plugin based on whether it is a
 * role-plugin. Used by both the writer (convertAndStorePlugin) and the
 * reader (getUniversalIR / emitForClient). When the caller doesn't know
 * the type yet, pass `null` to get the search order: role first, then
 * custom.
 */
function abstractDirForPluginType(isRolePlugin: boolean): string {
  return isRolePlugin ? ROLE_ABSTRACT_DIR : CUSTOM_ABSTRACT_DIR
}

/**
 * Locate an existing IR directory for a plugin by name. Role-plugin hub
 * is checked first (narrower namespace), then the ordinary-plugin hub.
 * Returns null if no IR exists.
 */
function findAbstractDirByName(pluginName: string): string | null {
  const roleCandidate = path.join(ROLE_ABSTRACT_DIR, pluginName)
  if (existsSync(roleCandidate)) return roleCandidate
  const customCandidate = path.join(CUSTOM_ABSTRACT_DIR, pluginName)
  if (existsSync(customCandidate)) return customCandidate
  return null
}

// ═══════════════════════════════════════════════════════════════
// IR serialization (JSON format — upgrade to YAML when js-yaml is added)
// ═══════════════════════════════════════════════════════════════

function serializeIR(ir: UniversalPluginIR): string {
  return JSON.stringify(ir, null, 2)
}

function deserializeIR(content: string): UniversalPluginIR {
  return JSON.parse(content) as UniversalPluginIR
}

// ═══════════════════════════════════════════════════════════════
// Core API
// ═══════════════════════════════════════════════════════════════

/**
 * Convert a source plugin → universal IR → store abstract + emit to target client(s).
 *
 * Flow:
 * 1. Parse source plugin dir → ProjectIR
 * 2. Convert ProjectIR → UniversalPluginIR
 * 3. Write plugin-universal-ir.yaml + provider-neutral files to .abstract/<name>/
 * 4. For each target client with plugin support: emit to custom-plugins/<client>/<name>/
 */
export async function convertAndStorePlugin(
  sourceName: string,
  sourceClient: ClientType,
  targetClients: ClientType[]
): Promise<{ abstractDir: string; emittedDirs: Record<string, string> }> {
  // 1. Find and parse the source plugin
  const sourceProviderId = clientTypeToProviderId(sourceClient)
  if (!sourceProviderId) throw new Error(`No converter for source client: ${sourceClient}`)

  const sourceDir = await findSourcePluginDir(sourceName, sourceClient)
  if (!sourceDir) throw new Error(`Source plugin "${sourceName}" not found for ${sourceClient}`)

  const { getParser } = await import('@/lib/converter/parsers')
  const parser = await getParser(sourceProviderId)
  if (!parser) throw new Error(`No parser for provider: ${sourceProviderId}`)

  const project: ProjectIR = await parser.parse(sourceDir)

  // 2. Convert to universal IR
  const targetPlatforms = targetClients.map(c => clientTypeToProviderId(c)).filter(Boolean) as string[]
  targetPlatforms.push(sourceProviderId) // include source platform
  const universalIR = projectIRToUniversal(project, targetPlatforms)
  universalIR.meta.source_plugin = sourceName
  universalIR.meta.source_client = sourceClient

  // 3. Store abstract format — picks the correct container-level IR hub
  // based on whether this is a role-plugin (R20.8 + R20.9 v3.6.0). Role
  // plugins go to ~/agents/role-plugins/.abstract/; ordinary plugins go
  // to ~/agents/custom-plugins/.abstract/.
  const isRolePlugin = universalIR.meta.is_role_plugin === true
  const abstractBaseDir = abstractDirForPluginType(isRolePlugin)
  const abstractDir = path.join(abstractBaseDir, sourceName)
  await mkdir(abstractDir, { recursive: true })

  // Write the universal IR manifest
  await writeFile(
    path.join(abstractDir, 'plugin-universal-ir.yaml'),
    serializeIR(universalIR),
    'utf-8'
  )

  // Write provider-neutral .md files
  await writeProviderNeutralFiles(abstractDir, project)

  // 4. Emit for each target client — route by plugin type
  const emittedDirs: Record<string, string> = {}

  for (const targetClient of targetClients) {
    if (isRolePlugin) {
      // Role-plugin: emit to ~/agents/role-plugins/marketplace-<client>/plugins/<name>/
      // (R20.1 v3.6.0: per-client marketplace inside the role-plugins container)
      const rolePluginName = sourceName
      const roleMarketplaceDir = getRoleMarketplacePathForClient(targetClient)
      const targetDir = path.join(roleMarketplaceDir, 'plugins', rolePluginName)

      // NEVER overwrite existing role-plugin folder
      if (existsSync(targetDir)) {
        console.warn(`[plugin-storage] Role-plugin folder already exists: ${targetDir} — conversion refused (never overwrite)`)
        continue
      }

      const emitted = await emitPluginToDir(sourceName, targetClient, targetDir)
      if (emitted) {
        // Write updated .agent.toml with new compatible-clients (the ONLY way to indicate target client)
        await writeConvertedAgentProfile(targetDir, universalIR, rolePluginName, targetClient)
        // Ensure fourfold identity
        await ensureFourfoldIdentity(targetDir, rolePluginName)
        // Register with the local roles marketplace (claude-only, legacy path)
        if (targetClient === 'claude') {
          const { ensureMarketplace, updateMarketplaceManifest } = await import('@/services/role-plugin-service')
          await ensureMarketplace()
          await updateMarketplaceManifest(rolePluginName, universalIR.meta.description || '', universalIR.meta.version)
        }
        emittedDirs[targetClient] = targetDir
      }
    } else {
      // Ordinary plugin: emit to ~/agents/custom-plugins/marketplace-<client>/<suffixedName>/
      // Per-client marketplace folder inside the custom-plugins container.
      // Name gets -<client> suffix so the plugin.json name matches its folder.
      const suffixedName = `${sourceName}-${targetClient}`
      const customMarketplaceDir = getCustomMarketplacePathForClient(targetClient)
      const targetDir = path.join(customMarketplaceDir, suffixedName)
      await mkdir(targetDir, { recursive: true })
      const emitted = await emitPluginToDir(sourceName, targetClient, targetDir)
      if (emitted) {
        await ensureCustomClientMarketplace(targetClient)
        await updateCustomClientMarketplaceManifest(
          targetClient,
          suffixedName,
          universalIR.meta.description || '',
          universalIR.meta.version
        )
        emittedDirs[targetClient] = targetDir
      }
    }
  }

  return { abstractDir, emittedDirs }
}

/**
 * Get stored universal IR for a plugin. Searches both the role-plugin hub
 * and the ordinary-plugin hub (role first, custom second). Returns null
 * if no IR exists in either location.
 */
export async function getUniversalIR(pluginName: string): Promise<UniversalPluginIR | null> {
  const abstractDir = findAbstractDirByName(pluginName)
  if (!abstractDir) return null
  const irPath = path.join(abstractDir, 'plugin-universal-ir.yaml')
  if (!existsSync(irPath)) return null

  const content = await readFile(irPath, 'utf-8')
  return deserializeIR(content)
}

/**
 * Re-emit from abstract to a specific target client.
 * Uses two strategies:
 * 1. Parse the abstract dir (Claude-like layout) with the Claude parser
 * 2. Fallback: load universal IR + reverse-convert to ProjectIR
 * Returns the path where the emitted plugin was stored, or null on failure.
 */
export async function emitForClient(
  pluginName: string,
  targetClient: ClientType
): Promise<string | null> {
  const targetProviderId = clientTypeToProviderId(targetClient)
  if (!targetProviderId) return null

  // Look in BOTH hubs — the same plugin name could be either a role-plugin
  // (role-plugins/.abstract/) or an ordinary plugin (custom-plugins/.abstract/).
  // findAbstractDirByName checks role first so role-plugins win on collision.
  const abstractDir = findAbstractDirByName(pluginName)
  if (!abstractDir) return null
  const isRolePlugin = abstractDir.startsWith(ROLE_ABSTRACT_DIR)

  const { getEmitter } = await import('@/lib/converter/emitters')
  const emitter = await getEmitter(targetProviderId)
  if (!emitter) return null

  let project: ProjectIR

  // Strategy 1: Parse the provider-neutral files directly (Claude-like layout)
  const { getParser } = await import('@/lib/converter/parsers')
  const parser = await getParser('claude-code')
  if (parser) {
    try {
      project = await parser.parse(abstractDir)
    } catch {
      // Strategy 2: Load universal IR and reverse-convert
      const ir = await getUniversalIR(pluginName)
      if (!ir) return null
      const { universalIRToProjectIR } = await import('@/lib/converter/universal-ir')
      project = universalIRToProjectIR(ir)
      project.rootDir = abstractDir
    }
  } else {
    return null
  }

  const files: ConvertedFile[] = emitter.emit(project)

  // Pick the destination container+marketplace based on plugin type.
  // Role-plugin →   ~/agents/role-plugins/marketplace-<client>/plugins/<name>/
  // Ordinary plugin → ~/agents/custom-plugins/marketplace-<client>/<name>/
  const targetDir = isRolePlugin
    ? path.join(getRoleMarketplacePathForClient(targetClient), 'plugins', pluginName)
    : path.join(getCustomMarketplacePathForClient(targetClient), pluginName)
  await mkdir(targetDir, { recursive: true })

  for (const file of files) {
    const fullPath = path.join(targetDir, file.path)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, file.content, 'utf-8')
  }

  return targetDir
}

/**
 * List all converted plugins across BOTH hubs. Role-plugin names take
 * precedence on collision — same-name entries in custom-plugins/.abstract
 * are skipped because role-plugin IR lookup already catches them (R20.9).
 */
export async function listConvertedPlugins(): Promise<{ name: string; platforms: string[] }[]> {
  const result: { name: string; platforms: string[] }[] = []
  const seen = new Set<string>()

  for (const hub of [ROLE_ABSTRACT_DIR, CUSTOM_ABSTRACT_DIR]) {
    if (!existsSync(hub)) continue
    const entries = await readdir(hub, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (seen.has(entry.name)) continue
      const ir = await getUniversalIR(entry.name)
      result.push({
        name: entry.name,
        platforms: ir?.meta.platforms || [],
      })
      seen.add(entry.name)
    }
  }

  return result
}

/**
 * Remove a converted plugin (abstract + all emitted formats).
 *
 * Walks every `marketplace-<client>/` subfolder inside the custom-plugins
 * container and removes any matching plugin folder. Also removes the
 * shared IR hub entry at the container level.
 */
export async function removeConvertedPlugin(pluginName: string): Promise<void> {
  // Remove abstract (container-level IR hub) — from BOTH hubs
  for (const hub of [ROLE_ABSTRACT_DIR, CUSTOM_ABSTRACT_DIR]) {
    const dir = path.join(hub, pluginName)
    if (existsSync(dir)) {
      await rm(dir, { recursive: true })
    }
  }

  // Remove emitted per-client marketplace entries from BOTH containers.
  // Role-plugins live under marketplace-<client>/plugins/<name>/, ordinary
  // plugins live under marketplace-<client>/<name>/ — both shapes are
  // checked so we don't leave orphans on either container.
  for (const container of [CUSTOM_PLUGINS_DIR, ROLE_PLUGINS_DIR]) {
    if (!existsSync(container)) continue
    const entries = await readdir(container, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith('marketplace-')) continue
      const marketplaceDir = path.join(container, entry.name)
      const client = entry.name.slice('marketplace-'.length)
      const candidates = [
        path.join(marketplaceDir, pluginName),                          // ordinary plugin
        path.join(marketplaceDir, `${pluginName}-${client}`),           // ordinary plugin, suffixed
        path.join(marketplaceDir, 'plugins', pluginName),               // role-plugin layout
        path.join(marketplaceDir, 'plugins', `${pluginName}-${client}`),// role-plugin suffixed (unused but safe)
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          await rm(candidate, { recursive: true })
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Public variant of findSourcePluginDir — used by ChangeClient (R18.3d) to
 * check whether a native (non-converted) version of a plugin already exists
 * for a given client. Native sources are authoritative (no information loss),
 * so they must always be preferred over conversion. Returns the absolute path
 * to the latest version directory, or null if no native source exists.
 */
export async function findNativePluginForClient(
  pluginName: string,
  targetClient: ClientType,
): Promise<string | null> {
  return findSourcePluginDir(pluginName, targetClient)
}

/**
 * Find the source plugin directory on disk.
 * Searches Claude plugin cache, local marketplace, etc.
 */
async function findSourcePluginDir(pluginName: string, sourceClient: ClientType): Promise<string | null> {
  if (sourceClient === 'claude') {
    // Check Claude plugin cache
    const cacheDir = path.join(homedir(), '.claude', 'plugins', 'cache')
    if (existsSync(cacheDir)) {
      const marketplaces = await readdir(cacheDir, { withFileTypes: true })
      for (const mp of marketplaces) {
        if (!mp.isDirectory()) continue
        const pluginDir = path.join(cacheDir, mp.name, pluginName)
        if (existsSync(pluginDir)) {
          // Find latest version
          const versions = await readdir(pluginDir, { withFileTypes: true })
          const versionDirs = versions.filter(v => v.isDirectory() && !v.name.startsWith('.'))
          if (versionDirs.length > 0) {
            // Pick latest (alphabetically last for semver)
            versionDirs.sort((a, b) => b.name.localeCompare(a.name))
            return path.join(pluginDir, versionDirs[0].name)
          }
        }
      }
    }

    // Check local role-plugins marketplace
    const localDir = path.join(homedir(), 'agents', 'role-plugins', pluginName)
    if (existsSync(localDir)) return localDir
  }

  // For other clients, check their user config dirs
  const configDirs: Record<string, string> = {
    codex: path.join(homedir(), '.codex', 'plugins', 'cache'),
    gemini: path.join(homedir(), '.gemini', 'plugins'),
    opencode: path.join(homedir(), '.opencode', 'plugins'),
    kiro: path.join(homedir(), '.kiro', 'plugins'),
  }

  const dir = configDirs[sourceClient]
  if (dir && existsSync(path.join(dir, pluginName))) {
    return path.join(dir, pluginName)
  }

  return null
}

/**
 * Write provider-neutral .md files alongside the universal IR manifest.
 * These are the actual content files (skills, agents, commands, etc.)
 * stored in a Claude-like structure for easy re-parsing.
 */
async function writeProviderNeutralFiles(abstractDir: string, project: ProjectIR): Promise<void> {
  // Skills
  for (const skill of project.skills) {
    const skillDir = path.join(abstractDir, 'skills', skill.dirName || skill.name)
    await mkdir(skillDir, { recursive: true })
    // Reconstruct SKILL.md with frontmatter
    const { stringifyFrontmatter } = await import('@/lib/converter/utils/frontmatter')
    const fm: Record<string, unknown> = {
      name: skill.name,
      description: skill.description,
    }
    if (skill.userInvokable !== undefined) fm['user-invocable'] = skill.userInvokable
    if (skill.args?.length) fm.args = skill.args
    if (skill.license) fm.license = skill.license
    if (skill.allowedTools) fm['allowed-tools'] = skill.allowedTools
    await writeFile(path.join(skillDir, 'SKILL.md'), stringifyFrontmatter(fm, skill.body), 'utf-8')

    // References
    for (const ref of skill.references || []) {
      const refPath = path.join(skillDir, ref.path)
      await mkdir(path.dirname(refPath), { recursive: true })
      await writeFile(refPath, ref.content, 'utf-8')
    }

    // Aux files
    for (const aux of skill.auxFiles || []) {
      const auxPath = path.join(skillDir, aux.relativePath)
      await mkdir(path.dirname(auxPath), { recursive: true })
      await writeFile(auxPath, aux.content, 'utf-8')
    }
  }

  // Agents
  for (const agent of project.agents) {
    const agentsDir = path.join(abstractDir, 'agents')
    await mkdir(agentsDir, { recursive: true })
    const { stringifyFrontmatter } = await import('@/lib/converter/utils/frontmatter')
    const fm: Record<string, unknown> = {
      name: agent.name,
      description: agent.description,
    }
    if (agent.model) fm.model = agent.model
    if (agent.maxTurns) fm.maxTurns = agent.maxTurns
    if (agent.tools) fm.tools = agent.tools
    if (agent.disallowedTools) fm.disallowedTools = agent.disallowedTools
    if (agent.temperature !== null && agent.temperature !== undefined) fm.temperature = agent.temperature
    if (agent.reasoningEffort) fm.effort = agent.reasoningEffort
    if (agent.skills) fm.skills = agent.skills
    if (agent.memory) fm.memory = agent.memory
    if (agent.background) fm.background = agent.background
    if (agent.isolation) fm.isolation = agent.isolation
    await writeFile(
      path.join(agentsDir, agent.fileName || `${agent.name}.md`),
      stringifyFrontmatter(fm, agent.body),
      'utf-8'
    )
  }

  // Commands
  for (const cmd of project.commands) {
    const cmdsDir = path.join(abstractDir, 'commands')
    await mkdir(cmdsDir, { recursive: true })
    await writeFile(path.join(cmdsDir, `${cmd.name}.md`), cmd.content, 'utf-8')
  }

  // Instructions
  for (const inst of project.instructions) {
    const dir = inst.isRule
      ? path.join(abstractDir, 'rules')
      : path.join(abstractDir, 'instructions')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, inst.fileName), inst.content, 'utf-8')
  }

  // MCP
  if (project.mcp && project.mcp.servers.length > 0) {
    const mcpConfig: Record<string, unknown> = {}
    for (const s of project.mcp.servers) {
      const entry: Record<string, unknown> = {}
      if (s.command) entry.command = s.command
      if (s.args) entry.args = s.args
      if (s.env && Object.keys(s.env).length > 0) entry.env = s.env
      if (s.type) entry.type = s.type
      if (s.url) entry.url = s.url
      mcpConfig[s.name] = entry
    }
    await writeFile(
      path.join(abstractDir, '.mcp.json'),
      JSON.stringify({ mcpServers: mcpConfig }, null, 2),
      'utf-8'
    )
  }

  // Hooks
  if (project.hooks.length > 0) {
    const hooksDir = path.join(abstractDir, 'hooks')
    await mkdir(hooksDir, { recursive: true })
    // Write in Claude hooks.json format (provider-neutral — all adapters can parse this)
    const hooksConfig: Record<string, unknown[]> = {}
    for (const hook of project.hooks) {
      if (!hooksConfig[hook.event]) hooksConfig[hook.event] = []
      const entry: Record<string, unknown> = { type: hook.type }
      if (hook.command) entry.command = hook.command
      if (hook.url) entry.url = hook.url
      if (hook.prompt) entry.prompt = hook.prompt
      if (hook.model) entry.model = hook.model
      if (hook.matcher) entry.matcher = hook.matcher
      if (hook.timeout) entry.timeout = hook.timeout
      if (hook.async) entry.async = hook.async
      hooksConfig[hook.event].push({
        matcher: hook.matcher,
        hooks: [entry],
      })
    }
    await writeFile(
      path.join(hooksDir, 'hooks.json'),
      JSON.stringify({ hooks: hooksConfig }, null, 2),
      'utf-8'
    )
  }

  // Resource files
  for (const res of project.resources || []) {
    const resPath = path.join(abstractDir, res.relativePath)
    await mkdir(path.dirname(resPath), { recursive: true })
    await writeFile(resPath, res.content, 'utf-8')
  }

  // Plugin manifest (for re-parsing)
  if (project.pluginMeta) {
    const metaDir = path.join(abstractDir, '.claude-plugin')
    await mkdir(metaDir, { recursive: true })
    await writeFile(
      path.join(metaDir, 'plugin.json'),
      JSON.stringify(project.pluginMeta, null, 2),
      'utf-8'
    )
  }

  // Agent profile (.agent.toml) for role-plugins
  if (project.agentProfile) {
    const tomlFileName = `${project.agentProfile.agentName}.agent.toml`
    await writeFile(path.join(abstractDir, tomlFileName), project.agentProfile.tomlContent, 'utf-8')
  }
}

// ═══════════════════════════════════════════════════════════════
// Role-plugin conversion helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Emit a plugin to a specific directory (used for role-plugins that go to ~/agents/role-plugins/).
 */
async function emitPluginToDir(
  pluginName: string, targetClient: ClientType, targetDir: string
): Promise<boolean> {
  const targetProviderId = clientTypeToProviderId(targetClient)
  if (!targetProviderId) return false

  // Resolve the IR from whichever hub contains this plugin. role-plugins/.abstract
  // is checked first (narrower namespace) per findAbstractDirByName semantics.
  const abstractDir = findAbstractDirByName(pluginName)
  if (!abstractDir) return false

  const { getParser } = await import('@/lib/converter/parsers')
  const { getEmitter } = await import('@/lib/converter/emitters')
  const parser = await getParser('claude-code')
  if (!parser) return false
  const project = await parser.parse(abstractDir)
  const emitter = await getEmitter(targetProviderId)
  if (!emitter) return false
  const files: ConvertedFile[] = emitter.emit(project)

  await mkdir(targetDir, { recursive: true })
  for (const file of files) {
    const fullPath = path.join(targetDir, file.path)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, file.content, 'utf-8')
  }
  return true
}

/**
 * Write a converted .agent.toml with updated compatible-clients for the target client.
 */
async function writeConvertedAgentProfile(
  pluginDir: string, ir: UniversalPluginIR, newPluginName: string, targetClient: ClientType
): Promise<void> {
  const originalToml = ir.extensions?.['claude-code']
  const titles = ir.meta.compatible_titles || (originalToml as Record<string, unknown>)?.compatible_titles as string[] || []
  const clients = [targetClient]

  const tomlContent = `[agent]
name = "${newPluginName}"
compatible-titles = [${titles.map(t => `"${t}"`).join(', ')}]
compatible-clients = [${clients.map(c => `"${c}"`).join(', ')}]
`
  await writeFile(path.join(pluginDir, `${newPluginName}.agent.toml`), tomlContent, 'utf-8')
}

/**
 * Ensure fourfold identity for a stored role-plugin:
 * 1. Folder name == plugin name
 * 2. <name>.agent.toml exists with matching [agent].name
 * 3. agents/<name>-main-agent.md exists with matching frontmatter
 * 4. .claude-plugin/plugin.json name matches
 */
/**
 * Enforce fourfold identity for a stored role-plugin.
 * The canonical identity is the `name` field in `.claude-plugin/plugin.json`.
 * All 4 must match:
 *   1. .claude-plugin/plugin.json `name` = the canonical name
 *   2. Folder name = canonical name
 *   3. <name>.agent.toml [agent].name = canonical name
 *   4. agents/<name>-main-agent.md frontmatter name = <name>-main-agent
 */
async function ensureFourfoldIdentity(pluginDir: string, pluginName: string): Promise<void> {
  // Check 1: Folder name — already correct (caller sets it)

  // Check 2: Plugin manifest name
  const manifestDir = path.join(pluginDir, '.claude-plugin')
  await mkdir(manifestDir, { recursive: true })
  const manifestPath = path.join(manifestDir, 'plugin.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
    if (manifest.name !== pluginName) {
      manifest.name = pluginName
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    }
  } else {
    // Create minimal manifest if missing
    await writeFile(manifestPath, JSON.stringify({ name: pluginName, version: '1.0.0' }, null, 2), 'utf-8')
  }

  // Check 3: .agent.toml — already written by writeConvertedAgentProfile with correct name

  // Check 4: Main agent file — rename to match plugin name if needed
  const mainAgentName = `${pluginName}-main-agent`
  const agentsDir = path.join(pluginDir, 'agents')
  if (existsSync(agentsDir)) {
    const agentFiles = await readdir(agentsDir)
    const mainAgent = agentFiles.find(f => f.endsWith('-main-agent.md'))
    if (mainAgent && mainAgent !== `${mainAgentName}.md`) {
      const oldPath = path.join(agentsDir, mainAgent)
      let content = await readFile(oldPath, 'utf-8')
      content = content.replace(/^name:\s*.+$/m, `name: ${mainAgentName}`)
      await writeFile(path.join(agentsDir, `${mainAgentName}.md`), content, 'utf-8')
    } else if (!mainAgent) {
      // No main agent exists yet — this is expected for freshly emitted plugins
      // The emitter should have created one; if not, warn but don't fail
      console.warn(`[fourfold] No *-main-agent.md found in ${agentsDir} — plugin may be incomplete`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Per-client marketplace management (R20.1 v3.6.0)
//
// Each per-client marketplace lives at
//   <container>/marketplace-<client>/
// and has its own manifest in its client's schema (Claude uses
// .claude-plugin/marketplace.json with string source; Codex uses
// marketplace.json at root with object source). The per-client manifest
// writer lives in lib/converter/marketplace-emitters.ts.
// ═══════════════════════════════════════════════════════════════

// User-global Claude Code settings — Claude CLI writes plugin/marketplace
// state to ~/.claude/settings.json at user scope, NOT settings.local.json.
// settings.local.json is a project-only override; it should never exist at
// the user-home level. Writing there is silent pollution (see BUG-POLLUTION-001).
const USER_GLOBAL_SETTINGS = path.join(homedir(), '.claude', 'settings.json')

async function loadJsonSafe(filePath: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(filePath, 'utf-8')) } catch { return {} }
}

async function saveJsonSafe(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/**
 * Load the current set of plugin entries from a per-client marketplace
 * manifest. Returns an empty array when the manifest doesn't exist yet.
 */
async function readCustomClientMarketplacePlugins(
  targetClient: string
): Promise<MarketplacePluginEntry[]> {
  const marketplaceDir = getCustomMarketplacePathForClient(targetClient)
  // Try both Claude and Codex manifest locations; other clients can be added
  // when their spec is implemented in marketplace-emitters.ts.
  const claudePath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json')
  const codexPath = path.join(marketplaceDir, 'marketplace.json')
  const manifestPath = existsSync(claudePath) ? claudePath : existsSync(codexPath) ? codexPath : null
  if (!manifestPath) return []

  const raw = await loadJsonSafe(manifestPath)
  const plugins = (raw.plugins || []) as unknown[]
  const out: MarketplacePluginEntry[] = []
  for (const p of plugins) {
    if (!p || typeof p !== 'object') continue
    const plug = p as Record<string, unknown>
    // Extract path whether source is a string (Claude) or object (Codex)
    let relativePath = ''
    const src = plug.source
    if (typeof src === 'string') relativePath = src
    else if (src && typeof src === 'object' && typeof (src as Record<string, unknown>).path === 'string') {
      relativePath = (src as Record<string, string>).path
    }
    out.push({
      name: String(plug.name ?? ''),
      description: String(plug.description ?? ''),
      version: String(plug.version ?? '0.0.0'),
      relativePath,
      category: typeof plug.category === 'string' ? plug.category : undefined,
    })
  }
  return out
}

/**
 * Ensure the per-client marketplace folder exists and its manifest is
 * registered with the target client's CLI.
 *
 * Only `claude` is registered automatically here because the Codex CLI
 * `plugin marketplace add` is still rolling out. Other clients are left
 * as pure folder scaffolding until their CLI lands.
 */
async function ensureCustomClientMarketplace(targetClient: string): Promise<void> {
  const marketplaceDir = getCustomMarketplacePathForClient(targetClient)
  await mkdir(marketplaceDir, { recursive: true })

  // Seed an empty manifest for this client if one doesn't exist yet.
  const existingPlugins = await readCustomClientMarketplacePlugins(targetClient)
  if (existingPlugins.length === 0) {
    await writeMarketplaceManifest(
      marketplaceDir,
      targetClient,
      `${CUSTOM_MARKETPLACE_NAME}-${targetClient}`,
      []
    )
  }

  // Register with Claude CLI only (the other clients' CLIs don't support
  // `plugin marketplace add` yet). This tracks the `source.path` in Claude's
  // user-global settings.json so the marketplace survives CLI restarts.
  if (targetClient === 'claude') {
    const settings = await loadJsonSafe(USER_GLOBAL_SETTINGS) as Record<string, Record<string, unknown>>
    const ekm = (settings.extraKnownMarketplaces || {}) as Record<string, unknown>
    const marketplaceName = `${CUSTOM_MARKETPLACE_NAME}-${targetClient}`
    const existing = ekm[marketplaceName] as Record<string, Record<string, string>> | undefined
    if (existing?.source?.path === marketplaceDir) return

    ekm[marketplaceName] = { source: { source: 'directory', path: marketplaceDir } }
    settings.extraKnownMarketplaces = ekm
    await mkdir(path.dirname(USER_GLOBAL_SETTINGS), { recursive: true })
    await saveJsonSafe(USER_GLOBAL_SETTINGS, settings)
  }
}

/**
 * Register (or update) a converted plugin inside a per-client marketplace
 * manifest. Delegates the actual schema emission to marketplace-emitters.ts
 * so each client's spec (Claude string source vs Codex object source with
 * policy/category/interface) is handled in one place.
 *
 * The relative path is `./<suffixedName>` because plugins live directly
 * inside `<container>/marketplace-<client>/<suffixedName>/` — no further
 * subfolder. This matches the marketplace-root semantics described in
 * R20.18.
 */
async function updateCustomClientMarketplaceManifest(
  targetClient: string,
  pluginName: string,
  description: string,
  version: string
): Promise<void> {
  const marketplaceDir = getCustomMarketplacePathForClient(targetClient)
  const existing = await readCustomClientMarketplacePlugins(targetClient)
  const filtered = existing.filter(p => p.name !== pluginName)
  filtered.push({
    name: pluginName,
    description,
    version,
    relativePath: `./${pluginName}`,
  })
  await writeMarketplaceManifest(
    marketplaceDir,
    targetClient,
    `${CUSTOM_MARKETPLACE_NAME}-${targetClient}`,
    filtered
  )
}
