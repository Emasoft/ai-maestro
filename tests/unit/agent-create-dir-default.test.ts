/**
 * `aimaestro-agent.sh create <name>` — `--dir` is OPTIONAL and defaults to `~/agents/<name>/`
 * (ai-maestro#76 op 2).
 *
 * WHY THE DEFAULT IS NOT A NEW CONVENTION. `~/agents/<name>/` is already the ONLY place an agent
 * folder may live: the Wizard's G03-ENFORCE guard rejects any other target, and `DeleteAgent`
 * refuses `alsoDeleteFolder` for a workdir outside it. Requiring `--dir` made every caller retype
 * the one path the server would accept, and invited them to type a different one and be refused
 * later.
 *
 * WHAT IS ASSERTED, AND WHY NOT THE ANNOUNCEMENT. The script prints "using the default agent
 * folder: …", but asserting on that would pin the MESSAGE rather than the behaviour — a default
 * that announced one path and sent another would pass. So these drive the value DOWNSTREAM: the
 * `workingDirectory` in the POST body, which is what actually creates the agent.
 *
 * WHY A SUBPROCESS. The default is a bash assignment inside `cmd_create`, and the real entry point
 * runs `check_api_running || exit 1` before its dispatch table, so driving the CLI for real returns
 * one auth failure regardless of arguments and proves nothing (the trap measured on #114). This
 * sources `agent-commands.sh` with `curl` stubbed to echo its argv, which is the only altitude at
 * which "the payload carried this path" is a positive observation.
 *
 * $HOME IS REDIRECTED, AND THE REDIRECTION IS PROVEN. `dir="$HOME/agents/$name"` is read at
 * runtime, so a per-spawn `HOME` reaches it — but "the fake home took effect" cannot be assumed:
 * the containment test below counts the developer's REAL `~/agents` before and after and fails if
 * it moved. Without that, a broken redirect would create real folders while every other assertion
 * still passed.
 *
 * NEUTER RUN (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   `dir="$HOME/agents/$name"` → `dir="$HOME/agents/WRONG"`
 *   → 1 red: `defaults to ~/agents/<name> when --dir is omitted`. The explicit-`--dir` control
 *     and the containment check stay green, correctly — neither depends on the default's VALUE,
 *     and that is what makes the first assertion the only one pinning it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const SCRIPTS = path.join(REPO, 'scripts')
const REAL_AGENTS = path.join(os.homedir(), 'agents')

let fakeHome: string

function countReal(): number {
  try {
    return fs.readdirSync(REAL_AGENTS).length
  } catch {
    return -1
  }
}

/** Drive `cmd_create` with the network stubbed and HOME redirected; return the POST payload. */
function create(args: string): { exit: number; payload: string; stderr: string } {
  const stubs = `
    print_error() { echo "Error: $*" >&2; }
    print_info() { echo "INFO: $*" >&2; }
    print_success() { :; }
    print_warning() { :; }
    print_step() { :; }
    # agent-commands.sh is a MODULE — the real entry point sources the helpers before it, so
    # these are undefined here. Stubbed permissively on purpose: this file is about the --dir
    # default, and it must not fail (or pass) on name-validation or duplicate-name behaviour,
    # which have their own owners.
    validate_agent_name() { return 0; }
    check_agent_exists() { return 1; }
    create_project_template() { :; }
    get_api_base() { echo "http://127.0.0.1:1"; }
    _build_auth_args() { :; }
    check_api_running() { return 0; }
    curl() { echo "PAYLOAD-BEGIN $* PAYLOAD-END" >&2; echo '{"agent":{"id":"11111111-1111-4111-8111-111111111111"}}'; }
  `
  const harness = `
    export HOME="${fakeHome}"
    ${stubs}
    source "${SCRIPTS}/agent-commands.sh" 2>/dev/null || true
    ${stubs}
    cmd_create ${args}
  `
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  const stderr = r.stderr ?? ''
  const m = stderr.match(/PAYLOAD-BEGIN([\s\S]*?)PAYLOAD-END/)
  return { exit: r.status ?? -1, payload: m ? m[1] : '', stderr }
}

beforeAll(() => {
  // realpathSync is LOAD-BEARING, not tidiness: on macOS `/var` is a symlink to `/private/var`,
  // and the script canonicalizes the path before sending it. Comparing against the un-resolved
  // mkdtemp string fails on every assertion here while the code is entirely correct — a typed
  // string vs a kernel realpath.
  fakeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aim-create-dir-')))
})
afterAll(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

describe('create --dir is optional', () => {
  it('defaults to ~/agents/<name> when --dir is omitted', () => {
    const r = create('defaulted-agent')
    // The behavioural claim: the path the POST body carries, not the one it printed.
    expect(r.payload).toContain(`${fakeHome}/agents/defaulted-agent`)
  })

  it('an explicit --dir still wins over the default', () => {
    // Positive control. Without it the file would pass against a build that hardcoded the
    // default and ignored the flag entirely.
    const r = create(`explicit-agent --dir ${fakeHome}/somewhere-else`)
    expect(r.payload).toContain(`${fakeHome}/somewhere-else`)
    expect(r.payload).not.toContain('agents/explicit-agent')
  })
})

describe('containment', () => {
  it('creates nothing in the real ~/agents', () => {
    // This is what makes every assertion above trustworthy: if the HOME redirect failed, the
    // script would have created REAL agent folders and the other tests would still be green.
    const before = countReal()
    create('containment-probe')
    expect(countReal()).toBe(before)
  })
})
