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
 * A THIRD BLIND SPOT, found the hard way (TRDD-YEE33F3A): this net originally
 * filtered on `export function (POST|PUT|PATCH|DELETE)`, because "dangerous"
 * was equated with "mutating". `GET /api/agents/[id]/export` then sat unnoticed
 * shipping the target's `keys/private.pem` in a zip — the sharpest hole in the
 * system, reachable by any agent token, and structurally invisible to BOTH
 * guardrails. Exfiltration is not a mutation. So there are now two classes:
 *
 *   DANGEROUS_FUNCTIONS — write/drive primitives. Mutating verbs only.
 *   EXFIL_FUNCTIONS     — read primitives that emit secrets. EVERY verb, GET
 *                         included, because reading is the whole attack.
 *
 * TWO REMAINING BLIND SPOTS, stated rather than hidden:
 *
 *  1. ONE HOP ONLY. A route that reaches a primitive transitively — e.g.
 *     `sessions/activity/update` POST, whose `updateSessionActivity` calls
 *     `drainCommandQueueForSession` inside the service — imports no dangerous
 *     name and is invisible here.
 *  2. SERVICE IMPORTS ONLY, AND ONLY UNDER `app/api`. `sessions/[id]/{restart,
 *     stop,kill}` drive tmux without importing from `services/`. They DO
 *     authorize, so they are not a hole; they are simply not covered. And
 *     `services/headless-router.ts` re-implements ~100 of these routes for
 *     headless mode; it is a single file of inline handlers that this walker
 *     never visits. Its export handlers get a dedicated parity test below —
 *     that is a patch, not a general net.
 *
 * So do not read a green run as "no unauthorized route reaches a terminal". Read
 * it as "no route under app/api DIRECTLY imports a listed service primitive
 * without authorizing". A guardrail that overstates its own reach is how the
 * next `chat` gets missed — and equating danger with mutation is how the next
 * `export` gets missed.
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
  // A FOURTH KIND OF DANGER — identity, not the terminal (TRDD-YEE33F3A).
  // `forwardMessage` (both services) passes its caller-supplied sender straight
  // to `forwardFromUI`, where it becomes the new message's `from`/`forwardedBy`,
  // is written to THAT agent's sent folder, is the identity the governance
  // filter is evaluated against, and — for a cross-host target — is signed with
  // the HOST key so the remote accepts it. Unguarded, it let any authenticated
  // caller send AS any agent. Aimed back at the caller, it also READ any agent's
  // mail. Neither guardrail saw it: it is not a terminal primitive and not a
  // credential-emitting read.
  'forwardMessage',
] as const

/**
 * Service functions that READ and emit secrets. Unlike DANGEROUS_FUNCTIONS these
 * are checked on EVERY verb, GET included: `exportAgentZip` streams a zip that
 * contains `keys/private.pem` — annotated in lib/amp-keys.ts as "Agent's private
 * key (NEVER shared)" — plus `registrations/` (external provider API keys),
 * `agent.db`, and every message. A GET that hands out a signing key is worse
 * than most writes; it is silent, repeatable, and grants forgery forever.
 */
const EXFIL_FUNCTIONS = ['exportAgentZip'] as const

/**
 * WHY `getMessage` IS NOT IN `EXFIL_FUNCTIONS` — a boundary, chosen, not forgotten.
 *
 * Reading another agent's mail is a confidentiality breach, and the single-message
 * route's GET was indeed unauthorized until TRDD-YEE33F3A. But this class means
 * "emits a CREDENTIAL": `keys/private.pem` grants forgery FOREVER, silently, and
 * no later fix revokes what was taken. A message grants knowledge. Collapsing the
 * two makes the class mean "anything confidential", i.e. everything, and a class
 * that matches everything stops being read.
 *
 * Mailbox confidentiality is instead held by the ownership guard on the route and
 * the service (`denyForeignMailbox`), plus the agent-scoped coverage ledger.
 *
 * The concrete cost of widening it: `getMessage` is also imported by
 * `v1/mesh/chat/route.ts` and `v1/mesh/chat/history/route.ts`, which authorize
 * under a different regime entirely (AMP api-keys + the AID challenge, not
 * `authorize()`). Since this class has no debt ledger, adding `getMessage` would
 * fail the build until someone sprinkled an `authContext` token into those routes
 * to satisfy a regex — a fake fix, which is worse than an honest boundary.
 */

/** Anything that constitutes an authorization decision. Presence, not correctness. */
const AUTHORIZES = /\bauthorize\(|\brequireSudoToken\(|\bcanIssue\(|\bauth\.context\b|\bauthContext\b/
const MUTATES = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/
const ANY_HANDLER = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/

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

/**
 * Strip `//` line comments and block comments, so a count of CALL SITES is not
 * inflated by prose. Written after this file's own headless-parity test failed:
 * the doc comment "This handler called exportAgentZip() directly with NO auth"
 * was counted as a call. That is precisely the trap `importedNames()` exists to
 * avoid, walked into one function further down.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
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

/** Same walk, but ANY verb — a GET that exfiltrates is the point. */
function routesReachingAnExfilPrimitive(): { rel: string; authorized: boolean }[] {
  return walk(apiRoot)
    .map((abs) => ({ abs, src: fs.readFileSync(abs, 'utf-8') }))
    .filter(({ src }) => ANY_HANDLER.test(src))
    .map(({ abs, src }) => {
      const imported = importedNames(src)
      const reaches = EXFIL_FUNCTIONS.some((f) => imported.has(f))
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

describe('every route reaching an EXFIL primitive authorizes — on ANY verb', () => {
  it('no route that imports an exfiltration primitive is unauthorized', () => {
    const gaps = routesReachingAnExfilPrimitive()
      .filter((r) => !r.authorized)
      .map((r) => r.rel)
      .sort()
    // There is no debt ledger here on purpose. A route that hands out a private
    // key has no acceptable interim state.
    expect(gaps).toEqual([])
  })

  it('the exfil net catches the route it was written for', () => {
    const found = routesReachingAnExfilPrimitive()
    const byRel = new Map(found.map((r) => [r.rel, r.authorized]))
    // `export` is the positive control: it WAS the vulnerability, it imports
    // exportAgentZip, its dangerous verb is GET, and it must now read authorized.
    expect(byRel.get('agents/[id]/export/route.ts')).toBe(true)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('the exfil net would see a GET — it is not accidentally mutation-only', () => {
    // Guards the regex itself. If ANY_HANDLER ever loses GET, the net silently
    // reverts to the blind spot that let `export` through, and the test above
    // would still pass (an unauthorized GET would simply vanish from `found`).
    expect(ANY_HANDLER.test('export async function GET(req) {}')).toBe(true)
    expect(MUTATES.test('export async function GET(req) {}')).toBe(false)
  })
})

describe('headless-router parity — the same primitives, the same authorization', () => {
  // Comments stripped: this file's own prose names these functions, and counting
  // prose as calls is how the first version of this suite failed.
  const headless = stripComments(fs.readFileSync(path.join(servicesRoot, 'headless-router.ts'), 'utf-8'))

  it('both headless export handlers authorize with export-agent', () => {
    // The headless router re-implements the API for `MAESTRO_MODE=headless` and
    // is NOT walked by the nets above. Its GET handler called exportAgentZip with
    // no auth call whatsoever; its own structural credential gate only proves a
    // credential is PRESENT, exactly as middleware.ts does. Two handlers (GET +
    // POST) reach the export services, so two authorize() calls must exist.
    const authorizeCalls = headless.match(/authorize\(auth,\s*'export-agent',\s*params\.id\)/g) ?? []
    expect(authorizeCalls.length).toBe(2)
  })

  it('the headless export services are still reached from exactly two call sites', () => {
    // If a third handler starts calling them, the count above must be revisited
    // rather than silently under-covering.
    expect((headless.match(/exportAgentZip\(/g) ?? []).length).toBe(1)
    expect((headless.match(/createTranscriptExportJob\(params\.id/g) ?? []).length).toBe(1)
  })

  it('stripComments removes prose but keeps code', () => {
    // The helper is load-bearing for the two counts above; assert it directly
    // rather than trusting it silently.
    const sample = '// calls exportAgentZip() in prose\nconst r = await exportAgentZip(id)\n'
    expect((stripComments(sample).match(/exportAgentZip\(/g) ?? []).length).toBe(1)
    expect(stripComments('/* exportAgentZip() */').trim()).toBe('')
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

  it('every EXFIL_FUNCTIONS name is still exported by a service', () => {
    const svc = fs
      .readdirSync(servicesRoot)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(servicesRoot, f), 'utf-8'))
      .join('\n')
    for (const fn of EXFIL_FUNCTIONS) {
      expect(svc, `${fn} is no longer exported — update EXFIL_FUNCTIONS`).toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`),
      )
    }
  })

  it('exportAgentZip really does archive the keys directory', () => {
    // The whole justification for EXFIL_FUNCTIONS. If someone stops shipping keys
    // in the zip, this fails and the classification should be revisited — rather
    // than the comment quietly becoming false, which is how the doc comment on
    // the route stayed accurate for months while the guard stayed absent.
    const transfer = fs.readFileSync(path.join(servicesRoot, 'agents-transfer-service.ts'), 'utf-8')
    expect(transfer).toMatch(/archive\.directory\(\s*keysDir\s*,\s*'keys'\s*\)/)
  })
})
