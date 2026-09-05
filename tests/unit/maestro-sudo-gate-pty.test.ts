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
// TRDD-601KG45D step 3 — 40 chars, not 22. The truncation always lost the FINAL byte of a
// 22-char password, and a 21-byte prefix is equally consistent with "the terminator arrived one
// character early" and "something caps the line at 21". At 40 characters those diverge sharply:
// terminator-timing predicts 39 bytes (TAIL-1), a 21-byte cap predicts 21 (TAIL-19). The cap
// branch has no candidate implementation in this pipeline (MAX_CANON >= 1024, PIPE_BUF >= 512,
// bash `read -rs` has no small cap), so this is expected to confirm TAIL-1 — but "expected" is
// what this card has been wrong about four times, hence the measurement.
const SECRET = 'wrong-pw-9MZQ4T7E-x7q2-40char-padding-AB'
const GOOD = 'right-pw-9MZQ4T7E-k4m8'
const TOKEN = 'tok-9MZQ4T7E-minted'

interface Seen { method: string; url: string; sudo: string | undefined; body: string }

let server: http.Server
let seen: Seen[]
let psSnapshot: string
let apiBase: string
let fakeHome: string
let shimPath: string
let jqLenFile: string

/**
 * TRDD-601KG45D step 2 — measure what the gate hands `jq -Rnc`, from the TEST.
 *
 * The gate builds its request body with `printf '%s' "$_pw" | jq -Rnc '{password: input}'`
 * (common.sh:761, agent-helper.sh:279), so that pipe is the last place the typed password
 * exists as shell data. Three observed truncations all lost exactly the TAIL byte, and the
 * card's argument that the loss is at or before `read` rests on the COMPOSITION of that
 * pipeline — an argument, not a measurement. This turns it into one: a short length here
 * puts the loss at or before `read`; a full length puts it after jq.
 *
 * It records a LENGTH, never the content — the point is to instrument a password path
 * without ever writing a password anywhere it can be read back.
 *
 * Argv-filtered on `-Rnc` deliberately: common.sh calls jq ~20 times, one of them on the
 * RESPONSE (`:770`), and a shim that measured every call would pass a filter+file invocation
 * an empty stdin it does not want — or hang waiting for one. Non-matching calls are `exec`ed
 * straight through, before stdin is touched at all.
 *
 * The real jq is resolved and BAKED IN here, because the shim dir is first on the child's
 * PATH — a `command -v jq` inside the wrapper would find the wrapper.
 */
function installJqShim(dir: string, recordFile: string): string | undefined {
  let realJq = ''
  try { realJq = execFileSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).trim() } catch { /* absent */ }
  if (!realJq) return undefined
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'jq'),
    `#!/bin/bash\n` +
      `# TRDD-601KG45D test shim — see installJqShim() in maestro-sudo-gate-pty.test.ts.\n` +
      // Without this, `wc -c < "$t" | tr … || exit 92` tests TR's status, not wc's — the
      // $?-after-a-pipeline trap, which is in this repo's own lessons file. `tr` succeeds even
      // when `wc` wrote nothing, so the guard added to catch a failed measurement was
      // unreachable in exactly the case it was added for.
      `set -o pipefail\n` +
      // A guard that exits is invisible: the gate calls this inside `_body="$(… | jq …)"`, so
      // command substitution swallows the exit code and the reader sees a generic refusal.
      // The MARKER is what makes "if one fires, discard the run" an instruction anyone can
      // actually follow — jqStdinNote prints it verbatim.
      `fail() { printf 'SHIM-ERROR-%s\\n' "$1" >> '${recordFile}'; exit "$1"; }\n` +
      `for a in "$@"; do\n` +
      `  [ "$a" = "-Rnc" ] || continue\n` +
      `  t="$(mktemp '${dir}/jq-stdin.XXXXXX')" || fail 90\n` +
      // BOTH guards fail toward a SHORT length, which is indistinguishable from the bug this
      // whole card is chasing. A `cat` that hits a full disk leaves a truncated file, and the
      // shim would then record a short length AND hand jq short input — manufacturing the
      // exact observation, on the exact test, that would be read as the defect reproducing.
      // Exit loudly instead; a shim that dies is obvious, a shim that lies is not.
      `  cat > "$t" || fail 91\n` +
      `  wc -c < "$t" | tr -d ' ' >> '${recordFile}' || fail 92\n` +
      `  '${realJq}' "$@" < "$t"\n` +
      `  rc=$?\n` +
      `  rm -f "$t"\n` +
      `  exit $rc\n` +
      `done\n` +
      `exec '${realJq}' "$@"\n`,
    { mode: 0o755 },
  )
  return dir
}

/**
 * The lengths the shim recorded this test, as a message fragment.
 *
 * KEEP THIS TOTAL. It rides `expect(actual, message)`, which vitest evaluates EAGERLY on
 * every run — a throw here turns a PASSING test into an error.
 *
 * `expected` is a JS char count and the shim reports bytes; both secrets here are ASCII, so
 * they agree. A non-ASCII password would need the comparison done in bytes on both sides.
 */
/** Every length the shim recorded this test. TOTAL — an absent file means it never fired. */
function recordedLens(): string[] {
  try { return fs.readFileSync(jqLenFile, 'utf8').split('\n').filter((l) => l.trim() !== '') } catch { return [] }
}

function jqStdinNote(expected: number): string {
  let raw = ''
  try { raw = fs.readFileSync(jqLenFile, 'utf8') } catch { return 'jq -Rnc stdin: NOT RECORDED (shim inactive — jq absent, or the gate never reached it)' }
  const lens = raw.split('\n').filter((l) => l.trim() !== '')
  if (lens.length === 0) return 'jq -Rnc stdin: NOT RECORDED (shim active, no -Rnc call reached it)'
  return `jq -Rnc stdin: ${lens.join(',')} byte(s) for ${expected} expected`
}

/** diagnoseBody plus what the gate actually handed jq — the two halves of "where was it cut". */
function diagnose(expected: string, body: string | undefined): string {
  return `${diagnoseBody(expected, body)} · ${jqStdinNote(expected.length)}`
}

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
        // maxBuffer: on this dev machine the live process table (many concurrent agent/tmux
        // sessions) can push `ps -eo args` output well past Node's 1 MiB execFileSync default,
        // and macOS's synchronous spawn then fails with ENOBUFS rather than the JS-level
        // ERR_CHILD_PROCESS_STDIO_MAXBUFFER — measured live (r28, 2 of 6 standalone runs) at
        // this exact call site. 64 MiB is comfortably above anything this table has produced.
        psSnapshot = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
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
  // Lives inside fakeHome so afterEach's rmSync already owns its lifetime.
  jqLenFile = path.join(fakeHome, 'jq-rnc-lengths.txt')
  const shimDir = installJqShim(path.join(fakeHome, 'jq-shim'), jqLenFile)
  shimPath = shimDir ? `${shimDir}:${process.env.PATH ?? ''}` : (process.env.PATH ?? '')
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
      env: { NODE_ENV: 'test', PATH: shimPath, HOME: fakeHome, AIMAESTRO_API_BASE: apiBase, TERM: 'dumb' },
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

  // P12 — the jq PATH shim itself. It sits in the middle of a password pipeline in every
  // pty test below, so it is pinned before it is trusted: an instrument that silently drops
  // its measurement reads exactly like an instrument that measured no loss, and an instrument
  // that corrupts what it forwards would fail these tests for a reason that is not the bug.
  // One `it()` per branch — a neuter stops at the first failed assertion, so bundling these
  // would leave the later ones unpinned (the P11 split, applied ahead of the mistake).
  const shim = () => path.join(fakeHome, 'jq-shim', 'jq')
  const runShim = (args: string[], input?: string) =>
    execFileSync(shim(), args, { input, encoding: 'utf8' })

  it('P12a: with -Rnc the shim records the BYTE LENGTH of its stdin', () => {
    runShim(['-Rnc', '{password: input}'], SECRET)
    expect(fs.readFileSync(jqLenFile, 'utf8').trim()).toBe(String(Buffer.byteLength(SECRET)))
  })

  // P12f exists because P12a alone does NOT pin what it claims. A shim that ignored stdin and
  // appended a hard-coded `22` passes P12a (the secret happens to be 22 bytes) AND P12e (which
  // counts lines, not values) — so the single number this entire experiment will be read from
  // would rest on nothing. Two different lengths make a constant impossible. Found by the
  // adversarial review of e3787efb, before any measurement was taken.
  it('P12f: the recorded length is a FUNCTION of stdin, not a constant', () => {
    runShim(['-Rnc', '{password: input}'], 'abcde')
    expect(fs.readFileSync(jqLenFile, 'utf8').trim()).toBe('5')
  })

  it('P12b: with -Rnc the shim forwards stdin to the real jq unchanged', () => {
    // If this ever fails, the shim is corrupting the very request body it exists to measure.
    expect(JSON.parse(runShim(['-Rnc', '{password: input}'], SECRET)).password).toBe(SECRET)
  })

  it('P12c: without -Rnc the shim execs through, taking no stdin (a file-arg call must not hang)', () => {
    const f = path.join(fakeHome, 'p12c.json')
    fs.writeFileSync(f, '{"a":1}')
    expect(runShim(['-r', '.a', f]).trim()).toBe('1')
  })

  it('P12d: without -Rnc the shim records nothing — only the gate\'s own call is measured', () => {
    const f = path.join(fakeHome, 'p12d.json')
    fs.writeFileSync(f, '{"a":1}')
    runShim(['-r', '.a', f])
    expect(fs.existsSync(jqLenFile)).toBe(false)
  })

  // THE POSITIVE CONTROL, and the only one of P12 that is not vacuous on its own. P12a-d
  // drive the shim DIRECTLY; every one of them passes with the shim absent from the child's
  // PATH entirely, in which case `jqStdinNote` prints "NOT RECORDED" forever and reads
  // exactly like a run in which nothing was lost. This asserts the shim is really in the
  // path the GATE takes — a real pty, a real `read`, the real `jq -Rnc` at common.sh:761.
  it('P12e: a real gate run goes THROUGH the shim — exactly one -Rnc call is recorded', async () => {
    await runAtTerminal(['delete', TEAM_ID], SECRET)
    // Read TOTALLY. An `fs.readFileSync` here THROWS ENOENT in the one case this test exists
    // to catch — the shim never fired, so the record file was never created — and a throw in
    // the body means the assertion never runs and its message is never printed. Measured: the
    // first neuter of this test reported a bare failure with no note at all.
    const lens = recordedLens()
    // Asserts the VALUE, not just the count, and that is what makes the card's "baseline
    // control" real rather than aspirational: `fakeHome` is torn down in afterEach, so no
    // later step can ever read this number back — if it is not asserted HERE it is not
    // asserted anywhere. Every green run therefore carries the control, for free.
    //
    // It follows that this test ALSO fires on a real truncation, and that is intended: the
    // note tells the two apart — `NOT RECORDED` means the shim never ran, `21 byte(s) for 22
    // expected` means the gate handed jq a short line, which is the experiment's whole answer.
    expect(lens, jqStdinNote(SECRET.length)).toEqual([String(Buffer.byteLength(SECRET))])
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
    expect(seen[0].body, diagnose(SECRET, seen[0]?.body)).toContain(SECRET)
  })

  // P4/P5 drive the gate FUNCTION directly in a pty so the tty state AFTER it returns can be
  // read — P1-P3 cannot see a leaked -echo because the child exits and the pty is torn down.
  function runGate(prelude: string, epilogue: string): Promise<string> {
    return new Promise((resolve) => {
      const p = ptySpawn('bash', ['-c', `${prelude}; source scripts/shell-helpers/common.sh; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?; ${epilogue}`], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: shimPath, HOME: fakeHome, TERM: 'dumb' },
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
        cwd: REPO, env: { NODE_ENV: 'test', PATH: shimPath, HOME: fakeHome, TERM: 'dumb' },
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
        cwd: REPO, env: { NODE_ENV: 'test', PATH: shimPath, HOME: fakeHome, TERM: 'dumb' },
      })
      let o = ''
      let sent = false
      p.onData((d) => { o += d; if (!sent && o.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write('\x03'), 300); setTimeout(() => p.write(SECRET + '\r'), 1200) } })
      const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
      p.onExit(() => { clearTimeout(killer); resolve(o.replace(/\r/g, '')) })
    })
    // The context is attached to BOTH assertions a timeout can land on, and the original
    // ORDER is untouched. Two earlier attempts each got exactly half of this:
    //   - moving `RC=1` to the front made the context print, and DEMOTED
    //     `not.toContain(SECRET)` behind a liveness check — the echo guarantee is what
    //     P6/P8/P9/P10 exist for, so that was the wrong trade;
    //   - reverting the order and attaching to the first assertion protected priority and
    //     lost the diagnosis again: a timeout whose handler COMPLETED has `PRIOR-INT`
    //     present, so assertion 1 passes and the failure lands bare on `RC=1`.
    // Attaching twice costs nothing and covers both subsets — handler-failed timeouts fail
    // on the first, handler-completed ones on the third.
    expect(out, timeoutContext(out, seen.length)).toMatch(/PRIOR-INT/)
    expect(out).not.toContain(SECRET)   // typed after ^C, still not echoed
    expect(out, timeoutContext(out, seen.length)).toMatch(/RC=1/)
    expect(out).toMatch(/\necho\n?$/)
    expect(seen[0]?.body, diagnose(SECRET, seen[0]?.body)).toContain(SECRET) // and it WAS the password the gate sent
    // LAST deliberately. P12e proves the shim covers `runAtTerminal`'s spawn; this spawn is a
    // THIRD shape (inline ptySpawn), and it is where 2 of the 3 observed truncations actually
    // happened — so "the shim is on this PATH too" was asserted by nobody. On a truncating run
    // the assertion above fails first and `diagnose` already reports the number, so this line
    // only ever runs on an otherwise-green run, which is precisely the uncovered case.
    expect(recordedLens(), jqStdinNote(SECRET.length)).toEqual([String(Buffer.byteLength(SECRET))])
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
        cwd: REPO, env: { NODE_ENV: 'test', PATH: shimPath, HOME: fakeHome, TERM: 'dumb' },
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
    expect(out, timeoutContext(out, seen.length)).toMatch(/RC=1/) // the gate ran to its refusal, ^C ignored as asked
    expect(seen[0]?.body, diagnose(SECRET, seen[0]?.body)).toContain(SECRET)  // and it WAS the password the gate sent
    expect(recordedLens(), jqStdinNote(SECRET.length)).toEqual([String(Buffer.byteLength(SECRET))]) // shim coverage — see P8
  })

  for (const copy of COPIES) it(`P10 [${copy}]: a prior trap ending in \`return\` does not skip the re-disable`, async () => {
    // The handler runs the caller's body inline, so a trailing `return` returns from the
    // HANDLER. Anything placed after the body is therefore skipped — which is why the
    // re-disable is a RETURN trap and not a trailing line.
    const out = await new Promise<string>((resolve) => {
      const p = ptySpawn('bash', ['-c', `trap 'echo PRIOR-INT; return' INT; source ${copy}; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?`], {
        cwd: REPO, env: { NODE_ENV: 'test', PATH: shimPath, HOME: fakeHome, TERM: 'dumb' },
      })
      let o = ''
      let sent = false
      p.onData((d) => { o += d; if (!sent && o.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write('\x03'), 300); setTimeout(() => p.write(SECRET + '\r'), 1200) } })
      const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
      p.onExit(() => { clearTimeout(killer); resolve(o.replace(/\r/g, '')) })
    })
    expect(out, timeoutContext(out, seen.length)).toMatch(/PRIOR-INT/) // both landing spots — see P8
    expect(out).not.toContain(SECRET)
    expect(out, timeoutContext(out, seen.length)).toMatch(/RC=1/)
  })

  /**
   * TRDD-601KG45D step 4 — the OFF-DIAGONAL CELL. All 7 truncations to date are in tests that
   * hold BOTH knobs at (prior `^C`, blind 1200 ms write); the zero-truncation tests hold both at
   * (no `^C`, polled write). No cell existed where the two differ, so "the blind-write path
   * predicts the truncations" was a correlation over a design that could not separate write
   * timing from the signal-resume — and the second of those is a PRODUCT bug in `common.sh`,
   * not a harness artifact.
   *
   * This is the cell that can implicate the harness AFFIRMATIVELY: a blind timed write with NO
   * signal anywhere near it. One truncation here proves blind writing alone suffices.
   *
   * THE COMPLEMENT CELL (`^C` + polled write) IS NOT CONSTRUCTIBLE, and finding that out is why
   * it is absent rather than merely unwritten. `typeWhenNoEcho` is not a readiness check: it
   * polls for `-echo`, which `common.sh` sets at :749 BEFORE `read` at :753, so the flag is
   * already true when the poll starts and the loop breaks on its first iteration. Scheduled
   * before the `^C` it would type ahead of the signal (a different cell entirely); scheduled at
   * 1200 ms to match this one's delay it breaks immediately and reduces to P8 exactly. Either
   * way it varies the delay, not the readiness, so it cannot hold timing fixed while removing
   * the signal. That cell needs a real "is `read` blocked and consuming" probe, which nothing
   * here has.
   *
   * ITERATES, because a null needs power. At the observed ~1.7% per typing, one typing per run
   * over a 40-run batch expects ~0.7 events and a zero would mean nothing; 8 gives ~320 typings
   * per batch, where a zero is a genuine result.
   */
  it('P13: no ^C anywhere — a blind timed write into an uninterrupted read, 8x', async () => {
    const N = 8
    for (let i = 0; i < N; i++) {
      await new Promise<void>((resolve) => {
        // Identical to P8 except for the ONE knob: no `\x03` is ever written. The prior INT
        // trap is kept so the gate's own setup is byte-for-byte P8's — the only difference
        // between the two cells must be the signal, not the shell around it.
        const p = ptySpawn('bash', ['-c', `trap 'echo PRIOR-INT' INT; source ${COPIES[0]}; AIMAESTRO_API_BASE=${apiBase} maestro_sudo_ensure; echo RC=$?`], {
          cwd: REPO, env: { NODE_ENV: 'test', PATH: shimPath, HOME: fakeHome, TERM: 'dumb' },
        })
        let o = ''
        let sent = false
        p.onData((d) => { o += d; if (!sent && o.includes('MAESTRO password')) { sent = true; setTimeout(() => p.write(SECRET + '\r'), 1200) } })
        const killer = setTimeout(() => p.kill('SIGKILL'), 25_000)
        p.onExit(() => { clearTimeout(killer); resolve() })
      })
    }
    // The shim's record is per-test (it lives in this test's own fakeHome), so this is exactly
    // the N lengths these N gate runs handed `jq -Rnc`. A short one is a truncation in a cell
    // where no signal was ever delivered.
    const full = String(Buffer.byteLength(SECRET))
    expect(recordedLens(), jqStdinNote(SECRET.length)).toEqual(Array(N).fill(full))
  }, 60_000)

  it('P3: positive control — a correct password mints a token and the strict request carries it', async () => {
    const r = await runAtTerminal(['delete', TEAM_ID], GOOD)
    const calls = seen.map((s) => `${s.method} ${s.url}`)
    expect(calls[0]).toBe('POST /api/auth/sudo-password')
    const strict = seen.find((s) => s.method === 'DELETE')
    expect(strict, `expected a DELETE after the exchange, saw ${JSON.stringify(calls)} / out: ${r.out.slice(-300)}`).toBeDefined()
    expect(strict!.sudo).toBe(TOKEN)
  })
})
