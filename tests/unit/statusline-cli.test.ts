/**
 * `scripts/aimaestro-statusline.sh` — the ONE component that knows the endpoints (TRDD-D8OYFG35).
 *
 * WHY THIS FILE EXISTS. Every other test in this feature drives the route handler in-process, so
 * not one of them can see the CLI's actual HTTP: a typo in the path, a `-d` where `--data-binary`
 * belongs, the wrong method — all ship green. And the CLI is precisely the piece the decoupling
 * invariant makes load-bearing: plugins and hooks call it INSTEAD of the API, so if it aims at the
 * wrong URL the whole feed is silently dead while every unit test passes.
 *
 * So this drives the real script against a REAL HTTP server on an EPHEMERAL PORT (`listen(0)` — no
 * fixed port, no collision, nothing to clean up but the server itself, closed in `afterAll`).
 *
 * The last test is the true END-TO-END: wrapper → CLI → HTTP, the exact chain that will run in the
 * user's status bar, with only the destination swapped.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { spawn } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { AddressInfo } from 'net'

/**
 * ⚠ ASYNC `spawn`, NEVER `spawnSync` — and this is not style, it is the only thing that makes this
 * file runnable at all.
 *
 * `spawnSync` BLOCKS NODE'S EVENT LOOP, so the in-process HTTP server below can never accept or
 * answer while curl is waiting on it. The connections pile up in the kernel's accept backlog, curl
 * gives up at `--max-time`, and the script correctly reports a network failure — then every queued
 * request is served at once the moment the loop is free again. Measured symptom of the first draft:
 * six tests failing with `exit 1` / "failed (network)", and the LAST test seeing SEVEN requests
 * arrive that its five predecessors had sent. The CLI was correct throughout; the harness was
 * unrunnable.
 */
function run(
  args: string[],
  opts: { input?: string; env?: Record<string, string> } = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn('bash', args, { env: { ...process.env, ...(opts.env ?? {}) } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString('utf-8')))
    child.stderr.on('data', (d) => (stderr += d.toString('utf-8')))
    child.on('close', (status) => resolveRun({ status, stdout, stderr }))
    child.stdin.end(opts.input ?? '')
  })
}

const CLI = resolve(__dirname, '..', '..', 'scripts', 'aimaestro-statusline.sh')
const WRAPPER = resolve(__dirname, '..', '..', 'scripts', 'aimaestro-statusline-capture.sh')

interface Received {
  method: string
  url: string
  contentType: string | undefined
  body: string
}

let server: Server
let base: string
let received: Received[] = []
let dir: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf-8'),
      })
      if (req.url === '/api/statusline/nope') {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'not_found' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, echoed: req.url }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  dir = mkdtempSync(join(tmpdir(), 'aim-sl-cli-'))
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  rmSync(dir, { recursive: true, force: true })
})

/**
 * `AIMAESTRO_API_BASE` is get_api_base's own documented override and is honoured FIRST, so setting
 * it here is not a bypass of the resolution order — it is the top of it. Without it the script
 * would resolve the real host and this suite would POST at the developer's running server.
 */
async function runCli(args: string[], input = '') {
  received = []
  return run([CLI, ...args], { input, env: { AIMAESTRO_API_BASE: base } })
}

const PAYLOAD = JSON.stringify({ session_id: 'cli-test', rate_limits: { five_hour: { used_percentage: 1, resets_at: 1738425600 } } })

describe('ingest', () => {
  it('POSTs to /api/statusline/ingest with the payload VERBATIM from stdin', async () => {
    const r = await runCli(['ingest'], PAYLOAD)
    expect(r.status).toBe(0)
    expect(received).toHaveLength(1)
    expect(received[0].method).toBe('POST')
    expect(received[0].url).toBe('/api/statusline/ingest')
    expect(received[0].contentType).toBe('application/json')
    expect(received[0].body).toBe(PAYLOAD)
  })

  it('preserves a TRAILING NEWLINE — proving --data-binary, not -d', async () => {
    // `curl -d` strips newlines. The payload is not ours to alter, and a body silently mutated in
    // transit is the kind of defect that only shows up as a parse failure on the other side.
    const withNewline = PAYLOAD + '\n'
    await runCli(['ingest'], withNewline)
    expect(received[0].body).toBe(withNewline)
  })

  it('reads the payload from --file when given one — the path the wrapper uses', async () => {
    const f = join(dir, 'payload.json')
    writeFileSync(f, PAYLOAD, 'utf-8')
    const r = await runCli(['ingest', '--file', f])
    expect(r.status).toBe(0)
    expect(received[0].body).toBe(PAYLOAD)
  })

  it('fails, and sends NOTHING, when --file names a file that is not there', async () => {
    const r = await runCli(['ingest', '--file', join(dir, 'absent.json')])
    expect(r.status).not.toBe(0)
    expect(received).toHaveLength(0)
  })
})

describe('get / list', () => {
  it('GETs /api/statusline/<id>', async () => {
    const r = await runCli(['get', 'abc-123'])
    expect(r.status).toBe(0)
    expect(received[0]).toMatchObject({ method: 'GET', url: '/api/statusline/abc-123' })
  })

  it('GETs /api/statusline for the roll-up', async () => {
    const r = await runCli(['list'])
    expect(r.status).toBe(0)
    expect(received[0]).toMatchObject({ method: 'GET', url: '/api/statusline' })
  })

  it('REFUSES a traversal id in the shell, before it ever reaches a URL', async () => {
    // The server validates too, but a shell that hands `../..` to curl has made the server's guard
    // the only thing in the way — and defence that exists in exactly one place is not defence.
    const r = await runCli(['get', '../../etc/passwd'])
    expect(r.status).not.toBe(0)
    expect(received).toHaveLength(0)
    expect(r.stderr).toMatch(/invalid sessionId/)
  })

  it('reports an HTTP error instead of printing an empty body as success', async () => {
    const r = await runCli(['get', 'nope'])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/HTTP 404/)
  })
})

describe('base resolution — the branch PRODUCTION takes, which every test above skips', () => {
  // Every other test in this file sets AIMAESTRO_API_BASE, which `_seed_loopback_base` honours and
  // returns from immediately. So the code that RUNS on a real host — read the port out of
  // hosts.json, fall back to 23000 — was exercised by nothing. That is how a bug ships green: the
  // fixture tests the branch the fixture created.
  //
  // It found one. `${url%%/*}` cuts at the FIRST slash, which in `http://127.0.0.1:PORT` is the one
  // inside `://`, so the "port" was the empty string and every non-default port silently fell back
  // to 23000. NEUTER: drop the `${url#*://}` line and the first test here reddens (nothing arrives
  // at the ephemeral port), while the whole rest of the file stays green.

  async function runWithHome(home: string, args: string[], input = '', env: Record<string, string> = {}) {
    received = []
    return run([CLI, ...args], {
      input,
      // `env -u`-equivalent: build the env WITHOUT the override, so the seed logic actually runs.
      env: { HOME: home, AIMAESTRO_API_BASE: '', AIMAESTRO_PORT: '', ...env },
    })
  }

  it('reads the port out of hosts.json — a scheme in the URL must not eat it', async () => {
    const home = join(dir, 'home-with-hosts')
    mkdirSync(join(home, '.aimaestro'), { recursive: true })
    const port = (server.address() as AddressInfo).port
    writeFileSync(
      join(home, '.aimaestro', 'hosts.json'),
      JSON.stringify({ hosts: [{ id: 'self', type: 'local', url: `http://127.0.0.1:${port}` }] }),
      'utf-8',
    )

    const r = await runWithHome(home, ['ingest'], PAYLOAD)
    expect(r.status).toBe(0)
    expect(received, 'the CLI resolved the wrong port from hosts.json').toHaveLength(1)
    expect(received[0].url).toBe('/api/statusline/ingest')
  })

  it('honours AIMAESTRO_PORT over hosts.json', async () => {
    const home = join(dir, 'home-port-override')
    mkdirSync(join(home, '.aimaestro'), { recursive: true })
    writeFileSync(
      join(home, '.aimaestro', 'hosts.json'),
      JSON.stringify({ hosts: [{ id: 'self', type: 'local', url: 'http://127.0.0.1:1' }] }),
      'utf-8',
    )
    const port = String((server.address() as AddressInfo).port)

    const r = await runWithHome(home, ['ingest'], PAYLOAD, { AIMAESTRO_PORT: port })
    expect(r.status).toBe(0)
    expect(received).toHaveLength(1)
  })

  it('falls back to 23000 — never to an empty or malformed base — with no hosts.json at all', async () => {
    const home = join(dir, 'home-empty')
    mkdirSync(home, { recursive: true })
    // Nothing is listening on 23000 in this fixture's world OR the real server is; either way the
    // claim under test is that the CLI built a WELL-FORMED loopback URL rather than something like
    // `http://127.0.0.1:` — which curl would reject as a malformed URL (exit 3), not a connection
    // failure. So: whatever happens, it must not be a URL-syntax error.
    const r = await runWithHome(home, ['get', 'some-session'])
    expect(r.stderr).not.toMatch(/URL using bad\/illegal format|malformed/i)
  })
})

describe('END TO END — wrapper → CLI → HTTP, the exact chain the status bar runs', () => {
  it('a payload piped into the wrapper arrives at the ingest endpoint', async () => {
    received = []
    const inner = join(dir, 'inner.sh')
    writeFileSync(inner, '#!/usr/bin/env bash\ncat >/dev/null\nprintf "STATUS BAR"\n', 'utf-8')
    chmodSync(inner, 0o755)

    const r = await run([WRAPPER, inner], {
      input: PAYLOAD,
      env: { AIMAESTRO_API_BASE: base, AIMAESTRO_STATUSLINE_CLI: CLI },
    })

    // The bar rendered, untouched, and the wrapper returned without waiting.
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('STATUS BAR')

    // The ingest is detached, so it lands after the wrapper returned. Poll.
    const deadline = Date.now() + 5000
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 25))
    }

    expect(received, 'the detached ingest never reached the server').toHaveLength(1)
    expect(received[0].method).toBe('POST')
    expect(received[0].url).toBe('/api/statusline/ingest')
    expect(received[0].body).toBe(PAYLOAD)
  })
})
