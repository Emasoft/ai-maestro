/**
 * Tests for `lib/ansi.ts` — the small ANSI SGR parser used by the
 * JSONL session browser to render colored `local-command-stdout`
 * captures (output of `/context`, `/skills`, etc.).
 *
 * Coverage:
 *   - parseAnsi: empty input, plain text round-trip, single SGR codes
 *     (bold, italic, underline, color reset), 256-color foreground,
 *     truecolor background, malformed sequences, mixed text + codes.
 *   - stripAnsi: leaves plain text alone, removes simple + extended
 *     sequences, leaves the raw text content alongside.
 */

import { describe, it, expect } from 'vitest'

import { parseAnsi, stripAnsi } from '@/lib/ansi'

const ESC = '\x1b'

describe('parseAnsi', () => {
  it('returns a single empty segment for the empty string', () => {
    expect(parseAnsi('')).toEqual([{ text: '', style: {} }])
  })

  it('round-trips plain text with no styling', () => {
    const out = parseAnsi('hello world')
    expect(out).toEqual([{ text: 'hello world', style: {} }])
  })

  it('renders bold via SGR code 1', () => {
    const input = `${ESC}[1mbold${ESC}[0m`
    const out = parseAnsi(input)
    expect(out).toEqual([{ text: 'bold', style: { fontWeight: 'bold' } }])
  })

  it('renders italic and underline together', () => {
    const input = `${ESC}[3;4mfoo${ESC}[0m`
    const out = parseAnsi(input)
    expect(out[0]).toEqual({
      text: 'foo',
      style: { fontStyle: 'italic', textDecoration: 'underline' },
    })
  })

  it('honors 256-color foreground (38;5;N)', () => {
    const input = `${ESC}[38;5;196mred${ESC}[39m`
    const out = parseAnsi(input)
    expect(out[0].text).toBe('red')
    expect(out[0].style.color).toMatch(/^#/)
  })

  it('honors truecolor background (48;2;R;G;B)', () => {
    const input = `${ESC}[48;2;10;20;30mhello${ESC}[0m`
    const out = parseAnsi(input)
    expect(out[0].text).toBe('hello')
    expect(out[0].style.backgroundColor).toBe('rgb(10,20,30)')
  })

  it('resets state on code 0', () => {
    const input = `${ESC}[1mbold${ESC}[0mplain`
    const out = parseAnsi(input)
    expect(out).toEqual([
      { text: 'bold', style: { fontWeight: 'bold' } },
      { text: 'plain', style: {} },
    ])
  })

  it('combines underline and strikethrough into a single textDecoration', () => {
    const input = `${ESC}[4;9mfoo`
    const out = parseAnsi(input)
    expect(out[0].style.textDecoration).toBe('underline line-through')
  })

  it('drops malformed truecolor params silently', () => {
    // 38;2 with no R;G;B values terminated by `m` — the parser sees
    // mode=2 (truecolor) but no R/G/B follow, so it should bail without
    // setting a color or crashing. The text after the SGR escape must
    // still render verbatim.
    const input = `${ESC}[38;2mfoo${ESC}[0m`
    const out = parseAnsi(input)
    const joined = out.map(s => s.text).join('')
    expect(joined).toBe('foo')
    // No color was set because the params were malformed.
    expect(out.every(s => !s.style.color)).toBe(true)
  })

  it('preserves text between escape sequences', () => {
    const input = `start ${ESC}[1mbold ${ESC}[31mred${ESC}[0m end`
    const out = parseAnsi(input)
    const joined = out.map(s => s.text).join('')
    expect(joined).toBe('start bold red end')
    expect(out.some(s => s.style.fontWeight === 'bold')).toBe(true)
    expect(out.some(s => s.style.color)).toBe(true)
  })

  it('treats unterminated sequences as plain text without throwing', () => {
    const input = `${ESC}[`
    expect(() => parseAnsi(input)).not.toThrow()
  })
})

describe('stripAnsi', () => {
  it('leaves plain text untouched', () => {
    expect(stripAnsi('hello')).toBe('hello')
  })

  it('removes simple SGR sequences', () => {
    expect(stripAnsi(`${ESC}[1mbold${ESC}[0m`)).toBe('bold')
  })

  it('removes 256-color sequences', () => {
    expect(stripAnsi(`${ESC}[38;5;220mhello${ESC}[39m`)).toBe('hello')
  })

  it('removes mixed sequences and preserves text content', () => {
    const input = `${ESC}[1mfoo${ESC}[0m bar ${ESC}[31mbaz${ESC}[0m`
    expect(stripAnsi(input)).toBe('foo bar baz')
  })

  it('returns empty for empty input', () => {
    expect(stripAnsi('')).toBe('')
  })
})
