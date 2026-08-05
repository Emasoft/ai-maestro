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
import type { TickResult } from './tick'
import { writeTickStatus } from './tick-status'
import { deliverAlerts } from './alert-delivery'
import { stampChoreRun } from '../janitor-chore-stamp'

/**
 * Narrow the tick's `unknown` result to the fields the alert needs, WITHOUT tightening
 * `runTickImpl` (TRDD-RFQFCCU4). That dep is deliberately `Promise<unknown>` so a test can stub a
 * shapeless value, and `writeTickStatus` already treats such a value as a silent no-op — so the
 * alert path must be exactly as tolerant, or a stub that is legal for one consumer would throw in
 * the other. A `null` (lock held by another process) and an unshaped stub both answer `null` here,
 * which reads as "nothing to deliver" rather than as an error.
 */
export function alertableTick(result: unknown): Pick<TickResult, 'nextAction' | 'reason' | 'stuck' | 'decision'> | null {
  if (result === null || typeof result !== 'object') return null
  const r = result as Partial<TickResult>
  if (typeof r.decision !== 'string') return null // no human-readable line ⇒ nothing worth sending
  if (r.nextAction !== 'reauth-needed' && r.stuck === undefined) return null
  return { nextAction: r.nextAction as TickResult['nextAction'], reason: r.reason, stuck: r.stuck, decision: r.decision }
}
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
  /** DELIVERY of this beat's own alarms to a human (TRDD-RFQFCCU4). A seam, mirroring the
   *  supervisor's, so a test can assert the alert REACHED a channel without a filesystem or a
   *  notifier — the defect being fixed is precisely "the finding was perfect and reached nobody",
   *  which no assertion on the tick's return value could ever have caught. */
  deliverImpl?: (findings: ReadonlyArray<{ code: string; message: string }>) => void
}

/**
 * The minimum spacing between two rotation ATTEMPTS, whoever initiates them — TRDD-GY0LJV6S.
 *
 * Matches the timer's own period, so adding the statusline push-trigger cannot raise the rate at
 * which the rotator runs: it only lets a beat happen SOONER within a window the timer would have
 * used anyway. That is the whole safety claim of the trigger, and it is why the floor exists.
 */
export const TICK_ATTEMPT_FLOOR_MS = 60_000

/**
 * ⚠ `globalThis`, NOT a module-level `let`, and this is load-bearing rather than stylistic.
 *
 * In FULL mode `server.mjs` and the Next.js bundle load this module TWICE (two module registries,
 * two copies of every module-scope binding). A `let` would give the timer and the ingest route a
 * floor each, so each would happily fire while the other's said "too soon" — i.e. exactly double
 * the rate the floor exists to bound, and invisibly, because each instance's own accounting looks
 * correct. `Symbol.for` is keyed in the cross-realm registry, so both copies address one cell.
 */
const TICK_ATTEMPT_AT = Symbol.for('aimaestro.oauth-rotator.lastTickAttemptMs')

/** Epoch ms of the last rotation ATTEMPT, or 0 if none this process. */
export function lastTickAttemptMs(): number {
  const v = (globalThis as Record<symbol, unknown>)[TICK_ATTEMPT_AT]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * May a rotation attempt start now? Pure + zero-I/O, so a hot request path (the ingest route runs
 * at up to 600/min) can ask without touching disk.
 */
export function tickAttemptAllowed(nowMs = Date.now(), floorMs = TICK_ATTEMPT_FLOOR_MS): boolean {
  return nowMs - lastTickAttemptMs() >= floorMs
}

/**
 * Record that an attempt is starting.
 *
 * ⚠ ON ATTEMPT, never on success — the distinction is the entire point. `state.last_switch_at` is
 * the obvious-looking alternative and it is WRONG here: `switchLiveTo` (rotate.ts) writes it only
 * after a switch actually lands, so a rotation that finds no healthy candidate — precisely the
 * state a struggling fleet is in — advances nothing and leaves the next attempt unbounded. A floor
 * derived from it would vanish exactly when it is needed most.
 */
export function stampTickAttempt(nowMs = Date.now()): void {
  ;(globalThis as Record<symbol, unknown>)[TICK_ATTEMPT_AT] = nowMs
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
  // Stamp BEFORE the gates, so the floor tracks ATTEMPTS rather than beats-that-did-work. The
  // timer's own beats advance it too, which is what makes 60 s a floor for the whole subsystem
  // instead of for the push-trigger alone — otherwise an ingest arriving just after a beat would
  // fire a second run the timer had already covered. (TRDD-GY0LJV6S)
  stampTickAttempt()
  // The janitor's handover stamp, beside the internal one on purpose — they answer different
  // questions and are easy to confuse. `stampTickAttempt` is OURS: a rate floor so two triggers
  // cannot double-beat. `stampChoreRun` is THEIRS: the only way a janitor whose daemon we have
  // suppressed can tell an absorbed chore from an unowned one (TRDD-14HI8ZPR / ai-maestro#111).
  //
  // Placed BEFORE the gates for the same reason `stampTickAttempt` is: it records that the chore
  // was ATTEMPTED. A tick that correctly does nothing because the flag is off or no client is
  // running is still a chore being owned on cadence, which is the question the janitor is asking;
  // whether the rotation itself is healthy is reported separately by writeTickStatus and the
  // alert-delivery path below.
  stampChoreRun('oauth-rotator-tick')
  try {
    if (!enabledCheck()) return // R16 default: flag absent → do nothing, write nothing.
    if (!(await claudeRunningCheck())) return // no live client → nobody to keep signed in.
    const result = await withTickLock(() => runTickImpl()) // serialise; concurrent tick → null.
    // PERSIST-THEN-READ (TRDD-1GGQ4HWY → DXJZM3BW): stamp the cascade next_action so the continuity
    // `status` verb can READ it without ever running the tick (R16). A null (lock held) / undefined
    // (stub) / shapeless result is a silent no-op inside writeTickStatus — the last good value stays.
    writeTickStatus(result)
    // DELIVER the tick's own alarms to a human (TRDD-RFQFCCU4). The delivery channel was built for
    // the SUPERVISOR beat, whose diagnose() emits pinning-env / non-macos / tick-stalled /
    // setup-token-expiring / cookie-leg-stuck — none of which is the alarm that actually fired
    // during the 2026-08-02 incident. `reauth-needed` and the stuck states are emitted HERE, in the
    // 60s rotation beat, and reached only pm2-out.log: `a human must re-login` accumulated 4506
    // times over 4 days while every session on the host walked into the rate limit. Detection was
    // perfect and delivery did not exist, which is outcome-identical to no detection at all.
    //
    // alert-delivery was deliberately built standalone rather than inlined in the supervisor, so it
    // takes this second caller unchanged: same always-written file, same escalating backoff, same
    // resolved-codes-dropped semantics. A code that stops firing stops being reported.
    const alertable = alertableTick(result)
    if (alertable) {
      // The code carries the SPECIFIC fault, not a generic bucket, because the backoff and the
      // resolve-detection are per code: collapsing `refresh-dead` and `all-maxed` into one would
      // make a still-broken credential look resolved the moment a window freed up.
      const code = alertable.stuck ? `rotator-stuck:${alertable.stuck}` : `reauth-needed:${alertable.reason ?? 'unknown'}`
      const deliver = deps.deliverImpl ?? ((f: ReadonlyArray<{ code: string; message: string }>) => {
        void deliverAlerts(f, { log: (m: string) => console.warn(m) })
          .catch(() => { /* delivery swallows its own failures; never take the beat down */ })
      })
      try {
        deliver([{ code, message: alertable.decision }])
      } catch (derr) {
        // Its OWN catch, NOT the outer one. The outer catch reports "server tick failed", which
        // would be a FALSE attribution when the tick succeeded and only the notifier threw — and a
        // false attribution on a credential subsystem sends the next reader to the wrong file.
        console.warn(`[oauth-rotator] alert delivery threw (non-fatal, tick unaffected): ${(derr as Error)?.message ?? derr}`)
      }
    }
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
