import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// THE THIRD MENTION GUARD — @handles inside POSTABLE BODIES (USER directive, 2026-08-08:
// "add some safeguard against those citations").
//
// Its two siblings deliberately EXEMPT fenced blocks and code spans, because wrapping a handle in
// backticks is the prescribed fix for prose. That exemption is exactly the hole this class rides
// through: a fenced `gh issue create --body "…"` TEMPLATE is not prose — it is a POSTABLE BODY,
// copied out of its fence and executed, and at the moment of use the fence protects nothing.
// Measured across the fleet 2026-08-08: 28 fenced-template sites (INTEGRATOR), 22 confirmed
// paging sites in two sibling repos (ASSISTANT re-cut), all green under prose-level guards.
//
// Two doctrine facts this guard encodes, both measured, both counter-intuitive:
//   1. "Obviously fictional" placeholder names are REAL accounts. `alice`, `bob`, `db-team` are
//      all registered GitHub users (verified `gh api users/<name>`); descriptive slugs often are
//      not. So the rule is NEVER a blocklist of names — ANY handle shape inside a postable body
//      is a finding, and the check for whether a name pages is `gh api users/<name>`, not intuition.
//   2. A placeholder slot (`@<owner>`) is WORSE than a real handle in a template: it is the form a
//      reader substitutes a live handle into at copy time. Templates carry NO `@` at all
//      (~/.claude/rules/github-mentions.md; the byline guard learned this the hard way).
//
// SCOPE — keyed on the OBJECTIVE signal, the GH POSTING COMMAND: `gh issue|pr
// create|comment|review|edit`. Everything that command window carries (quoted args, the heredoc
// its --body reads) IS published verbatim when the command runs. Stated blind spot, as data: a
// fenced message template that is postable but not shaped as a gh command (e.g. an AMP body) is
// NOT seen by this extractor — the prose-level sibling guards cover those outside fences, and
// nothing covers them inside fences. If that class ever bites, widen here and say so.
//
// NOT matched, by construction: `gh api …` (not a posting verb — tailscale/API `--body` payloads
// legitimately carry `@` in ACL tags and emails), `gh issue view` (read-only), email local parts,
// action version pins (`checkout@v5`).

const REPO = path.resolve(__dirname, '../..')

/** Where postable-body templates and posting scripts live. Tracked text only; symlinks skipped so
 *  the SCENARIOS_TESTS_RULES.md symlink cannot double-count its target (a known census trap). */
const SCAN_ROOTS = ['docs', 'rules', 'scripts', '.claude', 'design/specs', 'tests/scenarios']
const SCAN_EXTS = ['.md', '.sh']

function listScanned(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      // chat_history holds verbatim conversation EXPORTS — historical records nobody copies a
      // template from. Scanning them reports the past (quoted commands from old sessions) as
      // present defects and buries a real finding; the guard is for templates and live scripts.
      if (e.isDirectory() && e.name === 'chat_history') continue
      if (e.isDirectory()) walk(p)
      else if (SCAN_EXTS.some((x) => e.name.endsWith(x))) out.push(path.relative(REPO, p))
    }
  }
  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO, root)
    if (fs.existsSync(abs)) walk(abs)
  }
  out.push('CLAUDE.md')
  return out
}

const GH_POST = /\bgh\s+(issue|pr)\s+(create|comment|review|edit)\b/g

/** A postable span: the gh command's own window (its line plus backslash continuations) and, when
 *  the window opens a heredoc, the heredoc body — which is exactly what `--body` publishes. */
function postableSpans(text: string): Array<{ line: number; text: string }> {
  const lines = text.split('\n')
  const spans: Array<{ line: number; text: string }> = []
  for (let i = 0; i < lines.length; i++) {
    GH_POST.lastIndex = 0
    if (!GH_POST.test(lines[i])) continue
    let end = i
    while (end < lines.length - 1 && /\\\s*$/.test(lines[end])) end++
    const window = lines.slice(i, end + 1).join('\n')
    let span = window
    const heredoc = window.match(/<<-?\s*['"]?(\w+)['"]?/)
    if (heredoc) {
      const tag = heredoc[1]
      for (let j = end + 1; j < lines.length; j++) {
        if (lines[j].trim() === tag) break
        span += '\n' + lines[j]
      }
    }
    spans.push({ line: i + 1, text: span })
    i = end
  }
  return spans
}

// Same discriminators as the sibling guard: alnum right after `@`; the char before must not make
// it an email local part, a version pin, or a path. PLUS the slot form `@<name>` — in a template
// a slot is a handle about to become real, and templates carry no `@` at all.
const BODY_MENTION = /(^|[^\w/.@-])@([A-Za-z0-9][A-Za-z0-9-]{0,38}|<[A-Za-z][A-Za-z-]*>)/g

function findPostableHandles(text: string): Array<{ line: number; handle: string }> {
  const hits: Array<{ line: number; handle: string }> = []
  for (const span of postableSpans(text)) {
    for (const m of span.text.matchAll(BODY_MENTION)) hits.push({ line: span.line, handle: m[2] })
  }
  return hits
}

describe('no @handle inside a postable body — gh posting commands and their heredocs', () => {
  // POSITIVE CONTROLS FIRST — without them, a broken extractor and a clean corpus are the same.
  it('detects a handle in a quoted --body argument', () => {
    expect(findPostableHandles('gh issue create --repo o/r --body "ping @manager about this"').map((h) => h.handle))
      .toEqual(['manager'])
  })

  it('detects a handle inside a heredoc body — the fence-proof case this guard exists for', () => {
    const t = [
      '```bash',
      'gh issue create --repo o/r --body "$(cat <<\'EOF\'',
      'Thanks @alice — routing to @db-team.',
      'EOF',
      ')"',
      '```',
    ].join('\n')
    expect(findPostableHandles(t).map((h) => h.handle)).toEqual(['alice', 'db-team'])
  })

  it('detects the placeholder slot form — a template handle about to become real', () => {
    expect(findPostableHandles('gh pr comment 5 --body "reviewed by @<owner>"').map((h) => h.handle))
      .toEqual(['<owner>'])
  })

  it('does NOT fire on non-posting gh commands or non-gh --body payloads', () => {
    expect(findPostableHandles('gh api users/alice --jq .login')).toEqual([])
    expect(findPostableHandles('gh issue view 7 --comments # discusses @manager')).toEqual([])
    expect(findPostableHandles('ts_call.sh --body \'{"tags":["tag:@internal"]}\'')).toEqual([])
  })

  it('does NOT fire on an email local part or a version pin inside a body', () => {
    expect(findPostableHandles('gh issue create --body "mail someone@gmail.com re actions/checkout@v5"'))
      .toEqual([])
  })

  it('extracts a NON-EMPTY set of postable spans from the real corpus (non-vacuity)', () => {
    // A zero-findings verdict over zero extracted spans certifies nothing. The repo carries real
    // gh posting commands (amp-submit-pr.sh, the scenario rules). Measured 2026-08-08: none of
    // them is heredoc-shaped, so the heredoc path is pinned by the synthetic positive control
    // above — when the corpus won't supply a shape, the control injects it.
    let spanCount = 0
    for (const rel of listScanned()) {
      spanCount += postableSpans(fs.readFileSync(path.join(REPO, rel), 'utf8')).length
    }
    expect(spanCount).toBeGreaterThanOrEqual(3)
  })

  it('finds no handle in any postable body in the corpus', () => {
    const findings: string[] = []
    for (const rel of listScanned()) {
      for (const h of findPostableHandles(fs.readFileSync(path.join(REPO, rel), 'utf8'))) {
        findings.push(`${rel}:${h.line}  @${h.handle}`)
      }
    }
    expect(findings).toEqual([])
  })
})
