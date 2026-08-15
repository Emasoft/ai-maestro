/**
 * TRDD-2R34M8FA — validate-before-write gate for the PRRD and SPEC corpora.
 *
 * The TRDD pillar has had this since the 158-card column-corruption incident
 * (`lib/trdd-edit-guard.ts`, called by the `editTrdd` funnel). PRRD and SPEC had
 * NOTHING: `prrdgrep edit` happily wrote a malformed rule id, a duplicate number
 * across tiers, or a version regression — and because nothing lints those corpora
 * either (that half is TRDD-BL0W6LGY), a bad write was not merely undetected, it
 * was UNDETECTABLE. This gate refuses the write before it lands.
 *
 * It runs as `replaceAtLines`' `preWriteCheck`, INSIDE the document lock, on the
 * exact lines the write would persist — so what it validates is what lands, with
 * no read-outside-the-lock TOCTOU.
 *
 * ONE GRAMMAR SOURCE. "Is this line a declaration?" is answered by the kind's OWN
 * `source.declarationRe` from `lib/pillar/kinds.ts` — never by a second regex that
 * would drift (the linter/fixer-drift lesson). The guard adds only what the kinds
 * file does not carry: the near-miss shapes (a line that still LOOKS like a
 * declaration but no longer parses — the edit that makes a rule silently vanish),
 * and the id-part splitters for the checks below.
 *
 * WHAT IS DELIBERATELY ALLOWED: rewriting a declaration line into something that
 * does not resemble a declaration at all (plain prose, a blank). That is the
 * mechanical shape of a deliberate removal, and removal authority is a GOVERNANCE
 * question (MANAGER/USER per the PRRD rules), not a grammar one — this gate owns
 * grammar. The near-miss refusal draws the line between "typo'd the id" and
 * "meant to remove", which is the only line a machine can draw honestly.
 */
import fs from 'fs'
import path from 'path'
import type { PillarKind } from './kinds'
import { walkDocuments, walkRecords, type PillarRecord } from './store'
import { isPipelineStateValue } from '../trdd-vocabulary'

/** A refused pillar edit — the CLIs print it as `BLOCKED <tool>: …` and exit 2. */
export class GuardedEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardedEditError'
  }
}

/** `G7.4` → { letter, number, version }. Null when the id is not letter+number.version. */
function prrdParts(id: string): { letter: string; number: number; version: number } | null {
  const m = /^([GS])(\d+)\.(\d+)$/.exec(id)
  if (!m) return null
  return { letter: m[1], number: Number(m[2]), version: Number(m[3]) }
}

/** A bullet opening with a bold token — the shape that INTENDS to declare a PRRD rule. */
const PRRD_LOOSE_RE = /^\s*-\s+\*\*\S/
/** A line opening with a short backtick token — the shape that INTENDS to declare a clause. */
const SPEC_LOOSE_RE = /^`[^`]{1,32}`/

/**
 * The STATIC near-miss shapes, for the lint (which has no `prev` line to compare
 * against): narrower than the guard's prev-aware LOOSE shapes on purpose, because a
 * corpus legitimately holds bold-token bullets and backtick tokens that never meant
 * to declare anything (`- **Note** — …`, `` `yarn build` ``). What discriminates a
 * botched declaration from ordinary prose is a DIGIT inside the token — every rule
 * and clause id carries one, and `- **Note**` / `` `yarn build` `` carry none.
 */
const PRRD_NEAR_MISS_STATIC_RE = /^\s*-\s+\*\*[^*\n]*\d[^*\n]*\*\*/
const SPEC_NEAR_MISS_STATIC_RE = /^`[A-Za-z0-9]{1,6}-[^`\n]*\d[^`\n]*`/

/** 1-based line index of the frontmatter block's interior, or null when there is none. */
function frontmatterEnd(lines: readonly string[]): number | null {
  if (lines[0] !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return i + 1 // 1-based line number of the closing fence
  }
  return null
}

/** Builds "does this line declare, and what id" for a per-line kind — the ONE grammar source. */
function declIdReader(kind: PillarKind): (line: string | undefined) => string | null {
  if (kind.source.mode !== 'per-line') return () => null
  const { declarationRe, idFromMatch } = kind.source
  return (line) => {
    if (line === undefined) return null
    const m = declarationRe.exec(line)
    return m ? idFromMatch(m as RegExpExecArray) : null
  }
}

/** PRRD rule NUMBER → the 1-based lines declaring it (both tiers — G7 and S7 collide). */
function prrdNumberLines(kind: PillarKind, lines: readonly string[]): Map<number, number[]> {
  const declIdAt = declIdReader(kind)
  const byNumber = new Map<number, number[]>()
  for (let i = 0; i < lines.length; i++) {
    const id = declIdAt(lines[i])
    const p = id ? prrdParts(id) : null
    if (!p) continue
    const list = byNumber.get(p.number) ?? []
    list.push(i + 1)
    byNumber.set(p.number, list)
  }
  return byNumber
}

/**
 * SPEC normalized clause id → every 1-based line matching the declaration grammar in
 * THIS document, each flagged with whether it carries the PREFERRED (bold-named)
 * declaration form. A non-preferred extra line is a line-leading CITATION, which is
 * legal prose (TRDD-IG1MMYFA) — the dup rules below key on the flags, not the count.
 */
function specIdLines(
  kind: PillarKind,
  lines: readonly string[],
): Map<string, { line: number; preferred: boolean }[]> {
  const declIdAt = declIdReader(kind)
  const prefer = kind.source.mode === 'per-line' ? kind.source.preferDeclaration : undefined
  const byId = new Map<string, { line: number; preferred: boolean }[]>()
  for (let i = 0; i < lines.length; i++) {
    const id = declIdAt(lines[i])
    if (!id) continue
    const key = kind.normalizeId(id)
    const list = byId.get(key) ?? []
    list.push({ line: i + 1, preferred: prefer ? prefer.test(lines[i]) : false })
    byId.set(key, list)
  }
  return byId
}

/** The picked DECLARATION line for one id's matches: first preferred, else first — the
 * exact rule `recordsOf` applies, restated here so gate, lint and store agree. */
function pickedLine(matches: readonly { line: number; preferred: boolean }[]): number | null {
  if (!matches.length) return null
  return (matches.find((m) => m.preferred) ?? matches[0]).line
}

/** The duplicate-declaration verdict for one id's matches — shared by gate and lint.
 * >1 preferred = two real declarations; 0 preferred with >1 matches = ambiguous (nothing
 * marks which line is THE declaration); one preferred + citations = legal. */
function specDupOffenders(
  matches: readonly { line: number; preferred: boolean }[],
): { offenders: number[]; reason: 'duplicate' | 'ambiguous' } | null {
  const preferred = matches.filter((m) => m.preferred)
  if (preferred.length > 1) {
    return { offenders: preferred.slice(1).map((m) => m.line), reason: 'duplicate' }
  }
  if (preferred.length === 0 && matches.length > 1) {
    return { offenders: matches.slice(1).map((m) => m.line), reason: 'ambiguous' }
  }
  return null
}

/** The one legality rule `status:` actually has — null means legal. */
function statusTokenViolation(value: string): string | null {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    return `status: must be a bare kebab-case token, got ${JSON.stringify(value)}`
  }
  if (isPipelineStateValue(value)) {
    return (
      `status: may not hold the pipeline value ${JSON.stringify(value)} — pipeline state lives ` +
      `in a TRDD's column:, never in a spec's status:`
    )
  }
  return null
}

export interface PillarGuardOpts {
  /** The document being edited (records of OTHER documents are the clash set). */
  filePath: string
  /** The whole corpus, for cross-document uniqueness (SPEC clause ids). */
  corpusRecords: readonly PillarRecord[]
}

/**
 * Build the pre-write check for one edit of one document. Per-document pillars
 * (TRDD) return a no-op: their funnel is `editTrdd`, which has its own gate.
 */
export function pillarPreWriteCheck(
  kind: PillarKind,
  opts: PillarGuardOpts,
): (ctx: {
  prevLines: readonly string[]
  nextLines: readonly string[]
  changedLines: readonly number[]
}) => void {
  if (kind.source.mode !== 'per-line') return () => {}
  const declIdAt = declIdReader(kind)

  return ({ prevLines, nextLines, changedLines }) => {
    const violations: string[] = []

    for (const lineNo of changedLines) {
      const prev = prevLines[lineNo - 1]
      const next = nextLines[lineNo - 1]
      const prevId = declIdAt(prev)
      const nextId = declIdAt(next)

      if (kind.name === 'prrd') {
        if (nextId) {
          const parts = prrdParts(nextId)
          if (!parts) {
            // Unreachable while declarationRe and prrdParts agree; refuse rather
            // than silently pass if they ever drift.
            violations.push(`line ${lineNo}: rule id ${JSON.stringify(nextId)} does not parse as [GS]<n>.<v>`)
            continue
          }
          // Number uniqueness ACROSS BOTH TIERS, over the whole resulting file —
          // G7 and S7 cannot coexist, and a number is never reused. Shared finder
          // (the lint runs the same one), so gate and lint cannot disagree.
          const declLines = prrdNumberLines(kind, nextLines).get(parts.number) ?? []
          if (declLines.length > 1) {
            violations.push(
              `line ${lineNo}: rule number ${parts.number} would be declared ${declLines.length} times ` +
                `(lines ${declLines.join(', ')}) — numbers are globally unique across G and S`,
            )
          }
          if (prevId) {
            const prevParts = prrdParts(prevId)
            if (prevParts) {
              if (prevParts.number !== parts.number) {
                violations.push(
                  `line ${lineNo}: the rule NUMBER is immutable (${prevId} -> ${nextId}) — numbers are ` +
                    `never rewritten or reused; add a new rule and retire the old one instead`,
                )
              } else if (parts.version < prevParts.version) {
                violations.push(
                  `line ${lineNo}: the version moves forward only (${prevId} -> ${nextId})`,
                )
              }
            }
          }
        } else if (prevId && PRRD_LOOSE_RE.test(next)) {
          violations.push(
            `line ${lineNo}: this line declared rule ${prevId}, and its replacement still looks like a ` +
              `rule bullet but no longer parses as \`- **[GS]<n>.<v>** — …\` — a malformed id would make ` +
              `the rule silently vanish from the corpus. Fix the id, or rewrite the line to plain prose ` +
              `if the removal is deliberate.`,
          )
        }
      }

      if (kind.name === 'spec') {
        // Declaration-vs-citation scoping (TRDD-IG1MMYFA): a line-leading citation
        // matches the grammar exactly like the declaration does, so every refusal
        // below binds only the line the store's pick would treat as THE declaration —
        // editing citation prose is ordinary editing.
        const nextById = specIdLines(kind, nextLines)
        const prevById = specIdLines(kind, prevLines)
        if (nextId) {
          const key = kind.normalizeId(nextId)
          const isDeclNext = pickedLine(nextById.get(key) ?? []) === lineNo
          if (prevId && kind.normalizeId(prevId) !== key) {
            const wasDecl = pickedLine(prevById.get(kind.normalizeId(prevId)) ?? []) === lineNo
            if (wasDecl) {
              violations.push(
                `line ${lineNo}: clause ids are stable (${prevId} -> ${nextId}) — a rename dangles every ` +
                  `citation of ${prevId}. Do renames as a deliberate corpus-wide change verified by ` +
                  `\`yarn pillars:lint\`, not a line edit.`,
              )
            }
          }
          const dup = specDupOffenders(nextById.get(key) ?? [])
          if (dup && (isDeclNext || dup.offenders.includes(lineNo))) {
            violations.push(
              dup.reason === 'duplicate'
                ? `line ${lineNo}: clause ${nextId} would carry TWO bold-named declarations in this ` +
                    `document (offending line(s): ${dup.offenders.join(', ')}) — already declared at ` +
                    `line ${pickedLine(nextById.get(key) ?? [])}`
                : `line ${lineNo}: clause ${nextId} would match the declaration grammar on multiple ` +
                    `lines with NONE carrying the bold-named form — ambiguous which is the declaration ` +
                    `(lines ${(nextById.get(key) ?? []).map((m) => m.line).join(', ')})`,
            )
          }
          // Cross-file: only a DECLARATION may not collide, and only when this edit
          // introduces the id (an unchanged id IS the clash set's own record).
          if (isDeclNext && (!prevId || kind.normalizeId(prevId) !== key)) {
            const clash = opts.corpusRecords.find(
              (r) =>
                path.resolve(r.filePath) !== path.resolve(opts.filePath) &&
                kind.normalizeId(r.id) === key,
            )
            if (clash) {
              violations.push(
                `line ${lineNo}: clause ${nextId} is already declared in ` +
                  `${path.basename(clash.filePath)}:${clash.line ?? '-'}`,
              )
            }
          }
        } else if (prevId && SPEC_LOOSE_RE.test(next)) {
          const wasDecl = pickedLine(prevById.get(kind.normalizeId(prevId)) ?? []) === lineNo
          if (wasDecl) {
            violations.push(
              `line ${lineNo}: this line declared clause ${prevId}, and its replacement still opens with a ` +
                `backtick token but no longer parses as a clause declaration — a malformed id would make ` +
                `the clause silently vanish from the corpus.`,
            )
          }
        }

        // `status:` legality — only inside the leading frontmatter block. The one
        // defect class this field actually has (the STATUS-HOLDS-COLUMN-VALUE
        // incident): a PIPELINE column value in a spec's status:. The field itself
        // is legitimate (`status: normative`) — never key a refusal on the NAME.
        const fmEnd = frontmatterEnd(nextLines)
        if (fmEnd !== null && lineNo > 1 && lineNo < fmEnd) {
          const m = /^status:\s*(.*)$/.exec(next)
          if (m) {
            const bad = statusTokenViolation(m[1].trim())
            if (bad) violations.push(`line ${lineNo}: ${bad}`)
          }
        }
      }
    }

    if (violations.length) {
      throw new GuardedEditError(
        `illegal ${kind.label} edit — refused before writing:\n  ` + violations.join('\n  '),
      )
    }
  }
}

// ── The LINT half (TRDD-BL0W6LGY) — the same predicates, corpus-at-rest ──────────
//
// The write gate above judges an EDIT (prev vs next), so three of its rules have no
// static counterpart (immutable numbers, forward-only versions, stable clause ids —
// all comparisons against a `prev` a resting corpus does not have). Everything that
// CAN be judged at rest is judged here, through the SAME finders the gate calls —
// one predicate set, two call sites, so the checker and the gate cannot drift into
// the fixer-vs-linter asymmetry (a repair the report never mentioned).

export interface PillarLintFinding {
  filePath: string
  /** 1-based; 1 for document-level findings (an unparseable frontmatter). */
  line: number
  message: string
}

/** Static findings for ONE document's raw lines. */
export function lintPillarLines(
  kind: PillarKind,
  lines: readonly string[],
  opts: PillarGuardOpts,
): PillarLintFinding[] {
  if (kind.source.mode !== 'per-line') return []
  const declIdAt = declIdReader(kind)
  const findings: PillarLintFinding[] = []
  const at = (line: number, message: string) => findings.push({ filePath: opts.filePath, line, message })

  if (kind.name === 'prrd') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!declIdAt(line) && PRRD_NEAR_MISS_STATIC_RE.test(line)) {
        at(i + 1, `malformed rule declaration — a digit-bearing bold bullet that does not parse as \`- **[GS]<n>.<v>** — …\``)
      }
    }
    for (const [number, declLines] of prrdNumberLines(kind, lines)) {
      for (const dup of declLines.slice(1)) {
        at(dup, `rule number ${number} already declared at line ${declLines[0]} — numbers are globally unique across G and S`)
      }
    }
  }

  if (kind.name === 'spec') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!declIdAt(line) && SPEC_NEAR_MISS_STATIC_RE.test(line)) {
        at(i + 1, `malformed clause declaration — a backtick token shaped like a clause id that does not parse as one`)
      }
    }
    const byId = specIdLines(kind, lines)
    for (const [id, matches] of byId) {
      // One preferred declaration + line-leading citations is LEGAL (the pick rule);
      // two bold-named declarations, or several matches with none bold, are not.
      const dup = specDupOffenders(matches)
      if (dup) {
        for (const offender of dup.offenders) {
          at(
            offender,
            dup.reason === 'duplicate'
              ? `clause ${id} already declared at line ${pickedLine(matches)}`
              : `clause ${id} matches the declaration grammar on multiple lines with none carrying ` +
                  `the bold-named form — ambiguous which is the declaration (first at line ${matches[0].line})`,
          )
        }
      }
      const clash = opts.corpusRecords.find(
        (r) =>
          path.resolve(r.filePath) !== path.resolve(opts.filePath) &&
          kind.normalizeId(r.id) === id,
      )
      if (clash) {
        at(pickedLine(matches)!, `clause ${id} is also declared in ${path.basename(clash.filePath)}:${clash.line ?? '-'}`)
      }
    }
    const fmEnd = frontmatterEnd(lines)
    if (fmEnd !== null) {
      for (let i = 1; i < fmEnd - 1; i++) {
        const m = /^status:\s*(.*)$/.exec(lines[i])
        if (!m) continue
        const bad = statusTokenViolation(m[1].trim())
        if (bad) at(i + 1, bad)
      }
    }
  }

  return findings
}

export interface PillarLintResult {
  documents: number
  records: number
  findings: PillarLintFinding[]
}

/**
 * Lint the whole corpus of one per-line pillar. The CLI's `lint`/`validate` verb is
 * a thin printer over this. Non-vacuity is the CALLER's contract to enforce
 * (`documents === 0` must exit 2, never read as clean) — the count is returned so
 * the tool cannot certify an empty read as a clean corpus.
 */
export function lintPillarCorpus(root: string, kind: PillarKind): PillarLintResult {
  const corpusRecords = [...walkRecords(root, kind)]
  const findings: PillarLintFinding[] = []
  let documents = 0
  for (const doc of walkDocuments(root, kind)) {
    documents++
    if (doc.parseError) {
      findings.push({ filePath: doc.filePath, line: 1, message: `frontmatter does not parse: ${doc.parseError}` })
    }
    // Raw lines, not the parsed body: the guard judges raw lines too, and the
    // status: check needs real file line numbers inside the frontmatter block.
    const raw = fs.readFileSync(doc.filePath, 'utf-8')
    findings.push(...lintPillarLines(kind, raw.split('\n'), { filePath: doc.filePath, corpusRecords }))
  }
  return { documents, records: corpusRecords.length, findings }
}
