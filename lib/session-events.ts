/**
 * Event taxonomy + classifier for the chronological ruler (TRDD-1657a5f4
 * Phase 5). The ruler colours each tick by the `EventKind` returned here so a
 * reader can see, at a glance, where the conversation spent its time: plain
 * turns, tool calls, MCP calls, subagent launches.
 *
 * Everything is derived from the REAL fields `normalizeLine` writes onto a
 * {@link TranscriptLine} (`role`, `isToolEvent`, `toolName`, `toolInput`,
 * `toolResult`, `toolUseId`). We classify from those, never from assumptions —
 * the source of truth is
 * `components/agent-profile/sessions/useJsonlSession.ts::extractToolInfo` /
 * `extractRole`.
 *
 * What the normalized shape lets us distinguish, and what it does NOT:
 *
 *   • tool-USE  vs tool-RESULT — DISTINGUISHABLE. `extractToolInfo` writes
 *     `toolName`+`toolInput` on an invocation (top-level `type:'tool_use'` OR a
 *     `tool_use` block inside an assistant message) and `toolResult` on a result
 *     (top-level `type:'tool_result'`). A normalized line never carries both, so
 *     `toolName` present ⇒ invocation, `toolResult` present (no `toolName`) ⇒
 *     result. We keep them as separate kinds.
 *
 *   • mcp-USE / agent-launch — RELIABLE. These key off `toolName`, which only
 *     exists on invocation records: `mcp__*` prefix ⇒ MCP, exact `Task` ⇒ a
 *     subagent spawn.
 *
 *   • mcp-RESULT — BEST-EFFORT ONLY. A tool_result record carries no `toolName`
 *     (just `toolResult`+`toolUseId`), so we usually CANNOT tell whether a
 *     result came back from an MCP tool, an ordinary tool, or a subagent. We
 *     emit `mcp-result` only when a raw MCP hint survives on the underlying
 *     record (a `name`/`toolName` field starting with `mcp__`); every other
 *     result collapses to `tool-result`. The kind stays in the union so the
 *     ruler legend is complete, but in practice most MCP outputs render as
 *     `tool-result`. Correlating a result back to its originating use by
 *     `toolUseId` is a ruler-side concern, not this classifier's.
 *
 * `classifyEvent` is pure and total: it never throws and falls back to
 * `'other'` for anything it cannot place.
 */

import type { TranscriptLine } from '@/types/sessions-browser'

/**
 * Every kind of event a transcript row can represent, in rough render order.
 *
 * - `message-user` / `message-assistant` / `message-system` — plain turns.
 * - `tool-use`   — a tool invocation (Read/Edit/Bash/…); carries `toolName`.
 * - `tool-result`— the output of a tool call; carries `toolResult`.
 * - `mcp-use`    — a tool invocation whose `toolName` starts with `mcp__`.
 * - `mcp-result` — best-effort: a result with a surviving `mcp__` raw hint.
 * - `agent-launch` — a `Task` invocation, i.e. a subagent spawn.
 * - `other`      — fallback for anything unrecognised (never thrown).
 */
export type EventKind =
  | 'message-user'
  | 'message-assistant'
  | 'message-system'
  | 'tool-use'
  | 'tool-result'
  | 'mcp-use'
  | 'mcp-result'
  | 'agent-launch'
  | 'other'

/** The `toolName` Claude Code uses for a subagent spawn. */
const TASK_TOOL_NAME = 'Task'

/** Prefix Claude Code gives every MCP tool name (e.g. `mcp__serena__find_symbol`). */
const MCP_TOOL_PREFIX = 'mcp__'

/**
 * Pull an MCP hint off the RAW record for the tool-result case, where the
 * normalized line has dropped `toolName`. We look at the same spots
 * `extractToolInfo` reads a name from (`raw.name`, `raw.toolName`) plus a
 * `tool_use`-block name nested in a content array. Returns true only when one
 * of those is a string starting with `mcp__`. Pure, total, defensive — any
 * non-object / missing field just yields false.
 */
function rawHasMcpHint(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as { name?: unknown; toolName?: unknown; content?: unknown }
  if (typeof r.name === 'string' && r.name.startsWith(MCP_TOOL_PREFIX)) return true
  if (typeof r.toolName === 'string' && r.toolName.startsWith(MCP_TOOL_PREFIX)) return true
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      if (block && typeof block === 'object') {
        const b = block as { type?: unknown; name?: unknown }
        if (
          b.type === 'tool_use' &&
          typeof b.name === 'string' &&
          b.name.startsWith(MCP_TOOL_PREFIX)
        ) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Classify a normalized transcript line into exactly one {@link EventKind}.
 *
 * Pure and total: never throws, and returns `'other'` for any record it cannot
 * place (including a malformed line missing the expected fields).
 *
 * Decision order (first match wins):
 *   1. Tool events (`isToolEvent`):
 *      a. invocation (`toolName` present)
 *         - `toolName === 'Task'`           → agent-launch
 *         - `toolName` starts with `mcp__`  → mcp-use
 *         - otherwise                       → tool-use
 *      b. result (no `toolName`, `toolResult` present)
 *         - raw record carries an `mcp__` hint → mcp-result
 *         - otherwise                          → tool-result
 *      c. a tool event that is neither (no name, no result) → other
 *   2. Plain messages, by `role`:
 *      user → message-user, assistant → message-assistant,
 *      system → message-system. (`role === 'tool'` is already covered by the
 *      tool-event branch; if a line is `role:'tool'` yet not flagged
 *      `isToolEvent`, it falls through to `other`.)
 *   3. Anything else → other.
 */
export function classifyEvent(line: TranscriptLine | null | undefined): EventKind {
  // Total: a null / non-object line can never be classified.
  if (!line || typeof line !== 'object') return 'other'

  if (line.isToolEvent) {
    const name = typeof line.toolName === 'string' ? line.toolName : ''
    if (name.length > 0) {
      // --- invocation: has a tool name ---
      if (name === TASK_TOOL_NAME) return 'agent-launch'
      if (name.startsWith(MCP_TOOL_PREFIX)) return 'mcp-use'
      return 'tool-use'
    }
    // --- result: no tool name, but a result payload ---
    if (line.toolResult !== undefined) {
      return rawHasMcpHint(line.raw) ? 'mcp-result' : 'tool-result'
    }
    // A tool event with neither a name nor a result is degenerate; bucket it.
    return 'other'
  }

  // --- plain message rows ---
  switch (line.role) {
    case 'user':
      return 'message-user'
    case 'assistant':
      return 'message-assistant'
    case 'system':
      return 'message-system'
    // `role: 'tool'` without `isToolEvent` is contradictory under
    // `normalizeLine` (it always sets the flag for tool roles); treat as other.
    default:
      return 'other'
  }
}

/**
 * Per-kind render metadata for the chronological ruler and any legend.
 *
 * Colours stay in the role palette so the ruler matches the transcript bubbles:
 *   user = blue, assistant = emerald, system = gray, tool = violet,
 *   mcp = cyan/teal, agent-launch = amber, other = gray.
 *
 * Every value is a Tailwind utility class (never a raw hex), per the
 * Tailwind-utility-first house rule:
 *   - `tailwindColor` — a text-colour token for legend labels / icons.
 *   - `dotClass`      — a background-colour token for the ruler dot/tick.
 */
export const EVENT_META: Record<
  EventKind,
  { label: string; tailwindColor: string; dotClass: string }
> = {
  'message-user': {
    label: 'User',
    tailwindColor: 'text-blue-300',
    dotClass: 'bg-blue-400',
  },
  'message-assistant': {
    label: 'Assistant',
    tailwindColor: 'text-emerald-300',
    dotClass: 'bg-emerald-400',
  },
  'message-system': {
    label: 'System',
    tailwindColor: 'text-gray-400',
    dotClass: 'bg-gray-500',
  },
  'tool-use': {
    label: 'Tool call',
    tailwindColor: 'text-violet-300',
    dotClass: 'bg-violet-400',
  },
  'tool-result': {
    label: 'Tool result',
    tailwindColor: 'text-violet-200',
    dotClass: 'bg-violet-300',
  },
  'mcp-use': {
    label: 'MCP call',
    tailwindColor: 'text-cyan-300',
    dotClass: 'bg-cyan-400',
  },
  'mcp-result': {
    label: 'MCP result',
    tailwindColor: 'text-teal-200',
    dotClass: 'bg-teal-300',
  },
  'agent-launch': {
    label: 'Subagent',
    tailwindColor: 'text-amber-300',
    dotClass: 'bg-amber-400',
  },
  other: {
    label: 'Other',
    tailwindColor: 'text-gray-400',
    dotClass: 'bg-gray-500',
  },
}

/**
 * All `EventKind` members, in render order. Handy for building a ruler legend
 * without hand-maintaining a second list. Kept in sync with the union by
 * deriving from `EVENT_META`'s keys would lose order, so this is explicit; the
 * unit test asserts it matches `EVENT_META` exactly (no missing / extra kinds).
 */
export const EVENT_KINDS: readonly EventKind[] = [
  'message-user',
  'message-assistant',
  'message-system',
  'tool-use',
  'tool-result',
  'mcp-use',
  'mcp-result',
  'agent-launch',
  'other',
]
