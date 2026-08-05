/**
 * `aimaestro-agent.sh subconscious <agent>` — the thin GET wrapper (ai-maestro#64 residual 1).
 *
 * WHY IT EXISTS. The route and the skill-level capability both already shipped; what was missing
 * was any way to reach it from the frozen CLI, so an agent had to call the HTTP API directly —
 * exactly the R23 bypass the script layer exists to prevent.
 *
 * THE PROPERTY WORTH PINNING IS NOT "it prints something". It is that a REFUSAL never renders as
 * `not running`. The response carries `isRunning`, and the service returns 403 for an agent
 * reading someone else's status — so a naive wrapper that piped any body through `jq` would print
 * "not running" for a permissions error, turning "I could not look" into "that agent is
 * unhealthy". That conflation is the same one `cmd_hibernation` guards against, and it is the
 * only thing here a future edit is likely to break.
 *
 * WHY A SUBPROCESS, AND WHY `curl` IS THE STUB. The behaviour is bash inside `cmd_subconscious`,
 * and the real entry point runs `check_api_running || exit 1` before dispatch, so driving the CLI
 * for real returns one identical failure regardless of input (the trap measured on #114).
 * Stubbing `curl` makes "which URL was requested" and "what the wrapper did with the body" both
 * positive observations.
 *
 * NEUTER RUN (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   line 299 (`cmd_subconscious`'s `has("error")` guard) → `if false; then`
 *   → 1 red: `an error body is surfaced, never rendered as "not running"`. The other three stay
 *     green, correctly — none of them sends an error body, which is what makes that one closure
 *     the sole pin on the conflation guard.
 *
 *   ANCHOR THAT NEUTER TO THE LINE NUMBER, NOT THE CODE SHAPE. `cmd_hibernation` carries a
 *   byte-identical guard, so a shape-matched `s/if echo "$response" | jq -e …/` mutates BOTH
 *   (measured: "2 ins / 2 del", and a contaminated 3-red that says nothing about this verb).
 *   Count the matching sites before running, and discard any run whose diff touched more than
 *   the one you aimed at.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const SCRIPTS = path.join(path.resolve(__dirname, '../..'), 'scripts')

const OK_BODY = JSON.stringify({
  agentId: 'a-1',
  agentName: 'alpha',
  isRunning: true,
  status: { startedAt: '2026-08-05T10:00:00Z', lastMessageRun: '2026-08-05T12:00:00Z', totalMessageRuns: 7 },
})

/**
 * The stub records its argv to a FILE, not to stderr, because the code under test calls
 * `curl … 2>/dev/null` — a stderr sentinel is swallowed by the script itself, so the URL would
 * read as "no request was made" for a request that was in fact made. Measured: the first draft
 * used stderr and reported an empty URL while the body came through fine.
 */
function run(args: string, body: string): { exit: number; out: string; url: string; requested: boolean } {
  const urlFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aim-subc-')), 'url.txt')
  const stubs = `
    print_error() { echo "Error: $*" >&2; }
    print_info() { :; }
    resolve_agent() { RESOLVED_AGENT_ID="a-1"; RESOLVED_ALIAS="alpha"; return 0; }
    get_api_base() { echo "http://127.0.0.1:1"; }
    _build_auth_args() { :; }
    curl() { echo "$*" > "${urlFile}"; cat <<'BODY_EOF'
${body}
BODY_EOF
    }
  `
  const harness = `
    ${stubs}
    source "${SCRIPTS}/agent-commands.sh" >/dev/null 2>&1
    ${stubs}
    cmd_subconscious ${args}
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  const url = fs.existsSync(urlFile) ? fs.readFileSync(urlFile, 'utf8') : ''
  return {
    exit: r.status ?? -1,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    url,
    requested: url !== '',
  }
}

describe('subconscious verb', () => {
  it('an error body is surfaced, never rendered as "not running"', () => {
    // THE load-bearing case. Without the guard the wrapper prints "not running" for a 403, and a
    // permissions failure reads as an unhealthy agent.
    const r = run('alpha', JSON.stringify({ error: 'Forbidden — you may only read your own subconscious status' }))
    expect(r.exit).not.toBe(0)
    expect(r.out).toMatch(/Forbidden/)
    expect(r.out).not.toMatch(/not running/)
  })

  it('requests the real route — no /status segment', () => {
    // The memory-search skill documents `/subconscious/status`, which does not exist. If this
    // wrapper ever "helpfully" matched that doc, every call would 404.
    const r = run('alpha --json', OK_BODY)
    expect(r.url).toContain('/api/agents/a-1/subconscious')
    expect(r.url).not.toContain('/subconscious/status')
  })

  it('--json passes the body through unchanged', () => {
    const r = run('alpha --json', OK_BODY)
    expect(r.exit).toBe(0)
    expect(JSON.parse(r.out.trim().split('\n').filter((l) => l.startsWith('{'))[0])).toMatchObject({ isRunning: true })
  })

  it('omitting the agent refuses before any request', () => {
    // Positive control on the other side: proves the request is reachable at all in this harness,
    // so `requested: false` above would be meaningful.
    const r = run('', OK_BODY)
    expect(r.exit).not.toBe(0)
    expect(r.requested).toBe(false)
  })
})
