/**
 * TRDD-91TLL7DW — a route that takes an agent id from a request must carry an
 * identity gate.
 *
 * THE SHAPE THIS PINS. `lib/agent-auth.ts` derives `agentId` from the VERIFIED
 * Bearer token / session — the right shape, with no parameter path. That
 * foundation is only as strong as its weakest route: one route that reads an
 * agent id out of `body`/`query`/`params` and acts on it with NO identity check
 * at all silently undoes it, and no forgery is needed — the caller simply names
 * someone else. The audit (`design/tasks/…-91TLL7DW-…md`) found exactly that in
 * `agents/email-index` (zero auth calls of any kind). This file exists so a
 * FOURTH such route cannot land unnoticed.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. This is a SOURCE-TEXT check. It sees
 * that a route file which reads an agent id from the request ALSO contains one of
 * the identity-helpers below — authentication (`enforceAuth`, `requireAuth`, …)
 * or authorization (`authorize`, `checkTeamAccess`, …). It CANNOT tell a
 * caller-supplied ACTING id from a TARGET id, nor verify the gate binds the right
 * caller to the right target — only that a gate is present, which is the property
 * that separates "an open door" from "a decided policy". The binding itself is
 * settled by the per-route behavioral tests (e.g.
 * tests/unit/api-teams-notify-authz.test.ts).
 *
 * WHY A LEDGER OF ONE. Every member of the audited class is now gated, so the
 * ledger is empty. It may only be EMPTIED, never extended without a deliberate
 * edit here carrying a reason — the same discipline the sibling coverage ledgers
 * use. A route that intentionally reads an agent id with no gate belongs here
 * WITH its reason, not silently.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')
const apiRoot = path.join(repoRoot, 'app', 'api')

function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** Strip `//` line comments and block comments, so prose about a call is not the call. */
const stripComments = (src: string): string =>
  src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')

/**
 * A route reads a agent id from the request rather than only from the verified
 * credential: query param (`searchParams.get('agentId')` / `query.agentId`),
 * path param (`params.agentId`), body field (`body.agentId` / destructured), or
 * the email-index filter (`agentIdQuery`).
 */
const READS_PARAM_AGENT_ID =
  /searchParams\.get\(\s*['"]agentId['"]\s*\)|\bquery\.agentId\b|\bparams\.agentId\b|\bbody\.agentId\b|\bagentIdQuery\b/

/**
 * Any named identity gate — authentication or authorization. Authentication alone
 * is a DECIDED policy for the open reads (`governance/reachable`, `agents/email-index`
 * are readable by any authenticated caller); the class this file targets is a route
 * with NO gate at all. `resolveDesignDir(` is the TRDD-route pattern that REFUSES a
 * caller-supplied id for a non-owner (lib/trdd-design-dir.ts).
 */
const HAS_IDENTITY_GATE =
  /\benforceAuth\(|\brequireAuth\(|\brequireAuthAsync\(|\bauthenticateFromRequest\(|\bauthenticateFromRequestAsync\(|\bauthenticateAgent\(|\bauthorize\(|\bcheckTeamAccess\(|\benforceSystemOwner\(|\brequireSudoToken\(|\bcanIssue\(|\bbuildAuthContext\(|\brequestingAgentId\b|\bresolveDesignDir\(|\bauthContext\b/

/** Routes that read an agent id from the request and carry NO identity gate. A DEBT LEDGER. */
const UNGATED_PARAM_AGENT_ID: string[] = []

describe('TRDD-91TLL7DW — every route reading an agent id from the request carries an identity gate', () => {
  it('the walker reaches the api tree — a mis-joined root must not report clean', () => {
    /** Validates the scan set is real, since an empty walk is indistinguishable from a clean tree */
    const files = findRouteFiles(apiRoot)
    expect(files.length).toBeGreaterThan(100)
    expect(files.every((f) => f.endsWith('route.ts'))).toBe(true)
  })

  it('the needle matches a known parameter-sourced route (a green run is not an empty run)', () => {
    /** Positive control: if the needle stops matching, the assertion below proves nothing */
    const trddKanban = readFileSync(path.join(apiRoot, 'trdd', 'kanban', 'route.ts'), 'utf8')
    expect(
      READS_PARAM_AGENT_ID.test(stripComments(trddKanban)),
      'needle no longer matches a route that reads ?agentId',
    ).toBe(true)
    expect(
      HAS_IDENTITY_GATE.test(stripComments(trddKanban)),
      'gate needle no longer matches a route that gates (resolveDesignDir)',
    ).toBe(true)
  })

  it('no route reads an agent id from the request without an identity gate', () => {
    /** Validates the audited class stays closed: a new parameter-sourced route must decide its policy */
    const ungated = findRouteFiles(apiRoot)
      .filter((f) => {
        const src = stripComments(readFileSync(f, 'utf8'))
        return READS_PARAM_AGENT_ID.test(src) && !HAS_IDENTITY_GATE.test(src)
      })
      .map((f) => path.relative(apiRoot, f))
      .sort()

    // Non-vacuity: the set of id-reading routes must be non-empty, or the check is trivially green.
    const readers = findRouteFiles(apiRoot).filter((f) => READS_PARAM_AGENT_ID.test(stripComments(readFileSync(f, 'utf8'))))
    expect(readers.length).toBeGreaterThan(5)

    expect(
      ungated,
      'A route reads an agent id from the request (body/query/params) with no identity gate. ' +
        'That is the TRDD-91TLL7DW class: a parameter-named agent is never the verified caller, ' +
        'so any authenticated (or unauthenticated) caller names someone else. Add an ' +
        'authentication/authorization step, or add the route here with a reason (a ledger that ' +
        'grows only by deliberate edit).',
    ).toEqual([...UNGATED_PARAM_AGENT_ID].sort())
  })
})
