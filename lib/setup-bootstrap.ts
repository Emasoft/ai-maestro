/**
 * First-run setup bootstrap (SEC-PHASE-6, BYPASS-2 closure).
 *
 * The previous behavior allowed open access whenever the governance
 * password was unset (lib/agent-auth.ts line 50-57). That backdoor is
 * gone. The replacement is a one-shot OS-notification verification flow:
 *
 *   1. Browser hits POST /api/auth/setup-init when no password is set.
 *      The server generates a 6-digit code, hashes it in memory with a
 *      300-second TTL, and dispatches a macOS notification (osascript)
 *      containing the code so it appears in the user's notification
 *      center.
 *
 *   2. The user reads the code from the notification and types it into
 *      the setup form along with their chosen username and password.
 *      Browser calls POST /api/auth/setup-verify with
 *      { code, password, userName, userAvatar? }.
 *
 *   3. The server validates the code, then writes the hashed password,
 *      username, and avatar to ~/.aimaestro/governance.json. Subsequent
 *      logins use POST /api/auth/login as normal.
 *
 * The verification code is stored ONLY in memory (attached to globalThis
 * so it survives Next.js HMR in dev mode but NOT process restart). On
 * restart the user must request a new code — that's by design so any
 * code captured by an attacker becomes useless after a server bounce.
 *
 * Delivery: the code is ALWAYS written to a 0600 file under
 * ~/.aimaestro/setup-code.txt (the one channel that works from any
 * context), and a desktop notification is attempted as a best-effort
 * convenience on top. A daemonized server (pm2/launchd/systemd) runs
 * outside a GUI session, where `osascript display notification` and
 * `notify-send` return SUCCESS but the banner never reaches the user —
 * so a notification-only delivery silently stranded the code and made
 * rotation impossible on such hosts. The file is the reliable channel;
 * the user MUST be on the machine (or its shell) to read it, which is
 * exactly the "you are at the console" property this flow requires. The
 * file is unlinked the moment the code is consumed.
 */

import { randomInt, createHash, timingSafeEqual } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, chmod, unlink } from 'fs/promises'
import { homedir } from 'os'
import path from 'path'
import { isMailerConfigured, sendCodeEmail } from './mailer'

const SETUP_CODE_TTL_MS = 300_000 // 5 minutes
const SETUP_CODE_LENGTH = 6

/** The one reliable delivery channel: a 0600 file the user reads on the host. */
const SETUP_CODE_FILE = path.join(homedir(), '.aimaestro', 'setup-code.txt')

interface SetupRecord {
  /** SHA-256 hash of the verification code */
  codeHash: string
  /** Unix ms when the code expires */
  expiresAt: number
  /** Number of failed verification attempts (rate limit) */
  attempts: number
}

interface SetupGlobals {
  __aiMaestroSetupCode?: SetupRecord | null
}

const g = globalThis as unknown as SetupGlobals

const execFileAsync = promisify(execFile)

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function generateCode(): string {
  let code = ''
  for (let i = 0; i < SETUP_CODE_LENGTH; i++) {
    code += randomInt(0, 10).toString()
  }
  return code
}

/**
 * Send the verification code via the most appropriate channel. Returns a short message
 * describing where the user should look for the code.
 *
 * Channels, in order: (1) the 0600 host file — ALWAYS written, the reliable console
 * channel; (2) EMAIL — when a configured recipient is supplied, delivered to the owner's
 * registered address so a REMOTE device (iPad/iPhone) that isn't at the host can receive
 * it; (3) a best-effort desktop notification. Email is the only remote-capable channel;
 * a send failure degrades to the file/notification below rather than stranding the code.
 */
async function dispatchCode(code: string, opts?: { email?: string; purpose?: string }): Promise<{ channel: string; hint: string }> {
  // The 0600 file is written UNCONDITIONALLY and is the reliable console channel.
  // A daemonized server (pm2/launchd/systemd) runs outside a GUI session,
  // where `osascript display notification` returns exit 0 but the banner
  // never reaches NotificationCenter — so the old notification-first path
  // (which wrote the file only when osascript *threw*) left the code
  // undeliverable and made rotation impossible on such hosts.
  await mkdir(path.dirname(SETUP_CODE_FILE), { recursive: true })
  await writeFile(SETUP_CODE_FILE, `${code}\n`, { encoding: 'utf-8' })
  try { await chmod(SETUP_CODE_FILE, 0o600) } catch { /* best-effort */ }

  // Remote channel: deliver to the owner's registered email when the mailer is
  // configured for it, so a device NOT at the host can receive the code. The file above
  // is still written (harmless — only the owner at the console can read it, and it's the
  // console fallback). A send failure falls through to the notification/file channel.
  if (opts?.email && isMailerConfigured(opts.email)) {
    const sent = await sendCodeEmail(opts.email, code, opts.purpose ?? 'verification')
    if (sent.ok) {
      return { channel: 'email', hint: `A code was sent to ${opts.email}. It expires in 5 minutes.` }
    }
  }

  // Best-effort desktop notification ON TOP of the file — a convenience
  // when a GUI session is present, never the sole channel.
  let notified = false
  if (process.platform === 'darwin') {
    try {
      // LIB2-MAJ-07: Defensive AppleScript escape. The code field is currently
      // generated from randomInt(0, 10) (digits only, see generateCode() above)
      // so injection is impossible TODAY. But future maintainers MUST keep the
      // code digits-only — if anyone ever changes it to base32, base64, or any
      // alphanumeric form, the .replace() below is the last line of defence
      // against AppleScript code injection.
      //
      // STRICT INVARIANT: if you are extending this code field beyond digits,
      // also rewrite this dispatch path to use environment variables
      // (osascript -e 'system attribute "AIM_CODE"') instead of inline
      // template-literal interpolation — the .replace() below is a band-aid,
      // not a real defence.
      const safeCode = code.replace(/["\\]/g, '')
      await execFileAsync('osascript', [
        '-e',
        `display notification "AI Maestro setup code: ${safeCode}" with title "AI Maestro" sound name "Submarine"`,
      ], { timeout: 5000 })
      notified = true
    } catch { /* GUI session unavailable — the file still holds the code */ }
  } else if (process.platform === 'linux') {
    try {
      await execFileAsync('notify-send', [
        '--app-name=AI Maestro',
        '--urgency=critical',
        'AI Maestro setup',
        `Setup code: ${code}`,
      ], { timeout: 5000 })
      notified = true
    } catch { /* desktop notifications unavailable — the file still holds the code */ }
  }

  return {
    channel: notified ? 'notification + file' : 'file',
    hint: `Read the code on the host machine at ${SETUP_CODE_FILE}` +
      (notified ? ' (a desktop notification was also sent).' : '.'),
  }
}

/**
 * Generate + dispatch a fresh setup code. Discards any previous pending
 * code. Returns the channel + hint so the API can echo them back to the
 * client.
 */
export async function startSetupFlow(opts?: { email?: string; purpose?: string }): Promise<{ channel: string; hint: string; expiresAt: number }> {
  const code = generateCode()
  const codeHash = hashCode(code)
  const expiresAt = Date.now() + SETUP_CODE_TTL_MS
  g.__aiMaestroSetupCode = { codeHash, expiresAt, attempts: 0 }
  const { channel, hint } = await dispatchCode(code, opts)
  return { channel, hint, expiresAt }
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'mismatch' | 'rate_limited' }

/**
 * Validate a user-provided code against the in-memory record. Consumes
 * the record on success (one-shot) so it cannot be replayed. Tracks
 * attempts and rate-limits after 5 failures.
 */
export function verifySetupCode(code: string): VerifyResult {
  const rec = g.__aiMaestroSetupCode
  if (!rec) return { ok: false, reason: 'no_code' }
  if (rec.expiresAt <= Date.now()) {
    g.__aiMaestroSetupCode = null
    return { ok: false, reason: 'expired' }
  }
  if (rec.attempts >= 5) {
    g.__aiMaestroSetupCode = null
    return { ok: false, reason: 'rate_limited' }
  }

  const provided = hashCode(code)
  const a = Buffer.from(provided)
  const b = Buffer.from(rec.codeHash)
  const same = a.length === b.length && timingSafeEqual(a, b)
  if (!same) {
    rec.attempts += 1
    return { ok: false, reason: 'mismatch' }
  }

  // Consume on success — clear the in-memory record and best-effort remove
  // the on-disk copy so a valid code never lingers on disk past its use.
  g.__aiMaestroSetupCode = null
  void unlink(SETUP_CODE_FILE).catch(() => {})
  return { ok: true }
}

/** Diagnostic: is there a pending setup code right now? */
export function isSetupCodePending(): boolean {
  const rec = g.__aiMaestroSetupCode
  if (!rec) return false
  return rec.expiresAt > Date.now()
}
