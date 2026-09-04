import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { stripComments } from '../helpers/strip-comments'
// Comments are stripped by the shared context-aware tokenizer (tests/helpers/strip-comments.ts,
// TRDD-ENFCF8O7). The block-first regex pair this file used to carry went blind over any region
// between a `/**` inside a line comment and the next block-close — 43% of headless-router.ts.

/**
 * TRDD-FRRJ80YQ — every PRODUCTION call to wakeAgent/hibernateAgent passes an authContext.
 *
 * HISTORY, because this guard's reason changed and a guard whose stated reason is stale is
 * worse than no guard. Until 2026-09-04 `WakeAgentParams.authContext` and
 * `HibernateAgentParams.authContext` were declared `?:` and BOTH functions gated authorization
 * on the field being PRESENT:
 *
 *     // When authContext is provided (route call), check caller permissions.
 *     // When absent (internal call), skip — backward compatible.   ← DELETED 2026-08-29
 *     if (authContext) { if (!authContext.isSystemOwner) { … authorize(…) } }
 *
 * So omitting the field SKIPPED the gate and the call SUCCEEDED unauthorized — the exact bypass
 * `element-management-service.ts` abolished, and that file records why in `gate0Auth`'s own
 * comment: *"Previously, a missing authContext was silently treated as 'authorized' which
 * allowed any route that forgot to pass it to bypass all security checks."*
 *
 * THAT IS NOW CLOSED AT THE SOURCE. Both fields are REQUIRED, both Gate 0s are unconditional,
 * and omission returns a 401 refusal — pinned behaviourally by two cases in
 * `tests/services/agents-core-service.test.ts` ("refuses a wake/hibernate whose caller passed
 * NO authContext"), each proven by its own neuter. The 32 test call sites the earlier estimate
 * flagged as the cost were migrated to `authContext: SYS_CTX` (`{ isSystemOwner: true }` — the
 * shape the two internal production callers already use), and because Gate 0 short-circuits on
 * `isSystemOwner` that migration is behaviour-preserving: 104/104 green, unchanged.
 *
 * WHY THIS GUARD STILL EARNS ITS KEEP, now that the type enforces the same thing. The type only
 * binds callers TypeScript checks. This walker scans `lib services app scripts` and accepts
 * `.mjs` — `server.mjs` and the `scripts/` tree are not type-checked, so a caller there can omit
 * the field with nothing to stop it but this. It also catches a caller that reaches the service
 * past an `as any`. Type, runtime refusal, and this scan are three layers over one invariant,
 * and only the first is visible to `tsc`.
 *
 * The two genuinely-internal callers already do the right thing, passing
 * `authContext: { isSystemOwner: true }` (`lib/fleet-hard-recovery-runner.ts:52`,
 * `services/boot-restore-service.ts:181`) — which is what `gate0Auth`'s comment prescribes
 * (`buildSystemAuthContext()`), not omission.
 */

const REPO = path.resolve(__dirname, '..', '..')
// PRODUCTION only. `tests/` is deliberately excluded: the type now forces every TS caller,
// tests included, to pass the field, so scanning them would add cost and find nothing. What
// this walker is FOR is the untyped surface — `.mjs`, `scripts/` — which tsc never sees.
const ROOTS = ['lib', 'services', 'app', 'scripts']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const f = path.join(dir, e)
      const s = statSync(f)
      if (s.isDirectory()) {
        if (!/node_modules|\.next|\.git/.test(f)) walk(f)
      } else if (/\.(ts|tsx|mjs)$/.test(e)) {
        out.push(f)
      }
    }
  }
  for (const r of ROOTS) walk(path.join(REPO, r))
  return out
}

/**
 * Strip comments before matching. Without this the guard reports its own prose as a call —
 * `app/api/agents/[id]/ensure-core/route.ts:61` says "it never calls wakeAgent (that only fires
 * when no tmux session exists yet)" INSIDE a doc comment, and a naive needle counts it. That
 * use-vs-mention confusion produced six false positives in one session before it was fixed here.
 *
 * KNOWN LIMIT, stated rather than hidden: this also blanks `//` sequences inside string literals
 * (a URL). That can only ever cause the guard to MISS a call, never to invent one, and no call
 * site in this repo puts a wakeAgent call after a URL on the same line.
 */

/** Extract each call's argument text by counting bracket depth, so a MULTI-LINE call is read
 *  whole. Every real caller in this repo spans several lines, so a line-scoped needle would
 *  report all of them as omitting the field. */
function callArgs(src: string, fn: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 40), m.index)
    if (/export\s+async\s+function\s*$|function\s*$/.test(before)) continue // the definition
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      i++
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

describe('TRDD-FRRJ80YQ — no production caller may omit authContext', () => {
  const files = sourceFiles().filter((f) => !f.endsWith('wake-hibernate-authcontext-required.test.ts'))

  it('the walker reaches a real source tree', () => {
    /** Validates the scan set is non-empty, so a mis-joined root cannot report clean by scanning nothing */
    expect(files.length).toBeGreaterThan(200)
    expect(files.some((f) => f.endsWith(path.join('services', 'agents-core-service.ts')))).toBe(true)
  })

  it('finds the known production call sites — the positive control', () => {
    /** Validates the extractor can SEE a call, so a zero from it is a measurement and not a broken needle */
    let found = 0
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'))
      found += callArgs(src, 'wakeAgent').length + callArgs(src, 'hibernateAgent').length
    }
    // Measured 2026-08-22: 6 direct production call sites plus the service-internal ones.
    // A floor, not an equality — this must not go red when a legitimate caller is added.
    expect(found).toBeGreaterThanOrEqual(6)
  })

  it('every production call passes authContext', () => {
    /** Validates that the presence-gated authorization in wakeAgent/hibernateAgent is never skipped in shipped code */
    const offenders: string[] = []
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const fn of ['wakeAgent', 'hibernateAgent']) {
        for (const args of callArgs(src, fn)) {
          if (!/authContext/.test(args)) {
            offenders.push(`${path.relative(REPO, f)} :: ${fn}(${args.replace(/\s+/g, ' ').slice(0, 60)}…)`)
          }
        }
      }
    }
    expect(
      offenders,
      'wakeAgent/hibernateAgent REQUIRE an authContext and refuse a context-less call with a 401. ' +
        'A caller reaching them without one is either untyped (.mjs / scripts) or casting past the ' +
        'type — both are the shape this guard exists to catch. Pass one — `{ isSystemOwner: true }` ' +
        'for a genuinely internal caller, as fleet-hard-recovery-runner and boot-restore-service do.',
    ).toEqual([])
  })
})
