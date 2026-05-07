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

/**
 * The primary, displayed numbers ALWAYS come from the heuristic
 * (JSONL-parse + on-disk tokenization) path — this is what the user
 * sees in the right panel. When the session contains a captured
 * `/context` slash-command output at-or-before the requested cursor,
 * its numbers are surfaced separately under `recordedSnapshot` so
 * the UI can show a per-bucket comparison badge. That way a drift
 * between heuristic and captured numbers is VISIBLE — meaning bugs
 * in the heuristic surface as "expected 13.5K, captured 15.2K"
 * rather than silently masking themselves behind a "use captured
 * when available" fallback.
 */
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
  /** Sum of tokens across enabled skills. */
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
  /** Whether we used char/4 estimation anywhere. Always true. */
  approximate: boolean
  /** Last-seen model id from the JSONL. */
  modelId: string | null
  /**
   * Always 'heuristic' now. Kept on the type for wire backwards
   * compatibility — older clients keyed UI off this field. New
   * clients should look at `recordedSnapshot` instead.
   */
  source: 'heuristic'
  /** Deprecated — use `recordedSnapshot.capturedAtLineIndex`. */
  capturedAtLineIndex: number | null
  /** Deprecated — use `recordedSnapshot.capturedAtTimestamp`. */
  capturedAtTimestamp: string | null
  /**
   * Captured `/context` snapshot at-or-before the requested cursor,
   * when one exists in the session. Numbers come VERBATIM from the
   * slash-command output Claude wrote into the JSONL — the BPE
   * tokenizer's ground truth at the time the user ran `/context`.
   * Absent when the session has no captured snapshot in scope.
   */
  recordedSnapshot: RecordedContextSnapshot | null
  /**
   * Per-bucket element listings for the drill-down sub-page. Always
   * present (with empty arrays / notes when the bucket isn't
   * enumerated). The drill-down UI groups elements by scope and
   * shows total counts + percentages.
   */
  elements: ContextElements
}

export interface RecordedContextSnapshot {
  systemPrompt: number
  customAgents: number
  memory: number
  skills: number
  messages: number
  autocompactBuffer: number
  freeSpace: number
  total: number
  modelContextLimit: number
  modelId: string | null
  /** 0-based JSONL line index where Claude wrote the snapshot. */
  capturedAtLineIndex: number
  /** ISO timestamp on the captured record (when present). */
  capturedAtTimestamp: string | null
}

/**
 * One element loaded into the context window — a single memory file,
 * skill, agent, etc. The drill-down sub-page renders a list of these
 * for the bucket the user clicked on. Elements are named with their
 * plugin prefix when applicable (`pluginName:skillName`) so the user
 * can tell which plugin a skill came from at a glance.
 */
export interface BucketElement {
  /** Display name shown in the drill-down list. */
  name: string
  /** Token cost (heuristic — char/4). */
  tokens: number
  /**
   * Where the element is installed:
   *   - 'user'    — ~/.claude/* (CLAUDE.md, rules, agents)
   *   - 'project' — <cwd>/.claude/* (per-project)
   *   - 'plugin'  — bundled in an enabled plugin
   *   - 'builtin' — Claude Code itself (system prompt etc.)
   */
  scope: 'user' | 'project' | 'plugin' | 'builtin'
  /** Free-form path / identifier for tooltip. */
  detail?: string
}

export interface MessageElements {
  /** Total tokens across all message text (user + assistant). */
  tokens: number
  userCount: number
  assistantCount: number
}

export interface ConstantBucket {
  /** Token cost — typically a constant like CLAUDE_CODE_SYSTEM_PROMPT_TOKENS. */
  tokens: number
  /** Human-readable note explaining why we don't enumerate this bucket. */
  note: string
}

/**
 * Per-bucket element listings. The drill-down sub-page in the
 * Context panel reads from this. Buckets we don't enumerate yet
 * (systemTools, mcpTools) carry a `note` instead of an element list
 * so the user sees an explicit "we don't track these yet" message.
 *
 * Item-12 wiring: the UI compares each bucket's enumerated element
 * count against `recordedSnapshot[bucket]`. When the captured
 * /context shows tokens for a bucket but our enumerator returns
 * none, the UI flags it as `[missing]` so the gap is visible.
 */
export interface ContextElements {
  systemPrompt: ConstantBucket
  systemTools: ConstantBucket
  mcpTools: ConstantBucket
  customAgents: BucketElement[]
  memory: BucketElement[]
  skills: BucketElement[]
  messages: MessageElements
  autocompactBuffer: ConstantBucket
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
 * Extract specific top-level YAML frontmatter scalars from a markdown
 * file. Returns a string containing the values of every requested field
 * concatenated with spaces — same shape Claude Code's
 * `estimateSkillFrontmatterTokens` / `countCustomAgentTokens` use to
 * count the catalog entries that sit in the always-on system prompt.
 *
 * Why scalars only: Claude Code's `/context` accounts for skills and
 * subagents using ONLY `name + description + whenToUse` (skills) or
 * `agentType + whenToUse` (agents). The rest of the frontmatter
 * (allowed-tools, auto-load flags, etc.) is metadata the renderer uses
 * but never lands in the cached system prompt — counting the whole
 * frontmatter inflates the estimate ~3× on skill-rich plugins.
 *
 * Parsing is intentionally tolerant: scalar values may be quoted,
 * single-quoted, multi-line via `>` / `|`, or just bare strings until
 * end of line. We do NOT parse nested keys, lists, or anchors — those
 * never appear in catalog scalars.
 */
async function readFrontmatterFields(filePath: string, fields: string[]): Promise<string> {
  let txt: string
  try {
    txt = await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
  if (!txt.startsWith('---\n') && !txt.startsWith('---\r\n')) return ''
  const fmEnd = txt.indexOf('\n---', 4)
  if (fmEnd < 0) return ''
  const fm = txt.slice(0, fmEnd)
  const out: string[] = []
  for (const field of fields) {
    const value = extractYamlScalar(fm, field)
    if (value) out.push(value)
  }
  return out.join(' ')
}

/**
 * Pull a top-level scalar value for `field` out of a YAML frontmatter
 * block. Supports plain, single-quoted, double-quoted, and folded
 * (`>`/`|`) scalars. Returns '' when the field is absent.
 */
function extractYamlScalar(fm: string, field: string): string {
  const lines = fm.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^${field}\\s*:\\s*(.*)$`).exec(lines[i] ?? '')
    if (!m) continue
    let val = (m[1] ?? '').trim()
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      // Folded multi-line scalar — collect indented continuations until
      // the next un-indented key or end of frontmatter.
      const buf: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? ''
        if (/^\S/.test(next)) break
        buf.push(next.trim())
      }
      return buf.join(' ')
    }
    // Strip wrapping quotes if present.
    if ((val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    return val
  }
  return ''
}

async function enumerateSkillCatalogEntries(plugin: EnabledPlugin): Promise<BucketElement[]> {
  // Match `estimateSkillFrontmatterTokens(skill)` from Claude Code:
  //   roughTokenCountEstimation([name, description, whenToUse].join(' '))
  // → counts only the 3 catalog scalars, NOT the full SKILL body, and
  //   NOT every other YAML key.
  // We return per-skill elements named `pluginName:skillName` so the
  // drill-down sub-page can show every loaded skill individually.
  const skillsDir = path.join(plugin.installPath, 'skills')
  const entries = await readDirSafe(skillsDir)
  const out: BucketElement[] = []
  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry, 'SKILL.md')
    const fields = await readFrontmatterFields(skillPath, ['name', 'description', 'whenToUse'])
    if (!fields) continue
    out.push({
      name: `${plugin.name}:${entry}`,
      tokens: tokenizeText(fields),
      scope: 'plugin',
      detail: skillPath,
    })
  }
  return out
}

async function enumerateAgentCatalogEntries(plugin: EnabledPlugin): Promise<BucketElement[]> {
  // Match `countCustomAgentTokens` from Claude Code:
  //   countTokensWithFallback([{role:'user', content: [agentType, whenToUse].join(' ')}])
  // → only `agentType` + `whenToUse`. The rest of the agent body is
  //   loaded on-demand when the Task tool spawns it.
  // Some plugin-shipped subagents declare `name:` instead of
  // `agentType:` — tolerate both. Display name uses the file stem
  // when no `agentType`/`name` field is present so the drill-down
  // never shows blank rows.
  const agentsDir = path.join(plugin.installPath, 'agents')
  const entries = await readDirSafe(agentsDir)
  const out: BucketElement[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const fields = await readFrontmatterFields(
      path.join(agentsDir, entry),
      ['agentType', 'name', 'whenToUse', 'description'],
    )
    if (!fields) continue
    const agentName = entry.replace(/\.md$/, '')
    out.push({
      name: `${plugin.name}:${agentName}`,
      tokens: tokenizeText(fields),
      scope: 'plugin',
      detail: path.join(agentsDir, entry),
    })
  }
  return out
}

async function enumerateMemoryFiles(cwd: string): Promise<BucketElement[]> {
  // Mirror Claude Code's `getMemoryFiles()` walk:
  //   1. User scope: ~/.claude/CLAUDE.md + ~/.claude/rules/*.md
  //   2. Project scope: for EVERY ancestor directory from filesystem
  //      root down to cwd, look for CLAUDE.md, .claude/CLAUDE.md,
  //      .claude/rules/*.md, and CLAUDE.local.md. Claude inlines all
  //      of these into the cached system prompt.
  // Each path is tokenized exactly once (de-dupe via a Set) so a
  // CLAUDE.md that's both at the cwd and a parent isn't counted twice.
  const home = homedir()
  const seen = new Set<string>()
  const candidates: Array<{ p: string; scope: 'user' | 'project' }> = []
  const add = (p: string, scope: 'user' | 'project') => {
    if (!seen.has(p)) {
      seen.add(p)
      candidates.push({ p, scope })
    }
  }

  // User scope
  add(path.join(home, '.claude', 'CLAUDE.md'), 'user')
  add(path.join(home, '.claude', 'TOKF.md'), 'user')
  for (const entry of await readDirSafe(path.join(home, '.claude', 'rules'))) {
    if (entry.endsWith('.md')) add(path.join(home, '.claude', 'rules', entry), 'user')
  }

  // Project scope: walk from cwd up to filesystem root.
  let dir = path.resolve(cwd)
  const root = path.parse(dir).root
  // Hard cap on depth so a malformed cwd can't loop forever.
  let safety = 32
  while (safety-- > 0) {
    add(path.join(dir, 'CLAUDE.md'), 'project')
    add(path.join(dir, '.claude', 'CLAUDE.md'), 'project')
    add(path.join(dir, 'CLAUDE.local.md'), 'project')
    for (const entry of await readDirSafe(path.join(dir, '.claude', 'rules'))) {
      if (entry.endsWith('.md')) add(path.join(dir, '.claude', 'rules', entry), 'project')
    }
    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const out: BucketElement[] = []
  for (const c of candidates) {
    const tokens = await tokenizeFile(c.p)
    if (tokens === 0) continue // skip files that don't exist
    out.push({
      name: c.p.startsWith(home) ? `~${c.p.slice(home.length)}` : c.p,
      tokens,
      scope: c.scope,
      detail: c.p,
    })
  }
  return out
}

async function enumerateProjectAgents(cwd: string): Promise<BucketElement[]> {
  // .claude/agents/*.md = user-defined custom agents in the project.
  // Unlike plugin subagents, these are loaded as full personas at session
  // start (Claude Code includes the full body of each user-authored
  // agent in the cached system prompt). We tokenize the whole file.
  const agentsDir = path.join(cwd, '.claude', 'agents')
  const entries = await readDirSafe(agentsDir)
  const out: BucketElement[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const filePath = path.join(agentsDir, entry)
    const tokens = await tokenizeFile(filePath)
    if (tokens === 0) continue
    out.push({
      name: entry.replace(/\.md$/, ''),
      tokens,
      scope: 'project',
      detail: filePath,
    })
  }
  return out
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
  /** How many user messages contributed to `messages`. Used by the drill-down. */
  userMessageCount: number
  /** How many assistant messages contributed to `messages`. */
  assistantMessageCount: number
  /** Latest assistant turn's `cache_read_input_tokens`. */
  cacheRead: number
  /**
   * Latest assistant turn's full API usage. Claude Code's `/context`
   * uses `input + cache_creation + cache_read` of the most recent
   * assistant turn as the displayed Total — that's the "what's
   * actually in the window right now" number. When this is available
   * we prefer it over the bucket sum.
   */
  latestApiUsage: {
    inputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
  } | null
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
  const empty: JsonlSummary = {
    cwd: null,
    modelId: null,
    messages: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    cacheRead: 0,
    latestApiUsage: null,
  }
  let raw: string
  try {
    raw = await fs.readFile(jsonlPath, 'utf8')
  } catch {
    return empty
  }
  const lines = raw.split('\n')
  const summary: JsonlSummary = { ...empty }
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
      if (text) {
        summary.messages += tokenizeText(text)
        if (role === 'user') summary.userMessageCount++
        else summary.assistantMessageCount++
      }
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
    // Overwrite (not accumulate): the latest assistant record carries
    // the running-window snapshot the model just saw, which is what
    // Claude Code's `/context` displays.
    summary.cacheRead = numberOrZero(usage.cache_read_input_tokens)
    summary.latestApiUsage = {
      inputTokens: numberOrZero(usage.input_tokens),
      cacheCreationTokens: numberOrZero(usage.cache_creation_input_tokens),
      cacheReadTokens: numberOrZero(usage.cache_read_input_tokens),
    }
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
// /context snapshot parser — when Claude itself ran the slash command
// ---------------------------------------------------------------------------

/**
 * If the user ran `/context` during the session, Claude Code captured
 * the slash command's stdout — including the full per-bucket breakdown
 * and totals — into the JSONL as a `system / local_command` record.
 * Those numbers are computed by Claude against the on-disk state AT
 * THE TIME OF THE COMMAND, with the API's BPE tokenizer. They're the
 * ground truth for the snapshot.
 *
 * This function scans the JSONL for the LATEST such record and parses
 * out the numbers. When found, the breakdown function uses these
 * directly instead of re-tokenizing today's on-disk state (which has
 * almost certainly drifted in the hours since the session ran).
 *
 * Returns `null` when no `/context` was ever captured in this session.
 *
 * Future: take a `selectedMessageIndex` arg to pick the latest snapshot
 * AT OR BEFORE that index — so navigating the transcript updates the
 * panel to the snapshot Claude saw at that moment, not the most recent
 * one.
 */
interface ParsedContextSnapshot {
  systemPrompt: number
  customAgents: number
  memory: number
  skills: number
  messages: number
  autocompactBuffer: number
  freeSpace: number
  total: number
  modelContextLimit: number
  modelId: string | null
  /** 0-based JSONL line index of the captured `system / local_command` record. */
  capturedAtLineIndex: number
  /** ISO timestamp Claude wrote on the captured record, when present. */
  capturedAtTimestamp: string | null
}

/**
 * Find a captured `/context` snapshot in the JSONL.
 *
 * When `atOrBeforeLineIndex` is provided, returns the LATEST snapshot
 * with `lineIndex <= atOrBeforeLineIndex`. This lets the right panel
 * reflect the breakdown the model actually saw at the moment of the
 * selected transcript message — scrolling back through the history
 * updates the panel to the snapshot Claude saw at THAT point in time.
 *
 * Without that arg, returns the latest snapshot in the entire file.
 */
async function parseRecordedContextSnapshot(
  jsonlPath: string,
  atOrBeforeLineIndex?: number,
): Promise<ParsedContextSnapshot | null> {
  let raw: string
  try {
    raw = await fs.readFile(jsonlPath, 'utf8')
  } catch {
    return null
  }

  const allLines = raw.split('\n')
  // We walk the file with the original (forward) line indices so we
  // can correctly compare each candidate's index against
  // `atOrBeforeLineIndex`. To pick the LATEST qualifying snapshot we
  // remember the best match as we go.
  let best: ParsedContextSnapshot | null = null
  for (let i = 0; i < allLines.length; i++) {
    if (atOrBeforeLineIndex !== undefined && i > atOrBeforeLineIndex) break
    const line = allLines[i]
    if (!line) continue
    let v: Record<string, unknown>
    try {
      v = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (v.type !== 'system') continue
    if (v.subtype !== 'local_command') continue
    const content = typeof v.content === 'string' ? v.content : ''
    if (!content.includes('Context Usage')) continue
    if (!content.includes('Estimated usage by category')) continue

    // Strip ANSI escapes — same pattern as `lib/ansi.ts:stripAnsi`,
    // duplicated here so this module stays usable from a worker
    // without a React dep tree.
    const stripped = content.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

    const fields = parseContextFields(stripped)
    if (!fields) continue
    const ts = typeof v.timestamp === 'string' ? v.timestamp : null
    best = { ...fields, capturedAtLineIndex: i, capturedAtTimestamp: ts }
  }
  return best
}

/**
 * Parse the per-bucket numbers out of an ANSI-stripped /context dump.
 * Returns `null` when the format doesn't match (defensive — Claude
 * Code's printed format changes occasionally).
 */
function parseContextFields(text: string): {
  systemPrompt: number
  customAgents: number
  memory: number
  skills: number
  messages: number
  autocompactBuffer: number
  freeSpace: number
  total: number
  modelContextLimit: number
  modelId: string | null
} | null {
  // Helper: parse "8.2k", "33k", "860.2k", "1m" → integer tokens.
  const parseTokenStr = (s: string): number => {
    const trimmed = s.trim().toLowerCase()
    const m = /^([0-9]+(?:\.[0-9]+)?)\s*([km]?)/.exec(trimmed)
    if (!m) return 0
    const n = parseFloat(m[1] ?? '0')
    if (m[2] === 'm') return Math.round(n * 1_000_000)
    if (m[2] === 'k') return Math.round(n * 1_000)
    return Math.round(n)
  }

  // Each bucket line follows: `<Label>: <NUM>[k|m] tokens (<pct>%)`
  // — except Free space which omits the literal "tokens" word. We
  // match flexibly.
  const grab = (label: string): number | null => {
    const re = new RegExp(`${label}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?\\s*[km]?)`, 'i')
    const m = re.exec(text)
    return m ? parseTokenStr(m[1] ?? '') : null
  }

  const systemPrompt = grab('System prompt')
  const customAgents = grab('Custom agents')
  const memory = grab('Memory files')
  const skills = grab('Skills')
  const messages = grab('Messages')
  const freeSpace = grab('Free space')
  const autocompactBuffer = grab('Autocompact buffer')

  // Total + model context window come from the header line:
  //   "91.6k/1m tokens (9%)"
  const totalRe = /([0-9]+(?:\.[0-9]+)?\s*[km]?)\s*\/\s*([0-9]+(?:\.[0-9]+)?\s*[km]?)\s*tokens/i
  const totalMatch = totalRe.exec(text)
  const total = totalMatch ? parseTokenStr(totalMatch[1] ?? '') : null
  const modelContextLimit = totalMatch ? parseTokenStr(totalMatch[2] ?? '') : null

  // Model id from "claude-opus-4-7[1m]" / "claude-sonnet-4-6" etc.
  // The `[1m]` suffix is Claude's "extended-context" tag — we strip it.
  const modelMatch = /\b(claude-(?:opus|sonnet|haiku)-[\d-]+(?:-[a-z0-9]+)?)/i.exec(text)
  const modelId = modelMatch ? (modelMatch[1] ?? null) : null

  if (
    systemPrompt === null
    || customAgents === null
    || memory === null
    || skills === null
    || messages === null
    || freeSpace === null
    || autocompactBuffer === null
    || total === null
    || modelContextLimit === null
  ) {
    return null
  }

  return {
    systemPrompt,
    customAgents,
    memory,
    skills,
    messages,
    autocompactBuffer,
    freeSpace,
    total,
    modelContextLimit,
    modelId,
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ComputeLocalContextBreakdownOptions {
  /**
   * If provided, return the latest captured `/context` snapshot at or
   * before this line index. Lets the right panel reflect the
   * snapshot the model saw at the moment of the user's selected
   * transcript message instead of always showing the most recent
   * one. Pass `undefined` (or omit) to get the most recent snapshot.
   */
  atOrBeforeLineIndex?: number
}

export async function computeLocalContextBreakdown(
  jsonlPath: string,
  options: ComputeLocalContextBreakdownOptions = {},
): Promise<LocalContextBreakdown> {
  // Always run the heuristic path. The captured `/context` numbers
  // (when available) are surfaced separately as `recordedSnapshot`
  // so the UI can show a side-by-side comparison — that way drift
  // between our heuristic and Claude's BPE tokenizer is VISIBLE,
  // and bugs in the heuristic don't silently hide behind a "use
  // captured when present" fallback.
  const [snapshot, summary] = await Promise.all([
    parseRecordedContextSnapshot(jsonlPath, options.atOrBeforeLineIndex),
    summarizeJsonl(jsonlPath),
  ])

  const cwd = summary.cwd ?? path.dirname(jsonlPath)

  // Discover enabled plugins, then enumerate their skill + subagent
  // catalog entries (frontmatter only — bodies are on-demand) and the
  // user's project-local custom agents (full bodies — loaded at
  // session start). Memory files are tokenized whole since they sit
  // in the system prompt cache. Each enumerator returns
  // BucketElement[]; we sum tokens and surface the lists in
  // `elements` for the drill-down sub-page.
  const plugins = await findEnabledPlugins(cwd)
  const [pluginSkillElements, pluginAgentElements, projectAgentElements, memoryElements] = await Promise.all([
    Promise.all(plugins.map(enumerateSkillCatalogEntries)).then(arrs => arrs.flat()),
    Promise.all(plugins.map(enumerateAgentCatalogEntries)).then(arrs => arrs.flat()),
    enumerateProjectAgents(cwd),
    enumerateMemoryFiles(cwd),
  ])

  const sumTokens = (xs: BucketElement[]) => xs.reduce((s, e) => s + e.tokens, 0)

  // `customAgents` mirrors what Claude Code's `/context` reports: the
  // frontmatter catalog of plugin-bundled subagents PLUS the full body
  // of the user's `.claude/agents/*.md` files. Plugin-subagent bodies
  // are NOT here — they're spawned on-demand and don't sit in the
  // cached system prompt.
  const customAgentElements: BucketElement[] = [...pluginAgentElements, ...projectAgentElements]
  const customAgents = sumTokens(customAgentElements)
  const skills = sumTokens(pluginSkillElements)
  const memory = sumTokens(memoryElements)

  const systemPrompt = CLAUDE_CODE_SYSTEM_PROMPT_TOKENS
  const systemTools = 0
  const mcpTools = 0
  const autocompactBuffer = CLAUDE_CODE_AUTOCOMPACT_BUFFER_TOKENS

  // Bucket sum (estimated from on-disk content + JSONL message text).
  const bucketSum =
    systemPrompt
    + systemTools
    + mcpTools
    + customAgents
    + memory
    + skills
    + summary.messages

  // Claude Code's `/context` prefers the API-reported running-window
  // size (input + cache_creation + cache_read of the latest assistant
  // turn) for the displayed Total — that's the actual size the model
  // saw. When that's available we use it; otherwise fall back to the
  // bucket sum so brand-new sessions still display something useful.
  const total = summary.latestApiUsage
    ? summary.latestApiUsage.inputTokens
      + summary.latestApiUsage.cacheCreationTokens
      + summary.latestApiUsage.cacheReadTokens
    : bucketSum

  const modelContextLimit = contextLimitForModel(summary.modelId)
  // Free space = model limit - actualUsage - reservedBuffer. We use
  // `bucketSum` here (not `total`) because that's the per-category
  // breakdown the user is actually looking at; the API total is shown
  // separately in the header. Otherwise free space and the bars would
  // disagree on a session whose API total differs from the bucket sum.
  const freeSpace = Math.max(0, modelContextLimit - bucketSum - autocompactBuffer)

  const recordedSnapshot: RecordedContextSnapshot | null = snapshot
    ? {
        systemPrompt: snapshot.systemPrompt,
        customAgents: snapshot.customAgents,
        memory: snapshot.memory,
        skills: snapshot.skills,
        messages: snapshot.messages,
        autocompactBuffer: snapshot.autocompactBuffer,
        freeSpace: snapshot.freeSpace,
        total: snapshot.total,
        modelContextLimit: snapshot.modelContextLimit,
        modelId: snapshot.modelId,
        capturedAtLineIndex: snapshot.capturedAtLineIndex,
        capturedAtTimestamp: snapshot.capturedAtTimestamp,
      }
    : null

  // Per-bucket element listings consumed by the drill-down sub-page.
  // Buckets we don't enumerate yet (systemTools, mcpTools, system
  // prompt, autocompact) carry a `note` instead of an element list so
  // the user sees explicitly that we don't track them. Item-12: when
  // the captured /context shows a non-zero number for one of these
  // and our enumerator returns 0, the panel UI flags it as `[missing]`.
  const elements: ContextElements = {
    systemPrompt: {
      tokens: systemPrompt,
      note: 'Built into Claude Code itself — not loaded from disk.',
    },
    systemTools: {
      tokens: systemTools,
      note: 'Tool descriptors are baked into the system prompt by the Claude Code binary; we cannot enumerate them locally.',
    },
    mcpTools: {
      tokens: mcpTools,
      note: 'MCP tool descriptors are loaded by the Claude Code MCP client at session start; the JSONL does not record them. Token-size ledger (Phase C) will fill this gap.',
    },
    customAgents: customAgentElements,
    memory: memoryElements,
    skills: pluginSkillElements,
    messages: {
      tokens: summary.messages,
      userCount: summary.userMessageCount,
      assistantCount: summary.assistantMessageCount,
    },
    autocompactBuffer: {
      tokens: autocompactBuffer,
      note: 'Reserved by Claude Code for the auto-compaction safety margin.',
    },
  }

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
    source: 'heuristic',
    // Mirror the snapshot's metadata into the legacy top-level
    // fields for any wire consumer that still reads them. New code
    // should use `recordedSnapshot` directly.
    capturedAtLineIndex: recordedSnapshot?.capturedAtLineIndex ?? null,
    capturedAtTimestamp: recordedSnapshot?.capturedAtTimestamp ?? null,
    recordedSnapshot,
    elements,
  }
}
