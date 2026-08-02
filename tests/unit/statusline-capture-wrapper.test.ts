/**
 * `scripts/aimaestro-statusline-capture.sh` — the wrapper that sits in the USER's live status bar
 * (TRDD-D8OYFG35).
 *
 * DRIVEN AS A REAL SUBPROCESS, because there is no other altitude at which its claims are even
 * expressible: "stdout is byte-identical", "the exit code passes through", "it returns without
 * waiting for the capture" are properties of a process, and every one of them would be invisible to
 * a mocked shell.
 *
 * The four claims, each mapped to the risk it retires:
 *
 *   1. **STDOUT IS BYTE-IDENTICAL to running the inner command directly**, and the inner receives
 *      the EXACT stdin bytes. Stray output corrupts the status bar on every keystroke. Asserted on
 *      Buffers, not strings, so a lost/added newline cannot hide behind a trim.
 *   2. **THE EXIT CODE PASSES THROUGH**, including a non-zero one — which is also why the script
 *      carries no `set -e`.
 *   3. **THE CAPTURE IS DETACHED.** Claude Code cancels an in-flight statusline script and debounces
 *      at 300 ms, so a synchronous POST would stall the bar and get itself killed. Proven by
 *      pointing the ingest CLI at a black hole that sleeps for seconds and asserting the wrapper
 *      returns anyway.
 *   4. **IT FAILS SOFT.** No CLI, a CLI that errors, a CLI that hangs — the bar still renders and
 *      the exit code is still the inner's.
 *
 * Plus the POSITIVE CONTROL that makes claims 1-2 mean anything: a stub CLI records the payload it
 * was handed, and one test asserts the capture ACTUALLY FIRED with the right bytes. Without it,
 * every "nothing extra on stdout" assertion would pass just as happily with the capture deleted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// `spawnSync` is correct in THIS file — nothing here needs the event loop while the child runs
// (no in-process server, unlike statusline-cli.test.ts). `spawn` is used only by the cancellation
// test, which must be able to signal a child that is still running.
import { spawn, spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const WRAPPER = resolve(__dirname, '..', '..', 'scripts', 'aimaestro-statusline-capture.sh')

/**
 * How long the black-hole CLI blocks for. Long enough that "the wrapper waited" is unmistakable,
 * short enough that a leaked child self-reaps quickly — and `afterEach` kills it anyway.
 */
const HANG_SECONDS = 5

let dir: string
let inner: string
let cliRecorder: string
let cliHang: string
let cliBroken: string
let recorded: string
let hangPidFile: string

function write(path: string, body: string) {
  writeFileSync(path, body, 'utf-8')
  chmodSync(path, 0o755)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-sl-wrap-'))
  inner = join(dir, 'inner.sh')
  cliRecorder = join(dir, 'cli-recorder.sh')
  cliHang = join(dir, 'cli-hang.sh')
  cliBroken = join(dir, 'cli-does-not-exist.sh')
  recorded = join(dir, 'recorded-payload.json')
  hangPidFile = join(dir, 'hang.pid')

  // The stand-in status line. It echoes the byte COUNT of what it received and then the bytes
  // themselves, so one artifact proves both halves of the pass-through at once: the stdin it was
  // given and the stdout we relayed. Deliberately emits ANSI and no trailing newline — a real
  // status line does both, and both are where a naive wrapper corrupts the output.
  write(
    inner,
    [
      '#!/usr/bin/env bash',
      'tmp="$(mktemp)"',
      'cat > "$tmp"',
      'printf "\\033[32mBYTES=%s\\033[0m|" "$(wc -c < "$tmp" | tr -d " ")"',
      'cat "$tmp"',
      'rm -f "$tmp"',
      'exit "${INNER_EXIT_CODE:-0}"',
    ].join('\n'),
  )

  // The positive control: a CLI that records exactly what it was handed.
  write(
    cliRecorder,
    ['#!/usr/bin/env bash', `[ "$1" = "ingest" ] && [ "$2" = "--file" ] && cp "$3" "${recorded}"`, 'exit 0'].join('\n'),
  )

  // The black hole. Records its own PID so the suite can reap it — a test that leaks a process is
  // a bug in the test, not an acceptable cost.
  write(
    cliHang,
    ['#!/usr/bin/env bash', `echo $$ > "${hangPidFile}"`, `sleep ${HANG_SECONDS}`].join('\n'),
  )
})

afterEach(() => {
  if (existsSync(hangPidFile)) {
    const pid = Number(readFileSync(hangPidFile, 'utf-8').trim())
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone — the sleep finished, or it was never started. Either is fine.
      }
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Run the wrapper.
 *
 * ⚠ `AIMAESTRO_STATUSLINE_CLI` IS ALWAYS SET. Without it the wrapper finds the REAL
 * `scripts/aimaestro-statusline.sh` next to itself and this suite would fire live HTTP at the
 * developer's running server on every case.
 */
function runWrapper(input: Buffer | string, opts: { cli: string; args?: string[]; env?: Record<string, string> } = { cli: '' }) {
  return spawnSync('bash', [WRAPPER, ...(opts.args ?? [inner])], {
    input,
    env: { ...process.env, AIMAESTRO_STATUSLINE_CLI: opts.cli, ...(opts.env ?? {}) },
  })
}

/** The reference: the inner command run with no wrapper at all. */
function runInnerDirectly(input: Buffer | string, env: Record<string, string> = {}) {
  return spawnSync('bash', [inner], { input, env: { ...process.env, ...env } })
}

const PAYLOAD = JSON.stringify({
  session_id: 'abc123',
  model: { id: 'claude-opus-5' },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } },
})

describe('1. stdout is BYTE-IDENTICAL and the inner sees the exact stdin', () => {
  // Three inputs, because the wrapper's failure modes are all about bytes at the edges: a trailing
  // newline that a `$(...)` capture would eat, a payload without one, and multibyte + ANSI content.
  const cases: Array<[string, Buffer]> = [
    ['with a trailing newline', Buffer.from(PAYLOAD + '\n', 'utf-8')],
    ['with NO trailing newline', Buffer.from(PAYLOAD, 'utf-8')],
    ['with multibyte + escape bytes', Buffer.from(JSON.stringify({ session_id: 'x', cwd: '/tmp/née/[31m/日本' }), 'utf-8')],
  ]

  for (const [label, input] of cases) {
    it(`matches the un-wrapped run ${label}`, () => {
      const direct = runInnerDirectly(input)
      const wrapped = runWrapper(input, { cli: cliRecorder })

      expect(direct.status).toBe(0)
      // Buffer equality, not string: a trimmed comparison cannot see a newline gained or lost, and
      // that is precisely the corruption a wrapper introduces.
      expect(wrapped.stdout.equals(direct.stdout)).toBe(true)
      // And the byte count the inner reported is the count we actually sent — proving the inner's
      // STDIN was untouched, not merely that its stdout was relayed.
      //
      // No `|` in the needle: the inner emits an ANSI reset between the number and the pipe, so
      // `BYTES=131|` never appears literally. That the escape survives IN THE MIDDLE of the output
      // is itself the point — a status line is full of them, and the equals() above is what proves
      // they are relayed untouched.
      expect(wrapped.stdout.toString('utf-8')).toContain(`BYTES=${input.length}`)
    })
  }

  it('adds NOTHING to stdout even when the capture path is exercised', () => {
    // The neuter for this file: make the wrapper write one byte to stdout (e.g. `echo x` before the
    // hand-off) and these four tests redden. Verified 2026-08-02.
    const wrapped = runWrapper(PAYLOAD, { cli: cliRecorder })
    const direct = runInnerDirectly(PAYLOAD)
    expect(wrapped.stdout.length).toBe(direct.stdout.length)
  })
})

describe('2. the exit code passes through', () => {
  it('relays 0', () => {
    expect(runWrapper(PAYLOAD, { cli: cliRecorder }).status).toBe(0)
  })

  it('relays a NON-ZERO code — which is why the script carries no `set -e`', () => {
    const r = runWrapper(PAYLOAD, { cli: cliRecorder, env: { INNER_EXIT_CODE: '3' } })
    expect(r.status).toBe(3)
    // The status bar still rendered: a failing inner is not a silent one.
    expect(r.stdout.toString('utf-8')).toContain('BYTES=')
  })

  it('relays 127 when the inner command does not exist, and keeps stdout clean', () => {
    const r = runWrapper(PAYLOAD, { cli: cliRecorder, args: [join(dir, 'no-such-command')] })
    expect(r.status).toBe(127)
    expect(r.stdout.toString('utf-8')).toBe('')
  })
})

describe('3. the capture is DETACHED — the wrapper never waits on it', () => {
  it(`returns immediately though the ingest CLI blocks for ${HANG_SECONDS}s`, () => {
    // PRIVATE $TMPDIR, so this test cleans up after ITSELF. `afterEach` SIGKILLs the hanging child,
    // and SIGKILL is untrappable — so the child's `.cap` copy cannot be removed by the child. Left
    // in the shared system temp dir that would be one leaked file per suite run, forever; inside
    // `dir` it goes with the fixture. A test that leaks is a bug in the test.
    const privateTmp = join(dir, 'hang-tmp')
    mkdirSync(privateTmp)

    const started = Date.now()
    const r = runWrapper(PAYLOAD, { cli: cliHang, env: { TMPDIR: privateTmp } })
    const elapsed = Date.now() - started

    // THE assertion. Claude Code debounces at 300 ms and cancels an in-flight script, so a
    // synchronous POST would stall the bar and then be killed.
    //
    // The bound is 2000 ms rather than the literal 300 ms, and that is deliberate. MEASURED
    // end-to-end on this machine against this same hanging ingest: 47 ms mean over 10 runs (vs a
    // ~41 ms floor that is pure `bash` startup) — comfortably inside the debounce. But a CI box
    // under load is not a benchmark rig, and a 300 ms bound would make this test a flake detector
    // for the scheduler rather than a guard on the code. What it must DISCRIMINATE is 47 ms from
    // 5000 ms, and 2000 ms does that with 2.5x margin on the side that matters: drop the `&` and
    // this reads ~5000 ms and reddens every time. (Neuter verified 2026-08-02.)
    expect(elapsed).toBeLessThan(2000)
    expect(r.status).toBe(0)
    expect(r.stdout.toString('utf-8')).toContain('BYTES=')
  })
})

describe('4. fail-soft', () => {
  it('renders the bar when the ingest CLI does not exist at all', () => {
    const r = runWrapper(PAYLOAD, { cli: cliBroken })
    expect(r.status).toBe(0)
    expect(r.stdout.equals(runInnerDirectly(PAYLOAD).stdout)).toBe(true)
  })

  it('renders the bar when the ingest CLI EXITS NON-ZERO', () => {
    const failing = join(dir, 'cli-fails.sh')
    write(failing, ['#!/usr/bin/env bash', 'echo "boom" >&2', 'exit 1'].join('\n'))
    const r = runWrapper(PAYLOAD, { cli: failing })
    expect(r.status).toBe(0)
    expect(r.stdout.equals(runInnerDirectly(PAYLOAD).stdout)).toBe(true)
  })

  it('keeps the ingest CLI\'s own noise off BOTH our streams', () => {
    // The child's stdio goes to /dev/null. A CLI that chatters must not appear in the status bar,
    // and must not appear in stderr either — Claude Code may surface that.
    const noisy = join(dir, 'cli-noisy.sh')
    write(noisy, ['#!/usr/bin/env bash', 'echo "CHATTER-OUT"', 'echo "CHATTER-ERR" >&2', 'exit 0'].join('\n'))
    const r = runWrapper(PAYLOAD, { cli: noisy })
    expect(r.stdout.toString('utf-8')).not.toContain('CHATTER')
    expect(r.stderr.toString('utf-8')).not.toContain('CHATTER')
  })

  it('is silent by default and only speaks under AIMAESTRO_STATUSLINE_DEBUG', () => {
    const quiet = runWrapper(PAYLOAD, { cli: cliBroken })
    expect(quiet.stderr.toString('utf-8')).toBe('')
    // The debug branch prints to stderr, never stdout — asserted by the byte-identity block above.
    const loud = runWrapper(PAYLOAD, { cli: '', env: { AIMAESTRO_STATUSLINE_DEBUG: '1', AIMAESTRO_STATUSLINE_CLI: '' } })
    expect(loud.stdout.toString('utf-8')).toContain('BYTES=')
  })
})

describe('5. capture-only mode (no inner command)', () => {
  it('prints NOTHING and exits 0 — the correct bar for a user who has none', () => {
    const r = runWrapper(PAYLOAD, { cli: cliRecorder, args: [] })
    expect(r.status).toBe(0)
    expect(r.stdout.toString('utf-8')).toBe('')
  })

  it('accepts `--` before the inner command, for an inner whose first word starts with a dash', () => {
    const r = runWrapper(PAYLOAD, { cli: cliRecorder, args: ['--', inner] })
    expect(r.status).toBe(0)
    expect(r.stdout.toString('utf-8')).toContain('BYTES=')
  })
})

describe('THE POSITIVE CONTROL — the capture actually fires, with the right bytes', () => {
  it('hands the ingest CLI the payload verbatim', async () => {
    // Without this test, every assertion above would pass with the whole capture block DELETED —
    // "the wrapper adds nothing to stdout" is trivially true of a wrapper that does nothing.
    const input = Buffer.from(PAYLOAD + '\n', 'utf-8')
    runWrapper(input, { cli: cliRecorder })

    // The capture is detached BY DESIGN, so it lands after the wrapper has already returned. Poll.
    const deadline = Date.now() + 5000
    while (!existsSync(recorded) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25))
    }

    expect(existsSync(recorded), 'the detached ingest never ran').toBe(true)
    expect(readFileSync(recorded).equals(input)).toBe(true)
  })

  it('leaves no capture copy behind once the ingest has run', async () => {
    // ⚠ THE WRAPPER GETS ITS OWN PRIVATE $TMPDIR HERE, and that is not tidiness — it is what makes
    // the assertion mean anything. The first version of this test counted `aimaestro-statusline.*`
    // in the SHARED system temp dir; in isolation it read 0 and passed, and in the full parallel
    // suite it read 17 and failed, because sibling tests in this very file had wrapper processes
    // in flight whose temp files are perfectly legitimate. A count over a namespace other
    // processes write to measures the scheduler, not the cleanup.
    const privateTmp = join(dir, 'private-tmp')
    mkdirSync(privateTmp)

    runWrapper(PAYLOAD, { cli: cliRecorder, env: { TMPDIR: privateTmp } })

    const deadline = Date.now() + 5000
    while (!existsSync(recorded) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25))
    }
    // The detached child unlinks its copy on exit; give it a beat after the ingest landed.
    await new Promise((r) => setTimeout(r, 250))

    // Both temp files are owned and removed: the parent's payload and the child's `.cap` copy.
    // Non-vacuity: an empty dir here can only mean cleanup ran, since the recorded-payload check
    // above already proved the wrapper DID write into this dir and hand the copy over.
    expect(readdirSync(privateTmp)).toEqual([])
  })

  it('leaves NOTHING behind when the wrapper is CANCELLED mid-run — the routine case', async () => {
    // Not an edge case: Claude Code "cancels the in-flight script" whenever a new update arrives
    // while one is running, which the 300ms debounce makes a normal event. A cleanup that only runs
    // at the bottom of the script never executes on this path, so the old trailing `rm` leaked one
    // payload file per cancelled tick, forever, on every machine.
    //
    // NEUTER: replace the parent's `trap … EXIT` with the trailing `rm` and this test reddens while
    // the rest of the file stays green. (Verified 2026-08-02.)
    const privateTmp = join(dir, 'cancel-tmp')
    mkdirSync(privateTmp)

    const slowInner = join(dir, 'slow-inner.sh')
    write(slowInner, ['#!/usr/bin/env bash', 'cat > /dev/null', 'sleep 2', 'printf BAR'].join('\n'))

    // `detached: true` puts the wrapper in its OWN PROCESS GROUP so the cancellation below can
    // signal the group — which is what a parent cancelling a job actually does, and what makes the
    // difference here. A bare SIGTERM to the wrapper alone is DEFERRED by bash while it waits on a
    // foreground child, so the first draft of this test hung for the inner's full sleep and timed
    // out at vitest's 5s. Signalling the group kills the inner too, bash's wait returns, and the
    // EXIT trap then runs — which is precisely the path the trap exists for.
    const child = spawn('bash', [WRAPPER, slowInner], {
      detached: true,
      env: { ...process.env, AIMAESTRO_STATUSLINE_CLI: cliRecorder, TMPDIR: privateTmp },
    })
    child.stdin.end(PAYLOAD)

    // Let it get past mktemp and into the inner command, then cancel it as Claude Code does.
    await new Promise((r) => setTimeout(r, 400))
    expect(readdirSync(privateTmp).length, 'fixture never reached the state under test').toBeGreaterThan(0)

    process.kill(-(child.pid as number), 'SIGTERM')
    await new Promise<void>((r) => child.on('exit', () => r()))
    await new Promise((r) => setTimeout(r, 250))

    // The `.cap` may survive if the detached child was killed too (SIGKILL is untrappable) — what
    // this test owns is the PARENT's payload, which is the file that leaked once per tick.
    const leftover = readdirSync(privateTmp).filter((f) => !f.endsWith('.cap'))
    expect(leftover, 'the parent leaked its payload when cancelled').toEqual([])
  })
})

/**
 * The INTERACTIVE GUARD (found 2026-08-02 by installing the script on PATH and running
 * `--help` to see what it was — it blocked for EIGHT MINUTES before the caller gave up).
 *
 * The wrapper deliberately has no argument parsing: every argument is the inner command, and it
 * reads stdin unconditionally because Claude Code always pipes the statusline payload in. That is
 * correct on the production path and a trap on PATH, where the first thing anyone does to an
 * unfamiliar command is run it bare. A discovery attempt that hangs the caller's session is worse
 * than an unknown command.
 *
 * The guard keys on `[ -t 0 ]`, which is true ONLY for a terminal — so the pipe case below is the
 * one that actually protects production, and it is the assertion to keep if either must go.
 */
describe('6. interactive guard — answers a discovery attempt instead of blocking forever', () => {
  it('does NOT fire on the production path: piped stdin still runs the inner and relays its code', () => {
    // THE REGRESSION THAT MATTERS. If the guard ever widened past `-t 0` it would break every
    // real statusline tick, and it would do so silently in the user's status bar.
    const r = spawnSync('bash', [WRAPPER, 'sh', '-c', 'printf INNER; exit 7'], {
      input: Buffer.from('{"session_id":"guard-neg"}', 'utf-8'),
      env: { ...process.env, AIMAESTRO_STATUSLINE_CLI: '/usr/bin/true' },
    })
    expect(r.stdout.toString('utf-8')).toContain('INNER')
    expect(r.stdout.toString('utf-8')).not.toContain('statusLine WRAPPER')
    expect(r.status, 'inner exit code must survive the wrapper').toBe(7)
  })

  it('does NOT fire when stdin is closed — /dev/null is not a terminal', () => {
    const r = spawnSync('bash', [WRAPPER, 'echo', 'OK'], {
      input: Buffer.alloc(0),
      env: { ...process.env, AIMAESTRO_STATUSLINE_CLI: '/usr/bin/true' },
    })
    expect(r.stdout.toString('utf-8')).not.toContain('statusLine WRAPPER')
    expect(r.status).toBe(0)
  })

  it('DOES fire on a real terminal: prints usage and exits EX_USAGE instead of hanging', () => {
    // A real pty is the only way to exercise `[ -t 0 ]` — spawnSync always gives the child a pipe,
    // so without this the guard's own branch would be pinned by nothing. python3 is already a hard
    // dependency of this repo (uv, publish.py). The 10s cap is what turns the ORIGINAL bug into a
    // failure rather than a hung suite: if the guard regresses, this times out and reports.
    const driver = `
import pty, os, select, time, sys
pid, fd = pty.fork()
if pid == 0:
    os.execv("/bin/sh", ["/bin/sh", "-c", ${JSON.stringify(`exec bash ${WRAPPER} --help`)}])
buf = b""; t0 = time.time()
while time.time() - t0 < 10:
    r, _, _ = select.select([fd], [], [], 0.5)
    if r:
        try: d = os.read(fd, 65536)
        except OSError: break
        if not d: break
        buf += d
    elif buf: break
_, status = os.waitpid(pid, 0)
sys.stdout.write(buf.decode(errors="replace"))
sys.stderr.write("EXITCODE=%d" % os.waitstatus_to_exitcode(status))
`
    const r = spawnSync('python3', ['-c', driver], { timeout: 20000 })
    expect(r.stdout.toString('utf-8'), 'guard did not answer on a TTY').toContain('statusLine WRAPPER')
    expect(r.stdout.toString('utf-8')).toContain('USAGE:')
    // EXIT 0, not 64 — and this assertion CHANGED on 2026-08-02, because the behaviour it pinned
    // was wrong. It drove the TTY guard using `--help`, which conflated two different callers.
    // `--help` is a CORRECT REQUEST and must succeed; a bare invocation at a terminal is a MISUSE
    // and must not. The old expectation was only satisfiable while `--help` had no handler of its
    // own — i.e. while the bug CORE reported (ai-maestro-plugin#31) was present, where a redirected
    // `--help` fell through and ran as the inner command, exit 0, silently.
    expect(r.stderr.toString('utf-8'), '--help is a correct request; it must exit 0').toContain('EXITCODE=0')
  })

  it('BARE on a real terminal is a MISUSE: usage + EX_USAGE, never a hang', () => {
    // The OTHER trigger, and the one the 8-minute hang actually belonged to. It needs its own test
    // because the two are now independent code paths: `--help` is answered from the ARGUMENT before
    // stdin is examined, this one from stdin being a TTY with no argument. A single test driving
    // both through `--help` proved only whichever ran first.
    const driver = `
import pty, os, select, time, sys
pid, fd = pty.fork()
if pid == 0:
    os.execv("/bin/sh", ["/bin/sh", "-c", ${JSON.stringify(`exec bash ${WRAPPER}`)}])
buf = b""; t0 = time.time()
while time.time() - t0 < 10:
    r, _, _ = select.select([fd], [], [], 0.5)
    if r:
        try: d = os.read(fd, 65536)
        except OSError: break
        if not d: break
        buf += d
    elif buf: break
_, status = os.waitpid(pid, 0)
sys.stdout.write(buf.decode(errors="replace"))
sys.stderr.write("EXITCODE=%d" % os.waitstatus_to_exitcode(status))
`
    const r = spawnSync('python3', ['-c', driver], { timeout: 20000 })
    expect(r.stdout.toString('utf-8'), 'guard did not answer a bare TTY invocation').toContain('USAGE:')
    expect(r.stdout.toString('utf-8'), 'must say WHY it refused').toContain('Refusing to run')
    expect(r.stderr.toString('utf-8'), 'a bare TTY run is a misuse: EX_USAGE').toContain('EXITCODE=64')
  })
})
