/**
 * Persistent store for the owner's SMTP app-password (TRDD-P7XKV3N9 sibling).
 *
 * The email recovery channel authenticates to the owner's own mail provider, so it
 * needs the provider password — and it must "remember it" so the owner types it ONCE
 * (the "ask the user to enter the password once" requirement).
 *
 * WHERE IT MUST NOT LIVE — the load-bearing constraint. This credential is REPLAYABLE
 * (we hand it to the SMTP server every send), so unlike the governance password it
 * cannot be hashed — it must be recoverable. And it CANNOT be encrypted inside
 * security-config.enc, because that blob is keyed to the governance password, and the
 * whole point of sending an email is to reset a governance password the owner has
 * FORGOTTEN (chicken-and-egg). So the store must be independent of the governance
 * password:
 *   - macOS (default): the login Keychain via `security` — encrypted at rest,
 *     protected by the OS login, independent of AI Maestro's governance secret.
 *   - elsewhere / CI / AIM_SMTP_CRED_BACKEND=file: a 0600 JSON file under ~/.aimaestro,
 *     owner-only — same trust model as setup-code.txt and the session store already
 *     there.
 *
 * The Keychain add briefly exposes the password in this process's argv (visible to a
 * `ps` by the SAME user for the milliseconds `security` runs). That is an accepted
 * residual: only the owner — who already knows the password — can observe it, and
 * `-A` is required so a headless server never hangs on a per-access ACL prompt.
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { testOnlyEnv } from './test-only-env'

const KEYCHAIN_SERVICE = 'ai-maestro-smtp'
const SECURITY_BIN = '/usr/bin/security'

// HOME-based (mirrors getStateDir) so a test can stub $HOME and get an isolated store.
function stateDir(): string {
  return join(process.env.HOME || homedir(), '.aimaestro')
}
function credFile(): string {
  return join(stateDir(), 'smtp-credential.json')
}

/**
 * True when the macOS Keychain backend should be used — on darwin with `security`
 * present — unless a TEST forces the file backend via AIM_SMTP_CRED_BACKEND=file
 * (so unit tests never pollute or prompt the developer's real login keychain).
 *
 * AIM_SMTP_CRED_BACKEND is honored ONLY inside the test runner (TRDD-CC9PY337). Outside
 * it, `=file` would move the SMTP password out of the OS keychain into a file — a silent
 * downgrade one stray `export` in a shell profile away, on a host where agents run under
 * the same UID as the server. It is not a setting anyone should reach from the environment;
 * it is a test seam, so it is gated to the only process that legitimately needs it.
 *
 * This does NOT affect non-macOS hosts: the darwin check below already selects the file
 * backend for them automatically. The env var only ever FORCED file on macOS, which is
 * exactly the case a test needs and a release must not have.
 *
 * NAMING: must NOT start with `use` + Capital — ESLint's react-hooks/rules-of-hooks
 * treats any `useX()` as a React Hook and errors when it is called outside a component
 * (which fails `next build`, not just lint). It was `useKeychain` and broke the build.
 */
function keychainAvailable(): boolean {
  if (testOnlyEnv('AIM_SMTP_CRED_BACKEND') === 'file') return false
  return process.platform === 'darwin' && existsSync(SECURITY_BIN)
}

function kcStore(account: string, password: string): void {
  // -U update-if-exists, -A allow any app to read without an ACL prompt (headless).
  execFileSync(
    SECURITY_BIN,
    ['add-generic-password', '-U', '-A', '-s', KEYCHAIN_SERVICE, '-a', account, '-w', password],
    { stdio: 'ignore' },
  )
}
function kcGet(account: string): string | null {
  try {
    const out = execFileSync(
      SECURITY_BIN,
      ['find-generic-password', '-w', '-s', KEYCHAIN_SERVICE, '-a', account],
      { encoding: 'utf8' },
    )
    return out.replace(/\n$/, '')
  } catch {
    return null // exit 44 = item not found; any other error = treat as "no credential"
  }
}
function kcDelete(account: string): void {
  try {
    execFileSync(SECURITY_BIN, ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account], { stdio: 'ignore' })
  } catch {
    // Absent already — nothing to delete.
  }
}

type CredFile = Record<string, string>
function fileRead(): CredFile {
  const f = credFile()
  if (!existsSync(f)) return {}
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as CredFile) : {}
  } catch {
    return {} // corrupt file behaves as empty; a re-store overwrites it cleanly
  }
}
function fileWriteAtomic(data: CredFile): void {
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const f = credFile()
  const tmp = `${f}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
  renameSync(tmp, f) // atomic replace
  chmodSync(f, 0o600) // belt-and-braces if the file pre-existed with looser perms
}

// The email is the account key; normalize so lookups match detectProvider's casing.
function acct(email: string): string {
  return email.toLowerCase().trim()
}

/** Persist (or update) the SMTP app-password for `email`. Throws if the store fails. */
export function storeSmtpPassword(email: string, password: string): void {
  const account = acct(email)
  if (keychainAvailable()) {
    kcStore(account, password)
    return
  }
  const data = fileRead()
  data[account] = password
  fileWriteAtomic(data)
}

/** The stored SMTP app-password for `email`, or null when none is stored. */
export function getSmtpPassword(email: string): string | null {
  const account = acct(email)
  if (keychainAvailable()) return kcGet(account)
  return fileRead()[account] ?? null
}

export function hasSmtpPassword(email: string): boolean {
  return getSmtpPassword(email) !== null
}

/** Remove the stored SMTP app-password for `email` (idempotent). */
export function deleteSmtpPassword(email: string): void {
  const account = acct(email)
  if (keychainAvailable()) {
    kcDelete(account)
    return
  }
  const data = fileRead()
  if (account in data) {
    delete data[account]
    fileWriteAtomic(data)
  }
}
