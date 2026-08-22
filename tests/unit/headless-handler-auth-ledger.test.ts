/**
 * TRDD-8Q5EVGV1 — the shrinking ledger for per-handler auth in the headless router.
 *
 * THE PROBLEM this pins. `services/headless-router.ts` reimplements the API surface
 * for `MAESTRO_MODE=headless`. In front of every handler sits `_headlessHasCredential`,
 * and its own comment says what it is: "a STRUCTURAL credential check ONLY … we still
 * don't validate the token itself". `Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA` passes it —
 * `tests/unit/headless-router-auth-mirror.test.ts` uses exactly that string as its
 * FORGED_BEARER control. So for a handler with no auth of its own, that forged token is
 * the whole story.
 *
 * WHAT THIS TEST DOES, AND WHAT IT DOES NOT. It does not fix the 142; shipping them as
 * 142 fresh failures would just get the file skipped. It is a RATCHET: the current set is
 * named in UNGUARDED_LEDGER below, and a handler added afterwards without auth fails here
 * instead of shipping. Guard one, delete its line. The ledger only shrinks.
 *
 * It is a source-text check, so it proves a handler does not ENTIRELY omit authentication —
 * the property that separates "any forged token" from "some real caller". It proves nothing
 * about authorization: a guarded handler may still let any authenticated agent of any title
 * do anything. That is TRDD-R268J32X's scope, and the ruling in TRDD-8Q5EVGV1 says so
 * explicitly, because "142 fixed" is exactly what someone will misread off this number.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING, and that is load-bearing. This file documents its
 * own guards in prose at length. Measured 2026-08-23: without stripping, the comment block
 * introduced above `mcp-discover` made the PRECEDING route (`element-content`) read as
 * guarded, and two more (`docker/info`, `agents/create-from-toml`) read as guarded off
 * neighbouring prose. The card's own headline 111/141 carries those two false positives;
 * the re-derived figures are 110 guarded / 142 unguarded.
 *
 * NEUTER RUNS (2026-08-23 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s|const isComment = .*|const isComment = (_l: string) => false|  if $. == 62
 *   → 2 red / 2 green:
 *       discriminates guarded from unguarded, and is not fooled by prose
 *       the ledger carries no stale entries (a guarded handler must be deleted from it)
 *   s|^  .GET .*config.*$|  // neutered|  if $. == 76      (simulates a NEW unguarded handler)
 *   → 1 red / 3 green:
 *       no handler is added without auth (the ledger only shrinks)
 * Complementary: each mutation reds a different test, so neither half of the file is vacuous.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const ROUTER = path.resolve(__dirname, '..', '..', 'services', 'headless-router.ts')

/** Any of these in a handler body means the handler authenticates its caller itself. */
const AUTH_NEEDLES = [
  'authenticateAgent(',
  'delegateNextRoute',
  'enforceAuth(',
  'enforceSystemOwner(',
  'authorize(',
  'checkTeamAccess(',
]

interface Handler { key: string; guarded: boolean }

function enumerateHandlers(): Handler[] {
  const src = readFileSync(ROUTER, 'utf8').split('\n')
  const start = src.findIndex(l => l.startsWith('const routes: Route[] = [')) + 1
  const end = src.findIndex((l, i) => i > start && l.startsWith(']'))
  if (start === 0 || end < 0) throw new Error('headless-router route table not found — enumerator is broken, not the router')

  const entries: Array<{ key: string; at: number }> = []
  for (let i = start; i < end; i++) {
    const m = src[i].match(/^ {2}\{ method: '([A-Z]+)', pattern: (\/.*?\/),/)
    if (m) entries.push({ key: `${m[1]} ${m[2]}`, at: i })
  }

  // A line that STARTS a comment is prose about the code, not the code. See the header:
  // an unstripped body matches every needle this file explains in words.
  const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l)

  return entries.map((e, k) => {
    const stop = k + 1 < entries.length ? entries[k + 1].at : end
    const body = src.slice(e.at, stop).filter(l => !isComment(l)).join('\n')
    return { key: e.key, guarded: AUTH_NEEDLES.some(n => body.includes(n)) }
  })
}

/**
 * Handlers with NO auth of their own, re-derived from source 2026-08-23 (TRDD-8Q5EVGV1).
 * Guard one → delete its line here. Never add a line: that is the failure this test exists for.
 */
const UNGUARDED_LEDGER: ReadonlySet<string> = new Set([
  'GET /^\\/api\\/config$/',
  'GET /^\\/api\\/organization$/',
  'POST /^\\/api\\/organization$/',
  'GET /^\\/api\\/debug\\/pty$/',
  'GET /^\\/api\\/docker\\/info$/',
  'GET /^\\/api\\/export\\/jobs\\/([^/]+)$/',
  'DELETE /^\\/api\\/export\\/jobs\\/([^/]+)$/',
  'GET /^\\/api\\/sessions\\/activity$/',
  'POST /^\\/api\\/sessions\\/activity\\/update$/',
  'GET /^\\/api\\/sessions\\/([^/]+)\\/command$/',
  'GET /^\\/api\\/agents\\/unified$/',
  'GET /^\\/api\\/agents\\/startup$/',
  'POST /^\\/api\\/agents\\/startup$/',
  'POST /^\\/api\\/agents\\/health$/',
  'GET /^\\/api\\/agents\\/by-name\\/([^/]+)$/',
  'GET /^\\/api\\/agents\\/email-index$/',
  'POST /^\\/api\\/agents\\/docker\\/create$/',
  'POST /^\\/api\\/agents\\/import$/',
  'GET /^\\/api\\/agents\\/directory$/',
  'GET /^\\/api\\/agents\\/directory\\/lookup\\/([^/]+)$/',
  'POST /^\\/api\\/agents\\/directory\\/sync$/',
  'GET /^\\/api\\/agents\\/normalize-hosts$/',
  'GET /^\\/api\\/agents$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/session$/',
  'POST /^\\/api\\/agents\\/([^/]+)\\/remove-element$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/chat$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/skills\\/settings$/',
  'POST /^\\/api\\/agents\\/([^/]+)\\/repos$/',
  'DELETE /^\\/api\\/agents\\/([^/]+)\\/repos$/',
  'POST /^\\/api\\/agents\\/([^/]+)\\/transfer$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/amp\\/addresses\\/([^/]+)$/',
  'PATCH /^\\/api\\/agents\\/([^/]+)\\/amp\\/addresses\\/([^/]+)$/',
  'DELETE /^\\/api\\/agents\\/([^/]+)\\/amp\\/addresses\\/([^/]+)$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/amp\\/addresses$/',
  'POST /^\\/api\\/agents\\/([^/]+)\\/amp\\/addresses$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/email\\/addresses\\/([^/]+)$/',
  'PATCH /^\\/api\\/agents\\/([^/]+)\\/email\\/addresses\\/([^/]+)$/',
  'DELETE /^\\/api\\/agents\\/([^/]+)\\/email\\/addresses\\/([^/]+)$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/email\\/addresses$/',
  'POST /^\\/api\\/agents\\/([^/]+)\\/email\\/addresses$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/messages$/',
  'GET /^\\/api\\/agents\\/([^/]+)\\/metadata$/',
  'PATCH /^\\/api\\/agents\\/([^/]+)\\/metadata$/',
  'DELETE /^\\/api\\/agents\\/([^/]+)\\/metadata$/',
  'GET /^\\/api\\/agents\\/browse-dir$/',
  'GET /^\\/api\\/agents\\/([^/]+)$/',
  'GET /^\\/api\\/hosts\\/identity$/',
  'GET /^\\/api\\/hosts\\/health$/',
  'GET /^\\/api\\/hosts\\/sync$/',
  'POST /^\\/api\\/hosts\\/sync$/',
  'POST /^\\/api\\/hosts\\/register-peer$/',
  'POST /^\\/api\\/hosts\\/exchange-peers$/',
  'GET /^\\/api\\/hosts$/',
  'POST /^\\/api\\/hosts$/',
  'PUT /^\\/api\\/hosts\\/([^/]+)$/',
  'DELETE /^\\/api\\/hosts\\/([^/]+)$/',
  'GET /^\\/api\\/v1\\/health$/',
  'GET /^\\/api\\/v1\\/info$/',
  'POST /^\\/api\\/v1\\/register$/',
  'POST /^\\/api\\/v1\\/route$/',
  'GET /^\\/api\\/v1\\/agents\\/me$/',
  'PATCH /^\\/api\\/v1\\/agents\\/me$/',
  'DELETE /^\\/api\\/v1\\/agents\\/me$/',
  'GET /^\\/api\\/v1\\/agents\\/resolve\\/([^/]+)$/',
  'GET /^\\/api\\/v1\\/agents$/',
  'POST /^\\/api\\/v1\\/messages\\/([^/]+)\\/read$/',
  'GET /^\\/api\\/v1\\/messages\\/pending$/',
  'DELETE /^\\/api\\/v1\\/messages\\/pending$/',
  'POST /^\\/api\\/v1\\/messages\\/pending$/',
  'DELETE /^\\/api\\/v1\\/auth\\/revoke-key$/',
  'POST /^\\/api\\/v1\\/auth\\/rotate-key$/',
  'POST /^\\/api\\/v1\\/auth\\/rotate-keys$/',
  'POST /^\\/api\\/v1\\/auth\\/challenge$/',
  'POST /^\\/api\\/v1\\/auth\\/token$/',
  'POST /^\\/api\\/v1\\/federation\\/deliver$/',
  'GET /^\\/api\\/messages\\/meeting$/',
  'GET /^\\/api\\/meetings\\/([^/]+)$/',
  'PATCH /^\\/api\\/meetings\\/([^/]+)$/',
  'DELETE /^\\/api\\/meetings\\/([^/]+)$/',
  'GET /^\\/api\\/meetings$/',
  'POST /^\\/api\\/meetings$/',
  'GET /^\\/api\\/governance$/',
  'POST /^\\/api\\/governance\\/manager$/',
  'POST /^\\/api\\/governance\\/password$/',
  'GET /^\\/api\\/governance\\/transfers$/',
  'POST /^\\/api\\/v1\\/governance\\/sync$/',
  'GET /^\\/api\\/v1\\/governance\\/sync$/',
  'POST /^\\/api\\/v1\\/governance\\/requests$/',
  'GET /^\\/api\\/v1\\/governance\\/requests$/',
  'GET /^\\/api\\/governance\\/trust$/',
  'POST /^\\/api\\/governance\\/trust$/',
  'DELETE /^\\/api\\/governance\\/trust\\/([^/]+)$/',
  'GET /^\\/api\\/teams\\/stats$/',
  'POST /^\\/api\\/teams\\/notify$/',
  'POST /^\\/api\\/teams\\/([^/]+)\\/chief-of-staff$/',
  'GET /^\\/api\\/teams$/',
  'GET /^\\/api\\/groups\\/([^/]+)$/',
  'GET /^\\/api\\/groups$/',
  'POST /^\\/api\\/webhooks\\/([^/]+)\\/test$/',
  'GET /^\\/api\\/webhooks\\/([^/]+)$/',
  'GET /^\\/api\\/webhooks$/',
  'GET /^\\/api\\/domains\\/([^/]+)$/',
  'PATCH /^\\/api\\/domains\\/([^/]+)$/',
  'DELETE /^\\/api\\/domains\\/([^/]+)$/',
  'GET /^\\/api\\/domains$/',
  'POST /^\\/api\\/domains$/',
  'GET /^\\/api\\/marketplace\\/skills\\/([^/]+)$/',
  'GET /^\\/api\\/marketplace\\/skills$/',
  'GET /^\\/api\\/help\\/agent$/',
  'POST /^\\/api\\/help\\/agent$/',
  'DELETE /^\\/api\\/help\\/agent$/',
  'GET /^\\/api\\/agents\\/creation-helper\\/session$/',
  'POST /^\\/api\\/agents\\/creation-helper\\/session$/',
  'DELETE /^\\/api\\/agents\\/creation-helper\\/session$/',
  'GET /^\\/api\\/agents\\/creation-helper\\/response$/',
  'POST /^\\/api\\/agents\\/creation-helper\\/raw-materials$/',
  'GET /^\\/api\\/agents\\/creation-helper\\/raw-materials$/',
  'GET /^\\/api\\/agents\\/role-plugins$/',
  'POST /^\\/api\\/agents\\/role-plugins$/',
  'POST /^\\/api\\/agents\\/role-plugins\\/sync-defaults$/',
  'GET /^\\/api\\/agents\\/role-plugins\\/required$/',
  'POST /^\\/api\\/agents\\/create-persona$/',
  'POST /^\\/api\\/agents\\/create-from-toml$/',
  'GET /^\\/api\\/settings\\/marketplaces$/',
  'POST /^\\/api\\/settings\\/marketplaces$/',
  'GET /^\\/api\\/settings\\/global-plugins$/',
  'POST /^\\/api\\/settings\\/global-plugins$/',
  'GET /^\\/api\\/settings\\/global-elements$/',
  'GET /^\\/api\\/settings\\/element-content$/',
  'GET /^\\/api\\/settings\\/host-tools$/',
  'POST /^\\/api\\/settings\\/host-tools$/',
  'POST /^\\/api\\/auth\\/login$/',
  'POST /^\\/api\\/auth\\/logout$/',
  'GET /^\\/api\\/auth\\/session$/',
  'GET /^\\/api\\/sessions-browser\\/agents\\/([^/]+)\\/sessions$/',
  'POST /^\\/api\\/sessions-browser\\/sessions\\/([^/]+)\\/range$/',
  'POST /^\\/api\\/sessions-browser\\/sessions\\/([^/]+)\\/search$/',
  'GET /^\\/api\\/sessions-browser\\/sessions\\/([^/]+)\\/context-breakdown$/',
  'GET /^\\/api\\/sessions-browser\\/agents\\/([^/]+)\\/timeline$/',
  'GET /^\\/api\\/sessions-browser\\/timelines\\/([^/]+)\\/range$/',
  'GET /^\\/api\\/sessions-browser\\/timelines\\/([^/]+)\\/search$/',
  'GET /^\\/api\\/sessions-browser\\/timelines\\/([^/]+)\\/context-at$/',
])

describe('TRDD-8Q5EVGV1 — headless per-handler auth ledger', () => {
  const handlers = enumerateHandlers()

  it('the enumerator actually reads the route table (non-vacuity floor)', () => {
    // Without this, a broken regex reports a clean ledger over zero handlers.
    expect(handlers.length).toBeGreaterThan(200)
  })

  it('discriminates guarded from unguarded, and is not fooled by prose', () => {
    const at = (needle: string) => handlers.find(h => h.key.includes(needle))
    // positive control: a handler that really does authenticate
    expect(at('sessions\\/restore')?.guarded).toBe(true)
    // negative control: a handler that really does not
    expect(at('api\\/config')?.guarded).toBe(false)
    // comment-only control: its ONLY needle match is in the neighbouring comment block
    expect(at('element-content')?.guarded).toBe(false)
  })

  it('no handler is added without auth (the ledger only shrinks)', () => {
    const unguarded = handlers.filter(h => !h.guarded).map(h => h.key)
    const added = unguarded.filter(k => !UNGUARDED_LEDGER.has(k))
    expect(added, 'new headless handler with no per-handler auth — guard it, or delegate to its Next route').toEqual([])
  })

  it('the ledger carries no stale entries (a guarded handler must be deleted from it)', () => {
    const unguarded = new Set(handlers.filter(h => !h.guarded).map(h => h.key))
    const stale = [...UNGUARDED_LEDGER].filter(k => !unguarded.has(k))
    expect(stale, 'these are guarded now (or renamed) — delete them from UNGUARDED_LEDGER').toEqual([])
  })
})
