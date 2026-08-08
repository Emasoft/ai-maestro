/**
 * ai-maestro#137 — the teams CLI must emit a githubProject payload the routes ACCEPT.
 *
 * The pre-fix CLI emitted `{githubProject: {owner, repo}}` with NO `number`, while
 * CreateTeamSchema/UpdateTeamSchema require `number` and are `.strict()` — so EVERY use of the
 * flags produced a rejected request ("cannot attach any board at all", not merely "cannot
 * express org boards"). Found by the COS session the moment #133 Half 2 unblocked its call path:
 * the repo's own DECOUPLE-BLOCKED workaround had avoided the path, so nothing had ever sent the
 * payload that reveals the flags don't work — two bugs masking each other.
 *
 * What each closure discriminates (per the acceptance criterion recorded on the COS's card):
 *  - the org-board payload asserts the ABSENCE of `repo` explicitly — asserting owner+number
 *    alone passes happily while a fabricated `repo: owner` rides along beside them, and that
 *    fabrication is the tempting shortcut that makes an org URL fit the old required-repo shape;
 *  - `number` must be a JSON NUMBER (`"number":7`), not a string — `--arg` yields strings and
 *    only the `tonumber` in the jq expression converts it, so the wrong shape is one deleted
 *    token away and z.number() rejects it;
 *  - the flag-validation refusals must fire BEFORE any transport call (no API-CALL marker), and
 *    the happy path is the positive control proving the marker CAN appear — an absence
 *    assertion over a probe that never fires is vacuous in both directions.
 *
 * Harness: same as teams-stats-verb.test.ts — the CLI has no `main` (top-level case dispatch
 * runs on source, hence the redirect), and the `_api` stub must be installed AFTER the source
 * or the real one overwrites it.
 *
 * NEUTER RUN (2026-08-08 — fix committed FIRST, mutations reverted to the committed blob):
 *   n1. delete `number: ($ghn | tonumber)` from cmd_create's payload → "org-level board" +
 *       "number is a JSON NUMBER" red (schema shape gone), create-side only by construction.
 *   n2. make the create repo conditional unconditional (`+ {repo: $ghr}`) → the org-board
 *       ABSENCE assertion red alone — the fabrication guard, exactly the mutation the card
 *       warned a fields-you-expect test would miss.
 *   Each neuter reds only its named tests; the update-side closures stay green under both
 *   (they drive cmd_update's separate jq expression) and have their own shape assertions.
 */

import { describe, it, expect, vi } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'

// Same rationale as teams-stats-verb.test.ts: bash spawn + source under full-suite CPU
// contention intermittently exceeds vitest's 5s default; the subprocess carries its own guard.
vi.setConfig({ testTimeout: 30_000 })

const REPO = path.resolve(__dirname, '../..')
const CLI = path.join(REPO, 'scripts', 'aimaestro-teams.sh')

function run(fn: string): { exit: number; out: string } {
  const harness = `
    source "${CLI}" >/dev/null 2>&1 || true
    _api() { echo "API-CALL method=\$1 path=\$2 body=\$3"; }
    ${fn}
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  return { exit: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('create --gh-owner/--gh-number — the payload the route accepts (#137)', () => {
  it('org-level board: {owner, number} with repo ABSENT — never a fabricated repo', () => {
    const r = run('cmd_create --name t --gh-owner acme --gh-number 7')
    expect(r.out).toContain('API-CALL method=POST path=/api/teams')
    expect(r.out).toContain('"githubProject":{"owner":"acme","number":7}')
    // The explicit absence: a `repo` riding along (e.g. repo: owner) satisfies every
    // presence assertion above and is exactly the forbidden shortcut.
    expect(r.out).not.toContain('"repo"')
  })

  it('repo-scoped board: repo present beside owner and number', () => {
    const r = run('cmd_create --name t --gh-owner acme --gh-number 7 --gh-repo widgets')
    expect(r.out).toContain('"owner":"acme"')
    expect(r.out).toContain('"number":7')
    expect(r.out).toContain('"repo":"widgets"')
  })

  it('number is a JSON NUMBER, not a string', () => {
    const r = run('cmd_create --name t --gh-owner acme --gh-number 7')
    expect(r.out).toContain('"number":7')
    expect(r.out).not.toContain('"number":"7"')
  })
})

describe('flag validation refuses BEFORE the transport (#137)', () => {
  it('--gh-owner without --gh-number: pair error, no API call', () => {
    const r = run('cmd_create --name t --gh-owner acme')
    expect(r.exit).not.toBe(0)
    expect(r.out).toMatch(/--gh-owner and --gh-number must be given together/)
    expect(r.out).not.toContain('API-CALL')
  })

  it('--gh-repo alone: pair error, no API call (repo is the optional flag, not a key)', () => {
    const r = run('cmd_update tid --gh-repo widgets')
    expect(r.exit).not.toBe(0)
    expect(r.out).toMatch(/--gh-owner and --gh-number must be given together/)
    expect(r.out).not.toContain('API-CALL')
  })

  it('non-integer --gh-number: refused with the specific reason, no API call', () => {
    const r = run('cmd_create --name t --gh-owner acme --gh-number abc')
    expect(r.exit).not.toBe(0)
    expect(r.out).toMatch(/--gh-number must be a positive integer/)
    expect(r.out).not.toContain('API-CALL')
  })
})

describe('update carries the same corrected shape (#137)', () => {
  it('org-level board via PUT: {owner, number}, repo absent', () => {
    const r = run('cmd_update tid --gh-owner acme --gh-number 7')
    expect(r.out).toContain('API-CALL method=PUT path=/api/teams/tid')
    expect(r.out).toContain('"githubProject":{"owner":"acme","number":7}')
    expect(r.out).not.toContain('"repo"')
  })

  it('repo-scoped board via PUT: repo present, number a JSON number', () => {
    const r = run('cmd_update tid --gh-owner acme --gh-number 7 --gh-repo widgets')
    expect(r.out).toContain('"repo":"widgets"')
    expect(r.out).toContain('"number":7')
  })
})
