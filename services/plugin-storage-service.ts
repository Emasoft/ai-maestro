/**
 * Plugin Storage Service — Manages ~/agents/custom-plugins/
 *
 * Handles conversion from source plugins to universal IR format,
 * storage of abstract + client-specific emitted formats, and
 * re-emission to new target clients on demand.
 *
 * Storage layout:
 *   ~/agents/custom-plugins/
 *     .abstract/<plugin-name>/
 *       plugin-universal-ir.yaml
 *       skills/<name>/SKILL.md
 *       agents/<name>.md
 *       commands/<name>.md
 *       ...
 *     claude/<plugin-name>/
 *     codex/<plugin-name>/
 *     gemini/<plugin-name>/
 *     ...
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
  getLocalMarketplacePath,
} from '@/lib/ecosystem-constants'

const CUSTOM_PLUGINS_DIR = path.join(homedir(), 'agents', 'custom-plugins')
const ABSTRACT_DIR = path.join(CUSTOM_PLUGINS_DIR, '.abstract')
const ROLE_PLUGINS_DIR = getLocalMarketplacePath()
// getCustomMarketplacePath() returns ~/agents/custom-plugins/ (same as CUSTOM_PLUGINS_DIR)

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

  // 3. Store abstract format
  const abstractDir = path.join(ABSTRACT_DIR, sourceName)
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
  const isRolePlugin = universalIR.meta.is_role_plugin === true
  const emittedDirs: Record<string, string> = {}

  for (const targetClient of targetClients) {
    if (isRolePlugin) {
      // Role-plugin: emit to ~/agents/role-plugins/<name>/
      // Name stays the same — client is determined by compatible-clients in .agent.toml, NOT by name
      const rolePluginName = sourceName
      const targetDir = path.join(ROLE_PLUGINS_DIR, rolePluginName)

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
        // Register with local roles marketplace
        const { ensureMarketplace, updateMarketplaceManifest } = await import('@/services/role-plugin-service')
        await ensureMarketplace()
        await updateMarketplaceManifest(rolePluginName, universalIR.meta.description || '', universalIR.meta.version)
        emittedDirs[targetClient] = targetDir
      }
    } else {
      // Ordinary plugin: emit to ~/agents/custom-plugins/<client>/<name>-<client>/
      // Name gets -<client> suffix for ordinary plugins
      const suffixedName = `${sourceName}-${targetClient}`
      const targetDir = path.join(CUSTOM_PLUGINS_DIR, targetClient, suffixedName)
      await mkdir(targetDir, { recursive: true })
      const emitted = await emitPluginToDir(sourceName, targetClient, targetDir)
      if (emitted) {
        await ensureCustomMarketplace()
        await updateCustomMarketplaceManifest(suffixedName, universalIR.meta.description || '', universalIR.meta.version)
        emittedDirs[targetClient] = targetDir
      }
    }
  }

  return { abstractDir, emittedDirs }
}

/**
 * Get stored universal IR for a plugin.
 */
export async function getUniversalIR(pluginName: string): Promise<UniversalPluginIR | null> {
  const irPath = path.join(ABSTRACT_DIR, pluginName, 'plugin-universal-ir.yaml')
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

  const abstractDir = path.join(ABSTRACT_DIR, pluginName)
  if (!existsSync(abstractDir)) return null

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

  // Write to ~/agents/custom-plugins/<client>/<name>/
  const targetDir = path.join(CUSTOM_PLUGINS_DIR, targetClient, pluginName)
  await mkdir(targetDir, { recursive: true })

  for (const file of files) {
    const fullPath = path.join(targetDir, file.path)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, file.content, 'utf-8')
  }

  return targetDir
}

/**
 * List all converted plugins.
 */
export async function listConvertedPlugins(): Promise<{ name: string; platforms: string[] }[]> {
  if (!existsSync(ABSTRACT_DIR)) return []

  const entries = await readdir(ABSTRACT_DIR, { withFileTypes: true })
  const result: { name: string; platforms: string[] }[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const ir = await getUniversalIR(entry.name)
    result.push({
      name: entry.name,
      platforms: ir?.meta.platforms || [],
    })
  }

  return result
}

/**
 * Remove a converted plugin (abstract + all emitted formats).
 */
export async function removeConvertedPlugin(pluginName: string): Promise<void> {
  // Remove abstract
  const abstractDir = path.join(ABSTRACT_DIR, pluginName)
  if (existsSync(abstractDir)) {
    await rm(abstractDir, { recursive: true })
  }

  // Remove all emitted client dirs
  if (existsSync(CUSTOM_PLUGINS_DIR)) {
    const clients = await readdir(CUSTOM_PLUGINS_DIR, { withFileTypes: true })
    for (const client of clients) {
      if (!client.isDirectory() || client.name.startsWith('.')) continue
      const clientPluginDir = path.join(CUSTOM_PLUGINS_DIR, client.name, pluginName)
      if (existsSync(clientPluginDir)) {
        await rm(clientPluginDir, { recursive: true })
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

  const abstractDir = path.join(ABSTRACT_DIR, pluginName)
  if (!existsSync(abstractDir)) return false

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
// Custom marketplace management
// ═══════════════════════════════════════════════════════════════

const CUSTOM_META_DIR = path.join(CUSTOM_PLUGINS_DIR, '.claude-plugin')
const CUSTOM_MARKETPLACE_JSON = path.join(CUSTOM_META_DIR, 'marketplace.json')
const SETTINGS_LOCAL = path.join(homedir(), '.claude', 'settings.local.json')

async function loadJsonSafe(filePath: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(filePath, 'utf-8')) } catch { return {} }
}

async function saveJsonSafe(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/**
 * Ensure custom-plugins marketplace exists and is registered globally.
 */
async function ensureCustomMarketplace(): Promise<void> {
  await mkdir(CUSTOM_META_DIR, { recursive: true })

  if (!existsSync(CUSTOM_MARKETPLACE_JSON)) {
    const manifest = {
      name: CUSTOM_MARKETPLACE_NAME,
      version: '1.0.0',
      owner: { name: 'local' },
      metadata: { description: 'Local converted plugin marketplace managed by AI Maestro' },
      plugins: [],
    }
    await writeFile(CUSTOM_MARKETPLACE_JSON, JSON.stringify(manifest, null, 2) + '\n')
  }

  // Register in global settings
  const settings = await loadJsonSafe(SETTINGS_LOCAL) as Record<string, Record<string, unknown>>
  const ekm = (settings.extraKnownMarketplaces || {}) as Record<string, unknown>
  const existing = ekm[CUSTOM_MARKETPLACE_NAME] as Record<string, Record<string, string>> | undefined
  if (existing?.source?.path === CUSTOM_PLUGINS_DIR) return

  ekm[CUSTOM_MARKETPLACE_NAME] = { source: { source: 'directory', path: CUSTOM_PLUGINS_DIR } }
  settings.extraKnownMarketplaces = ekm
  await mkdir(path.dirname(SETTINGS_LOCAL), { recursive: true })
  await saveJsonSafe(SETTINGS_LOCAL, settings)
}

/**
 * Register a converted plugin in the custom marketplace manifest.
 */
async function updateCustomMarketplaceManifest(
  pluginName: string, description: string, version: string
): Promise<void> {
  const manifest = await loadJsonSafe(CUSTOM_MARKETPLACE_JSON) as Record<string, unknown>
  const plugins = (manifest.plugins || []) as Array<Record<string, string>>
  const filtered = plugins.filter(p => p.name !== pluginName)
  filtered.push({ name: pluginName, description, version, source: path.join(CUSTOM_PLUGINS_DIR, pluginName) })
  manifest.plugins = filtered
  await writeFile(CUSTOM_MARKETPLACE_JSON, JSON.stringify(manifest, null, 2) + '\n')
}
