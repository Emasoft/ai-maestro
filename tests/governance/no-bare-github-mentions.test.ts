import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ai-maestro#109 — EVERY AI Maestro role name is a registered GitHub account. Verified by CORE with
// `gh api users/<h>`: `manager` and `janitor` are Users; `owner`, `role`, `core` and `orchestrator`
// are Organizations. So an agent that copies a template line containing a bare at-mention into an
// issue body notifies a stranger with no connection to this project. Four were paged on 2026-08-02.
//
// The root cause was a TEMPLATE, not misbehaving agents: the recommended self-identification line —
// the very rule that governs GitHub writes — carried a bare handle in its own example text, and
// literal pasting is the EXPECTED behaviour for an example. `<plugin-or-role>` is never pasted
// verbatim because angle brackets read as a slot; a bare handle is, because it looks like finished
// text. Hence the fix belongs in the template and the guard belongs in CI.
//
// ── ITS SIBLING, AND WHY BOTH EXIST ─────────────────────────────────────────────────────────────
// `no-at-role-mentions.test.ts` guards the same class and is NOT superseded by this file. Before
// deleting either as a duplicate, here is the mutation each one alone would miss:
//
//   • THAT one matches a CLOSED list of governance role names (`@manager`, `@cos`, …) over
//     `git ls-files rules docs scripts .claude`. It is the only one that covers `scripts/` and
//     `.claude/`, and it carries the incident that started this — a real person named `manager`
//     asking us to stop paging him. It CANNOT see a handle that is not a role: it read straight
//     past `@spec`, which is a real Organization.
//   • THIS one matches ANY handle shape, over the governance PROSE an agent copies templates from,
//     including `design/specs/` which the other does not scan. It is the one that found `@spec`.
//     It does not look at `scripts/` or `.claude/`, so it cannot replace the other.
//
// Two detectors, one hazard, disjoint blind spots. Keep both; if either scan set ever grows to
// cover the other, collapse them then and say so here.
//
// TWO DESIGN NOTES, both from CORE's implementation and both load-bearing:
//   1. Code spans and fenced blocks are EXEMPT — wrapping in backticks is the prescribed fix, so it
//      must not also be a finding. A guard that flags the remedy trains everyone to ignore it.
//   2. It must not fire on an email local part or a version pin. `user@gmail.com` and
//      `actions/checkout@v5` both contain something that looks like a handle; flagging either is
//      the fastest way to get the whole check disabled.

const REPO = path.resolve(__dirname, '../..')

/** Governance-bearing prose an agent may copy from. Not the whole repo — source code is not a
 *  template, and scanning it would bury a real finding under matches nobody would ever paste. */
const SCANNED: string[] = [
  'docs/GOVERNANCE-RULES.md',
  'CLAUDE.md',
  ...listMarkdown('rules'),
  ...listMarkdown('design/specs'),
]

function listMarkdown(rel: string): string[] {
  const abs = path.join(REPO, rel)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.md')) out.push(path.relative(REPO, p))
    }
  }
  walk(abs)
  return out
}

/**
 * Blank out fenced blocks, inline code spans, and HTML comments — preserving line structure so
 * reported line numbers stay true.
 *
 * WHY HTML COMMENTS ARE EXEMPT, stated because `spec` IS a real GitHub Organization (checked with
 * `gh api users/spec`) and this is therefore a deliberate carve-out rather than an oversight. Our
 * specs carry 15 machine-readable anchors of the form `<!-- @spec:comm-graph — … -->`, and two
 * conformance suites (`governance-spec-conformance`, `three-pillars-spec-conformance`) parse them,
 * so the convention is load-bearing and renaming it is a coupled change, not a typo fix.
 *
 * The trade, honestly: an HTML comment is not rendered prose and is not the surface an agent copies
 * a template line from, which is the failure mode #109 is actually about. The residual risk is that
 * someone pastes a whole section INCLUDING its anchor comment into an issue body. That is not zero,
 * and it is recorded on #109 rather than assumed away — if the anchor convention ever moves off `@`,
 * this exemption should go with it.
 */
function stripCode(text: string): string {
  const noFences = text.replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/[^\n]/g, ' '))
  const noComments = noFences.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  return noComments.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

// A handle must start alphanumeric; the char BEFORE the `@` must not be one that makes it an email
// local part (`user@gmail`), a version pin (`checkout@v5`), or a path.
const BARE_MENTION = /(^|[^\w/.@-])@([A-Za-z0-9][A-Za-z0-9-]{0,38})/g

function findBareMentions(text: string): Array<{ line: number; handle: string }> {
  const hits: Array<{ line: number; handle: string }> = []
  stripCode(text)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(BARE_MENTION)) hits.push({ line: i + 1, handle: m[2] })
    })
  return hits
}

describe('no bare GitHub at-mention in governance-bearing prose (ai-maestro#109)', () => {
  // POSITIVE CONTROLS FIRST. Without them every assertion below passes when the matcher is broken,
  // and a matcher that finds nothing is indistinguishable from a clean corpus.
  it('detects a bare mention', () => {
    expect(findBareMentions('the @manager ruled X').map((h) => h.handle)).toEqual(['manager'])
  })

  it('detects the exact defect that caused the incident — a handle in a template example', () => {
    const template = '_Posted by the Claude developing **<plugin-or-role>** (via the shared @owner gh auth)._'
    expect(findBareMentions(template).map((h) => h.handle)).toEqual(['owner'])
  })

  it('does NOT fire on the prescribed fix (a code span) or a fenced block', () => {
    expect(findBareMentions('the `@manager` ruled X')).toEqual([])
    expect(findBareMentions('```\nping @manager here\n```')).toEqual([])
  })

  it('does NOT fire on an email local part or an action version pin', () => {
    expect(findBareMentions('mail someone@gmail.com about it')).toEqual([])
    expect(findBareMentions('uses: actions/checkout@v5')).toEqual([])
  })

  it('does NOT fire on the angle-bracket slot form, which is what our copies use', () => {
    expect(findBareMentions('(via the shared @<owner> gh auth)')).toEqual([])
  })

  it('exempts the in-repo spec anchor, but ONLY inside its comment', () => {
    expect(findBareMentions('<!-- @spec:comm-graph — the matrix -->')).toEqual([])
    // The exemption is the COMMENT, not the word: the same anchor in prose is still a finding,
    // because `spec` is a real GitHub Organization and prose is what gets pasted.
    expect(findBareMentions('see @spec:comm-graph for the matrix').map((h) => h.handle)).toEqual(['spec'])
  })

  it('scans a non-empty set of real files (guards against a silently empty corpus)', () => {
    const present = SCANNED.filter((f) => fs.existsSync(path.join(REPO, f)))
    expect(present.length).toBeGreaterThan(5)
    expect(present).toContain('docs/GOVERNANCE-RULES.md')
  })

  it('finds none in the governance corpus', () => {
    const findings: string[] = []
    for (const rel of SCANNED) {
      const abs = path.join(REPO, rel)
      if (!fs.existsSync(abs)) continue
      for (const h of findBareMentions(fs.readFileSync(abs, 'utf8'))) {
        findings.push(`${rel}:${h.line}  @${h.handle}`)
      }
    }
    expect(findings).toEqual([])
  })
})

/**
 * THE BYLINE TEMPLATE MUST CARRY NO `@` AT ALL — including a PLACEHOLDER.
 *
 * `BARE_MENTION` above requires an alphanumeric right after the `@`, so it matches `@Emasoft`
 * and reads straight past `@<owner>`. That is the wrong way round for a TEMPLATE: the
 * placeholder is the form a reader SUBSTITUTES A REAL HANDLE INTO at copy time, so the guard
 * was catching the handle that is already real and missing the one that is about to become
 * real. Measured 2026-08-05: `docs/GOVERNANCE-RULES.md` R22.2 and
 * `rules/aimaestro/aimaestro-prrd-governance.md` both shipped `@<owner>` for months, green.
 *
 * Backticks are no defence here and that is the whole point — a template's purpose is to be
 * copied OUT of its code span into a real comment, where the `@` linkifies and pages a live
 * account. The janitor hit the identical defect in its own IND base rule and disclosed paging
 * a real account from it (ai-maestro#109); `~/.claude/rules/github-mentions.md` already rules
 * it: "Templates carry no `@` at all."
 *
 * SCOPED TO THE TEMPLATE SPAN, not the line: the prose AROUND a byline legitimately discusses
 * `@` (this rule's own text does), and a line-level check would fire on the explanation that
 * exists to prevent the bug.
 */
const BYLINE_SPAN = /Posted by the Claude developing[\s\S]{0,200}?gh auth/g

/** Collapse markdown line-wrapping + blockquote markers so a template split across lines is
 *  still ONE span. The overlay's copy wraps mid-template; without this it is invisible. */
function bylineTemplates(text: string): string[] {
  const flat = text.replace(/\n\s*>?\s*/g, ' ')
  return flat.match(BYLINE_SPAN) ?? []
}

describe('governance: the self-identification BYLINE TEMPLATE carries no @', () => {
  it('detects a placeholder handle AND a real one (positive control)', () => {
    // Without this the corpus assertion below passes for any reason at all, including a regex
    // that matches nothing — which is exactly how the placeholder survived the other guard.
    expect(bylineTemplates('_Posted by the Claude developing **X** (via the shared @<owner> gh auth)._')[0])
      .toContain('@')
    expect(bylineTemplates('_Posted by the Claude developing **X** (via the shared @Emasoft gh auth)._')[0])
      .toContain('@')
  })

  it('accepts the corrected form (plain owner name, no @)', () => {
    const spans = bylineTemplates('_Posted by the Claude developing **X** (via the shared <owner> gh auth)._')
    expect(spans).toHaveLength(1)
    expect(spans[0]).not.toContain('@')
  })

  it('finds the template in a NON-EMPTY set of governance files (non-vacuity)', () => {
    // A rule written only over BAD items is vacuous on an empty set: if no file carried the
    // byline at all, the corpus assertion below would pass having read nothing.
    const withByline = SCANNED.filter((rel) => {
      const abs = path.join(REPO, rel)
      return fs.existsSync(abs) && bylineTemplates(fs.readFileSync(abs, 'utf8')).length > 0
    })
    expect(withByline.length).toBeGreaterThanOrEqual(2)
    expect(withByline).toContain('docs/GOVERNANCE-RULES.md')
  })

  it('finds no @ in any byline template in the governance corpus', () => {
    const findings: string[] = []
    for (const rel of SCANNED) {
      const abs = path.join(REPO, rel)
      if (!fs.existsSync(abs)) continue
      for (const span of bylineTemplates(fs.readFileSync(abs, 'utf8'))) {
        if (span.includes('@')) findings.push(`${rel}  ${span.slice(0, 90)}`)
      }
    }
    expect(findings).toEqual([])
  })
})
