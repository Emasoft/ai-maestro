/**
 * NEUTER (2026-08-27, direct insert then git checkout, restore verified): making Ctx.Line treat
 * `/*` as a block opener — i.e. regressing to the bug — reds exactly THE BUG test, 1 red / 7 green.
 *
 * Pins every enclosing context `stripComments` claims to handle. The first case is THE motivating
 * shape (TRDD-ENFCF8O7) and is asserted against the OLD strip too, so this file cannot pass while
 * the bug it fixes is still reproducible — a fixture that only proves the new code is right would
 * also pass if the new code were the old code.
 */
import { describe, expect, it } from 'vitest'
import { stripComments } from './strip-comments'

const OLD = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('stripComments — context-aware, line-preserving', () => {
  it('THE BUG: a /** inside a // line comment does NOT open a block comment (old strip fails this)', () => {
    const src = [
      '// never executes app/api/**.',
      'const live = updateTeam(id)',
      '/* real block */',
      'const alsoLive = updateTeam(id)',
      '// end */',
    ].join('\n')
    const got = stripComments(src)
    expect((got.match(/updateTeam\(/g) ?? []).length).toBe(2)
    // POSITIVE CONTROL on the defect: the old strip swallows the first call.
    expect((OLD(src).match(/updateTeam\(/g) ?? []).length).toBeLessThan(2)
  })

  it('preserves line count so file:line reports stay right (old strip deletes lines)', () => {
    const src = 'a()\n/* two\nlines */\nb()\n// c\nd()\n'
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length)
    expect(OLD(src).split('\n').length).not.toBe(src.split('\n').length)
  })

  it('a // inside a block comment does not terminate the block early', () => {
    const src = '/* http://x.y/z\n still comment */ live()'
    expect(stripComments(src)).toMatch(/^\s+live\(\)$/)
  })

  it('comment openers inside STRING literals are code, not comments', () => {
    const src = `const a = "/* not a comment */"; const b = '// nor this'; const c = \`/** nor \${x} this */\`; live()`
    expect(stripComments(src)).toBe(src)
  })

  it('comment openers inside a REGEX literal are code, not comments', () => {
    const src = 'const r = /\\/\\*[\\s\\S]*?\\*\\//g; const u = /^https?:\\/\\// ; live()'
    expect(stripComments(src)).toBe(src)
  })

  it('a URL in code (http://…) is not a line comment — the r2-r8 file guarded this by hand', () => {
    const src = "const u = 'http://example.com/a' // trailing comment\nlive()"
    const got = stripComments(src)
    expect(got).toContain("'http://example.com/a'")
    expect(got).not.toContain('trailing comment')
    expect(got).toContain('live()')
  })

  it('division is not a regex opener', () => {
    const src = 'const x = a / b / c; // note\nlive()'
    expect(stripComments(src)).toContain('const x = a / b / c;')
    expect(stripComments(src)).toContain('live()')
  })

  it('escaped quotes inside strings do not end the string', () => {
    const src = `const s = 'it\\'s /* fine */'; live()`
    expect(stripComments(src)).toBe(src)
  })
})
