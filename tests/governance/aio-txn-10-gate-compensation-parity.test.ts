/**
 * AIO-TXN-10 — the PARITY guard: zero uncompensated mutating gates, across every pipeline.
 *
 * WHY THIS EXISTS, AND WHY ONLY NOW. `TRDD-DQ6XN2VP` carried this box for weeks marked
 * *"unreachable until all 19 are retrofitted, since the runtime pre-flight only sees pipelines
 * that use the runner"*. `TRDD-YAGRX7W3` retrofitted the last one (`InstallElement`,
 * `MAX_HANDROLLED` → 0), so the box became reachable and this is it.
 *
 * WHAT IT ADDS OVER THE RUNTIME CHECK. `findUncompensatedGates` (lib/gate-transaction.ts) already
 * REFUSES to start a sequence containing a mutating gate with no `undo` — but only when that
 * pipeline actually RUNS. A pipeline no test drives, or a branch no fixture reaches, ships its
 * violation to a user's machine and discovers it there, at the worst possible moment: mid-mutation.
 * This asserts the same property statically, at author time, over every gate in the file.
 *
 * It is the SIBLING of `aio-txn-10-runner-coverage.test.ts`, and the two ask different questions:
 * that one asks *"is this pipeline under the runner"*, this one asks *"are its gates compensated"*.
 * Neither implies the other — a pipeline can route through the runner and still declare a mutating
 * gate with no `undo` (it would then fail at RUNTIME, which is exactly what this moves forward).
 *
 * ⚠ AN ARGUMENT THIS WALK CANNOT RESOLVE IS A FAILURE, NEVER A SKIP. A gate list passed as
 * something other than an array literal or a `const` array, or an element that is not an object
 * literal, would silently shrink the measured set — the "closed set it never measured" failure this
 * repo has now paid for twice (a brace-counter that mis-bound a function at 12 lines; a scanner
 * blind to `const { rm: rmCache }`). So unresolved shapes are collected and asserted EMPTY.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

const SERVICE = join(process.cwd(), 'services', 'element-management-service.ts')

/** The runner whose first argument is a flat gate array. */
const ARRAY_RUNNER = 'runGateSequence'

/**
 * The three-phase runner (R51.8). Its first argument is `{ pre, exe, post }`, NOT an array — a
 * different shape this walk does not know how to read. No call site uses it today, so rather than
 * ship an unexercised branch that nothing can verify, the count is asserted to be zero and the
 * failure message tells the next author what to teach the resolver. Silence would be the bug.
 */
const AIO_RUNNER = 'runAioPipeline'

interface GateRef {
  pipeline: string
  id: string
  /** readOnly:true, or an `undo` — the exact disjunction `findUncompensatedGates` applies. */
  compensated: boolean
}

interface Scan {
  gates: GateRef[]
  /** Shapes the walk could not read. MUST be empty: an unread shape is an unmeasured one. */
  unresolved: string[]
  arrayRunnerCalls: number
  aioRunnerCalls: number
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text
  return null
}

/** Every top-level declaration with a body, so a gate can be attributed to the pipeline it is in. */
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

/** `const deleteGates = [...]` declared anywhere inside `scope`. */
function findArrayConst(scope: ts.Node, name: string): ts.ArrayLiteralExpression | null {
  let found: ts.ArrayLiteralExpression | null = null
  const visit = (n: ts.Node): void => {
    if (
      !found &&
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    ) {
      found = n.initializer
    }
    ts.forEachChild(n, visit)
  }
  visit(scope)
  return found
}

/** The compensation rule, read off the object literal exactly as the runtime pre-flight reads it. */
function readGate(obj: ts.ObjectLiteralExpression, pipeline: string): GateRef {
  let id = '(anonymous)'
  let hasUndo = false
  let readOnly = false
  for (const p of obj.properties) {
    // `undo: async () => {}`, the shorthand `{ undo }`, and the method form `undo() {}` are three
    // spellings of the same property. Missing one would report a compensated gate as naked.
    const key =
      (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isShorthandPropertyAssignment(p)) &&
      ts.isIdentifier(p.name)
        ? p.name.text
        : null
    if (!key) continue
    if (key === 'undo') hasUndo = true
    if (key === 'id' && ts.isPropertyAssignment(p)) {
      const t = literalText(p.initializer)
      if (t) id = t
    }
    // Only a literal `true` counts. A computed `readOnly: someFlag` is not a proof of read-only,
    // so it falls through to "needs an undo" — the conservative direction.
    if (key === 'readOnly' && ts.isPropertyAssignment(p)) {
      readOnly = p.initializer.kind === ts.SyntaxKind.TrueKeyword
    }
  }
  return { pipeline, id, compensated: readOnly || hasUndo }
}

function scan(): Scan {
  const text = readFileSync(SERVICE, 'utf-8')
  const src = ts.createSourceFile(SERVICE, text, ts.ScriptTarget.Latest, true)

  const gates: GateRef[] = []
  const unresolved: string[] = []
  let arrayRunnerCalls = 0
  let aioRunnerCalls = 0

  for (const fn of topLevelFunctions(src)) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text
        if (callee === AIO_RUNNER) aioRunnerCalls++
        if (callee === ARRAY_RUNNER) {
          arrayRunnerCalls++
          const arg = node.arguments[0]
          let list: ts.ArrayLiteralExpression | null = null
          if (arg && ts.isArrayLiteralExpression(arg)) list = arg
          else if (arg && ts.isIdentifier(arg)) list = findArrayConst(fn.body, arg.text)

          if (!list) {
            unresolved.push(`${fn.name}: first argument is neither an array literal nor a resolvable const array`)
          } else {
            for (const el of list.elements) {
              if (ts.isObjectLiteralExpression(el)) gates.push(readGate(el, fn.name))
              else unresolved.push(`${fn.name}: gate-list element is not an object literal (${ts.SyntaxKind[el.kind]})`)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(fn.body)
  }

  return { gates, unresolved, arrayRunnerCalls, aioRunnerCalls }
}

describe('AIO-TXN-10 — every gate declares a compensation (the parity guard)', () => {
  const s = scan()

  it('reads every gate list it finds — an unresolved shape is a set that was never measured', () => {
    expect(s.unresolved, s.unresolved.join('\n')).toEqual([])
  })

  it(`does not silently skip ${AIO_RUNNER}, whose first argument is not an array`, () => {
    expect(
      s.aioRunnerCalls,
      `${AIO_RUNNER} is now used, and this walk only knows how to read ${ARRAY_RUNNER}'s flat gate ` +
        `array. Teach the resolver its { pre, exe, post } shape — remembering that the exe step is ` +
        `wrapped WITHOUT readOnly, so it needs an \`undo\` like any other mutating gate — then ` +
        `raise this expectation. Skipping it would report a parity that was never checked.`,
    ).toBe(0)
  })

  /**
   * NON-VACUITY. Every assertion here is "no gate is X", which is satisfied perfectly by finding no
   * gates at all — the shape that made a checklist gate inert on 87 of 108 cards. Floors measured
   * 2026-07-31: 20 call sites over 19 pipelines (ChangeTeam runs two sequences), 61 gate objects.
   */
  it('discovers the gate inventory (guards against a silently empty parse)', () => {
    expect(
      s.arrayRunnerCalls,
      `only ${s.arrayRunnerCalls} ${ARRAY_RUNNER} call sites found — the AST walk has drifted`,
    ).toBeGreaterThanOrEqual(19)
    expect(
      s.gates.length,
      `only ${s.gates.length} gates discovered — the walk or the gate shape has drifted, so the ` +
        `parity assertion below would be measuring almost nothing`,
    ).toBeGreaterThanOrEqual(55)
  })

  it('has ZERO mutating gates without an undo — the property findUncompensatedGates enforces at runtime', () => {
    const naked = s.gates.filter(g => !g.compensated)
    expect(
      naked.map(g => `${g.pipeline}:${g.id}`),
      `a mutating gate with no \`undo\` and no \`readOnly: true\` cannot satisfy R51. The runner ` +
        `REFUSES to start such a sequence, so this is not a style point — it is a pipeline that ` +
        `will fail at PRECHECK the first time it runs, for a caller who is mid-operation.`,
    ).toEqual([])
  })
})
