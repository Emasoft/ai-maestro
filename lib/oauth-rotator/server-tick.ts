// The config-gated (default OFF) SERVER TIMER that drives the OAuth-rotator beat
// (TRDD-1GGQ4HWY Phase G).
//
// tick.ts::runTick ACTUATES — with real slots present it can call switchLiveTo → the real
// `Claude Code-credentials` write. Phase F/G's design (R16) is that the mechanism ships COMPLETE
// but INERT: the server must not fire runTick until the human deliberately turns it on. Phase G
// is exactly that call site, and this file is the whole of it.
//
// THE GATE IS A FLAG FILE, NOT AN ENVIRONMENT VARIABLE (TRDD-CC9PY337). A var that changes what
// the rotator WRITES is precisely the kind that must stay out of the environment: an inherited
// `export` would silently arm live-credential rotation across every process that inherited it.
// The gate is therefore a file on disk under ~/.aimaestro:
//   - ABSENT  → the R16-safe default: every beat no-ops, nothing is written, no network is hit.
//   - PRESENT → the human's deliberate, auditable opt-in.
// Only the human creates the flag; the server only READS it. Deleting the file disarms the timer
// on the very next beat.
//
// The timer is safe to START unconditionally at boot: the flag gate lives INSIDE the beat
// (oauthTickEnabled), so with the flag absent every beat returns before touching runTick. There
// is also a live-client gate (claudeRunning) — keeping an account signed in is pointless when no
// `claude` process is using it — and it FAILS CLOSED (unsure ⇒ do not actuate). A beat never
// throws to the caller and the timer is unref'd, so it can neither crash nor delay the server.

import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { statePath } from '../ecosystem-constants'
import { withTickLock } from './tick-lock'
import { runTick } from './tick'
import { writeTickStatus } from './tick-status'
import { repairOneDeadSlot, type RepairResult } from './reauth-repair'

/** The opt-in flag FILE (not an env var, per TRDD-CC9PY337). Its ABSENCE is the R16 default. */
export const OAUTH_TICK_FLAG = statePath('oauth-rotator-tick.enabled')

/**
 * True iff the human created the opt-in flag file. Re-resolves the path via `statePath()` on
 * EVERY call rather than reusing the module-load `OAUTH_TICK_FLAG`: `getStateDir()` is anchored
 * on `os.homedir()`, and a unit test points HOME at a temp dir in `beforeEach` — AFTER this
 * module was imported and the const was frozen against the real HOME. Deriving the flag basename
 * from the const keeps ONE source of truth for the name while honoring the test's HOME override.
 */
export function oauthTickEnabled(): boolean {
  return fs.existsSync(statePath(path.basename(OAUTH_TICK_FLAG)))
}

/**
 * True iff a real `claude` CLI process is alive. Uses `pgrep -x claude`, which matches the EXACT
 * process NAME "claude" — the pgrep process is itself named "pgrep", so it can never self-match
 * the way `pgrep -f` / `ps | grep <pattern>` do (the pattern would be in the scanner's own argv).
 * FAIL-CLOSED (R16): any spawn error (pgrep missing, permission denied) AND pgrep's exit-1
 * "no match" both arrive here as `err`, and both resolve `false` — we never actuate a rotation
 * while UNSURE the client is alive. Only a clean exit-0 with a non-empty pid list returns true.
 */
export function claudeRunning(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile('pgrep', ['-x', 'claude'], (err, stdout) => {
      resolve(!err && stdout.trim().length > 0)
    })
  })
}

/** Injected seams so a unit test drives the beat deterministically without timers or real I/O. */
export interface RunOneTickDeps {
  /** Default `oauthTickEnabled` — is the opt-in flag file present? */
  enabledCheck?: () => boolean
  /** Default `claudeRunning` — is a live `claude` client using the credential? */
  claudeRunningCheck?: () => Promise<boolean>
  /** Default `() => runTick()` — the actual rotation beat (stubbed in tests so zero I/O happens). */
  runTickImpl?: () => Promise<unknown>
  /** Default `repairOneDeadSlot` — the re-capture leg, behind its OWN flag (TRDD-CVQJNW3A). */
  repairImpl?: () => Promise<RepairResult>
}

/**
 * One rotation beat, extracted from the timer so tests call it deterministically:
 * gate on the flag → gate on a live client → run `runTick` under the tick lock. A held lock skips
 * this round (withTickLock returns null without running the body). The whole body is wrapped so a
 * beat NEVER throws to its caller — a rotation tick that crashed the server (it runs unattended on
 * a timer) would be a far worse failure than a skipped beat; the next beat retries.
 */
export async function runOneTick(deps: RunOneTickDeps = {}): Promise<void> {
  const enabledCheck = deps.enabledCheck ?? oauthTickEnabled
  const claudeRunningCheck = deps.claudeRunningCheck ?? claudeRunning
  const runTickImpl = deps.runTickImpl ?? (() => runTick())
  try {
    if (!enabledCheck()) return // R16 default: flag absent → do nothing, write nothing.
    if (!(await claudeRunningCheck())) return // no live client → nobody to keep signed in.
    const result = await withTickLock(() => runTickImpl()) // serialise; concurrent tick → null.
    // PERSIST-THEN-READ (TRDD-1GGQ4HWY → DXJZM3BW): stamp the cascade next_action so the continuity
    // `status` verb can READ it without ever running the tick (R16). A null (lock held) / undefined
    // (stub) / shapeless result is a silent no-op inside writeTickStatus — the last good value stays.
    writeTickStatus(result)
    // REPAIR (TRDD-CVQJNW3A). The beat above can DETECT a dead slot and has nowhere to go —
    // re-capture is the one repair it cannot perform, and on 2026-07-31 that gap cost the owner a
    // manual login while the rotator watched it happen every 60 s. This is that leg.
    //
    // It carries its OWN flag, absent by default: the beat writes a keychain entry silently,
    // whereas this OPENS A VISIBLE BROWSER WINDOW, so one switch must never arm both. With that
    // flag absent the call returns 'disabled' before doing any work at all — not even the keychain
    // reads a survey costs — so an unarmed server pays nothing for this being here.
    //
    // Skipped when the lock was held (`result === null`): another process is mid-beat, and two
    // processes repairing at once is two browser windows. Re-using the tick's existing
    // serialisation is free; inventing a second lock for the same invariant would not be.
    if (result !== null) {
      try {
        const repair = await (deps.repairImpl ?? repairOneDeadSlot)()
        // Outcomes only on the log surface, never the email — the same rule the beat's decision
        // line follows. 'disabled' and 'nothing-to-do' are the overwhelmingly common answers and
        // say nothing an operator needs, so they stay SILENT rather than training everyone to
        // scroll past this line on the day it finally says something.
        if (repair.outcome !== 'disabled' && repair.outcome !== 'nothing-to-do') {
          console.warn(
            `[oauth-rotator] reauth-repair: ${repair.outcome}${repair.detail ? ` (${repair.detail})` : ''}`,
          )
        }
      } catch (err) {
        // Its OWN catch. The outer one reports "server tick failed", which would be a FALSE report
        // when the tick succeeded and only the repair leg threw — and a false attribution on a
        // credential subsystem sends the next reader to the wrong file.
        console.warn(`[oauth-rotator] reauth-repair failed (non-fatal): ${(err as Error)?.message ?? err}`)
      }
    }
  } catch (err) {
    console.warn(`[oauth-rotator] server tick failed (non-fatal): ${(err as Error)?.message ?? err}`)
  }
}

export interface StartOauthRotatorTickOptions {
  /** Beat interval in ms. Default 60000 — the janitor daemon's cadence. */
  intervalMs?: number
}

/**
 * Start the background rotation timer and return a stop function. Safe to call unconditionally at
 * boot: with the flag file absent every beat no-ops (see the file header). The timer is `unref`'d
 * so it never keeps the process alive nor delays shutdown, and each beat is fire-and-forget —
 * `runOneTick` already swallows its own errors; the `.catch` is belt-and-braces.
 */
export function startOauthRotatorTick(opts: StartOauthRotatorTickOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 60_000
  const timer = setInterval(() => {
    void runOneTick().catch(() => {})
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
