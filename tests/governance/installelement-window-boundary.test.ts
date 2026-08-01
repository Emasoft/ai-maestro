/**
 * TRDD-YAGRX7W3 — the CLOSED-SET guard for InstallElement's R51 window boundary.
 *
 * WHY THIS EXISTS. `InstallElement` is the one pipeline whose transaction cannot cover the whole
 * function: five mutations happen before the window opens, and each is excluded DELIBERATELY
 * (see the boundary comment in the source for the per-mutation reasoning). The risk is not that
 * decision — it is that the decision is recorded only in a COMMENT. `MAX_HANDROLLED = 0` while
 * uncompensated mutations sit above the boundary would read as "complete" over exactly the
 * pipeline that isn't, and a sixth mutation added above the line would be invisible forever.
 *
 * So this test CLOSES the set: it asserts the mutations above the boundary are EXACTLY the
 * enumerated ones. Adding one REDS this test.
 *
 * ⚠ KEYED ON CALL SHAPE, NEVER ON LINE NUMBERS. This card's own citations drifted three times in
 * a single session — twice by ordinary edits, once by the very commit that moved a call. A guard
 * anchored to `:915` would have rotted the same day it was written. The boundary is located by a
 * MARKER STRING, and the mutations by CALLEE NAME through a TypeScript AST walk.
 *
 * ⚠ AND THE CALLEE NAME IS NOT THE IMPORTED NAME. The first version of this scanner matched the
 * identifier at the call site, so a RENAMING destructure hid the call completely:
 *
 *     const { rm: rmCache } = await import('fs/promises')
 *     await rmCache(cacheDir, { recursive: true, force: true })   // ← invisible to `'rm'`
 *
 * That is not hypothetical — it is live at `element-management-service.ts:1100/:1106`, and
 * `updateAgent` is aliased the same way twice more (`updateAgentAIO`, `updateAgentPG04`). The
 * card's "InstallElement calls NO rm anywhere" was measured with the same blind walk and is
 * RETRACTED. So the aliases are resolved back to the imported name below, and the positive
 * control asserts the alias form is seen — `rm` and `updateAgent` appear ONLY in aliased form in
 * this function, so those two assertions cannot pass unless the resolution works.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

const FILE = join(process.cwd(), 'services/element-management-service.ts')
const MARKER = 'R51 WINDOW BOUNDARY (TRDD-YAGRX7W3)'

/**
 * Every call shape that MUTATES state outside this process. Kept deliberately wider than the
 * mutations InstallElement actually performs: a needle that matches nothing is free, whereas a
 * mutation the scanner cannot see is reported as a closed set that was never measured.
 */
const MUTATION_NEEDLES = [
  'mkdir', 'rm', 'rmdir', 'unlink', 'writeFile', 'copyFile', 'cp', 'rename',
  // `updateJson` / `restoreRawSnapshot` joined `saveJsonSafe` when TRDD-RYFP030K migrated this
  // service's 21 settings writes. Adding them is not bookkeeping: without them the scanner could
  // not see a single settings write in the file it exists to scan, so "the mutations above the
  // boundary are EXACTLY this set" would have been measured against a needle list that no longer
  // matched the writer. A needle keyed on a verb NAME goes blind on the rename that replaces it —
  // extend this list in the SAME commit that introduces a new write primitive.
  'saveJsonSafe', 'updateJson', 'restoreRawSnapshot', 'execFileAsync', 'execAsync',
  'convertAndStorePlugin', 'emitForClient',
  'updateAgent', 'saveAgent', 'addAgent', 'removeAgent',
] as const

/**
 * THE CLOSED SET — the mutations that may appear above the boundary, by callee name.
 *
 * Six call sites, five logical mutations (G13's convert+emit pair is one operation, and its
 * retry is a re-attempt of the same emit). Changing ANY count here is a governance decision:
 * it means a mutation was added to, or removed from, the un-compensated region.
 */
const EXPECTED_ABOVE_BOUNDARY: Record<string, number> = {
  mkdir: 2,                    // G07 (agent dir) + EXE (local-scope .claude/)
  execFileAsync: 1,            // G11 marketplace add — cannot abort, and is SHARED state
  convertAndStorePlugin: 1,    // G13 — cannot abort; R20.26 overwrites in place
  emitForClient: 2,            // G13 emit + G13 retry-after-swallow
}

function parseInstallElement() {
  const text = readFileSync(FILE, 'utf-8')
  const src = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true)

  let fn: ts.FunctionDeclaration | null = null
  for (const s of src.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === 'InstallElement' && s.body) fn = s
  }
  if (!fn) throw new Error('InstallElement not found — the scanner cannot report a closed set it never measured')

  const markerIndex = text.indexOf(MARKER)
  return { text, src, fn, markerIndex }
}

/**
 * Local alias -> the name it was destructured FROM (`rmCache` -> `rm`).
 *
 * Only renaming elements carry a `propertyName`; a plain `const { mkdir } = …` has none and needs
 * no entry. Scoping is deliberately ignored: this is a needle resolver, not a type checker, and a
 * false MATCH merely over-reports a mutation (loud, and someone looks) while a false MISS is the
 * failure this whole file exists to prevent.
 */
function aliasMap(fn: ts.FunctionDeclaration): Map<string, string> {
  const aliases = new Map<string, string>()
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name)) {
      for (const el of n.name.elements) {
        if (el.propertyName && ts.isIdentifier(el.propertyName) && ts.isIdentifier(el.name)) {
          aliases.set(el.name.text, el.propertyName.text)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(fn.body!)
  return aliases
}

/** Collect every mutation call site inside `fn` that starts before `limit` (a character offset). */
function mutationsBefore(fn: ts.FunctionDeclaration, limit: number): Record<string, number> {
  const aliases = aliasMap(fn)
  const found: Record<string, number> = {}
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const e = n.expression
      // Both shapes: a direct call `mkdir(...)` and a member call `fs.mkdir(...)` / `adapter.install(...)`.
      const called = ts.isIdentifier(e)
        ? e.text
        : ts.isPropertyAccessExpression(e)
          ? e.name.text
          : null
      // Count under the IMPORTED name when the call site used an alias. Both spellings are
      // checked so an alias POINTING AT a needle (`rm` -> `rmCache`) and one NAMED like a needle
      // (`somethingElse` -> `mkdir`) are each caught; neither direction may fall through.
      const resolved = called ? aliases.get(called) : null
      const name = [resolved, called].find(
        (c): c is string => !!c && (MUTATION_NEEDLES as readonly string[]).includes(c),
      )
      if (name && n.getStart() < limit) {
        found[name] = (found[name] ?? 0) + 1
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(fn.body!)
  return found
}

describe('InstallElement — the R51 window boundary is a CLOSED SET (TRDD-YAGRX7W3)', () => {
  it('the boundary marker exists, inside InstallElement', () => {
    const { fn, markerIndex } = parseInstallElement()
    // Deleting the marker must not silently turn every assertion below into a vacuous pass.
    expect(markerIndex, `the "${MARKER}" marker is gone — the boundary is undefined`).toBeGreaterThan(-1)
    expect(markerIndex).toBeGreaterThan(fn.getStart())
    expect(markerIndex).toBeLessThan(fn.getEnd())
  })

  it('the mutations ABOVE the boundary are EXACTLY the enumerated set — a sixth kind reds this', () => {
    const { fn, markerIndex } = parseInstallElement()
    const above = mutationsBefore(fn, markerIndex)

    // toEqual, never toMatchObject: an ADDED mutation kind must fail, which a subset match allows.
    expect(above).toEqual(EXPECTED_ABOVE_BOUNDARY)
  })

  it('NO settings or registry write happens above the boundary — that is the semantic claim', () => {
    const { fn, markerIndex } = parseInstallElement()
    const above = mutationsBefore(fn, markerIndex)

    // NON-VACUITY GUARD, added because the N2 neuter caught this test passing over an EMPTY set:
    // with the marker deleted `markerIndex` is -1, nothing is "before" it, and a suite of
    // `toBeUndefined()` assertions all pass while measuring nothing. A condition written only
    // over the BAD items is satisfied by the absence of any items at all.
    expect(markerIndex, 'no boundary marker — the region below is unmeasured, not clean').toBeGreaterThan(-1)
    expect(Object.keys(above).length, 'the region above the boundary is EMPTY — the scanner measured nothing').toBeGreaterThan(0)

    // The window exists so that state which must AGREE WITH THE VERDICT is reversible. If a
    // settings/registry write ever lands above the line, that property is silently gone.
    // ⚠ EVERY WRITER THAT CAN REACH A SETTINGS FILE MUST BE NAMED HERE. `saveJsonSafe` alone made
    // this loop VACUOUS the day TRDD-RYFP030K migrated the service's 21 call sites: the needle
    // matched nothing, `undefined` is what the assertion wants, and the guard went on reporting
    // "clean" about a claim it could no longer evaluate. That is the same blind-detector failure
    // the write-boundary scanner hit from the other direction — a needle keyed on a verb NAME goes
    // silent on the rename that replaces it. `saveJsonSafe` stays so a regression to it is caught.
    for (const verdictState of ['saveJsonSafe', 'updateJson', 'restoreRawSnapshot', 'writeFile', 'updateAgent']) {
      expect(above[verdictState], `${verdictState} above the R51 boundary — it would survive a failed action`).toBeUndefined()
    }
  })

  it('POSITIVE CONTROL — the scanner really does see all three call shapes', () => {
    const { fn } = parseInstallElement()
    // Scanned over the WHOLE function, the needles must find each shape the source actually uses.
    // Without this, a scanner that silently matches nothing would report an empty, "clean" set.
    const all = mutationsBefore(fn, fn.getEnd())

    // direct-call shape, e.g. `await mkdir(...)`
    expect(all.mkdir, 'the scanner sees no direct calls at all — every assertion above is vacuous').toBeGreaterThan(0)
    // member-call shape, e.g. `await execFileAsync(...)` / `settings.save(...)`; updateJson and
    // execFileAsync both appear below the boundary, so a non-zero count here proves the walk
    // descends past the marker and into nested blocks (switch > case > try).
    //
    // WAS `saveJsonSafe` until TRDD-RYFP030K migrated it out of this file entirely. A positive
    // control has to name a shape the source ACTUALLY CONTAINS — the moment it names an absent one
    // it stops proving the walk works and starts proving only that the needle missed.
    expect(all.updateJson, 'the scanner never descends below the boundary — it is not measuring the function').toBeGreaterThan(0)

    // ALIASED shape — the blind spot that made the card claim InstallElement calls no `rm`.
    // NON-VACUOUS BY CONSTRUCTION: neither name is ever called unaliased in this function, so
    // these two assertions fail the moment alias resolution is removed. (Verified by neuter.)
    expect(all.rm, '`rm` is only ever called as `rmCache` here — the alias resolution is gone').toBeGreaterThan(0)
    expect(all.updateAgent, '`updateAgent` is only ever called as `updateAgentAIO`/`updateAgentPG04` — alias resolution is gone').toBeGreaterThan(0)
  })
})
