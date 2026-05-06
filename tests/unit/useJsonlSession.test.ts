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
  sumUsage,
} from '@/components/agent-profile/sessions/useJsonlSession'

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
})
