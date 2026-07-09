/**
 * GUARDRAIL — every route that reaches a terminal/session primitive must authorize.
 *
 * This exists because of how `POST /api/agents/[id]/chat` survived: it typed
 * arbitrary text into any agent's tmux pane with `enforceAuth` alone, and every
 * audit walked past it, because it is named "chat". Its sibling guardrail
 * (`agent-route-authorization-coverage.test.ts`) could not have caught it either
 * — that one is keyed on a PATH (`app/api/agents/[id]/**`), and a capability is
 * not a path. `sessions/[id]/rename` and `sessions/restore` sit outside that
 * tree and reach session primitives just the same.
 *
 * So this guardrail is keyed on the PRIMITIVE. Enumerate the service functions
 * that reach `sendKeys` / `startProgram` / tmux lifecycle, then assert every
 * route importing one of them carries an authorization step.
 *
 * TWO KNOWN BLIND SPOTS, stated rather than hidden:
 *
 *  1. ONE HOP ONLY. A route that reaches a primitive transitively — e.g.
 *     `sessions/activity/update` POST, whose `updateSessionActivity` calls
 *     `drainCommandQueueForSession` inside the service — imports no dangerous
 *     name and is invisible here.
 *  2. SERVICE IMPORTS ONLY. `sessions/[id]/{restart,stop,kill}` drive tmux
 *     without importing from `services/`. They DO authorize, so they are not a
 *     hole; they are simply not covered by this net.
 *
 * So do not read a green run as "no unauthorized route reaches a terminal". Read
 * it as "no route DIRECTLY imports a listed service primitive without
 * authorizing". A guardrail that overstates its own reach is how the next `chat`
 * gets missed.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const apiRoot = path.join(process.cwd(), 'app', 'api')
const servicesRoot = path.join(process.cwd(), 'services')

/**
 * Service functions that reach a terminal-injection or tmux-lifecycle primitive.
 * Adding a function here is how you extend the net; the export-existence test
 * below stops a rename from silently emptying it.
 */
const DANGEROUS_FUNCTIONS = [
  'sendAgentSessionCommand',
  'sendChatMessage',
  'drainCommandQueueForSession',
  'wakeAgent',
  'renameSession',
  'restoreSessions',
  'triggerSubconsciousAction',
] as const

/** Anything that constitutes an authorization decision. Presence, not correctness. */
const AUTHORIZES = /\bauthorize\(|\brequireSudoToken\(|\bcanIssue\(|\bauth\.context\b|\bauthContext\b/
const MUTATES = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/

/**
 * Routes that reach a primitive and do NOT authorize. A DEBT LEDGER, not a
 * safelist. It must never grow without a deliberate edit here.
 *
 *  - `agents/[id]/subconscious`  — needs an AuthAction that does not exist
 *    (drive another agent's background process). Proposed in TRDD-YEE33F3A.
 *  - `sessions/[id]/rename`      — `renameSession` is a registry + tmux write.
 *    `modify-agent` probably fits, but the path carries a SESSION id, so the
 *    target agent must be resolved via `getAgentBySession` first.
 *  - `sessions/restore`          — `restoreSessions` spawns tmux sessions. The
 *    `create-session` action already exists and is documented as exactly this
 *    primitive; it is not agent-scoped, so it resolves to MANAGER/system-owner.
 *
 * The audit is TRDD-4Q7WMPZK; the policy calls are TRDD-YEE33F3A.
 */
const UNAUTHORIZED_DANGEROUS = [
  'agents/[id]/subconscious/route.ts',
  'sessions/[id]/rename/route.ts',
  'sessions/restore/route.ts',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name === 'route.ts') out.push(p)
  }
  return out
}

/** Import specifiers only — a doc comment mentioning `sendKeys` must not match. */
function importedNames(src: string): Set<string> {
  const names = new Set<string>()
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().split(/\s+as\s+/)[0].trim()
      if (n) names.add(n)
    }
  }
  return names
}

function routesReachingAPrimitive(): { rel: string; authorized: boolean }[] {
  return walk(apiRoot)
    .map((abs) => ({ abs, src: fs.readFileSync(abs, 'utf-8') }))
    .filter(({ src }) => MUTATES.test(src))
    .map(({ abs, src }) => {
      const imported = importedNames(src)
      const reaches = DANGEROUS_FUNCTIONS.some((f) => imported.has(f))
      return reaches
        ? { rel: path.relative(apiRoot, abs), authorized: AUTHORIZES.test(src) }
        : null
    })
    .filter((x): x is { rel: string; authorized: boolean } => x !== null)
}

describe('every route DIRECTLY importing a terminal/session primitive authorizes', () => {
  it('the unauthorized set is exactly the pinned debt ledger', () => {
    const gaps = routesReachingAPrimitive()
      .filter((r) => !r.authorized)
      .map((r) => r.rel)
      .sort()
    // Fails LOUD when a new unauthorized primitive-reaching route ships, and
    // fails when one is fixed without being delisted (so the ledger cannot rot).
    expect(gaps).toEqual([...UNAUTHORIZED_DANGEROUS].sort())
  })

  it('the net actually catches something — a green run is not an empty run', () => {
    const found = routesReachingAPrimitive()
    const byRel = new Map(found.map((r) => [r.rel, r.authorized]))
    // `chat` is the positive control: it WAS the vulnerability, it imports
    // sendChatMessage, and it must now read as authorized. If a refactor stops it
    // matching, this guardrail has quietly stopped guarding the very route it was
    // written for.
    expect(byRel.get('agents/[id]/chat/route.ts')).toBe(true)
    // And the ledger's entries must actually be SEEN by the scanner — otherwise
    // "the unauthorized set equals the ledger" could pass with both sides empty.
    for (const rel of UNAUTHORIZED_DANGEROUS) {
      expect(byRel.has(rel), `${rel} is no longer detected by the net`).toBe(true)
    }
    expect(found.length).toBeGreaterThanOrEqual(UNAUTHORIZED_DANGEROUS.length + 1)
  })

  it('a doc comment mentioning a primitive does not count as importing it', () => {
    // chat/route.ts quotes `runtime.sendKeys(...)` in its doc comment. A naive
    // grep flagged it; importedNames() must not.
    const src = fs.readFileSync(path.join(apiRoot, 'agents', '[id]', 'chat', 'route.ts'), 'utf-8')
    expect(src).toContain('sendKeys') // the comment is really there
    expect(importedNames(src).has('sendKeys')).toBe(false)
  })
})

describe('the net cannot silently empty itself', () => {
  it('every DANGEROUS_FUNCTIONS name is still exported by a service', () => {
    const svc = fs
      .readdirSync(servicesRoot)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(servicesRoot, f), 'utf-8'))
      .join('\n')
    for (const fn of DANGEROUS_FUNCTIONS) {
      // A rename would otherwise leave this guardrail scanning for a name that no
      // longer exists — green, and checking nothing.
      expect(svc, `${fn} is no longer exported — update DANGEROUS_FUNCTIONS`).toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`),
      )
    }
  })
})
