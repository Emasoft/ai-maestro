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
import { enforceSystemOwner } from '@/lib/route-auth'

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

/** Is the Tailscale binary present AND the daemon up? Shared prerequisite of both
 *  Tailscale tools below. Returns null when the prerequisite holds, or the ToolStatus
 *  to report when it does not.
 *
 *  WHY this is factored out: both tools previously re-derived it, and the serve tool
 *  then collapsed "tailscale absent" and "tailscale fine, serve unconfigured" into the
 *  same `missing`. One prerequisite, one answer, so the two cannot drift apart again. */
function tailscalePrerequisite(): ToolStatus | null {
  try {
    // execFileSync (not exec) — no shell, so no injection surface
    execFileSync('which', ['tailscale'], { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    return 'missing' // the binary genuinely is not installed
  }
  try {
    execFileSync('tailscale', ['status'], { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    console.error('[host-tools] tailscale status check failed:', err instanceof Error ? err.message : String(err))
    return 'error' // installed but the daemon is down / logged out
  }
  return null
}

/** Diagnose ACTUAL VPN reachability — the thing the dashboard depends on for remote
 *  access. This host binds `::` and is reached directly at its tailnet IP
 *  (`http://100.x.y.z:23000`), so a CGNAT-range address IS the capability.
 *  Deliberately says nothing about `tailscale serve`, which is a separate mechanism. */
function diagnoseTailscaleVpn(): ToolStatus {
  const prereq = tailscalePrerequisite()
  if (prereq) return prereq
  try {
    const ip = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    // Tailscale hands out 100.64.0.0/10 (CGNAT). Anything else means we are not on a tailnet.
    const first = ip.split('\n')[0]?.trim() ?? ''
    const octets = first.split('.').map(Number)
    const inCgnat = octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
    return inCgnat ? 'installed' : 'partial' // running, but holds no tailnet address yet
  } catch (err) {
    console.error('[host-tools] tailscale ip check failed:', err instanceof Error ? err.message : String(err))
    return 'error'
  }
}

/** Diagnose `tailscale serve` ONLY — never VPN reachability (that is diagnoseTailscaleVpn).
 *
 *  The three non-installed outcomes are deliberately distinct. Reporting "serve is not
 *  configured" as `missing` is what made the dashboard print "Not installed" three lines
 *  below the working tailnet URL the user had just connected over: no-serve-config is the
 *  HEALTHY steady state of this project's direct-bind architecture, not an absence. */
function diagnoseTailscaleServe(): ToolStatus {
  const prereq = tailscalePrerequisite()
  if (prereq) return prereq
  try {
    const status = execFileSync('tailscale', ['serve', 'status', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
    const config = JSON.parse(status)
    if (config.Web && Object.keys(config.Web).length > 0) return 'installed'
    if (config.TCP && Object.keys(config.TCP).length > 0) return 'outdated' // TCP mode, needs upgrade to HTTP
    // Healthy tailscale, no serve routes. `{}` is exactly what 1.98.5 returns here.
    return 'partial'
  } catch (err) {
    // We proved above that tailscale is installed AND running, so a failure here is an
    // inability to DETERMINE the serve state — never evidence of absence. (`serve status
    // --json` was a genuine regression in 1.98.1, fixed by 1.98.5.)
    console.error('[host-tools] tailscale serve status check failed:', err instanceof Error ? err.message : String(err))
    return 'error'
  }
}

const TOOLS: ToolDef[] = [
  {
    id: 'tailscale-vpn',
    name: 'Tailscale VPN Access',
    description: 'Verifies this host is on your tailnet so the dashboard is reachable from any VPN device (iPad, phone, laptop) at http://<tailscale-ip>:23000. Checks the daemon, the CGNAT address, MagicDNS, and that no subnet route is leaking.',
    script: 'scripts/setup-tailscale.sh',
    runArgs: [],
    confirmMessage: 'This validates the Tailscale setup for AI Maestro (install, daemon, tailnet address, MagicDNS, subnet routes) and reports what it finds. It does not change your Tailscale configuration.',
    diagnose: diagnoseTailscaleVpn,
  },
  {
    id: 'tailscale-serve',
    name: 'Tailscale Serve (HTTPS reverse proxy)',
    description: 'OPTIONAL, and not used by default: publishes the dashboard at https://<host>.<tailnet>.ts.net via tailscale serve. VPN access already works without it (see Tailscale VPN Access). Serve proxies from loopback, so every caller reaches the server as 127.0.0.1.',
    script: 'scripts/setup-tailscale-serve.sh',
    runArgs: [],
    confirmMessage: 'This runs `tailscale serve reset`, which clears EVERY serve route on this node — not only port 23000 — and then publishes the dashboard. If you serve anything else from this machine, that config is removed too.',
    diagnose: diagnoseTailscaleServe,
  },
  // NOTE: 'hooks' entry removed. Hooks are NOT a host-level tool — they are
  // installed automatically as part of the ai-maestro-plugin (user scope) via
  // the plugin marketplace. Their status belongs in the Marketplaces / Plugins
  // Explorer section, not in the Hosts section. The diagnoseHooks function
  // is kept for reference but is no longer wired to any tool entry.
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
  // Running install scripts can modify system-level configuration
  // (tmux, statusline, hooks, etc.). System-owner only.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

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
