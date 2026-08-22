import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

/**
 * TRDD-FRRJ80YQ — every PRODUCTION call to wakeAgent/hibernateAgent passes an authContext.
 *
 * `WakeAgentParams.authContext` and `HibernateAgentParams.authContext` are declared `?:`, and
 * both functions gate their authorization on the field being PRESENT:
 *
 *     // When authContext is provided (route call), check caller permissions.
 *     // When absent (internal call), skip — backward compatible.
 *     if (authContext) { if (!authContext.isSystemOwner) { … authorize(…) } }
 *
 * That is the exact bypass `element-management-service.ts` abolished, and that file records why
 * in `gate0Auth`'s own comment: *"Previously, a missing authContext was silently treated as
 * 'authorized' which allowed any route that forgot to pass it to bypass all security checks."*
 *
 * WHY A GUARD AND NOT A TYPE CHANGE. Making the field required is the tidier fix and it is not
 * the cheaper one: measured 2026-08-22, **34 call sites omit `authContext` and 32 of them are
 * TESTS** (`tests/services/agents-core-service.test.ts` alone has 27). Those tests pin real
 * behaviour through a path production never takes, so requiring the field would churn 32
 * assertions to close a bypass that — measured — no production caller uses. The card's own
 * estimate said "zero call-site changes"; that is true of production and false overall, and it
 * said to re-verify before relying on it. This guard closes the risk the card actually names —
 * *the NEXT caller* — at a fraction of the cost, and it keeps working if the field is made
 * required later.
 *
 * The two genuinely-internal callers already do the right thing, passing
 * `authContext: { isSystemOwner: true }` (`lib/fleet-hard-recovery-runner.ts:52`,
 * `services/boot-restore-service.ts:181`) — which is what `gate0Auth`'s comment prescribes
 * (`buildSystemAuthContext()`), not omission. So the comment advertises an affordance that
 * nothing takes.
 */

const REPO = path.resolve(__dirname, '..', '..')
// PRODUCTION only. `tests/` is deliberately excluded — see the header: 32 test call sites
// legitimately omit the field today, and this guard is about the code that ships.
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
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

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
      'wakeAgent/hibernateAgent gate authorization on `if (authContext)`, so omitting it SKIPS the ' +
        'check entirely and the call succeeds unauthorized. Pass one — `{ isSystemOwner: true }` for a ' +
        'genuinely internal caller, as fleet-hard-recovery-runner and boot-restore-service already do.',
    ).toEqual([])
  })
})
