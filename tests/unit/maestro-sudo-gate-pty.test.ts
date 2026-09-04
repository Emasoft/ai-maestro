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
 * Neuters (2026-08-27, observed):
 *   common.sh empty-token refusal → `if false` ⇒ exactly P1 red.
 *   RETURN trap `eval prior` → `trap - INT`  ⇒ exactly P5 red.
 *   INT handler without `stty echo`          ⇒ exactly P6 red (prior trap saw `-echo`).
 *   INT handler without the `stty -echo` after the caller's trap ⇒ exactly P8 red (text echoed).
 *
 * Re-measured 2026-09-04 (TRDD-WV8FDAH0) at a pty, both neuters against the CURRENT handler:
 * drop its leading `stty echo` → the prior trap sees `-echo`; drop its trailing `stty -echo` →
 * the text typed after the ^C is echoed. The handler no longer re-raises with `kill -INT $$`
 * when the caller HAS a trap, because a `kill` inside a trap is deferred until that trap
 * returns — which ran the trailing `stty -echo` FIRST and reddened P6 for real (a ^C at the
 * prompt left the user's own terminal echo-off). It now runs the caller's trap body inline, so
 * the trailing re-disable is reached only when that trap returned. `kill -INT $$` survives for
 * the no-prior-trap case (P7), where there is nothing to run and nothing to order against.
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

// The prompt is printed BEFORE `read -rs` switches the tty to -echo, and a harness types
// faster than any human: under full-suite load the keystrokes landed in that gap and the tty
// line discipline echoed them, so P2 read the secret in the pty output (measured: 1 red in
// 6438). Wait until the child's tty actually reports -echo — BSD /bin/stty, never the GNU one
// on PATH (it wants -F) — then type. Falls back to a short settle only if stty cannot be read.
async function typeWhenNoEcho(p: { pid: number; write: (s: string) => void }, password: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const tty = execFileSync('ps', ['-o', 'tty=', '-p', String(p.pid)], { encoding: 'utf8' }).trim()
      const st = execFileSync('/bin/stty', ['-f', `/dev/${tty}`, '-a'], { encoding: 'utf8' })
      if (/(^|\s)-echo(\s|$)/.test(st)) break
    } catch {
      await new Promise((r) => setTimeout(r, 200))
      break
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  p.write(password + '\r')
}

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
      if (!typed && out.includes('MAESTRO password')) { typed = true; void typeWhenNoEcho(p, password) }
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

  // P4/P5 drive the gate FUNCTION directly in a pty so the tty state AFTER it returns can be
  // read — P1-P3 cannot see a leaked -echo because the child exits and the pty is torn down.
  function runGate(prelude: string, epilogue: string): Promise<string> {
    return new Promise((resolve) => {
      const p = ptySpawn('bash', ['-c', `${prelude}; source scripts/shell-helpers/common.sh; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?; ${epilogue}`], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: fakeHome, TERM: 'dumb' },
      })
      let out = ''
      let typed = false
      p.onData((d) => { out += d; if (!typed && out.includes('MAESTRO password')) { typed = true; void typeWhenNoEcho(p, SECRET) } })
      const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
      p.onExit(() => { clearTimeout(killer); resolve(out.replace(/\r/g, '')) })
    })
  }

  it('P4: after a REFUSED exchange (the return-1 path) the tty has echo back on', async () => {
    const out = await runGate('true', 'stty -a < /dev/tty | tr -s " " "\\n" | grep -E "^-?echo$"')
    expect(out).toMatch(/RC=1/)
    expect(out).toMatch(/\necho\n?$/) // the LAST line is the flag: `echo`, not `-echo`
    expect(out).not.toMatch(/-echo/)
  })

  it('P5: a caller\'s prior INT trap survives the gate (never reset to default)', async () => {
    const out = await runGate('trap "echo PRIOR-INT" INT', 'trap -p INT')
    expect(out).toMatch(/RC=1/)
    expect(out).toMatch(/trap -- ['"]echo PRIOR-INT['"] (SIG)?INT/) // bash prints SIGINT
  })

  // P6/P7 drive the Ctrl-C path — the one path P4/P5 never executed. Measured first
  // (2026-08-27, bounded probes): with a NON-exiting prior INT trap bash RESUMES the interrupted
  // `read` — ^C is swallowed and Enter completes the read (a bare `read -rs` behaves the same,
  // and so did the pre-hardening gate; TRDD-2PCZ6L5W) — pre-existing, so the prior trap here EXITS,
  // as a real caller's does. It runs AFTER the gate's handler, so it can read the tty flag.
  // BOTH copies are driven: the family copy in agent-helper.sh (what aimaestro-agent.sh runs)
  // was text-identical but never executed until the review fork asked — text identity is a proxy.
  const COPIES = ['scripts/shell-helpers/common.sh', 'scripts/agent-helper.sh']
  function runGateCtrlC(prelude: string, copy = COPIES[0]): Promise<{ code: number; signal: number | undefined; out: string }> {
    return new Promise((resolve) => {
      const p = ptySpawn('bash', ['-c', `${prelude}; source ${copy}; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?`], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: fakeHome, TERM: 'dumb' },
      })
      let out = ''
      let sent = false
      p.onData((d) => { out += d; if (!sent && out.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write('\x03'), 300) } })
      const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
      p.onExit(({ exitCode, signal }) => { clearTimeout(killer); resolve({ code: exitCode, signal, out: out.replace(/\r/g, '') }) })
    })
  }

  for (const copy of COPIES) it(`P6 [${copy}]: Ctrl-C mid-prompt hands off to the caller's prior INT trap, AFTER echo is restored`, async () => {
    const r = await runGateCtrlC(`trap 'echo PRIOR-INT; stty -a </dev/tty | tr -s " " "\\n" | grep -E "^-?echo$"; exit 130' INT`, copy)
    expect(r.out).toMatch(/PRIOR-INT\necho\n/) // prior trap ran, and saw `echo` (restored), not `-echo`
    expect(r.out).not.toMatch(/RC=/)            // the caller's trap exited — the gate did not swallow the interrupt
    expect(r.code).toBe(130)
  })

  it('P7: Ctrl-C with NO prior trap kills the script by SIGINT (default disposition re-raised)', async () => {
    const r = await runGateCtrlC('true')
    expect(r.out).not.toMatch(/RC=/)
    expect(r.signal ?? (r.code === 130 ? 2 : r.code)).toBe(2)
  })

  for (const copy of COPIES) it(`P8 [${copy}]: a RETURNING prior INT trap resumes the read with echo still OFF, and echo is back on afterwards`, async () => {
    // The 2PCZ6L5W caller shape. Type after the ^C: the text must not appear in the pty
    // output (echo re-disabled after the re-raise) and the final flag must be `echo`.
    const out = await new Promise<string>((resolve) => {
      const p = ptySpawn('bash', ['-c', `trap 'echo PRIOR-INT' INT; source ${copy}; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?; stty -a </dev/tty | tr -s " " "\\n" | grep -E "^-?echo$"`], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: fakeHome, TERM: 'dumb' },
      })
      let o = ''
      let sent = false
      p.onData((d) => { o += d; if (!sent && o.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write('\x03'), 300); setTimeout(() => p.write(SECRET + '\r'), 1200) } })
      const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
      p.onExit(() => { clearTimeout(killer); resolve(o.replace(/\r/g, '')) })
    })
    expect(out).toMatch(/PRIOR-INT/)
    expect(out).not.toContain(SECRET)   // typed after ^C, still not echoed
    expect(out).toMatch(/RC=1/)
    expect(out).toMatch(/\necho\n?$/)
    expect(seen[0]?.body).toContain(SECRET) // and it WAS the password the gate sent
  })

  // P9/P10 — the two caller shapes the FIRST cut of _maestro_sudo_on_int leaked on, found by
  // an adversarial review and reproduced at a pty before the fix (both LEAK=YES on b93f1ada,
  // both clean after). They are the P8 assertion aimed at the two paths that skipped the
  // re-disable: an EMPTY BODY that is still a trap, and a body that RETURNS from the handler.
  for (const copy of COPIES) it(`P9 [${copy}]: \`trap '' INT\` is a trap, not an absent one — the resumed read still does not echo`, async () => {
    // An empty body is indistinguishable from no trap if you test the BODY. It is not the
    // same thing: SIGINT is IGNORED, so the gate's `kill -INT $$` is a no-op, the read
    // resumes, and a handler that re-raised here left echo ON — the password on screen.
    const out = await new Promise<string>((resolve) => {
      const p = ptySpawn('bash', ['-c', `trap '' INT; source ${copy}; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?`], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: fakeHome, TERM: 'dumb' },
      })
      let o = ''
      let sent = false
      p.onData((d) => { o += d; if (!sent && o.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write('\x03'), 300); setTimeout(() => p.write(SECRET + '\r'), 1200) } })
      const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
      p.onExit(() => { clearTimeout(killer); resolve(o.replace(/\r/g, '')) })
    })
    expect(out).not.toContain(SECRET)        // the whole point: typed after the ^C, still not echoed
    expect(out).toMatch(/RC=1/)              // the gate ran to its refusal, the ^C was ignored as asked
    expect(seen[0]?.body).toContain(SECRET)  // and it WAS the password the gate sent
  })

  for (const copy of COPIES) it(`P10 [${copy}]: a prior trap ending in \`return\` does not skip the re-disable`, async () => {
    // The handler runs the caller's body inline, so a trailing `return` returns from the
    // HANDLER. Anything placed after the body is therefore skipped — which is why the
    // re-disable is a RETURN trap and not a trailing line.
    const out = await new Promise<string>((resolve) => {
      const p = ptySpawn('bash', ['-c', `trap 'echo PRIOR-INT; return' INT; source ${copy}; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?`], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: fakeHome, TERM: 'dumb' },
      })
      let o = ''
      let sent = false
      p.onData((d) => { o += d; if (!sent && o.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write('\x03'), 300); setTimeout(() => p.write(SECRET + '\r'), 1200) } })
      const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
      p.onExit(() => { clearTimeout(killer); resolve(o.replace(/\r/g, '')) })
    })
    expect(out).toMatch(/PRIOR-INT/)
    expect(out).not.toContain(SECRET)
    expect(out).toMatch(/RC=1/)
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
