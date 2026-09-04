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

/**
 * Where did a typed string lose characters? (TRDD-601KG45D, step (a).)
 *
 * The P9 failure that opened that card showed the server receiving the password one byte
 * SHORT (`…x7q` for `…x7q2`). The assertion that caught it — `toContain(SECRET)` — reports
 * only that the string is ABSENT, never where it was cut, and the POSITION is exactly what
 * discriminates that card's two hypotheses: a `stty` TCSAFLUSH discarding queued input would
 * tend to drop a leading or interior run, while a line terminating one byte early loses the
 * TAIL and nothing else. Three revisions of that card turned on a position nobody had recorded.
 *
 * Position is reported honestly: a character dropped inside a RUN of identical characters is
 * genuinely ambiguous, so this names the EARLIEST index consistent with the loss, and a
 * received string that is both a prefix AND a suffix is reported as AMBIGUOUS rather than
 * assigned to an end.
 */
export function diagnoseTyped(expected: string, received: string | undefined): string {
  if (received === undefined) return 'no password recovered (no request reached the server, or its body would not parse)'
  if (received === expected) return 'INTACT'
  if (received.length >= expected.length) {
    return `NOT-A-LOSS: got ${received.length} chars for ${expected.length} expected — it differs, but nothing was dropped`
  }
  const lost = expected.length - received.length
  const pre = expected.startsWith(received)
  const suf = expected.endsWith(received)
  if (pre && suf) return `AMBIGUOUS ${lost}-char loss: received is BOTH a prefix and a suffix of expected`
  if (pre) return `TAIL loss: ${lost} char(s) dropped at the end (received is a prefix of expected)`
  if (suf) return `LEADING loss: ${lost} char(s) dropped at the start (received is a suffix of expected)`
  let i = 0
  while (i < received.length && received[i] === expected[i]) i++
  return `INTERIOR loss: ${lost} char(s), earliest consistent index ${i} (ambiguous within a run of repeats)`
}

/**
 * What a TIMEOUT looks like, attached to the assertion that actually fails when one happens.
 *
 * The ^C tests assert `out` BEFORE they assert `seen[0].body`, and on a timeout the pty is
 * SIGKILLed so `RC=` never prints — that `out` assertion fails first and `diagnoseBody` is
 * never reached. TRDD-601KG45D briefly claimed the opposite ("the next timeout diagnoses
 * itself for free"), which was an assertion-MASKING error made while reasoning about
 * assertion masking.
 *
 * `requests` is the discriminator worth having, and it points the OPPOSITE way to what
 * TRDD-601KG45D first said. A merely LATE resume does not lose input — canonical mode buffers
 * it and delivers it when `read` resumes — so a timing slip predicts a POPULATED `seen[]` and
 * a late-but-completing run. **`requests=0` means the terminator never reached `read` at
 * all**, which is the signature of input being DISCARDED, not of a slow resume. Neither is
 * proof of a mechanism; it is the one bit the harness can cheaply carry out of a timeout.
 *
 * NOT the raw `out` tail: on the failure we care about the typed password may be in it, and a
 * message goes to a log. A `secret echoed:` BOOLEAN was tried and removed — it could only ever
 * print `false`, because `expect(out).not.toContain(SECRET)` runs BEFORE this assertion in
 * every one of these tests, so an echoed secret fails there and this message is never reached.
 * A field whose only reachable value is one constant carries no information.
 */
function timeoutContext(out: string, seenCount: number): string {
  return `requests=${seenCount} · out ${out.length}b`
}

/** The password the server actually received, or undefined when there was no parseable body. */
function pwOf(body: string | undefined): string | undefined {
  if (body === undefined) return undefined
  try {
    const pw = JSON.parse(body).password
    return typeof pw === 'string' ? pw : undefined
  } catch { return undefined }
}

/**
 * The diagnosis for a REQUEST BODY, which is what the assertions actually hold.
 *
 * This wrapper exists because collapsing every non-password case into `pwOf` returning
 * `undefined` made the instrument's message WRONG for its own most likely failure: a
 * truncated body does not parse, so "no request reached the server" would be printed about
 * a request that plainly did. Truncation is the class this instrument hunts, so being
 * wrong exactly there is worse than being silent. The three cases are now distinct, and an
 * unparseable body is shown RAW — with a short test secret that is the most useful thing
 * available, and there is no live credential in this file to leak.
 */
function diagnoseBody(expected: string, body: string | undefined): string {
  // KEEP THIS TOTAL — it must never throw. It is passed as `expect(actual, message)`, and
  // vitest evaluates that message EAGERLY, on every run, pass or fail. So a throw here does
  // not produce a bad message on a failing test; it converts a PASSING test into an error,
  // and the error would point at the diagnostic rather than at anything real. `pwOf` catches
  // its own parse, and nothing below can throw on any string. Keep it that way.
  if (body === undefined) return 'no request reached the server at all'
  const pw = pwOf(body)
  if (pw === undefined) return `body present but no string \`password\` field parsed out of it — raw body: ${JSON.stringify(body)}`
  return diagnoseTyped(expected, pw)
}

describe('TRDD-9MZQ4T7E — MAESTRO sudo gate driven at a real pty', () => {
  // P11 is the INSTRUMENT's own check, and it is not a pty test — it is here because
  // `diagnoseTyped` runs ONLY when one of the body assertions below fails, so without this
  // every one of its branches would ship unexecuted. TRDD-601KG45D refused to build its next
  // measurement on exactly that: a diffing branch that had produced 10 INTACT results and
  // zero losses, i.e. had never run at all. Driving every branch here means the loss path is
  // exercised on every run of this file, not first exercised on the day it is trusted.
  // SPLIT into one `it()` per branch, deliberately. As a single test with 12 assertions it
  // was NOT what it claimed: vitest aborts a test at its first failed assertion, so both
  // neuters died on assertion 2 or 4 and the seven after them were never reached by any
  // mutation — including AMBIGUOUS, the branch carrying the honesty claim, which could have
  // been deleted outright with the test still passing. Separate `it()`s cannot mask each
  // other, so every branch below is independently falsifiable.
  const S = 'abcdef'
  it('P11a: an intact string is INTACT', () => {
    expect(diagnoseTyped(S, S)).toBe('INTACT')
  })
  it('P11b: a lost final character is TAIL', () => {
    expect(diagnoseTyped(S, 'abcde')).toMatch(/^TAIL loss: 1 char/)
    // The shape it exists for: the exact P9 failure that opened TRDD-601KG45D.
    expect(diagnoseTyped(SECRET, SECRET.slice(0, -1))).toMatch(/^TAIL loss: 1 char/)
  })
  it('P11c: a lost first character is LEADING', () => {
    expect(diagnoseTyped(S, 'bcdef')).toMatch(/^LEADING loss: 1 char/)
  })
  it('P11d: an interior loss names the earliest consistent index', () => {
    expect(diagnoseTyped(S, 'abdef')).toMatch(/^INTERIOR loss: 1 char.*index 2/)
    expect(diagnoseTyped(S, 'abef')).toMatch(/^INTERIOR loss: 2 char.*index 2/)
  })
  it('P11e: a loss inside a RUN is AMBIGUOUS and does not claim an end', () => {
    // The whole honesty claim of this instrument. Unpinned until this was its own test.
    expect(diagnoseTyped('aaa', 'aa')).toMatch(/^AMBIGUOUS/)
  })
  it('P11f: a substitution is NOT-A-LOSS, and a missing string is said to be missing', () => {
    expect(diagnoseTyped(S, 'abcxef')).toMatch(/^NOT-A-LOSS/)
    expect(diagnoseTyped(S, undefined)).toMatch(/^no password recovered/)
  })
  // Split per branch like P11a-g, and for the same reason: four assertions in one `it()` is
  // the shape those were split apart to remove, and the security assertion is the one that
  // must not be masked. Added because `timeoutContext` shipped with NO test and NO neuter,
  // in the file whose founding finding is that an untested error path is not an instrument.
  it('P11h: the timeout context reports the REQUEST COUNT — the one bit a timeout can export', () => {
    expect(timeoutContext('abc', 0)).toMatch(/^requests=0 /)
    expect(timeoutContext('abc', 1)).toMatch(/^requests=1 /)
  })
  it('P11i: it reports the size of `out`', () => {
    expect(timeoutContext('abcd', 0)).toContain('out 4b')
  })
  it('P11j: it NEVER carries the secret — the tail is omitted on purpose', () => {
    // On a real gate this message goes to a log and `out` may hold a live password. A
    // regression re-adding the tail is the one failure here with a security consequence.
    expect(timeoutContext(`x${SECRET}y`, 0)).not.toContain(SECRET)
  })

  it('P11g: diagnoseBody tells "no request" apart from "unparseable body" — the truncation case', () => {
    expect(diagnoseBody(SECRET, undefined)).toMatch(/^no request reached the server/)
    // The failure class this instrument hunts: a body that arrived and would not parse must
    // NOT be reported as a request that never arrived.
    expect(diagnoseBody(SECRET, '{"password":"trunc')).toMatch(/^body present but no string/)
    expect(diagnoseBody(SECRET, '{"password":"trunc')).toContain('trunc')
    expect(diagnoseBody(SECRET, JSON.stringify({ password: SECRET }))).toBe('INTACT')
    expect(diagnoseBody(SECRET, JSON.stringify({ password: SECRET.slice(0, -1) }))).toMatch(/^TAIL loss/)
  })

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
    expect(seen[0].body, diagnoseBody(SECRET, seen[0]?.body)).toContain(SECRET)
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

  // A "P0" asserting that this harness's bash matches the scripts' `#!/usr/bin/env bash`
  // was added and then REMOVED — recorded because the removal is the finding, and because
  // the idea will occur to the next reader too. Its QUESTION was confused: these tests
  // `source` the scripts into an already-running bash and never execute the shebang, so
  // nothing here ever depended on the answer. (Production DOES invoke them through it, and
  // no test covers that — a real gap, but one for a separate file; see TRDD-601KG45D.)
  // Both spellings failed anyway, in opposite ways. Through ptySpawn it perturbed the file
  // (P8/P9 then failed intermittently). Through execFileSync it perturbed nothing and
  // measured nothing: MEASURED — with a fake `bash` planted first on PATH, BOTH operands
  // returned it, so the assertion was `x === x` and held. (The likely mechanism, that libuv
  // sets the child's environ before execvp and `/usr/bin/env` is itself an execvp wrapper,
  // is second-hand and UNVERIFIED here — it explains the measurement, it is not the
  // evidence for it. Stated in that order deliberately.)
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
    // The timeout context rides the FIRST assertion, and the original ORDER is preserved.
    // A prior revision instead moved `RC=1` to the front so the context would print on a
    // timeout — which worked, and silently DEMOTED `not.toContain(SECRET)` behind a liveness
    // check. That is the wrong trade in this file: the echo guarantee is what P6/P8/P9/P10
    // exist for, and a genuine leak co-occurring with a wrong RC would have gone unevaluated
    // until someone fixed the RC. Attaching the message to whichever assertion is already
    // first buys the same diagnosis at no cost to assertion priority.
    expect(out, timeoutContext(out, seen.length)).toMatch(/PRIOR-INT/)
    expect(out).not.toContain(SECRET)   // typed after ^C, still not echoed
    expect(out).toMatch(/RC=1/)
    expect(out).toMatch(/\necho\n?$/)
    expect(seen[0]?.body, diagnoseBody(SECRET, seen[0]?.body)).toContain(SECRET) // and it WAS the password the gate sent
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
    // First assertion carries the context — see P8. P9 has no PRIOR-INT to assert (the
    // caller's trap body is empty by construction), so the echo guarantee IS first here.
    expect(out, timeoutContext(out, seen.length)).not.toContain(SECRET) // typed after the ^C, still not echoed
    expect(out).toMatch(/RC=1/)              // the gate ran to its refusal, the ^C was ignored as asked
    expect(seen[0]?.body, diagnoseBody(SECRET, seen[0]?.body)).toContain(SECRET)  // and it WAS the password the gate sent
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
    expect(out, timeoutContext(out, seen.length)).toMatch(/PRIOR-INT/) // context on the first — see P8
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
