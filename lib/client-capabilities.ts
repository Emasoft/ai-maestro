/**
 * Client type detection and capability mapping.
 * Different AI coding clients support different features.
 * The profile panel adapts its visible sections based on client capabilities.
 *
 * Supported (converter + tmux launch): claude, codex, gemini, opencode, kiro
 * Deprecated: aider (kept for backward compat, CreateAgent will auto-fallback)
 */

export type ClientType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' | 'aider' | 'unknown'

/**
 * Single source of truth for the supported AI client list shown in any UI
 * dropdown that lets the user pick or change an agent's program (e.g. the
 * Program field in the Config tab — see SCEN-016.03).
 *
 * Order matters — it controls dropdown ordering. Excludes 'aider' (deprecated,
 * kept only for backward-compat detection) and 'unknown' (sentinel for
 * detection misses).
 *
 * IMPORTANT: this list MUST stay in sync with CAPABILITIES below and with
 * lib/converter/types.ts ProviderId. Adding a client here without adding
 * its capabilities entry will break getClientCapabilities() at runtime.
 */
export const SUPPORTED_CLIENTS: readonly ClientType[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
  'kiro',
] as const

import type { ProviderId } from '@/lib/converter/types'

/** Map ClientType to converter ProviderId (null if no converter support) */
export function clientTypeToProviderId(ct: ClientType): ProviderId | null {
  const map: Record<string, ProviderId> = {
    claude: 'claude-code', codex: 'codex', gemini: 'gemini',
    opencode: 'opencode', kiro: 'kiro',
  }
  return map[ct] ?? null
}

/** Map converter ProviderId back to ClientType */
export function providerIdToClientType(pid: ProviderId): ClientType {
  const map: Record<ProviderId, ClientType> = {
    'claude-code': 'claude', 'codex': 'codex', 'gemini': 'gemini',
    'opencode': 'opencode', 'kiro': 'kiro',
  }
  return map[pid] ?? 'unknown'
}

export interface ClientCapabilities {
  skills: boolean
  plugins: boolean
  /**
   * Whether the client has a "marketplaces" concept separate from plugins.
   *
   * Claude: every user-scope plugin MUST come from a registered marketplace
   *         (no exception — `claude plugin install X Y --scope user` requires
   *         marketplace Y to be added first via `claude plugin marketplace add`).
   * Codex:  HAS marketplaces. The Codex app reads repo marketplaces from
   *         `$REPO_ROOT/.agents/plugins/marketplace.json` (see the template
   *         at github.com/hon454/codex-marketplace). Standalone plugins
   *         without a marketplace ARE allowed — marketplace is an additive
   *         concept, not a requirement like Claude. Our own local
   *         codex-custom-marketplace is (or should be) a valid Codex
   *         marketplace once its manifest sits at `.agents/plugins/marketplace.json`.
   *         [Known gap 2026-04-22: services/plugin-storage-service.ts
   *         currently writes to `<root>/marketplace.json` for Codex — the
   *         manifest path migration to `.agents/plugins/marketplace.json`
   *         is tracked as a follow-up.]
   * Others: no marketplace system at all today.
   *
   * Drives the visibility of the Settings → Extensions → MARKETPLACES subtab
   * (see components/settings/GlobalElementsSection.tsx).
   */
  marketplaces: boolean
  agents: boolean
  hooks: boolean
  rules: boolean
  commands: boolean
  mcpServers: boolean
  lspServers: boolean
  rolePlugins: boolean
  /** Config file name for custom instructions */
  configFile: string
  /** Skill storage paths (project, user) */
  skillPaths: { project: string; user: string }
  /** CLI launch/session commands — used by tmux session management */
  cli: {
    binary: string                    // e.g. 'claude', 'kiro-cli', 'codex'
    resume: string                    // flag/subcommand to resume last conversation
    skipPermissions: string           // flag to bypass tool confirmations
    useAgent: string                  // flag to load an agent persona (use %s for agent name)
    exit: string                      // command typed inside client to exit
    compact: string                   // command typed inside client to compact context
    clearLine: string                 // tmux key to clear input line before sending commands
    cancel: string                    // tmux key to cancel current operation
    update: string                    // command to update the client binary
    envVars: Record<string, string>   // environment variables to prepend to launch command
    noAltScreen: string               // flag to disable alternate screen (for tmux scrollback)
  }
}

const CAPABILITIES: Record<ClientType, ClientCapabilities> = {
  claude: {
    skills: true, plugins: true, marketplaces: true, agents: true, hooks: true,
    rules: true, commands: true, mcpServers: true, lspServers: true, rolePlugins: true,
    configFile: 'CLAUDE.md',
    skillPaths: { project: '.claude/skills', user: '~/.claude/skills' },
    // Verified from: claude --help, CLAUDE.md
    cli: {
      binary: 'claude',
      resume: '--continue',
      skipPermissions: '--dangerously-skip-permissions',
      useAgent: '--agent %s',         // supports plugin:agent namespace
      exit: '/exit',
      compact: '/compact',
      clearLine: 'C-u',              // tmux send-keys notation
      cancel: 'C-c',
      update: 'claude update',
      envVars: { CLAUDE_CODE_NO_FLICKER: '1' },
      noAltScreen: '',                // not needed — claude handles tmux well
    },
  },
  codex: {
    // Codex DOES have marketplaces — see the template at
    // github.com/hon454/codex-marketplace. Standalone plugins (no marketplace)
    // are also allowed, which is different from Claude's strict require-marketplace
    // model, but the marketplace subtab is populated either way.
    skills: true, plugins: true, marketplaces: true, agents: true, hooks: false,
    rules: false, commands: false, mcpServers: true, lspServers: false, rolePlugins: false,
    configFile: 'config.toml',
    skillPaths: { project: '.codex/skills', user: '~/.codex/skills' },
    // Verified from: codex --help
    cli: {
      binary: 'codex',
      resume: 'resume --last',        // subcommand: codex resume --last
      skipPermissions: '--full-auto',  // convenience alias for sandbox + auto-approve
      useAgent: '-p %s',              // uses --profile for config profiles
      exit: '/exit',
      compact: '/compact',
      clearLine: 'C-u',
      cancel: 'C-c',
      update: 'npm update -g @openai/codex',
      envVars: {},
      noAltScreen: '--no-alt-screen', // for tmux scrollback
    },
  },
  gemini: {
    skills: true, plugins: false, marketplaces: false, agents: false, hooks: true,
    rules: false, commands: true, mcpServers: true, lspServers: false, rolePlugins: false,
    configFile: 'GEMINI.md',
    skillPaths: { project: '.gemini/skills', user: '~/.gemini/skills' },
    // Verified from: gemini --help + geminicli.com/docs/cli/system-prompt
    cli: {
      binary: 'gemini',
      resume: '-r latest',            // --resume latest
      skipPermissions: '-y',          // --yolo mode (auto-approve all)
      useAgent: '',                   // no --agent flag — use GEMINI_SYSTEM_MD env var instead
      exit: '/exit',
      compact: '/compact',
      clearLine: 'C-u',
      cancel: 'C-c',
      update: 'npm update -g @anthropic-ai/gemini-cli',
      envVars: {},                    // GEMINI_SYSTEM_MD=/path/to/agent.md added dynamically by launch builder
      noAltScreen: '',
    },
  },
  opencode: {
    skills: true, plugins: false, marketplaces: false, agents: false, hooks: false,
    rules: false, commands: false, mcpServers: true, lspServers: false, rolePlugins: false,
    configFile: 'AGENTS.md',
    skillPaths: { project: '.opencode/skills', user: '~/.opencode/skills' },
    // Verified from: opencode --help (not installed on this host)
    cli: {
      binary: 'opencode',
      resume: '',                     // no resume flag documented
      skipPermissions: '',            // no auto-approve flag documented
      useAgent: '',                   // no agent flag documented
      exit: '/exit',
      compact: '',
      clearLine: 'C-u',
      cancel: 'C-c',
      update: 'go install github.com/opencode-ai/opencode@latest',
      envVars: {},
      noAltScreen: '',
    },
  },
  kiro: {
    skills: true, plugins: false, marketplaces: false, agents: true, hooks: true,
    rules: false, commands: false, mcpServers: true, lspServers: false, rolePlugins: false,
    configFile: '.kiro/settings.json',
    skillPaths: { project: '.kiro/skills', user: '~/.kiro/skills' },
    // Verified from: kiro-cli chat --help
    cli: {
      binary: 'kiro-cli',
      resume: 'chat --resume',                // subcommand-first: kiro-cli chat --resume
      skipPermissions: 'chat --trust-all-tools',
      useAgent: 'chat --agent %s',
      exit: '/exit',
      compact: '/compact',
      clearLine: 'C-u',
      cancel: 'C-c',
      update: 'kiro-cli update --non-interactive --relaunch-dashboard false',
      envVars: {},
      noAltScreen: '',
    },
  },
  aider: {
    skills: true, plugins: false, marketplaces: false, agents: false, hooks: false,
    rules: false, commands: false, mcpServers: false, lspServers: false, rolePlugins: false,
    configFile: '.aider.conf.yml',
    skillPaths: { project: 'skills', user: '' },
    // DEPRECATED — kept for backward compat
    cli: {
      binary: 'aider',
      resume: '',
      skipPermissions: '--yes',
      useAgent: '',
      exit: '/exit',
      compact: '',
      clearLine: 'C-u',
      cancel: 'C-c',
      update: 'pip install --upgrade aider-chat',
      envVars: {},
      noAltScreen: '',
    },
  },
  unknown: {
    skills: true, plugins: false, marketplaces: false, agents: false, hooks: false,
    rules: false, commands: false, mcpServers: false, lspServers: false, rolePlugins: false,
    configFile: '',
    skillPaths: { project: '', user: '' },
    cli: {
      binary: '',
      resume: '',
      skipPermissions: '',
      useAgent: '',
      exit: '/exit',
      compact: '',
      clearLine: 'C-u',
      cancel: 'C-c',
      update: '',
      envVars: {},
      noAltScreen: '',
    },
  },
}

/** Detect client type from the program name string stored in the agent registry */
export function detectClientType(program: string): ClientType {
  if (!program) return 'unknown'
  const p = program.toLowerCase().trim()
  if (p.includes('claude')) return 'claude'
  if (p.includes('codex')) return 'codex'
  if (p.includes('gemini')) return 'gemini'
  if (p.includes('opencode')) return 'opencode'
  if (p.includes('kiro')) return 'kiro'  // binary is 'kiro-cli' on all platforms
  if (p.includes('aider')) return 'aider'  // deprecated — kept for backward compat
  return 'unknown'
}

/** Get capability set for a given program name */
export function getClientCapabilities(program: string): ClientCapabilities {
  return CAPABILITIES[detectClientType(program)]
}

/**
 * Check whether a profile-panel tab should be visible for the given client.
 * The 'settings' / 'overview' / 'advanced' top-level tabs are always visible.
 * Config sub-tabs (role, plugins, skills, etc.) map to capability flags.
 */
export function isTabSupported(tabId: string, capabilities: ClientCapabilities): boolean {
  const map: Record<string, keyof ClientCapabilities> = {
    'role': 'rolePlugins',
    'plugins': 'plugins',
    'skills': 'skills',
    'agents': 'agents',
    'hooks': 'hooks',
    'rules': 'rules',
    'commands': 'commands',
    'mcps': 'mcpServers',
    'lsp': 'lspServers',
  }
  const key = map[tabId]
  // Tabs without a capability mapping (e.g. outputStyles) are always visible
  if (!key) return true
  return capabilities[key] as boolean
}

/**
 * Build the full tmux launch command for a client session.
 * Combines binary, skip-permissions, agent persona, and any extra args.
 *
 * @param program - The program field from the agent registry (e.g. 'claude', 'kiro-cli')
 * @param options - Optional: agentName (persona), resume, extraArgs
 * @returns The full command string to run in tmux (e.g. 'kiro-cli chat --trust-all-tools --agent my-bot')
 */
export function buildLaunchCommand(
  program: string,
  options?: { agentName?: string; resume?: boolean; extraArgs?: string },
): string {
  const caps = getClientCapabilities(program)
  const cli = caps.cli
  const parts: string[] = [cli.binary || program]

  // For kiro, subcommand comes before flags (e.g. 'kiro-cli chat --trust-all-tools')
  // The skipPermissions/resume/useAgent fields already include 'chat' prefix for kiro
  if (options?.resume && cli.resume) {
    parts.push(cli.resume)
  } else if (cli.skipPermissions) {
    parts.push(cli.skipPermissions)
  }

  if (options?.agentName && cli.useAgent) {
    // Replace %s with agent name, or append if no placeholder
    const agentFlag = cli.useAgent.includes('%s')
      ? cli.useAgent.replace('%s', options.agentName)
      : `${cli.useAgent} ${options.agentName}`
    // Avoid duplicating 'chat' if already added by resume/skipPermissions
    const dedupedFlag = agentFlag.replace(/^chat\s+/, '')
    if (!parts.some(p => p.includes('chat'))) {
      parts.push(agentFlag)
    } else {
      parts.push(dedupedFlag)
    }
  }

  if (options?.extraArgs) {
    parts.push(options.extraArgs)
  }

  return parts.join(' ')
}

/**
 * Extension-subtab keys used in Settings → Extensions.
 * Stable strings chosen to match existing state keys — the COMPONENTS
 * subtab's internal key is 'elements' for URL-back-compat reasons (see
 * GlobalElementsSection.tsx 2026-04-22 refactor note).
 */
export type ExtensionSubtab = 'elements' | 'plugins' | 'marketplaces'

/**
 * Which Extensions subtabs are visible for a given client. Drives the
 * subtab bar in Settings → Extensions.
 *
 *   - COMPONENTS ('elements'): always visible. Every client has
 *     components at user scope (either standalone in ~/.<client>/skills/
 *     etc., or bundled inside installed plugins).
 *   - PLUGINS ('plugins'): visible when `capabilities.plugins === true`.
 *     Clients without a plugin system (Gemini, OpenCode, Kiro) only show
 *     COMPONENTS. (Their standalone components are all they have.)
 *   - MARKETPLACES ('marketplaces'): visible when
 *     `capabilities.marketplaces === true`. Currently Claude only.
 *     Codex flips true once its marketplace protocol stabilizes.
 *
 * Callers use this to render the subtab bar AND to refuse to load a
 * saved subtab choice that isn't supported on the current client (e.g.
 * user was last on MARKETPLACES for Claude, then switched to Gemini —
 * the saved value is ignored and Gemini lands on COMPONENTS).
 */
export function getVisibleExtensionsSubtabs(ct: ClientType): ExtensionSubtab[] {
  const caps = CAPABILITIES[ct]
  const subtabs: ExtensionSubtab[] = ['elements']  // COMPONENTS always shown
  if (caps.plugins) subtabs.push('plugins')
  if (caps.marketplaces) subtabs.push('marketplaces')
  return subtabs
}

/** Human-readable label for the detected client type */
export function clientTypeLabel(clientType: ClientType): string {
  const labels: Record<ClientType, string> = {
    claude: 'Claude Code',
    codex: 'Codex CLI',
    gemini: 'Gemini CLI',
    opencode: 'OpenCode',
    kiro: 'Kiro',
    aider: 'Aider (deprecated)',
    unknown: 'Unknown',
  }
  return labels[clientType]
}
