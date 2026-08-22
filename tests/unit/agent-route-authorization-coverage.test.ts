/**
 * TRDD-D3RP7KQZ — coverage guardrail for the agent-scoped mutation surface.
 *
 * The USER's invariant (2026-07-09): an agent may drive its own surface but may
 * never reconfigure itself, and only a MANAGER, the target's own COS, or the
 * human may reconfigure another agent. `lib/authorization.ts` decides that. A
 * route that never ASKS is not covered by it.
 *
 * `POST /api/agents/[id]/install-skills` was exactly that: `enforceAuth` only
 * AUTHENTICATES — it proves who the caller is and nothing about what they may
 * do — so any authenticated agent could install the skill set onto itself or
 * any other non-Claude agent. Nothing failed; the invariant was simply not
 * enforced there. Found by hand while implementing the decision, which is a bad
 * way to find things.
 *
 * The invariant this test enforces: every MUTATING route under
 * `app/api/agents/[id]/` either performs an authorization step, or is named in
 * UNREVIEWED_INVENTORY below. Adding a new one without deciding its policy
 * fails here instead of shipping an open door.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. This is a source-text check. It can
 * see that a route calls `authorize()` / `requireSudoToken()`, or forwards the
 * caller's `auth.context` into a Change* pipeline (whose Gate 0 calls
 * `authorize()`). It CANNOT verify the action or target passed. So it proves a
 * route does not entirely omit authorization — a real and sufficient property
 * for catching the install-skills class of bug — and nothing finer. The finer
 * question is settled at the `authorize()` boundary, in tests/authorization.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')
const agentScopedRoot = path.join(repoRoot, 'app', 'api', 'agents', '[id]')

/** Routes under app/api/agents/[id]/ that mutate but perform no authorization. */
function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const MUTATING = /^export async function (POST|PUT|PATCH|DELETE)/m

/**
 * The five shapes an authorization step takes in this codebase:
 *   authorize(...)        — the route decides directly
 *   requireSudoToken(...) — strict route; the guard decides (R32 dual-path)
 *   auth.context / authContext — forwarded into a Change* pipeline whose Gate 0
 *                                (`assertAuthorized`) calls authorize() for it
 *   buildAuthContext(...) — the other spelling of the same forward: the helper's
 *                           only purpose is to hand the verified caller into a
 *                           Change* pipeline's Gate 0 (metadata/route.ts is the
 *                           route that surfaced the gap — it authorized at
 *                           ChangeMetadata G00 all along but sat in the ledger
 *                           because this regex could not see the spelling)
 *   canIssue(...)         — the R28 portfolio route's own mint-authority check
 *                           (title + standing authority). It is deliberately
 *                           NOT sudo-gated and does not call authorize(); it is
 *                           still a real authorization step, so it counts.
 *
 * Each pattern requires the call parenthesis, so a comment merely NAMING one of
 * these (portfolio/route.ts explains at length why it does not call
 * requireSudoToken) does not read as a call.
 */
const AUTHORIZES = /\bauthorize\(|\brequireSudoToken\(|\bcanIssue\(|\bbuildAuthContext\(|\bauth\.context\b|\bauthContext\b/

/**
 * Agent-scoped mutating routes with NO authorization step, as of 2026-07-09.
 *
 * This is a DEBT LEDGER of routes nobody has reviewed against the invariant —
 * not a list of routes judged safe. It may SHRINK as each is decided; it must
 * never grow without a deliberate edit here, which is the point.
 *
 * Eight are now CLOSED and gone from this list, and every one was worse than the
 * ledger's original guess that "several are probably fine":
 *
 *   - `queue/[entryId]` DELETE documented, deliberately, that "any authenticated
 *     caller may cancel a queued entry". Any agent could delete the commands a
 *     MANAGER had queued for the whole fleet, and veto orders queued for itself.
 *     Pinned by tests/unit/queue-cancel-authorization.test.ts.
 *   - `chat` POST ends in `sendKeys(..., {literal:true, enter:true})` — arbitrary
 *     text plus Enter into any agent's pane. It was the unguarded twin of the
 *     `send-command` route. Pinned by tests/unit/chat-send-authorization.test.ts.
 *   - `email/addresses/[address]` PATCH+DELETE let any agent rewrite any agent's
 *     address book, while its THREE siblings already authorized with
 *     `modify-agent`. A missed route, not a policy gap. Pinned by
 *     tests/unit/email-address-authorization.test.ts, which also asserts all four
 *     address routes agree on one action (no split-brain).
 *   - `export` (TRDD-YEE33F3A) was the worst of them, and this ledger UNDERSTATED
 *     it, because a ledger that inspects only mutating verbs cannot see that the
 *     sharp end of `export` is its GET: a zip that contains keys/private.pem —
 *     "NEVER shared", per lib/amp-keys.ts — plus registrations/, agent.db, and
 *     every message. Any agent token could take any other agent's signing key and
 *     forge its messages forever. Now `export-agent`, denied to every agent title
 *     including MANAGER. Pinned by tests/unit/export-authorization.test.ts, and
 *     by the EXFIL_FUNCTIONS net in dangerous-primitive-authorization.test.ts,
 *     which — unlike this file — scans reads as well as writes.
 *   - `messages/[messageId]` POST forwards a message AS the agent named in the
 *     path: sender forgery, plus a read of any mailbox. The ledger had guessed
 *     the sharp verb was DELETE. Pinned by message-mailbox-authorization.test.ts.
 *   - `subconscious` POST drove nothing — it returned 400 for every input once
 *     the RAG subsystem was removed, and had zero callers. Deleted, not
 *     authorized. Its GET, which the ledger could not see, had no auth at all
 *     and reached a getAgent() that CONSTRUCTS the agent on read.
 *   - `element-inventory` POST let any agent append forged snapshots to any
 *     agent's append-only audit ledger. Its proposed `modify-agent` would have
 *     DENIED the endpoint's only intended caller (an agent posting its own
 *     inventory), because that action is not self-drive.
 *   - `metrics` PATCH validated none of its three inputs — not who, not which
 *     field, not what value. The ledger called it "low blast radius"; a string
 *     `amount` was stored into estimatedCost, which the profile UI renders with
 *     .toFixed(2). Pinned by tests/unit/metrics-authorization.test.ts.
 *
 * THE LEDGER IS EMPTY (TRDD-YEE33F3A Part 2, 2026-07-10) and the two final
 * entries resolved in opposite directions — do not re-add either:
 *   - `metadata/route.ts` was a DETECTOR artifact: it authorized at
 *     `ChangeMetadata` gate G00 all along, via a `buildAuthContext(auth)`
 *     forward the AUTHORIZES regex could not see. The regex learned that
 *     spelling; the route was never touched.
 *   - `amp-init/route.ts` was a REAL hole wearing a correct-looking guard: its
 *     hand-rolled `isManager` check only fired for cross-agent callers, so an
 *     agent could re-mint its OWN Ed25519 identity keys — inverting the
 *     route's own doc comment — and a model-ON non-maestro user principal
 *     (userId, no agentId) skipped the guard entirely. Now
 *     `authorize('modify-agent')` plus a tighten-only MANAGER narrowing.
 *     Pinned by tests/unit/amp-init-authorization.test.ts.
 *
 * The audit was TRDD-4Q7WMPZK, which records what each route did.
 */
const UNREVIEWED_INVENTORY: string[] = []

function unauthorizedRoutes(): string[] {
  return findRouteFiles(agentScopedRoot)
    .filter((file) => {
      const src = readFileSync(file, 'utf8')
      return MUTATING.test(src) && !AUTHORIZES.test(src)
    })
    .map((file) => path.relative(agentScopedRoot, file))
    .sort()
}

describe('agent-scoped mutation routes authorize the caller (TRDD-D3RP7KQZ)', () => {
  it('every mutating route either authorizes or is an explicitly declared debt', () => {
    const undeclared = unauthorizedRoutes().filter((r) => !UNREVIEWED_INVENTORY.includes(r))

    expect(
      undeclared,
      'These routes mutate an agent but never authorize the caller against it, so any ' +
        `authenticated agent can reconfigure any agent — itself included:\n  ${undeclared.join('\n  ')}\n` +
        'Add an authorization step, or declare it in UNREVIEWED_INVENTORY with a reason.',
    ).toEqual([])
  })

  it('the debt ledger is pinned and contains no route that has since been fixed', () => {
    // A fixed route left in the ledger is a lie in the opposite direction: it
    // makes the debt look larger than it is and hides real progress.
    expect(unauthorizedRoutes().sort()).toEqual([...UNREVIEWED_INVENTORY].sort())
  })

  it('install-skills authorizes — the route this guardrail was written for', () => {
    const src = readFileSync(path.join(agentScopedRoot, 'install-skills', 'route.ts'), 'utf8')
    expect(MUTATING.test(src)).toBe(true)
    expect(src).toMatch(/authorize\(auth, 'manage-skills', id\)/)
  })
})

/**
 * TRDD-CAVCTULL — the COLLECTION subtree, which no guard has ever covered.
 *
 * Everything above walks `app/api/agents/[id]/` only. `app/api/agents/route.ts` and its
 * non-`[id]` siblings were outside the scan root, so the guard could not see the worst
 * instance of the class it exists to catch: `POST /api/agents` — the route that MINTS
 * AGENTS — authenticated and never authorized, letting any agent of any title create
 * agents (TRDD-F1SL03CK).
 *
 * A SEPARATE root and ledger rather than one widened walk, deliberately: the `[id]` ledger
 * above is EMPTY and that emptiness is a hard-won property (eight entries closed, each
 * worse than the ledger's own guess). Folding 19 collection-subtree entries into it would
 * destroy that signal — "the ledger is empty" would stop meaning anything.
 */
const collectionRoot = path.join(repoRoot, 'app', 'api', 'agents')

/** Mutating routes directly under app/api/agents/, EXCLUDING the [id]/ subtree above. */
function collectionRouteFiles(): string[] {
  return findRouteFiles(collectionRoot)
    .filter((f) => !f.startsWith(agentScopedRoot + path.sep))
    .filter((f) => MUTATING.test(readFileSync(f, 'utf8')))
    .sort()
}

const rel = (f: string) => path.relative(collectionRoot, f)

/**
 * Collection routes that mutate and perform NO authorization step, measured 2026-08-22.
 *
 * A DEBT LEDGER, on the same terms as the one above: not a list judged safe, a list nobody
 * has reviewed. It may SHRINK; it must never grow without a deliberate edit here.
 *
 * Seeded rather than shipped as 19 failures on purpose — a wall of red on day one is how a
 * linter gets routed around, and none of these is claimed to be a hole. Several are very
 * likely fine (`health`, the `creation-helper/*` wizard endpoints). The claim is only that
 * NOBODY HAS DECIDED, which is exactly what this ledger makes visible.
 *
 * Note what the `[id]` ledger's history says about guessing: of its eight closed entries,
 * every one was WORSE than its original "several are probably fine".
 *
 * ── 19 → 16, TRDD-DQVPODKW (2026-08-22) ──────────────────────────────────────────────
 * `create-persona`, `create-from-toml` and `docker/create` are gone from this list because
 * they now call `authorize(auth, 'create-agent')`. All three MINT AGENTS and all three took
 * `enforceAuth`, whose own docstring says it is for mutations where "any authenticated caller
 * can call this" — so TRDD-F1SL03CK locked the front door (`POST /api/agents`) while three
 * side doors stayed open. The ledger's history now says the same thing on BOTH sides: of the
 * `[id]` ledger's eight closed entries every one was worse than expected, and of this one's
 * first three, all three were live holes.
 *
 * The remaining 16 are measured, not assumed — see TRDD-DQVPODKW for the per-route verdicts,
 * including which are still sub-agent-reported rather than verified first-hand.
 */
const COLLECTION_UNREVIEWED: string[] = [
  'creation-helper/cleanup/route.ts',
  'creation-helper/clear-banner/route.ts',
  'creation-helper/element-descriptions/route.ts',
  'creation-helper/ensure-persona/route.ts',
  'creation-helper/file-picker/route.ts',
  'creation-helper/heartbeat/route.ts',
  'creation-helper/kill/route.ts',
  'creation-helper/publish-plugin/route.ts',
  'creation-helper/raw-materials/route.ts',
  'creation-helper/session/route.ts',
  'directory/sync/route.ts',
  'health/route.ts',
  'normalize-hosts/route.ts',
  'role-plugins/inject-skill/route.ts',
  'role-plugins/sync-defaults/route.ts',
  'startup/route.ts',
]

describe('collection-scope mutation routes authorize the caller (TRDD-CAVCTULL)', () => {
  it('the walker actually reaches the collection subtree', () => {
    // POSITIVE CONTROL, and it is the whole reason this file can be trusted after the
    // widening: a mis-joined root would return [] and every assertion below would pass
    // while scanning nothing — which is precisely how the original blind spot read CLEAN.
    const files = collectionRouteFiles()
    expect(files.length).toBeGreaterThanOrEqual(26)
    // And it must include the route that motivated the card, by name.
    expect(files.map(rel)).toContain('route.ts')
  })

  it('every mutating collection route either authorizes or is a declared debt', () => {
    const undeclared = collectionRouteFiles()
      .filter((f) => !AUTHORIZES.test(readFileSync(f, 'utf8')))
      .map(rel)
      .filter((r) => !COLLECTION_UNREVIEWED.includes(r))

    expect(
      undeclared,
      'These collection routes mutate but never authorize the caller:\n  ' +
        `${undeclared.join('\n  ')}\n` +
        'Add an authorization step, or declare it in COLLECTION_UNREVIEWED with a reason.',
    ).toEqual([])
  })

  it('the collection ledger contains no route that has since been fixed', () => {
    const unauthorized = collectionRouteFiles()
      .filter((f) => !AUTHORIZES.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort()
    expect(unauthorized).toEqual([...COLLECTION_UNREVIEWED].sort())
  })

  it('POST /api/agents authorizes with create-agent — the hole this card came from', () => {
    // Pinned by NAME rather than left to the ledger: this is the one route whose absence
    // of authorization was a live security hole, and a regression here must say so
    // explicitly rather than showing up as a ledger diff.
    const src = readFileSync(path.join(collectionRoot, 'route.ts'), 'utf8')
    expect(src).toMatch(/authorize\(auth, 'create-agent'\)/)
  })
})

/**
 * The SECOND blind spot: `buildAuthContext(` is counted as an authorization step, on the
 * stated theory that it forwards the caller into a Change* pipeline "whose Gate 0
 * (`assertAuthorized`) calls authorize() for it".
 *
 * That theory is TRUE for some pipelines and FALSE for others, and it is not checked here.
 * `metadata/route.ts` (above) is the true case — it authorizes at `ChangeMetadata` G00 all
 * along. `POST /api/agents` was the false one: it already called `buildAuthContext(auth)`
 * before TRDD-F1SL03CK, while `CreateAgent`'s first gate is `G00f`, an R40 foreign-user
 * check (`assertForeignUserMayCall`) and not an `authorize()` call. So for that route the
 * pattern read a context CONSTRUCTION as an authorization DECISION — a proxy standing in
 * for the thing, which is the same shape as the bug it failed to catch.
 *
 * This does not fail the suite. It PINS THE SET so it cannot grow silently, and names it
 * UNVERIFIED rather than covered. Verifying each one means reading its pipeline's Gate 0.
 */
const FORWARD_ONLY_UNVERIFIED_COUNT = 12

describe('routes whose only authorization evidence is a pipeline forward (TRDD-CAVCTULL)', () => {
  it('the forward-only set is pinned and does not grow unnoticed', () => {
    const STRONG = /\bauthorize\(|\brequireSudoToken\(|\bcanIssue\(/
    const FORWARD = /\bbuildAuthContext\(|\bauth\.context\b|\bauthContext\b/
    const all = [...findRouteFiles(agentScopedRoot), ...collectionRouteFiles()]
    const forwardOnly = all.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return MUTATING.test(src) && !STRONG.test(src) && FORWARD.test(src)
    })
    // Non-vacuity: a broken walk would report zero and read as "all verified".
    expect(forwardOnly.length).toBeGreaterThan(0)
    expect(
      forwardOnly.length,
      'A route matching only `buildAuthContext(`/`authContext` proves it FORWARDS the caller, ' +
        'not that the receiving pipeline authorizes. Verify its Gate 0 and give it a real ' +
        'authorize() call, or update this count deliberately with the reason.',
    ).toBe(FORWARD_ONLY_UNVERIFIED_COUNT)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════
// THIRD ROOT — app/api/ OUTSIDE agents/ (TRDD-R268J32X)
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// This file's history is the same finding at three widths. It walked `agents/[id]/` only, so the
// whole COLLECTION subtree was unguarded (TRDD-CAVCTULL) — and the instance it missed was
// `POST /api/agents`, which MINTS AGENTS. The collection root was added. Then TRDD-DQVPODKW found
// three MORE minting routes in that new root, all reachable by any authenticated agent. And
// `app/api/` outside `agents/` has still never been under anything.
//
// A THIRD PARALLEL BLOCK, not a widening of either existing one. The `[id]` ledger is provably
// EMPTY and the collection ledger is SHRINKING (19 → 16); folding a new debt pile into either
// destroys the signal both have earned.
//
// ── THE POPULATION IS THE DESIGN DECISION, and it was nearly got wrong ────────────────────
// Measured 2026-08-22, outside `agents/`: **122** mutating routes, of which **73** carry no
// `authorize(`/`requireSudoToken(`/`canIssue(`/`enforceSystemOwner(`. Seeding 73 would be
// indefensible — that set includes `auth/login`, `auth/logout`, `v1/auth/token` and
// `v1/auth/challenge`, i.e. THE AUTHENTICATION SURFACE ITSELF, which cannot require prior
// authorization by definition. A ledger that large is the "wall of warnings" this file's own
// collection block warns is how a linter gets routed around.
//
// So the needle is narrower and its claim is correspondingly sharper: a route that calls
// `enforceAuth` has CHOSEN authentication-only, and `enforceAuth`'s own docstring says it is for
// mutations where "any authenticated caller can call this". Every such use on a mutating route is
// an unchecked ASSERTION that this policy is intended. That population is **17**, and unlike the
// 73 it contains nothing that is correct by construction.
//
// DQVPODKW is why the assertion is worth checking rather than trusting: of the first four
// examined in one subtree, THREE were wrong, and all three minted agents.
const nonAgentsRoot = path.join(repoRoot, 'app', 'api')

function nonAgentsRouteFiles(): string[] {
  const agentsPrefix = path.join(repoRoot, 'app', 'api', 'agents') + path.sep
  return findRouteFiles(nonAgentsRoot).filter((f) => !f.startsWith(agentsPrefix))
}

const relNonAgents = (f: string) => path.relative(nonAgentsRoot, f)

/** Chose authentication-only. Each entry is an ASSERTION nobody has checked, not a known hole.
 *  May SHRINK as each is decided; must never grow without a deliberate edit here.
 *
 *  WAS 17 UNTIL 2026-08-22, AND SIX OF THOSE WERE NEVER AUTHENTICATION-ONLY. The first
 *  needle was `MUTATING && CALLS_ENFORCE_AUTH && !STRONG_AUTHZ`, with STRONG_AUTHZ looked for
 *  IN THE ROUTE FILE — so a route that forwards an authContext into a service that authorizes
 *  read as authentication-only. `sessions/create` is exactly that: it forwards, and
 *  `services/sessions-service.ts:815` calls `authorize(authResult, 'create-session', agentId)`.
 *  The `agents/` root has had a FORWARD-ONLY tier for precisely this since CAVCTULL; this root
 *  shipped without one, so its ledger conflated two different states and OVERSTATED the debt by
 *  six. The forward-only tier below now takes them, and it is the more interesting number: 18,
 *  twelve of which were in no ledger at all. */
const NON_AGENTS_AUTHN_ONLY: string[] = [
  'conversations/parse/route.ts',
  'export/jobs/[jobId]/route.ts',
  // DECIDED 2026-08-22 (TRDD-R268J32X) — authentication-only is CORRECT here. Kept in the
  // ledger rather than removed: the entry's job is to stop the assertion changing unnoticed,
  // and a decided-correct route still needs that. Reasoning on the card; in short, the build
  // writes to a tmp dir nothing reads, does not install, and the sibling that PUBLISHES
  // (`push`) is enforceSystemOwner. `authorize()` also has no verb for it.
  'plugin-builder/build/route.ts',
  'plugin-builder/scan-repo/route.ts',
  'sessions/[id]/rename/route.ts',
  'sessions/activity/update/route.ts',
  'sessions/restore/route.ts',
  'settings/global-elements/convert-skill/route.ts',
  'settings/mcp-discover/route.ts',
  'v1/mesh/chat/route.ts',
  'vpn-chat/block/route.ts',
]

/** Forwards a caller context out of the route without authorizing IN it. Same meaning, same
 *  needle and same caveat as the `agents/`-root tier above: a forward proves the route hands the
 *  identity on, NOT that the receiving end decides anything. Pinned by COUNT, because the set is
 *  large and the useful property is that it cannot grow silently.
 *
 *  Measured 2026-08-22: 18. Six arrived from the authn-only ledger above; the other TWELVE were
 *  invisible to every guard in this file until the tier existed — including
 *  `teams/[id]/batch-create-agents` and `trdd/create`, which create governed objects. */
const NON_AGENTS_FORWARD_ONLY_COUNT = 18

const STRONG_AUTHZ = /\bauthorize\(|\brequireSudoToken\(|\bcanIssue\(|\benforceSystemOwner\(|\benforceActiveMaestro\(/
const CALLS_ENFORCE_AUTH = /^\s*(const [A-Za-z]+ = )?enforceAuth\(/m
const FORWARDS_CONTEXT = /\bbuildAuthContext\(|\bauth\.context\b|\bauthContext\b/

describe('non-agents mutation routes that chose authentication-only (TRDD-R268J32X)', () => {
  it('the walker reaches the non-agents tree — a mis-joined root must not report clean', () => {
    /** Validates the scan set is real, since an empty walk is indistinguishable from a clean tree */
    const files = nonAgentsRouteFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files.every((f) => f.endsWith('route.ts'))).toBe(true)
    // It must NOT bleed into app/api/agents/, which the other two blocks own. Assert the
    // PRECISE property (prefix), not a substring: `v1/agents/route.ts` and
    // `sessions-browser/agents/[id]/…` legitimately contain "/agents/" deeper in their path and
    // DO belong to this root. A substring check calls those a bleed and reds a correct walker —
    // it did, on the first run.
    const agentsPrefix = path.join(repoRoot, 'app', 'api', 'agents') + path.sep
    expect(files.some((f) => f.startsWith(agentsPrefix))).toBe(false)
  })

  it('the authentication-only ledger neither grows nor silently keeps a fixed route', () => {
    /** Validates that a new authn-only mutating route outside agents/ cannot land unnoticed */
    const found = nonAgentsRouteFiles()
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        // !FORWARDS_CONTEXT is what was missing until 2026-08-22 — see the ledger's own note.
        return (
          MUTATING.test(src) &&
          CALLS_ENFORCE_AUTH.test(src) &&
          !STRONG_AUTHZ.test(src) &&
          !FORWARDS_CONTEXT.test(src)
        )
      })
      .map(relNonAgents)
      .sort()

    // Non-vacuity: a broken needle would report zero and read as "all decided".
    expect(found.length).toBeGreaterThan(0)
    expect(
      found,
      'A mutating route outside app/api/agents/ calls enforceAuth and nothing stronger. ' +
        "enforceAuth's own docstring is for mutations where \"any authenticated caller can call " +
        'this\" — so this is an ASSERTION that the policy is intended, and nothing checks it. ' +
        'Add an authorization step, or add the route here with a reason. TRDD-DQVPODKW: of the ' +
        'first four such assertions examined, three were wrong and all three minted agents.',
    ).toEqual([...NON_AGENTS_AUTHN_ONLY].sort())
  })

  it('the forward-only set outside agents/ is pinned and does not grow unnoticed', () => {
    /** Validates that a route forwarding a caller context without authorizing cannot land unseen */
    const forwardOnly = nonAgentsRouteFiles().filter((f) => {
      const src = readFileSync(f, 'utf8')
      return MUTATING.test(src) && !STRONG_AUTHZ.test(src) && FORWARDS_CONTEXT.test(src)
    })
    // Non-vacuity: a broken needle would report zero and read as "all verified".
    expect(forwardOnly.length).toBeGreaterThan(0)
    expect(
      forwardOnly.length,
      'A mutating route outside app/api/agents/ forwards an auth context and calls nothing ' +
        'stronger. That proves it hands the identity on, NOT that the receiving service decides ' +
        'anything — verify the receiver and give it a real authorize() call, or update this ' +
        'count deliberately with the reason. TRDD-CAVCTULL: the same theory held for 11 such ' +
        'routes and failed for 1, which is why forwarding is pinned rather than trusted.',
    ).toBe(NON_AGENTS_FORWARD_ONLY_COUNT)
  })

  it('sessions/create is forward-AND-authorize — the one verified receiver, pinned by name', () => {
    /** Validates the receiver verified for R268J32X still authorizes, since the tier above only counts */
    const src = readFileSync(path.join(repoRoot, 'services', 'sessions-service.ts'), 'utf8')
    expect(src).toMatch(/authorize\(authResult, 'create-session', agentId\)/)
  })
})
