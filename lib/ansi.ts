/**
 * Tiny ANSI SGR (Select Graphic Rendition) parser for the JSONL session
 * browser. Renders the colored output that Claude Code captures from
 * commands like `/context` and `/skills` as styled spans, instead of
 * showing raw escape codes.
 *
 * Scope: SGR sequences only — the only ones Claude Code's CLI uses for
 * colored panel output. Non-SGR sequences (cursor movement, screen
 * clears, etc.) are stripped without effect, which matches what a
 * scroll-back log would show anyway.
 *
 * Two exports:
 *   - `parseAnsi(s)`: returns an array of `{ text, style }` segments
 *     for inline rendering. `style` is a CSS object suitable for a
 *     React `style` prop. Empty input → `[{ text: '', style: {} }]`.
 *   - `stripAnsi(s)`: returns the plain-text version of `s` with all
 *     ANSI sequences removed. Used by the export pipeline so plain
 *     text dumps don't carry escape codes.
 *
 * Token model (all SGR codes via `ESC [ <params> m`):
 *   - 0   reset
 *   - 1   bold       22 normal-intensity
 *   - 3   italic     23 italic off
 *   - 4   underline  24 underline off
 *   - 7   reverse    27 reverse off
 *   - 9   strike     29 strike off
 *   - 30-37  fg basic     38 5 N  fg 256-color    38 2 R G B  fg true-color
 *   - 40-47  bg basic     48 5 N  bg 256-color    48 2 R G B  bg true-color
 *   - 90-97  fg bright    100-107 bg bright
 *   - 39 default fg, 49 default bg
 */

import type { CSSProperties } from 'react'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AnsiSegment {
  text: string
  style: CSSProperties
}

export function parseAnsi(input: string): AnsiSegment[] {
  if (!input) return [{ text: '', style: {} }]
  const segments: AnsiSegment[] = []
  let cursor = 0
  // Mutable accumulator for the active SGR state — we mutate this in
  // place as we walk codes, then snapshot it into each segment's style.
  const state: SgrState = freshState()

  while (cursor < input.length) {
    const escIdx = input.indexOf(ESC, cursor)
    if (escIdx === -1) {
      pushSegment(segments, input.slice(cursor), state)
      break
    }
    if (escIdx > cursor) {
      pushSegment(segments, input.slice(cursor, escIdx), state)
    }
    // Look for `[<params>m` after ESC. Anything else (e.g. CSI sequences
    // ending in something other than `m`, or stray escapes) is dropped.
    if (input[escIdx + 1] !== '[') {
      cursor = escIdx + 2 // skip ESC + 1 char minimum
      continue
    }
    const endIdx = findCsiEnd(input, escIdx + 2)
    if (endIdx === -1) {
      // Unterminated — bail out, treat the rest as plain text.
      pushSegment(segments, input.slice(escIdx), state)
      break
    }
    const finalChar = input[endIdx]
    if (finalChar === 'm') {
      const paramStr = input.slice(escIdx + 2, endIdx)
      applySgr(state, parseSgrParams(paramStr))
    }
    cursor = endIdx + 1
  }
  if (segments.length === 0) segments.push({ text: '', style: {} })
  return segments
}

export function stripAnsi(input: string): string {
  if (!input) return ''
  // The smaller ANSI surface used by Claude Code is fully covered by
  // CSI-removal — no need for a full ECMA-48 stripper here.
  return input.replace(ANSI_CSI_REGEX, '')
}

// ---------------------------------------------------------------------------
// Implementation details
// ---------------------------------------------------------------------------

const ESC = ''
const ANSI_CSI_REGEX = /\[[0-9;]*[A-Za-z]/g

interface SgrState {
  bold: boolean
  italic: boolean
  underline: boolean
  reverse: boolean
  strike: boolean
  /** Current foreground color as a CSS color string, or null = default. */
  fg: string | null
  /** Current background color as a CSS color string, or null = default. */
  bg: string | null
}

function freshState(): SgrState {
  return { bold: false, italic: false, underline: false, reverse: false, strike: false, fg: null, bg: null }
}

function snapshotStyle(s: SgrState): CSSProperties {
  const css: CSSProperties = {}
  if (s.bold) css.fontWeight = 'bold'
  if (s.italic) css.fontStyle = 'italic'
  // Combine underline + strike via textDecoration-line (space-separated).
  const decos: string[] = []
  if (s.underline) decos.push('underline')
  if (s.strike) decos.push('line-through')
  if (decos.length) css.textDecoration = decos.join(' ')
  // `reverse` swaps fg + bg. We honor it lazily via the snapshot below.
  const fg = s.reverse ? s.bg : s.fg
  const bg = s.reverse ? s.fg : s.bg
  if (fg) css.color = fg
  if (bg) css.backgroundColor = bg
  return css
}

function pushSegment(out: AnsiSegment[], text: string, state: SgrState): void {
  if (!text) return
  out.push({ text, style: snapshotStyle(state) })
}

function findCsiEnd(input: string, fromIdx: number): number {
  // CSI parameters are ASCII digits and ';', terminated by an alpha
  // (any letter) — typically 'm' for SGR.
  for (let i = fromIdx; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    const isDigit = ch >= 0x30 && ch <= 0x39
    const isSep = ch === 0x3b // ';'
    const isAlpha = (ch >= 0x40 && ch <= 0x7e) && !isDigit && !isSep
    if (isAlpha) return i
    if (!isDigit && !isSep) return -1
  }
  return -1
}

function parseSgrParams(paramStr: string): number[] {
  if (!paramStr) return [0] // empty `ESC[m` is equivalent to `ESC[0m`
  return paramStr.split(';').map(s => {
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : 0
  })
}

function applySgr(state: SgrState, params: number[]): void {
  for (let i = 0; i < params.length; i++) {
    const p = params[i] ?? 0
    if (p === 0) {
      // Reset all
      Object.assign(state, freshState())
      continue
    }
    if (p === 1) { state.bold = true; continue }
    if (p === 22) { state.bold = false; continue }
    if (p === 3) { state.italic = true; continue }
    if (p === 23) { state.italic = false; continue }
    if (p === 4) { state.underline = true; continue }
    if (p === 24) { state.underline = false; continue }
    if (p === 7) { state.reverse = true; continue }
    if (p === 27) { state.reverse = false; continue }
    if (p === 9) { state.strike = true; continue }
    if (p === 29) { state.strike = false; continue }
    if (p === 39) { state.fg = null; continue }
    if (p === 49) { state.bg = null; continue }
    if (p >= 30 && p <= 37) { state.fg = ANSI_BASIC[p - 30]; continue }
    if (p >= 40 && p <= 47) { state.bg = ANSI_BASIC[p - 40]; continue }
    if (p >= 90 && p <= 97) { state.fg = ANSI_BRIGHT[p - 90]; continue }
    if (p >= 100 && p <= 107) { state.bg = ANSI_BRIGHT[p - 100]; continue }
    if (p === 38 || p === 48) {
      // Extended color: 38;5;N (256-color) or 38;2;R;G;B (true-color).
      // If the mode byte or any required color component is missing we
      // bail without setting a color — `\x1b[38;2m` (no R;G;B) and
      // `\x1b[38;5m` (no palette index) must NOT silently mean "black".
      const target: 'fg' | 'bg' = p === 38 ? 'fg' : 'bg'
      const mode = params[i + 1]
      if (mode === 5) {
        const n = params[i + 2]
        if (typeof n === 'number') {
          state[target] = ansi256ToCss(n)
          i += 2
        } else {
          return
        }
      } else if (mode === 2) {
        const r = params[i + 2]
        const g = params[i + 3]
        const b = params[i + 4]
        if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number') {
          state[target] = `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`
          i += 4
        } else {
          return
        }
      } else {
        // Unknown extended-color mode (or mode missing entirely) — bail.
        return
      }
    }
    // Other SGR params (encircle, font select, etc.) — silently ignored;
    // they don't change visible color or weight.
  }
}

function clampByte(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 255) return 255
  return Math.floor(n)
}

// xterm 256-color palette (indices 0..15 = basic+bright, 16..231 = 6×6×6
// cube, 232..255 = grayscale ramp). The exact RGB values used here come
// from the xterm specification.
const ANSI_BASIC = [
  '#000000', // black
  '#cc0000', // red
  '#4e9a06', // green
  '#c4a000', // yellow
  '#3465a4', // blue
  '#75507b', // magenta
  '#06989a', // cyan
  '#d3d7cf', // white (light gray)
]

const ANSI_BRIGHT = [
  '#555753', // bright black (gray)
  '#ef2929', // bright red
  '#8ae234', // bright green
  '#fce94f', // bright yellow
  '#729fcf', // bright blue
  '#ad7fa8', // bright magenta
  '#34e2e2', // bright cyan
  '#eeeeec', // bright white
]

function ansi256ToCss(idx: number): string {
  const i = clampByte(idx)
  if (i < 16) {
    return i < 8 ? ANSI_BASIC[i] : ANSI_BRIGHT[i - 8]
  }
  if (i >= 232) {
    // Grayscale ramp 232..255 → 0x08..0xee in 24 steps of 10.
    const v = 8 + (i - 232) * 10
    const hex = clampByte(v).toString(16).padStart(2, '0')
    return `#${hex}${hex}${hex}`
  }
  // 6×6×6 cube starting at 16.
  const n = i - 16
  const r = Math.floor(n / 36) % 6
  const g = Math.floor(n / 6) % 6
  const b = n % 6
  // Each axis maps 0..5 → 0, 95, 135, 175, 215, 255 (xterm's published table).
  const channel = (k: number) => (k === 0 ? 0 : 55 + k * 40)
  const toHex = (k: number) => clampByte(channel(k)).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
