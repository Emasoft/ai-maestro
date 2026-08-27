/**
 * TRDD-9MZQ4T7E — the PTY half the sibling file (maestro-sudo-gate.test.ts) deliberately
 * stops at: the password is TYPED at a real terminal. node-pty (a core dependency) gives
 * the child a genuine controlling tty, so `read -rs < /dev/tty` and `printf > /dev/tty`
 * run for real — no script(1), so no macOS/Linux syntax divergence.
 *
 * Pinned here, each against what the SERVER RECEIVED and what `ps` SAW, never log text:
 *   P1 wrong password → the exchange 403s, NO token is minted, the strict request is
 *      never sent (server saw exactly one request, the exchange itself).
 *   P2 the password never reaches argv: the stub runs `ps -eo args` synchronously WHILE
 *      the exchange request is in flight (curl and its bash parent are alive at that
 *      instant), and the typed secret is absent from every process argument. Also absent
 *      from the pty output (read -rs does not echo).
 *   P3 positive control: a correct exchange mints a token and the strict request arrives
 *      carrying it as X-Sudo-Token — proving P1's zero is the gate refusing, not a
 *      harness that never reached the prompt.
 * `history` is not driven: a non-interactive bash writes none, and the secret never
 * forms part of a command line (P2), so there is nothing for history to record.
 *
 * Neuter: in common.sh::maestro_sudo_ensure replace `if [ -z "$_tok" ]; then` with
 * `if false; then` → P1 must red (a DELETE arrives with an empty token), P3 stays green.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn as ptySpawn } from 'node-pty'
import { execFileSync } from 'child_process'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO = path.resolve(__dirname, '..', '..')
const TEAMS = path.join(REPO, 'scripts', 'aimaestro-teams.sh')
const TEAM_ID = '11111111-2222-3333-4444-555555555555'
// Distinctive enough that a match in ps/pty output can only be the secret itself.
const SECRET = 'wrong-pw-9MZQ4T7E-x7q2'
const GOOD = 'right-pw-9MZQ4T7E-k4m8'
const TOKEN = 'tok-9MZQ4T7E-minted'

interface Seen { method: string; url: string; sudo: string | undefined; body: string }

let server: http.Server
let seen: Seen[]
let psSnapshot: string
let apiBase: string
let fakeHome: string

beforeEach(async () => {
  seen = []
  psSnapshot = ''
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', sudo: req.headers['x-sudo-token'] as string | undefined, body })
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/auth/sudo-password') {
        // The live argv sweep: taken while curl (and the bash that spawned it) is
        // still blocked on this very response.
        psSnapshot = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
        let pw = ''
        try { pw = JSON.parse(body).password } catch { /* malformed → refuse */ }
        if (pw === GOOD) { res.end(JSON.stringify({ token: TOKEN })); return }
        res.statusCode = 403
        res.end(JSON.stringify({ error: 'invalid password' }))
        return
      }
      res.end(JSON.stringify({ success: true, teams: [] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (typeof addr === 'object' && addr) apiBase = `http://127.0.0.1:${addr.port}`
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-sudo-pty-'))
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

function runAtTerminal(args: string[], password: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = ptySpawn('bash', [TEAMS, ...args], {
      cwd: REPO,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: fakeHome, AIMAESTRO_API_BASE: apiBase, TERM: 'dumb' },
    })
    let out = ''
    let typed = false
    p.onData((d) => {
      out += d
      if (!typed && out.includes('MAESTRO password')) { typed = true; p.write(password + '\r') }
    })
    const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
    p.onExit(({ exitCode }) => { clearTimeout(killer); resolve({ code: exitCode, out }) })
  })
}

describe('TRDD-9MZQ4T7E — MAESTRO sudo gate driven at a real pty', () => {
  it('P1: a wrong password is refused by the exchange, mints no token, and the strict verb sends nothing', async () => {
    const r = await runAtTerminal(['delete', TEAM_ID], SECRET)
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/sudo exchange refused/)
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['POST /api/auth/sudo-password'])
    expect(seen[0].sudo).toBeUndefined()
  })

  it('P2: the typed password is never in any process argv while the exchange is in flight, nor echoed to the tty', async () => {
    const r = await runAtTerminal(['delete', TEAM_ID], SECRET)
    expect(psSnapshot.length).toBeGreaterThan(1000) // the sweep really ran
    // THIS run's curl, not any curl on the box: the stub port is unique per test, so its URL
    // identifies the one process whose argv could carry the secret (review fork, 2026-08-27).
    expect(psSnapshot).toContain(`${apiBase}/api/auth/sudo-password`)
    // Exclude the HARNESS's own processes: the vitest worker holds this file (and so the
    // literal), and an editor/agent shell that wrote this file via a heredoc carries it in
    // argv too — the ps-finds-its-own-scanner trap, measured on this test's first run.
    // Everything else (bash, curl, jq — the chain the secret actually travels through) stays.
    const leaks = psSnapshot.split('\n').filter((l) => l.includes(SECRET) && !/vitest|shell-snapshots/.test(l))
    expect(leaks).toEqual([])
    expect(r.out).not.toContain(SECRET)
    // The secret DID travel: it reached the server in the request body (stdin → curl -d @-).
    expect(seen[0].body).toContain(SECRET)
  })

  it('P3: positive control — a correct password mints a token and the strict request carries it', async () => {
    const r = await runAtTerminal(['delete', TEAM_ID], GOOD)
    const calls = seen.map((s) => `${s.method} ${s.url}`)
    expect(calls[0]).toBe('POST /api/auth/sudo-password')
    const strict = seen.find((s) => s.method === 'DELETE')
    expect(strict, `expected a DELETE after the exchange, saw ${JSON.stringify(calls)} / out: ${r.out.slice(-300)}`).toBeDefined()
    expect(strict!.sudo).toBe(TOKEN)
  })
})
