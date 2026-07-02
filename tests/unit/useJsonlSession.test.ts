/**
 * Unit tests for the non-React helpers exported by useJsonlSession.
 *
 * The hook itself requires a DOM environment; since the project's vitest
 * config uses `environment: 'node'` (see vitest.config.ts), we test only
 * the pure helpers — normalizeLine, sumUsage. Hook behaviour is verified
 * manually per the Phase 3 smoke test plan.
 */

import { describe, it, expect } from 'vitest'

import {
  normalizeLine as normalizeLineRaw,
  normalizeLines,
  lineIndexToArrayPos,
  sumUsage,
} from '@/components/agent-profile/sessions/useJsonlSession'
import type { TranscriptLine } from '@/types/sessions-browser'

/**
 * `normalizeLine` returns null for metadata-only records (custom-title,
 * agent-name, attachment, etc.) so the renderer can skip them. The
 * existing tests pre-date that filter and exercise records that always
 * normalize to a non-null TranscriptLine. This thin wrapper asserts
 * non-null so downstream `expect(line.X)` calls keep type-checking,
 * and surfaces an obvious failure if a future test feeds in a record
 * that the filter rejects.
 *
 * The metadata-filter behaviour is exercised by the dedicated tests in
 * the `normalizeLine — metadata filter` describe block below.
 */
function normalizeLine(raw: unknown, lineIndex: number) {
  const line = normalizeLineRaw(raw, lineIndex)
  if (line === null) {
    throw new Error('normalizeLine unexpectedly returned null for non-metadata input')
  }
  return line
}

describe('normalizeLine — role extraction', () => {
  it('marks top-level role:user records as user', () => {
    const line = normalizeLine({ role: 'user', content: 'hi' }, 0)
    expect(line.role).toBe('user')
    expect(line.text).toBe('hi')
    expect(line.isToolEvent).toBe(false)
  })

  it('marks role:assistant records as assistant', () => {
    const line = normalizeLine(
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      1,
    )
    expect(line.role).toBe('assistant')
    expect(line.text).toBe('Hello')
  })

  it('recognises role nested under .message.role', () => {
    const line = normalizeLine(
      { message: { role: 'assistant', content: 'answer' } },
      2,
    )
    expect(line.role).toBe('assistant')
    expect(line.text).toBe('answer')
  })

  it('treats type:tool_use as a tool event', () => {
    const line = normalizeLine(
      {
        type: 'tool_use',
        name: 'Read',
        input: { path: '/etc/passwd' },
        tool_use_id: 'abc123',
      },
      3,
    )
    expect(line.isToolEvent).toBe(true)
    expect(line.toolName).toBe('Read')
    expect(line.toolUseId).toBe('abc123')
    expect(line.role).toBe('tool')
  })

  it('treats type:tool_result as a tool event', () => {
    const line = normalizeLine(
      { type: 'tool_result', tool_use_id: 'abc123', content: 'ok' },
      4,
    )
    expect(line.isToolEvent).toBe(true)
    expect(line.toolUseId).toBe('abc123')
  })

  it('detects tool_use nested inside an assistant message content array', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'one moment' },
            { type: 'tool_use', id: 'tool-1', name: 'Grep', input: { pattern: 'x' } },
          ],
        },
      },
      5,
    )
    expect(line.isToolEvent).toBe(true)
    expect(line.toolName).toBe('Grep')
    expect(line.toolUseId).toBe('tool-1')
  })

  it('defaults unknown records to role=system', () => {
    const line = normalizeLine({ type: 'something-weird' }, 6)
    expect(line.role).toBe('system')
    expect(line.isToolEvent).toBe(false)
  })

  it('handles null/undefined raw records without throwing', () => {
    const line = normalizeLine(null, 7)
    expect(line.role).toBe('system')
    expect(line.text).toBe('')
  })
})

describe('normalizeLine — text extraction', () => {
  it('pulls plain-string content from a user record', () => {
    expect(normalizeLine({ role: 'user', content: 'hello' }, 0).text).toBe('hello')
  })

  it('joins content-array text blocks with blank lines', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'part one' },
          { type: 'text', text: 'part two' },
        ],
      },
      0,
    )
    expect(line.text).toBe('part one\n\npart two')
  })

  it('prefers message.content over top-level content', () => {
    const line = normalizeLine(
      { content: 'ignored', message: { content: 'preferred' } },
      0,
    )
    expect(line.text).toBe('preferred')
  })

  it('falls back to .text when no content field is present', () => {
    expect(normalizeLine({ text: 'fallback' }, 0).text).toBe('fallback')
  })
})

describe('normalizeLine — usage extraction', () => {
  it('extracts usage on assistant messages from message.usage', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        content: 'hi',
        message: {
          role: 'assistant',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 10,
          },
        },
      },
      0,
    )
    expect(line.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
    })
  })

  it('falls back to top-level .usage when message.usage is absent', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        content: 'hi',
        usage: { output_tokens: 42 },
      },
      0,
    )
    expect(line.usage?.outputTokens).toBe(42)
    expect(line.usage?.inputTokens).toBe(0)
  })

  it('returns undefined usage when no numeric fields are present', () => {
    const line = normalizeLine({ role: 'assistant', content: 'hi', usage: {} }, 0)
    expect(line.usage).toBeUndefined()
  })
})

describe('sumUsage', () => {
  it('sums across multiple assistant lines', () => {
    const lines = [
      normalizeLine({ role: 'assistant', content: 'a', usage: { input_tokens: 10, output_tokens: 5 } }, 0),
      normalizeLine({ role: 'user', content: 'q' }, 1),
      normalizeLine(
        { role: 'assistant', content: 'b', usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 7 } },
        2,
      ),
    ]
    const total = sumUsage(lines)
    expect(total.inputTokens).toBe(30)
    expect(total.outputTokens).toBe(35)
    expect(total.cacheReadTokens).toBe(7)
    expect(total.cacheCreationTokens).toBe(0)
  })

  it('returns zeros for an empty set', () => {
    const total = sumUsage([])
    expect(total).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })
})

describe('normalizeLine — timestamps + lineIndex', () => {
  it('preserves ISO timestamps verbatim', () => {
    const line = normalizeLine(
      { role: 'user', content: 'hi', timestamp: '2026-04-20T12:34:56Z' },
      0,
    )
    expect(line.timestamp).toBe('2026-04-20T12:34:56Z')
  })

  it('records the lineIndex passed by the caller', () => {
    const line = normalizeLine({ role: 'user' }, 9999)
    expect(line.lineIndex).toBe(9999)
  })

  it('drops timestamp when it is not a string', () => {
    const line = normalizeLine({ role: 'user', timestamp: 123 }, 0)
    expect(line.timestamp).toBeUndefined()
  })
})

describe('normalizeLine — metadata filter (returns null)', () => {
  // The filter prevents the transcript from rendering "SYSTEM (empty)"
  // rows for metadata records that Claude Code emits at session start.
  // Each test ensures the raw `normalizeLine` (not the wrapper above)
  // returns null for the type, then the assertion fails the wrapper
  // path so the test correctly distinguishes filter behaviour.
  it.each([
    'last-prompt',
    'custom-title',
    'agent-name',
    'permission-mode',
    'file-history-snapshot',
    'attachment',
    'queued-prompt',
    'compact-summary-anchor',
  ])('returns null for type=%s', (type) => {
    expect(normalizeLineRaw({ type, sessionId: 's-1' }, 0)).toBeNull()
  })

  it('still returns a TranscriptLine for type=user', () => {
    expect(normalizeLineRaw({ type: 'user', message: { role: 'user', content: 'hi' } }, 0)).not.toBeNull()
  })

  it('still returns a TranscriptLine for type=assistant', () => {
    expect(normalizeLineRaw({ type: 'assistant', message: { role: 'assistant', content: 'ok' } }, 0)).not.toBeNull()
  })

  it('does not filter when type is missing entirely', () => {
    expect(normalizeLineRaw({ role: 'user', content: 'hi' }, 0)).not.toBeNull()
  })

  it('filters type=system records that have no content (telemetry events)', () => {
    // Real Claude Code emits these: hook count markers, turn-duration
    // pings, message-count snapshots — all type=system with no message body.
    expect(normalizeLineRaw(
      { type: 'system', subtype: 'hook', hookCount: 0, hookInfos: [] },
      0,
    )).toBeNull()
    expect(normalizeLineRaw(
      { type: 'system', subtype: 'duration', durationMs: 12, messageCount: 5 },
      0,
    )).toBeNull()
  })

  it('keeps type=system records that DO carry text content', () => {
    // Some system records (command output, errors surfaced to user) carry
    // an actual message string. Those must still render.
    expect(normalizeLineRaw(
      { type: 'system', message: { role: 'system', content: 'process exited with 0' } },
      0,
    )).not.toBeNull()
    expect(normalizeLineRaw(
      { type: 'system', content: 'compaction triggered' },
      0,
    )).not.toBeNull()
  })

  // The ~28 new top-level record types from Claude Code 2.1.142+ (IN-1
  // schema-evolution audit). Without these in HIDDEN_RECORD_TYPES they
  // render as empty rows — the exact clutter the set exists to suppress.
  it.each([
    'hook_success',
    'hook_additional_context',
    'hook_non_blocking_error',
    'hook_cancelled',
    'queue-operation',
    'queued_command',
    'task_reminder',
    'task_status',
    'mode',
    'tool_reference',
    'skill_listing',
    'invoked_skills',
    'deferred_tools_delta',
    'mcp_instructions_delta',
    'command_permissions',
    'compact_file_reference',
    'file',
    'create',
    'update',
    'edited_text_file',
    'date_change',
    'diagnostics',
    'error',
    'authentication_error',
    'overloaded_error',
  ])('hides new 2.1.142+ noise type=%s', (type) => {
    expect(normalizeLineRaw({ type, sessionId: 's-1' }, 0)).toBeNull()
  })
})

describe('normalizeLine — thinking extraction (concern 3)', () => {
  it('captures reasoning from a thinking block (block.thinking, not block.text)', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'let me reason about this', signature: 'Ep==' },
            { type: 'text', text: 'the answer is 42' },
          ],
        },
      },
      0,
    )
    expect(line.thinkingText).toBe('let me reason about this')
    // Reasoning must NOT leak into the visible message body.
    expect(line.text).toBe('the answer is 42')
  })

  it('joins multiple thinking blocks with blank lines', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'step one' },
            { type: 'thinking', thinking: 'step two' },
            { type: 'text', text: 'done' },
          ],
        },
      },
      0,
    )
    expect(line.thinkingText).toBe('step one\n\nstep two')
  })

  it('counts redacted_thinking blocks and leaves thinkingText undefined when only redacted', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'redacted_thinking' },
            { type: 'redacted_thinking' },
            { type: 'text', text: 'visible' },
          ],
        },
      },
      0,
    )
    expect(line.redactedThinkingCount).toBe(2)
    expect(line.thinkingText).toBeUndefined()
    expect(line.text).toBe('visible')
  })

  it('leaves both thinking fields undefined for a plain text turn', () => {
    const line = normalizeLine(
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      0,
    )
    expect(line.thinkingText).toBeUndefined()
    expect(line.redactedThinkingCount).toBeUndefined()
  })

  it('keeps tool_use handling intact alongside thinking blocks', () => {
    const line = normalizeLine(
      {
        role: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I should grep' },
            { type: 'tool_use', id: 'tool-9', name: 'Grep', input: { pattern: 'x' } },
          ],
        },
      },
      0,
    )
    expect(line.thinkingText).toBe('I should grep')
    expect(line.isToolEvent).toBe(true)
    expect(line.toolName).toBe('Grep')
    expect(line.toolUseId).toBe('tool-9')
  })
})

describe('normalizeLine — tsMs (concern 5)', () => {
  it('parses an ISO timestamp into epoch ms', () => {
    const line = normalizeLine(
      { role: 'user', content: 'hi', timestamp: '2026-04-20T12:34:56.000Z' },
      0,
    )
    expect(line.tsMs).toBe(Date.parse('2026-04-20T12:34:56.000Z'))
    expect(Number.isFinite(line.tsMs)).toBe(true)
  })

  it('falls back to the provided previous tsMs when timestamp is absent', () => {
    // Call the raw export directly — the local non-null wrapper only forwards
    // two args, so the prevTsMs param must be exercised against normalizeLineRaw.
    const line = normalizeLineRaw({ role: 'user', content: 'no ts' }, 5, 1_700_000_000_000)
    expect(line?.tsMs).toBe(1_700_000_000_000)
  })

  it('falls back to 0 when timestamp is absent and no previous tsMs is provided', () => {
    const line = normalizeLine({ role: 'user', content: 'no ts' }, 0)
    expect(line.tsMs).toBe(0)
  })

  it('never produces NaN for an unparseable timestamp string', () => {
    const line = normalizeLineRaw({ role: 'user', timestamp: 'not-a-date' }, 0, 42)
    expect(line).not.toBeNull()
    expect(Number.isNaN(line!.tsMs)).toBe(false)
    expect(line!.tsMs).toBe(42)
  })
})

describe('normalizeLines — batch carry-forward + offset (concerns 4 & 5)', () => {
  it('assigns absolute file offsets (fromOffset + i) and drops metadata rows', () => {
    const raws = [
      { role: 'user', content: 'first' }, // offset 10
      { type: 'attachment' }, // offset 11 — filtered
      { role: 'assistant', content: 'second' }, // offset 12
    ]
    const lines = normalizeLines(raws, 10)
    expect(lines.map(l => l.lineIndex)).toEqual([10, 12])
    expect(lines.map(l => l.text)).toEqual(['first', 'second'])
  })

  it('carries tsMs forward across timestamp-less rows within a batch', () => {
    const t0 = '2026-04-20T00:00:00.000Z'
    const raws = [
      { role: 'user', content: 'a', timestamp: t0 },
      { role: 'assistant', content: 'b' }, // no ts → inherits a's tsMs
      { role: 'user', content: 'c' }, // no ts → still inherits a's tsMs
    ]
    const lines = normalizeLines(raws, 0)
    expect(lines[0].tsMs).toBe(Date.parse(t0))
    expect(lines[1].tsMs).toBe(Date.parse(t0))
    expect(lines[2].tsMs).toBe(Date.parse(t0))
  })

  it('seeds carry-forward from the prior page (seedTsMs)', () => {
    const lines = normalizeLines([{ role: 'user', content: 'page2 row, no ts' }], 100, 999)
    expect(lines[0].tsMs).toBe(999)
  })
})

describe('lineIndexToArrayPos — scroll-to-match mapping (concern 4)', () => {
  // Build a filtered `lines` array whose lineIndex values SKIP the offsets of
  // metadata records that normalizeLine dropped. This is exactly the shape the
  // renderer holds: array positions are dense, lineIndex values are sparse.
  function lineAt(lineIndex: number): TranscriptLine {
    return {
      lineIndex,
      role: 'user',
      text: `line ${lineIndex}`,
      tsMs: 0,
      isToolEvent: false,
      raw: {},
    }
  }
  // Offsets 0,1,2 were filtered out (metadata); rendered lines start at 3.
  const lines = [lineAt(3), lineAt(5), lineAt(8), lineAt(13)]

  it('maps an exact raw offset to its array position', () => {
    expect(lineIndexToArrayPos(lines, 3)).toBe(0)
    expect(lineIndexToArrayPos(lines, 5)).toBe(1)
    expect(lineIndexToArrayPos(lines, 8)).toBe(2)
    expect(lineIndexToArrayPos(lines, 13)).toBe(3)
  })

  it('maps an offset belonging to a FILTERED record to the nearest visible row before it', () => {
    // offset 6,7 were filtered (between 5 and 8) → land on position of line 5.
    expect(lineIndexToArrayPos(lines, 6)).toBe(1)
    expect(lineIndexToArrayPos(lines, 7)).toBe(1)
    // offset 9..12 filtered (between 8 and 13) → land on position of line 8.
    expect(lineIndexToArrayPos(lines, 12)).toBe(2)
  })

  it('returns 0 when the target precedes every loaded line', () => {
    // offsets 0..2 (leading metadata) precede the first rendered line (3).
    expect(lineIndexToArrayPos(lines, 0)).toBe(0)
    expect(lineIndexToArrayPos(lines, 2)).toBe(0)
  })

  it('clamps an offset past the loaded window to the last position', () => {
    expect(lineIndexToArrayPos(lines, 99)).toBe(3)
  })

  it('returns -1 (not-found sentinel) for an empty list', () => {
    expect(lineIndexToArrayPos([], 5)).toBe(-1)
  })

  it('regression: a match at a real offset lands on the correct row when leading metadata was filtered', () => {
    // The C4 bug: indexing offsets[] (array-position-keyed) with the raw
    // lineIndex scrolled to the wrong row. Here the match is at file offset 8;
    // its correct ARRAY position is 2, NOT 8. Proves the translation.
    const matchLineIndex = 8
    expect(lineIndexToArrayPos(lines, matchLineIndex)).toBe(2)
    expect(lineIndexToArrayPos(lines, matchLineIndex)).not.toBe(matchLineIndex)
  })
})
