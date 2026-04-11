/**
 * GET /api/settings/host-tools — Diagnose installation status of each host tool
 * POST /api/settings/host-tools — Execute an install/update script
 *
 * Tools are scripts that configure this host for AI Maestro:
 * hooks, tmux config, status line, messaging, agent CLI, etc.
 */

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const HOME = os.homedir()
const PROJECT_ROOT = process.cwd()

interface ToolDef {
  id: string
  name: string
  description: string
  /** Script path relative to project root */
  script: string
  /** Extra args appended when running from the UI (always includes --force for updates) */
  runArgs: string[]
  /** Confirmation message shown before running */
  confirmMessage: string
  /** Function that returns installation status */
  diagnose: () => ToolStatus
}

type ToolStatus = 'installed' | 'outdated' | 'missing' | 'partial' | 'error'

function fileExists(p: string): boolean {
  return existsSync(p)
}

function grepFile(filePath: string, pattern: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf8')
    return content.includes(pattern)
  } catch {
    return false
  }
}

function binExists(name: string): boolean {
  return fileExists(path.join(HOME, '.local', 'bin', name))
}

/** Check if hooks are installed in settings.json and point to the comprehensive script.
 *  Reads the file once to avoid TOCTOU races between string checks and JSON parse. */
function diagnoseHooks(): ToolStatus {
  // As of ai-maestro-plugin v2.x (Apr 2026), the hooks live inside the
  // plugin cache, NOT in ~/.claude/settings.json at user scope. Claude
  // Code loads them at runtime from the enabled plugin's hooks/hooks.json.
  //
  // This diagnostic checks, in order of preference:
  //   1. Is ai-maestro-plugin present in ~/.claude/plugins/cache/ai-maestro-plugins/?
  //      If yes, inspect its latest version's hooks/hooks.json.
  //   2. Is the plugin enabled in ~/.claude/settings.json (plugins field)?
  //   3. LEGACY: is the old user-scope hook entry still in settings.json?

  const pluginCacheDir = path.join(HOME, '.claude', 'plugins', 'cache', 'ai-maestro-plugins', 'ai-maestro-plugin')
  if (fileExists(pluginCacheDir)) {
    // Find the latest version dir
    let latestVersion: string | null = null
    try {
      const { readdirSync } = require('fs') as typeof import('fs')
      const versions = readdirSync(pluginCacheDir).filter((v: string) => /^\d+\.\d+\.\d+$/.test(v)).sort()
      latestVersion = versions[versions.length - 1] || null
    } catch { /* fall through */ }

    if (latestVersion) {
      const hooksJsonPath = path.join(pluginCacheDir, latestVersion, 'hooks', 'hooks.json')
      if (fileExists(hooksJsonPath)) {
        try {
          const content = readFileSync(hooksJsonPath, 'utf8')
          const data = JSON.parse(content)
          const eventCount = Object.keys(data.hooks || {}).length
          if (eventCount >= 3) return 'installed'
          return 'outdated'
        } catch {
          return 'error'
        }
      }
    }
  }

  // LEGACY fallback: old user-scope installation
  const settingsPath = path.join(HOME, '.claude', 'settings.json')
  if (!fileExists(settingsPath)) return 'missing'

  let content: string
  try {
    content = readFileSync(settingsPath, 'utf8')
  } catch {
    return 'error'
  }
  if (content.includes('ai-maestro-hook')) return 'installed'
  return 'missing'
}

function diagnoseTmux(): ToolStatus {
  const tmuxConf = path.join(HOME, '.tmux.conf')
  if (!fileExists(tmuxConf)) return 'missing'
  return grepFile(tmuxConf, 'AI Maestro Configuration') ? 'installed' : 'missing'
}

function diagnoseStatusLine(): ToolStatus {
  const settingsPath = path.join(HOME, '.claude', 'settings.json')
  if (!fileExists(settingsPath)) return 'missing'
  return grepFile(settingsPath, 'statusLine') ? 'installed' : 'missing'
}

function diagnoseMessaging(): ToolStatus {
  const required = ['amp-send.sh', 'amp-inbox.sh', 'amp-read.sh', 'amp-init.sh']
  const found = required.filter(binExists)
  if (found.length === 0) return 'missing'
  if (found.length < required.length) return 'partial'
  return 'installed'
}

function diagnoseAgentCli(): ToolStatus {
  return binExists('aimaestro-agent.sh') ? 'installed' : 'missing'
}

function diagnoseDocTools(): ToolStatus {
  const required = ['docs-search.sh', 'docs-list.sh', 'docs-get.sh']
  const found = required.filter(binExists)
  if (found.length === 0) return 'missing'
  if (found.length < required.length) return 'partial'
  return 'installed'
}

function diagnoseGraphTools(): ToolStatus {
  const required = ['graph-describe.sh', 'graph-find-callers.sh', 'graph-index-delta.sh']
  const found = required.filter(binExists)
  if (found.length === 0) return 'missing'
  if (found.length < required.length) return 'partial'
  return 'installed'
}

function diagnoseMemoryTools(): ToolStatus {
  return binExists('memory-search.sh') ? 'installed' : 'missing'
}

function diagnoseTailscaleServe(): ToolStatus {
  try {
    // Check if tailscale is installed — use execFileSync to avoid shell injection
    execFileSync('which', ['tailscale'], { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    return 'missing' // tailscale not installed
  }
  try {
    // Check if tailscale is running
    execFileSync('tailscale', ['status'], { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    console.error('[host-tools] tailscale status check failed:', err instanceof Error ? err.message : String(err))
    return 'error' // tailscale not running
  }
  try {
    // Check serve status
    const status = execFileSync('tailscale', ['serve', 'status', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
    const config = JSON.parse(status)
    // Check for HTTP/Web serve mode (correct) or TCP mode (outdated)
    if (config.Web && Object.keys(config.Web).length > 0) return 'installed'
    if (config.TCP && Object.keys(config.TCP).length > 0) return 'outdated' // TCP mode, needs upgrade to HTTP
    return 'missing' // no serve config
  } catch (err) {
    console.error('[host-tools] tailscale serve status check failed:', err instanceof Error ? err.message : String(err))
    return 'missing'
  }
}

const TOOLS: ToolDef[] = [
  {
    id: 'tailscale-serve',
    name: 'Tailscale VPN Access',
    description: 'Configures tailscale serve so the dashboard is accessible from any device in your Tailscale VPN (iPad, phone, laptop). Runs automatically on startup.',
    script: 'scripts/setup-tailscale-serve.sh',
    runArgs: [],
    confirmMessage: 'This will configure tailscale serve to proxy VPN traffic to the AI Maestro dashboard. Requires Tailscale to be installed and running. Any existing tailscale serve config for port 23000 will be replaced.',
    diagnose: diagnoseTailscaleServe,
  },
  {
    id: 'hooks',
    name: 'Claude Code Hooks',
    description: 'Session tracking, activity status, and message notifications. Installed automatically via the ai-maestro-plugin (user scope). To update, run: claude plugin update ai-maestro-plugin@ai-maestro-plugins',
    // No install script — hooks are provisioned by the plugin itself.
    // Left empty intentionally; the UI should show this as an informational
    // tool, not a runnable one.
    script: '',
    runArgs: [],
    confirmMessage: 'Hooks are installed automatically as part of ai-maestro-plugin. There is nothing to run manually here.',
    diagnose: diagnoseHooks,
  },
  {
    id: 'tmux',
    name: 'tmux Configuration',
    description: 'Mouse support, scrollback buffer (50K lines), 256-color terminal. Appends to ~/.tmux.conf without overwriting.',
    script: 'scripts/setup-tmux.sh',
    runArgs: [],
    confirmMessage: 'This will append AI Maestro settings to ~/.tmux.conf. If the section already exists, nothing will change.',
    diagnose: diagnoseTmux,
  },
  {
    id: 'statusline',
    name: 'AMP Status Line',
    description: 'Shows agent identity, unread message count, model, context usage, and cost in the Claude Code status bar.',
    script: 'scripts/amp-statusline.sh',
    runArgs: ['--install'],
    confirmMessage: 'This will set the Claude Code status line to the AMP status line. If a status line is already configured, it will be replaced.',
    diagnose: diagnoseStatusLine,
  },
  {
    id: 'messaging',
    name: 'AMP Messaging Scripts',
    description: 'Agent Messaging Protocol CLI tools (amp-send, amp-inbox, amp-read, etc.) installed to ~/.local/bin/.',
    script: 'install-messaging.sh',
    runArgs: ['-y'],
    confirmMessage: 'This will install/update AMP scripts and the AI Maestro plugin. Scripts in ~/.local/bin/ will be overwritten with the latest versions.',
    diagnose: diagnoseMessaging,
  },
  {
    id: 'agent-cli',
    name: 'Agent CLI (aimaestro-agent)',
    description: 'CLI for creating, hibernating, waking, listing, and managing agents. Installed to ~/.local/bin/.',
    script: 'install-agent-cli.sh',
    runArgs: ['-y'],
    confirmMessage: 'This will install/update the aimaestro-agent CLI tool and its modules to ~/.local/bin/.',
    diagnose: diagnoseAgentCli,
  },
  {
    id: 'doc-tools',
    name: 'Documentation Tools',
    description: 'Auto-generated documentation index, search, and browse scripts (docs-search, docs-list, etc.).',
    script: 'install-doc-tools.sh',
    runArgs: ['-y'],
    confirmMessage: 'This will install/update documentation tools to ~/.local/bin/.',
    diagnose: diagnoseDocTools,
  },
  {
    id: 'graph-tools',
    name: 'Code Graph Tools',
    description: 'CozoDB-backed code graph scripts for call graphs, symbol relationships, and semantic queries.',
    script: 'install-graph-tools.sh',
    runArgs: ['-y'],
    confirmMessage: 'This will install/update code graph tools to ~/.local/bin/.',
    diagnose: diagnoseGraphTools,
  },
  {
    id: 'memory-tools',
    name: 'Memory Search Tools',
    description: 'Semantic search over conversation history (memory-search). Requires subconscious indexing.',
    script: 'install-memory-tools.sh',
    runArgs: ['-y'],
    confirmMessage: 'This will install/update memory search tools to ~/.local/bin/.',
    diagnose: diagnoseMemoryTools,
  },
]

// --- GET: Diagnose all tools ---

export async function GET() {
  const results = TOOLS.map(tool => {
    const scriptPath = path.join(PROJECT_ROOT, tool.script)
    let status: ToolStatus
    try {
      status = tool.diagnose()
    } catch {
      status = 'error'
    }
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      status,
      scriptExists: fileExists(scriptPath),
    }
  })
  return NextResponse.json({ tools: results })
}

// --- POST: Run a tool's install script ---

export async function POST(request: NextRequest) {
  let body: { toolId: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const tool = TOOLS.find(t => t.id === body.toolId)
  if (!tool) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolId}` }, { status: 400 })
  }

  const scriptPath = path.join(PROJECT_ROOT, tool.script)
  if (!fileExists(scriptPath)) {
    return NextResponse.json({
      error: `Script not found: ${tool.script}. Is AI Maestro installed correctly?`,
    }, { status: 404 })
  }

  try {
    const output = execFileSync('bash', [scriptPath, ...tool.runArgs], {
      timeout: 120000,
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
      env: { ...process.env, HOME },
    })

    // Re-diagnose after running
    let newStatus: ToolStatus
    try {
      newStatus = tool.diagnose()
    } catch {
      newStatus = 'error'
    }

    return NextResponse.json({
      success: true,
      toolId: tool.id,
      output: output.slice(-2000), // Last 2KB of output
      newStatus,
    })
  } catch (err: unknown) {
    // Sanitize error: strip absolute paths to avoid leaking system structure
    const rawMsg = (err as { stderr?: string })?.stderr || (err instanceof Error ? err.message : String(err))
    const sanitized = rawMsg.replace(/\/Users\/[^\s:]+/g, '<path>').replace(/\/home\/[^\s:]+/g, '<path>').slice(-1000)
    return NextResponse.json({
      success: false,
      toolId: tool.id,
      error: sanitized,
    }, { status: 500 })
  }
}
