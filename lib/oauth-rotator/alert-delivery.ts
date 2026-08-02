/**
 * Delivery for the rotator supervisor's alerts (TRDD-RFQFCCU4).
 *
 * ## Why this module exists
 *
 * The supervisor's findings were already well-formed and actionable — `cookie-leg-stuck` names the
 * account, how long it has been stuck, and the command to run. They went to `console.warn`, i.e. to
 * `logs/pm2-out.log`, and nowhere else.
 *
 * Measured on 2026-08-02: `a human must re-login` was logged **4 506 times over 4 days** while every
 * session on the host walked into the rate limit and stalled. Detection was perfect; delivery did not
 * exist; so the outcome was identical to having no detection at all — while looking, in the code and
 * in the tests, like a working alert path.
 *
 * ## The trap this module is built around
 *
 * `lib/setup-bootstrap.ts` already learned it the hard way, and its comment is the specification:
 *
 * > A daemonized server (pm2/launchd/systemd) runs outside a GUI session, where
 * > `osascript display notification` returns exit 0 but the banner never reaches NotificationCenter.
 *
 * ai-maestro's server IS pm2-daemonized. So a desktop notification here **succeeds and delivers
 * nothing** — the very failure mode that caused the incident, reintroduced one layer up. Hence:
 *
 *   1. **The FILE is written unconditionally** and is the reliable channel. It is what the CLI, the
 *      API and a human can read, and it cannot silently no-op.
 *   2. The desktop banner is **best-effort ON TOP**, never the sole channel, and its failure is
 *      swallowed by design.
 *
 * A channel that reports success without delivering is worse than no channel, because it stops
 * anyone from building a real one.
 */
import { updateJson, readJson } from '@/lib/json-io'
import { rotatorRoot } from './slots'
import { appendRotatorLog } from './decision-log'
import path from 'path'

/** Where the always-written alert record lives. Beside the rotator's own state, so anything that
 *  can find the rotator can find its outstanding alerts. */
export function alertsFile(): string {
  return path.join(rotatorRoot(), 'active-alerts.json')
}

export interface AlertRecord {
  /** Epoch seconds when this code was FIRST seen outstanding — the age the message quotes. */
  firstSeenAt: number
  /** Epoch seconds of the last delivery to a human channel (NOT the last log line). */
  lastDeliveredAt: number
  /** The most recent message text for this code. */
  message: string
  /** How many beats have observed this code since firstSeenAt. */
  seen: number
}

/**
 * ESCALATING BACKOFF — the reason 4 506 identical lines is itself part of the failure.
 *
 * An alert that repeats every 60 s forever trains its reader to filter it out, so by the time it
 * matters it is furniture. First sighting goes out immediately (the moment of onset is the most
 * actionable moment there will ever be); after that the interval widens.
 *
 * It never stops entirely: an outstanding credential problem that has gone quiet is
 * indistinguishable from one that was fixed, and that ambiguity is what let this run for four days.
 */
export const BACKOFF_LADDER_S: readonly number[] = [0, 900, 3600, 10_800] // now, 15min, 1h, then 3h

/** PURE. Should this code be delivered to a human channel on this beat? Split out with no I/O so the
 *  ladder is testable without a filesystem, a clock, or a notifier. */
export function dueForDelivery(rec: AlertRecord | undefined, nowS: number): boolean {
  if (rec === undefined) return true // never seen → the onset, always deliver
  const elapsedSinceDelivery = nowS - rec.lastDeliveredAt
  // Which rung are we on? One rung per delivery already made, capped at the last.
  const deliveries = Math.max(0, rec.seen > 0 ? countDeliveries(rec) : 0)
  const rung = Math.min(deliveries, BACKOFF_LADDER_S.length - 1)
  return elapsedSinceDelivery >= BACKOFF_LADDER_S[rung]
}

/** Deliveries are not counted directly (the record would have to carry a second counter that can
 *  disagree with `lastDeliveredAt`); they are DERIVED from how long the alert has been outstanding.
 *  One source of truth, so the two can never drift. */
function countDeliveries(rec: AlertRecord): number {
  const outstanding = Math.max(0, rec.lastDeliveredAt - rec.firstSeenAt)
  let n = 0
  let acc = 0
  for (const step of BACKOFF_LADDER_S) {
    acc += step
    if (outstanding >= acc) n++
    else break
  }
  return n
}

/** PURE. The human-facing line: the finding's own message plus how long it has been outstanding.
 *  The AGE is the part a log line cannot convey — "stuck" and "stuck since Tuesday" are different
 *  emergencies, and the second one is why this incident lasted four days. */
export function deliveryText(code: string, message: string, outstandingS: number): string {
  if (outstandingS < 60) return `[${code}] ${message}`
  const h = outstandingS / 3600
  const age = h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(outstandingS / 60)}m`
  return `[${code}] OUTSTANDING ${age} — ${message}`
}

export interface DeliveryDeps {
  nowS?: () => number
  /** The best-effort human channel. Default: a macOS/Linux desktop banner. MAY silently no-op under
   *  a daemon — that is exactly why the file is written regardless. */
  notify?: (text: string) => Promise<void>
  /** The log channel — unchanged behaviour, every finding still goes here every beat. */
  log?: (msg: string) => void
}

/**
 * Record every outstanding finding to the always-written file, and push the ones whose backoff is
 * due to the best-effort human channel.
 *
 * NEVER THROWS. A supervisor beat that dies because its notifier failed is a guardian that removed
 * itself, which is strictly worse than the silence this module exists to fix.
 */
export async function deliverAlerts(
  findings: ReadonlyArray<{ code: string; message: string }>,
  deps: DeliveryDeps = {},
): Promise<string[]> {
  const nowS = (deps.nowS ?? (() => Math.floor(Date.now() / 1000)))()
  const log = deps.log ?? ((m: string) => console.warn(m))
  const delivered: string[] = []

  try {
    const file = alertsFile()
    const existing = await readJson(file)
    const prior: Record<string, AlertRecord> =
      existing.ok && typeof existing.data.alerts === 'object' && existing.data.alerts !== null
        ? (existing.data.alerts as Record<string, AlertRecord>)
        : {}

    const toNotify: Array<[string, string, number]> = []
    const live = new Set(findings.map(f => f.code))

    await updateJson(file, data => {
      const alerts = (data.alerts ?? {}) as Record<string, AlertRecord>
      for (const f of findings) {
        const rec = prior[f.code]
        const firstSeenAt = rec?.firstSeenAt ?? nowS
        const due = dueForDelivery(rec, nowS)
        alerts[f.code] = {
          firstSeenAt,
          lastDeliveredAt: due ? nowS : (rec?.lastDeliveredAt ?? nowS),
          message: f.message,
          seen: (rec?.seen ?? 0) + 1,
        }
        if (due) toNotify.push([f.code, f.message, nowS - firstSeenAt])
      }
      // RESOLVED alerts are dropped, so the file answers "what is outstanding NOW" rather than
      // "what has ever been wrong". A cleared credential problem must stop being reported, or the
      // file becomes the same unreadable wall as the log.
      for (const code of Object.keys(alerts)) if (!live.has(code)) delete alerts[code]
      data.alerts = alerts
      data.updatedAt = nowS
    }, { createIfMissing: true })

    // Mirror the two TRANSITIONS — and only the transitions — into the shared rotator.log, so the
    // server's alerts sit in the same ordered timeline as the janitor's rotation decisions. That
    // shared timeline is the whole point: reconstructing "why did rotation not happen at 03:00"
    // otherwise means correlating two files by hand, at the moment you are already debugging.
    //
    // ONSET and CLEAR, never the steady state. Appending once per beat would put ~144 identical
    // lines a day into a file the janitor trims at 256 KB — so a persistent alert would EVICT the
    // rotation history this log exists to preserve, and the alert would still be there to read in
    // active-alerts.json. That is not hypothetical here: the delivery backoff above exists because
    // one alert reached pm2-out.log 4506 times in 4 days and became unreadable. A log records a
    // change of state; a poll belongs in the state file, which is what `alerts` already is.
    for (const f of findings) {
      if (prior[f.code] === undefined) appendRotatorLog('alert', `ONSET ${f.code} — ${f.message}`)
    }
    for (const code of Object.keys(prior)) {
      if (!live.has(code)) appendRotatorLog('alert', `CLEARED ${code}`)
    }

    for (const [code, message, outstandingS] of toNotify) {
      const text = deliveryText(code, message, outstandingS)
      log(`[oauth-supervisor] DELIVER ${text}`)
      if (deps.notify) {
        // Best-effort by contract: a banner that cannot be shown must not take the beat down.
        try { await deps.notify(text) } catch { /* GUI session unavailable — the file still holds it */ }
      }
      delivered.push(code)
    }
  } catch (err) {
    // Degrade to the log — the pre-existing behaviour — rather than break the beat.
    log(`[oauth-supervisor] alert delivery failed (non-fatal, alerts still logged): ${(err as Error)?.message ?? err}`)
  }
  return delivered
}
