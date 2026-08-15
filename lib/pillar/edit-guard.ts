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
import path from 'path'
import type { PillarKind } from './kinds'
import type { PillarRecord } from './store'
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

/** 1-based line index of the frontmatter block's interior, or null when there is none. */
function frontmatterEnd(lines: readonly string[]): number | null {
  if (lines[0] !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return i + 1 // 1-based line number of the closing fence
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
  const declRe = kind.source.declarationRe
  const idFromMatch = kind.source.idFromMatch

  const declIdAt = (line: string | undefined): string | null => {
    if (line === undefined) return null
    const m = declRe.exec(line)
    return m ? idFromMatch(m as RegExpExecArray) : null
  }

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
          // G7 and S7 cannot coexist, and a number is never reused.
          const declLines: number[] = []
          for (let i = 0; i < nextLines.length; i++) {
            const id = declIdAt(nextLines[i])
            const p = id ? prrdParts(id) : null
            if (p && p.number === parts.number) declLines.push(i + 1)
          }
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
        if (nextId) {
          if (prevId && kind.normalizeId(prevId) !== kind.normalizeId(nextId)) {
            violations.push(
              `line ${lineNo}: clause ids are stable (${prevId} -> ${nextId}) — a rename dangles every ` +
                `citation of ${prevId}. Do renames as a deliberate corpus-wide change verified by ` +
                `\`yarn pillars:lint\`, not a line edit.`,
            )
          }
          // Uniqueness inside the resulting document…
          const inFile: number[] = []
          for (let i = 0; i < nextLines.length; i++) {
            const id = declIdAt(nextLines[i])
            if (id && kind.normalizeId(id) === kind.normalizeId(nextId)) inFile.push(i + 1)
          }
          if (inFile.length > 1) {
            violations.push(
              `line ${lineNo}: clause ${nextId} would be declared ${inFile.length} times in this document ` +
                `(lines ${inFile.join(', ')})`,
            )
          }
          // …and across the rest of the corpus (only for a NEW declaration — an
          // unchanged id IS the record the clash set already contains).
          if (!prevId || kind.normalizeId(prevId) !== kind.normalizeId(nextId)) {
            const clash = opts.corpusRecords.find(
              (r) =>
                path.resolve(r.filePath) !== path.resolve(opts.filePath) &&
                kind.normalizeId(r.id) === kind.normalizeId(nextId),
            )
            if (clash) {
              violations.push(
                `line ${lineNo}: clause ${nextId} is already declared in ` +
                  `${path.basename(clash.filePath)}:${clash.line ?? '-'}`,
              )
            }
          }
        } else if (prevId && SPEC_LOOSE_RE.test(next)) {
          violations.push(
            `line ${lineNo}: this line declared clause ${prevId}, and its replacement still opens with a ` +
              `backtick token but no longer parses as a clause declaration — a malformed id would make ` +
              `the clause silently vanish from the corpus.`,
          )
        }

        // `status:` legality — only inside the leading frontmatter block. The one
        // defect class this field actually has (the STATUS-HOLDS-COLUMN-VALUE
        // incident): a PIPELINE column value in a spec's status:. The field itself
        // is legitimate (`status: normative`) — never key a refusal on the NAME.
        const fmEnd = frontmatterEnd(nextLines)
        if (fmEnd !== null && lineNo > 1 && lineNo < fmEnd) {
          const m = /^status:\s*(.*)$/.exec(next)
          if (m) {
            const value = m[1].trim()
            if (!/^[a-z][a-z0-9-]*$/.test(value)) {
              violations.push(
                `line ${lineNo}: status: must be a bare kebab-case token, got ${JSON.stringify(value)}`,
              )
            } else if (isPipelineStateValue(value)) {
              violations.push(
                `line ${lineNo}: status: may not hold the pipeline value ${JSON.stringify(value)} — ` +
                  `pipeline state lives in a TRDD's column:, never in a spec's status:`,
              )
            }
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
