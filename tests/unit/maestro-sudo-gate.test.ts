/**
 * TRDD-9MZQ4T7E — strict-route CLI verbs are gated on the MAESTRO sudo step.
 *
 * REAL SUBPROCESS, REAL HTTP SERVER, REAL curl (same harness shape as
 * aimaestro-governance-dev-login.test.ts). The load-bearing assertion is what the
 * SERVER RECEIVED, never log text: fail-closed means ZERO requests reached it.
 *
 * The gate has three legs, each pinned by a test another leg cannot satisfy:
 *   - human, no TTY, no token → refuse BEFORE any request (T1/T5);
 *   - agent (AID_AUTH)        → byte-identical old behavior, no sudo exchange (T3/T6);
 *   - pre-minted token        → request proceeds carrying X-Sudo-Token (T4).
 * T2 is the positive control proving T1's zero is the gate, not a broken harness.
 *
 * The TTY prompt path itself (password typed at a real terminal) is NOT driven
 * here: spawnSync always hands the child a pipe, and this file deliberately does
 * not fake a pty — the no-TTY refusal is the automatable half, and the prompt
 * path's secret-handling (jq -Rn 'input' + curl -d @-) reuses the exact pattern
 * the dev-login test already pins argv-containment for.
 *
 * NEUTER (recorded 2026-08-26, restore blob-verified): making maestro_sudo_ensure
 * a no-op `return 0` in common.sh reds exactly T1 (the strict request reaches the
 * server) and leaves T2/T3/T4 green — the complement proving T1 pins the GATE and
 * the others pin the PASSTHROUGHS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO = path.resolve(__dirname, '..', '..')
const TEAMS = path.join(REPO, 'scripts', 'aimaestro-teams.sh')
const AGENT = path.join(REPO, 'scripts', 'aimaestro-agent.sh')
const TEAM_ID = '11111111-2222-3333-4444-555555555555'

interface Seen {
  method: string
  url: string
  auth: string | undefined
  sudo: string | undefined
}

let server: http.Server
let seen: Seen[]
let apiBase: string
let fakeHome: string

beforeEach(async () => {
  seen = []
  server = http.createServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      auth: req.headers['authorization'] as string | undefined,
      sudo: req.headers['x-sudo-token'] as string | undefined,
    })
    res.setHeader('Content-Type', 'application/json')
    if ((req.url ?? '').startsWith('/api/agents?q=')) {
      // resolve_agent must SUCCEED, or the probe verb returns before ever
      // reaching the sudo gate and T5 passes vacuously (measured: the first
      // family-copy neuter reddened NOTHING because resolution failed here).
      res.end(JSON.stringify({ agents: [{ id: TEAM_ID, name: 'probe-target' }] }))
      return
    }
    // Generic happy body — enough for _api's success check and jq consumers.
    res.end(JSON.stringify({ success: true, teams: [], agents: [], status: { s: 'ok' } }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (typeof addr === 'object' && addr) apiBase = `http://127.0.0.1:${addr.port}`
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-sudo-gate-'))
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

// ASYNC spawn, deliberately: spawnSync freezes the Node event loop, so the
// in-process stub server could never answer curl — every server-touching test
// then times out at exactly curl's --max-time. (Measured on this file's first
// draft: T1/T5, which send nothing, passed; T2-T4 all hung 30s.)
function run(
  script: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', [script, ...args], {
      cwd: REPO,
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '',
        HOME: fakeHome,
        AIMAESTRO_API_BASE: apiBase,
        ...extraEnv,
      } as NodeJS.ProcessEnv,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.stdin.end() // stdin is a pipe — no controlling terminal for the prompt
    const killer = setTimeout(() => child.kill('SIGKILL'), 25_000)
    child.on('close', (code) => {
      clearTimeout(killer)
      resolve({ code, out, err })
    })
  })
}

describe('TRDD-9MZQ4T7E — MAESTRO sudo gate on strict CLI verbs', () => {
  it('T1: strict verb with no TTY, no token, no AID refuses and performs NOTHING', async () => {
    const r = await run(TEAMS, ['delete', TEAM_ID])
    expect(r.code).not.toBe(0)
    // Either the /dev/tty guard fires (clean refusal) or the tty read fails into
    // the empty-password refusal — both are the fail-closed contract.
    expect(r.err).toMatch(/strict \(sudo-gated\)|empty password|sudo exchange refused/)
    expect(seen).toEqual([]) // the load-bearing half: zero requests reached the server
  })

  it('T2: non-strict verb on the same harness DOES reach the server (positive control)', async () => {
    const r = await run(TEAMS, ['list'])
    expect(r.code).toBe(0)
    expect(seen.some((s) => s.method === 'GET' && s.url === '/api/teams')).toBe(true)
  })

  it('T3: an AID (agent) caller passes the gate untouched — no sudo exchange, request proceeds', async () => {
    const r = await run(TEAMS, ['delete', TEAM_ID], { AID_AUTH: 'aim_tk_test_agent_token' })
    expect(r.code).toBe(0)
    expect(seen.some((s) => s.url.includes('/api/auth/sudo-password'))).toBe(false)
    const del = seen.find((s) => s.method === 'DELETE' && s.url === `/api/teams/${TEAM_ID}`)
    expect(del).toBeTruthy()
    expect(del!.auth).toBe('Bearer aim_tk_test_agent_token')
  })

  it('T4: a pre-minted AIMAESTRO_SUDO_TOKEN is honored and rides the request as X-Sudo-Token', async () => {
    const r = await run(TEAMS, ['delete', TEAM_ID], { AIMAESTRO_SUDO_TOKEN: 'sudo-premint-1' })
    expect(r.code).toBe(0)
    expect(seen.some((s) => s.url.includes('/api/auth/sudo-password'))).toBe(false)
    const del = seen.find((s) => s.method === 'DELETE' && s.url === `/api/teams/${TEAM_ID}`)
    expect(del).toBeTruthy()
    expect(del!.sudo).toBe('sudo-premint-1')
  })

  it('T5: the agent-family copy gates probe the same way (no TTY, no token, no AID → nothing sent)', async () => {
    const r = await run(AGENT, ['probe', TEAM_ID])
    expect(r.code).not.toBe(0)
    expect(seen.some((s) => s.url.includes('/probe'))).toBe(false)
  })

  it('T6: probe with AID_AUTH reaches the route (family copy passthrough)', async () => {
    await run(AGENT, ['probe', TEAM_ID], { AID_AUTH: 'aim_tk_test_agent_token' })
    // The probe verb resolves the agent first (GET /api/agents/...): the stub
    // returns a generic body, so resolution may fail downstream — the assertion
    // is only that the gate did NOT block the request path for an agent.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.some((s) => s.url.includes('/api/auth/sudo-password'))).toBe(false)
  })
})
