// Read-only fleet-liveness watchdog — CHN16JXZ Phase A wiring (Phase D-lite).
//
// Runs the fleet-liveness scanner on a timer and LOGS what it finds. It performs NO
// actuation — the guardian's eyes open (the server can now SEE stalled server-owned
// agents), but the recovery hands stay behind Phase B/C. Mirrors the shape of
// `startAgentInvariantsWatchdog` (setInterval, unref'd, never-throws, env-interval,
// 0 disables) so it composes into the same boot sweep.
//
// The default deps wire the real substrate; everything is injectable so the tick is
// tested without a live fleet.

import { getAgent, listAgents } from '@/lib/agent-registry'
import { getAgentSessionStatus } from '@/services/agents-core-service'
import { readHookNotification } from '@/lib/session-safe-state'
import { scanFleetLiveness, type FleetScanDeps, type FleetLivenessSnapshot } from '@/lib/fleet-liveness'

/** Wire the read-only scanner to the real registry + session substrate. Token-block
 *  detection (`getAccountHealthy`) is intentionally omitted here — it lands with the
 *  OAuth cascade (1GGQ4HWY); until then a token-blocked agent simply classifies via
 *  its idle/active state and is never actuated. */
export function defaultFleetScanDeps(): FleetScanDeps {
  return {
    listAgents: () =>
      listAgents(false).map((s) => {
        const full = getAgent(s.id)
        const wd =
          full?.workingDirectory ?? s.sessions?.find((x) => x.index === 0)?.workingDirectory ?? null
        return { id: s.id, name: s.name, workingDirectory: wd }
      }),
    getStatus: async (agentId: string) => {
      const r = await getAgentSessionStatus(agentId)
      const d = r.data
      return {
        hasSession: !!d?.hasSession,
        exists: !!d?.exists,
        timeSinceActivityMs: d?.timeSinceActivity ?? null,
      }
    },
    getHookNotification: (wd) => readHookNotification(wd),
  }
}

export interface FleetLivenessWatchdogOptions {
  intervalMs?: number
  /** Injectable scan for tests; defaults to a real read-only fleet scan. */
  scan?: (scannedAt: number) => Promise<FleetLivenessSnapshot>
  now?: () => number
  log?: (msg: string) => void
}

/** Default 5 min, env-overridable, 0 disables (same knob shape as the invariants watchdog). */
const DEFAULT_INTERVAL_MS = Number(process.env.AIM_FLEET_LIVENESS_WATCHDOG_INTERVAL_MS) || 300_000

/**
 * One scan + report. READ-ONLY: it never actuates. Returns the snapshot (or null if the
 * scan threw — a watchdog tick must never propagate). Logs a single concise line only
 * when there is something to report (stalled / token-blocked agents), so a healthy fleet
 * stays silent.
 */
export async function runFleetLivenessTick(
  opts: FleetLivenessWatchdogOptions = {},
): Promise<FleetLivenessSnapshot | null> {
  const now = opts.now ?? Date.now
  const log = opts.log ?? ((m: string) => console.warn(m))
  const scan = opts.scan ?? ((t: number) => scanFleetLiveness(defaultFleetScanDeps(), t))
  try {
    const snap = await scan(now())
    const stalled = snap.agents.filter((a) => a.class === 'stalled')
    const tokenBlocked = snap.agents.filter((a) => a.class === 'token_blocked')
    if (stalled.length || tokenBlocked.length) {
      const parts: string[] = []
      if (stalled.length) parts.push(`${stalled.length} stalled: ${stalled.map((a) => a.name || a.agentId).join(', ')}`)
      if (tokenBlocked.length)
        parts.push(`${tokenBlocked.length} token-blocked: ${tokenBlocked.map((a) => a.name || a.agentId).join(', ')}`)
      const gate = snap.actuationBlocked
        ? ` (actuation BLOCKED: ${snap.actuationBlockReason})`
        : ` — recovery targets: ${snap.recoveryTargets.length} [Phase A: detect-only, no actuation yet]`
      log(`[FleetLiveness] ${parts.join('; ')}${gate}`)
    }
    return snap
  } catch (err) {
    log(`[FleetLiveness] scan failed (non-fatal): ${(err as Error)?.message || err}`)
    return null
  }
}

/**
 * Start the periodic read-only watchdog. Returns a stop function, or null when disabled
 * (interval <= 0). The timer is `unref`'d so it never holds the process open at shutdown.
 */
export function startFleetLivenessWatchdog(opts: FleetLivenessWatchdogOptions = {}): (() => void) | null {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!intervalMs || intervalMs <= 0) return null // 0 disables
  const timer = setInterval(() => {
    void runFleetLivenessTick(opts)
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
