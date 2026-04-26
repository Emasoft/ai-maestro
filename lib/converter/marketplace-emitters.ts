/**
 * Per-client marketplace manifest emitters + validators.
 *
 * Each client has its own marketplace spec and schema (R20.18). This module
 * is the single source of truth for those schemas. When a new client
 * publishes its marketplace spec (OpenRouter, Gemini, Kiro, ...), add a new
 * entry to MARKETPLACE_SPECS — do NOT bend an existing client's schema.
 *
 * CLAUDE spec (https://code.claude.com/docs/en/plugin-marketplaces):
 *   - Manifest at `<marketplace>/.claude-plugin/marketplace.json`
 *   - plugins[].source is a STRING "./plugin-name" (relative, starts with ./)
 *   - Resolved from the marketplace ROOT, not from .claude-plugin/
 *   - Registered via `claude plugin marketplace add <marketplace>`
 *
 * CODEX spec (https://developers.openai.com/codex/plugins/build):
 *   - Manifest at `<marketplace>/marketplace.json` (root, no subfolder)
 *   - plugins[].source is an OBJECT { source: "local", path: "./name" }
 *   - Required per-plugin fields: policy.installation, policy.authentication,
 *     category, interface (at manifest level has displayName etc)
 *   - Registered via `codex plugin marketplace add <marketplace>` (equivalent)
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

// ── Types ─────────────────────────────────────────────────────

export type MarketplaceClient = 'claude' | 'codex' | 'openrouter' | 'gemini' | 'kiro' | 'opencode' | 'cursor'

export interface MarketplacePluginEntry {
  name: string
  description: string
  version: string
  /** Relative path from marketplace root — always `./<name>` */
  relativePath: string
  /** Optional per-client extensions */
  category?: string
  author?: { name: string; email?: string }
}

export interface MarketplaceSpec {
  client: MarketplaceClient
  /** Filename of the manifest (e.g. 'marketplace.json') */
  manifestFilename: string
  /** Subfolder inside the marketplace where the manifest lives, or '' for root */
  manifestSubfolder: string
  /** Human-readable marketplace name (for the manifest `name` field) */
  defaultName: string
  /** Client CLI command to register a marketplace folder */
  cliRegisterCommand: (marketplaceDir: string) => string[]
  /** Client CLI command to refresh a registered marketplace */
  cliUpdateCommand: (marketplaceName: string) => string[]
  /** Serialize a full manifest object for this client's schema */
  serialize: (name: string, plugins: MarketplacePluginEntry[]) => string
  /** Parse + validate an existing manifest file, returning issues */
  validate: (marketplaceDir: string) => Promise<ValidationResult>
}

export interface ValidationResult {
  ok: boolean
  issues: string[]
}

// ── Claude spec ───────────────────────────────────────────────

const CLAUDE_SPEC: MarketplaceSpec = {
  client: 'claude',
  manifestFilename: 'marketplace.json',
  manifestSubfolder: '.claude-plugin',
  defaultName: 'ai-maestro-local-marketplace-claude',
  cliRegisterCommand: (dir) => ['claude', 'plugin', 'marketplace', 'add', dir],
  cliUpdateCommand: (name) => ['claude', 'plugin', 'marketplace', 'update', name],

  serialize(name, plugins) {
    return JSON.stringify({
      name,
      version: '1.0.0',
      owner: { name: 'local' },
      metadata: { description: 'AI Maestro local marketplace (Claude)' },
      plugins: plugins.map(p => ({
        name: p.name,
        description: p.description,
        version: p.version,
        source: p.relativePath, // STRING source per Claude spec
        ...(p.author ? { author: p.author } : {}),
      })),
    }, null, 2) + '\n'
  },

  async validate(marketplaceDir: string) {
    const issues: string[] = []
    const manifestPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json')
    if (!existsSync(manifestPath)) {
      return { ok: false, issues: [`Missing manifest: ${manifestPath}`] }
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf-8'))
    } catch (err) {
      return { ok: false, issues: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] }
    }
    if (!parsed.name) issues.push('Missing top-level `name`')
    if (!parsed.owner) issues.push('Missing top-level `owner`')
    const plugins = parsed.plugins
    if (!Array.isArray(plugins)) {
      issues.push('`plugins` is not an array')
      return { ok: false, issues }
    }
    for (const [i, p] of plugins.entries()) {
      if (!p || typeof p !== 'object') {
        issues.push(`plugins[${i}] is not an object`)
        continue
      }
      const plug = p as Record<string, unknown>
      if (!plug.name) issues.push(`plugins[${i}] missing name`)
      const src = plug.source
      if (typeof src !== 'string') {
        issues.push(`plugins[${i}] (${plug.name}) source must be a STRING per Claude spec`)
      } else {
        if (!src.startsWith('./')) {
          issues.push(`plugins[${i}] (${plug.name}) source must start with ./`)
        }
        if (src.includes('..')) {
          issues.push(`plugins[${i}] (${plug.name}) source contains ../ — absolute or traversal paths forbidden`)
        }
        const pluginDir = path.join(marketplaceDir, src)
        if (!existsSync(pluginDir)) {
          issues.push(`plugins[${i}] (${plug.name}) source folder does not exist: ${pluginDir}`)
        }
      }
    }
    return { ok: issues.length === 0, issues }
  },
}

// ── Codex spec ────────────────────────────────────────────────

const CODEX_SPEC: MarketplaceSpec = {
  client: 'codex',
  manifestFilename: 'marketplace.json',
  manifestSubfolder: '', // root
  defaultName: 'ai-maestro-local-marketplace-codex',
  cliRegisterCommand: (dir) => ['codex', 'plugin', 'marketplace', 'add', dir],
  cliUpdateCommand: (name) => ['codex', 'plugin', 'marketplace', 'update', name],

  serialize(name, plugins) {
    return JSON.stringify({
      name,
      interface: {
        displayName: 'AI Maestro Local (Codex)',
      },
      plugins: plugins.map(p => ({
        name: p.name,
        description: p.description,
        version: p.version,
        source: {
          source: 'local', // Codex uses OBJECT source
          path: p.relativePath,
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: p.category || 'Productivity',
      })),
    }, null, 2) + '\n'
  },

  async validate(marketplaceDir: string) {
    const issues: string[] = []
    const manifestPath = path.join(marketplaceDir, 'marketplace.json')
    if (!existsSync(manifestPath)) {
      return { ok: false, issues: [`Missing manifest: ${manifestPath}`] }
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf-8'))
    } catch (err) {
      return { ok: false, issues: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] }
    }
    if (!parsed.name) issues.push('Missing top-level `name`')
    if (!parsed.interface || typeof parsed.interface !== 'object') {
      issues.push('Missing top-level `interface` object')
    }
    const plugins = parsed.plugins
    if (!Array.isArray(plugins)) {
      issues.push('`plugins` is not an array')
      return { ok: false, issues }
    }
    for (const [i, p] of plugins.entries()) {
      if (!p || typeof p !== 'object') {
        issues.push(`plugins[${i}] is not an object`)
        continue
      }
      const plug = p as Record<string, unknown>
      if (!plug.name) issues.push(`plugins[${i}] missing name`)
      if (!plug.category) issues.push(`plugins[${i}] (${plug.name}) missing required \`category\``)

      const src = plug.source
      if (!src || typeof src !== 'object') {
        issues.push(`plugins[${i}] (${plug.name}) source must be an OBJECT per Codex spec`)
        continue
      }
      const srcObj = src as Record<string, unknown>
      if (srcObj.source !== 'local') {
        issues.push(`plugins[${i}] (${plug.name}) source.source must be "local" for directory marketplaces`)
      }
      const pth = srcObj.path
      if (typeof pth !== 'string') {
        issues.push(`plugins[${i}] (${plug.name}) source.path must be a string`)
      } else {
        if (!pth.startsWith('./')) {
          issues.push(`plugins[${i}] (${plug.name}) source.path must start with ./`)
        }
        if (pth.includes('..')) {
          issues.push(`plugins[${i}] (${plug.name}) source.path contains ../ — traversal forbidden`)
        }
        const pluginDir = path.join(marketplaceDir, pth)
        if (!existsSync(pluginDir)) {
          issues.push(`plugins[${i}] (${plug.name}) source folder does not exist: ${pluginDir}`)
        }
      }

      const policy = plug.policy
      if (!policy || typeof policy !== 'object') {
        issues.push(`plugins[${i}] (${plug.name}) missing required \`policy\` object`)
      } else {
        const pol = policy as Record<string, unknown>
        if (!pol.installation) issues.push(`plugins[${i}] (${plug.name}) missing policy.installation`)
        if (!pol.authentication) issues.push(`plugins[${i}] (${plug.name}) missing policy.authentication`)
      }
    }
    return { ok: issues.length === 0, issues }
  },
}

// ── Registry of all specs ─────────────────────────────────────

export const MARKETPLACE_SPECS: Record<MarketplaceClient, MarketplaceSpec> = {
  claude: CLAUDE_SPEC,
  codex: CODEX_SPEC,
  // Stubs for future clients — emit an error on use until filled in.
  openrouter: stubSpec('openrouter'),
  gemini: stubSpec('gemini'),
  kiro: stubSpec('kiro'),
  opencode: stubSpec('opencode'),
  cursor: stubSpec('cursor'),
}

function stubSpec(client: MarketplaceClient): MarketplaceSpec {
  return {
    client,
    manifestFilename: 'marketplace.json',
    manifestSubfolder: '',
    defaultName: `ai-maestro-local-marketplace-${client}`,
    cliRegisterCommand: () => { throw new Error(`No marketplace CLI spec yet for ${client}`) },
    cliUpdateCommand: () => { throw new Error(`No marketplace CLI spec yet for ${client}`) },
    serialize: () => { throw new Error(`No marketplace serializer yet for ${client}`) },
    validate: async () => ({ ok: false, issues: [`No validator yet for ${client}`] }),
  }
}

// ── Public API ────────────────────────────────────────────────

export function getMarketplaceSpec(client: string): MarketplaceSpec {
  const spec = MARKETPLACE_SPECS[client as MarketplaceClient]
  if (!spec) throw new Error(`Unknown marketplace client: ${client}`)
  return spec
}

/**
 * Write a manifest file for the given per-client marketplace. The manifest
 * location and serialization are chosen by the client's spec. Creates the
 * parent directory if missing.
 */
export async function writeMarketplaceManifest(
  marketplaceDir: string,
  client: string,
  marketplaceName: string,
  plugins: MarketplacePluginEntry[]
): Promise<string> {
  const spec = getMarketplaceSpec(client)
  const manifestDir = spec.manifestSubfolder
    ? path.join(marketplaceDir, spec.manifestSubfolder)
    : marketplaceDir
  await mkdir(manifestDir, { recursive: true })
  const manifestPath = path.join(manifestDir, spec.manifestFilename)
  await writeFile(manifestPath, spec.serialize(marketplaceName, plugins))
  return manifestPath
}

/**
 * Validate the manifest inside a per-client marketplace folder.
 * Returns { ok, issues[] } following the client's spec.
 */
export async function validateMarketplace(
  marketplaceDir: string,
  client: string
): Promise<ValidationResult> {
  const spec = getMarketplaceSpec(client)
  return spec.validate(marketplaceDir)
}
