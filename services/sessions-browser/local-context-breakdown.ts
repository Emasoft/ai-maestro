/**
 * Local-tokenization context breakdown.
 *
 * Replaces the Rust binary's `context_breakdown` for the values shown in
 * the JSONL Session Browser's Context panel. The previous Rust classifier
 * could only see what was IN the JSONL — and Claude Code's `/context`
 * command shows numbers that come from tokenizing the *on-disk* skill,
 * agent, and memory files at runtime. The two never matched.
 *
 * This module reproduces the `/context` numbers approximately by:
 *   1. Reading the agent's CWD from the JSONL itself (every record has
 *      `cwd`; we use the first one).
 *   2. Walking the user-scope (~/.claude) and project-scope
 *      (<cwd>/.claude) settings to enumerate enabled plugins.
 *   3. For each enabled plugin: summing tokens of skills/<name>/SKILL.md,
 *      agents/<name>.md, etc. — the same files Claude Code itself loads.
 *   4. Tokenizing CLAUDE.md (memory) at each relevant scope.
 *   5. Summing per-turn input/output/cache tokens from the JSONL for the
 *      `messages` bucket.
 *   6. Holding `systemPrompt` and `autocompactBuffer` as constants (the
 *      Claude Code binary builds them at runtime; we approximate with
 *      published-stable values that hold within ±10% across versions).
 *
 * Token counting is `Math.ceil(charCount / 4)` — same heuristic Claude
 * Code uses internally. Exact tiktoken parity is out of scope; users care
 * that the numbers are in the same neighborhood as `/context`, not that
 * they match to the byte.
 *
 * Returned shape extends the prior schema with a new `skills` field and
 * an `autocompactBuffer` field. Old callers reading the legacy fields
 * continue to work.
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Built-in Claude Code system prompt (non-cached static portion). Approximate. */
const CLAUDE_CODE_SYSTEM_PROMPT_TOKENS = 8_200

/** Reserved buffer Claude Code holds back for auto-compaction. */
const CLAUDE_CODE_AUTOCOMPACT_BUFFER_TOKENS = 33_000

/** Claude's own ~chars/token heuristic. Used for all on-disk tokenization. */
const CHARS_PER_TOKEN = 4

/** Built-in tool descriptors live inside the system prompt; we don't add them again. */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LocalContextBreakdown {
  /** Built-in Claude system prompt approximation (constant). */
  systemPrompt: number
  /** Sum of system-tool descriptor tokens. Currently 0 since they're baked into systemPrompt. */
  systemTools: number
  /** Sum of MCP server tool descriptor tokens. 0 unless we discover MCP definitions on disk. */
  mcpTools: number
  /** Sum of tokens across all enabled-plugin agents/*.md files. */
  customAgents: number
  /** Sum of tokens across CLAUDE.md files (user + project + sub-dirs). */
  memory: number
  /** Sum of tokens across enabled skills (skills/{skillName}/SKILL.md). */
  skills: number
  /** Sum of input + output + cache_creation tokens across all assistant turns. */
  messages: number
  /** Reserved for auto-compaction (constant). */
  autocompactBuffer: number
  /** Cumulative cache_read_input_tokens — informational, not counted toward total. */
  cacheRead: number
  /** modelLimit - (sum of consumed buckets) - autocompactBuffer (clamped to 0). */
  freeSpace: number
  /** Sum of every consumed bucket. */
  total: number
  /** Window size for the model, e.g. 1_000_000 for Opus 4.7. */
  modelContextLimit: number
  /** Whether we used char/4 estimation anywhere. Always true for v1. */
  approximate: boolean
  /** Last-seen model id from the JSONL. */
  modelId: string | null
}

// ---------------------------------------------------------------------------
// Tokenization helpers
// ---------------------------------------------------------------------------

function tokenizeText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

async function tokenizeFile(filePath: string): Promise<number> {
  try {
    const txt = await fs.readFile(filePath, 'utf8')
    return tokenizeText(txt)
  } catch {
    return 0
  }
}

async function readDirSafe(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath)
  } catch {
    return []
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Plugin / element discovery
// ---------------------------------------------------------------------------

interface EnabledPlugin {
  /** Marketplace this plugin came from (e.g. ai-maestro-plugins). */
  marketplace: string
  /** Plugin name. */
  name: string
  /** Absolute path to the plugin's installed directory. */
  installPath: string
}

/**
 * Read user-scope `~/.claude/settings.json` and project-scope
 * `<cwd>/.claude/settings.local.json` to find which plugins are enabled.
 *
 * We treat both scopes additively: a plugin enabled at either scope is
 * considered enabled. Duplicates are de-duped by `<marketplace>:<name>`.
 *
 * For each enabled plugin we resolve the install path under
 * `~/.claude/plugins/cache/<marketplace>/<name>/<version>/` — the plugin
 * cache uses the latest installed version directory, which we discover
 * by listing the plugin's parent directory.
 */
async function findEnabledPlugins(cwd: string): Promise<EnabledPlugin[]> {
  const home = homedir()
  const candidates = [
    path.join(home, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
  ]

  const seen = new Set<string>()
  const out: EnabledPlugin[] = []

  for (const settingsPath of candidates) {
    let raw: string
    try {
      raw = await fs.readFile(settingsPath, 'utf8')
    } catch {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const enabled = (parsed as { enabledPlugins?: Record<string, unknown> })?.enabledPlugins
    if (!enabled || typeof enabled !== 'object') continue

    for (const [key, val] of Object.entries(enabled)) {
      // The settings file holds BOTH active and recently-disabled plugins;
      // the boolean tells us which is which. Only `true` counts toward
      // the runtime context — `false` entries are toggle-history that
      // Claude Code keeps so re-enabling preserves user state.
      if (val !== true) continue
      // key shape: "<plugin-name>@<marketplace>"
      const at = key.lastIndexOf('@')
      if (at < 0) continue
      const name = key.slice(0, at)
      const marketplace = key.slice(at + 1)
      const dedupKey = `${marketplace}:${name}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)

      const installPath = await resolvePluginInstallPath(home, marketplace, name)
      if (installPath) out.push({ marketplace, name, installPath })
    }
  }
  return out
}

async function isPluginRoot(p: string): Promise<boolean> {
  // Two manifest forms ship in the wild: classic `plugin.json` at the
  // plugin root, and the newer `.claude-plugin/plugin.json` (which the
  // Haephestos-built role-plugins use). Either is enough to declare a
  // directory a plugin root.
  if (await pathExists(path.join(p, 'plugin.json'))) return true
  if (await pathExists(path.join(p, '.claude-plugin', 'plugin.json'))) return true
  return false
}

async function resolvePluginInstallPath(
  home: string,
  marketplace: string,
  name: string,
): Promise<string | null> {
  // Plugins live in three families of locations:
  //   1. The standard plugin cache: ~/.claude/plugins/cache/<mkt>/<name>/[<ver>/]
  //      — used for all remote-marketplace plugins. May or may not have a
  //      version subdirectory; we probe both layouts.
  //   2. The local AI Maestro role-plugins marketplace, which puts each
  //      plugin under a per-marketplace subfolder — e.g.
  //      ~/agents/role-plugins/roles-marketplace/<name>/ and
  //      ~/agents/role-plugins/codex-roles-marketplace/<name>/. Some
  //      Haephestos plugins are also written directly to
  //      ~/agents/role-plugins/<name>/ without a marketplace subfolder.
  //   3. Converted plugins under ~/agents/custom-plugins/<name>/.
  // We walk every plausible base, in priority order, and return the first
  // dir whose plugin.json or .claude-plugin/plugin.json exists.
  const cacheBase = path.join(home, '.claude', 'plugins', 'cache', marketplace, name)
  const directProbes: string[] = [
    cacheBase,
    path.join(home, 'agents', 'role-plugins', name),
    path.join(home, 'agents', 'custom-plugins', name),
  ]
  for (const base of directProbes) {
    if (await isPluginRoot(base)) return base
    const subs = await readDirSafe(base)
    if (subs.length > 0) {
      subs.sort()
      for (const s of subs.slice().reverse()) {
        const candidate = path.join(base, s)
        if (await isPluginRoot(candidate)) return candidate
      }
    }
  }
  // The local-roles structure has a per-marketplace subfolder under
  // ~/agents/role-plugins/. We discover it by listing the parent.
  const rolePluginsDir = path.join(home, 'agents', 'role-plugins')
  for (const mktSub of await readDirSafe(rolePluginsDir)) {
    const candidate = path.join(rolePluginsDir, mktSub, name)
    if (await isPluginRoot(candidate)) return candidate
  }
  return null
}

/**
 * Extract the YAML frontmatter from a markdown file. Returns the
 * frontmatter block as plain text (excluding the leading/trailing `---`),
 * or `''` if the file has no frontmatter.
 *
 * Claude Code only includes the SKILL frontmatter (name + description)
 * in the system-prompt catalog at session start — the full SKILL body is
 * loaded ON DEMAND when the skill is invoked. Same model for plugin
 * subagents: their `agents/*.md` body is loaded only when the Task tool
 * spawns them. Counting the whole body would massively over-attribute
 * tokens vs. what `/context` actually reports.
 */
async function readFrontmatter(filePath: string): Promise<string> {
  let txt: string
  try {
    txt = await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
  if (!txt.startsWith('---\n') && !txt.startsWith('---\r\n')) return ''
  const after = txt.indexOf('\n---', 4)
  if (after < 0) return ''
  return txt.slice(0, after + 4)
}

async function tokenizeSkillCatalogEntries(plugin: EnabledPlugin): Promise<number> {
  const skillsDir = path.join(plugin.installPath, 'skills')
  const entries = await readDirSafe(skillsDir)
  let total = 0
  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry, 'SKILL.md')
    const frontmatter = await readFrontmatter(skillPath)
    total += tokenizeText(frontmatter)
  }
  return total
}

async function tokenizeAgentCatalogEntries(plugin: EnabledPlugin): Promise<number> {
  // Plugin-bundled subagents (`<plugin>/agents/*.md`) are loaded ON
  // DEMAND by the Task tool — only the YAML frontmatter (name +
  // description) sits in the always-on catalog the model sees at session
  // start. Tokenize only the frontmatter, NOT the whole agent body.
  const agentsDir = path.join(plugin.installPath, 'agents')
  const entries = await readDirSafe(agentsDir)
  let total = 0
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const frontmatter = await readFrontmatter(path.join(agentsDir, entry))
    total += tokenizeText(frontmatter)
  }
  return total
}

async function tokenizeMemoryFiles(cwd: string): Promise<number> {
  const home = homedir()
  // Claude Code recursively inlines `@<path>` references in CLAUDE.md
  // into the cached system prompt — so a tiny CLAUDE.md that references
  // `~/.claude/rules/foo.md` ends up loading the whole rules tree.
  // Approximate that by including the user's `~/.claude/rules/` and
  // `~/.claude/CLAUDE.md` plus the project-scope `CLAUDE.md` files.
  const candidates: string[] = [
    path.join(home, '.claude', 'CLAUDE.md'),
    path.join(home, '.claude', 'TOKF.md'),
    path.join(cwd, 'CLAUDE.md'),
    path.join(cwd, '.claude', 'CLAUDE.md'),
  ]
  // Add every `*.md` under `~/.claude/rules/` — these are conventionally
  // `@`-referenced from CLAUDE.md and live in the system prompt cache.
  const rulesDir = path.join(home, '.claude', 'rules')
  for (const entry of await readDirSafe(rulesDir)) {
    if (entry.endsWith('.md')) candidates.push(path.join(rulesDir, entry))
  }
  // Same for project-scope rules (`<cwd>/.claude/rules/*.md`).
  const projectRulesDir = path.join(cwd, '.claude', 'rules')
  for (const entry of await readDirSafe(projectRulesDir)) {
    if (entry.endsWith('.md')) candidates.push(path.join(projectRulesDir, entry))
  }
  let total = 0
  for (const c of candidates) {
    total += await tokenizeFile(c)
  }
  return total
}

async function tokenizeProjectAgents(cwd: string): Promise<number> {
  // .claude/agents/*.md = user-defined custom agents in the project.
  // Unlike plugin subagents, these are loaded as full personas at session
  // start (Claude Code includes the full body of each user-authored
  // agent in the cached system prompt). We tokenize the whole file.
  const agentsDir = path.join(cwd, '.claude', 'agents')
  const entries = await readDirSafe(agentsDir)
  let total = 0
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    total += await tokenizeFile(path.join(agentsDir, entry))
  }
  return total
}

// ---------------------------------------------------------------------------
// JSONL pass — collect cwd, model id, message tokens, cache_read sum
// ---------------------------------------------------------------------------

interface JsonlSummary {
  cwd: string | null
  modelId: string | null
  /**
   * Tokens in the running user/assistant message text (the conversation
   * itself), tokenized from `message.content` text blocks across every
   * turn. Tool calls and tool results are NOT counted — they're
   * ephemeral and fall out of the window after compaction.
   */
  messages: number
  /** Latest assistant turn's `cache_read_input_tokens`. */
  cacheRead: number
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as { type?: string; text?: string }
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    if (b.type === 'thinking' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

async function summarizeJsonl(jsonlPath: string): Promise<JsonlSummary> {
  let raw: string
  try {
    raw = await fs.readFile(jsonlPath, 'utf8')
  } catch {
    return { cwd: null, modelId: null, messages: 0, cacheRead: 0 }
  }
  const lines = raw.split('\n')
  const summary: JsonlSummary = { cwd: null, modelId: null, messages: 0, cacheRead: 0 }
  const seenRequestIds = new Set<string>()

  for (const line of lines) {
    if (!line) continue
    let v: Record<string, unknown>
    try {
      v = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (!summary.cwd && typeof v.cwd === 'string') summary.cwd = v.cwd
    if (!summary.modelId) {
      const m = (v as { model?: string }).model
        ?? ((v as { message?: { model?: string } }).message?.model)
      if (typeof m === 'string') summary.modelId = m
    }

    const role = ((v as { message?: { role?: string } }).message?.role)
      ?? ((v as { role?: string }).role)
    // Tokenize message text for both user and assistant records — those
    // make up the running conversation. Tool blocks are excluded
    // (extractMessageText filters by type). The accumulator captures
    // every turn that survives in the JSONL (compaction rewrites the
    // file, so what's on disk IS the running window).
    if (role === 'user' || role === 'assistant') {
      const messageContent =
        (v as { message?: { content?: unknown } }).message?.content
        ?? (v as { content?: unknown }).content
      const text = extractMessageText(messageContent)
      if (text) summary.messages += tokenizeText(text)
    }
    if (role !== 'assistant') continue

    // Dedup on requestId — retried turns share a requestId; only the
    // first instance contributes to the running total. Applied to the
    // cacheRead overwrite below (the message-text accumulator counts
    // by content, not by usage record, so dedup doesn't apply there).
    const rid = (v as { requestId?: string }).requestId
    if (typeof rid === 'string') {
      if (seenRequestIds.has(rid)) continue
      seenRequestIds.add(rid)
    }

    const usage = ((v as { message?: { usage?: Record<string, unknown> } }).message?.usage)
      ?? ((v as { usage?: Record<string, unknown> }).usage)
    if (!usage) continue
    // Overwrite (not accumulate): we want the LATEST cache_read so the
    // panel reflects what the model is currently holding cached.
    summary.cacheRead = numberOrZero(usage.cache_read_input_tokens)
  }
  return summary
}

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// ---------------------------------------------------------------------------
// Model context-limit lookup (mirrors Rust's table)
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 200_000

function contextLimitForModel(modelId: string | null): number {
  if (!modelId) return DEFAULT_LIMIT
  const m = modelId.toLowerCase()
  if (m.startsWith('claude-opus-4')) return 1_000_000
  if (m.startsWith('claude-sonnet-4')) return 200_000
  if (m.startsWith('claude-haiku-4')) return 200_000
  return DEFAULT_LIMIT
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function computeLocalContextBreakdown(
  jsonlPath: string,
): Promise<LocalContextBreakdown> {
  const summary = await summarizeJsonl(jsonlPath)
  const cwd = summary.cwd ?? path.dirname(jsonlPath)

  // Discover enabled plugins, then tokenize their skill + subagent
  // *catalog* entries (frontmatter only — bodies are on-demand) and the
  // user's project-local custom agents (full bodies — loaded at session
  // start). Memory files are tokenized whole since they sit in the
  // system prompt cache.
  const plugins = await findEnabledPlugins(cwd)
  const [pluginSkillsCatalog, pluginAgentsCatalog, projectAgents, memory] = await Promise.all([
    Promise.all(plugins.map(tokenizeSkillCatalogEntries)).then(arr => arr.reduce((a, b) => a + b, 0)),
    Promise.all(plugins.map(tokenizeAgentCatalogEntries)).then(arr => arr.reduce((a, b) => a + b, 0)),
    tokenizeProjectAgents(cwd),
    tokenizeMemoryFiles(cwd),
  ])

  // `customAgents` mirrors what Claude Code's `/context` reports: the
  // frontmatter catalog of plugin-bundled subagents PLUS the full body
  // of the user's `.claude/agents/*.md` files. The full bodies of
  // plugin subagents are NOT here — they're spawned on-demand and don't
  // sit in the cached system prompt.
  const customAgents = pluginAgentsCatalog + projectAgents
  const skills = pluginSkillsCatalog

  const systemPrompt = CLAUDE_CODE_SYSTEM_PROMPT_TOKENS
  const systemTools = 0
  const mcpTools = 0
  const autocompactBuffer = CLAUDE_CODE_AUTOCOMPACT_BUFFER_TOKENS

  const total =
    systemPrompt
    + systemTools
    + mcpTools
    + customAgents
    + memory
    + skills
    + summary.messages

  const modelContextLimit = contextLimitForModel(summary.modelId)
  const freeSpace = Math.max(0, modelContextLimit - total - autocompactBuffer)

  return {
    systemPrompt,
    systemTools,
    mcpTools,
    customAgents,
    memory,
    skills,
    messages: summary.messages,
    autocompactBuffer,
    cacheRead: summary.cacheRead,
    freeSpace,
    total,
    modelContextLimit,
    approximate: true,
    modelId: summary.modelId,
  }
}
