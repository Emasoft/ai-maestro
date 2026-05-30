/**
 * Unit tests for the chronological-ruler event taxonomy + classifier
 * (`lib/session-events.ts`, TRDD-1657a5f4 Phase 5).
 *
 * The fixtures here mirror what `normalizeLine`
 * (`components/agent-profile/sessions/useJsonlSession.ts`) actually writes onto
 * a TranscriptLine, so the classifier is exercised against real-shaped data:
 *   - a tool INVOCATION carries `toolName` + `toolInput` (no `toolResult`)
 *   - a tool RESULT carries `toolResult` (no `toolName`)
 *   - `isToolEvent` is set for every tool row
 *   - `tsMs` is always a finite number (carry-forward guarantee)
 *
 * No mocks — exercises the real exported functions/constants.
 */

import { describe, it, expect } from 'vitest'

import {
  classifyEvent,
  EVENT_META,
  EVENT_KINDS,
  type EventKind,
} from '@/lib/session-events'
import type { TranscriptLine } from '@/types/sessions-browser'

/**
 * Build a fully-formed TranscriptLine, overriding only the fields a given case
 * cares about. Defaults match a plain non-tool row so every fixture starts from
 * a realistic baseline (finite tsMs, isToolEvent=false, empty text).
 */
function line(over: Partial<TranscriptLine>): TranscriptLine {
  return {
    lineIndex: 0,
    role: 'system',
    text: '',
    tsMs: 1_700_000_000_000,
    isToolEvent: false,
    raw: {},
    ...over,
  }
}

describe('classifyEvent — plain message rows', () => {
  it('user role → message-user', () => {
    expect(classifyEvent(line({ role: 'user', text: 'hi' }))).toBe('message-user')
  })

  it('assistant role → message-assistant', () => {
    expect(
      classifyEvent(line({ role: 'assistant', text: 'hello back' })),
    ).toBe('message-assistant')
  })

  it('system role → message-system', () => {
    expect(
      classifyEvent(line({ role: 'system', text: 'system reminder' })),
    ).toBe('message-system')
  })

  it('role:tool without isToolEvent (contradictory) → other', () => {
    // normalizeLine never produces this, but the classifier must be total.
    expect(classifyEvent(line({ role: 'tool', isToolEvent: false }))).toBe(
      'other',
    )
  })
})

describe('classifyEvent — tool invocations (have toolName)', () => {
  it('a Read tool_use → tool-use', () => {
    expect(
      classifyEvent(
        line({
          role: 'assistant',
          isToolEvent: true,
          toolName: 'Read',
          toolInput: { file_path: '/tmp/x.ts' },
          toolUseId: 'toolu_01',
        }),
      ),
    ).toBe('tool-use')
  })

  it('a Bash tool_use → tool-use', () => {
    expect(
      classifyEvent(
        line({
          isToolEvent: true,
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          toolUseId: 'toolu_02',
        }),
      ),
    ).toBe('tool-use')
  })

  it('an mcp__ prefixed tool_use → mcp-use', () => {
    expect(
      classifyEvent(
        line({
          isToolEvent: true,
          toolName: 'mcp__serena__find_symbol',
          toolInput: { name_path: 'classifyEvent' },
          toolUseId: 'toolu_03',
        }),
      ),
    ).toBe('mcp-use')
  })

  it('the Task tool_use (subagent spawn) → agent-launch', () => {
    expect(
      classifyEvent(
        line({
          isToolEvent: true,
          toolName: 'Task',
          toolInput: { subagent_type: 'general-purpose', prompt: 'go' },
          toolUseId: 'toolu_04',
        }),
      ),
    ).toBe('agent-launch')
  })
})

describe('classifyEvent — tool results (no toolName)', () => {
  it('a tool_result with no MCP hint → tool-result', () => {
    // Mirrors extractToolInfo on `type:'tool_result'`: only toolResult+toolUseId.
    expect(
      classifyEvent(
        line({
          role: 'tool',
          isToolEvent: true,
          toolResult: 'file contents…',
          toolUseId: 'toolu_01',
          raw: { type: 'tool_result', tool_use_id: 'toolu_01' },
        }),
      ),
    ).toBe('tool-result')
  })

  it('a tool_result whose raw carries an mcp__ name hint → mcp-result', () => {
    expect(
      classifyEvent(
        line({
          role: 'tool',
          isToolEvent: true,
          toolResult: { ok: true },
          toolUseId: 'toolu_03',
          raw: { type: 'tool_result', name: 'mcp__serena__find_symbol' },
        }),
      ),
    ).toBe('mcp-result')
  })

  it('a tool_result with an mcp__ hint nested in a content tool_use block → mcp-result', () => {
    expect(
      classifyEvent(
        line({
          role: 'tool',
          isToolEvent: true,
          toolResult: 'x',
          raw: {
            type: 'tool_result',
            content: [{ type: 'tool_use', name: 'mcp__grepika__search' }],
          },
        }),
      ),
    ).toBe('mcp-result')
  })

  it('a degenerate tool event (no name, no result) → other', () => {
    expect(classifyEvent(line({ isToolEvent: true }))).toBe('other')
  })
})

describe('classifyEvent — totality (never throws)', () => {
  it('null → other', () => {
    expect(classifyEvent(null)).toBe('other')
  })

  it('undefined → other', () => {
    expect(classifyEvent(undefined)).toBe('other')
  })

  it('an unknown role with no tool flag → other', () => {
    // Cast through unknown: the wire schema is best-effort, so a row with a
    // role outside MessageRole can occur; the classifier must not throw.
    const weird = line({}) as unknown as TranscriptLine
    ;(weird as { role: string }).role = 'banana'
    expect(classifyEvent(weird)).toBe('other')
  })

  it('a tool_result with a non-object raw still classifies (tool-result)', () => {
    expect(
      classifyEvent(
        line({
          isToolEvent: true,
          toolResult: 'plain',
          raw: 'not-an-object',
        }),
      ),
    ).toBe('tool-result')
  })
})

describe('EVENT_META — exhaustiveness', () => {
  it('has an entry for every EventKind in EVENT_KINDS', () => {
    for (const kind of EVENT_KINDS) {
      expect(EVENT_META[kind]).toBeDefined()
    }
  })

  it('EVENT_KINDS and EVENT_META keys are the exact same set', () => {
    const metaKeys = Object.keys(EVENT_META).sort()
    const listKeys = [...EVENT_KINDS].sort()
    expect(metaKeys).toEqual(listKeys)
  })

  it('every EVENT_META entry has a label, a text color, and a dot class (Tailwind classes)', () => {
    for (const kind of EVENT_KINDS) {
      const meta = EVENT_META[kind]
      expect(meta.label.length).toBeGreaterThan(0)
      // Tailwind text token, never a raw hex value.
      expect(meta.tailwindColor).toMatch(/^text-/)
      expect(meta.tailwindColor).not.toMatch(/#/)
      // Tailwind background token for the tick/dot, never a raw hex value.
      expect(meta.dotClass).toMatch(/^bg-/)
      expect(meta.dotClass).not.toMatch(/#/)
    }
  })

  it('palette: user=blue, assistant=emerald, system/other=gray, tool=violet, mcp=cyan/teal, agent-launch=amber', () => {
    expect(EVENT_META['message-user'].dotClass).toContain('blue')
    expect(EVENT_META['message-assistant'].dotClass).toContain('emerald')
    expect(EVENT_META['message-system'].dotClass).toContain('gray')
    expect(EVENT_META['tool-use'].dotClass).toContain('violet')
    expect(EVENT_META['tool-result'].dotClass).toContain('violet')
    expect(EVENT_META['mcp-use'].dotClass).toContain('cyan')
    expect(EVENT_META['mcp-result'].dotClass).toContain('teal')
    expect(EVENT_META['agent-launch'].dotClass).toContain('amber')
    expect(EVENT_META.other.dotClass).toContain('gray')
  })
})

describe('classifyEvent — covers every EventKind at least once', () => {
  it('produces all nine kinds from representative fixtures', () => {
    const produced = new Set<EventKind>([
      classifyEvent(line({ role: 'user' })),
      classifyEvent(line({ role: 'assistant' })),
      classifyEvent(line({ role: 'system', text: 's' })),
      classifyEvent(line({ isToolEvent: true, toolName: 'Read' })),
      classifyEvent(line({ isToolEvent: true, toolResult: 'r', raw: {} })),
      classifyEvent(line({ isToolEvent: true, toolName: 'mcp__x__y' })),
      classifyEvent(
        line({ isToolEvent: true, toolResult: 'r', raw: { name: 'mcp__x__y' } }),
      ),
      classifyEvent(line({ isToolEvent: true, toolName: 'Task' })),
      classifyEvent(null),
    ])
    expect([...produced].sort()).toEqual([...EVENT_KINDS].sort())
  })
})
