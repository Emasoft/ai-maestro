/**
 * CLI smoke test for `aimaestro-continuity.sh restart-self` (TRDD-4P1M8I18 Phase 3).
 *
 * restart-self is the frozen-layer twin of POST /api/sessions/me/restart — the
 * SELF-ONLY-BY-CONSTRUCTION self-restart. This test proves the CLI contract WITHOUT
 * a live server or any real tmux session: it runs the REAL script against a fake
 * `shell-helpers/common.sh` that stubs `_api` into a one-line capture of
 * (method, path, body), so we can assert exactly which request the verb builds.
 *
 * The load-bearing assertion is the self-by-construction invariant: restart-self
 * must issue EXACTLY ONE request — POST /api/sessions/me/restart — and must NEVER
 * do a `GET /api/agents?q=…` target lookup (that would re-introduce a nameable
 * target, defeating the whole design). --force maps to ?force=true; any positional
 * argument is rejected (no target is accepted at all).
 *
 * 0-IMPACT: the script is copied into a fresh OS temp dir with a stub common.sh; no
 * server, no network, no real agent — the stubbed _api merely echoes the request.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

const REAL_SCRIPT = join(process.cwd(), 'scripts', 'aimaestro-continuity.sh')

let dir: string
let script: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-continuity-cli-'))
  script = join(dir, 'aimaestro-continuity.sh')
  copyFileSync(REAL_SCRIPT, script)
  mkdirSync(join(dir, 'shell-helpers'), { recursive: true })
  // Stub the sourced helpers ONE LAYER DOWN from where this file used to stub them.
  //
  // It used to define `_api` here, on the theory that "the script sources common.sh
  // first, so this wins". That stopped being true at 20f44bad (TRDD-39OPYXQ9), which
  // moved `_api` INTO the script, defined AFTER the source line — so the script's own
  // `_api` shadowed the stub, called the real get_api_base, and died exit 127
  // (`get_api_base: command not found`). Both request-shape tests went red on a
  // fixture defect, not a behaviour change.
  //
  // So the capture now lives in a `curl` shadow, and the real `_api` runs end to end:
  // base resolution, auth args, the status-code parse, the >=400 branch. Only the
  // network is faked. The capture line is emitted by the request, so a verb that never
  // reaches `_api` (the positional-target rejection) still prints no `API` line — the
  // property the third test relies on. The fake response is a body line plus `200`,
  // matching `-w '\n%{http_code}'`, so the parse below the call sees a real status.
  //
  // curl's argv: `-s -w <fmt> --max-time 30 -X <METHOD> [auth/sudo -H …] [-H … -d <BODY>] <URL>`.
  // The URL is the LAST arg; METHOD follows -X; BODY follows -d. Nothing else is parsed.
  writeFileSync(
    join(dir, 'shell-helpers', 'common.sh'),
    [
      'check_jq() { return 0; }',
      'get_api_base() { printf "%s" "http://stub"; }',
      'get_auth_args() { eval "$1=()"; }',
      'curl() {',
      '  local method="" body="" url="" prev=""',
      '  for a in "$@"; do',
      '    case "$prev" in -X) method="$a";; -d) body="$a";; esac',
      '    prev="$a"; url="$a"',
      '  done',
      '  printf "API %s %s %s\\n" "$method" "${url#http://stub}" "${body:-}"',
      '  printf "{}\\n200\\n"',
      '}',
      '',
    ].join('\n'),
  )
})

afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function run(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync('bash', [script, ...args], { encoding: 'utf8' })
    return { out, code: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number }
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 }
  }
}

describe('aimaestro-continuity.sh restart-self — self-only by construction', () => {
  it('issues exactly POST /api/sessions/me/restart and NO target lookup', () => {
    const { out, code } = run(['restart-self'])
    expect(code).toBe(0)
    const lines = out.trim().split('\n').filter((l) => l.startsWith('API '))
    // The self-by-construction invariant: one request, to the /me/ route, and
    // never a GET /api/agents?q=… that would take a nameable target.
    expect(lines).toEqual(['API POST /api/sessions/me/restart {}'])
    expect(out).not.toMatch(/\/api\/agents\?q=/)
  })

  it('--force maps to ?force=true (still the /me/ route, still one request)', () => {
    const { out, code } = run(['restart-self', '--force'])
    expect(code).toBe(0)
    const lines = out.trim().split('\n').filter((l) => l.startsWith('API '))
    expect(lines).toEqual(['API POST /api/sessions/me/restart?force=true {}'])
  })

  it('rejects a positional target argument (no target is accepted)', () => {
    const { out, code } = run(['restart-self', 'some-other-agent'])
    expect(code).toBe(1)
    expect(out).toMatch(/takes no target/i)
    expect(out).not.toMatch(/API POST/) // never reached _api
  })

  it('help lists restart-self as self-only with no target', () => {
    const { out, code } = run(['--help'])
    expect(code).toBe(0)
    expect(out).toMatch(/restart-self \[--force\]/)
    expect(out).toMatch(/takes no target/)
  })
})
