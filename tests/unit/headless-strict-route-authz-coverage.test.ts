import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { deriveRouteTemplate } from '@/lib/headless-route-template'

/**
 * DETECTOR — TRDD-HGE9T6VT box 188. This measures, it does not enforce.
 *
 * `security-registry.json` marks 51 route templates "strict" (must carry a sudo
 * token / AID-title authorization). `services/headless-router.ts` reimplements every
 * route as its own regex + handler, independent of the Next.js `app/api/**` tree the
 * registry describes. Nothing today checks that a strict route served headless
 * actually calls `authorize()`/`decideAidTitle()` in its own handler body — the
 * `PATCH /api/agents/[id]` and `DELETE /api/agents/[id]` handlers, for example, only
 * call `authenticateAgent()` (who you are), never `authorize()` (what you may do).
 *
 * This test finds every strict route also served headless, statically decides
 * whether that handler's own body contains an authorization call, and pins the
 * exact set that does not. It is a SNAPSHOT: it passes today because the snapshot
 * matches reality, and it FAILS the moment a new strict route lands in headless
 * without authorization, or an existing one gets fixed — either direction is a
 * signal worth seeing, which is why the fixed case is also a failure here (update
 * the snapshot when that happens; do not treat this file as the fix itself).
 *
 * Closing the gap (failing closed at dispatch time for every strict route at once)
 * is a deliberate, separate change — it alters behaviour on every strict route
 * headless serves, not just the ones this snapshot currently lists.
 */

const ROUTER_PATH = join(__dirname, '..', '..', 'services', 'headless-router.ts')
const REGISTRY_PATH = join(__dirname, '..', '..', 'security-registry.json')

/**
 * Blank out every character that is not "real" top-level code: `//` and `/* *\/`
 * comments, `'...'`/`"..."`/`` `...` `` literal contents, and `/regex/` literals.
 * Length-preserving (newlines kept) so positions in the masked string line up 1:1
 * with the original — a brace inside a comment or a template-literal path string
 * (e.g. `` `/api/agents/${params.id}/portfolio` ``) must not be counted as real
 * nesting, and a mention of "authorize(" inside a comment must not count as a call.
 */
function maskNonCode(text: string): string {
  const out = text.split('')
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]

    if (c === '/' && text[i + 1] === '/') {
      let j = i
      while (j < n && text[j] !== '\n') {
        out[j] = ' '
        j++
      }
      i = j
      continue
    }

    if (c === '/' && text[i + 1] === '*') {
      let j = i
      while (j < n - 1 && !(text[j] === '*' && text[j + 1] === '/')) {
        out[j] = text[j] === '\n' ? '\n' : ' '
        j++
      }
      out[j] = ' '
      if (j + 1 < n) out[j + 1] = ' '
      i = j + 2
      continue
    }

    if (c === "'" || c === '"') {
      const quote = c
      let j = i + 1
      out[i] = ' '
      while (j < n && text[j] !== quote) {
        if (text[j] === '\\') {
          out[j] = ' '
          j++
          if (j < n) out[j] = ' '
          j++
          continue
        }
        out[j] = text[j] === '\n' ? '\n' : ' '
        j++
      }
      if (j < n) out[j] = ' '
      i = j + 1
      continue
    }

    if (c === '`') {
      let j = i + 1
      out[i] = ' '
      while (j < n && text[j] !== '`') {
        if (text[j] === '\\') {
          out[j] = ' '
          j++
          if (j < n) out[j] = ' '
          j++
          continue
        }
        out[j] = text[j] === '\n' ? '\n' : ' '
        j++
      }
      if (j < n) out[j] = ' '
      i = j + 1
      continue
    }

    if (c === '/') {
      // Regex-vs-division heuristic: a `/` following an operator/punctuator/`return`
      // (or the start of the region) opens a regex literal. Every `pattern:` in this
      // file is exactly this shape (`pattern: /^\/api\/.../$/`).
      let k = i - 1
      while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--
      const prevChar = k >= 0 ? text[k] : ''
      const precedingWord = text.slice(Math.max(0, k - 6), k + 1)
      const regexish =
        prevChar === '' ||
        '([{,:;!&|?=~^%<>+-*'.includes(prevChar) ||
        precedingWord.endsWith('return')
      if (regexish) {
        let j = i + 1
        let inClass = false
        while (j < n) {
          if (text[j] === '\\') {
            j += 2
            continue
          }
          if (text[j] === '[') inClass = true
          else if (text[j] === ']') inClass = false
          else if (text[j] === '/' && !inClass) break
          j++
        }
        for (let k2 = i; k2 <= Math.min(j, n - 1); k2++) {
          if (text[k2] !== '\n') out[k2] = ' '
        }
        i = j + 1
        continue
      }
    }

    i++
  }
  return out.join('')
}

interface ParsedRoute {
  method: string
  template: string
  hasAuthzCall: boolean
}

/** One route array entry, matched on the ORIGINAL (unmasked) source. */
const ROUTE_ENTRY_RE = /\{ method: '([A-Z]+)', pattern: (\/[^,]*\/), paramNames: \[([^\]]*)\]/g

function parseParamNames(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim().replace(/^['"]|['"]$/g, ''))
    .filter((p) => p.length > 0)
}

function parseRoutes(source: string, masked: string): ParsedRoute[] {
  const arrayStart = source.indexOf('const routes: Route[] = [')
  const arrayEnd = source.indexOf('\n]\n', arrayStart)
  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error('could not locate the `routes` array in headless-router.ts — did its shape change?')
  }

  const routes: ParsedRoute[] = []
  ROUTE_ENTRY_RE.lastIndex = arrayStart
  let match: RegExpExecArray | null
  while ((match = ROUTE_ENTRY_RE.exec(source)) !== null) {
    if (match.index >= arrayEnd) break
    const [, method, patternLiteral, paramNamesRaw] = match
    const patternSource = patternLiteral.slice(1, -1) // strip the delimiting slashes
    const paramNames = parseParamNames(paramNamesRaw)
    const template = deriveRouteTemplate(patternSource, paramNames)

    // Bound this ONE entry (route object + its handler body) by brace-counting on the
    // MASKED text, starting at the entry's opening `{`. Never "scan to the next
    // `{ method:`" — a `{` inside a nested object/template expression inside an
    // earlier handler would desync that and mis-attribute later code to this route.
    const entryOpen = match.index
    let depth = 0
    let j = entryOpen
    while (j < masked.length) {
      const ch = masked[j]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) break
      }
      j++
    }
    const entryEnd = j + 1
    const body = masked.slice(entryOpen, entryEnd)
    const hasAuthzCall = body.includes('authorize(') || body.includes('decideAidTitle(')

    routes.push({ method, template, hasAuthzCall })
  }
  return routes
}

describe('headless strict-route authorization coverage (TRDD-HGE9T6VT box 188, detector only)', () => {
  const source = readFileSync(ROUTER_PATH, 'utf8')
  const masked = maskNonCode(source)
  const routes = parseRoutes(source, masked)

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as {
    entries: Record<string, string>
  }
  const strictKeys = Object.keys(registry.entries).filter(
    (k) => registry.entries[k] === 'strict'
  )

  // key -> true if ANY route entry matching that method+template calls authorize()/decideAidTitle()
  const authzByKey = new Map<string, boolean>()
  for (const r of routes) {
    const key = `${r.method}_${r.template}`
    authzByKey.set(key, (authzByKey.get(key) ?? false) || r.hasAuthzCall)
  }

  const servedHeadless = strictKeys.filter((k) => authzByKey.has(k)).sort()
  const guarded = servedHeadless.filter((k) => authzByKey.get(k) === true)
  const unguarded = servedHeadless.filter((k) => authzByKey.get(k) === false)

  it('positive control: the analysis actually saw strict routes served headless, and at least one calls authorize()', () => {
    // A 0 here means the parser/derivation found nothing to compare — the detector
    // would be measuring an empty set, which is indistinguishable from "all clean".
    expect(routes.length).toBeGreaterThan(0)
    expect(strictKeys.length).toBeGreaterThan(0)
    expect(servedHeadless.length).toBeGreaterThan(0)
    expect(guarded.length).toBeGreaterThan(0)
  })

  it('pins the exact set of strict routes served headless WITHOUT an authorize()/decideAidTitle() call', () => {
    // Snapshot, not a rule. If this list shrinks because a route got fixed, update
    // it here — that direction is progress. If it grows because a new strict route
    // landed unguarded in headless, that is the regression this test exists to catch.
    expect(unguarded).toEqual([
      'DELETE_/api/agents/[id]',
      'DELETE_/api/agents/[id]/session',
      'DELETE_/api/agents/cemetery',
      'DELETE_/api/sessions/[id]',
      'DELETE_/api/teams/[id]',
      'DELETE_/api/teams/[id]/orchestrator',
      'PATCH_/api/agents/[id]',
      'PATCH_/api/agents/[id]/session',
      'PATCH_/api/trdd/[id]',
      'POST_/api/agents/[id]/transfer',
      'POST_/api/agents/cemetery',
      'POST_/api/agents/import',
      'POST_/api/governance/password',
      'POST_/api/teams',
      'POST_/api/trdd/[id]/approve',
      'POST_/api/trdd/[id]/archive',
      'POST_/api/trdd/[id]/promote',
      'POST_/api/trdd/[id]/refuse',
      'PUT_/api/teams/[id]',
      'PUT_/api/teams/[id]/orchestrator',
    ])
  })

  it('records the routes served headless that DO call authorize()/decideAidTitle(), for contrast', () => {
    expect(guarded).toEqual([
      'DELETE_/api/agents/role-plugins',
      'DELETE_/api/agents/role-plugins/install',
      'GET_/api/agents/[id]/probe',
      'POST_/api/agents/role-plugins/install',
      'POST_/api/sessions/[id]/restart',
      'POST_/api/sessions/[id]/stop',
    ])
  })
})
