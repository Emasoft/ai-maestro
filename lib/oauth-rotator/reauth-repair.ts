// The REPAIR leg: re-capture ONE dead slot without a human at the keyboard (TRDD-CVQJNW3A).
//
// THE INCIDENT THIS CLOSES. 2026-07-31 ~17:20 the owner was rate-limited and logged in BY HAND.
// The rotator was not asleep — it detected the exhaustion every 60 s and had NOWHERE TO GO. The
// one account with a full quota was the one whose refresh token was dead (69 failures, expired
// 228 h). One re-capture was the whole fix, and it was the one thing the system could not do.
//
// ── WHY THIS IS NOT INSIDE runTick ──────────────────────────────────────────────────────────
// runTick's own docstring says the browser tiers are "deliberately NOT invoked here". That is not
// an accident of layering. Rotating to an ALREADY-CAPTURED slot is a keychain write this machine
// performs silently; re-capturing OPENS A VISIBLE BROWSER WINDOW on the owner's screen. Those are
// different promises to the owner, so they get different switches — arming the tick must never
// imply arming this.
//
// ── THREE GATES, ALL OF WHICH MUST PASS ─────────────────────────────────────────────────────
//  1. Its OWN flag file, ABSENT by default (R16) — never the tick's flag. Only a human creates
//     it; this module only reads it.
//  2. ONE repair per beat. Each drive opens a window, so three dead slots must not open three.
//     The next beat takes the next one.
//  3. A per-email cooldown. Without it an UNREPAIRABLE slot (an ambiguous consent page, a browser
//     logged out of claude.ai) re-opens a window on EVERY beat — the runaway the actuator rules
//     forbid. This is the only thing standing between "armed" and "a browser window every 60 s",
//     which is why the stamp is written BEFORE the attempt rather than after it.
//
// ── WHAT IT DELIBERATELY WILL NOT TRY TO FIX ────────────────────────────────────────────────
// Only `refreshDead` slots. An `unreadable` slot is a credential-ACCESS fault — this process
// cannot reach the keychain — and a re-login repairs nothing there: it would spend a human-visible
// browser interaction and then file the result somewhere still unreadable.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────
// The cooldown is IN MEMORY, so a server restart clears it. That is acceptable only because a
// server restarting often enough to matter is a louder problem than this one, and because the
// flag is absent by default. It is recorded here rather than left for someone to discover.

import * as fs from 'fs'
import * as path from 'path'
import { statePath } from '../ecosystem-constants'
import { surveyAlternates, type AlternateSurvey } from './tick'
import { startReauth, completeReauth } from './reauth-flow'
import { driveConsent } from './reauth-drive'

/** The opt-in flag FILE — a file, not an env var, for the same reason the tick's is (an inherited
 *  `export` would silently arm live-credential capture across every process that inherited it). */
export const REAUTH_REPAIR_FLAG = statePath('oauth-reauth-repair.enabled')

/** 6 h, not minutes: a re-login is a human-visible event, and an account that just failed to
 *  re-capture is not going to start succeeding on the next 60-second beat. */
export const REPAIR_COOLDOWN_MS = 6 * 60 * 60 * 1000

/**
 * True iff the human created the opt-in flag file. Re-resolves through `statePath()` on EVERY
 * call rather than reusing the module-load const: `getStateDir()` is anchored on `os.homedir()`,
 * and a test points HOME at a temp dir AFTER this module was imported and the const was frozen
 * against the real HOME. Deriving the basename from the const keeps ONE source of truth for the
 * name while honoring that override.
 */
export function reauthRepairEnabled(): boolean {
  try {
    return fs.existsSync(statePath(path.basename(REAUTH_REPAIR_FLAG)))
  } catch {
    return false // unreadable state dir ⇒ FAIL CLOSED; never actuate on a guess
  }
}

export type RepairOutcome =
  | 'disabled' // the flag is absent — the R16 default, and the overwhelmingly common answer
  | 'nothing-to-do' // no refresh-dead alternate; nothing to repair
  | 'cooling-down' // every dead candidate was attempted too recently
  | 'repaired' // filed, and the grant carried a refresh token — the repair HOLDS
  | 'repaired-weak' // filed, but with NO refresh token: it will die again in hours
  | 'drive-failed' // the consent page could not be driven to a code
  | 'exchange-failed' // a code came back but the token exchange refused it

export interface RepairResult {
  outcome: RepairOutcome
  /** The account acted on. NOT for the beat's log line — that surface is counts-only by rule —
   *  but for a UI telling the OWNER which of THEIR OWN accounts was repaired, which they are
   *  entitled to know. On success this is the account the TOKEN resolved to, which may differ
   *  from the hint: the human at the consent screen might have signed in as somebody else. */
  email?: string
  /** The drive's or the exchange's own reason, so a failure is diagnosable without re-running it.
   *  Never carries the code, the verifier, or a cookie. */
  detail?: string
}

/** Module-level so the cooldown outlives a single beat. Reset between tests. */
const lastAttempt = new Map<string, number>()

/** TEST-ONLY. Production code must never clear the cooldown — that is gate 3. */
export function __resetRepairCooldownForTest(): void {
  lastAttempt.clear()
}

export interface RepairDeps {
  enabledCheck?: () => boolean
  survey?: () => AlternateSurvey
  start?: typeof startReauth
  drive?: typeof driveConsent
  complete?: typeof completeReauth
  now?: () => number
}

/**
 * Attempt to re-capture at most ONE dead slot. Returns what happened; never throws for a routine
 * outcome (a failed drive is a RESULT, not an exception) so a caller can log it without a
 * try/catch deciding its control flow.
 */
export async function repairOneDeadSlot(deps: RepairDeps = {}): Promise<RepairResult> {
  // Gate 1. Checked FIRST, before any survey: with the flag absent an unarmed server must pay
  // nothing at all for this leg — not even the keychain reads a survey costs.
  if (!(deps.enabledCheck ?? reauthRepairEnabled)()) return { outcome: 'disabled' }

  const now = (deps.now ?? Date.now)()
  const survey = (deps.survey ?? surveyAlternates)()
  // `survey.unreadable` is deliberately ignored — see the header.
  const candidate = survey.refreshDead.find(
    (email) => now - (lastAttempt.get(email) ?? -Infinity) >= REPAIR_COOLDOWN_MS,
  )
  if (candidate === undefined) {
    // Distinguished on purpose: "nothing is broken" and "something is broken and I am waiting"
    // are opposite operator situations, and collapsing them would hide a slot that never repairs.
    return survey.refreshDead.length > 0 ? { outcome: 'cooling-down' } : { outcome: 'nothing-to-do' }
  }

  // Gate 3, stamped BEFORE the attempt. A drive that throws must still burn the cooldown — stamp
  // it after and a reliably-throwing slot opens a browser window on every single beat forever.
  lastAttempt.set(candidate, now)

  const { authorizeUrl, state } = (deps.start ?? startReauth)({ emailHint: candidate })
  // No `via`: the drive auto-sweeps every installed browser, which is WIDER than naming one.
  // Profile targeting is its own escalation, inside the drive, and only when the default lands
  // on a sign-in page.
  const drive = await (deps.drive ?? driveConsent)({ authorizeUrl })
  if (!drive.ok) {
    return {
      outcome: 'drive-failed',
      email: candidate,
      detail: drive.detail ? `${drive.reason}: ${drive.detail}` : drive.reason,
    }
  }

  const done = await (deps.complete ?? completeReauth)(state, drive.code)
  if (!done.ok) return { outcome: 'exchange-failed', email: candidate, detail: done.reason }

  // hasRefreshToken is NOT collapsed into success: a re-login that files a token with no refresh
  // has bought hours, not a repair, and reporting that as 'repaired' is exactly the false success
  // this whole flow exists to end.
  return { outcome: done.hasRefreshToken ? 'repaired' : 'repaired-weak', email: done.email }
}
