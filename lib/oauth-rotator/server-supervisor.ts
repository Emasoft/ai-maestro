// The SERVER TIMER that drives the OAuth-rotator SUPERVISOR beat — the alert-only governance loop
// ported in supervisor.ts (TRDD-7DRSIKVZ, D1 part 3). Mirrors server-tick.ts, the sibling that
// drives the 60s rotation tick.
//
// The supervisor HEALS NOTHING (tick.ts owns the 60s rotation beat); it gathers observable metadata
// and surfaces the conditions a HUMAN must act on — a pinning env var that defeats rotation, an
// opted-in non-macOS host, a stalled tick, a no-refresh setup token nearing expiry, an account stuck
// in a human-only renew leg. So unlike the rotation tick it needs NO separate live-write flag: its
// natural gate is just the rotator OPT-IN (rotatorRoot()/opt-in.flag) — with the rotator not opted
// in every beat no-ops and never touches the OS keychain.
//
// The one liveness signal the supervisor needs is "is the beat owner (the tick) alive?" — a stale
// tick-completed.ts stamp is only an ALARM if the tick is SUPPOSED to be beating. In the janitor the
// owner is the daemon; in the server the owner is server-tick.ts's timer, which is armed exactly
// when the tick opt-in flag is present. So `daemonAlive` here maps to `oauthTickEnabled()`: if the
// tick is armed but its stamp is stale, the tick is hanging → alert; if the tick is NOT armed, a
// stale stamp is expected and no alarm fires (the faithful `daemonAlive: false` fail-safe).
//
// Safe to START unconditionally at boot: the opt-in gate lives INSIDE the beat, the timer is
// unref'd (never keeps the process alive nor delays shutdown), and a beat NEVER throws to its caller
// — a governance loop that crashed the unattended server would be far worse than a skipped beat.

import { gatherFacts, diagnose, apply, optInPresent } from './supervisor'
import { oauthTickEnabled } from './server-tick'
import { deliverAlerts } from './alert-delivery'
import { stampChoreRun } from '../janitor-chore-stamp'

/** Governance cadence — supervisor.py's 10-minute loop. */
export const SUPERVISOR_INTERVAL_MS = 600_000

/** Injected seams so a unit test drives one beat deterministically with zero I/O. */
export interface RunSupervisorBeatDeps {
  /** Default `optInPresent` — is the rotator opted in on this machine? */
  optInCheck?: () => boolean
  /** Default `oauthTickEnabled` — is the server's rotation tick armed (the beat owner alive)? */
  tickArmedCheck?: () => boolean
  /** Default `gatherFacts` — the fact-gathering I/O (stubbed in tests so zero keychain is touched). */
  gatherFactsImpl?: (daemonAlive: () => boolean) => ReturnType<typeof gatherFacts>
  /** Where alert lines go. Default: the server log via console.warn. */
  log?: (msg: string) => void
  /** DELIVERY to a human channel (TRDD-RFQFCCU4) — distinct from `log`, which is the record. The
   *  findings were always well-formed; before this they reached only pm2-out.log, where
   *  `a human must re-login` accumulated 4506 times over 4 days while the fleet walked into the
   *  rate limit. Default: `deliverAlerts` (always-written file + best-effort banner + backoff).
   *  Fire-and-forget on purpose — see the call site. */
  deliver?: (findings: ReadonlyArray<{ code: string; message: string }>) => void
}

/**
 * One supervisor beat: gate on the rotator opt-in → gather facts (with the tick-armed state as the
 * beat-owner liveness) → diagnose → surface the alerts. Wrapped so it NEVER throws to its caller.
 * Returns the alert codes it surfaced (empty when opted-out or all clear) so a test can assert
 * without scraping the log.
 */
export function runOneSupervisorBeat(deps: RunSupervisorBeatDeps = {}): string[] {
  const optInCheck = deps.optInCheck ?? optInPresent
  const tickArmedCheck = deps.tickArmedCheck ?? oauthTickEnabled
  const gatherFactsImpl =
    deps.gatherFactsImpl ?? ((daemonAlive: () => boolean) => gatherFacts({ deps: { daemonAlive } }))
  const log = deps.log ?? ((msg: string) => console.warn(msg))
  // The janitor's handover stamp — see TRDD-14HI8ZPR / ai-maestro#111. Written on ATTEMPT, before
  // the opt-in gate, because a supervisor beat that correctly no-ops is still this chore being
  // owned on cadence, which is the only thing the stamp claims.
  stampChoreRun('oauth-rotator-supervisor')
  try {
    if (!optInCheck()) return [] // rotator not opted in → silent no-op, no keychain access.
    const facts = gatherFactsImpl(tickArmedCheck)
    const findings = diagnose(facts)
    const alerts = apply(findings, log).alerts
    // DELIVER, fire-and-forget. This function is SYNCHRONOUS by contract (its callers and tests
    // read the returned codes directly), and delivery does I/O — so awaiting it here would either
    // change that contract for every caller or, worse, let a slow filesystem stall the beat timer.
    // The delivery path never throws and swallows its own failures, so a floating promise cannot
    // surface an unhandled rejection; the `.catch` is belt to that braces.
    // CALLED ON EVERY BEAT, INCLUDING THE ALL-CLEAR. This was gated on `findings.length > 0`, which
    // silently disabled the resolution half of the system: deliverAlerts is what drops resolved
    // codes from active-alerts.json, so when the LAST alert cleared it was never called and the
    // file kept asserting a problem that no longer existed — indefinitely, since nothing else
    // prunes it. An alert record that cannot clear is the same defect as an alert that never
    // fires, just harder to notice, because a stale file reads exactly like a real outstanding
    // alert. (It is also what would make the shared log's CLEARED transition unreachable.)
    // The cost is one locked read-modify-write per 10-minute beat when all is well; the benefit is
    // that "outstanding NOW" is true.
    {
      const deliver = deps.deliver ?? ((f: ReadonlyArray<{ code: string; message: string }>) => {
        void deliverAlerts(f, { log }).catch(() => { /* never take the beat down */ })
      })
      // ITS OWN try/catch, NOT the outer one. A throwing deliver falling into the outer catch makes
      // the beat return [] — so a broken notifier would DISCARD the very alerts it failed to send,
      // turning a delivery fault into a detection fault. That is the incident's own shape (a
      // channel that fails and takes the signal with it), and a test pins it.
      try { deliver(findings) } catch (derr) {
        log(`[oauth-supervisor] alert delivery threw (non-fatal, alerts still reported): ${(derr as Error)?.message ?? derr}`)
      }
    }
    return alerts
  } catch (err) {
    console.warn(`[oauth-supervisor] server beat failed (non-fatal): ${(err as Error)?.message ?? err}`)
    return []
  }
}

export interface StartOauthRotatorSupervisorOptions {
  /** Beat interval in ms. Default 600000 — supervisor.py's 10-minute governance cadence. */
  intervalMs?: number
}

/**
 * Start the background supervisor timer and return a stop function. Safe to call unconditionally at
 * boot: with the rotator not opted in every beat no-ops (see the file header). The timer is `unref`'d
 * and each beat is fire-and-forget — `runOneSupervisorBeat` already swallows its own errors.
 */
export function startOauthRotatorSupervisor(opts: StartOauthRotatorSupervisorOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? SUPERVISOR_INTERVAL_MS
  const timer = setInterval(() => {
    runOneSupervisorBeat()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
