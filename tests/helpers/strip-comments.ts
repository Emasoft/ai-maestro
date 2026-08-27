/**
 * Strip JS/TS comments from SOURCE TEXT for a scanner, without going blind.
 *
 * WHY THIS EXISTS (measured 2026-08-27, TRDD-ENFCF8O7). Ten scanner tests stripped comments as
 * `src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'')` — block comments FIRST, line
 * comments SECOND. A `/**` that occurs INSIDE a `//` line comment is therefore read as a
 * block-comment opener, and everything up to the next block-close anywhere in the file is deleted before
 * any needle runs. On `services/headless-router.ts` the glob in `// … never executes app/api/**.`
 * (line 2626) swallowed 2,046 of 4,733 lines — 43% of the file, in ONE 75,157-char false match —
 * including two LIVE `await updateTeam(…)` calls. The r51 multi-store scanner concluded the file
 * touched one store, not two, and its assertion said "no longer a finding — remove it and lower
 * the ratchet". That instruction was obeyed, then reverted (756b90ea / d6b88501).
 *
 * THE FAILURE DIRECTION IS THE DANGEROUS ONE: findings are silently REMOVED. Most of the ten are
 * authorization scanners, where a removed finding means an unguarded route reads as guarded. And
 * every one of them had a passing non-vacuity test and a passing positive control — synthetic
 * input cannot see what a stripper does to the real corpus.
 *
 * Swapping the regex order is NOT the fix: line-first has the mirror hole (a `//` inside a block
 * comment, or inside a string or regex literal, misfires the same way). Two regexes can never
 * agree about a token that means different things depending on what encloses it. So this is a
 * small single-pass tokenizer that tracks the enclosing context — block comment, line comment,
 * single/double/backtick string, regex literal — and blanks ONLY comment bytes.
 *
 * It PRESERVES LINE STRUCTURE: comment bytes become spaces and newlines are kept, so a scanner
 * that reports `file:line` still reports the right line, and `^…$` needles written with the `m`
 * flag keep working. The old strip deleted lines, which is why every consumer's line numbers were
 * quietly wrong too.
 *
 * KNOWN LIMIT, stated rather than hidden: regex-literal detection is heuristic (a `/` is a regex
 * opener when the previous significant char cannot end an expression). It is the same heuristic
 * every lightweight JS tokenizer uses and it is right for this corpus; a `/` after `)` that was
 * meant as division-then-regex is the classic ambiguity and is not something a scanner needle
 * cares about. `strip-comments.test.ts` pins every context this file claims to handle, including
 * the exact `/**`-inside-`//` shape that motivated it — that case reds under the old strip.
 */

const enum Ctx { Code, Block, Line, Single, Double, Backtick, Regex, RegexClass }

/** Chars after which a `/` cannot be division and must open a regex literal. */
function regexCanFollow(prev: string): boolean {
  if (prev === '') return true
  if (/[\s(,=:[!&|?{};+\-*%<>~^]/.test(prev)) return true
  return false
}

export function stripComments(src: string): string {
  const out: string[] = []
  let ctx = Ctx.Code
  let prevSig = '' // last significant (non-space, non-comment) char, for the regex heuristic
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = i + 1 < n ? src[i + 1] : ''
    switch (ctx) {
      case Ctx.Code:
        if (c === '/' && d === '*') { ctx = Ctx.Block; out.push('  '); i += 2; continue }
        if (c === '/' && d === '/') { ctx = Ctx.Line; out.push('  '); i += 2; continue }
        if (c === "'") ctx = Ctx.Single
        else if (c === '"') ctx = Ctx.Double
        else if (c === '`') ctx = Ctx.Backtick
        else if (c === '/' && regexCanFollow(prevSig)) ctx = Ctx.Regex
        if (!/\s/.test(c)) prevSig = c
        out.push(c); i++; continue
      case Ctx.Block:
        if (c === '*' && d === '/') { ctx = Ctx.Code; out.push('  '); i += 2; continue }
        out.push(c === '\n' ? '\n' : ' '); i++; continue
      case Ctx.Line:
        if (c === '\n') { ctx = Ctx.Code; out.push('\n'); i++; continue }
        out.push(' '); i++; continue
      case Ctx.Single:
      case Ctx.Double:
      case Ctx.Backtick: {
        const q = ctx === Ctx.Single ? "'" : ctx === Ctx.Double ? '"' : '`'
        if (c === '\\') { out.push(c, d); i += 2; continue }
        if (c === q) ctx = Ctx.Code
        else if (c === '\n' && ctx !== Ctx.Backtick) ctx = Ctx.Code // unterminated — recover
        out.push(c); i++; continue
      }
      case Ctx.Regex:
        if (c === '\\') { out.push(c, d); i += 2; continue }
        if (c === '[') ctx = Ctx.RegexClass
        else if (c === '/') ctx = Ctx.Code
        else if (c === '\n') ctx = Ctx.Code // unterminated — recover
        out.push(c); i++; continue
      case Ctx.RegexClass:
        if (c === '\\') { out.push(c, d); i += 2; continue }
        if (c === ']') ctx = Ctx.Regex
        else if (c === '\n') ctx = Ctx.Code
        out.push(c); i++; continue
    }
  }
  return out.join('')
}
