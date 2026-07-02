/**
 * PseudoTerminal — renders an arbitrary string (a tool's input args or its
 * result output, either of which may embed ANSI SGR escape codes) as a
 * TERMINAL-STYLE block: dark xterm-matching background, monospace font, a
 * faint top "chrome" bar with the three traffic-light dots, and the text
 * body below with ANSI colors decoded into per-span inline styles.
 *
 * Pure + presentational. No hooks, no state, no `'use client'` — it is only
 * ever rendered by `ToolUseRow` (itself a server-safe presentational row),
 * so adding a client boundary here would needlessly opt the subtree into
 * client serialization. There is no clipboard button precisely because that
 * would force `'use client'`; copy lives at the bubble/transcript level.
 *
 * Content safety: the body text is untrusted JSONL. Every span is a React
 * text child (`{seg.text}`) — React escapes it — and the only `style` applied
 * is the typed `CSSProperties` object returned by `parseAnsi`, whose color
 * values are all numeric-palette lookups with clamped bytes (see lib/ansi.ts).
 * There is NO `dangerouslySetInnerHTML` / innerHTML anywhere; do not introduce
 * one — the no-innerHTML property is an audited safety guarantee.
 *
 * No-nested-scrollbars: long lines WRAP (`whitespace-pre-wrap break-words`)
 * and the block GROWS. There is deliberately NO `overflow-x: auto` and no
 * horizontal inner scroller — the page (or, here, the virtualizer's reserved
 * vertical slot) owns scrolling. Wide terminal output extends the block height,
 * never a sideways scrollbar.
 */

import { parseAnsi } from '@/lib/ansi'

// The dark viewport color the real terminal tab uses
// (`app/globals.css` → `.xterm .xterm-viewport { background-color: #0d0b11 }`),
// so a pseudo-terminal block visually matches the live terminal.
const TERMINAL_BG = 'bg-[#0d0b11]'

interface PseudoTerminalProps {
  /** Raw text to render. May contain ANSI SGR escape codes. */
  text: string
  /**
   * Optional label shown in the chrome bar (e.g. "input", "result").
   * When omitted, the chrome bar still renders the traffic-light dots.
   */
  title?: string
  /** Extra classes merged onto the outer block (e.g. spacing from the parent). */
  className?: string
}

export default function PseudoTerminal({ text, title, className }: PseudoTerminalProps) {
  // `parseAnsi` never returns an empty array (empty input → one empty
  // segment), so the body always has at least one span to render.
  const segments = parseAnsi(text)

  return (
    <div
      className={[
        'rounded-md overflow-hidden border border-gray-700/60',
        TERMINAL_BG,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Chrome bar — faint top strip with the three mac traffic-light
          dots and an optional uppercase label. Purely decorative. */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900/80 border-b border-gray-800">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" aria-hidden />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" aria-hidden />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" aria-hidden />
        {title && (
          <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
            {title}
          </span>
        )}
      </div>

      {/* Body — monospace, ANSI-decoded spans. Long content WRAPS and the
          block grows; there is NO horizontal scroller (no-nested-scrollbars).
          `tabular-nums` keeps columnar terminal output aligned. */}
      <pre className="px-3 py-2 font-mono text-[12px] leading-relaxed text-gray-100 whitespace-pre-wrap break-words tabular-nums">
        {segments.map((seg, i) => (
          // `seg.style` is the typed CSSProperties from parseAnsi (decoded
          // from the byte stream — genuinely dynamic, so inline is correct).
          // `align-baseline inline` keeps adjacent colored spans on one line.
          <span key={i} className="inline align-baseline" style={seg.style}>
            {seg.text}
          </span>
        ))}
      </pre>
    </div>
  )
}
