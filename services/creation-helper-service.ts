/**
 * Creation Helper Service
 *
 * Manages the Haephestos agent creation helper — a temporary Claude Code session
 * that guides users through creating and configuring new AI agents.
 *
 * Architecture: follows the same pattern as help-service.ts (temp tmux session +
 * claude CLI + capture-pane response polling).  The key difference is that this
 * service uses `--agent haephestos-creation-helper` instead of `--system-prompt`,
 * and provides message relay + response capture for the chat UI.
 *
 * Covers:
 *   POST   /api/agents/creation-helper/session   -> createCreationHelper
 *   DELETE /api/agents/creation-helper/session   -> deleteCreationHelper
 *   GET    /api/agents/creation-helper/session   -> getCreationHelperStatus
 *   POST   /api/agents/creation-helper/chat      -> sendMessage
 *   GET    /api/agents/creation-helper/response   -> captureResponse
 */

import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getAgentByName, createAgent, deleteAgent } from '@/lib/agent-registry'
import { parseNameForDisplay } from '@/types/agent'
import { getRuntime } from '@/lib/agent-runtime'
import type { ServiceResult } from '@/types/service'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_NAME = '_aim-creation-helper'
const SESSION_LABEL = 'Agent Creation Helper'
const AGENT_FILE_NAME = 'haephestos-creation-helper.md'
const LOG_PREFIX = '[CreationHelper]'

/**
 * Proposal 20 (2026-04-20) — Haephestos workdir.
 *
 * Previous behaviour: tmux session was launched with `cwd = process.cwd()`
 * (the ai-maestro project dir). That caused TWO bugs:
 *
 *   1. Context overflow. Claude Code auto-loads the parent CLAUDE.md of
 *      its cwd as "project instructions". ai-maestro/CLAUDE.md is ~3000
 *      lines — it dominated Haephestos's context window before the first
 *      user message.
 *   2. Cleanup mismatch. The cleanup route wipes ~/agents/haephestos/,
 *      but Haephestos's real state (conversation cache, PSS scratch, draft
 *      TOML) lived under ~/.claude/projects/-Users-*-ai-maestro/, which
 *      cleanup never touched — stale context leaked between sessions.
 *
 * Fix: run Haephestos inside ~/agents/haephestos/ with a minimal CLAUDE.md
 * that disables parent-CLAUDE auto-load. Matches the workdir the cleanup
 * route already knows about (app/api/agents/creation-helper/cleanup/route.ts:32).
 */
const HAEPHESTOS_WORKDIR = join(homedir(), 'agents', 'haephestos')
const HAEPHESTOS_CLAUDE_MD_CONTENT = `# Haephestos Role-Plugin Forge

This is a scratch workdir for the Agent Creation Helper persona. Everything
inside this folder is ephemeral — the ai-maestro cleanup route wipes it on
every session start.

## Do NOT auto-load the parent project CLAUDE.md

Haephestos is a standalone role-plugin forge. It does not need any
ancestor project's CLAUDE.md. This file exists solely so Claude Code's
CLAUDE.md walk-up stops here and does not pull in ~/ai-maestro/CLAUDE.md
(~3000 lines) by accident.

## Persona source

The actual persona lives in the plugin-shipped agent file:
  ~/ai-maestro/.claude/agents/haephestos-creation-helper.md

Claude Code loads it via \`--agent haephestos-creation-helper\` at launch.
`

// Sonnet for intelligent config suggestions; haiku would be too limited
const MODEL = 'sonnet'
// Haephestos needs Bash (for PSS binary, jq, curl), Write/Edit (for TOML/plugin edits),
// Agent (for CPV fixer), WebFetch (user may provide URLs for skills/MCP to include)
const TOOLS = 'Read,Write,Edit,Bash,Glob,Grep,Agent,WebFetch'
// Default mode: allow list auto-approves expected ops, anything not in allow/deny prompts.
// This enforces "writes only inside haephestos" — Write outside workspace triggers a prompt.
const PERMISSION_MODE = 'default'

// ANSI escape code stripper — removes SGR, cursor movement, erase, and DEC Private Mode sequences
const ANSI_RE = /\x1B(?:\[[?]?[0-9;]*[a-zA-Z]|\].*?(?:\x07|\x1B\\)|\(B)/g

// Simple djb2 hash for response deduplication
function simpleHash(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}

// Tracks the response visible when the last message was sent, to prevent
// returning the same (stale) response before Claude starts its new reply.
let staleResponseHash: string | null = null

// Deduplication promise: if createCreationHelper is called concurrently, all
// callers share the same in-flight promise so only one session is ever created.
let creationHelperPromise: Promise<ServiceResult<{
  success: boolean
  agentId: string
  name: string
  status: string
  created: boolean
}>> | null = null

// ---------------------------------------------------------------------------
// Watchdog: auto-kill session if browser disconnects
// ---------------------------------------------------------------------------

// The agent-creation page sends heartbeats every 15s.
// If no heartbeat is received for WATCHDOG_TIMEOUT_MS, the session is killed.
// This prevents zombie sessions from running indefinitely if the browser
// tab closes without triggering beforeunload cleanup.
//
// WT-004#1 (SCEN-004 P0-002, 2026-04-16): extended 2min -> 30min.
// SCEN-004 BUG-001 (2026-04-27): bumped 30min -> 60min.
// SCEN-004 BUG-001 RECURRING (2026-04-27 run 2): bumped 60min -> 120min AND
// added heartbeat-on-toml-preview-poll. The dashboard polls toml-preview
// every 5s; treating that poll as a heartbeat keeps the watchdog from
// firing whenever the user is actively viewing the Haephestos page —
// regardless of whether the document.visibilitychange event suspends the
// dedicated 15s heartbeat scheduler in headless browser automation. 120min
// is the absolute ceiling against TRULY abandoned sessions.
// Five other zombie-safeguard layers still cover real leaks: beforeunload +
// sendBeacon, client visibilitychange (suspend heartbeat when hidden),
// this server watchdog, startup cleanup, and tightened tmux permissions.
const WATCHDOG_TIMEOUT_MS = 120 * 60 * 1000 // 120 minutes
let lastHeartbeat: number = 0
let watchdogTimer: ReturnType<typeof setInterval> | null = null

/** Called by the heartbeat endpoint to keep the session alive. */
export function heartbeatCreationHelper(): void {
  lastHeartbeat = Date.now()
}

function startWatchdog(): void {
  stopWatchdog()
  lastHeartbeat = Date.now()
  watchdogTimer = setInterval(async () => {
    if (lastHeartbeat === 0) return
    const elapsed = Date.now() - lastHeartbeat
    if (elapsed > WATCHDOG_TIMEOUT_MS) {
      console.warn(`${LOG_PREFIX} Watchdog: no heartbeat for ${Math.round(elapsed / 1000)}s — killing zombie session`)
      stopWatchdog()
      await deleteCreationHelper()
    }
  }, 30_000) // Check every 30s
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  lastHeartbeat = 0
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Check if the creation helper tmux session exists. */
async function sessionExists(): Promise<boolean> {
  const runtime = getRuntime()
  return runtime.sessionExists(SESSION_NAME)
}

/** Path to the source agent persona file (checked into the repo). */
function sourceAgentFile(): string {
  return join(process.cwd(), 'agents', AGENT_FILE_NAME)
}

/**
 * Path where the agent file is deployed for `claude --agent`.
 *
 * Proposal 20 (2026-04-20): deploy into HAEPHESTOS_WORKDIR/.claude/agents/
 * instead of the ai-maestro project's .claude/agents/. The tmux session
 * now runs with cwd=HAEPHESTOS_WORKDIR, so Claude Code's project-scoped
 * agent resolution walks up from HAEPHESTOS_WORKDIR — it never looks at
 * ai-maestro's .claude/ anymore. Cleanup wipes the whole workdir between
 * sessions, which matches the "ephemeral persona" contract.
 */
function deployedAgentFile(): string {
  return join(HAEPHESTOS_WORKDIR, '.claude', 'agents', AGENT_FILE_NAME)
}

/** Copy the agent persona file to .claude/agents/ so `claude --agent` finds it. */
function deployAgentFile(): void {
  const src = sourceAgentFile()
  const dst = deployedAgentFile()
  const dstDir = join(HAEPHESTOS_WORKDIR, '.claude', 'agents')

  if (!existsSync(src)) {
    throw new Error(`Agent file not found: ${src}`)
  }
  if (!existsSync(dstDir)) {
    mkdirSync(dstDir, { recursive: true })
  }
  copyFileSync(src, dst)
}

/** Remove the deployed agent file (cleanup on session destruction). */
function removeAgentFile(): void {
  const dst = deployedAgentFile()
  try {
    if (existsSync(dst)) unlinkSync(dst)
  } catch {
    // Ignore removal failures — non-critical cleanup
  }
}

/**
 * Sanitize user input: strip null bytes, ASCII control chars (except newline/tab),
 * and Unicode bidi-override characters.
 */
function sanitizeInput(text: string): string {
  return text
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
}

/** Strip ANSI escape codes from captured terminal output. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/**
 * Parse JSON config suggestion blocks from Claude's response.
 *
 * Claude Code's terminal renderer strips markdown code fences, so
 * ```json:config blocks appear as plain indented JSON in the captured pane.
 * We detect config arrays by finding JSON arrays whose objects all have
 * the {action, field, value} shape.  Returns the suggestions and the
 * response text with the config blocks removed.
 */
function parseConfigBlocks(text: string): {
  cleanText: string
  suggestions: Array<{ action: string; field: string; value: unknown }>
} {
  const suggestions: Array<{ action: string; field: string; value: unknown }>  = []

  // Strategy 1: fenced ```json:config blocks (works if source is raw markdown)
  const configBlockRe = /```json:config\s*\n([\s\S]*?)```/g
  let cleanText = text.replace(configBlockRe, (_match, content: string) => {
    try {
      const parsed = JSON.parse(content.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.action && item.field && 'value' in item) {
            suggestions.push(item)
          }
        }
      }
    } catch {
      console.warn(`${LOG_PREFIX} Failed to parse fenced config block:`, content.slice(0, 100))
      return _match
    }
    return ''
  }).trim()

  // Strategy 2: raw JSON arrays in terminal output (fences stripped by renderer).
  // Find lines starting with '[', collect until matching ']', try to parse.
  if (suggestions.length === 0) {
    const lines = cleanText.split('\n')
    let blockStart = -1
    let bracketDepth = 0
    let blockLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      // Detect JSON array start — may follow ⏺ response marker or indentation
      const bracketPos = trimmed.indexOf('[')
      if (blockStart < 0 && bracketPos >= 0 &&
          (bracketPos === 0 || /^[⏺\s]+$/.test(trimmed.slice(0, bracketPos)))) {
        blockStart = i
        bracketDepth = 0
        blockLines = []
      }
      if (blockStart >= 0) {
        blockLines.push(lines[i])
        for (const ch of trimmed) {
          if (ch === '[') bracketDepth++
          else if (ch === ']') bracketDepth--
        }
        if (bracketDepth <= 0) {
          // Potential complete JSON array — try to parse.
          // Terminal wrapping inserts newlines inside JSON string values,
          // so join all lines with spaces to normalize before parsing.
          const candidate = blockLines
            .map(l => l.trim().replace(/^⏺\s*/, ''))  // Strip response marker
            .join(' ')
          try {
            const parsed = JSON.parse(candidate)
            if (Array.isArray(parsed) && parsed.length > 0 &&
                parsed.every((item: unknown) =>
                  item && typeof item === 'object' &&
                  'action' in (item as Record<string, unknown>) &&
                  'field' in (item as Record<string, unknown>) &&
                  'value' in (item as Record<string, unknown>)
                )) {
              for (const item of parsed) {
                suggestions.push(item as { action: string; field: string; value: unknown })
              }
              // Remove the config block lines from the visible text
              lines.splice(blockStart, i - blockStart + 1)
              cleanText = lines.join('\n').trim()
              break
            }
          } catch {
            // Not valid JSON — reset and keep scanning
          }
          blockStart = -1
          blockLines = []
        }
      }
    }
  }

  return { cleanText, suggestions }
}

/**
 * Detect whether Claude has finished responding by examining captured pane content.
 *
 * Mirrors the detection logic from agents-chat-service.ts:175-229:
 * 1. Check if Claude is still thinking (keywords in recent lines)
 * 2. Look for separator lines (─╌═ repeated 10+ times)
 * 3. Check for input prompt (> ) between separators → response complete
 */
function detectResponseState(capturedLines: string[]): {
  isThinking: boolean
  isComplete: boolean
  responseText: string
} {
  const recentLines = capturedLines.slice(-15)
  const recentText = recentLines.join('\n').toLowerCase()

  // Check thinking indicators.
  // Claude Code shows "<spinner> <whimsical-word>… (Ns · tokens)" while thinking.
  // The spinner character rotates (·, ✶, ✢, ✻, etc.) and the word changes
  // across versions, so we detect the consistent "<word>… (<time>" pattern.
  const hasThinkingIndicator = recentLines.some(l => {
    const stripped = stripAnsi(l).trim()
    return stripped.match(/\S+…\s+\(\d+[ms]/)
  })

  // Check for active tool/sub-agent execution.
  // When Haephestos spawns a sub-agent (e.g. PSS profiler), the terminal shows
  // tool invocation output like "+69 more tool uses (ctrl+o to expand)" and
  // "ctrl+b ctrl+b (twice) to run in background". The thinking spinner may scroll
  // out of the visible last 15 lines during long-running sub-agents, so we scan
  // ALL captured lines for active tool execution markers.
  const hasActiveToolCall = capturedLines.some(l => {
    const stripped = stripAnsi(l).trim()
    return (
      stripped.match(/^\+\d+ more tool uses?/) ||       // "+N more tool uses"
      stripped.includes('ctrl+o to expand') ||            // tool output collapsed
      stripped.includes('ctrl+b ctrl+b') ||               // "run in background" hint
      stripped.match(/^\s*⎿\s+(Read|Write|Edit|Bash)\(/)  // active tool invocation line
    )
  })
  // Only treat tool markers as "still running" if there is no completed response
  // below them (i.e., the tool marker is in the last response region, not a prior one).
  // We check this by verifying tool markers appear AFTER the last separator pair.
  let toolCallIsRecent = false
  if (hasActiveToolCall) {
    // Find the last separator line index
    let lastSepIdx = -1
    for (let i = capturedLines.length - 1; i >= 0; i--) {
      const line = capturedLines[i].trim()
      if (line.match(/^[─╌═]{10,}/) && !line.match(/[╮╯┤│]$/)) {
        lastSepIdx = i
        break
      }
    }
    // Check if any tool marker appears after the second-to-last separator
    // (i.e., within the current response region)
    for (let i = Math.max(0, lastSepIdx); i < capturedLines.length; i++) {
      const stripped = stripAnsi(capturedLines[i]).trim()
      if (
        stripped.match(/^\+\d+ more tool uses?/) ||
        stripped.includes('ctrl+o to expand') ||
        stripped.includes('ctrl+b ctrl+b')
      ) {
        toolCallIsRecent = true
        break
      }
    }
  }

  const isThinking = hasThinkingIndicator || toolCallIsRecent ||
    recentText.includes('thinking') ||
    recentText.includes('analyzing') ||
    recentText.includes('generating') ||
    recentText.includes('processing') ||
    (recentText.includes('esc to interrupt') && !recentText.includes('esc to cancel'))

  if (isThinking) {
    return { isThinking: true, isComplete: false, responseText: '' }
  }

  // Find separator lines (bottom-up)
  // Claude v2.x separators may contain text (e.g. "────── agent-name ──")
  // so we match lines that START with 10+ separator chars.
  // Exclude cost-box continuation lines that end with box-drawing chars (╮╯┤│)
  const separators: number[] = []
  for (let i = capturedLines.length - 1; i >= 0; i--) {
    const line = capturedLines[i].trim()
    if (line.match(/^[─╌═]{10,}/) && !line.match(/[╮╯┤│]$/)) {
      separators.push(i)
      if (separators.length === 3) break
    }
  }

  // Need at least 2 separators to delimit a response
  if (separators.length < 2) {
    return { isThinking: false, isComplete: false, responseText: '' }
  }

  // Claude v2.x terminal layout (bottom-up):
  //   ⏵⏵ bypass permissions on (shift+tab to cycle)    ← chrome
  //   🤖 Sonnet 4.6 ... | 📁 project | 📊 tokens      ← chrome (status bar)
  //   ────────────────────────────────────────────────  ← bottomSep (separators[0])
  //   ❯                                                ← input prompt
  //   ────────────────── agent-name ──────────────────  ← topSep (separators[1])
  //   [Claude's response text]                          ← what we want
  //   ────────────────────────────────────────────────  ← prevSep (separators[2])
  //
  // Check if the prompt area between topSep and bottomSep contains the input prompt
  const [bottomSep, topSep] = separators
  const betweenSeps = capturedLines.slice(topSep + 1, bottomSep)
    .map(l => l.trim())
    .filter(l => l)

  // The prompt area should contain just the ❯ or > character (possibly with user text)
  const hasPrompt = betweenSeps.length <= 1 &&
    (betweenSeps.length === 0 || betweenSeps[0].match(/^[>❯]/))

  if (!hasPrompt) {
    return { isThinking: false, isComplete: false, responseText: '' }
  }

  // Determine response start boundary
  let responseStart: number
  if (separators.length >= 3) {
    // Standard case: 3+ separators — response is between prevSep and topSep
    responseStart = separators[2] + 1
  } else {
    // First response case: only 2 separators (no prevSep above the response).
    // Find the user's message line above topSep (❯ followed by text) and use
    // the area after it (skipping hook notifications) as the response start.
    let userMsgLine = -1
    for (let i = topSep - 1; i >= 0; i--) {
      const stripped = stripAnsi(capturedLines[i]).trim()
      if (stripped.match(/^[❯>]\s+\S/)) {
        userMsgLine = i
        break
      }
    }
    if (userMsgLine < 0) {
      // No user message found — initial state, prompt is ready but no response
      return { isThinking: false, isComplete: true, responseText: '' }
    }
    // Find the first response marker (⏺) after the user message.  This skips
    // multi-line hook notifications (⎿ prefix + indented continuation lines).
    responseStart = userMsgLine + 1
    while (responseStart < topSep) {
      const stripped = stripAnsi(capturedLines[responseStart]).trim()
      if (stripped.startsWith('⏺')) break
      responseStart++
    }
    if (responseStart >= topSep) {
      // No response marker found — Claude may still be processing
      return { isThinking: false, isComplete: true, responseText: '' }
    }
  }

  // Strip cost box: find "⎿  Stop says:" marker and truncate there.
  // Everything from that marker to topSep is noise (cost box, "Worked for", etc.)
  let responseEnd = topSep
  for (let i = responseStart; i < topSep; i++) {
    const stripped = stripAnsi(capturedLines[i]).trim()
    if (stripped.match(/^⎿\s+Stop says/)) {
      responseEnd = i
      break
    }
  }
  // Also strip trailing empty lines
  while (responseEnd > responseStart && stripAnsi(capturedLines[responseEnd - 1]).trim() === '') {
    responseEnd--
  }

  const responseLines = capturedLines.slice(responseStart, responseEnd)
  const responseText = stripAnsi(responseLines.join('\n')).trim()

  return { isThinking: false, isComplete: true, responseText }
}

// ===========================================================================
// PUBLIC API — called by API routes
// ===========================================================================

/**
 * Create or return existing creation helper agent.
 */
export function createCreationHelper(): Promise<ServiceResult<{
  success: boolean
  agentId: string
  name: string
  status: string
  created: boolean
}>> {
  // If a creation is already in flight, return the same promise so that
  // concurrent callers never race to spawn duplicate sessions/agents.
  if (creationHelperPromise) {
    return creationHelperPromise
  }

  const promise = (async () => {
  try {
    let agent = getAgentByName(SESSION_NAME)
    const exists = await sessionExists()

    // Already running — return it (idempotent)
    if (agent && exists) {
      return {
        data: {
          success: true,
          agentId: agent.id,
          name: SESSION_NAME,
          status: 'online',
          created: false,
        },
        status: 200,
      }
    }

    // Clean up stale registry entry if session is gone
    if (agent && !exists) {
      try { await deleteAgent(agent.id) } catch { /* ignore */ }
      agent = null
    }

    // Deploy agent persona file to .claude/agents/
    deployAgentFile()

    // Proposal 20 (2026-04-20): run Haephestos inside ~/agents/haephestos/
    // so Claude Code does NOT auto-load the ai-maestro project CLAUDE.md
    // into the context window, and so the cleanup route's wipe of that
    // directory actually matches the session's state path. Seed a minimal
    // CLAUDE.md here to halt the ancestor-walk that Claude Code performs
    // when looking for project instructions.
    if (!existsSync(HAEPHESTOS_WORKDIR)) {
      mkdirSync(HAEPHESTOS_WORKDIR, { recursive: true })
    }
    const workdirClaudeMd = join(HAEPHESTOS_WORKDIR, 'CLAUDE.md')
    if (!existsSync(workdirClaudeMd)) {
      writeFileSync(workdirClaudeMd, HAEPHESTOS_CLAUDE_MD_CONTENT, 'utf8')
    }

    // Create tmux session in the Haephestos workdir
    const runtime = getRuntime()
    await runtime.createSession(SESSION_NAME, HAEPHESTOS_WORKDIR)

    // Register agent in registry
    if (!agent) {
      const { tags } = parseNameForDisplay(SESSION_NAME)
      agent = await createAgent({
        name: SESSION_NAME,
        label: SESSION_LABEL,
        program: 'claude-code',
        taskDescription: 'Temporary agent creation helper (Haephestos)',
        tags,
        owner: 'system',
        createSession: true,
        workingDirectory: HAEPHESTOS_WORKDIR,
        programArgs: '',
      })
    }

    // Unset CLAUDECODE env to avoid nested-session detection
    await runtime.unsetEnvironment(SESSION_NAME, 'CLAUDECODE')
    await runtime.sendKeys(SESSION_NAME, '"unset CLAUDECODE"', { enter: true })

    // Small delay for env to take effect
    await new Promise(resolve => setTimeout(resolve, 300))

    // Launch claude with the Haephestos agent persona
    const launchCmd = [
      'claude',
      `--agent ${AGENT_FILE_NAME.replace('.md', '')}`,
      `--model ${MODEL}`,
      `--tools ${TOOLS}`,
      `--permission-mode ${PERMISSION_MODE}`,
    ].join(' ')

    await runtime.sendKeys(SESSION_NAME, launchCmd, { literal: true, enter: true })

    // Start watchdog — auto-kills session if browser disconnects
    startWatchdog()

    return {
      data: {
        success: true,
        agentId: agent.id,
        name: SESSION_NAME,
        status: 'starting',
        created: true,
      },
      status: 200,
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to create:`, error)
    return {
      data: {
        success: false,
        agentId: '',
        name: SESSION_NAME,
        status: 'error',
        created: false,
      },
      error: error instanceof Error ? error.message : 'Failed to create creation helper',
      status: 500,
    }
  } finally {
    // Clear the deduplication promise so future (non-concurrent) calls can
    // trigger a fresh creation if needed (e.g. after a failed attempt).
    creationHelperPromise = null
  }
  })()

  // Store and return the same promise so concurrent callers share it.
  creationHelperPromise = promise
  return promise
}

/**
 * Kill creation helper agent and clean up.
 */
export async function deleteCreationHelper(): Promise<ServiceResult<{ success: boolean }>> {
  // Stop watchdog timer — session is being intentionally destroyed
  stopWatchdog()
  // Reset stale response tracking on session destruction
  staleResponseHash = null
  try {
    // Kill tmux session
    const runtime = getRuntime()
    const exists = await sessionExists()
    if (exists) {
      try { await runtime.killSession(SESSION_NAME) } catch { /* ignore */ }
    }

    // Remove from agent registry
    const agent = getAgentByName(SESSION_NAME)
    if (agent) {
      try { await deleteAgent(agent.id) } catch { /* ignore */ }
    }

    // Clean up deployed agent file
    removeAgentFile()

    return { data: { success: true }, status: 200 }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to delete:`, error)
    return {
      error: error instanceof Error ? error.message : 'Failed to delete creation helper',
      status: 500,
    }
  }
}

/**
 * Check creation helper status and whether Claude is ready for input.
 */
export async function getCreationHelperStatus(): Promise<ServiceResult<{
  success: boolean
  agentId: string | null
  name: string
  status: string
  ready: boolean
}>> {
  try {
    const agent = getAgentByName(SESSION_NAME)
    const exists = await sessionExists()

    if (!agent || !exists) {
      return {
        data: {
          success: true,
          agentId: null,
          name: SESSION_NAME,
          status: 'offline',
          ready: false,
        },
        status: 200,
      }
    }

    // Capture pane to detect if Claude is ready (showing input prompt)
    const runtime = getRuntime()
    const stdout = await runtime.capturePane(SESSION_NAME, 30)
    const lines = stdout.trim().split('\n')
    const state = detectResponseState(lines)

    return {
      data: {
        success: true,
        agentId: agent.id,
        name: SESSION_NAME,
        status: state.isComplete ? 'ready' : state.isThinking ? 'thinking' : 'starting',
        ready: state.isComplete,
      },
      status: 200,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
    }
  }
}

/**
 * Send a user message to the creation helper Claude session.
 */
export async function sendMessage(text: string): Promise<ServiceResult<{ success: boolean }>> {
  try {
    const exists = await sessionExists()
    if (!exists) {
      return {
        error: 'Creation helper session not running',
        status: 404,
      }
    }

    const sanitized = sanitizeInput(text)
    if (!sanitized.trim()) {
      return {
        error: 'Empty message after sanitization',
        status: 400,
      }
    }

    const runtime = getRuntime()

    // Snapshot current response hash so captureResponse() can detect stale data
    try {
      const stdout = await runtime.capturePane(SESSION_NAME, 200)
      const lines = stdout.trim().split('\n')
      const state = detectResponseState(lines)
      if (state.isComplete && state.responseText) {
        staleResponseHash = simpleHash(state.responseText)
      }
    } catch { /* non-critical — worst case: one duplicate response */ }

    await runtime.sendKeys(SESSION_NAME, sanitized, { literal: true, enter: true })

    return { data: { success: true }, status: 200 }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to send message:`, error)
    return {
      error: error instanceof Error ? error.message : 'Failed to send message',
      status: 500,
    }
  }
}

/**
 * Capture Claude's response from the terminal.
 *
 * This is a single-shot capture (no internal polling).  The UI polls this
 * endpoint repeatedly until `isComplete` is true.
 */
export async function captureResponse(): Promise<ServiceResult<{
  text: string
  configSuggestions: Array<{ action: string; field: string; value: unknown }>
  isComplete: boolean
  isThinking: boolean
}>> {
  try {
    const exists = await sessionExists()
    if (!exists) {
      return {
        error: 'Creation helper session not running',
        status: 404,
      }
    }

    const runtime = getRuntime()
    const stdout = await runtime.capturePane(SESSION_NAME, 200)
    const lines = stdout.trim().split('\n')
    const state = detectResponseState(lines)

    if (!state.isComplete) {
      return {
        data: {
          text: '',
          configSuggestions: [],
          isComplete: false,
          isThinking: state.isThinking,
        },
        status: 200,
      }
    }

    // Check for stale response (old response still visible after new message sent)
    if (staleResponseHash) {
      const hash = simpleHash(state.responseText)
      if (hash === staleResponseHash) {
        // Same response as before — Claude hasn't started replying yet
        return {
          data: { text: '', configSuggestions: [], isComplete: false, isThinking: false },
          status: 200,
        }
      }
      // New response detected — clear stale tracking
      staleResponseHash = null
    }

    // Parse config suggestion blocks from response
    const { cleanText, suggestions } = parseConfigBlocks(state.responseText)

    return {
      data: {
        text: cleanText,
        configSuggestions: suggestions,
        isComplete: true,
        isThinking: false,
      },
      status: 200,
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to capture response:`, error)
    return {
      error: error instanceof Error ? error.message : 'Failed to capture response',
      status: 500,
    }
  }
}
