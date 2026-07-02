/**
 * Phase-1 complementary unit tests for the pure helpers exported by
 * `useJsonlSession` (TRDD-1657a5f4, build agent H concerns 3/4/5).
 *
 * The sibling file `tests/unit/useJsonlSession.test.ts` (authored by the fix
 * agent) already covers the core role/text/usage paths. This file adds
 * targeted assertions the task brief calls for that the sibling does not
 * make:
 *   - thinking extraction THROUGH `normalizeLine` (the exported entry point;
 *     `extractText`/`extractThinking` are intentionally module-private) — a
 *     record with a thinking block keeps its reasoning AND its visible text,
 *     and a `redacted_thinking` block produces the redacted COUNT the render
 *     layer turns into a "[redacted reasoning ×N]" marker;
 *   - record taxonomy against the NEW 2.1.142+ types catalogued in IN-1: a
 *     type that SHOULD render (`user`) is not hidden; the two dominant NEW
 *     noise types (`attachment`, `hook_success`) ARE hidden (null);
 *   - tsMs ISO→epoch with the EXACT expected millisecond value, and an
 *     absent timestamp that does not throw;
 *   - `lineIndexToArrayPos` mapping when a metadata record is filtered out of
 *     the MIDDLE of the loaded window (the sibling exercises a leading
 *     metadata gap; this exercises an interior gap).
 *
 * No mocks — exercises the real exported functions.
 */

import { describe, it, expect } from 'vitest'

import {
  normalizeLine,
  normalizeLines,
  lineIndexToArrayPos,
} from '@/components/agent-profile/sessions/useJsonlSession'
import type { TranscriptLine } from '@/types/sessions-browser'

function nonNull(line: TranscriptLine | null): TranscriptLine {
  if (line === null) throw new Error('normalizeLine returned null for a record expected to render')
  return line
}

describe('thinking extraction via normalizeLine (concern 3)', () => {
  it('keeps the visible text AND captures the thinking-block reasoning (not dropped)', () => {
    // Real 2.1.x extended-thinking shape: reasoning lives in `block.thinking`,
    // the answer in a separate `text` block. extractText must NOT leak the
    // reasoning into the bubble body; extractThinking must NOT lose it.
    const line = nonNull(
      normalizeLine(
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Let me reason about X first', signature: 'Ep==' },
              { type: 'text', text: 'The answer is 42.' },
            ],
          },
        },
        0,
      ),
    )
    expect(line.text).toBe('The answer is 42.')
    expect(line.text).not.toContain('reason about X')
    expect(line.thinkingText).toBe('Let me reason about X first')
  })

  it('a redacted_thinking block yields the redacted COUNT marker, leaving thinkingText undefined', () => {
    // `redacted_thinking` has no readable field; the data layer surfaces a
    // count that the render layer renders as "[redacted reasoning ×N]".
    const line = nonNull(
      normalizeLine(
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'redacted_thinking', data: 'opaque-1' },
              { type: 'redacted_thinking', data: 'opaque-2' },
              { type: 'text', text: 'visible reply' },
            ],
          },
        },
        1,
      ),
    )
    expect(line.redactedThinkingCount).toBe(2)
    expect(line.thinkingText).toBeUndefined()
    expect(line.text).toBe('visible reply')
  })

  it('a tool_use block still works (flagged as a tool event) alongside no thinking', () => {
    const line = nonNull(
      normalizeLine(
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x' }, id: 'tu_1' }],
          },
        },
        2,
      ),
    )
    expect(line.isToolEvent).toBe(true)
    expect(line.toolName).toBe('Read')
    expect(line.toolUseId).toBe('tu_1')
    expect(line.thinkingText).toBeUndefined()
    expect(line.redactedThinkingCount).toBeUndefined()
  })
})

describe('record taxonomy — NEW 2.1.142+ types (IN-1 §1)', () => {
  it('a type that SHOULD render is NOT hidden: type=user normalizes to a real line', () => {
    const line = normalizeLine({ type: 'user', message: { role: 'user', content: 'hi' } }, 0)
    expect(line).not.toBeNull()
    expect(nonNull(line).role).toBe('user')
  })

  it('a type that SHOULD hide IS hidden: type=attachment returns null', () => {
    // `attachment` was the single most common NEW noise record in the 35 MB
    // sample (12,356 occurrences) — it must never paint an empty bubble.
    expect(normalizeLine({ type: 'attachment', content: 'file blob' }, 5)).toBeNull()
  })

  it('a type that SHOULD hide IS hidden: type=hook_success returns null', () => {
    // `hook_success` (9,701 occurrences) replaced the old hook_progress family.
    expect(normalizeLine({ type: 'hook_success', content: 'hook ran' }, 6)).toBeNull()
  })
})

describe('tsMs (concern 5) — ISO parse + absent-timestamp safety', () => {
  it('parses raw.timestamp ISO into the exact epoch millisecond value', () => {
    const line = nonNull(
      normalizeLine(
        { type: 'user', message: { role: 'user', content: 'q' }, timestamp: '2026-05-29T22:41:37.000Z' },
        0,
      ),
    )
    // Date.parse('2026-05-29T22:41:37.000Z') === 1780094497000 (computed).
    expect(line.tsMs).toBe(1780094497000)
    expect(line.timestamp).toBe('2026-05-29T22:41:37.000Z')
  })

  it('an absent timestamp does not throw and yields a finite tsMs (carry-forward/0)', () => {
    let line: TranscriptLine
    expect(() => {
      line = nonNull(normalizeLine({ type: 'user', message: { role: 'user', content: 'no ts' } }, 0))
    }).not.toThrow()
    // @ts-expect-error assigned inside the assertion above
    expect(Number.isFinite(line.tsMs)).toBe(true)
    // @ts-expect-error see above
    expect(line.timestamp).toBeUndefined()
  })
})

describe('lineIndexToArrayPos (concern 4) — interior metadata gap', () => {
  it('maps a raw offset to the right array position when a metadata record sits in the MIDDLE', () => {
    // Raw file: offsets 0,1,2,3 where offset 2 is an `attachment` (filtered).
    // Rendered array therefore is [off0, off1, off3] → positions [0,1,2].
    const lines = normalizeLines(
      [
        { type: 'user', message: { role: 'user', content: 'a' } }, // offset 0 → pos 0
        { type: 'assistant', message: { role: 'assistant', content: 'b' } }, // offset 1 → pos 1
        { type: 'attachment', content: 'dropped' }, // offset 2 → filtered
        { type: 'user', message: { role: 'user', content: 'c' } }, // offset 3 → pos 2
      ],
      0,
    )
    expect(lines.map(l => l.lineIndex)).toEqual([0, 1, 3])

    // Exact offsets map to their positions.
    expect(lineIndexToArrayPos(lines, 0)).toBe(0)
    expect(lineIndexToArrayPos(lines, 1)).toBe(1)
    expect(lineIndexToArrayPos(lines, 3)).toBe(2)

    // The FILTERED offset 2 maps to the nearest visible row at-or-before it
    // (offset 1 → position 1), never off the list and never onto offset 3.
    expect(lineIndexToArrayPos(lines, 2)).toBe(1)
  })
})
