// The rotator's per-account SLOT store + state index (TRDD-1GGQ4HWY Phase D).
//
// FAITHFUL port of rotator.py's slot I/O: `fingerprint`, `read_slot`/`write_slot`,
// `load_state`/`save_state`, `file_slot`, the ROOT resolver, and the state.json schema. This
// is the REVERSIBLE half of the rotator — it files a captured account's token into a per-email
// keychain slot (+ a redundant mirror) and records its no-secret index entry in state.json. It
// NEVER touches the LIVE credential (`Claude Code-credentials`) — that one irreversible write is
// Phase E, R16-gated.
//
// Byte-compatibility with the janitor `#N` fallback is load-bearing (they share the same
// keychain items + state.json, presence/delegation, never concurrent): slot blobs are stored as
// RAW compact JSON (not base64 — see keychain.ts), state.json carries the exact same schema, and
// its integrity sidecars match (see integrity.ts). Diverging any of these would make a shared
// read see the slots/state as corrupt.

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { backupAndWrite, readOrRestore } from './integrity'
import { securityWrite, securityReadRaw, securityDelete, KeychainWriteResult } from './keychain'
import { detectBackend } from './safe-storage'
import { tryAcquireTickLockWait } from './tick-lock'

/** True iff the Linux Secret Service (`secret-tool`) is the active backend. The slot tiers gate
 * their `secret-tool` spawns on this so they are reached ONLY when it is genuinely the store —
 * on macOS `security` handles it, on a keyring-less host the plaintext fallback does. It also
 * makes a unit test forcing CLAUDE_SAFE_STORAGE_BACKEND=none 0-IMPACT: neither keychain nor
 * `secret-tool` is touched, so slot I/O deterministically uses the temp-dir plaintext path. */
function secretToolActive(): boolean {
  return detectBackend() === 'secret_tool'
}

// --------------------------------------------------------------------------
// Keychain services — FIXED constants (TRDD-CC9PY337). They were env-overridable
// (CLAUDE_ROTATOR_SLOT*_KEYCHAIN_SERVICE), but verification found NO test sets them (the tests
// force CLAUDE_SAFE_STORAGE_BACKEND=none, so slot I/O uses the temp-dir plaintext path and the
// service NAME is never exercised) and nothing in production sets them either. An env read that
// no test needs and no operator uses is pure attack surface — an inherited value would redirect
// OAuth slot tokens into an attacker-named keychain service — so the read is DELETED, not gated.
// Deleting also STRENGTHENS the byte-compat with the janitor `#N` daemon: TS now uses these exact
// strings unconditionally, so it can never diverge from the daemon's identical defaults. To
// relocate the slots one day, both sides change the constant (or it becomes a dashboard setting),
// never an inherited env var. Match rotator.py's module-level constants.
// --------------------------------------------------------------------------
export const SLOT_KEYCHAIN_SERVICE = 'Claude Code-rotator-slot'
export const SLOT_BACKUP_KEYCHAIN_SERVICE = 'Claude Code-rotator-slot-backup'

// The janitor plugin's OWN data dir, resolved by its FIXED install name (the stable per-plugin
// DATA path — survives version updates, purged only on uninstall).
const JANITOR_DATA_DIRNAME = 'ai-maestro-janitor-ai-maestro-plugins'

// --------------------------------------------------------------------------
// Types — the state.json schema (no secrets: emails, token fingerprints, timestamps).
// --------------------------------------------------------------------------
/** A credential blob as Claude Code stores it — `{ claudeAiOauth: {...}, mcpOAuth?: {...} }`. */
export type CredentialBlob = Record<string, unknown>

/** One state.json slot index entry (NO token — a fingerprint of it). */
export interface SlotIndexEntry {
  captured_at: string
  fp: string
  expires_at: number | null
  via: string
}

/** The rotator state index. Heterogeneous extras (a 429-streak int, a last_switch_at float) may
 * also appear, so the shape is open. */
export interface RotatorState {
  live_email: string | null
  live_fp: string | null
  slots: Record<string, SlotIndexEntry>
  [k: string]: unknown
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

// --------------------------------------------------------------------------
// ROOT resolution — the active rotator state dir. Faithful port of _rotator_root().
// --------------------------------------------------------------------------
/** The CANONICAL state dir `${CLAUDE_PLUGIN_DATA}/oauth-rotator`, but ONLY when CLAUDE_PLUGIN_DATA
 * actually points at THIS plugin's data dir — else derive from the fixed install name. A foreign
 * plugin (codex) exporting the reserved CLAUDE_PLUGIN_DATA must NEVER redirect the rotator to
 * `…/codex-openai-codex/oauth-rotator` and find zero accounts (TRDD-7100178d, the codex-clobber). */
export function canonicalRotatorRoot(): string {
  const raw = (process.env.CLAUDE_PLUGIN_DATA ?? '').trim()
  if (raw && raw.includes(JANITOR_DATA_DIRNAME)) return path.join(raw, 'oauth-rotator')
  return path.join(os.homedir(), '.claude', 'plugins', 'data', JANITOR_DATA_DIRNAME, 'oauth-rotator')
}

/** The pre-TRDD-7100178d standalone root — a read fallback + migration source. */
export function legacyRotatorRoot(): string {
  return path.join(os.homedir(), '.claude', 'account-rotator')
}

/** The ACTIVE state dir: prefer the canonical DATA-dir root; fall back to the legacy standalone
 * root ONLY when IT (and not the canonical one) holds state.json, so a not-yet-migrated install
 * never silently points at an empty dir and loses its slots. A fresh install writes canonical. */
export function rotatorRoot(): string {
  const canonical = canonicalRotatorRoot()
  if (isFile(path.join(canonical, 'state.json'))) return canonical
  const legacy = legacyRotatorRoot()
  if (isFile(path.join(legacy, 'state.json'))) return legacy
  return canonical
}

export function stateFilePath(): string {
  return path.join(rotatorRoot(), 'state.json')
}

/** Legacy plaintext slot path — the no-keychain fallback (Linux without a keyring) and the
 * migration source for pre-keychain `.json` files. */
export function slotFilePath(email: string): string {
  const safe = email.replace(/\//g, '_')
  return path.join(rotatorRoot(), 'slots', safe + '.json')
}

// --------------------------------------------------------------------------
// Blob helpers — fingerprint, oauth section, expiry. Faithful ports.
// --------------------------------------------------------------------------
/** The `claudeAiOauth` credential section of `blob`, or `{}` if absent / not an object. */
export function oauthOf(blob: unknown): Record<string, unknown> {
  if (blob && typeof blob === 'object') {
    const inner = (blob as Record<string, unknown>).claudeAiOauth
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>
  }
  return {}
}

/** sha256(accessToken)[:16], or '' when there is no accessToken. Identifies a token without
 * storing it (the state.json index carries the fingerprint, never the token). */
export function fingerprint(blob: unknown): string {
  const tok = oauthOf(blob).accessToken
  if (typeof tok !== 'string' || !tok) return ''
  return crypto.createHash('sha256').update(tok, 'utf8').digest('hex').slice(0, 16)
}

/** Hours until the blob's token expires, or null when `expiresAt` is absent / non-numeric.
 * `expiresAt` is ms-since-epoch when > 1e12, else seconds — matching rotator.py's heuristic. */
export function expiresInH(blob: unknown): number | null {
  const exp = oauthOf(blob).expiresAt
  if (typeof exp !== 'number') return null
  const secs = exp > 1e12 ? exp / 1000 : exp
  return (secs - Date.now() / 1000) / 3600
}

// --------------------------------------------------------------------------
// state.json — corruption-recovering load/save (via integrity.ts).
// --------------------------------------------------------------------------
function defaultState(): RotatorState {
  return { live_email: null, live_fp: null, slots: {} }
}

/** Read the state index with corruption recovery. A None (both copies unrecoverable) or a
 * non-object / JSON-garbage payload falls back to the empty default — never throws. */
export function loadState(): RotatorState {
  const raw = readOrRestore(stateFilePath())
  if (raw === null) return defaultState()
  let data: unknown
  try {
    data = JSON.parse(raw.toString('utf8'))
  } catch {
    return defaultState()
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultState()
  return data as RotatorState
}

/** Persist the state index with an in-advance backup + sha256 sidecar (integrity.backup_and_write
 * semantics), 0600. */
export function saveState(state: RotatorState): void {
  backupAndWrite(stateFilePath(), Buffer.from(JSON.stringify(state, null, 2), 'utf8'), 0o600)
}

// --------------------------------------------------------------------------
// Slot I/O — keychain (raw JSON, primary + mirror) → secret-tool → plaintext file.
// --------------------------------------------------------------------------
/** A keychain PRESENT but refusing a slot write. The caller MUST fail closed, NOT drop a
 * plaintext token — that would re-create exactly the plaintext slots the P4a migration removed. */
export class SlotKeychainWriteError extends Error {}

function compactJson(blob: CredentialBlob): string {
  return JSON.stringify(blob) // JSON.stringify has no spaces — matches Python separators=(",",":")
}

/**
 * Store one account's slot token in the OS keychain under `service`. Three-valued (KeychainWriteResult):
 * OK (a keychain accepted it), NO_KEYCHAIN (no keychain present — the plaintext fallback is legit),
 * WRITE_FAILED (macOS `security` present but the write failed — the caller MUST fail closed).
 * macOS `security` (ACL-aware, keychain.ts) first; on absence, Linux `secret-tool` (raw JSON on stdin).
 */
// Exported so the LIVE-credential `-livebak` mirror (live.ts, Phase E) reuses the exact same
// encrypted store + tier ladder — `account` is an email for slots, the macOS username for the
// live mirror. `allowAny = service ∈ slot-family` correctly yields `-A` for slots and `-T` for
// the live/live-backup families.
export function slotKeychainWrite(
  email: string,
  blob: CredentialBlob,
  service: string = SLOT_KEYCHAIN_SERVICE,
): KeychainWriteResult {
  const data = compactJson(blob)
  const allowAny = service === SLOT_KEYCHAIN_SERVICE || service === SLOT_BACKUP_KEYCHAIN_SERVICE
  const macos = securityWrite(service, email, data, { allowAny })
  if (macos === KeychainWriteResult.OK) return KeychainWriteResult.OK
  if (macos === KeychainWriteResult.WRITE_FAILED) return KeychainWriteResult.WRITE_FAILED // macOS present, failed
  // macos === NO_KEYCHAIN → `security` absent → try the Linux keyring (raw JSON on stdin).
  if (!secretToolActive()) return KeychainWriteResult.NO_KEYCHAIN // no keyring → plaintext fallback
  const r = spawnSync(
    'secret-tool',
    ['store', '--label', 'Claude Code rotator slot', 'service', service, 'account', email],
    { input: data, encoding: 'utf8', timeout: 5_000 },
  )
  if (r.error) return KeychainWriteResult.NO_KEYCHAIN // absent / hung → no keyring → plaintext OK
  return r.status === 0 ? KeychainWriteResult.OK : KeychainWriteResult.NO_KEYCHAIN
}

/** Read one account's slot token from the OS keychain under `service`, or null if absent /
 * unreadable. macOS `security -w` (raw JSON) → Linux `secret-tool lookup`. */
export function slotKeychainRead(
  email: string,
  service: string = SLOT_KEYCHAIN_SERVICE,
): CredentialBlob | null {
  const raw = securityReadRaw(service, email)
  if (raw !== null) {
    const t = raw.trim()
    if (t) {
      try {
        return JSON.parse(t) as CredentialBlob
      } catch {
        // fall through to secret-tool
      }
    }
  }
  if (!secretToolActive()) return null // no keyring → caller falls to the plaintext file
  const r = spawnSync('secret-tool', ['lookup', 'service', service, 'account', email], {
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
  return null
}

/** Best-effort remove of one account's slot token from the keychain `service` (both stores). */
function slotKeychainDelete(email: string, service: string = SLOT_KEYCHAIN_SERVICE): void {
  securityDelete(service, email)
  if (!secretToolActive()) return
  spawnSync('secret-tool', ['clear', 'service', service, 'account', email], {
    encoding: 'utf8',
    timeout: 5_000,
  })
}

/**
 * Persist an account's slot token ENCRYPTED in the OS keychain — to BOTH the primary and the
 * redundant backup service (Pillar 2), so a deleted/corrupt primary is recoverable from the mirror.
 * Only when no keychain is present (Linux without one) does it fall back to a 0600 plaintext file.
 *
 * FAIL CLOSED: if the keychain IS present but the primary write FAILS (locked keychain, declined
 * ACL, `security` non-zero), throw {@link SlotKeychainWriteError} instead of dropping a plaintext
 * token. Stores ONLY the `claudeAiOauth` section (strips the ~8KB mcpOAuth bloat) — every rotator
 * helper reaches the credential via oauthOf(), so a `{ claudeAiOauth: {...} }` slot is compatible.
 */
export function writeSlot(email: string, blob: CredentialBlob): void {
  const inner = oauthOf(blob)
  if (Object.keys(inner).length) blob = { claudeAiOauth: inner } // strip mcpOAuth + other top-level keys
  const primary = slotKeychainWrite(email, blob)
  if (primary === KeychainWriteResult.WRITE_FAILED) {
    throw new SlotKeychainWriteError(
      `keychain write failed for slot ${email} — refusing to drop a plaintext token ` +
        '(unlock the keychain / approve the access prompt, then retry)',
    )
  }
  if (primary === KeychainWriteResult.OK) {
    slotKeychainWrite(email, blob, SLOT_BACKUP_KEYCHAIN_SERVICE) // mirror (best-effort)
    return
  }
  // NO_KEYCHAIN → 0600 plaintext file (Linux desktop without a keyring), atomic.
  const p = slotFilePath(email)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp.${process.pid}`
  fs.writeFileSync(tmp, compactJson(blob))
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, p)
}

/**
 * Read an account's slot token: primary keychain → backup keychain (Pillar 2 mirror, so a
 * deleted/corrupt primary self-heals) → any LEGACY plaintext file (pre-migration slots stay
 * readable). Returns null when the account has no slot anywhere.
 */
export function readSlot(email: string): CredentialBlob | null {
  const primary = slotKeychainRead(email)
  if (primary !== null) return primary
  const mirror = slotKeychainRead(email, SLOT_BACKUP_KEYCHAIN_SERVICE)
  if (mirror !== null) {
    slotKeychainWrite(email, mirror) // primary missing/corrupt but the mirror survived — re-heal
    return mirror
  }
  const p = slotFilePath(email)
  if (!isFile(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as CredentialBlob
  } catch {
    return null
  }
}

/** Forget a retired account's slot (both keychain services + any plaintext file). Best-effort. */
export function deleteSlot(email: string): void {
  slotKeychainDelete(email)
  slotKeychainDelete(email, SLOT_BACKUP_KEYCHAIN_SERVICE)
  try {
    fs.rmSync(slotFilePath(email))
  } catch {
    // no plaintext file → nothing to remove
  }
}

/** Local time with a `±HHMM` offset — Python `time.strftime("%Y-%m-%dT%H:%M:%S%z")`. */
function nowLocalTz(): string {
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const offMin = -d.getTimezoneOffset() // getTimezoneOffset is inverted (UTC−local)
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  const tz = `${sign}${p2(Math.floor(abs / 60))}${p2(abs % 60)}`
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
    `T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${tz}`
  )
}

/**
 * Persist a CAPTURED account — the token into the keychain (via {@link writeSlot}) AND its
 * no-secret index entry into state.json — as ONE step, under the server rotation-tick lock. The
 * lock serialises this against a concurrent rotation tick so the tick's read-modify-write of
 * state.json can never orphan a freshly captured account (its token in the keychain but no slot
 * indexing it) nor split live_email from the actual live credential.
 *
 * Returns false iff the lock could not be taken within `timeoutMs` — and NOTHING is written on
 * that path (the writes happen inside the lock), so a lost race can never half-file an account.
 */
export async function fileSlot(
  email: string,
  blob: CredentialBlob,
  opts: { via: string; expiresAt: number | null; timeoutMs?: number },
): Promise<boolean> {
  const lock = await tryAcquireTickLockWait(opts.timeoutMs ?? 60_000)
  if (!lock) return false
  try {
    writeSlot(email, blob)
    const st = loadState()
    if (!st.slots || typeof st.slots !== 'object') st.slots = {}
    st.slots[email] = {
      captured_at: nowLocalTz(),
      fp: fingerprint(blob),
      expires_at: opts.expiresAt,
      via: opts.via,
    }
    saveState(st)
  } finally {
    lock.release()
  }
  return true
}
