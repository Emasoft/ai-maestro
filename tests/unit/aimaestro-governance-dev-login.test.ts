/**
 * TRDD-A9335BZ6 — `aimaestro-governance.sh login` with no TTY must use the dev-mode
 * token, never the master password, and must never let the secret reach any process's
 * argv.
 *
 * REAL SUBPROCESS, REAL HTTP SERVER, REAL curl. The server is an actual `http.Server` on
 * an ephemeral port so "the request carried the token" is proven from what the server
 * received, not from log text. Argv containment is proven by shimming `curl` on PATH with
 * a wrapper that records its own argv before delegating to the real binary — if the
 * secret were ever passed as `--arg`/`-d value` instead of piped via stdin, it would show
 * up in that recording.
 *
 * `HOME` is redirected to a fresh mkdtemp for every test, never the developer's real
 * `~/.aimaestro` — containment is verified by counting files under the REAL home before
 * and after each test (must be delta 0).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, spawnSync } from 'child_process'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO, 'scripts', 'aimaestro-governance.sh')
const REAL_HOME = os.homedir()
const REAL_AIM_DIR = path.join(REAL_HOME, '.aimaestro')

function countRealAimFiles(): number {
  try {
    return fs.readdirSync(REAL_AIM_DIR).length
  } catch {
    return -1 // dir doesn't exist — treat as "0, and still absent" via a sentinel
  }
}

let fakeHome: string
let realAimFilesBefore: number

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-gov-login-'))
  realAimFilesBefore = countRealAimFiles()
})

afterEach(() => {
  expect(countRealAimFiles()).toBe(realAimFilesBefore) // containment: real ~/.aimaestro untouched
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

function runLogin(env: NodeJS.ProcessEnv): { code: number | null; out: string; err: string } {
  const r = spawnSync('bash', [SCRIPT, 'login'], {
    cwd: REPO,
    encoding: 'utf-8',
    timeout: 30_000,
    input: '', // non-TTY stdin
    env,
  })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

/** Async variant — REQUIRED whenever an in-process http.Server must answer the request:
 * spawnSync blocks Node's single event-loop thread, so the server's own request handler
 * (running in this same process) would never get a turn while spawnSync waits. */
function runLoginAsync(env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, 'login'], { cwd: REPO, env })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end() // non-TTY stdin, immediately closed
  })
}

describe('aimaestro-governance.sh login — unattended dev-mode token (subprocess)', () => {
  it('fails closed with no TTY and no token anywhere', () => {
    const emptyProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-gov-noenv-'))
    const r = runLogin({
      PATH: process.env.PATH,
      HOME: fakeHome,
      CLAUDE_PROJECT_DIR: emptyProjectDir,
      // NODE_ENV is required by ProcessEnv; it also keeps lib/test-only-env's
      // allowlist honoured in anything the script ends up invoking.
      NODE_ENV: 'test',
    })
    expect(r.code).not.toBe(0)
    expect(r.err).toMatch(/no dev-mode token/)
    expect(r.err).toMatch(/AI_MAESTRO_DEV_MODE_TOKEN/)
    expect(r.err).toMatch(/NEVER accepted as a command-line argument/)
    fs.rmSync(emptyProjectDir, { recursive: true, force: true })
  })

  it('mints a session from AI_MAESTRO_DEV_MODE_TOKEN, writes it 0600, and never puts the token in a child process argv', async () => {
    const TOKEN = 'am-test-secret-token-should-never-be-in-argv-abc123'
    let receivedBody: unknown
    let receivedPath = ''

    const server = http.createServer((req, res) => {
      receivedPath = req.url ?? ''
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        try { receivedBody = JSON.parse(raw) } catch { receivedBody = raw }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'aim_session=fake-session-cookie-value; Path=/; HttpOnly',
        })
        res.end(JSON.stringify({ ok: true }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('server did not bind')
    const apiBase = `http://127.0.0.1:${addr.port}`

    // Shim curl on PATH: record argv, then delegate to the real binary so the request
    // actually happens against the stub server above.
    const realCurl = spawnSync('bash', ['-c', 'command -v curl'], { encoding: 'utf-8' }).stdout.trim()
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-gov-curlshim-'))
    const argvLog = path.join(shimDir, 'curl-argv.log')
    fs.writeFileSync(
      path.join(shimDir, 'curl'),
      `#!/usr/bin/env bash\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; done\nexec "${realCurl}" "$@"\n`,
      { mode: 0o755 }
    )

    try {
      const emptyProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-gov-noenv-'))
      const r = await runLoginAsync({
        PATH: `${shimDir}:${process.env.PATH}`,
        HOME: fakeHome,
        CLAUDE_PROJECT_DIR: emptyProjectDir,
        NODE_ENV: 'test',
        AI_MAESTRO_DEV_MODE_TOKEN: TOKEN,
        AIMAESTRO_API_BASE: apiBase,
      })
      fs.rmSync(emptyProjectDir, { recursive: true, force: true })

      expect(r.code).toBe(0)
      expect(receivedPath).toBe('/api/auth/login')
      expect(receivedBody).toEqual({ devToken: TOKEN })

      const sessionFile = path.join(fakeHome, '.aimaestro', 'cli-session')
      expect(fs.readFileSync(sessionFile, 'utf-8')).toBe('fake-session-cookie-value')
      const mode = fs.statSync(sessionFile).mode & 0o777
      expect(mode).toBe(0o600)

      // Argv containment: curl (the only child process spawned by the login) must never
      // have received the token as a command-line argument — it travels stdin -> body only.
      const argv = fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf-8') : ''
      // POSITIVE CONTROL, and it is load-bearing: `not.toContain` is satisfied by an
      // EMPTY log, so without this line the assertion below passes just as happily
      // when the shim never ran at all — i.e. it would certify argv-cleanliness by
      // having observed no argv. Prove the shim captured the login call first.
      expect(argv).toContain('/api/auth/login')
      expect(argv).not.toContain(TOKEN)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
      fs.rmSync(shimDir, { recursive: true, force: true })
    }
    // 30s, not vitest's 5s default. This test spawns bash -> a curl shim -> the real
    // curl -> a loopback stub server; under any concurrent load that chain routinely
    // exceeds 5s, and it was measured FLAKY at the default (one timeout, one pass, in
    // two consecutive isolated runs). A flaky SECURITY test is worse than none: it gets
    // re-run until green and then believed, so the timeout is raised to the scale the
    // subject actually operates at rather than left to be rediscovered as "known flaky".
  }, 30_000)
})
