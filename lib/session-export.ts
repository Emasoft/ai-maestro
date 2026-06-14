/**
 * Pure serialisers for exporting a selected interval of transcript lines
 * (TRDD-1657a5f4 Phase 8). The ChatTranscript export FAB feeds the
 * already-selected, in-order `TranscriptLine[]` here and downloads the
 * result client-side — there is NO server round-trip and NO DOM access in
 * this module, so it is deterministic and unit-testable in isolation.
 *
 * Two entry points:
 *   - `toMarkdown(lines, opts?)`  → clean GitHub-flavoured Markdown.
 *   - `toPlainText(lines, opts?)` → flat plain text (no Markdown chrome),
 *     used for a "copy as text" affordance and as the print fallback body.
 *
 * Invariants both serialisers uphold:
 *   - Input order is preserved verbatim (the caller already sorted the
 *     selection into JSONL line order — we never re-sort).
 *   - ANSI escape codes are STRIPPED from every code-fenced block (and from
 *     prose bodies) via `stripAnsi`, so a `/context` capture's colour codes
 *     never leak into the file.
 *   - Empty selection → empty string (Markdown) — no stray header.
 */

import { stripAnsi } from '@/lib/ansi'
import type { TranscriptLine, MessageRole } from '@/types/sessions-browser'

export interface ExportOptions {
  /**
   * Optional document title. When provided, `toMarkdown` emits a top-level
   * `# <title>` heading followed by a blank line before the turns. Omitted
   * entirely when absent — the spec wants a headerless body for an empty
   * selection and a title-free body when the caller doesn't supply one.
   */
  title?: string
}

/**
 * Human-readable role label for a turn heading. The render layer routes a
 * `tool_result` block (which arrives inside a `user` record) through
 * `ToolUseRow`, flagged by `isToolEvent`; we mirror that here so a tool
 * event is labelled `TOOL`, not `USER`, regardless of its raw role.
 */
function roleLabel(line: TranscriptLine): string {
  if (line.isToolEvent) return 'TOOL'
  const role: MessageRole = line.role
  return role.toUpperCase()
}

/**
 * Local-time stamp for a turn heading, identical in shape to what the on-
 * screen bubbles show (`MessageBubble.formatTimestamp` /
 * `TimelineRuler.formatClock`): `YYYY-MM-DD HH:MM:SS` in the viewer's LOCAL
 * zone, built from manual get* + zero-pad (never `toLocaleString`, which
 * varies by locale and would drift from the bubbles' own stamps).
 *
 * Source priority:
 *   1. `tsMs` when finite & > 0 — the normalised epoch the UI already trusts.
 *   2. the raw ISO `timestamp` string, parsed, when `tsMs` is unusable.
 *   3. `null` (no parseable time) — the caller omits the ` — <ts>` suffix.
 *
 * Pure & deterministic for a given machine timezone; never throws.
 */
function localStamp(line: TranscriptLine): string | null {
  let d: Date | null = null
  if (Number.isFinite(line.tsMs) && line.tsMs > 0) {
    d = new Date(line.tsMs)
  } else if (line.timestamp) {
    const parsed = new Date(line.timestamp)
    if (!Number.isNaN(parsed.getTime())) d = parsed
  }
  if (!d || Number.isNaN(d.getTime())) return null
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

/**
 * Recursively strip ANSI from every string leaf of a JSON-able value, then
 * return a structurally-identical clone. This MUST happen BEFORE
 * `JSON.stringify`: a captured-stdout string carries a real ESC byte
 * (`\x1b`), but `JSON.stringify` escapes it into the literal text ``
 * (six characters), which `stripAnsi`'s ESC-byte regex can no longer match.
 * Stripping the raw string leaf first means the escape sequence is gone
 * before serialisation, so no `[..m` artefact survives in the fence.
 *
 * Arrays/objects are walked; primitives pass through unchanged. Cycles are
 * not expected in Claude Code tool payloads (plain JSON), so no seen-set is
 * needed — keeping the function pure and allocation-light.
 */
function stripAnsiDeep(value: unknown): unknown {
  if (typeof value === 'string') return stripAnsi(value)
  if (Array.isArray(value)) return value.map(stripAnsiDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripAnsiDeep(v)
    }
    return out
  }
  return value
}

/**
 * Wrap `body` in a code fence whose backtick run is guaranteed longer than
 * any backtick run *inside* `body`. CommonMark closes a fenced block at the
 * first line with at least as many backticks as the opening fence, so a
 * naive 3-backtick fence is broken out of by any tool result / terminal
 * capture that itself contains ``` ``` ``` (extremely common — Claude tool
 * output routinely echoes fenced code). Per the spec the opening fence must
 * be strictly longer than the longest interior run; we use `max(3, longest
 * run + 1)` so backtick-free bodies keep the canonical 3-backtick fence and
 * the existing exporter output is unchanged.
 *
 * @param body Already ANSI-stripped block content.
 * @param lang Optional info string (e.g. `json`); omitted when empty.
 */
function fenceBlock(body: string, lang = ''): string {
  let longestRun = 0
  let current = 0
  for (const ch of body) {
    if (ch === '`') {
      current += 1
      if (current > longestRun) longestRun = current
    } else {
      current = 0
    }
  }
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return [`${fence}${lang}`, body, fence].join('\n')
}

/**
 * Serialise the (already-selected, in-order) tool payload into a single
 * fenced JSON code block. Tool input/result are pretty-printed; string
 * leaves can carry ANSI codes (captured terminal output lives in
 * `toolResult` as a string for `local-command-stdout` events), so we strip
 * ANSI from every string leaf BEFORE serialising (see `stripAnsiDeep`).
 * The fence language is `json`; the fence length adapts to the content so a
 * payload string containing ``` ``` ``` cannot break out (see `fenceBlock`).
 *
 * `JSON.stringify` is deterministic for the object shapes Claude Code emits
 * (no Map/Set), so the output is stable across runs.
 */
function toolBlock(line: TranscriptLine): string {
  const payload: Record<string, unknown> = { tool: line.toolName ?? 'tool' }
  if (line.toolInput !== undefined) payload.input = stripAnsiDeep(line.toolInput)
  if (line.toolResult !== undefined) payload.result = stripAnsiDeep(line.toolResult)
  const json = JSON.stringify(payload, null, 2)
  return fenceBlock(json, 'json')
}

/**
 * Prose body for a non-tool turn: the message text with ANSI stripped (a
 * `local-command-stdout` capture can carry colour codes inside an assistant
 * record), fenced as a terminal block when it still looks like raw command
 * output, otherwise emitted as plain Markdown prose. We keep it simple: any
 * body that contains a control-ish escape OR the `local-command` markers is
 * fenced; everything else is prose. Empty → an italic `*(empty)*` marker so
 * the turn isn't a silent gap.
 */
function proseBody(line: TranscriptLine): string {
  const raw = line.text ?? ''
  if (raw.length === 0) return '*(empty)*'
  const stripped = stripAnsi(raw)
  // A captured slash-command stdout block reads best as a fenced terminal
  // block (preserves alignment of `/context` tables). Detect the wrapper
  // marker OR a residual ESC byte (pre-strip) as the signal.
  const looksTerminal =
    raw.includes('<local-command-stdout>') ||
    raw.includes('[') ||
    raw.includes('<command-name>')
  if (looksTerminal) {
    // Adaptive fence: a captured terminal body can itself contain ``` ``` ```
    // (e.g. a `/context` dump quoting fenced code), which would otherwise
    // break out of a fixed 3-backtick fence — see `fenceBlock`.
    return fenceBlock(stripped)
  }
  return stripped
}

/**
 * Reasoning (extended-thinking) note for a turn that carried `thinking`
 * blocks. Rendered as a `> reasoning` blockquote so it's visually distinct
 * from the answer and collapsible-by-convention in Markdown viewers.
 * Redacted-thinking blocks (no readable text) contribute a count marker.
 * Returns `null` when the turn carried no reasoning signal.
 */
function reasoningBlock(line: TranscriptLine): string | null {
  const thinking = (line.thinkingText ?? '').trim()
  const redacted = line.redactedThinkingCount ?? 0
  if (thinking.length === 0 && redacted <= 0) return null
  const lines: string[] = ['> **reasoning**']
  if (thinking.length > 0) {
    // Strip ANSI (defensive) and prefix every line with `> ` so multi-line
    // reasoning stays inside the one blockquote.
    for (const ln of stripAnsi(thinking).split('\n')) {
      lines.push(`> ${ln}`)
    }
  }
  if (redacted > 0) {
    lines.push(`>`)
    lines.push(`> *[redacted reasoning ×${redacted}]*`)
  }
  return lines.join('\n')
}

/**
 * Serialise the given transcript lines to clean Markdown.
 *
 * Layout per turn:
 *   ## <ROLE> — <local ts>
 *
 *   > **reasoning**            (only when the turn carried thinking)
 *   > ...
 *
 *   <prose body | fenced terminal block | fenced tool JSON>
 *
 * Turns are separated by a blank line. An optional `# <title>` precedes the
 * first turn. An EMPTY selection returns an empty string (no header) per the
 * Phase 8 spec.
 */
export function toMarkdown(lines: TranscriptLine[], opts?: ExportOptions): string {
  if (!lines || lines.length === 0) return ''

  const out: string[] = []
  const title = opts?.title?.trim()
  if (title) {
    out.push(`# ${title}`)
    out.push('')
  }

  for (const line of lines) {
    const stamp = localStamp(line)
    out.push(`## ${roleLabel(line)}${stamp ? ` — ${stamp}` : ''}`)
    out.push('')

    const reasoning = reasoningBlock(line)
    if (reasoning) {
      out.push(reasoning)
      out.push('')
    }

    out.push(line.isToolEvent ? toolBlock(line) : proseBody(line))
    out.push('')
  }

  // Trim a single trailing blank line so the document ends with a newline-
  // terminated final block rather than two blank lines.
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n') + '\n'
}

/**
 * Flat plain-text serialisation — same ordering and ANSI-stripping as
 * `toMarkdown`, but without Markdown chrome (no `#`, `>`, or code fences).
 * Used for a "copy as text" affordance and as the print fallback body.
 * Empty selection → empty string.
 */
export function toPlainText(lines: TranscriptLine[], opts?: ExportOptions): string {
  if (!lines || lines.length === 0) return ''

  const out: string[] = []
  const title = opts?.title?.trim()
  if (title) {
    out.push(title)
    out.push('='.repeat(title.length))
    out.push('')
  }

  for (const line of lines) {
    const stamp = localStamp(line)
    out.push(`${roleLabel(line)}${stamp ? `  ${stamp}` : ''}`)

    const thinking = (line.thinkingText ?? '').trim()
    if (thinking.length > 0) {
      out.push(`[reasoning] ${stripAnsi(thinking)}`)
    }
    const redacted = line.redactedThinkingCount ?? 0
    if (redacted > 0) out.push(`[redacted reasoning ×${redacted}]`)

    if (line.isToolEvent) {
      // Strip ANSI from string leaves BEFORE serialising — see toolBlock /
      // stripAnsiDeep for why stringify-then-strip misses escaped ESC bytes.
      const payload: Record<string, unknown> = { tool: line.toolName ?? 'tool' }
      if (line.toolInput !== undefined) payload.input = stripAnsiDeep(line.toolInput)
      if (line.toolResult !== undefined) payload.result = stripAnsiDeep(line.toolResult)
      out.push(JSON.stringify(payload, null, 2))
    } else {
      out.push(line.text && line.text.length > 0 ? stripAnsi(line.text) : '(empty)')
    }
    out.push('')
  }

  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n') + '\n'
}
