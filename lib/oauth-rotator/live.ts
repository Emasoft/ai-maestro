// The LIVE Claude Code credential custody (TRDD-1GGQ4HWY Phase E.1).
//
// ⚠️ R16 — THE ONE IRREVERSIBLE WRITE. `writeLiveBlob` overwrites the REAL `Claude Code-credentials`
// keychain item (the user's active login). It is ported here as INFRA (Node server, never a Claude
// context, so no token enters a transcript) but it is NOT wired to any server tick / route yet: the
// first LIVE activation against the real credential requires an explicit USER go-ahead (the signed
// TRDD-H24DF6ZC R16 checkpoint). Every unit test forces the backend off + HOME→a temp dir (with a
// hard guard), so no test ever reads or writes the real credential.
//
// FAITHFUL port of rotator.py's live read/write/mirror block (485–743). Byte-compat with the janitor
// `#N` fallback (shared item, presence/delegation, never concurrent): the blob is stored RAW (compact
// JSON, no base64 — via keychain.ts), and the redundant `-livebak` mirror reuses the exact slot
// keychain helpers. Two safety properties are load-bearing and preserved:
//   • macOS never creates `~/.claude/.credentials.json` — Claude's live-re-read keys off that file's
//     ABSENCE, so writing it on macOS would defeat the re-read. The file is written ONLY when
//     `security` is absent (Linux/Windows), where the mtime change IS the re-read trigger.
//   • F1 (TRDD-7PYTX4E9): a decision path must NOT consume the `-livebak` mirror as if it were the
//     primary — a user `/login` writes a Claude-only-ACL item the headless server cannot read, and a
//     silent mirror fallback would substitute a STALE credential. readLiveBlobWithSource() exposes
//     the source so ROTATE (Phase E.2) can treat "mirror" as an untrusted identity.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { securityWrite, securityReadRaw, keychainItemExists, KeychainWriteResult } from './keychain'
import { detectBackend } from './safe-storage'
import { slotKeychainRead, slotKeychainWrite, type CredentialBlob } from './slots'

/** The live credential's keychain service — Claude Code owns this item; the rotator switches it.
 * A plain constant (no env override), matching rotator.py. */
export const KEYCHAIN_SERVICE = 'Claude Code-credentials'

/** The redundant `-livebak` mirror service (env-overridable for tests only; production default). */
export const LIVE_BACKUP_KEYCHAIN_SERVICE =
  process.env.CLAUDE_ROTATOR_LIVE_BACKUP_KEYCHAIN_SERVICE?.trim() || 'Claude Code-credentials-livebak'

/** A live `-w` read may be slower than a slot read (the ACL-restricted primary) — a longer bound
 * than the 5 s probe, matching rotator.py's `timeout=10`. */
const LIVE_READ_TIMEOUT_MS = 10_000

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function macosActive(): boolean {
  return detectBackend() === 'macos'
}

function secretToolActive(): boolean {
  return detectBackend() === 'secret_tool'
}

function credentialsFilePath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json')
}

/** The keychain account attribute Claude Code uses — the macOS short username. MUST match Claude's
 * own value (`$USER || $LOGNAME`), or the server would read/write a DIFFERENT keychain account than
 * the live login. */
export function keychainAccount(): string {
  return process.env.USER || process.env.LOGNAME || ''
}

/** False when this process must NOT do a PROMPTING `-w` secret read of the ACL-restricted primary —
 * the headless daemon sets JANITOR_ROTATOR_HEADLESS=1, where a `-w` read of a Claude-only-ACL item
 * can only raise a GUI prompt it cannot answer (it hangs). Then readLivePrimary falls to the mirror.
 * Unset (a session-context run) → true → byte-identical `-w` behaviour. */
export function primarySecretReadPermitted(): boolean {
  const raw = (process.env.JANITOR_ROTATOR_HEADLESS ?? '').trim().toLowerCase()
  return raw === '' || raw === '0' || raw === 'false' || raw === 'no' || raw === 'off'
}

/** The macOS `security -w` read of the primary live item, or null if absent / unreadable / SKIPPED
 * because headless. Skipping when headless avoids the ~30-min ACL-prompt hang (TRDD-7PYTX4E9 FIX B2). */
function readPrimaryMacosKeychain(acct: string): CredentialBlob | null {
  if (!primarySecretReadPermitted()) return null
  const raw = securityReadRaw(KEYCHAIN_SERVICE, acct, { timeoutMs: LIVE_READ_TIMEOUT_MS })
  if (raw === null) return null
  const t = raw.trim()
  if (!t) return null
  try {
    return JSON.parse(t) as CredentialBlob
  } catch {
    return null
  }
}

/** The live credential from its PRIMARY store, or null. Cross-platform ladder, first hit wins:
 * macOS keychain (account=$USER) → `~/.claude/.credentials.json` (Linux/Windows) → GNOME keyring. */
export function readLivePrimary(): CredentialBlob | null {
  const macos = readPrimaryMacosKeychain(keychainAccount())
  if (macos !== null) return macos
  const cf = credentialsFilePath()
  if (isFile(cf)) {
    try {
      return JSON.parse(fs.readFileSync(cf, 'utf8')) as CredentialBlob
    } catch {
      // fall through
    }
  }
  if (secretToolActive()) {
    const r = spawnSync('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE], {
      encoding: 'utf8',
      timeout: 5_000,
    })
    if (!r.error && r.status === 0 && r.stdout) {
      const t = r.stdout.trim()
      if (t) {
        try {
          return JSON.parse(t) as CredentialBlob
        } catch {
          // fall through
        }
      }
    }
  }
  return null
}

/** Read the redundant `-livebak` mirror of the LIVE credential (keychain-only, account=$USER). Reuses
 * the slot keychain helpers — same encrypted store, a different (service, account) pair. */
export function liveBackupRead(): CredentialBlob | null {
  return slotKeychainRead(keychainAccount(), LIVE_BACKUP_KEYCHAIN_SERVICE)
}

/** Mirror the LIVE credential into the `-livebak` keychain service (Pillar 2 in-advance backup).
 * Keychain-only — never creates the credentials file (preserves the macOS live-re-read). Best-effort. */
export function liveBackupWrite(blob: CredentialBlob): void {
  slotKeychainWrite(keychainAccount(), blob, LIVE_BACKUP_KEYCHAIN_SERVICE)
}

/** True ONLY when the primary live credential is PROVABLY absent. An ACL-DENIED primary still EXISTS
 * (holds the user's login) and must never be treated as "gone", so anything ambiguous (denied / hung
 * / odd rc) counts as PRESENT. On non-macOS the primary is the credentials file. (TRDD-7PYTX4E9) */
export function primaryLiveItemAbsent(): boolean {
  if (!macosActive()) return !isFile(credentialsFilePath()) // not macOS → the file IS the primary
  // macOS: keychainItemExists proves absence only on errSecItemNotFound; denied/hung → assume-exists
  // → not absent. So "provably absent" is exactly its negation.
  return !keychainItemExists(KEYCHAIN_SERVICE, keychainAccount())
}

/** The live credential PLUS where it came from ("primary" | "mirror" | "none"). Rotation decisions
 * MUST branch on the source and treat "mirror" as an UNTRUSTED identity (F1). */
export function readLiveBlobWithSource(): [CredentialBlob | null, 'primary' | 'mirror' | 'none'] {
  const prim = readLivePrimary()
  if (prim !== null) return [prim, 'primary']
  const mirror = liveBackupRead()
  if (mirror !== null) return [mirror, 'mirror']
  return [null, 'none']
}

/** The live credential, robust against a corrupt/missing primary (primary ladder, then the mirror).
 * A read never RESTORES the primary. Decision paths that must distinguish a mirror-sourced blob use
 * {@link readLiveBlobWithSource} instead (F1). */
export function readLiveBlob(): CredentialBlob | null {
  return readLiveBlobWithSource()[0]
}

/** A present keychain refusing the LIVE write (locked, declined ACL, non-zero). The caller MUST fail
 * closed — a live-credential write that half-applied or fell to plaintext would be worse than none. */
export class LiveKeychainWriteError extends Error {}

/**
 * ⚠️ THE IRREVERSIBLE WRITE (R16). Overwrite the live credential with `blob`, cross-platform, then
 * mirror it into `-livebak` (Pillar 2). macOS → keychain (account=$USER, the `-T` live-family ACL set
 * ONLY on create; a data-only update carries no ACL flag → no prompt). Linux/Windows → the credentials
 * file (ATOMIC) + best-effort GNOME keyring; the file is written ONLY when `security` is absent, so
 * the macOS live-re-read (keyed off the file's ABSENCE) is preserved. Stores the FULL blob (incl.
 * mcpOAuth) verbatim — unlike a slot, the live credential keeps every section.
 *
 * FAIL CLOSED: a present-but-refusing macOS keychain throws {@link LiveKeychainWriteError} (matching
 * rotator.py's propagated CalledProcessError) — never a plaintext fallback on macOS.
 *
 * DO NOT call this against the real credential without the R16 USER checkpoint.
 */
export function writeLiveBlob(blob: CredentialBlob): void {
  const data = JSON.stringify(blob) // compact — matches Python separators=(",",":")
  const acct = keychainAccount()
  const res = securityWrite(KEYCHAIN_SERVICE, acct, data, { allowAny: false }) // `-T` live-family ACL
  if (res === KeychainWriteResult.WRITE_FAILED) {
    throw new LiveKeychainWriteError(
      'live keychain write failed — refusing to fall back / half-apply (unlock the keychain / ' +
        'approve the access prompt, then retry)',
    )
  }
  if (res === KeychainWriteResult.NO_KEYCHAIN) {
    // Not macOS → the credentials file IS the live store; write it atomically, then keyring.
    const cf = credentialsFilePath()
    fs.mkdirSync(path.dirname(cf), { recursive: true })
    const tmp = `${cf}.tmp.${process.pid}`
    fs.writeFileSync(tmp, data)
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, cf)
    if (secretToolActive()) {
      spawnSync('secret-tool', ['store', '--label=Claude Code-credentials', 'service', KEYCHAIN_SERVICE], {
        input: data,
        encoding: 'utf8',
        timeout: 5_000,
      })
    }
  }
  // res === OK (keychain) OR the credentials file was written → mirror into -livebak (Pillar 2).
  liveBackupWrite(blob)
}
