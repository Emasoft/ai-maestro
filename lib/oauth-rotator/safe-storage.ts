// Cross-platform OS secret storage — the single abstraction for keeping rotator secrets
// ENCRYPTED at rest in the platform's native secret store, never plaintext on disk.
//
// FAITHFUL TypeScript port of scripts/oauth_rotator/safe_storage.py (TRDD-1GGQ4HWY): the
// ai-maestro server reproduces the daemon's keychain custody internally. The invariants
// below are load-bearing and MUST match the Python byte-for-byte, because the server and
// any residual janitor `#N` daemon share the SAME keychain items and the SAME denied-latch
// file (they coordinate through them):
//
//  - Secret transit is NOT uniform (a hard platform constraint): macOS puts the value on
//    ARGV (`security add-generic-password -w <data>`) because the stdin form reads via
//    getpass() whose buffer is a hard 128 bytes and SILENTLY TRUNCATES anything larger
//    (the "rotator never worked" bug — an 8KB blob stored as 128). Linux/Windows use stdin.
//  - Every secret is base64-wrapped at the public API so the stored bytes are printable
//    ASCII and round-trip byte-for-byte; without it macOS `security -w` hex-dumps any value
//    with non-printable bytes and silently corrupts it. NOT for confidentiality.
//  - Three-valued write result: OK | NO_BACKEND (no store at all — a documented plaintext
//    fallback is legit) | FAILED (a store IS present but the write was refused — the caller
//    MUST fail closed, NEVER plaintext).
//  - The keychain-denied LATCH is the circuit-breaker that makes a prompt-flood structurally
//    impossible: once any `security` op is denied/hangs, a persistent flag is set and EVERY
//    later op short-circuits WITHOUT spawning `security`, so at most ONE prompt can ever
//    occur machine-wide. Half-open auto-recovery (TRDD-EQJPPZ2L) turns it from a permanent
//    kill into a temporary breaker that self-heals one cooldown after the transient clears.
//
// This module never logs a secret value.

import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { globalStateDir, legacyReadPath } from './global-state'
import { testOnlyEnv } from '../test-only-env'

// How long to wait on a secret-store CLI before giving up (a hung keyring prompt must never
// wedge the unattended daemon tick).
const CLI_TIMEOUT_MS = 10_000

// Circuit-breaker half-open cooldown (TRDD-EQJPPZ2L). The denied-latch is otherwise
// SELF-PERPETUATING — once set every op short-circuits, so no write can ever clear it and
// rotation stays dark forever until a human clears the latch. This cooldown makes it a
// TEMPORARY breaker: after this many seconds a latched state permits exactly ONE probe;
// if the keychain answers without prompting the latch clears, else it re-stamps and backs
// off another cooldown. Env-override CLAUDE_KEYCHAIN_LATCH_COOLDOWN_S; a value <= 0 DISABLES
// auto-recovery (permanent latch until cleared by hand).
const LATCH_COOLDOWN_DEFAULT_S = 600.0

const KEYCHAIN_LATCH_NAME = 'keychain-denied.latch'

// Substrings that mark a `security` result as a DENIAL worth latching on (case-insensitive).
// Deliberately NARROW: an ACL/unlock/interaction denial or a user-canceled prompt — NEVER
// "item could not be found" (a normal not-found must not latch and deny everything).
const DENIAL_MARKERS = [
  'user interaction is not allowed',
  'the user name or passphrase you entered is not correct',
  'user canceled',
  'user cancelled',
  'errsecauthfailed',
  '-25293', // errSecAuthFailed
  'errsecinteractionnotallowed',
  '-25308', // errSecInteractionNotAllowed
  'errsecusercanceled',
  '-128', // errSecUserCanceled
] as const

/** Outcome of ONE gated `security` invocation via {@link runSecurity}. */
export interface SecurityRun {
  ok: boolean // `security` ran AND returned 0
  stdout: string // its stdout (empty unless it ran)
  stderr: string // its stderr (empty unless it ran)
  spawned: boolean // true IFF the `security` subprocess was actually launched
  denied: boolean // blocked by the pre-set latch (no spawn) OR this call tripped it
  returncode: number | null
}

/** Outcome of a {@link store} call — three-valued so callers can fail closed. */
export enum StoreResult {
  OK = 'ok', // a secret store accepted the write
  NO_BACKEND = 'no_backend', // no secret store present — caller's plaintext fallback is legit
  FAILED = 'failed', // a store IS present but the write FAILED — caller MUST fail closed
}

// --------------------------------------------------------------------------
// The denied-latch (machine-wide circuit breaker)
// --------------------------------------------------------------------------
function keychainLatchPath(): string {
  return path.join(globalStateDir(), KEYCHAIN_LATCH_NAME)
}

/** Absolute legacy latch path during the dual-read window, or null under the env override. */
function legacyKeychainLatchPath(): string | null {
  return legacyReadPath(KEYCHAIN_LATCH_NAME)
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * True iff the denied-latch is set (canonical OR the legacy path during the dual-read
 * window) — a prior `security` op was denied/hung, so NO further op should even spawn.
 */
export function keychainDeniedLatched(): boolean {
  if (isFile(keychainLatchPath())) return true
  const legacy = legacyKeychainLatchPath()
  return legacy !== null && isFile(legacy)
}

/**
 * Set the persistent denied-latch (atomic tmp+rename) and log ONE actionable line. Never
 * throws (a latch we can't write must not crash the caller). `quiet` suppresses the log — used
 * for the half-open re-stamp, which refreshes the timestamp WITHOUT spamming the banner.
 */
export function setKeychainDenied(reason: string, opts: { quiet?: boolean } = {}): void {
  const p = keychainLatchPath()
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const stamp = new Date().toISOString()
    const tmp = `${p}.tmp.${process.pid}`
    fs.writeFileSync(tmp, `${stamp}\t${reason}\n`, 'utf8')
    fs.renameSync(tmp, p) // atomic replace — refreshes mtime, which is what _latchAgeSeconds reads
  } catch {
    // best-effort — the in-call denial still returned; the latch is an optimization.
  }
  if (opts.quiet) return
  try {
    console.error(
      `[safe-storage] KEYCHAIN DENIED-LATCH SET: ${reason}. All further \`security\` ops ` +
        'are suppressed (no prompt) until you re-grant access and clear the latch.',
    )
  } catch {
    // never let a logging failure escape
  }
}

/**
 * Clear the denied-latch (BOTH canonical and legacy — keychainDeniedLatched honors either,
 * so clearing only one would leave the machine silently locked out). Returns true iff a
 * latch was present + removed. Never throws.
 */
export function clearKeychainDenied(): boolean {
  let cleared = false
  for (const p of [keychainLatchPath(), legacyKeychainLatchPath()]) {
    if (p === null) continue
    try {
      fs.rmSync(p)
      cleared = true
    } catch {
      // not present / unreadable — try the other path
    }
  }
  return cleared
}

/** Seconds since the latch was last (re-)stamped (file mtime), or null if none/unreadable. */
function latchAgeSeconds(): number | null {
  for (const p of [keychainLatchPath(), legacyKeychainLatchPath()]) {
    if (p === null) continue
    try {
      return Math.max(0, Date.now() / 1000 - fs.statSync(p).mtimeMs / 1000)
    } catch {
      continue
    }
  }
  return null
}

/** The half-open cooldown in seconds. A malformed env value is ignored (→ default). */
function latchCooldownS(): number {
  const raw = (process.env.CLAUDE_KEYCHAIN_LATCH_COOLDOWN_S ?? '').trim()
  if (raw) {
    const v = Number(raw)
    if (Number.isFinite(v)) return v
  }
  return LATCH_COOLDOWN_DEFAULT_S
}

/** True iff a NON-ZERO `security` result is an ACL/auth/user-canceled DENIAL (a benign
 * not-found is explicitly NOT a denial). Exported for unit testing the latch predicate. */
export function isDenial(stderr: string): boolean {
  const low = stderr.toLowerCase()
  if (low.includes('could not be found') || low.includes('the specified item could not be found')) {
    return false
  }
  return DENIAL_MARKERS.some(m => low.includes(m))
}

/**
 * THE single gate EVERY `security` invocation routes through. Enforces, in order: denied-latch
 * short-circuit BEFORE spawning → hard timeout → latch-on-denial. Never throws. When the latch
 * is unset and no denial occurs this is a plain `spawnSync`.
 *
 * Half-open auto-recovery (TRDD-EQJPPZ2L): while the latch is set AND younger than the cooldown
 * the op short-circuits (no spawn). Once older, exactly ONE call is let through as a probe: it
 * re-stamps the latch first (so concurrent callers stay closed — one probe per cooldown
 * machine-wide) then spawns once; a clean answer clears the latch, a hang/denial re-stamps it.
 */
export function runSecurity(argv: string[], opts: { timeoutMs?: number } = {}): SecurityRun {
  const timeoutMs = opts.timeoutMs ?? CLI_TIMEOUT_MS
  let halfOpen = false
  if (keychainDeniedLatched()) {
    const cooldown = latchCooldownS()
    const age = latchAgeSeconds()
    if (cooldown <= 0 || age === null || age < cooldown) {
      // CLOSED: latch fresh (or auto-recovery disabled / age unknown) → never spawn.
      return { ok: false, stdout: '', stderr: '', spawned: false, denied: true, returncode: null }
    }
    // HALF-OPEN: allow exactly one probe; re-stamp now (quiet) to bound the machine to one.
    halfOpen = true
    setKeychainDenied('keychain-denied latch: half-open probe (auto-recovery, TRDD-EQJPPZ2L)', {
      quiet: true,
    })
  }

  const res = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: timeoutMs })

  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      // `security` absent → not really macOS. NOT a denial; caller may try another backend.
      return { ok: false, stdout: '', stderr: '', spawned: false, denied: false, returncode: null }
    }
    // Any other spawn error (a timeout kill sets ETIMEDOUT) is treated as a hung/blocked op —
    // latch it so the next op short-circuits. This is the Python TimeoutExpired branch, widened
    // to "never raise" for any non-ENOENT spawn failure (a permission error on the binary etc.).
    setKeychainDenied(
      `a \`security\` op hung past ${timeoutMs / 1000}s (a keychain unlock/ACL prompt)`,
    )
    return { ok: false, stdout: '', stderr: '', spawned: true, denied: true, returncode: null }
  }

  const stderr = res.stderr ?? ''
  const returncode = res.status // null if killed by a signal (handled by res.error above)
  if (returncode !== 0 && isDenial(stderr)) {
    setKeychainDenied('`security` returned an ACL/auth/user-canceled denial')
    return { ok: false, stdout: res.stdout ?? '', stderr, spawned: true, denied: true, returncode }
  }
  // Spawned and NOT denied → the keychain answered without prompting. If this was the
  // half-open probe, the transient cleared: drop the latch so normal ops resume.
  if (halfOpen) clearKeychainDenied()
  return {
    ok: returncode === 0,
    stdout: res.stdout ?? '',
    stderr,
    spawned: true,
    denied: false,
    returncode,
  }
}

// --------------------------------------------------------------------------
// Backend detection
// --------------------------------------------------------------------------
/** True iff `tool` is on PATH and executable — a shutil.which equivalent. */
function whichSync(tool: string): boolean {
  const envPath = process.env.PATH ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : ['']
  for (const dir of envPath.split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, tool + ext)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return true
      } catch {
        // keep looking
      }
    }
  }
  return false
}

/** Active backend id: `macos` | `secret_tool` | `dpapi` | `none`. Picks by platform + tool
 * availability. A TEST-ONLY CLAUDE_SAFE_STORAGE_BACKEND override wins first — honored inside the
 * test runner (so a test can force `none` and never touch the real keychain), IGNORED in dev and
 * production (TRDD-CC9PY337). Honored outside a test, `none` would silently store OAuth tokens in
 * plaintext instead of the OS keychain — which is why it is gated, not merely trusted. */
export function detectBackend(): string {
  const forced = (testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND') ?? '').trim()
  if (forced) return forced
  const system = process.platform
  if (system === 'darwin' && whichSync('security')) return 'macos'
  if (system === 'win32' && whichSync('powershell')) return 'dpapi'
  // Linux (and any other Unix) → Secret Service if secret-tool is installed.
  if (whichSync('secret-tool')) return 'secret_tool'
  if (system === 'darwin' && whichSync('security')) return 'macos'
  return 'none'
}

// --------------------------------------------------------------------------
// Keychain-scope lever — confine every rotator `security` op to a named keychain. TEST-ONLY
// (TRDD-CC9PY337): honored inside the test runner (tests point it at an isolated temp keychain),
// IGNORED in dev/production, where it would otherwise confine the rotator's REAL keychain ops to
// an attacker-chosen keychain. Ignored ⇒ [] ⇒ the default (login) keychain, which is correct.
// --------------------------------------------------------------------------
export function keychainScopeArgs(): string[] {
  const kc = (testOnlyEnv('JANITOR_ROTATOR_KEYCHAIN') ?? '').trim()
  return kc ? [kc] : []
}

// --------------------------------------------------------------------------
// Argv builders — pure, so tests assert command construction without executing.
// --------------------------------------------------------------------------
export function macosStoreArgv(service: string, account: string, secret: string): string[] {
  // Value ON ARGV (`-w <secret>`), never stdin — the stdin form truncates at 128 bytes via
  // getpass() (TRDD-5539cd6e). `-U` updates an existing item.
  return [
    'security',
    'add-generic-password',
    '-U',
    '-s',
    service,
    '-a',
    account,
    '-w',
    secret,
    ...keychainScopeArgs(),
  ]
}

export function macosRetrieveArgv(service: string, account: string): string[] {
  return ['security', 'find-generic-password', '-s', service, '-a', account, '-w', ...keychainScopeArgs()]
}

export function macosDeleteArgv(service: string, account: string): string[] {
  return ['security', 'delete-generic-password', '-s', service, '-a', account, ...keychainScopeArgs()]
}

export function secretToolStoreArgv(service: string, account: string): string[] {
  return [
    'secret-tool',
    'store',
    '--label',
    'ai-maestro-janitor safe-storage',
    'service',
    service,
    'account',
    account,
  ]
}

export function secretToolRetrieveArgv(service: string, account: string): string[] {
  return ['secret-tool', 'lookup', 'service', service, 'account', account]
}

export function secretToolDeleteArgv(service: string, account: string): string[] {
  return ['secret-tool', 'clear', 'service', service, 'account', account]
}

// --------------------------------------------------------------------------
// Public API — store / retrieve / delete, base64-wrapping at the boundary.
// --------------------------------------------------------------------------
/**
 * Store `secret` ENCRYPTED under (service, account). Three-valued result so callers fail
 * closed. The secret is base64-wrapped first so it round-trips byte-for-byte; on macOS the
 * printable-ASCII wrapped value goes on argv, elsewhere stdin.
 */
export function store(service: string, account: string, secret: string): StoreResult {
  const wrapped = Buffer.from(secret, 'utf8').toString('base64')
  const backend = detectBackend()
  if (backend === 'macos') return macosStore(service, account, wrapped)
  if (backend === 'secret_tool') return secretToolStore(service, account, wrapped)
  if (backend === 'dpapi') return dpapiStore(service, account, wrapped)
  return StoreResult.NO_BACKEND
}

/**
 * Return the stored secret string for (service, account), or null if absent / unreadable /
 * no backend / not a value this module wrote. A value that fails base64 or UTF-8 decode
 * returns null (fail-safe) rather than a garbled string.
 */
export function retrieve(service: string, account: string): string | null {
  const backend = detectBackend()
  let raw: string | null
  if (backend === 'macos') raw = macosRetrieve(service, account)
  else if (backend === 'secret_tool') raw = secretToolRetrieve(service, account)
  else if (backend === 'dpapi') raw = dpapiRetrieve(service, account)
  else raw = null
  if (raw === null) return null
  return strictB64Utf8Decode(raw)
}

/** Best-effort removal from the active backend. Never throws — missing item / no backend
 * is a no-op. */
export function deleteSecret(service: string, account: string): void {
  const backend = detectBackend()
  if (backend === 'macos') macosDelete(service, account)
  else if (backend === 'secret_tool') secretToolDelete(service, account)
  else if (backend === 'dpapi') dpapiDelete(service, account)
}

/** Strict base64 → UTF-8 decode, replicating Python base64.b64decode(validate=True) +
 * .decode('utf-8'): reject non-canonical base64 or invalid UTF-8 by returning null.
 * Exported for unit testing the fail-safe. */
export function strictB64Utf8Decode(raw: string): string | null {
  // Canonical base64 only (Buffer.from is lenient; the regex + round-trip make it strict).
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) return null
  const buf = Buffer.from(raw, 'base64')
  if (buf.toString('base64') !== raw) return null // lenient decode swallowed garbage → reject
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

// --------------------------------------------------------------------------
// macOS backend (`security`) — routed through the runSecurity choke-point.
// --------------------------------------------------------------------------
function macosStore(service: string, account: string, secret: string): StoreResult {
  const run = runSecurity(macosStoreArgv(service, account, secret))
  if (!run.spawned && !run.denied) return StoreResult.NO_BACKEND // `security` absent
  if (!run.ok) return StoreResult.FAILED // latched, hung, denied, or non-zero — fail closed
  return StoreResult.OK
}

function macosRetrieve(service: string, account: string): string | null {
  const run = runSecurity(macosRetrieveArgv(service, account))
  if (!run.ok) return null // absent / latched / hung / denied / not-found
  // `security -w` prints the secret + a trailing newline; strip ONLY that trailing newline,
  // not interior whitespace the secret may legitimately hold.
  const out = run.stdout
  return out.endsWith('\n') ? out.slice(0, -1) : out
}

function macosDelete(service: string, account: string): void {
  runSecurity(macosDeleteArgv(service, account)) // best-effort; latch/timeout enforced
}

// --------------------------------------------------------------------------
// Linux backend (`secret-tool` / libsecret) — value on STDIN (no 128-byte limit).
// --------------------------------------------------------------------------
function secretToolStore(service: string, account: string, secret: string): StoreResult {
  const argv = secretToolStoreArgv(service, account)
  const res = spawnSync(argv[0], argv.slice(1), {
    input: secret,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
  })
  if (res.error) {
    return (res.error as NodeJS.ErrnoException).code === 'ENOENT'
      ? StoreResult.NO_BACKEND
      : StoreResult.FAILED
  }
  return res.status === 0 ? StoreResult.OK : StoreResult.FAILED
}

function secretToolRetrieve(service: string, account: string): string | null {
  const argv = secretToolRetrieveArgv(service, account)
  const res = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: CLI_TIMEOUT_MS })
  if (res.error) return null
  if (res.status === 0 && res.stdout) {
    const out = res.stdout
    return out.endsWith('\n') ? out.slice(0, -1) : out
  }
  return null
}

function secretToolDelete(service: string, account: string): void {
  const argv = secretToolDeleteArgv(service, account)
  spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: CLI_TIMEOUT_MS })
}

// --------------------------------------------------------------------------
// Windows backend (DPAPI via PowerShell) — per-user encryption under %LOCALAPPDATA%. The
// secret is fed on STDIN, never argv. Best-effort; not yet round-trip-verified on Windows.
// --------------------------------------------------------------------------
function dpapiDir(): string {
  const base = process.env.LOCALAPPDATA || os.homedir()
  return path.join(base, 'ai-maestro-janitor', 'safe-storage')
}

function dpapiPath(service: string, account: string): string {
  // Filesystem-safe name; the DPAPI ciphertext is per-user so the filename carries no secret.
  const safe = [...`${service}__${account}`]
    .map(c => (/[a-zA-Z0-9]/.test(c) || '-_.'.includes(c) ? c : '_'))
    .join('')
  return path.join(dpapiDir(), safe + '.dpapi')
}

function dpapiStore(service: string, account: string, secret: string): StoreResult {
  const p = dpapiPath(service, account)
  const ps =
    "$ErrorActionPreference='Stop';" +
    '$dir=Split-Path -Parent $env:SS_PATH;' +
    'if(!(Test-Path $dir)){New-Item -ItemType Directory -Force -Path $dir | Out-Null};' +
    '$s=[Console]::In.ReadToEnd();' +
    '$sec=ConvertTo-SecureString $s -AsPlainText -Force;' +
    'ConvertFrom-SecureString $sec | Set-Content -NoNewline -Path $env:SS_PATH'
  const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    input: secret,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
    env: { ...process.env, SS_PATH: p },
  })
  if (res.error) {
    return (res.error as NodeJS.ErrnoException).code === 'ENOENT'
      ? StoreResult.NO_BACKEND
      : StoreResult.FAILED
  }
  return res.status === 0 ? StoreResult.OK : StoreResult.FAILED
}

function dpapiRetrieve(service: string, account: string): string | null {
  const p = dpapiPath(service, account)
  if (!isFile(p)) return null
  const ps =
    "$ErrorActionPreference='Stop';" +
    '$enc=Get-Content -Raw -Path $env:SS_PATH;' +
    '$sec=ConvertTo-SecureString $enc;' +
    '$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec);' +
    '[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)'
  const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
    env: { ...process.env, SS_PATH: p },
  })
  if (res.error) return null
  if (res.status === 0) {
    const out = res.stdout ?? ''
    return out.endsWith('\n') ? out.slice(0, -1) : out
  }
  return null
}

function dpapiDelete(service: string, account: string): void {
  try {
    fs.rmSync(dpapiPath(service, account))
  } catch {
    // missing → no-op
  }
}
