#!/usr/bin/env node
/**
 * Pre-deploy audit for TRDD-c7a81642 R9.13 enforcement (#239, 2026-04-20).
 *
 * Before the server-startup scan (TRDD §4.4) is activated in production,
 * run this script against the live registry to see how many agents the
 * scan WOULD auto-hibernate. If the number is surprising — especially >50%
 * of the active agents — abort the rollout: something upstream broke the
 * scan or broke the agents' .claude/settings.local.json files, not the
 * agents themselves.
 *
 * What "has a role-plugin" means here (mirrors scanAgentLocalConfig's
 * quad-match in services/agent-local-config-service.ts — kept in sync so
 * the audit's verdict matches the runtime scan's verdict):
 *   1. Agent's workingDirectory exists.
 *   2. workingDirectory/.claude/settings.local.json exists.
 *   3. enabledPlugins has >=1 plugin whose cached folder contains
 *      BOTH <name>.agent.toml AND agents/<name>-main-agent.md.
 * Absence of any of these counts as "no role-plugin".
 *
 * Usage:
 *   node scripts/audit-role-plugin-coverage.mjs
 *   node scripts/audit-role-plugin-coverage.mjs --registry /path/to/registry.json --verbose
 *
 * Output:
 *   Total agents: N
 *   With role-plugin: X
 *   Without role-plugin: Y (= WOULD be auto-hibernated at boot)
 *   Breakdown by client: claude=…, codex=…, gemini=…
 *   --verbose: per-agent table
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HOME = homedir()
const DEFAULT_REGISTRY = join(HOME, '.aimaestro', 'agents', 'registry.json')

const args = process.argv.slice(2)
const registryPath = args.includes('--registry')
  ? args[args.indexOf('--registry') + 1]
  : DEFAULT_REGISTRY
const verbose = args.includes('--verbose') || args.includes('-v')

function fail(msg) {
  console.error(`[audit] FAIL: ${msg}`)
  process.exit(1)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    return null
  }
}

function agentHasRolePlugin(agent) {
  const workDir = agent.workingDirectory
  if (!workDir || !existsSync(workDir)) return { hasPlugin: false, reason: 'workdir missing' }

  const settingsPath = join(workDir, '.claude', 'settings.local.json')
  const settings = readJson(settingsPath)
  if (!settings) return { hasPlugin: false, reason: 'settings.local.json missing or invalid' }

  const enabled = settings.enabledPlugins || {}
  // enabledPlugins entries look like "plugin-name@marketplace": true
  const pluginKeys = Object.entries(enabled).filter(([, v]) => v === true).map(([k]) => k)
  if (pluginKeys.length === 0) return { hasPlugin: false, reason: 'enabledPlugins empty' }

  for (const key of pluginKeys) {
    const [name, marketplace] = key.split('@')
    if (!name || !marketplace) continue

    // Look up the cached plugin folder. Cache layout:
    //   ~/.claude/plugins/cache/<marketplace>/<name>/
    const cacheDir = join(HOME, '.claude', 'plugins', 'cache', marketplace, name)
    if (!existsSync(cacheDir)) continue

    // Quad-match: .agent.toml at root AND main-agent .md in agents/
    const tomlPath = join(cacheDir, `${name}.agent.toml`)
    const mainAgentPath = join(cacheDir, 'agents', `${name}-main-agent.md`)
    if (existsSync(tomlPath) && existsSync(mainAgentPath)) {
      return { hasPlugin: true, plugin: name, marketplace }
    }
  }

  return { hasPlugin: false, reason: 'no enabled plugin matches quad-match' }
}

const registry = readJson(registryPath)
if (!registry) fail(`Cannot read registry at ${registryPath}`)

const agents = Array.isArray(registry.agents) ? registry.agents : []
if (agents.length === 0) {
  console.log('[audit] Registry has 0 agents. Nothing to audit.')
  process.exit(0)
}

const verdicts = agents
  .filter(a => !a.deletedAt) // skip soft-deleted
  .map(a => ({ agent: a, result: agentHasRolePlugin(a) }))

const withPlugin = verdicts.filter(v => v.result.hasPlugin)
const withoutPlugin = verdicts.filter(v => !v.result.hasPlugin)

const byClient = {}
for (const { agent, result } of verdicts) {
  const client = agent.program || 'unknown'
  if (!byClient[client]) byClient[client] = { total: 0, withPlugin: 0, withoutPlugin: 0 }
  byClient[client].total++
  if (result.hasPlugin) byClient[client].withPlugin++
  else byClient[client].withoutPlugin++
}

console.log('═══════════════════════════════════════════════════════')
console.log(' TRDD-c7a81642 R9.13 pre-deploy audit')
console.log('═══════════════════════════════════════════════════════')
console.log(`Registry:            ${registryPath}`)
console.log(`Total agents:        ${agents.length} (${agents.filter(a => a.deletedAt).length} soft-deleted excluded)`)
console.log(`Active agents:       ${verdicts.length}`)
console.log(`With role-plugin:    ${withPlugin.length}`)
console.log(`Without role-plugin: ${withoutPlugin.length}  ← would be auto-hibernated`)
console.log('───────────────────────────────────────────────────────')
console.log('Breakdown by client:')
for (const [client, s] of Object.entries(byClient)) {
  console.log(`  ${client.padEnd(20)} total=${s.total}  with=${s.withPlugin}  without=${s.withoutPlugin}`)
}

const threshold = 0.5
const pct = verdicts.length > 0 ? withoutPlugin.length / verdicts.length : 0
if (pct > threshold) {
  console.log('───────────────────────────────────────────────────────')
  console.log(`⚠  CRITICAL: ${Math.round(pct * 100)}% of agents lack a role-plugin`)
  console.log(`   This exceeds the startup-scan abort threshold (${Math.round(threshold * 100)}%).`)
  console.log(`   DO NOT deploy the startup scan until the underlying cause is fixed.`)
}

if (verbose && withoutPlugin.length > 0) {
  console.log('───────────────────────────────────────────────────────')
  console.log('Per-agent without-plugin detail:')
  for (const { agent, result } of withoutPlugin) {
    const name = agent.label || agent.name || agent.id
    const title = agent.governanceTitle || '(no title)'
    const client = agent.program || '(no client)'
    console.log(`  ${name.padEnd(30)} title=${title.padEnd(16)} client=${client.padEnd(8)} reason="${result.reason}"`)
  }
}

console.log('═══════════════════════════════════════════════════════')
process.exit(withoutPlugin.length > 0 ? 1 : 0)
