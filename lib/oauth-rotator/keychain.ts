// Rotator ACL-aware macOS keychain custody (TRDD-1GGQ4HWY Phase D).
//
// FAITHFUL port of rotator.py's `_add_password_argv` / `_keychain_item_exists` /
// `_security_add_password_via_stdin` — the keychain WRITE path the slot store (Phase D) and
// the live-credential store (Phase E) share. It is DISTINCT from safe-storage.ts's
// `store()`/`retrieve()`, which base64-wrap: rotator slot + live blobs are stored as RAW
// values (compact JSON) so a shared janitor `#N` read (`json.loads(security -w output)`)
// parses them byte-for-byte. Every `security` op routes through safe-storage.ts's
// `runSecurity` choke-point (denied-latch + hard timeout + latch-on-hang).
//
// THE CREATE-vs-UPDATE RULE (TRDD-EQJPPZ2L — the definitive rotation-death fix). An ACL flag
// (`-A` or the `-T` partners) is emitted ONLY on CREATE; a data-only UPDATE carries NO ACL
// flag. Under `-U`, passing ANY ACL flag on an item that ALREADY exists forces macOS to
// re-apply the ACL via `SecKeychainItemSetAccess` — a privileged op that PROMPTS every time.
// Unattended, that prompt hangs → the timeout trips the denied-latch → every later `security`
// op short-circuits → rotation goes dark. So the caller probes existence first (attribute-only,
// silent) and sets the ACL only when the item is NEW.

import * as fs from 'fs'
import {
  runSecurity,
  keychainScopeArgs,
  macosRetrieveArgv,
  macosDeleteArgv,
  detectBackend,
} from './safe-storage'

/** A snappy timeout for the attribute probe + secret read — a hung one latches, so keep it
 * short (matches rotator.py's `timeout=5` on these ops). */
const PROBE_TIMEOUT_MS = 5_000

/**
 * True iff the macOS `security` backend is the one to use. Every op below gates on this: on
 * Linux/Windows (or a forced-off backend) `security` is absent, exactly as rotator.py's
 * `_security_add_password_via_stdin` raises FileNotFoundError there — the caller's next tier
 * (secret-tool, plaintext) takes over. Honours CLAUDE_SAFE_STORAGE_BACKEND, so a unit test
 * forcing `none` keeps every keychain op inert (0-IMPACT — the real keychain is never touched).
 */
function macosActive(): boolean {
  return detectBackend() === 'macos'
}

/** Three-valued outcome of {@link securityWrite} so callers fail closed. Mirrors rotator.py's
 * True / False / KEYCHAIN_WRITE_FAILED triple (audit §3.1). */
export enum KeychainWriteResult {
  OK = 'ok', // `security` accepted the write
  NO_KEYCHAIN = 'no_keychain', // `security` is ABSENT (not macOS) — a caller's next tier is legit
  WRITE_FAILED = 'write_failed', // `security` IS present but the write was refused — FAIL CLOSED
}

/**
 * The `security add-generic-password` argv, a PURE builder (tests assert its shape without a
 * keychain). `setAcl` MUST be true only on CREATE; `allowAny` selects WHICH ACL on create —
 * `-A` (allow ANY app) for the rotator's OWN slot family (user-approved, so a shifting
 * uv/node cache path can never later mismatch and re-prompt) vs the two `-T` partners
 * (`/usr/bin/security`, through which every read goes, + this interpreter) for the live-cred
 * family. On UPDATE no ACL flag is emitted, so macOS preserves the existing item's ACL.
 */
export function addPasswordArgv(
  service: string,
  account: string,
  data: string,
  opts: { allowAny?: boolean; setAcl?: boolean } = {},
): string[] {
  const { allowAny = false, setAcl = true } = opts
  let acl: string[]
  if (setAcl) {
    // `-A` and the `-T` partner list are mutually exclusive by intent (allow-all vs partners).
    // The interpreter partner is this process's binary (node) — the live-cred family (Phase E);
    // cross-process reads are covered by the `/usr/bin/security` partner regardless.
    acl = allowAny ? ['-A'] : ['-T', '/usr/bin/security', '-T', fs.realpathSync(process.execPath)]
  } else {
    acl = [] // data-only UPDATE — NO ACL flag → no SecKeychainItemSetAccess → no prompt
  }
  return [
    'security',
    'add-generic-password',
    '-U',
    '-s',
    service,
    '-a',
    account,
    ...acl,
    '-w',
    data,
    ...keychainScopeArgs(),
  ]
}

/**
 * True iff a keychain item (service, account) PROVABLY exists — via an attribute-only
 * `find-generic-password` (NO `-w`), so it never touches the ACL-protected secret and never
 * prompts (why it is safe before every write). Absence must be PROVEN (errSecItemNotFound = rc
 * 44 / "could not be found"); EVERY other outcome (not macOS, latched/hung/denied, an odd rc)
 * returns true — "assume it exists" — so the write NEVER sets an ACL on a maybe-present item.
 */
export function keychainItemExists(service: string, account: string): boolean {
  if (!macosActive()) return true // not macOS → assume-exists (the safe direction: never set an ACL)
  const run = runSecurity(
    ['security', 'find-generic-password', '-s', service, '-a', account, ...keychainScopeArgs()],
    { timeoutMs: PROBE_TIMEOUT_MS },
  )
  if (run.ok) return true // rc 0 → exists
  if (run.spawned && !run.denied && (run.returncode === 44 || run.stderr.includes('could not be found'))) {
    return false // errSecItemNotFound → PROVEN absent → create with its ACL
  }
  return true // not macOS / latched / hung / ambiguous → assume exists (never risk an ACL prompt)
}

/**
 * Store RAW `data` under (service, account) on macOS `security`, ACL-aware. Probes existence
 * to decide create-vs-update, then writes via {@link addPasswordArgv}. Three-valued: OK,
 * NO_KEYCHAIN (`security` absent — the caller's next tier is legitimate), WRITE_FAILED
 * (present but denied/hung/non-zero — the caller MUST fail closed, never plaintext).
 */
export function securityWrite(
  service: string,
  account: string,
  data: string,
  opts: { allowAny?: boolean } = {},
): KeychainWriteResult {
  if (!macosActive()) return KeychainWriteResult.NO_KEYCHAIN // `security` absent (not macOS)
  const setAcl = !keychainItemExists(service, account)
  const run = runSecurity(addPasswordArgv(service, account, data, { allowAny: opts.allowAny, setAcl }))
  if (!run.spawned && !run.denied) return KeychainWriteResult.NO_KEYCHAIN // `security` absent (ENOENT)
  if (!run.ok) return KeychainWriteResult.WRITE_FAILED // latched / hung / denied / non-zero
  return KeychainWriteResult.OK
}

/** Read the RAW stored value for (service, account) via `security -w`, or null if absent /
 * latched / hung / denied / not-found. NOT base64-decoded — the rotator stores raw JSON. The
 * `security -w` trailing newline is stripped (only that, not interior whitespace). */
export function securityReadRaw(
  service: string,
  account: string,
  opts: { timeoutMs?: number } = {},
): string | null {
  if (!macosActive()) return null // `security` absent (not macOS)
  const run = runSecurity(macosRetrieveArgv(service, account), {
    timeoutMs: opts.timeoutMs ?? PROBE_TIMEOUT_MS,
  })
  if (!run.ok) return null
  const out = run.stdout
  return out.endsWith('\n') ? out.slice(0, -1) : out
}

/** Best-effort delete of (service, account) from macOS `security`. Never throws — a missing
 * item / absent `security` / latched state is a no-op (still routed through the gate). */
export function securityDelete(service: string, account: string): void {
  if (!macosActive()) return // `security` absent (not macOS) — no-op
  runSecurity(macosDeleteArgv(service, account), { timeoutMs: PROBE_TIMEOUT_MS })
}
