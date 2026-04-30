/**
 * AI Maestro Ecosystem Constants
 *
 * Single source of truth for all marketplace URLs, plugin names, repo URLs,
 * filesystem paths, and ecosystem identifiers. If the project owner changes
 * repos, orgs, or directory names, only this file needs updating.
 *
 * IMPORTANT: No other file in the codebase may hardcode `.aimaestro`, marketplace
 * repo strings, or role-plugin names. Always import from this module.
 */

import { homedir } from 'os'
import { join } from 'path'

// ── State Directory ─────────────────────────────────────────

/**
 * Name of the AI Maestro state directory (under $HOME).
 * This is the SOLE source of truth — never hardcode the literal string.
 */
export const STATE_DIR_NAME = '.aimaestro'

/** Absolute path to ~/.aimaestro */
export function getStateDir(): string {
  return join(homedir(), STATE_DIR_NAME)
}

/** Path helper for a sub-path inside the state dir (e.g. statePath('agents', 'registry.json')) */
export function statePath(...segments: string[]): string {
  return join(getStateDir(), ...segments)
}

// ── Marketplace ──────────────────────────────────────────────

/** GitHub org/repo for the AI Maestro plugins marketplace */
export const MARKETPLACE_REPO = 'Emasoft/ai-maestro-plugins'

/** Marketplace name as resolved by Claude CLI (directory basename) */
export const MARKETPLACE_NAME = 'ai-maestro-plugins'

// ═════════════════════════════════════════════════════════════
// Container model (R20, v3.6.0+)
//
// ~/agents/role-plugins/   and   ~/agents/custom-plugins/    are CONTAINERS,
// NOT marketplaces. Each container holds one `marketplace-<client>/`
// subfolder per client format (marketplace-claude, marketplace-codex,
// marketplace-openrouter, …) plus a shared `.abstract/` universal IR hub.
//
// The container folder itself is NEVER registered with any client CLI.
// Only the individual marketplace-<client>/ subfolders are.
// ═════════════════════════════════════════════════════════════

/** Role-plugins CONTAINER directory name (under ~/agents/) */
export const ROLE_PLUGINS_CONTAINER_DIR_NAME = 'role-plugins'

/** Custom-plugins CONTAINER directory name (under ~/agents/) */
export const CUSTOM_PLUGINS_CONTAINER_DIR_NAME = 'custom-plugins'

/** Core-plugins CONTAINER directory name (under ~/agents/) */
export const CORE_PLUGINS_CONTAINER_DIR_NAME = 'core-plugins'

/** Shared IR hub folder name inside every container */
export const ABSTRACT_IR_DIR_NAME = '.abstract'

/**
 * Build the per-client custom-plugins marketplace folder name.
 * Claude (no prefix): `custom-marketplace`
 * Others: `<client>-custom-marketplace`
 */
export function customMarketplaceDirName(client: string): string {
  return client === 'claude' ? 'custom-marketplace' : `${client}-custom-marketplace`
}

/**
 * Build the per-client role-plugins marketplace folder name.
 * Claude (no prefix): `roles-marketplace`
 * Others: `<client>-roles-marketplace`
 */
export function rolesMarketplaceDirName(client: string): string {
  return client === 'claude' ? 'roles-marketplace' : `${client}-roles-marketplace`
}

/**
 * Build the per-client core-plugins marketplace folder name.
 * Claude: NOT stored locally (installed from remote Emasoft/ai-maestro-plugins).
 * Others: `<client>-core-marketplace`
 */
export function coreMarketplaceDirName(client: string): string {
  return `${client}-core-marketplace`
}

/**
 * @deprecated R20.3 — use customMarketplaceDirName or rolesMarketplaceDirName.
 * Kept for one migration cycle.
 */
export const MARKETPLACE_DIR_PREFIX = 'marketplace-'
/** @deprecated */
export function marketplaceDirName(client: string): string {
  return `${MARKETPLACE_DIR_PREFIX}${client}`
}

/**
 * Marketplace NAME as registered with the target client's CLI. Kept stable
 * across refactors so existing CLIs don't lose their marketplace reference.
 */
export const LOCAL_MARKETPLACE_NAME = 'ai-maestro-local-roles-marketplace'
export const CUSTOM_MARKETPLACE_NAME = 'ai-maestro-local-custom-marketplace'

/**
 * @deprecated Per R20.1 (v3.6.0), role-plugins/ is a container not a
 * marketplace. Kept as an alias for backwards-compat of old imports. Use
 * ROLE_PLUGINS_CONTAINER_DIR_NAME for the container, and
 * marketplaceDirName(client) for each per-client marketplace inside it.
 */
export const LOCAL_MARKETPLACE_DIR_NAME = ROLE_PLUGINS_CONTAINER_DIR_NAME
/** @deprecated same reason — use CUSTOM_PLUGINS_CONTAINER_DIR_NAME */
export const CUSTOM_MARKETPLACE_DIR_NAME = CUSTOM_PLUGINS_CONTAINER_DIR_NAME

// ── Container path helpers ──────────────────────────────────

/**
 * Resolve the custom-plugins CONTAINER root path: ~/agents/custom-plugins/
 *
 * Inside this container (R20.1 v3.6.0):
 *   ~/agents/custom-plugins/.abstract/<name>/       — shared IR hub (R20.8)
 *   ~/agents/custom-plugins/marketplace-claude/     — Claude marketplace
 *   ~/agents/custom-plugins/marketplace-codex/      — Codex marketplace
 *   ~/agents/custom-plugins/marketplace-<client>/   — future clients
 */
export function getCustomPluginsContainerPath(): string {
  const { homedir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  return join(homedir(), 'agents', CUSTOM_PLUGINS_CONTAINER_DIR_NAME)
}

/**
 * Resolve the role-plugins CONTAINER root path: ~/agents/role-plugins/
 * Same structure as getCustomPluginsContainerPath — but holds role-plugins.
 */
export function getRolePluginsContainerPath(): string {
  const { homedir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  return join(homedir(), 'agents', ROLE_PLUGINS_CONTAINER_DIR_NAME)
}

/**
 * Resolve a per-client marketplace folder inside the custom-plugins container.
 * Example: `getCustomMarketplacePathForClient('codex')`
 *   → `~/agents/custom-plugins/marketplace-codex/`
 */
export function getCustomMarketplacePathForClient(client: string): string {
  const { join } = require('path') as typeof import('path')
  return join(getCustomPluginsContainerPath(), customMarketplaceDirName(client))
}

/**
 * Resolve a per-client marketplace folder inside the role-plugins container.
 * Claude: ~/agents/role-plugins/roles-marketplace/
 * Codex:  ~/agents/role-plugins/codex-roles-marketplace/
 */
export function getRoleMarketplacePathForClient(client: string): string {
  const { join } = require('path') as typeof import('path')
  return join(getRolePluginsContainerPath(), rolesMarketplaceDirName(client))
}

/**
 * Resolve the core-plugins CONTAINER root path: ~/agents/core-plugins/
 *
 * Inside this container (R20.25 v3.7.0):
 *   ~/agents/core-plugins/.abstract/ai-maestro-plugin/  — shared IR hub
 *   ~/agents/core-plugins/codex-core-marketplace/        — Codex converted core plugin
 *   ~/agents/core-plugins/gemini-core-marketplace/       — Gemini converted core plugin
 *
 * Claude does NOT have a local core-marketplace — it installs from remote
 * Emasoft/ai-maestro-plugins marketplace directly.
 */
export function getCorePluginsContainerPath(): string {
  const { homedir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  return join(homedir(), 'agents', CORE_PLUGINS_CONTAINER_DIR_NAME)
}

/**
 * Resolve a per-client marketplace folder inside the core-plugins container.
 * Only used for non-Claude clients (Claude uses the remote marketplace).
 */
export function getCoreMarketplacePathForClient(client: string): string {
  const { join } = require('path') as typeof import('path')
  return join(getCorePluginsContainerPath(), coreMarketplaceDirName(client))
}

/** Shared .abstract/ IR hub inside the core-plugins container */
export function getCoreAbstractDir(): string {
  const { join } = require('path') as typeof import('path')
  return join(getCorePluginsContainerPath(), ABSTRACT_IR_DIR_NAME)
}

/** Shared .abstract/ IR hub inside the custom-plugins container */
export function getCustomAbstractDir(): string {
  const { join } = require('path') as typeof import('path')
  return join(getCustomPluginsContainerPath(), ABSTRACT_IR_DIR_NAME)
}

/** Shared .abstract/ IR hub inside the role-plugins container */
export function getRoleAbstractDir(): string {
  const { join } = require('path') as typeof import('path')
  return join(getRolePluginsContainerPath(), ABSTRACT_IR_DIR_NAME)
}

/**
 * @deprecated Per R20.1 v3.6.0 there is no single "custom marketplace path" —
 * the folder returned is now a CONTAINER that holds multiple marketplaces.
 * Use getCustomPluginsContainerPath() for the container or
 * getCustomMarketplacePathForClient(client) for a per-client marketplace.
 * Kept as an alias so legacy imports keep compiling.
 */
export function getCustomMarketplacePath(): string {
  return getCustomPluginsContainerPath()
}

/**
 * @deprecated Per R20.1 v3.6.0, role-plugins/ is a container. Use
 * getRolePluginsContainerPath() or getRoleMarketplacePathForClient(client).
 */
export function getLocalMarketplacePath(): string {
  return getRolePluginsContainerPath()
}

// ── User-Scope Plugins (from ai-maestro marketplace) ────────

/** Main AI Maestro plugin (skills, hooks, commands) */
export const MAIN_PLUGIN_NAME = 'ai-maestro-plugin'

/**
 * Single source-of-truth check for "is this the core ai-maestro-plugin?".
 *
 * Per R17 the core plugin is non-removable. Any UI guard, pipeline gate, or
 * audit that asks "should I block uninstall / hide a button / surface a
 * warning?" because of R17 MUST go through this helper rather than comparing
 * the plugin name as a string literal. Centralizing the check means a future
 * rename of MAIN_PLUGIN_NAME or marketplace alias automatically propagates
 * everywhere.
 *
 * Semantics:
 *  - When `marketplaceName` is omitted, the helper returns true purely on the
 *    plugin name match. This is the right call when the caller already knows
 *    the plugin came from a trusted source (e.g. an agent's installed-plugin
 *    list).
 *  - When `marketplaceName` is provided, it must equal the canonical
 *    `MARKETPLACE_NAME` (`ai-maestro-plugins`). A plugin called
 *    `ai-maestro-plugin` shipped from a third-party marketplace is NOT the
 *    core — it is a name collision and must not inherit R17 protection.
 */
export function isCorePlugin(pluginName: string, marketplaceName?: string): boolean {
  return pluginName === MAIN_PLUGIN_NAME && (marketplaceName === undefined || marketplaceName === MARKETPLACE_NAME)
}

/** AMP messaging plugin */
export const AMP_PLUGIN_NAME = 'claude-plugin'
export const AMP_PLUGIN_REPO = 'https://github.com/Emasoft/claude-plugin.git'

/** Cross-client skill repo (for non-Claude agents like Codex, Gemini, Aider) */
export const SKILL_PLUGIN_REPO = 'https://github.com/Emasoft/ai-maestro-plugin.git'

/** Agent Identity plugin */
export const AID_PLUGIN_NAME = 'agent-identity'
export const AID_PLUGIN_REPO = 'https://github.com/Emasoft/agent-identity.git'

// ── Role Plugins (local scope) ──────────────────────────────

export const ROLE_PLUGIN_MANAGER = 'ai-maestro-assistant-manager-agent'
export const ROLE_PLUGIN_COS = 'ai-maestro-chief-of-staff'
export const ROLE_PLUGIN_ARCHITECT = 'ai-maestro-architect-agent'
export const ROLE_PLUGIN_INTEGRATOR = 'ai-maestro-integrator-agent'
export const ROLE_PLUGIN_ORCHESTRATOR = 'ai-maestro-orchestrator-agent'
export const ROLE_PLUGIN_PROGRAMMER = 'ai-maestro-programmer-agent'
export const ROLE_PLUGIN_MAINTAINER = 'ai-maestro-maintainer-agent'
export const ROLE_PLUGIN_AUTONOMOUS = 'ai-maestro-autonomous-agent'

/** All predefined role-plugin names */
export const PREDEFINED_ROLE_PLUGIN_NAMES = [
  ROLE_PLUGIN_PROGRAMMER,
  ROLE_PLUGIN_ORCHESTRATOR,
  ROLE_PLUGIN_INTEGRATOR,
  ROLE_PLUGIN_ARCHITECT,
  ROLE_PLUGIN_COS,
  ROLE_PLUGIN_MANAGER,
  ROLE_PLUGIN_MAINTAINER,
  ROLE_PLUGIN_AUTONOMOUS,
] as const

/** Map from role-plugin name to its main agent filename */
export const ROLE_PLUGIN_MAIN_AGENTS: Record<string, string> = {
  [ROLE_PLUGIN_MANAGER]: 'amama-assistant-manager-main-agent',
  [ROLE_PLUGIN_COS]: 'ai-maestro-chief-of-staff-main-agent',
  [ROLE_PLUGIN_ARCHITECT]: 'ai-maestro-architect-agent-main-agent',
  [ROLE_PLUGIN_INTEGRATOR]: 'ai-maestro-integrator-agent-main-agent',
  [ROLE_PLUGIN_ORCHESTRATOR]: 'ai-maestro-orchestrator-agent-main-agent',
  [ROLE_PLUGIN_PROGRAMMER]: 'ai-maestro-programmer-agent-main-agent',
  [ROLE_PLUGIN_MAINTAINER]: 'ai-maestro-maintainer-agent-main-agent',
  [ROLE_PLUGIN_AUTONOMOUS]: 'ai-maestro-autonomous-agent-main-agent',
}

/** Map from governance title to its required role-plugin.
 *
 * R9.13 + R11.12 + Invariant 8: every agent MUST have a role-plugin. There
 * is no "autonomous without a plugin" path — AUTONOMOUS maps to the
 * mandatory `ai-maestro-autonomous-agent` role-plugin whose persona
 * contains the governance rules every no-team agent must follow. The
 * ChangeTitle / CreateAgent pipelines enforce this by rejecting any
 * desired state that resolves to a missing plugin.
 */
export const TITLE_PLUGIN_MAP: Record<string, string> = {
  'MANAGER': ROLE_PLUGIN_MANAGER,
  'CHIEF-OF-STAFF': ROLE_PLUGIN_COS,
  'ARCHITECT': ROLE_PLUGIN_ARCHITECT,
  'INTEGRATOR': ROLE_PLUGIN_INTEGRATOR,
  'ORCHESTRATOR': ROLE_PLUGIN_ORCHESTRATOR,
  'MEMBER': ROLE_PLUGIN_PROGRAMMER,
  'MAINTAINER': ROLE_PLUGIN_MAINTAINER,
  'AUTONOMOUS': ROLE_PLUGIN_AUTONOMOUS,
}

/** Map from role-plugin name to compatible governance titles */
export const PLUGIN_COMPATIBLE_TITLES: Record<string, string[]> = {
  [ROLE_PLUGIN_MANAGER]: ['MANAGER'],
  [ROLE_PLUGIN_COS]: ['CHIEF-OF-STAFF'],
  [ROLE_PLUGIN_ARCHITECT]: ['ARCHITECT'],
  [ROLE_PLUGIN_ORCHESTRATOR]: ['ORCHESTRATOR'],
  [ROLE_PLUGIN_INTEGRATOR]: ['INTEGRATOR'],
  [ROLE_PLUGIN_PROGRAMMER]: ['MEMBER'],
  [ROLE_PLUGIN_MAINTAINER]: ['MAINTAINER'],
  [ROLE_PLUGIN_AUTONOMOUS]: ['AUTONOMOUS'],
}

// ── Repo URLs ───────────────────────────────────────────────

/** Official AI Maestro repo */
export const AI_MAESTRO_REPO = 'https://github.com/23blocks-OS/ai-maestro'

/** Marketplace repo (fork — temporary) */
export const MARKETPLACE_REPO_URL = `https://github.com/${MARKETPLACE_REPO}`

/** Role-plugin repo URL pattern (all under Emasoft org) */
export function rolePluginRepoUrl(pluginName: string): string {
  return `https://github.com/Emasoft/${pluginName}.git`
}
