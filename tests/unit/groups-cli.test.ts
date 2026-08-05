/**
 * `aimaestro-groups.sh` — the groups CLI (ai-maestro#64, residual 6).
 *
 * WHY IT EXISTS. Groups had **five live routes and zero CLI surface**, so CORE's team-governance
 * skill documented the operation and then told the agent not to do it (`REFERENCE.md:58`,
 * DECOUPLE-BLOCKED). Under R23.8 an unannounced verb formally does not exist, which pushes a plugin
 * that needs groups back toward `/api/*` — or, correctly, blocks. It blocked.
 *
 * WHY THERE IS NO `--password` ANYWHERE, and why that is asserted. A group is not a team: it confers
 * no authority, has no ACL, no COS, no board. Every groups route is **authenticated but
 * governance-FREE (R20)** — the route comments say so. So a `--password` flag would imply a gate the
 * server does not have, and R32.3 forbids the governance password passing through a model in any
 * case. The absence is a deliberate contract, so it is pinned rather than left to drift back in.
 *
 * THE BODY-SHAPE ASSERTIONS ARE THE LOAD-BEARING ONES. Both schemas are `.strict()`, so an
 * unsolicited key is a **400**, not an ignored field — sending `description: ""` for an omitted flag
 * would be a validation error rather than a harmless default. And on `update` every field is
 * optional, so a blanket body would silently CLEAR the fields the caller never mentioned. Neither
 * failure is visible to a "did it return 2xx" assertion: the first never reaches 2xx, and the second
 * reaches it while destroying data.
 *
 * WHY A SUBPROCESS. The dispatch is a top-level bash `case` and every real path makes an
 * authenticated HTTP call, so driving the CLI for real returns an identical 401 for every subcommand
 * and proves nothing about routing (the ai-maestro#114 shape). This sources the script with `_api`
 * stubbed to echo its arguments — the only altitude at which "which method, path and body did this
 * verb send" is a positive observation.
 *
 * NEUTER RUNS (2026-08-05 — OBSERVED):
 *   - drop the `(if $hd == 1 …)` guard from `cmd_update` so `description` is always sent:
 *     **1 red** — the partial-update closure. Everything else green, since no other closure
 *     inspects an omitted field.
 *   - delete the `notify)` line from the dispatch `case`: **1 red** — the reachability closure only.
 *     The verb closures call `cmd_notify` directly and never traverse the dispatch. That closure
 *     exists *because* the equivalent hole was found unpinned in `teams-stats-verb.test.ts` one
 *     commit earlier: a verb can be defined, correct, and unreachable, with every other test green.
 *
 * Both predictions held. A first attempt at the update neuter was DISCARDED rather than reported:
 * an unescaped `$d` in the perl replacement produced `+ {description: }`, a jq SYNTAX error rather
 * than the semantic mutation intended. It reddened the same single closure, so its verdict looked
 * identical to the real run — which is exactly why it had to be redone rather than accepted. That
 * is the third time this session an unescaped `$` has quietly changed what a neuter measured; in a
 * perl `s///` the replacement side interpolates, so every `$` in it needs escaping.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const CLI = path.join(REPO, 'scripts', 'aimaestro-groups.sh')

const GID = '11111111-2222-4333-8444-555555555555'
const AID = '99999999-8888-4777-8666-555555555555'

/**
 * Call one `cmd_*` with the transport stubbed. The source is redirected because the script's
 * dispatch is top-level and fires on source; the stub must be installed AFTER it.
 */
function run(fn: string): { exit: number; out: string } {
  const harness = `
    source "${CLI}" >/dev/null 2>&1 || true
    _api() { echo "API method=\$1 path=\$2 body=\$3"; }
    ${fn}
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  return { exit: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** The JSON body a verb sent, parsed. */
function body(out: string): Record<string, unknown> {
  const m = out.match(/body=(\{.*\})/)
  expect(m, `no JSON body was sent — output was: ${out}`).toBeTruthy()
  return JSON.parse(m![1])
}

describe('every verb hits its documented route', () => {
  it.each([
    ['cmd_list', 'GET', '/api/groups'],
    [`cmd_show ${GID}`, 'GET', `/api/groups/${GID}`],
    [`cmd_delete ${GID}`, 'DELETE', `/api/groups/${GID}`],
    [`cmd_subscribe ${GID} ${AID}`, 'POST', `/api/groups/${GID}/subscribe`],
    [`cmd_unsubscribe ${GID} ${AID}`, 'POST', `/api/groups/${GID}/unsubscribe`],
    [`cmd_notify ${GID} --message hi`, 'POST', `/api/groups/${GID}/notify`],
  ])('%s → %s %s', (fn, method, route) => {
    const r = run(fn)
    expect(r.out).toContain(`method=${method} path=${route}`)
  })

  it('subscribe and unsubscribe are DISTINCT routes, not one aliased to the other', () => {
    // They share `_membership_verb`, so a bad refactor could point both at the same path —
    // which would silently make unsubscribe add a member.
    expect(run(`cmd_subscribe ${GID} ${AID}`).out).toContain('/subscribe')
    expect(run(`cmd_unsubscribe ${GID} ${AID}`).out).toContain('/unsubscribe')
    expect(run(`cmd_subscribe ${GID} ${AID}`).out).not.toContain('/unsubscribe')
  })
})

describe('bodies carry ONLY what the caller asked for (both schemas are .strict())', () => {
  it('create with just --name sends just name', () => {
    const b = body(run('cmd_create --name release-watchers').out)
    expect(b).toEqual({ name: 'release-watchers' })
    // An unsolicited key is a 400 under .strict(), not an ignored field.
    expect(b).not.toHaveProperty('description')
    expect(b).not.toHaveProperty('subscriberIds')
  })

  it('create passes subscribers through as a JSON array, not a CSV string', () => {
    const b = body(run(`cmd_create --name g --subscribers ${AID},${GID}`).out)
    expect(b.subscriberIds).toEqual([AID, GID])
  })

  it('update with only --name does NOT clear description or subscribers', () => {
    // The destructive failure: a blanket body reaches 2xx and wipes the fields nobody mentioned.
    const b = body(run(`cmd_update ${GID} --name renamed`).out)
    expect(b).toEqual({ name: 'renamed' })
  })

  it('update with no flags at all is refused before the request', () => {
    const r = run(`cmd_update ${GID}`)
    expect(r.out).toMatch(/requires at least one of/i)
    expect(r.out).not.toContain('API method=')
  })
})

describe('argument validation happens BEFORE the request (the ai-maestro#114 shape)', () => {
  it('an invalid --priority is refused and names the valid set', () => {
    const r = run(`cmd_notify ${GID} --message hi --priority urgentt`)
    expect(r.out).toMatch(/low, normal, high, urgent/)
    // The load-bearing half: an unmatchable value must not reach the server.
    expect(r.out).not.toContain('API method=')
  })

  it('a valid --priority is sent through', () => {
    // Without this the guard could reject everything and the test above would still pass.
    const b = body(run(`cmd_notify ${GID} --message hi --priority high`).out)
    expect(b).toEqual({ message: 'hi', priority: 'high' })
  })

  it('notify without --message is refused before the request', () => {
    const r = run(`cmd_notify ${GID}`)
    expect(r.out).toMatch(/requires --message/i)
    expect(r.out).not.toContain('API method=')
  })
})

describe('groups are governance-FREE — no --password surface exists (R20/R32.3)', () => {
  it('no subcommand accepts --password', () => {
    // A group confers no authority, so a password flag would imply a gate the server does not
    // have. Pinned so it cannot drift back in by copy-paste from aimaestro-teams.sh.
    const r = run(`cmd_create --name g --password hunter2`)
    expect(r.out).toMatch(/unknown flag/i)
    expect(r.out).not.toContain('API method=')
  })

  it('help does not OFFER a password flag — though it does explain the absence', () => {
    const r = spawnSync('bash', [CLI, 'help'], { encoding: 'utf8', timeout: 60_000 })
    const help = `${r.stdout ?? ''}${r.stderr ?? ''}`

    // A bare `not.toMatch(/--password/)` was the first draft and it FAILED — correctly. The help
    // says "there is deliberately no --password flag anywhere", which is exactly the sentence a
    // reader coming from aimaestro-teams.sh needs, and it contains the string. Asserting the
    // substring's absence would have forced deleting the explanation to satisfy the test.
    //
    // The real property is that no flag ROW offers it. Flag rows are indented and start with the
    // flag; the explanation is prose. So anchor on the shape, not the token.
    expect(help).not.toMatch(/^\s+--password\b/m)

    // Positive half: the absence is explained rather than merely true, so nobody re-adds it by
    // copy-paste from the teams CLI. Without this the assertion above passes on an empty help.
    expect(help).toMatch(/governance-FREE/i)
    expect(help).toMatch(/no --password flag/i)
  })
})

describe('the verbs are REACHABLE through the dispatch, not merely defined', () => {
  it.each(['list', 'notify', 'subscribe'])('`%s` is a real subcommand', (verb) => {
    // ADDED BY DEFAULT after the equivalent hole was found unpinned in teams-stats-verb.test.ts:
    // every closure above calls cmd_* DIRECTLY, so deleting a dispatch line would leave the verb
    // unreachable from the CLI with the whole suite green.
    //
    // Discriminates on WHICH error returns, since this drives the real CLI with no credentials:
    // a dispatched verb reaches the transport (HTTP 401) or its own arg check; an undispatched one
    // dies at `unknown command` before either.
    const r = spawnSync('bash', [CLI, verb], { encoding: 'utf8', timeout: 60_000 })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(out).not.toMatch(/unknown command/i)
  })
})
