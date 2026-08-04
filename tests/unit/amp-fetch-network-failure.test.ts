/**
 * TRDD-2U56TLBX — an unreachable AMP provider must be reported as UNREACHABLE, must not
 * stop the other providers, and must not be reported as an empty inbox.
 *
 * THE BUG. `amp-fetch.sh` runs under `set -eo pipefail` and captured curl with
 * `RESPONSE=$(curl …)`. Under `set -e` an assignment whose command substitution fails takes
 * the script down with that command's exit status, so an unreachable provider (curl exit 7)
 * killed the script AT THE ASSIGNMENT — before any line that inspects HTTP_CODE. The
 * script's own `elif [ "$HTTP_CODE" = "000" ]` branch, which prints "Could not connect", was
 * unreachable dead code, and with no ERR trap anywhere the caller got a bare `exit 7` and no
 * output whatsoever. The abort was inside the per-provider loop, so ONE unreachable provider
 * stopped the agent fetching from every other provider.
 *
 * WHY THE OBVIOUS FIX IS HALF A FIX, and why this file asserts the exit status. Guarding the
 * assignment with `|| true` makes the diagnostic print — and then the summary went on to say
 * "No new messages from external providers" and exit 0. Measured. That trades a silent crash
 * for a silent lie, which is worse: an agent polling its inbox during an outage concludes it
 * has no mail. So the tests below assert all three of (diagnostic printed), (no empty-inbox
 * claim), and (non-zero exit) — a fix that stops at the first two passes nothing here.
 *
 * REAL SERVER, NOT A MOCK. The healthy provider is an actual HTTP server on an ephemeral
 * port, and "was it reached" is asserted from the SERVER's own request count rather than
 * from log text — log text would also match a script that printed a banner and then died.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execFileSync } from 'child_process'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO, 'scripts', 'amp-fetch.sh')

/** Port 1 is privileged and unbound: curl fails to connect instantly (exit 7, HTTP 000). */
const UNREACHABLE = 'http://127.0.0.1:1'

let server: http.Server
let healthyUrl: string
let hits: string[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? '')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ messages: [] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('server did not bind a port')
  healthyUrl = `http://127.0.0.1:${addr.port}`
}, 20_000)

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

/**
 * A self-contained AMP home. `AMP_DIR` is the helper's highest-priority override, so nothing
 * here can touch the developer's real ~/.agent-messaging.
 */
function ampHome(providers: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-fetch-test-'))
  fs.mkdirSync(path.join(dir, 'registrations'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true })
  execFileSync('openssl', [
    'genpkey', '-algorithm', 'ED25519', '-out', path.join(dir, 'keys', 'private.pem'),
  ])
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      agent: {
        name: 'probe-agent',
        address: 'probe@local',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        createdAt: '2026-01-01T00:00:00Z',
        tenant: 'default',
        fingerprint: 'x',
      },
    }),
  )
  for (const [name, apiUrl] of Object.entries(providers)) {
    fs.writeFileSync(
      path.join(dir, 'registrations', `${name}.json`),
      JSON.stringify({ apiUrl, apiKey: 'k', address: `probe@${name}` }),
    )
  }
  return dir
}

/**
 * ASYNC spawn, deliberately — `spawnSync` BLOCKS this worker's event loop, so the HTTP
 * server above (same thread) can never accept the connection. Measured: every request to the
 * healthy provider hung until curl's `--max-time 15` and the "reachable" control failed
 * looking exactly like a broken script. The harness was the broken thing.
 */
function runFetch(dir: string): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', [SCRIPT, '-v'], { env: { ...process.env, AMP_DIR: dir } })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (status) => resolve({ status, out }))
  })
}

describe('amp-fetch reports an unreachable provider honestly (TRDD-2U56TLBX)', () => {
  beforeAll(() => { hits = [] })

  it('POSITIVE CONTROL: a reachable provider with an empty inbox exits 0 and says so', async () => {
    // Without this, every assertion below is satisfied by a script that fails on everything.
    hits = []
    const dir = ampHome({ good: healthyUrl })
    try {
      const { status, out } = await runFetch(dir)
      expect(status, out).toBe(0)
      expect(out).toMatch(/No new messages from external providers\./)
      expect(hits, 'the healthy provider was never actually contacted')
        .toContain('/v1/messages/pending')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('an unreachable provider PRINTS its diagnostic, refuses the empty-inbox claim, and exits non-zero', async () => {
    const dir = ampHome({ down: UNREACHABLE })
    try {
      const { status, out } = await runFetch(dir)

      // (1) the branch that was unreachable dead code now runs at all
      expect(out, 'the HTTP 000 branch is still unreachable').toMatch(/Could not connect to down/)
      // (2) it must NOT be reported as an empty inbox — the silent lie the half-fix produced
      expect(out).not.toMatch(/No new messages from external providers\./)
      // (3) and the caller must be able to tell could-not-run from nothing-to-read
      expect(status, out).not.toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('one unreachable provider does NOT stop the others — the healthy sibling is still fetched', async () => {
    // The consequence that motivated the card, and the one no single-provider test can see.
    // `a-down` sorts before `b-good`, so the failing provider is reached FIRST: under the old
    // code the loop died on it and `b-good` was never contacted at all.
    hits = []
    const dir = ampHome({ 'a-down': UNREACHABLE, 'b-good': healthyUrl })
    try {
      const { status, out } = await runFetch(dir)

      // Asserted on the SERVER's own record, not on log text: a banner proves nothing about
      // whether the request was made.
      expect(hits, 'the healthy sibling was never contacted — the loop still aborts')
        .toContain('/v1/messages/pending')
      expect(out).toMatch(/Could not connect to a-down/)
      expect(status, out).not.toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
