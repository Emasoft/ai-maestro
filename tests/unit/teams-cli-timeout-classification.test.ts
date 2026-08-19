/**
 * TRDD-ARY3NRFC — the teams CLI must not report a curl TIMEOUT as a network failure.
 *
 * Measured live 2026-08-19: POST /api/teams (auto-COS spawn + plugin install) and the
 * cascade DELETE run ~2 min server-side while _api used `--max-time 30`. Every slow call
 * printed `failed (network)` and exited 1 WHILE THE OPERATION SUCCEEDED — so a caller
 * that reasonably retried produced a DUPLICATE team + a second auto-COS agent.
 *
 * What each closure discriminates:
 *  - exit-28 classification runs the REAL _api against a REAL socket that accepts and
 *    never responds (curl genuinely times out): exit 124, message names the timeout and
 *    verify-before-retry, and must NOT contain "(network" — the old message IS the bug.
 *  - the refused-connection control proves the classification is SPECIFIC: curl exit 7
 *    (ECONNREFUSED) must still be reported as network (exit 1), never as a timeout —
 *    without this, a classifier that labels EVERY curl failure "timeout" passes test 1.
 *  - the max-time wiring stubs `curl` as a bash function (the _api boundary) and asserts
 *    the slow verb (create) passes 300 while a read (list) keeps the 30 default — an
 *    end-to-end timeout test for the 300s path would take 300 real seconds.
 *
 * NEUTER RUN (2026-08-19, fix committed first, mutation applied then reverted):
 *   n1. delete the `[ "$rc" -eq 28 ]` branch in _api → the exit-28 test reds (exit 1 +
 *       "(network, curl exit 28)") and the refused control stays green — exactly the
 *       one-test attribution expected.
 *   n2. revert `--max-time "$max_time"` to a literal 30 → only the wiring test reds
 *       (create shows --max-time 30); the classification tests stay green (they drive
 *       the 1s env path, which a literal would also break — but n2 keeps the env seam
 *       out: with a literal 30 the env test times out at 30s > curl 1s never fires…
 *       measured: the exit-28 test also reds by TIMEOUT of the spawn guard, attributed).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { spawnSync } from 'child_process'
import { createServer, type Server, type Socket, type AddressInfo } from 'net'
import * as path from 'path'

vi.setConfig({ testTimeout: 30_000 })

const REPO = path.resolve(__dirname, '../..')
const CLI = path.join(REPO, 'scripts', 'aimaestro-teams.sh')

// A socket that ACCEPTS the TCP connection and never writes a byte: curl connects,
// sends the request, and waits until --max-time expires → exit 28. This is the real
// timeout shape (request reached a live listener), not a connect failure.
let blackhole: Server
let blackholePort = 0
const held: Socket[] = []
// A port that REFUSES: listen then close, reuse the number. Small race window is
// acceptable — nothing else binds ephemeral ports between close and the test's curl.
let refusedPort = 0

beforeAll(async () => {
  blackhole = createServer(sock => { held.push(sock) })
  await new Promise<void>(res => blackhole.listen(0, '127.0.0.1', res))
  blackholePort = (blackhole.address() as AddressInfo).port
  const tmp = createServer()
  await new Promise<void>(res => tmp.listen(0, '127.0.0.1', res))
  refusedPort = (tmp.address() as AddressInfo).port
  await new Promise<void>(res => tmp.close(() => res()))
})

afterAll(async () => {
  for (const s of held) s.destroy()
  await new Promise<void>(res => blackhole.close(() => res()))
})

function runApi(port: number, extraEnv: Record<string, string> = {}) {
  // Real _api, real curl. `|| rc=$?` because the sourced CLI sets -e.
  const harness = `
    source "${CLI}" >/dev/null 2>&1 || true
    rc=0
    _api GET "/api/teams" || rc=$?
    echo "EXIT=$rc"
  `
  const r = spawnSync('bash', ['-c', harness], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      AIMAESTRO_API_BASE: `http://127.0.0.1:${port}`,
      AID_AUTH: 'test-token-ary3nrfc',
      AIMAESTRO_API_MAX_TIME: '1',
      ...extraEnv,
    },
  })
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('_api curl-failure classification (TRDD-ARY3NRFC)', () => {
  it('a --max-time expiry (curl 28) exits 124 with verify-before-retry, never "(network"', () => {
    const r = runApi(blackholePort)
    expect(r.out).toContain('EXIT=124')
    expect(r.out).toMatch(/timed out after 1s/)
    expect(r.out).toMatch(/verify with 'show'\/'list' BEFORE retrying/)
    // The old message is the bug under test — its absence is the fix.
    expect(r.out).not.toContain('(network')
  })

  it('control: a refused connection (curl 7) is still a network failure, exit 1', () => {
    const r = runApi(refusedPort)
    expect(r.out).toContain('EXIT=1')
    expect(r.out).toContain('(network, curl exit 7)')
    expect(r.out).not.toMatch(/timed out/)
  })
})

describe('slow-verb max-time wiring', () => {
  function runWithCurlStub(fn: string) {
    // Stub curl AFTER the source so the real one is replaced; print argv to stderr and
    // return a valid 200 shape so _api completes. Asserting on the stub's argv pins the
    // boundary value without waiting out a real 300s timeout.
    const harness = `
      source "${CLI}" >/dev/null 2>&1 || true
      curl() { echo "CURL-ARGS $*" >&2; printf '{}\\n200'; }
      ${fn}
    `
    const r = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, AID_AUTH: 'test-token-ary3nrfc' },
    })
    return { out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

  it('create (auto-COS pipeline) passes --max-time 300', () => {
    const r = runWithCurlStub('cmd_create --name ary3nrfc-t')
    expect(r.out).toContain('CURL-ARGS')
    expect(r.out).toContain('--max-time 300')
  })

  it('a read verb (list) keeps the 30s default', () => {
    const r = runWithCurlStub('cmd_list')
    expect(r.out).toContain('--max-time 30 ')
    expect(r.out).not.toContain('--max-time 300')
  })
})
