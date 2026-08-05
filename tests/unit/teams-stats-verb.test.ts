/**
 * `aimaestro-teams.sh stats` — the all-teams aggregate verb (ai-maestro#64 residual 3).
 *
 * WHY IT EXISTS. CORE's team-kanban skill documented an all-teams task/doc count with no frozen-CLI
 * verb behind it, so the operation sat marked DECOUPLE-BLOCKED: documented, unreachable, and with no
 * verdict either way. `app/api/teams/stats/route.ts` was live the whole time — only the CLI surface
 * was missing, which under R23.8 means the capability formally did not exist.
 *
 * WHY `stats` TAKES NO teamId, and why that is the whole point. Per-team counts were always
 * obtainable by aggregating `tasks <id>` client-side with `jq`; CORE said so. What had no surface was
 * the FLEET-WIDE aggregate — one call instead of N+1. So a `stats <teamId>` that silently accepted
 * and ignored an id would defeat the reason the verb was asked for, which is why the argument-shape
 * assertion below is not pedantry.
 *
 * WHY A SUBPROCESS. The dispatch is a bash `case`, and every real path past it makes an
 * authenticated HTTP call — so driving the CLI for real returns an identical auth failure for every
 * subcommand and could prove nothing about routing (the trap measured on ai-maestro#114, where all
 * five `--status` values returned one 401 because `check_api_running` refuses before dispatch). This
 * sources the script with `_api` stubbed to ECHO its arguments, which is the only altitude at which
 * "which method and path did this verb request" is a positive observation.
 *
 * NOTE ON THE HARNESS. `aimaestro-teams.sh` has no `main`; its dispatch is a top-level `case` that
 * fires on source. So sourcing it RUNS the dispatch (defaulting to `help`) — hence the redirect —
 * and the `_api` stub must be installed AFTER the source, then the `cmd_*` function called directly.
 * A stub defined before the source is simply overwritten by the real one.
 *
 * NEUTER RUNS (2026-08-05 — OBSERVED): repointing `cmd_stats` at `/api/teams` (the `list` route)
 * reddens 3 of the 4 closures — both route closures and the no-id closure — while the `help`
 * closure stays green, since help text is independent of routing. Deleting the `stats)` dispatch
 * line reddens only the `help` closure, because the other three call `cmd_stats` directly and never
 * traverse the dispatch. The two halves are independent and neither alone covers the verb.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const CLI = path.join(REPO, 'scripts', 'aimaestro-teams.sh')

/**
 * Call one `cmd_*` function with the transport stubbed so the request is observable.
 * The source is redirected because it runs the dispatch (see the harness note above).
 */
function run(fn: string): { exit: number; out: string } {
  const harness = `
    source "${CLI}" >/dev/null 2>&1 || true
    _api() { echo "API-CALL method=\$1 path=\$2"; }
    ${fn}
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  return { exit: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('stats requests the all-teams aggregate', () => {
  it('issues GET /api/teams/stats', () => {
    const r = run('cmd_stats')
    expect(r.out).toContain('API-CALL method=GET path=/api/teams/stats')
  })

  it('is not silently the list route', () => {
    // `/api/teams` would "work" and return the wrong thing — the failure mode a
    // status-code-only assertion could never see.
    const r = run('cmd_stats')
    expect(r.out).not.toMatch(/path=\/api\/teams$/m)
  })
})

describe('stats is fleet-wide — it takes no teamId', () => {
  it('does not require an id the way tasks does', () => {
    // `tasks` with no id is an error; `stats` with no id is the normal call. If someone later
    // gives stats a required id, this reds — and the verb stops being the thing #64 asked for.
    const withoutId = run('cmd_stats')
    expect(withoutId.out).toContain('/api/teams/stats')
    expect(withoutId.out).not.toMatch(/teamId required/i)

    const tasksWithoutId = run('cmd_tasks')
    expect(tasksWithoutId.out).toMatch(/teamId required/i)
  })

  it('advertises itself in help without a teamId placeholder', () => {
    const r = spawnSync('bash', [CLI, 'help'], { encoding: 'utf8', timeout: 60_000 })
    const help = `${r.stdout ?? ''}${r.stderr ?? ''}`
    // R23.8: an unannounced verb formally does not exist. `help` is the in-CLI half of announcing.
    expect(help).toMatch(/^\s*stats\s/m)
    expect(help).not.toMatch(/stats <teamId>/)
  })
})
