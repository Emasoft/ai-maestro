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
 * registry describes. Many headless handlers do NOT re-implement authorization at
 * all — they DELEGATE, forwarding the request to the hardened Next.js route handler
 * (`const mod = await import('@/app/api/.../route'); await mod.<METHOD>(...)`, often
 * via `delegateNextRoute`) so that handler's own gate stack runs in headless mode too.
 *
 * A handler with no `authorize()`/`decideAidTitle()` call in its OWN body is therefore
 * NOT automatically unguarded — it may be guarded by the target it delegates to,
 * which can itself carry a different (weaker or stronger) enforcement mix. This test
 * classifies every strict route served headless into three categories:
 *
 *   DIRECT    — the handler itself calls authorize()/decideAidTitle().
 *   DELEGATED — the handler forwards to a Next.js route handler; the target file's
 *               own enforcement (authorize/requireAidTitle/requireSudoToken/
 *               enforceSystemOwner) is reported, never assumed safe.
 *   NEITHER   — no authorization call and no delegation. This is the genuinely
 *               unguarded set, and it is the number that matters.
 *
 * It is a SNAPSHOT over the NEITHER set: it passes today because the snapshot
 * matches reality, and it FAILS the moment a new strict route lands in headless
 * without authorization or delegation, or an existing one gets fixed — either
 * direction is a signal worth seeing (update the snapshot when that happens; do not
 * treat this file as the fix itself).
 *
 * Closing the gap (failing closed at dispatch time for every strict route at once)
 * is a deliberate, separate change — it alters behaviour on every strict route
 * headless serves, not just the ones this snapshot currently lists.
 */

const PROJECT_ROOT = join(__dirname, '..', '..')
const ROUTER_PATH = join(PROJECT_ROOT, 'services', 'headless-router.ts')
const REGISTRY_PATH = join(PROJECT_ROOT, 'security-registry.json')

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
  /** `app/api/.../route` (no extension) this handler forwards to, or null. */
  delegateTarget: string | null
}

const GUARD_NAMES = ['authorize(', 'requireAidTitle', 'requireSudoToken', 'enforceSystemOwner'] as const
type GuardName = (typeof GUARD_NAMES)[number]

const guardCache = new Map<string, GuardName[]>()

/** Reads a delegated target's own guard calls, masking comments/strings first. */
function resolveTargetGuards(delegateTarget: string): GuardName[] {
  const cached = guardCache.get(delegateTarget)
  if (cached) return cached
  const filePath = join(PROJECT_ROOT, `${delegateTarget}.ts`)
  const targetSource = readFileSync(filePath, 'utf8')
  const targetMasked = maskNonCode(targetSource)
  const guards = GUARD_NAMES.filter((g) => targetMasked.includes(g))
  guardCache.set(delegateTarget, guards)
  return guards
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

    // Delegation detection needs the REAL import string, which maskNonCode blanks
    // out (it lives inside quotes) — so this reads the UNMASKED slice of `source`
    // at the same brace-counted bounds, never the whole file (avoids attributing
    // an unrelated handler's import to this route).
    const origBody = source.slice(entryOpen, entryEnd)
    const importMatch = origBody.match(/import\(\s*['"][^'"]*(app\/api\/[^'"]+\/route)['"]\s*\)/)
    let delegateTarget: string | null = null
    if (importMatch) {
      const candidate = importMatch[1]
      const modCalled = new RegExp(`mod\\.${method}\\b`).test(origBody)
      const bareCalled = new RegExp(`\\b${method}\\s*\\(`).test(origBody)
      if (modCalled || bareCalled) {
        delegateTarget = candidate
      }
    }

    routes.push({ method, template, hasAuthzCall, delegateTarget })
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

  // key -> aggregate over every route entry matching that method+template. DIRECT
  // wins over DELEGATED wins over NEITHER (any entry with its own authz call, or
  // failing that any delegating entry, is enough to clear the key).
  type Category = 'direct' | 'delegated' | 'neither'
  const categoryByKey = new Map<string, Category>()
  const delegateTargetByKey = new Map<string, string>()
  for (const r of routes) {
    const key = `${r.method}_${r.template}`
    const current = categoryByKey.get(key) ?? 'neither'
    if (r.hasAuthzCall) {
      categoryByKey.set(key, 'direct')
    } else if (r.delegateTarget && current !== 'direct') {
      categoryByKey.set(key, 'delegated')
      delegateTargetByKey.set(key, r.delegateTarget)
    } else if (!categoryByKey.has(key)) {
      categoryByKey.set(key, 'neither')
    }
  }

  const servedHeadless = strictKeys.filter((k) => categoryByKey.has(k)).sort()
  const direct = servedHeadless.filter((k) => categoryByKey.get(k) === 'direct')
  const delegated = servedHeadless.filter((k) => categoryByKey.get(k) === 'delegated')
  const neither = servedHeadless.filter((k) => categoryByKey.get(k) === 'neither')

  it('positive control: the analysis actually saw strict routes served headless, at least one DIRECT and at least one DELEGATED', () => {
    // A 0 here means the parser/derivation found nothing to compare — the detector
    // would be measuring an empty set, which is indistinguishable from "all clean".
    // The DELEGATED-non-empty assertion specifically catches a regression back to
    // the old binary detector: if delegation detection silently breaks, every
    // delegated route falls into NEITHER and this test fails loudly instead of the
    // NEITHER snapshot quietly growing by ~40%.
    expect(routes.length).toBeGreaterThan(0)
    expect(strictKeys.length).toBeGreaterThan(0)
    expect(servedHeadless.length).toBeGreaterThan(0)
    expect(direct.length).toBeGreaterThan(0)
    expect(delegated.length).toBeGreaterThan(0)
  })

  it('pins the exact set of strict routes served headless with NEITHER an authz call NOR delegation (genuinely unguarded)', () => {
    // Snapshot, not a rule. If this list shrinks because a route got fixed or
    // delegation was added, update it here — that direction is progress. If it
    // grows, that is the regression this test exists to catch.
    expect(neither).toEqual([
      'DELETE_/api/agents/[id]',
      'DELETE_/api/agents/[id]/session',
      'DELETE_/api/agents/cemetery',
      'DELETE_/api/sessions/[id]',
      'DELETE_/api/teams/[id]',
      'DELETE_/api/teams/[id]/orchestrator',
      'PATCH_/api/agents/[id]',
      'PATCH_/api/agents/[id]/session',
      'POST_/api/agents/[id]/transfer',
      'POST_/api/agents/cemetery',
      'POST_/api/agents/import',
      'POST_/api/teams',
      'PUT_/api/teams/[id]/orchestrator',
    ])
  })

  it('records the routes served headless that DIRECTLY call authorize()/decideAidTitle(), for contrast', () => {
    expect(direct).toEqual([
      'DELETE_/api/agents/role-plugins',
      'DELETE_/api/agents/role-plugins/install',
      'GET_/api/agents/[id]/probe',
      'POST_/api/agents/role-plugins/install',
      'POST_/api/sessions/[id]/restart',
      'POST_/api/sessions/[id]/stop',
    ])
  })

  it('reports the DELEGATED routes and their target file\'s own enforcement — delegation is not automatically safe', () => {
    // Delegated routes route to a Next.js handler with an independent guard mix
    // (see resolveTargetGuards). This is reported, never assumed: a target with
    // only requireSudoToken (e.g. trdd/[id]/approve) is materially different from
    // one with authorize() (e.g. teams/[id]), and the snapshot below pins BOTH the
    // set and each one's guard mix so a target quietly losing a guard is caught.
    const breakdown = delegated
      .map((k) => `${k} -> ${delegateTargetByKey.get(k)} [${resolveTargetGuards(delegateTargetByKey.get(k)!).join(',')}]`)
      .sort()
    expect(breakdown).toEqual([
      'PATCH_/api/trdd/[id] -> app/api/trdd/[id]/route [requireSudoToken]',
      'POST_/api/governance/password -> app/api/governance/password/route [requireSudoToken,enforceSystemOwner]',
      'POST_/api/trdd/[id]/approve -> app/api/trdd/[id]/approve/route [requireSudoToken]',
      'POST_/api/trdd/[id]/archive -> app/api/trdd/[id]/archive/route [requireSudoToken]',
      'POST_/api/trdd/[id]/promote -> app/api/trdd/[id]/promote/route [requireSudoToken]',
      'POST_/api/trdd/[id]/refuse -> app/api/trdd/[id]/refuse/route [requireSudoToken]',
      'PUT_/api/teams/[id] -> app/api/teams/[id]/route [requireSudoToken]',
    ])
  })
})
