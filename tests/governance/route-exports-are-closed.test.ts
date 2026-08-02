import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { globSync } from 'glob'

/**
 * A Next.js App Router `route.ts` module's exports are a CLOSED SET — the HTTP verb handlers plus a
 * fixed route-segment config list. Anything else fails the build with
 * *"<name> is not a valid Route export field"*.
 *
 * WHY THIS TEST EXISTS: `tsc --noEmit` does NOT see the constraint. It is enforced by the route
 * types Next.js GENERATES during `next build`, so the ONLY gate that catches it is `yarn build` —
 * the slowest one, run least often, and the one a `tsc`-clean change is most likely to skip. Two
 * violations shipped that way (`MAX_INGEST_BYTES` and `rollUp`, both in the statusline routes) and
 * sat on the branch breaking every build until a card's own "build green" box was actually re-run
 * on 2026-08-02 instead of copied forward from the commit that first claimed it.
 *
 * The fix in both cases is the same and is the rule: **a route file is an HTTP shell.** A constant
 * or a pure function that anything else needs — a test included — belongs in `lib/`, and the route
 * imports it. The test is what makes that cheap to remember: it fails in seconds, in the suite
 * everyone runs, instead of minutes into a build.
 */

// Source: Next.js App Router route-segment config + the HTTP methods it dispatches.
const ALLOWED_ROUTE_EXPORTS = new Set([
  // handlers
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  // route segment config
  'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration',
  // params + the legacy config object
  'generateStaticParams', 'config',
])

const DECL_EXPORT = /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm
const LIST_EXPORT = /^export\s*\{([^}]*)\}/gm
const DEFAULT_EXPORT = /^export\s+default\b/m

/**
 * The detector, exported as a pure function of TEXT so the positive control below can feed it a
 * known-bad module. A scanner tested only against the live tree passes identically when its regex
 * matches nothing at all.
 */
export function invalidRouteExports(source: string): string[] {
  const found = new Set<string>()
  for (const m of source.matchAll(DECL_EXPORT)) found.add(m[1])
  for (const m of source.matchAll(LIST_EXPORT)) {
    for (const piece of m[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) found.add(name)
    }
  }
  if (DEFAULT_EXPORT.test(source)) found.add('default')
  // `export type` / `export interface` are erased before the build sees them, and the generated
  // route checker does not flag them — so they are deliberately not matched above.
  return [...found].filter((n) => !ALLOWED_ROUTE_EXPORTS.has(n)).sort()
}

const ROOT = join(__dirname, '..', '..')

describe('a Next.js route module exports ONLY handlers and route config', () => {
  const files = globSync('app/**/route.ts', { cwd: ROOT }).sort()

  it('the scan set is the real one — a scanner that reads nothing reports clean', () => {
    // Non-vacuity. If a future restructure moves the API tree, this reddens instead of the suite
    // quietly certifying an empty read.
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('app/api/statusline/route.ts')
    expect(files).toContain('app/api/statusline/ingest/route.ts')
  })

  it('POSITIVE CONTROL — the detector flags each invalid shape, and clears the valid ones', () => {
    // Without this, every "no violations" assertion below is satisfied by a broken regex.
    expect(invalidRouteExports('export const MAX_INGEST_BYTES = 1')).toEqual(['MAX_INGEST_BYTES'])
    expect(invalidRouteExports('export function rollUp() {}')).toEqual(['rollUp'])
    expect(invalidRouteExports('export async function helper() {}')).toEqual(['helper'])
    expect(invalidRouteExports('export class Thing {}')).toEqual(['Thing'])
    expect(invalidRouteExports('const a = 1\nexport { a }')).toEqual(['a'])
    expect(invalidRouteExports('const b = 1\nexport { b as renamed }')).toEqual(['renamed'])
    expect(invalidRouteExports('export default function h() {}')).toEqual(['default'])

    // …and does not cry wolf on what a route legitimately exports.
    expect(invalidRouteExports("export const dynamic = 'force-dynamic'")).toEqual([])
    expect(invalidRouteExports('export async function POST(r: Request) {}')).toEqual([])
    expect(invalidRouteExports('export const revalidate = 0\nexport const runtime = "nodejs"')).toEqual([])
    expect(invalidRouteExports('export type Body = { a: string }')).toEqual([])
  })

  it('no route file in the tree exports anything outside the closed set', () => {
    const violations: string[] = []
    for (const rel of files) {
      for (const name of invalidRouteExports(readFileSync(join(ROOT, rel), 'utf-8'))) {
        violations.push(`${rel} exports ${name}`)
      }
    }
    // Named in the failure message rather than counted: the fix is per-symbol (move it to lib/ and
    // import it back), so a bare count would say nothing about what to move.
    expect(violations).toEqual([])
  })
})
