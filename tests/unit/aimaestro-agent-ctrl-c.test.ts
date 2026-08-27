/**
 * TRDD-2PCZ6L5W — Ctrl-C at the MAESTRO password prompt must KILL aimaestro-agent.sh.
 *
 * The script's INT trap used to be `trap cleanup EXIT INT TERM`; cleanup() returns, and a
 * returning INT handler makes bash RESUME the interrupted `read`, so ^C was swallowed and the
 * next keystrokes became the password. Driven through the REAL script (not the sourced gate),
 * in a real pty, against a stub that lets `probe` resolve its agent and reach the gate.
 *
 * Neuter: restore `trap cleanup EXIT INT TERM` → the process is still at the prompt when the
 * cap fires and this test reds (recorded 2026-08-27: 1 red / 0 green).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn as ptySpawn } from 'node-pty'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO = path.resolve(__dirname, '..', '..')
const AGENT = path.join(REPO, 'scripts', 'aimaestro-agent.sh')
const TEAM_ID = '11111111-2222-3333-4444-555555555555'

let server: http.Server
let apiBase: string
let fakeHome: string

beforeEach(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if ((req.url ?? '').startsWith('/api/agents?q=')) { res.end(JSON.stringify({ agents: [{ id: TEAM_ID, name: 'probe-target' }] })); return }
    res.end(JSON.stringify({ success: true }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const a = server.address(); if (typeof a === 'object' && a) apiBase = `http://127.0.0.1:${a.port}`
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-agent-ctrlc-'))
})
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); fs.rmSync(fakeHome, { recursive: true, force: true }) })

describe('TRDD-2PCZ6L5W — Ctrl-C at the sudo prompt kills aimaestro-agent.sh', () => {
  it('probe → prompt → ^C: the process exits 130 instead of resuming the read', async () => {
    const r = await new Promise<{ code: number; signal: number | undefined; out: string; capped: boolean }>((resolve) => {
      const p = ptySpawn('bash', [AGENT, 'probe', TEAM_ID], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: fakeHome, AIMAESTRO_API_BASE: apiBase, TERM: 'dumb' },
      })
      let out = ''
      let sent = false
      p.onData((d) => { out += d; if (!sent && out.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write('\x03'), 300) } })
      // The cap IS the assertion for the old behaviour: a swallowed ^C leaves the process alive.
      const killer = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: -1, signal: undefined, out, capped: true }) }, 8_000)
      p.onExit(({ exitCode, signal }) => { clearTimeout(killer); resolve({ code: exitCode, signal, out: out.replace(/\r/g, ''), capped: false }) })
    })
    expect(r.out, 'the prompt never appeared — the probe verb did not reach the gate').toContain('MAESTRO password')
    expect(r.capped, 'process still alive 8s after ^C — the interrupt was swallowed').toBe(false)
    expect(r.code).toBe(130)
  })
})
