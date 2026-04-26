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
 * On non-Darwin platforms, osascript is unavailable. We fall back to
 * writing the code to a fixed file under ~/.aimaestro/setup-code.txt
 * with restrictive permissions and log the path to the server output.
 * This is a deliberate degraded fallback — the user MUST be on the
 * machine to read it.
 */

import { randomInt, createHash, timingSafeEqual } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, chmod } from 'fs/promises'
import { homedir } from 'os'
import path from 'path'

const SETUP_CODE_TTL_MS = 300_000 // 5 minutes
const SETUP_CODE_LENGTH = 6

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
 * Send the verification code via the most appropriate channel for the
 * current OS. Returns a short message describing where the user should
 * look for the code.
 */
async function dispatchCode(code: string): Promise<{ channel: string; hint: string }> {
  // macOS — osascript display notification
  if (process.platform === 'darwin') {
    try {
      await execFileAsync('osascript', [
        '-e',
        `display notification "AI Maestro setup code: ${code}" with title "AI Maestro" sound name "Submarine"`,
      ], { timeout: 5000 })
      return {
        channel: 'macOS notification',
        hint: 'Check your macOS notification center (top-right corner).',
      }
    } catch {
      // Fall through to file fallback
    }
  }

  // Linux — try notify-send
  if (process.platform === 'linux') {
    try {
      await execFileAsync('notify-send', [
        '--app-name=AI Maestro',
        '--urgency=critical',
        'AI Maestro setup',
        `Setup code: ${code}`,
      ], { timeout: 5000 })
      return {
        channel: 'libnotify',
        hint: 'Check your desktop notifications.',
      }
    } catch {
      // Fall through to file fallback
    }
  }

  // Fallback: write to a file under ~/.aimaestro/setup-code.txt with 0600 perms
  const fallbackDir = path.join(homedir(), '.aimaestro')
  const fallbackPath = path.join(fallbackDir, 'setup-code.txt')
  await mkdir(fallbackDir, { recursive: true })
  await writeFile(fallbackPath, `${code}\n`, { encoding: 'utf-8' })
  try { await chmod(fallbackPath, 0o600) } catch { /* best-effort */ }
  // Also log to stderr — visible in pm2 logs
  console.warn(`[setup-bootstrap] OS notification unavailable; setup code written to ${fallbackPath}`)
  return {
    channel: 'file',
    hint: `Setup code written to ${fallbackPath}. Open this file on the host machine to read the code.`,
  }
}

/**
 * Generate + dispatch a fresh setup code. Discards any previous pending
 * code. Returns the channel + hint so the API can echo them back to the
 * client.
 */
export async function startSetupFlow(): Promise<{ channel: string; hint: string; expiresAt: number }> {
  const code = generateCode()
  const codeHash = hashCode(code)
  const expiresAt = Date.now() + SETUP_CODE_TTL_MS
  g.__aiMaestroSetupCode = { codeHash, expiresAt, attempts: 0 }
  const { channel, hint } = await dispatchCode(code)
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

  // Consume on success
  g.__aiMaestroSetupCode = null
  return { ok: true }
}

/** Diagnostic: is there a pending setup code right now? */
export function isSetupCodePending(): boolean {
  const rec = g.__aiMaestroSetupCode
  if (!rec) return false
  return rec.expiresAt > Date.now()
}
