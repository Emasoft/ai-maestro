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
  // Stub the sourced helpers: check_jq passes, and _api CAPTURES the request as a
  // single line `API <METHOD> <PATH> <BODY>` instead of hitting the network. The
  // script sources ${SCRIPT_DIR}/shell-helpers/common.sh first, so this wins.
  writeFileSync(
    join(dir, 'shell-helpers', 'common.sh'),
    'check_jq() { return 0; }\n_api() { printf "API %s %s %s\\n" "$1" "$2" "${3:-}"; }\n',
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
