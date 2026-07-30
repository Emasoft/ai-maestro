/**
 * AIO-TXN-10 — "use-the-runner" coverage ratchet.
 *
 * The spec clause (`design/specs/all-in-one-spec.md`) says a pipeline MUST use
 * `lib/gate-transaction.ts`, because a hand-rolled compensation loop is a second
 * implementation of the transaction semantics. Its Guard column is `—`: nothing enforced
 * it, so the clause was DOC-ONLY and the retrofit's progress ("21 pipelines still
 * hand-roll") was a number measured by hand, once, which goes stale the moment anyone
 * touches the 8.6k-line service.
 *
 * This is the ratchet that makes the remaining work finite and non-regressing — the same
 * shape as MAX_ENFORCED_WITHOUT_TEST in the enforcement-map ratchet. It answers two
 * questions a grep cannot:
 *
 *   1. WHICH functions are pipelines at all — discovered from the code, never listed, so
 *      a pipeline added tomorrow is in scope without anyone remembering to add it.
 *   2. WHICH of them route through the runner.
 *
 * It parses the AST rather than the text, for reasons this repo has already paid for:
 *   - `awk '/^func/,/^}/'` and end-at-next-export both mis-bound a function; the second
 *     would attribute the non-exported `changeSimpleElement`'s runner call to whatever
 *     exported function happens to sit above it.
 *   - a text needle for a gate label counts the JSDoc gate manifests in this file's
 *     comments (764 "gates" by text vs 492 real emissions). The AST sees call arguments
 *     only, so comments are excluded by construction rather than by a filter.
 *
 * A DELEGATOR is correctly invisible: `ChangeAgentDef` is eight lines that call
 * `changeSimpleElement`, emits no gate ops of its own, and is therefore not a pipeline —
 * `changeSimpleElement` is, and it uses the runner.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

const SERVICE = join(process.cwd(), 'services', 'element-management-service.ts')

/**
 * The two entry points of `lib/gate-transaction.ts` that make a pipeline transactional.
 *
 * KNOWN LIMIT, found by neutering this check rather than by reasoning about it: the match
 * is on the CALLEE IDENTIFIER, so aliasing the import
 * (`const { runGateSequence: seq } = await import(...)`) makes a transactional pipeline
 * read as hand-rolled. That direction is the safe one — the ratchet REDDENS and someone
 * looks — but it is a false positive, not a false negative, and it is worth knowing before
 * anyone spends an hour re-retrofitting a pipeline that was already fine.
 */
const RUNNERS = new Set(['runGateSequence', 'runAioPipeline'])

/**
 * A gate op as a HAND-ROLLED pipeline emits it: `ops.push(\`G07: …\`)`. Under the runner
 * the same gate is `{ id: 'G07', … }` (no colon) — deliberately NOT matched here, because
 * those functions are already discovered by their runner call. The two discovery paths are
 * complementary, so neither has to be complete on its own.
 */
const GATE_OP = /^(G\d+[a-z]?|G\d+-[A-Z]+|PG\d+|EXE|PRE|POST)\b.*:/

interface PipelineInfo {
  name: string
  usesRunner: boolean
  gateOps: number
}

/**
 * A pipeline OWNS its ops array (`const ops: string[] = []`); a shared gate HELPER
 * receives one (`gate0Auth(action, id, authContext, ops)`) and pushes into its caller's.
 * Without this the helper is indistinguishable from a pipeline by gate ops alone — it
 * emits a real `G00:` line — and would sit in the hand-rolled list forever as a violation
 * that cannot be fixed, because there is nothing there to wrap in a transaction.
 *
 * Measured: this discriminator drops `gate0Auth` and nothing else.
 */
const OWNS_OPS = /^(ops|operations)$/

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text
  return null
}

/** Every top-level declaration that has a body we can attribute code to. */
function topLevelFunctions(src: ts.SourceFile): { name: string; body: ts.Node }[] {
  const out: { name: string; body: ts.Node }[] = []
  for (const stmt of src.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      out.push({ name: stmt.name.text, body: stmt.body })
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          out.push({ name: d.name.text, body: d.initializer.body })
        }
      }
    }
  }
  return out
}

function analyze(): PipelineInfo[] {
  const text = readFileSync(SERVICE, 'utf-8')
  const src = ts.createSourceFile(SERVICE, text, ts.ScriptTarget.Latest, true)

  const found: PipelineInfo[] = []
  for (const fn of topLevelFunctions(src)) {
    let usesRunner = false
    let gateOps = 0
    let ownsOps = false

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        // `runGateSequence(...)` and the destructured-import form both surface here as a
        // call whose expression is the bare identifier.
        const callee = node.expression
        if (ts.isIdentifier(callee) && RUNNERS.has(callee.text)) usesRunner = true
        for (const arg of node.arguments) {
          const t = literalText(arg)
          if (t && GATE_OP.test(t)) gateOps++
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        OWNS_OPS.test(node.name.text) &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        ownsOps = true
      }
      ts.forEachChild(node, visit)
    }
    visit(fn.body)

    if (usesRunner || (gateOps > 0 && ownsOps)) found.push({ name: fn.name, usesRunner, gateOps })
  }
  return found
}

/**
 * THE RATCHET. Lower it as pipelines are retrofitted; it must never rise. A new
 * hand-rolled pipeline reddens this immediately, which is the whole point — AIO-TXN-10
 * previously had no way to notice one.
 *
 * 12, MEASURED — and it corrects the card that drove this work. TRDD-DQ6XN2VP says "26
 * pipelines" and its STATE block said 19 still hand-roll; both were hand counts of a NAME
 * LIST, and that list contains 7 thin delegators that are not pipelines at all
 * (`CreateMarketplace`/`Delete`/`UpdateMarketplace` forward one line to `ChangeMarketplace`;
 * `ChangeAgentDef`/`Command`/`Rule`/`OutputStyle` forward one line to
 * `changeSimpleElement`) while omitting `changeSimpleElement` itself, which IS one and is
 * already transactional. Real inventory when this landed: 19 pipelines, 5 transactional,
 * 14 to go — then 6 and 13 with `CreateAgent`, now 7 and 12 with `ChangeTeam`.
 *
 * NOTE FOR WHOEVER LOWERS IT NEXT: the count is a conformance measure, NOT a safety measure,
 * and the two diverge. Several of the remaining 12 have exactly ONE mutating gate with nothing
 * abortable after it — `ChangeAvatar` (G03), `ChangeName` (G04), `ChangeFolder` (G05) — so they
 * have no partial-state window at all and retrofitting them moves this number while buying zero
 * safety. Pick the next target by whether it can leave two stores disagreeing, not by gate count.
 */
const MAX_HANDROLLED = 12

/** Floor, so the check cannot pass by discovering nothing (the vacuous-green shape). */
const MIN_TRANSACTIONAL = 7

/**
 * The pipelines already under the runner, pinned BY NAME. A count alone cannot see an
 * un-retrofit that is masked by a retrofit elsewhere: the total would be unchanged and
 * both assertions would stay green while a compensated pipeline quietly went back to
 * hand-rolling. Membership, not equality — retrofitting a new one must not red this.
 */
const MUST_BE_TRANSACTIONAL = [
  'CreateAgent',
  'ChangeTeam',
  'DeleteAgent',
  'ChangeClient',
  'ChangePlugin',
  'ChangeSkill',
  'changeSimpleElement',
]

describe('AIO-TXN-10 — every pipeline routes through lib/gate-transaction.ts', () => {
  const pipelines = analyze()
  const transactional = pipelines.filter(p => p.usesRunner)
  const handRolled = pipelines.filter(p => !p.usesRunner)

  /**
   * NON-VACUITY. If the parser silently found nothing — a moved file, a changed emission
   * shape, a broken walk — every assertion below would pass over an empty set. The card
   * measured ~26 pipelines by hand, so anything under 20 means the instrument broke, not
   * that the service shrank.
   */
  it('discovers the pipeline inventory (guards against a silently empty parse)', () => {
    expect(
      pipelines.length,
      `only ${pipelines.length} pipelines discovered in ${SERVICE} — the AST walk or the ` +
        `gate-op shape has drifted, so the ratchet below would be measuring nothing.\n` +
        `Discovered: ${pipelines.map(p => p.name).sort().join(', ') || '(none)'}`,
    ).toBeGreaterThanOrEqual(19)
  })

  it('keeps the transactional set from regressing', () => {
    expect(
      transactional.length,
      `transactional pipelines: ${transactional.map(p => p.name).join(', ') || '(none)'}`,
    ).toBeGreaterThanOrEqual(MIN_TRANSACTIONAL)
  })

  it(`has at most ${MAX_HANDROLLED} pipelines still hand-rolling their gates`, () => {
    // Named in full rather than counted: a bare number tells the next session how much is
    // left but not what to pick up, and a silently truncated list reads as "covered".
    const names = handRolled.map(p => `${p.name} (${p.gateOps} gate ops)`).sort()
    expect(
      handRolled.length,
      `AIO-TXN-10 violated by ${handRolled.length} pipelines (ratchet allows ${MAX_HANDROLLED}).\n` +
        `Still hand-rolled:\n  ${names.join('\n  ')}\n` +
        `If you retrofitted one, LOWER MAX_HANDROLLED — it is a ratchet, it never rises.`,
    ).toBeLessThanOrEqual(MAX_HANDROLLED)
  })

  it('keeps every already-retrofitted pipeline transactional, by name', () => {
    const names = new Set(transactional.map(p => p.name))
    for (const required of MUST_BE_TRANSACTIONAL) {
      expect(
        names.has(required),
        `${required} no longer routes through lib/gate-transaction.ts — its compensation ` +
          `is gone. Transactional now: ${[...names].sort().join(', ')}`,
      ).toBe(true)
    }
  })
})
