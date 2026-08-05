import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'

// ai-maestro#114 — `aimaestro-agent.sh list --status` advertised four values, two of which could
// never match `Agent.status` (`active | idle | offline | deleted`, types/agent.ts). They failed
// SILENTLY: the jq filter returned `{agents: []}` at exit 0, which reads as "no agents are in that
// state" rather than "that is not a state". The property worth pinning is therefore not the error
// text but the pair (exit code, request-was-made) — an unmatchable status must short-circuit BEFORE
// the HTTP call, and a valid one must reach it.
//
// WHY A SUBPROCESS AND NOT A UNIT CALL. The behaviour lives in a bash `case` inside `cmd_list`, and
// the real entry point `aimaestro-agent.sh` runs `check_api_running || exit 1` at :91 — BEFORE the
// dispatch at :94. So driving the real CLI unauthenticated returns an identical 401 for every value
// and can prove nothing about the filter (measured: all five values, same 401). This harness sources
// `agent-commands.sh` with `list_agents` stubbed, which is the only altitude at which the guard is
// observable without credentials. The stub PRINTS a sentinel, so "the request was never made" is a
// positive observation rather than an absence.

const REPO = path.resolve(__dirname, '../..')
const SCRIPTS = path.join(REPO, 'scripts')

/** Run one `cmd_list --status <value>` against a stubbed transport. */
function runStatus(value: string): { exit: number; requestMade: boolean; stderr: string } {
  const harness = `
    print_error() { echo "Error: $*" >&2; }
    print_info() { :; }
    list_agents() {
      echo "REQUEST-WAS-MADE" >&2
      echo '{"agents":[{"name":"a","status":"offline"},{"name":"b","status":"active"}]}'
    }
    source "${SCRIPTS}/agent-commands.sh"
    cmd_list --status "${value}" --format names
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  return {
    exit: r.status ?? -1,
    requestMade: (r.stderr ?? '').includes('REQUEST-WAS-MADE'),
    stderr: r.stderr ?? '',
  }
}

describe('aimaestro-agent.sh list --status — an unmatchable value is an ERROR, not an empty list (ai-maestro#114)', () => {
  // The positive control. Without it every assertion below passes vacuously when the harness
  // cannot source the script at all — a sourcing failure also yields "no request made".
  it('reaches the transport for a value that IS in the AgentStatus enum', () => {
    const r = runStatus('active')
    expect(r.exit).toBe(0)
    expect(r.requestMade).toBe(true)
  })

  it("passes 'all' through (special-cased before the filter)", () => {
    const r = runStatus('all')
    expect(r.exit).toBe(0)
    expect(r.requestMade).toBe(true)
  })

  it.each(['online', 'bogus', 'ONLINE'])(
    "refuses '%s' before making the request",
    (value) => {
      const r = runStatus(value)
      expect(r.exit).not.toBe(0)
      expect(r.requestMade).toBe(false)
      // Name the valid set in the message: the whole failure mode was a caller who could not tell
      // "wrong word" from "empty fleet", so the error has to teach the right word.
      expect(r.stderr).toMatch(/Valid values: active, idle, offline, deleted, all/)
    },
  )

  it("refuses 'hibernated' with its OWN reason, not the generic one", () => {
    // Separate case because it is the value a caller reaches for deliberately: plugin#55 tells
    // consumers to stop inferring liveness from `Agent.status`, and this flag looks exactly like
    // that fix while being unable to work — hibernated agents read `offline`.
    const r = runStatus('hibernated')
    expect(r.exit).not.toBe(0)
    expect(r.requestMade).toBe(false)
    expect(r.stderr).toMatch(/hibernation is not carried by Agent\.status/)
  })

  it('advertises exactly the enum in --help (the help was wrong in BOTH directions)', () => {
    const r = spawnSync('bash', ['-c', `source "${SCRIPTS}/agent-commands.sh"; cmd_list --help`], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    const out = r.stdout ?? ''
    expect(out).toContain('active, idle, offline, deleted, all')
    // The two that could never match must not be advertised anywhere in the help body — the old
    // text taught both by example as well as in the options list.
    expect(out).not.toMatch(/--status online/)
    expect(out).not.toMatch(/--status hibernated/)
  })
})
