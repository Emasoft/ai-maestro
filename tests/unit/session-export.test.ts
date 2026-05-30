/**
 * Tests for `lib/session-export.ts` — the pure serialisers that turn a
 * selected interval of `TranscriptLine[]` into clean Markdown (and plain
 * text) for the Phase 8 ChatTranscript export FAB.
 *
 * Coverage:
 *   - toMarkdown: empty selection → empty string (no header),
 *     role headings (USER / ASSISTANT / TOOL), local-time suffix,
 *     ANSI stripped inside fenced code blocks, input ordering preserved,
 *     reasoning blockquote, tool JSON fence, optional title heading,
 *     trailing-newline normalisation.
 *   - toPlainText: empty → empty, ANSI stripped, role + reasoning markers.
 */

import { describe, it, expect } from 'vitest'

import { toMarkdown, toPlainText } from '@/lib/session-export'
import type { TranscriptLine } from '@/types/sessions-browser'

const ESC = '\x1b'

/** Build a minimal TranscriptLine with sane defaults; override per-test. */
function makeLine(over: Partial<TranscriptLine>): TranscriptLine {
  return {
    lineIndex: 0,
    role: 'user',
    text: '',
    tsMs: 0,
    isToolEvent: false,
    raw: null,
    ...over,
  }
}

describe('toMarkdown', () => {
  it('returns an empty string for an empty selection (no header)', () => {
    expect(toMarkdown([])).toBe('')
    // Even with a title, an empty selection yields nothing.
    expect(toMarkdown([], { title: 'My session' })).toBe('')
  })

  it('emits a "## USER" heading for a user turn', () => {
    const md = toMarkdown([makeLine({ role: 'user', text: 'hello there' })])
    expect(md).toContain('## USER')
    expect(md).toContain('hello there')
  })

  it('emits a "## ASSISTANT" heading for an assistant turn', () => {
    const md = toMarkdown([makeLine({ role: 'assistant', text: 'hi back' })])
    expect(md).toContain('## ASSISTANT')
    expect(md).toContain('hi back')
  })

  it('labels a tool event "## TOOL" even when the raw role is user', () => {
    const md = toMarkdown([
      makeLine({
        role: 'user', // tool_result arrives inside a user record
        isToolEvent: true,
        toolName: 'Bash',
        toolInput: { command: 'ls' },
      }),
    ])
    expect(md).toContain('## TOOL')
    expect(md).not.toContain('## USER')
  })

  it('appends the local-time stamp to the heading when tsMs is present', () => {
    // 2026-05-30T12:34:56 local — assert the heading carries an
    // YYYY-MM-DD HH:MM:SS suffix (exact value depends on the machine zone,
    // so we assert the SHAPE, not the literal clock).
    const tsMs = new Date(2026, 4, 30, 12, 34, 56).getTime()
    const md = toMarkdown([makeLine({ role: 'user', text: 'x', tsMs })])
    expect(md).toMatch(/## USER — \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
  })

  it('omits the time suffix when no usable timestamp exists', () => {
    const md = toMarkdown([makeLine({ role: 'user', text: 'x', tsMs: 0 })])
    // The heading is exactly "## USER" with no em-dash time suffix.
    expect(md).toMatch(/^## USER\n/m)
    expect(md).not.toMatch(/## USER — /)
  })

  it('strips ANSI escape codes inside fenced tool output', () => {
    const md = toMarkdown([
      makeLine({
        isToolEvent: true,
        toolName: 'context',
        toolResult: `${ESC}[31mred text${ESC}[0m plain`,
      }),
    ])
    expect(md).toContain('red text plain')
    // No raw ESC byte and no SGR sequence survives anywhere.
    expect(md).not.toContain(ESC)
    expect(md).not.toContain('[31m')
    expect(md).not.toContain('[0m')
  })

  it('strips ANSI escape codes inside a prose/terminal body', () => {
    // A captured `/context` body carries ANSI inside an assistant record.
    const body = `<local-command-stdout>${ESC}[1mBOLD${ESC}[0m line</local-command-stdout>`
    const md = toMarkdown([makeLine({ role: 'assistant', text: body })])
    expect(md).toContain('BOLD')
    expect(md).not.toContain(ESC)
    expect(md).not.toContain('[1m')
  })

  it('preserves input ordering verbatim (does not re-sort)', () => {
    // Deliberately out-of-lineIndex order — the serialiser must keep the
    // caller's order (the caller already sorted the selection).
    const md = toMarkdown([
      makeLine({ lineIndex: 5, role: 'assistant', text: 'SECOND' }),
      makeLine({ lineIndex: 2, role: 'user', text: 'FIRST' }),
    ])
    const firstPos = md.indexOf('SECOND')
    const secondPos = md.indexOf('FIRST')
    expect(firstPos).toBeGreaterThanOrEqual(0)
    expect(secondPos).toBeGreaterThan(firstPos)
  })

  it('renders a "> reasoning" blockquote when the turn carried thinking', () => {
    const md = toMarkdown([
      makeLine({
        role: 'assistant',
        text: 'the answer',
        thinkingText: 'let me think\nabout this',
      }),
    ])
    expect(md).toContain('> **reasoning**')
    expect(md).toContain('> let me think')
    expect(md).toContain('> about this')
    // The answer body still appears after the reasoning block.
    expect(md.indexOf('the answer')).toBeGreaterThan(md.indexOf('> **reasoning**'))
  })

  it('emits a redacted-reasoning marker when redactedThinkingCount > 0', () => {
    const md = toMarkdown([
      makeLine({ role: 'assistant', text: 'ok', redactedThinkingCount: 3 }),
    ])
    expect(md).toContain('> **reasoning**')
    expect(md).toContain('[redacted reasoning ×3]')
  })

  it('omits the reasoning block entirely when no thinking is present', () => {
    const md = toMarkdown([makeLine({ role: 'assistant', text: 'plain' })])
    expect(md).not.toContain('reasoning')
  })

  it('fences tool input + result as a single ```json block', () => {
    const md = toMarkdown([
      makeLine({
        isToolEvent: true,
        toolName: 'Edit',
        toolInput: { file_path: '/x.ts' },
        toolResult: 'done',
      }),
    ])
    expect(md).toContain('```json')
    expect(md).toContain('"tool": "Edit"')
    expect(md).toContain('"file_path": "/x.ts"')
    expect(md).toContain('"result": "done"')
  })

  it('emits an *(empty)* marker for a non-tool turn with empty body', () => {
    const md = toMarkdown([makeLine({ role: 'user', text: '' })])
    expect(md).toContain('*(empty)*')
  })

  it('prepends a "# <title>" heading when a title is supplied', () => {
    const md = toMarkdown([makeLine({ role: 'user', text: 'x' })], {
      title: 'Session export',
    })
    expect(md.startsWith('# Session export\n')).toBe(true)
  })

  it('ends with exactly one trailing newline (no double blank line)', () => {
    const md = toMarkdown([makeLine({ role: 'user', text: 'x' })])
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })
})

describe('toPlainText', () => {
  it('returns an empty string for an empty selection', () => {
    expect(toPlainText([])).toBe('')
  })

  it('strips ANSI and carries a role label + reasoning marker', () => {
    const txt = toPlainText([
      makeLine({
        role: 'assistant',
        text: `${ESC}[32mgreen${ESC}[0m body`,
        thinkingText: 'pondering',
      }),
    ])
    expect(txt).toContain('ASSISTANT')
    expect(txt).toContain('[reasoning] pondering')
    expect(txt).toContain('green body')
    expect(txt).not.toContain(ESC)
  })
})
