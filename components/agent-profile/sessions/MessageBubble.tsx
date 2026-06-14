'use client'

/**
 * MessageBubble — renders a single transcript line (user/assistant/system)
 * with role-coloring, optional token badge, slash-command pill, and
 * search highlight.
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.3):
 *   - Each assistant bubble has `IN/OUT/CACHE` token credits at top-right.
 *   - Role colors: user=blue, assistant=emerald, system=gray, tool=violet.
 *   - Tool events are rendered by `<ToolUseRow>`, NOT this component.
 *   - Slash commands written by Claude Code as `<command-name>/foo</command-name>`
 *     XML-tagged text are detected and rendered as a compact command pill
 *     instead of dumping the raw markup.
 *   - Every bubble carries a human-readable timestamp.
 */

import { useCallback, useMemo, useState } from 'react'
import { Check, Copy, User, Sparkles, Terminal as TerminalIcon, Brain, ChevronRight } from 'lucide-react'
import type { TranscriptLine, MessageUsage } from '@/types/sessions-browser'
import { parseAnsi, stripAnsi } from '@/lib/ansi'
import { costBreakdown, formatUsd, isFallbackFamily, APPROX_COST_CAVEAT } from '@/lib/token-cost'

interface MessageBubbleProps {
  line: TranscriptLine
  /** Current search query (already .toLowerCase()) — empty string disables highlight. */
  highlightQuery?: string
  /** Current match position in this line's text, if this line IS the current match. */
  currentMatch?: boolean
  /**
   * Resolved avatar image URL for the agent. When the bubble's role is
   * `assistant`, this URL is rendered as the role icon (matches the
   * sidebar badge). User / system / tool roles keep the lucide vector
   * icons because there's no equivalent stored portrait for them.
   */
  assistantAvatarUrl?: string | null
}

/**
 * Estimate the token cost of a chunk of text using the standard char/4
 * BPE approximation. Used for user/system bubbles that carry no `usage`
 * field on the JSONL record (only assistant turns do, and only some).
 *
 * The estimate matches the heuristic the rest of the dashboard uses for
 * messages-bucket sizing — keeps the per-bubble readout consistent with
 * the right-panel comparison overlay.
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

// Role-based palette. Tints are bumped so each role is visibly distinct
// even at a glance (item-5 of the 14-bug review). User=blue is the most
// saturated since users tend to send fewer messages — they need to stand
// out. Assistant=emerald is the dominant chrome of the dashboard so we
// keep it slightly muted. System=gray reads as ambient. Tool=violet is
// further differentiated by an explicit left-margin indent applied at
// the wrapper level (`ml-[28px]` on the ToolUseRow container).
//
// `tailBg` / `tailBorder` carry the SAME color tokens as `wrapper`, split
// into the two pieces a clip-path tail needs (the tail is a separate
// <div>, so it can't share the combined `border-… bg-…` string). Keeping
// them in lock-step with `wrapper` here means the speech-bubble tail joins
// the body seamlessly — change one, change all four in this block.
const ROLE_STYLES: Record<
  string,
  { wrapper: string; label: string; text: string; icon: typeof User; tailBg: string; tailBorder: string }
> = {
  user: {
    wrapper: 'border-blue-400/60 bg-blue-500/[0.18]',
    label: 'text-blue-200',
    text: 'text-gray-100',
    icon: User,
    tailBg: 'bg-blue-500/[0.18]',
    tailBorder: 'border-blue-400/60',
  },
  assistant: {
    wrapper: 'border-emerald-500/40 bg-emerald-500/[0.10]',
    label: 'text-emerald-300',
    text: 'text-gray-100',
    icon: Sparkles,
    tailBg: 'bg-emerald-500/[0.10]',
    tailBorder: 'border-emerald-500/40',
  },
  system: {
    wrapper: 'border-gray-500/50 bg-gray-700/40',
    label: 'text-gray-400',
    text: 'text-gray-300',
    icon: TerminalIcon,
    tailBg: 'bg-gray-700/40',
    tailBorder: 'border-gray-500/50',
  },
  tool: {
    wrapper: 'border-violet-400/50 bg-violet-500/[0.12]',
    label: 'text-violet-300',
    text: 'text-gray-200',
    icon: TerminalIcon,
    tailBg: 'bg-violet-500/[0.12]',
    tailBorder: 'border-violet-400/50',
  },
}

function formatTokenNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Pull the Claude model id out of a raw JSONL record. Claude Code writes
 * it at `message.model` (e.g. `"claude-opus-4-8"`) on every assistant
 * record that carries usage — verified against live `.jsonl` files. The
 * top-level `record.model` is NOT used by Claude Code, so we read only the
 * nested path. `TranscriptLine.raw` is typed `unknown`, so we narrow
 * defensively: any non-object, or a missing/non-string `message.model`,
 * yields `null`. A `null` model is intentional, not an error — the cost
 * module's {@link isFallbackFamily} then flags the bubble as priced at the
 * mid-tier (sonnet) fallback so the UI can say "assuming sonnet-tier rates"
 * rather than silently presenting numbers as if the model were known.
 */
function resolveLineModel(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = (raw as { message?: unknown }).message
  if (!msg || typeof msg !== 'object') return null
  const model = (msg as { model?: unknown }).model
  return typeof model === 'string' && model.length > 0 ? model : null
}

/**
 * One row of the expanded per-bucket cost breakdown: a labelled token count
 * plus its INDICATIVE USD contribution. Money is rendered with a leading
 * `~` and carries {@link APPROX_COST_CAVEAT} as its tooltip — it is NEVER
 * the user's real flat-rate spend, only an API-equivalent yardstick.
 *
 * `nested` indents sub-rows (the ephemeral 5m/1h split of cache-creation)
 * and drops the dollar figure, because the cost module bills the whole
 * `cacheCreationTokens` at the 5-minute write rate — the 5m/1h split is a
 * display-only drill-down, not a separate price (see MessageUsage docs), so
 * showing a per-tier dollar amount would double-count or mislead.
 */
function CostRow({
  label,
  tokens,
  usd,
  nested = false,
}: {
  label: string
  tokens: number
  usd?: number
  nested?: boolean
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${nested ? 'pl-3 text-gray-400' : 'text-gray-200'}`}>
      <span className={`uppercase tracking-[0.08em] text-[10px] font-semibold ${nested ? 'text-gray-500' : 'text-amber-300/90'}`}>
        {label}
      </span>
      <span className="flex items-baseline gap-2 tabular-nums lining-nums">
        <span className="text-emerald-300 font-semibold">{formatTokenNumber(tokens)}</span>
        {usd !== undefined && (
          <span
            className="text-gray-400 text-[10px] min-w-[58px] text-right"
            title={APPROX_COST_CAVEAT}
          >
            ~{formatUsd(usd)}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * Expandable token-cost element shared by the compact and full bubble
 * branches (single source of truth — formerly the IN/OUT/CACHE block was
 * copy-pasted into both, and the compact branch silently dropped the
 * estimate case entirely; this component fixes both).
 *
 * COLLAPSED (default — adds ZERO vertical height to the bubble): a compact
 * `<button>` badge. For assistant turns with a real `usage` record it shows
 * the total token count + a tiny `~$X` indicative figure; for estimate-only
 * turns (user / system / unsourced) it shows `~tokens N`. The trigger is a
 * real button with `aria-expanded` + `focus-visible` ring so it is fully
 * keyboard- and AT-operable.
 *
 * EXPANDED: a full-width breakdown panel (occupies a fresh row in the
 * flex-wrap header via `basis-full`, so opening it grows the bubble
 * vertically — the parent virtualizer's ResizeObserver then re-measures the
 * row, keeping offsets correct). Rows: input / output / cache-read /
 * cache-creation (each with token count AND approx USD), the optional
 * nested ephemeral 5m/1h split of cache-creation when those fields exist on
 * the usage object, then the total approx USD. cache-READ is ALWAYS shown
 * (the prior static readout dropped it — audit finding).
 *
 * MONEY IS ALWAYS APPROXIMATE. Every dollar figure carries a `~` prefix and
 * {@link APPROX_COST_CAVEAT}, and the panel ends with a footnote restating
 * that these are API-equivalent figures, not the user's flat-rate spend.
 *
 * The component owns its own expanded state; it is per-instance, so a
 * virtualized row that unmounts/remounts simply starts collapsed again
 * (correct — no height surprise on scroll-in).
 */
function TokenCostElement({
  usage,
  estimate,
  model,
  bubbleId,
}: {
  /** Real per-message usage (assistant turns). Mutually exclusive with `estimate`. */
  usage?: MessageUsage
  /** char/4 BPE estimate (user / system / unsourced turns). */
  estimate?: number
  /** Resolved model id for pricing; `null` → sonnet-tier fallback (flagged). */
  model: string | null
  /** Stable id fragment for `aria-controls` wiring. */
  bubbleId: string | number
}) {
  const [expanded, setExpanded] = useState(false)

  // Estimate-only bubbles carry no input/output/cache split, so an
  // expandable money breakdown would be meaningless (and misleading — we
  // have no priced buckets). Render a plain, non-expandable `~tokens N`
  // badge. This preserves the prior estimate presentation but now shows it
  // in BOTH branches (the compact branch used to drop it entirely).
  if (!usage) {
    const n = estimate ?? 0
    return (
      <span
        className="inline-flex items-baseline gap-[5px] text-[12px] leading-[1.25] tracking-[0.01em] whitespace-nowrap lining-nums tabular-nums"
        aria-label={`Approximate token cost — ${n} tokens (char/4 estimate)`}
        title="Estimate using char/4 BPE approximation — not a billed figure"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-300">~tokens</span>
        <span className="text-[13px] font-bold text-emerald-300">{formatTokenNumber(n)}</span>
      </span>
    )
  }

  const bd = costBreakdown(usage, model)
  const fallback = isFallbackFamily(model)
  const panelId = `bubble-cost-${bubbleId}`
  // 5m/1h are display-only splits of cacheCreationTokens (priced as a whole
  // at the write rate). Treat `undefined` as "not reported", NOT zero — only
  // render a nested row when the field is actually present.
  const has5m = usage.cacheCreation5mTokens !== undefined
  const has1h = usage.cacheCreation1hTokens !== undefined

  return (
    <>
      <button
        type="button"
        // Stop the click bubbling to the row's pin-on-click handler — same
        // isolation the copy button / reasoning toggle / export checkbox use.
        onClick={e => {
          e.stopPropagation()
          setExpanded(v => !v)
        }}
        aria-expanded={expanded}
        aria-controls={panelId}
        title={`Approximate API-equivalent cost — ${APPROX_COST_CAVEAT}`}
        className="inline-flex items-baseline gap-[5px] text-[12px] leading-[1.25] tracking-[0.01em] whitespace-nowrap lining-nums tabular-nums rounded px-1 -mx-1 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 cursor-pointer"
      >
        <ChevronRight
          className={`w-3 h-3 self-center text-amber-300/80 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className="text-[13px] font-bold text-emerald-300">{formatTokenNumber(bd.totalTokens)}</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-300/80">tok</span>
        <span className="text-[12px] text-emerald-300/30 mx-0.5">·</span>
        <span className="text-[12px] font-semibold text-gray-300">~{formatUsd(bd.approxUsd)}</span>
      </button>

      {expanded && (
        <div
          id={panelId}
          // `basis-full` makes this take a fresh full-width row inside the
          // flex-wrap header, so opening it grows the bubble vertically and
          // the parent ResizeObserver re-measures the virtualized row.
          className="basis-full w-full mt-1.5 rounded-md border border-amber-400/25 bg-amber-300/[0.05] px-2.5 py-2 normal-case tracking-normal"
        >
          <div className="flex flex-col gap-1 text-[11px]">
            <CostRow label="input" tokens={bd.input.tokens} usd={bd.input.usd} />
            <CostRow label="output" tokens={bd.output.tokens} usd={bd.output.usd} />
            {/* cache-READ — MUST be shown; the old static readout dropped it. */}
            <CostRow label="cache read" tokens={bd.cacheRead.tokens} usd={bd.cacheRead.usd} />
            <CostRow label="cache write" tokens={bd.cacheCreation.tokens} usd={bd.cacheCreation.usd} />
            {has5m && (
              <CostRow label="• ephemeral 5m" tokens={usage.cacheCreation5mTokens ?? 0} nested />
            )}
            {has1h && (
              <CostRow label="• ephemeral 1h" tokens={usage.cacheCreation1hTokens ?? 0} nested />
            )}
            <div className="mt-1 pt-1.5 border-t border-amber-400/20 flex items-baseline justify-between gap-3">
              <span className="uppercase tracking-[0.08em] text-[10px] font-bold text-amber-200">
                total{fallback ? ' (sonnet-tier est.)' : ''}
              </span>
              <span className="flex items-baseline gap-2 tabular-nums lining-nums">
                <span className="text-emerald-300 font-bold">{formatTokenNumber(bd.totalTokens)}</span>
                <span
                  className="text-gray-200 font-semibold text-[11px] min-w-[58px] text-right"
                  title={APPROX_COST_CAVEAT}
                >
                  ~{formatUsd(bd.approxUsd)}
                </span>
              </span>
            </div>
          </div>
          <p className="mt-1.5 text-[9.5px] leading-snug text-gray-500 break-words">
            {fallback && (
              <span className="text-amber-300/70">Model unknown — priced at sonnet-tier rates. </span>
            )}
            ~ = approximate. {APPROX_COST_CAVEAT}
          </p>
        </div>
      )}
    </>
  )
}

/**
 * Format an ISO-8601 timestamp as `YYYY-MM-DD HH:MM:SS` in the
 * viewer's local time. Falls back to the raw input when parsing
 * fails — never throws, never returns empty (the bubble's header
 * renders the result verbatim, so an empty string would punch a
 * visible hole in the UI).
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

/**
 * Detect Claude Code's slash-command JSONL markup. When the agent
 * runs `/context`, `/help`, `/skills`, etc., Claude writes a system
 * record whose `content` is XML-style:
 *
 *   <command-name>/context</command-name>
 *   <command-message>context</command-message>
 *   <command-args></command-args>
 *
 * Without special handling, this dumps as raw text in the bubble.
 * We extract the command name (and optional args) and signal the
 * caller to render a compact pill instead. Returns `null` when the
 * line is plain text.
 */
function detectCommandTag(text: string): { name: string; args: string } | null {
  // Cheap pre-check: any chance this is a command record?
  if (!text.includes('<command-name>')) return null
  const nameMatch = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)
  if (!nameMatch) return null
  const argsMatch = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)
  return {
    name: (nameMatch[1] ?? '').trim(),
    args: (argsMatch?.[1] ?? '').trim(),
  }
}

/**
 * Detect the matching `<local-command-stdout>...</local-command-stdout>`
 * marker that Claude Code wraps slash-command output in. We strip the
 * tag wrapper so the body renders as plain (ANSI-colored) text — the
 * user shouldn't see the XML scaffolding.
 */
function unwrapLocalCommandStdout(text: string): string {
  const m = /<local-command-stdout>([\s\S]*?)(?:<\/local-command-stdout>|$)/.exec(text)
  if (!m) return text
  // Preserve everything before and after, in case multiple records were
  // concatenated. Practically Claude only emits one per record.
  return text.replace(/<\/?local-command-stdout>/g, '')
}

/**
 * Split `text` on case-insensitive occurrences of `query` and return an array
 * of segments with an `isMatch` flag. Returns a single-entry array when the
 * query is empty or not found. Uses an iterative indexOf to avoid regex
 * surprises with user input.
 */
function splitOnMatches(text: string, query: string): Array<{ part: string; isMatch: boolean }> {
  if (!query || query.length === 0) return [{ part: text, isMatch: false }]
  const lowerText = text.toLowerCase()
  const out: Array<{ part: string; isMatch: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lowerText.indexOf(query, cursor)
    if (idx < 0) {
      out.push({ part: text.slice(cursor), isMatch: false })
      break
    }
    if (idx > cursor) {
      out.push({ part: text.slice(cursor, idx), isMatch: false })
    }
    out.push({ part: text.slice(idx, idx + query.length), isMatch: true })
    cursor = idx + query.length
  }
  if (cursor === 0) return [{ part: text, isMatch: false }]
  return out
}

/**
 * Render a piece of bubble text — possibly carrying ANSI escape codes
 * from a `local-command-stdout` capture — as a list of styled spans
 * with the search-highlight overlay applied at the top level.
 */
function renderBubbleText(text: string, lowerQuery: string, currentMatch: boolean) {
  const ansiSegments = parseAnsi(text)
  const out: React.ReactNode[] = []
  let key = 0
  for (const seg of ansiSegments) {
    const parts = splitOnMatches(seg.text, lowerQuery)
    for (const p of parts) {
      if (!p.part) continue
      if (p.isMatch) {
        out.push(
          <mark
            key={key++}
            style={seg.style}
            className={
              currentMatch
                ? 'inline align-baseline bg-amber-300/55 rounded-sm px-0.5 outline outline-1 outline-amber-300/80'
                : 'inline align-baseline bg-amber-300/25 rounded-sm px-0.5'
            }
          >
            {p.part}
          </mark>,
        )
      } else if (Object.keys(seg.style).length > 0) {
        // `inline align-baseline` keeps these programmatically-emitted
        // ANSI spans on one baseline with no sub-pixel gap (formerly a
        // descendant rule on the bubble's pre-wrap body span).
        out.push(<span key={key++} className="inline align-baseline" style={seg.style}>{p.part}</span>)
      } else {
        out.push(<span key={key++} className="inline align-baseline">{p.part}</span>)
      }
    }
  }
  return out
}

export default function MessageBubble({
  line,
  highlightQuery = '',
  currentMatch = false,
  assistantAvatarUrl = null,
}: MessageBubbleProps) {
  // Slash-command markup (`<command-name>...</command-name>` etc.) is
  // detected here so the bubble renders a clean pill instead of the
  // raw XML. When the user issued the command (line.role === 'user'),
  // the bubble inherits the USER color so it's visually distinct from
  // commands triggered by Claude itself (system color). The original
  // ROLE_STYLES dispatch below picks the right palette automatically
  // — we don't override it here.
  const command = useMemo(() => detectCommandTag(line.text), [line.text])

  const styles = ROLE_STYLES[line.role] ?? ROLE_STYLES.system
  const Icon = styles.icon

  // ROLE → SIDE: the human (`user`) anchors RIGHT; every agent role
  // (assistant / system / tool) anchors LEFT. This single boolean is the
  // spine of the comic layout — it drives the avatar side (right vs left),
  // the speech-bubble tail side, and the internal column direction. The
  // row-level RIGHT/LEFT *justification* is set by ChatTranscript on the
  // outer wrapper; here we only flip the bubble-internal pieces.
  const isHuman = line.role === 'user'

  // Reasoning (extended-thinking) presence — Phase 1 surfaced
  // `thinkingText` (readable reasoning) and `redactedThinkingCount`
  // (server-redacted blocks) onto every TranscriptLine. We render a
  // collapsed reasoning row only when at least one is present, so a
  // turn with no thinking adds zero extra height.
  const redactedThinking = line.redactedThinkingCount ?? 0
  const thinkingText = line.thinkingText ?? ''
  const hasThinking = thinkingText.length > 0 || redactedThinking > 0

  // The pointy, elongated speech-bubble tail. Rendered as an absolutely-
  // positioned sibling on the bubble's avatar-facing edge so it reads as
  // a comic bubble pointing at the speaker. Pure Tailwind (IN-4 §4.1
  // Option B): a tapered clip-path polygon — wide where it joins the
  // bubble body, narrowing to a point toward the avatar. Its bg/border
  // reuse the SAME role tokens as the body (`tailBg`/`tailBorder` kept in
  // lock-step with `wrapper` in ROLE_STYLES) so the join is seamless.
  // `aria-hidden` — decorative chrome, no semantics.
  const tail = isHuman ? (
    // Human (right bubble): tail on the RIGHT edge, points right toward
    // the right-side avatar. Mirror of the agent polygon.
    <div
      aria-hidden
      className={`pointer-events-none absolute right-0 top-4 translate-x-full w-3.5 h-5 border-r border-y ${styles.tailBg} ${styles.tailBorder} [clip-path:polygon(0_0,0_100%,100%_50%)]`}
    />
  ) : (
    // Agent (left bubble): tail on the LEFT edge, points left toward the
    // left-side avatar.
    <div
      aria-hidden
      className={`pointer-events-none absolute left-0 top-4 -translate-x-full w-3.5 h-5 border-l border-y ${styles.tailBg} ${styles.tailBorder} [clip-path:polygon(100%_0,100%_100%,0_50%)]`}
    />
  )

  // Collapsed reasoning block — a native <details> so it is keyboard- and
  // AT-accessible with zero extra JS. Closed by default; expanding reveals
  // the (React-escaped) reasoning text, muted + italic to separate it from
  // the answer. When ALL reasoning is redacted (no readable text) the
  // body is just the redaction marker. Only rendered when `hasThinking`.
  const reasoningBlock = hasThinking ? (
    <details className="mb-1.5 group/reason rounded-md border border-amber-400/25 bg-amber-300/[0.06]">
      <summary
        // Stop the click bubbling to the row's pin-on-click handler so
        // expanding the reasoning toggle does NOT also pin/unpin the
        // bubble — same isolation the copy button + checkbox use.
        onClick={e => e.stopPropagation()}
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wider text-amber-200/90 marker:content-none [&::-webkit-details-marker]:hidden"
      >
        <ChevronRight className="w-3 h-3 transition-transform duration-150 group-open/reason:rotate-90" aria-hidden />
        <Brain className="w-3 h-3" aria-hidden />
        <span>Reasoning</span>
        {redactedThinking > 0 && (
          <span className="font-normal normal-case tracking-normal text-amber-200/55">
            ({redactedThinking} redacted)
          </span>
        )}
      </summary>
      {thinkingText.length > 0 && (
        <div className="px-2 pb-2 pt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed italic text-gray-400">
          {thinkingText}
        </div>
      )}
    </details>
  ) : null

  // Copy-button placement mirrors with the bubble: the human bubble
  // anchors its avatar on the RIGHT, so its copy button moves to the
  // LEFT (and the card reserves left padding) to avoid sitting on top
  // of the avatar. The agent bubble keeps the conventional top-right
  // button + right padding.
  const copyBtnPos = isHuman ? 'top-1.5 left-1.5' : 'top-1.5 right-1.5'
  const cardPadX = isHuman ? 'pl-10' : 'pr-10'
  // Avatar column direction: agent = avatar-left (flex-row), human =
  // avatar-right (flex-row-reverse). The body keeps `flex-1 min-w-0` so
  // it grows into the remaining width on either side.
  const avatarRowDir = isHuman ? 'flex-row-reverse' : 'flex-row'

  // Avatar slot — same dimensions for every role so the visual weight
  // of the conversation reads as paired turns regardless of speaker.
  // Width was bumped 3× per user request (was w-5/w-4 → 60 px). The
  // assistant slot renders the agent's real photo (matches the
  // sidebar badge) inside a circular emerald-tint ring; every other
  // role renders a stylized lucide vector glyph (head-and-shoulders
  // for `user`, terminal for `system`/`tool`) inside an identically-
  // sized dark circular frame so the avatars line up regardless of
  // role. eslint-disable for next/image is intentional: these are
  // local `/avatars/<gender>_NN.jpg` blobs (or remote https URLs the
  // user pasted) — no Next image optimisation is needed and adding
  // it would force every avatar through the /next/image pipeline at
  // SSR time.
  const renderRoleIcon = (sizeClass: string) => {
    if (line.role === 'assistant' && assistantAvatarUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assistantAvatarUrl}
          alt=""
          className={`${sizeClass} flex-shrink-0 rounded-full object-cover ring-1 ring-emerald-500/40`}
        />
      )
    }
    return (
      <div
        className={`${sizeClass} flex-shrink-0 rounded-full bg-gray-800/60 ring-1 ring-gray-600/50 flex items-center justify-center`}
      >
        <Icon className={`w-1/2 h-1/2 ${styles.label}`} />
      </div>
    )
  }

  // Pre-process the body text:
  //   - command-tag records render as a pill (handled below).
  //   - local-command-stdout records have the wrapping tag stripped
  //     so the captured ANSI output renders cleanly.
  //   - everything else is passed through ANSI rendering verbatim.
  const bodyText = useMemo(() => {
    if (command) return ''
    return unwrapLocalCommandStdout(line.text)
  }, [command, line.text])

  // Render with ANSI color awareness so `/context`, `/skills`, etc.
  // outputs appear as styled text instead of literal `\x1b[…]m`
  // garbage. The plain-text version (used by aria-label and search
  // matching) still strips ANSI so screen readers and the search
  // engine see only the readable letters.
  const ansiPlainText = useMemo(() => stripAnsi(bodyText), [bodyText])
  const renderedBody = useMemo(
    () => renderBubbleText(bodyText, highlightQuery, currentMatch),
    [bodyText, highlightQuery, currentMatch],
  )

  // Unique id pairing role + line index for aria-labelledby.
  const labelId = `msg-label-${line.lineIndex}`

  // Format the timestamp once; falls back to raw on parse errors.
  const formattedTs = line.timestamp ? formatTimestamp(line.timestamp) : null

  // Per-bubble token readout — assistant turns use the JSONL `usage`
  // field when present; user / system / tool / unsourced-assistant
  // turns fall back to the char/4 BPE approximation so EVERY bubble
  // shows what it costs. The user feedback was explicit: "even the
  // user messages have a cost and are added to the context".
  const tokenReadout = useMemo(() => {
    if (line.usage && line.role === 'assistant') {
      return {
        kind: 'usage' as const,
        usage: line.usage,
      }
    }
    return {
      kind: 'estimate' as const,
      // For user / system bubbles tokens cost ≈ chars/4 of the body
      // text. Tool events render a different component and don't reach
      // this branch, but we estimate from `text` defensively anyway.
      estimate: estimateTokens(line.text || ''),
    }
  }, [line.usage, line.role, line.text])

  // Model id for cost PRICING. Read from the raw JSONL record's
  // `message.model` (Claude Code's canonical location — verified on live
  // files). `null` for records without it → the cost module prices at the
  // sonnet-tier fallback and flags the bubble as an estimate. Only matters
  // for the usage branch (estimate bubbles show no money), but resolved
  // unconditionally so it stays a single, memoized derivation.
  const lineModel = useMemo(() => resolveLineModel(line.raw), [line.raw])

  // Copy-to-clipboard — copies the visible text body. Falls back to
  // the raw line text when the bubble is showing the slash-command
  // pill (so the user gets a useful payload either way).
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const payload = command
        ? `/${command.name}${command.args ? ` ${command.args}` : ''}`
        : ansiPlainText || line.text
      try {
        await navigator.clipboard.writeText(payload)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } catch {
        // Older browsers / non-secure contexts. Fall back to a hidden
        // <textarea> + execCommand('copy'). We swallow errors silently
        // — the worst outcome is the user copies manually.
        const ta = document.createElement('textarea')
        ta.value = payload
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try {
          document.execCommand('copy')
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* nothing left to try */
        }
        document.body.removeChild(ta)
      }
    },
    [ansiPlainText, command, line.text],
  )

  // Wrapper records around tool calls (the assistant turn that emitted
  // a tool_use, and the user turn that wrapped the tool_result) often
  // arrive with `text === ''` — Claude Code splits each turn into
  // multiple JSONL records and the wrapper carries metadata only.
  // Render those as a single-line "turn header" instead of a full
  // padded bubble: same role + timestamp + token cost, but ~24 px
  // tall, so the transcript reads as one logical conversation flow
  // instead of a column of half-blank cards.
  //
  // EXCEPTION: a turn that carries reasoning (`hasThinking`) is never
  // compact even when its visible body is empty — a reasoning-only
  // assistant turn must render the full bubble so the collapsed
  // reasoning block has a home. Collapsing it to a bare 1-line header
  // would hide the reasoning entirely.
  const isCompact = !command && bodyText.trim().length === 0 && !hasThinking

  if (isCompact) {
    return (
      <div
        role="article"
        aria-labelledby={labelId}
        className={`opacity-85 relative rounded-md border-[1.5px] px-3 py-1 ${cardPadX} text-[11px] transition-shadow duration-200 ease-out group-hover:shadow-[0_0_12px_1px_rgba(16,185,129,0.45)] group-data-[pinned=true]:shadow-[0_0_0_2px_rgb(16,185,129),0_0_18px_2px_rgba(16,185,129,0.55)] group-data-[pinned=true]:group-hover:shadow-[0_0_0_3px_rgb(52,211,153),0_0_26px_4px_rgba(16,185,129,0.75)] ${styles.wrapper}`}
      >
        {/* Pointy speech-bubble tail toward the speaker's avatar. */}
        {tail}
        {/* Compact bubbles still get a copy button so the user can
            grab the role+timestamp+tokens header text if they want it.
            Same component as full bubbles — keeps interactions
            consistent. Position mirrors with the bubble (left for the
            human, right for the agent). */}
        <button
          type="button"
          className={`absolute ${copyBtnPos} w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 bg-gray-900/40 border border-white/[0.06] transition-colors hover:bg-gray-800/85 hover:text-gray-200 data-[copied=true]:text-emerald-500`}
          onClick={handleCopy}
          data-copied={copied || undefined}
          aria-label={copied ? 'Copied' : 'Copy bubble content to clipboard'}
          title={copied ? 'Copied!' : 'Copy to clipboard'}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <div className={`flex items-center gap-2 ${avatarRowDir}`}>
          {renderRoleIcon('w-[60px] h-[60px]')}
          <div
            id={labelId}
            className={`text-[10px] font-semibold uppercase tracking-wider flex items-baseline flex-wrap gap-x-2 gap-y-0 flex-1 min-w-0 ${styles.label}`}
          >
            <span>{line.role}</span>
            {formattedTs && (
              <span
                className="text-cyan-300 font-mono text-[11px] font-medium tracking-normal normal-case"
                title={line.timestamp}
              >
                {formattedTs}
              </span>
            )}
            {/* Shared expandable token-cost element. Unlike the old inline
                block (which rendered ONLY the usage case and silently
                dropped estimate bubbles), this also shows `~tokens N` for
                compact wrapper turns that carry no `usage`. Collapsed by
                default → no extra height; expanding it grows the bubble and
                the parent virtualizer re-measures. */}
            <TokenCostElement
              usage={tokenReadout.kind === 'usage' ? tokenReadout.usage : undefined}
              estimate={tokenReadout.kind === 'estimate' ? tokenReadout.estimate : undefined}
              model={lineModel}
              bubbleId={line.lineIndex}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      role="article"
      aria-labelledby={labelId}
      // `border-[1.5px]` is a small bump from the default 1px — at the
      // 12 px text size the extra half-pixel tightens the visual frame
      // without crossing into "boxed-in" territory. Card-level chrome
      // (pinned ring + hover halo) keys off the parent row's `group` +
      // `data-pinned` state, but the `group-hover:`/`group-data-[pinned=true]:`
      // shadow utilities MUST live on this card (the element that renders the
      // shadow), not the parent. Byte-parity with the deleted .aim-msg-card
      // glow rules (#7/#8/#9), matching ToolUseRow's inner card.
      className={`relative rounded-md border-[1.5px] px-3 py-2 ${cardPadX} text-[12px] transition-shadow duration-200 ease-out group-hover:shadow-[0_0_12px_1px_rgba(16,185,129,0.45)] group-data-[pinned=true]:shadow-[0_0_0_2px_rgb(16,185,129),0_0_18px_2px_rgba(16,185,129,0.55)] group-data-[pinned=true]:group-hover:shadow-[0_0_0_3px_rgb(52,211,153),0_0_26px_4px_rgba(16,185,129,0.75)] ${styles.wrapper}`}
    >
      {/* Pointy speech-bubble tail toward the speaker's avatar. */}
      {tail}
      {/* Copy-to-clipboard button — corner of every bubble. Always
          visible (no hover-reveal) for touch parity, and large enough
          (28×28) to tap reliably. Stops propagation so the underlying
          pin-on-click handler doesn't fire. Position mirrors with the
          bubble: top-right for the agent, top-left for the human. */}
      <button
        type="button"
        className={`absolute ${copyBtnPos} w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 bg-gray-900/40 border border-white/[0.06] transition-colors hover:bg-gray-800/85 hover:text-gray-200 data-[copied=true]:text-emerald-500`}
        onClick={handleCopy}
        data-copied={copied || undefined}
        aria-label={copied ? 'Copied' : 'Copy bubble content to clipboard'}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <div className={`flex items-start gap-2 ${avatarRowDir}`}>
        <div className="mt-0.5">{renderRoleIcon('w-[60px] h-[60px]')}</div>
        <div className="flex-1 min-w-0">
          <div
            id={labelId}
            className={`text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-baseline flex-wrap gap-x-2 gap-y-0.5 ${styles.label}`}
          >
            <span>{line.role}</span>
            {formattedTs && (
              <span
                className="text-cyan-300 font-mono text-[11px] font-medium tracking-normal normal-case"
                title={line.timestamp}
              >
                {formattedTs}
              </span>
            )}
            {/* Per-bubble token-cost element (shared, single source of
                truth). Assistant turns with usage expand to the full
                input / output / cache-read / cache-write breakdown with an
                approx USD per bucket + total; everyone else shows a single
                `~tokens N` estimate so the user sees the cost of EVERY
                message (including their own). Collapsed by default →
                ZERO extra height. cache-READ is always shown (the old block
                dropped it). MONEY IS APPROXIMATE — see TokenCostElement. */}
            <TokenCostElement
              usage={tokenReadout.kind === 'usage' ? tokenReadout.usage : undefined}
              estimate={tokenReadout.kind === 'estimate' ? tokenReadout.estimate : undefined}
              model={lineModel}
              bubbleId={line.lineIndex}
            />
          </div>
          {/* Collapsed extended-thinking / reasoning block. Renders only
              when this turn carried `thinkingText` or `redactedThinking`.
              Sits between the header and the answer body so the reasoning
              reads as a precursor to the response. */}
          {reasoningBlock}
          {command ? (
            <div className="flex items-center flex-wrap gap-2 py-0.5">
              <span
                className="inline-flex items-baseline gap-1 px-2 py-px rounded-full font-mono text-[12px] font-semibold tracking-[0.01em] bg-white/[0.06] border border-white/[0.12] text-gray-200"
                aria-label={`Slash command ${command.name}`}
              >
                <span className="opacity-55 font-medium">cmd</span>
                <span>{command.name}</span>
                {command.args && (
                  <span className="opacity-55 font-medium">· {command.args}</span>
                )}
              </span>
            </div>
          ) : (
            <div
              // `tracking-normal tabular-nums` normalizes the adjacent
              // ANSI spans `renderBubbleText` emits: zero letter-spacing
              // + tabular figures keep colored block-art on one baseline
              // without sub-pixel stripes (formerly a descendant rule on
              // the bubble's pre-wrap body container).
              className={`whitespace-pre-wrap break-words font-mono text-[12px] tracking-normal tabular-nums ${styles.text}`}
              // The aria-label gives assistive tech the plain-text view
              // (no ANSI codes) of bubbles whose body otherwise carries
              // colored terminal output.
              aria-label={ansiPlainText || undefined}
            >
              {renderedBody}
              {bodyText === '' && (
                <span className="text-gray-500 italic">(empty)</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
