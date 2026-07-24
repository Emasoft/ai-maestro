// Cookie-jar mechanics for the rotator — a faithful port of the janitor daemon's
// `oauth_rotator/cookie_vault.py` (TRDD-7DRSIKVZ). EXTRACT a Chrome profile's claude.ai
// cookies into a portable JSON jar, and INJECT a jar back into a profile's Cookies sqlite.
// These are the sqlite⇄jar⇄json primitives the keychain cookie storage is built on.
//
// Design — we NEVER decrypt a cookie value ourselves. Chrome stores each cookie's bytes in
// the `encrypted_value` BLOB, encrypted with the per-USER OSCrypt key (the "Chrome Safe
// Storage" keychain entry on macOS, the login keyring on Linux, DPAPI on Windows). That key
// is stable across every Chrome profile of the same OS user, so a row's `encrypted_value`
// copied verbatim into ANOTHER of this user's profiles still decrypts. So the jar carries
// Chrome's already-encrypted blobs (base64'd for JSON transport) and re-injection is a
// faithful row copy — the plaintext cookie never passes through us, and when the jar is
// stored via safe-storage it is encrypted AGAIN at rest (defense in depth). Cross-user /
// cross-machine transport is therefore intentionally NOT supported (the OSCrypt key differs).
//
// Read paths open the sqlite readonly; the inject path writes a fresh/served profile DB.

import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, statSync, mkdirSync } from 'fs'
import os from 'os'
import path from 'path'

import { store, retrieve, deleteSecret, StoreResult } from './safe-storage'

// Keychain service the per-account claude.ai cookie jar is stored under (overridable for
// tests). The jar (Chrome's already-encrypted blobs, JSON, base64) is encrypted AGAIN at rest
// by safe-storage's backend.
export const COOKIE_KEYCHAIN_SERVICE =
  process.env.CLAUDE_ROTATOR_COOKIE_KEYCHAIN_SERVICE || 'Claude Code-rotator-cookies'

// The full Chrome `cookies` table column set (schema verified against Chrome 13x on macOS,
// 2026-06). ALL are NOT NULL, so a faithful round-trip must carry every one — a partial
// INSERT would violate the NOT NULL constraints and Chrome would reject the DB. Ordered
// exactly as the table declares them.
export const COOKIE_COLUMNS = [
  'creation_utc', 'host_key', 'top_frame_site_key', 'name', 'value', 'encrypted_value',
  'path', 'expires_utc', 'is_secure', 'is_httponly', 'last_access_utc', 'has_expires',
  'is_persistent', 'priority', 'samesite', 'source_scheme', 'source_port',
  'last_update_utc', 'source_type', 'has_cross_site_ancestor',
] as const

// The column that holds Chrome's OSCrypt-encrypted bytes (a BLOB → base64 in JSON).
const BLOB_COLUMN = 'encrypted_value'

// The INTEGER columns. Chrome's *_utc timestamps are 17-digit microsecond values that EXCEED
// Number.MAX_SAFE_INTEGER (2^53), so they MUST be carried as BigInt or the round-trip silently
// corrupts them — a lossy Number would change the value, break the cookies_unique_index, and
// fail the restore rehearsal. extractJar reads these via better-sqlite3 safeIntegers(true) →
// BigInt; the JSON form carries them as decimal strings; jarFromJson parses them back to BigInt.
// (The small booleans/enums are BigInt too, uniformly — exact and harmless.)
const INTEGER_COLUMNS: ReadonlySet<string> = new Set([
  'creation_utc', 'expires_utc', 'is_secure', 'is_httponly', 'last_access_utc', 'has_expires',
  'is_persistent', 'priority', 'samesite', 'source_scheme', 'source_port', 'last_update_utc',
  'source_type', 'has_cross_site_ancestor',
])

export const JAR_VERSION = 1

/** One full-column cookie record. `encrypted_value` is a Buffer (the BLOB); INTEGER columns are
 *  BigInt (exact 64-bit — Chrome's *_utc exceed 2^53); TEXT columns are strings. (A hand-built
 *  jar may also use plain `number` for small ints; extractJar/jarFromJson always yield BigInt.) */
export type CookieRow = Record<string, number | string | Buffer | bigint>

/** A portable snapshot of one account's claude.ai cookies. `rows` is the list of full-column
 *  records; `encrypted_value` is held as a raw Buffer in-memory and base64-encoded only at
 *  JSON serialization. `hostFilter` records the SQL LIKE pattern the jar was extracted with
 *  so a reader knows its scope. */
export interface CookieJar {
  readonly rows: readonly CookieRow[]
  readonly hostFilter: string
}

/** The cookie names in the jar (for logging / assertions — never the values). */
export function jarNames(jar: CookieJar): string[] {
  return jar.rows.map((r) => String(r.name))
}

/** Read every cookie whose `host_key` matches `hostFilter` from a Chrome Cookies sqlite
 *  (opened read-only) into a CookieJar. Throws if the DB is absent (fail-fast — the caller
 *  decides whether an absent profile is expected). */
export function extractJar(cookiesDb: string, hostFilter = '%claude.ai'): CookieJar {
  if (!existsSync(cookiesDb) || !statSync(cookiesDb).isFile()) {
    throw new Error(`Chrome Cookies DB not found: ${cookiesDb}`)
  }
  const cols = COOKIE_COLUMNS.join(', ')
  const con = new Database(cookiesDb, { readonly: true, fileMustExist: true })
  try {
    const records = con
      .prepare(`SELECT ${cols} FROM cookies WHERE host_key LIKE ? ORDER BY name, path`)
      .safeIntegers(true) // INTEGER → BigInt so the 17-digit *_utc values survive exactly
      .all(hostFilter) as Record<string, unknown>[]
    const rows: CookieRow[] = records.map((record) => {
      const row: CookieRow = {} as CookieRow
      for (const c of COOKIE_COLUMNS) row[c] = record[c] as number | string | Buffer | bigint
      // encrypted_value comes back as a Buffer (BLOB) or null — normalise to a Buffer.
      const ev = row[BLOB_COLUMN]
      row[BLOB_COLUMN] = Buffer.isBuffer(ev) ? ev : Buffer.alloc(0)
      return row
    })
    return { rows, hostFilter }
  } finally {
    con.close()
  }
}

/** Serialise a CookieJar to a compact JSON string (the form stored in safe-storage). The
 *  `encrypted_value` BLOB is base64-encoded; everything else is JSON-native. */
export function jarToJson(jar: CookieJar): string {
  const outRows = jar.rows.map((row) => {
    const r: Record<string, number | string> = {}
    for (const c of COOKIE_COLUMNS) {
      if (c === BLOB_COLUMN) continue
      const v = row[c]
      // INTEGER columns are BigInt (exact 64-bit) → serialize as a decimal string so JSON never
      // rounds them (JSON.stringify cannot serialize BigInt anyway); TEXT columns stay strings.
      r[c] = typeof v === 'bigint' ? v.toString() : (v as number | string)
    }
    r[BLOB_COLUMN] = (row[BLOB_COLUMN] as Buffer).toString('base64')
    return r
  })
  return JSON.stringify({ version: JAR_VERSION, host_filter: jar.hostFilter, rows: outRows })
}

/** Parse a jar previously produced by `jarToJson`. Throws on a version mismatch or a
 *  malformed payload (fail-fast — a corrupt jar must not silently yield an empty one that
 *  would look like 'no cookies'). */
export function jarFromJson(payload: string): CookieJar {
  let data: unknown
  try {
    data = JSON.parse(payload)
  } catch (exc) {
    throw new Error(`cookie jar is not valid JSON: ${(exc as Error).message}`)
  }
  const obj = data as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object' || obj.version !== JAR_VERSION) {
    const v = obj && typeof obj === 'object' ? obj.version : 'n/a'
    throw new Error(`unsupported cookie-jar version: ${v}`)
  }
  const rawRows = Array.isArray(obj.rows) ? (obj.rows as Record<string, unknown>[]) : []
  const rows: CookieRow[] = rawRows.map((r) => {
    const missing = COOKIE_COLUMNS.filter((c) => !(c in r))
    if (missing.length) throw new Error(`cookie jar row missing columns: ${missing.join(', ')}`)
    const row: CookieRow = {} as CookieRow
    for (const c of COOKIE_COLUMNS) {
      if (c === BLOB_COLUMN) row[c] = Buffer.from(String(r[c]), 'base64')
      else if (INTEGER_COLUMNS.has(c)) row[c] = BigInt(String(r[c])) // exact — never Number()
      else row[c] = String(r[c])
    }
    return row
  })
  return { rows, hostFilter: typeof obj.host_filter === 'string' ? obj.host_filter : '%claude.ai' }
}

/** Create the Chrome `cookies` table + its unique index if absent, so a jar can be injected
 *  into a fresh/empty profile DB. The DDL matches Chrome's schema verbatim. */
function ensureCookiesTable(con: Database.Database): void {
  con.exec(
    'CREATE TABLE IF NOT EXISTS cookies(' +
      'creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,' +
      'name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,' +
      'expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,' +
      'last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,' +
      'priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,' +
      'source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,' +
      'has_cross_site_ancestor INTEGER NOT NULL)',
  )
  con.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS cookies_unique_index ON cookies(' +
      'host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port)',
  )
}

/** Write every row of `jar` into the Cookies sqlite at `cookiesDb` (created with the Chrome
 *  schema if absent), REPLACING any existing row with the same unique key. Returns the number
 *  of rows written. Chrome must NOT be running on this profile during the write (it holds a
 *  sqlite lock); the caller serialises that.
 *
 *  Uses INSERT OR REPLACE keyed on the table's unique index so re-injecting an updated jar is
 *  idempotent and never duplicates a cookie. */
export function injectJar(cookiesDb: string, jar: CookieJar): number {
  mkdirSync(path.dirname(cookiesDb), { recursive: true })
  const placeholders = COOKIE_COLUMNS.map(() => '?').join(', ')
  const cols = COOKIE_COLUMNS.join(', ')
  const con = new Database(cookiesDb)
  try {
    ensureCookiesTable(con)
    const stmt = con.prepare(`INSERT OR REPLACE INTO cookies (${cols}) VALUES (${placeholders})`)
    const writeAll = con.transaction((rows: readonly CookieRow[]) => {
      let written = 0
      for (const row of rows) {
        stmt.run(...COOKIE_COLUMNS.map((c) => row[c]))
        written += 1
      }
      return written
    })
    return writeAll(jar.rows)
  } finally {
    con.close()
  }
}

// ---------------------------------------------------------------------------
// Keychain orchestration — store a profile's cookies in the OS safe-storage and materialize
// them back. These tie cookie-vault (sqlite⇄jar) to safe-storage (encrypted at rest).
// ---------------------------------------------------------------------------

/** Extract `email`'s claude.ai cookies from its Chrome profile and store the jar ENCRYPTED in
 *  the OS safe-storage under (COOKIE_KEYCHAIN_SERVICE, email). Returns the safe-storage
 *  three-valued result so the caller fails closed: a FAILED (present-but-locked keychain)
 *  must NOT be treated as "snapshotted". An absent profile DB throws. */
export function snapshotToKeychain(email: string, cookiesDb: string, hostFilter = '%claude.ai'): StoreResult {
  const jar = extractJar(cookiesDb, hostFilter)
  return store(COOKIE_KEYCHAIN_SERVICE, email, jarToJson(jar))
}

/** Load `email`'s stored cookie jar from safe-storage and INJECT it into the Chrome profile
 *  Cookies DB at `cookiesDb` (created if absent). Returns the number of rows written, or null
 *  if no jar is stored for `email`. This is the profile SWITCH: before a capture for `email`
 *  the daemon materializes that account's keychain-stored cookies into its profile so the
 *  seeded session is present without a plaintext jar ever living on disk between runs. */
export function materializeFromKeychain(email: string, cookiesDb: string): number | null {
  const payload = retrieve(COOKIE_KEYCHAIN_SERVICE, email)
  if (payload === null) return null
  const jar = jarFromJson(payload) // throws on a corrupt jar — fail fast
  return injectJar(cookiesDb, jar)
}

/** Best-effort removal of `email`'s stored cookie jar from safe-storage (retiring an account
 *  / scrubbing). Never throws. */
export function forgetInKeychain(email: string): void {
  deleteSecret(COOKIE_KEYCHAIN_SERVICE, email)
}

// ---------------------------------------------------------------------------
// The on-disk SCRUB — the one DESTRUCTIVE operation in the vault. It destroys the ONLY
// credential that can mint a new session without a human: if the keychain copy is silently
// incomplete, scrubbing the profile's cookies BRICKS that account's capture (a fresh human
// login is the only recovery). So it is gated twice:
//   1. Its OWN opt-in, separate from the parent flag. Default OFF.
//   2. A verify-before-destroy PROOF that fails CLOSED — a full RESTORE REHEARSAL (retrieve →
//      parse → inject into a throwaway DB → re-extract → compare to disk), which exercises the
//      exact path a future materializeFromKeychain will take, so a bug anywhere in
//      retrieve/parse/inject is caught BEFORE the original is gone.
// It also scrubs ONLY the rows matching hostFilter — the exact rows the jar holds.
// ---------------------------------------------------------------------------
const SCRUB_ENV = 'CLAUDE_ROTATOR_KEYCHAIN_COOKIES_SCRUB'

/** The scrub's OWN opt-in. DEFAULT OFF (destruction is never implicit). */
export function scrubEnabled(): boolean {
  return ['1', 'true', 'on', 'yes'].includes((process.env[SCRUB_ENV] || '').trim().toLowerCase())
}

/** Deep value-equality of two jars: same length, same rows in order, every column equal
 *  (Buffer blobs compared byte-for-byte). extractJar orders by (name, path), so the order is
 *  deterministic and a positional compare is exact. */
function jarsEqual(a: CookieJar, b: CookieJar): boolean {
  if (a.rows.length !== b.rows.length) return false
  for (let i = 0; i < a.rows.length; i++) {
    const ra = a.rows[i]
    const rb = b.rows[i]
    for (const c of COOKIE_COLUMNS) {
      const va = ra[c]
      const vb = rb[c]
      if (Buffer.isBuffer(va) || Buffer.isBuffer(vb)) {
        if (!Buffer.isBuffer(va) || !Buffer.isBuffer(vb) || !va.equals(vb)) return false
      } else if (va !== vb) {
        return false
      }
    }
  }
  return true
}

/** Prove the keychain jar can RESTORE this profile's cookies exactly. Returns [ok, why].
 *
 *  The rehearsal runs the real restore path (retrieve → jarFromJson → injectJar → extractJar)
 *  against a throwaway DB and compares the result to the live on-disk cookies. Only an exact
 *  match returns true — so a truncated jar, a locked keychain, a corrupt payload, or an inject
 *  that silently drops a row all yield false, and the caller must NOT destroy anything.
 *
 *  An empty on-disk cookie set also returns false: there is nothing to prove and nothing worth
 *  destroying, and treating "0 == 0" as proof would let a profile whose cookies already
 *  vanished mark itself safely scrubbed. */
export function verifyRestorable(email: string, cookiesDb: string, hostFilter = '%claude.ai'): [boolean, string] {
  const disk = extractJar(cookiesDb, hostFilter) // throws on absent DB → caller
  if (disk.rows.length === 0) return [false, 'no matching cookies on disk — nothing to verify or scrub']

  const payload = retrieve(COOKIE_KEYCHAIN_SERVICE, email)
  if (payload === null) return [false, 'no cookie jar stored in the keychain for this account']
  let stored: CookieJar
  try {
    stored = jarFromJson(payload)
  } catch (exc) {
    return [false, `stored cookie jar is unreadable: ${(exc as Error).message}`]
  }

  const td = mkdtempSync(path.join(os.tmpdir(), 'cookie-vault-'))
  let restored: CookieJar
  try {
    const probe = path.join(td, 'Cookies')
    injectJar(probe, stored)
    restored = extractJar(probe, hostFilter)
  } catch (exc) {
    return [false, `restore rehearsal failed: ${(exc as Error).message}`]
  } finally {
    rmSync(td, { recursive: true, force: true })
  }

  if (!jarsEqual(restored, disk)) {
    return [
      false,
      `restore rehearsal did not reproduce the on-disk cookies ` +
        `(${restored.rows.length} restored vs ${disk.rows.length} on disk)`,
    ]
  }
  return [true, `${disk.rows.length} cookie(s) proven restorable from the keychain`]
}

/** Delete exactly the rows a jar with this `hostFilter` would carry. Returns the number
 *  removed. Chrome must not be running on the profile (it holds a sqlite lock). */
function deleteMatchingRows(cookiesDb: string, hostFilter: string): number {
  const con = new Database(cookiesDb)
  try {
    const info = con.prepare('DELETE FROM cookies WHERE host_key LIKE ?').run(hostFilter)
    return info.changes >= 0 ? info.changes : 0
  } finally {
    con.close()
  }
}

/** Remove this profile's on-disk claude.ai cookies — but ONLY after proving the keychain copy
 *  can restore them. Returns a one-line verdict; NEVER throws.
 *
 *  Verdicts: `skipped: …` (opt-in off), `refused: …` (the proof failed — nothing was touched),
 *  or `scrubbed: …`. "Refused" is the safe outcome and is expected whenever anything is off;
 *  the on-disk cookies are already Chrome-OSCrypt encrypted, so keeping them costs little,
 *  while destroying an unrestorable session costs a human login. */
export function scrubProfileCookies(email: string, cookiesDb: string, hostFilter = '%claude.ai'): string {
  if (!scrubEnabled()) return `skipped: scrub is opt-in and ${SCRUB_ENV} is not set`
  let ok: boolean
  let why: string
  try {
    ;[ok, why] = verifyRestorable(email, cookiesDb, hostFilter)
  } catch (exc) {
    return `refused: verification could not run (${(exc as Error).message})`
  }
  if (!ok) return `refused: ${why}`
  let removed: number
  try {
    removed = deleteMatchingRows(cookiesDb, hostFilter)
  } catch (exc) {
    return `refused: delete failed after a good verify (${(exc as Error).message})`
  }
  return `scrubbed: ${removed} on-disk cookie row(s) removed — ${why}`
}
