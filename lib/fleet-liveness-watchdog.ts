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
import { loadPersistedSessions } from '@/lib/session-persistence'
import { scanFleetLiveness, type FleetScanDeps, type FleetLivenessSnapshot } from '@/lib/fleet-liveness'
import {
  runRecoveryPass,
  defaultActuatorDeps,
  type RecoveryState,
  type RecoveryPassResult,
} from '@/lib/fleet-recovery-runner'
import {
  runInboxNudgeTick,
  defaultInboxNudgeDeps,
  type InboxNudgeState,
  type InboxNudgeResult,
} from '@/lib/fleet-inbox-nudge'
import { trackDeadDebounce, type DeadPartition } from '@/lib/fleet-dead-debounce'
import { HARD_RECOVERY_FLAG } from '@/lib/fleet-hard-recovery'
import {
  runHardRecoveryPass,
  defaultHardRecoveryDeps,
  type HardRecoveryState,
  type HardRecoveryPassResult,
} from '@/lib/fleet-hard-recovery-runner'
import { readTickWindows } from '@/lib/oauth-rotator/tick-status'
import { runModelFallbackSweep } from '@/lib/oauth-rotator/model-fallback-sweep'
import {
  collectFallbackCandidates,
  defaultModelFallbackDeps,
  type FallbackAgentRef,
} from '@/lib/oauth-rotator/model-fallback-deps'
import {
  runContinuityTick,
  defaultContinuityDeps,
  type ContinuityState,
  type ContinuityTickResult,
} from '@/lib/fleet-continuity'
import {
  runAskUserAutoAnswerTick,
  defaultAskUserAnswerDeps,
  type AskUserState,
  type AskUserTickResult,
} from '@/lib/fleet-askuser-autoanswer'

/** Wire the read-only scanner to the real registry + session substrate. Token-block
 *  detection (`getAccountHealthy`) is intentionally omitted here — it lands with the
 *  OAuth cascade (1GGQ4HWY); until then a token-blocked agent simply classifies via
 *  its idle/active state and is never actuated. */
export function defaultFleetScanDeps(): FleetScanDeps {
  // Snapshot the persisted-session set ONCE per deps build (once per tick), closed over — the
  // crashed-vs-hibernated discriminator for the `dead` class. One file read per tick, not per agent.
  const persisted = new Set(
    loadPersistedSessions()
      .map((s) => s.agentId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
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
    isPersisted: (id) => persisted.has(id),
  }
}

export interface FleetLivenessWatchdogOptions {
  intervalMs?: number
  /** Injectable scan for tests; defaults to a real read-only fleet scan. */
  scan?: (scannedAt: number) => Promise<FleetLivenessSnapshot>
  now?: () => number
  log?: (msg: string) => void
  /** D-full: enable the recovery ACTUATOR. Defaults to AIM_FLEET_RECOVERY_FIRE; OFF otherwise —
   *  detection always runs, firing is opt-in. */
  fireEnabled?: boolean
  /** Injectable recovery pass for tests; defaults to the real runner over the module store. */
  runPass?: (snap: FleetLivenessSnapshot) => Promise<RecoveryPassResult>
  /** Inbox-nudge leg (TRDD-7HRDAD0U): default-ON; AIM_FLEET_INBOX_NUDGE=0 disables. */
  nudgeEnabled?: boolean
  /** Injectable inbox-nudge pass for tests; defaults to the real tick over the module store. */
  runNudge?: () => Promise<InboxNudgeResult>
  /** Model-fallback leg: default-OFF (AIM_FLEET_MODEL_FALLBACK=1 enables). Stays off until one
   *  switch has been watched end to end on a real pane — no test can prove the confirming ENTER
   *  actually dismissed Claude Code's dialog. */
  modelFallbackEnabled?: boolean
  /** AskUser auto-answer leg: default-OFF (AIM_FLEET_ASKUSER_AUTOANSWER=1 enables). Ships dark
   *  for the same reason as the model-fallback leg — no test can prove the ENTER dismissed a
   *  real menu. Answers `ask_user` menus ONLY, never permission prompts. */
  askUserAutoAnswerEnabled?: boolean
  /** Injectable auto-answer pass for tests; defaults to the real tick over the module store. */
  runAskUser?: (agents: { id: string; name?: string }[]) => Promise<AskUserTickResult>
  /** Injectable continuity pass for tests; defaults to the real tick over the module store. */
  runContinuity?: () => Promise<ContinuityTickResult>
  /** Boot-debounce for the `dead` class (TRDD-SX593MDG D2); defaults to the real sidecar-backed
   *  tracker. Injected in tests so the partition is deterministic and no sidecar is written. */
  trackDead?: (deadIds: string[], now: number) => DeadPartition
  /** Phase C: enable the HARD actuator (relaunch a genuinely dead agent). Defaults to
   *  AIM_FLEET_HARD_RECOVERY=1; OFF otherwise — its OWN switch, independent of the gentle one. */
  hardRecoveryEnabled?: boolean
  /** Injectable hard pass for tests; defaults to the real runner over the module store. */
  runHardPass?: (
    dead: { agentId: string; name?: string; class: 'dead' }[],
    debouncedIds: ReadonlySet<string>,
  ) => Promise<HardRecoveryPassResult>
}

/** Default 5 min, env-overridable, 0 disables (same knob shape as the invariants watchdog). */
const DEFAULT_INTERVAL_MS = Number(process.env.AIM_FLEET_LIVENESS_WATCHDOG_INTERVAL_MS) || 300_000

/** Recovery actuation is OFF by default — only `AIM_FLEET_RECOVERY_FIRE=1` arms it. Detection
 *  runs regardless; this gates only the firing. */
const DEFAULT_RECOVERY_FIRE = process.env.AIM_FLEET_RECOVERY_FIRE === '1'

/** The inbox-nudge is ON by default (it is the core AMP-delivery function; low-risk — gated inject,
 *  benign prompt, cooldown, STOP-gated). `AIM_FLEET_INBOX_NUDGE=0` disables it. */
const DEFAULT_INBOX_NUDGE = process.env.AIM_FLEET_INBOX_NUDGE !== '0'

/** The per-agent recovery state, threaded across ticks (the actuator is stateless). Module-level
 *  because the watchdog is a process singleton; reset between tests via resetRecoveryStore(). */
const recoveryStore = new Map<string, RecoveryState>()

/** The per-agent inbox-nudge cooldown state, threaded across ticks. Reset via resetInboxNudgeStore(). */
const inboxNudgeStore = new Map<string, InboxNudgeState>()

/** Clear the recovery state — for tests only (the running server keeps one store for its life). */
export function resetRecoveryStore(): void {
  recoveryStore.clear()
}

/** Phase C: hard recovery is OFF by default — only `AIM_FLEET_HARD_RECOVERY=1` arms it. */
const DEFAULT_HARD_RECOVERY = process.env[HARD_RECOVERY_FLAG] === '1'

/** Per-agent HARD-ladder state (attempt / cooldown / page-once), threaded across ticks. Its own
 *  store, not recoveryStore: a dead agent has no pane, so no other leg can double-actuate it. */
const hardRecoveryStore = new Map<string, HardRecoveryState>()

/** Clear the hard-recovery state — for tests only. */
export function resetHardRecoveryStore(): void {
  hardRecoveryStore.clear()
}

/** Clear the inbox-nudge state — for tests only. */
export function resetInboxNudgeStore(): void {
  inboxNudgeStore.clear()
}

/** Per-agent continuity state: the temporal-event episode memory plus the shared cooldown clock.
 *  Threaded across ticks because the retry-wedge fires on an ADVANCE between polls — with no memory
 *  it can never fire at all, which is the safe direction but detects nothing. */
const continuityStore = new Map<string, ContinuityState>()

/** Clear the continuity state — for tests only. */
export function resetContinuityStore(): void {
  continuityStore.clear()
}

/**
 * The model-fallback leg is OFF by default and must stay that way until one switch has been
 * watched end to end on a real pane. No test can prove the confirming ENTER actually dismissed
 * Claude Code's dialog — the tests prove the keystroke is SENT — so arming this is a deliberate
 * human act. `AIM_FLEET_MODEL_FALLBACK=1` enables it.
 */
const DEFAULT_MODEL_FALLBACK = process.env.AIM_FLEET_MODEL_FALLBACK === '1'

/**
 * The AskUser auto-answer leg is OFF by default for the same reason: its whole effect is one
 * ENTER into a live pane, and only a human watching a real menu dismiss can prove it correct.
 * `AIM_FLEET_ASKUSER_AUTOANSWER=1` enables it.
 */
const DEFAULT_ASKUSER_AUTOANSWER = process.env.AIM_FLEET_ASKUSER_AUTOANSWER === '1'

/** Per-agent dwell/lockout memory for the auto-answer leg, threaded across ticks. */
const askUserStore = new Map<string, AskUserState>()

/** Clear the auto-answer state — for tests only. */
export function resetAskUserStore(): void {
  askUserStore.clear()
}

/** When this sweep last switched an agent. ONE timestamp, not a Map: the sweep switches at most
 *  one agent per tick and the interval is fleet-wide, not per agent. */
const modelFallbackState: { lastSweepAtMs: number | null } = { lastSweepAtMs: null }

/** Clear the model-fallback pacing clock — for tests only. */
export function resetModelFallbackState(): void {
  modelFallbackState.lastSweepAtMs = null
}

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
    const dead = snap.agents.filter((a) => a.class === 'dead')
    const fireEnabled = opts.fireEnabled ?? DEFAULT_RECOVERY_FIRE
    const hardEnabled = opts.hardRecoveryEnabled ?? DEFAULT_HARD_RECOVERY
    // Boot-debounce the dead set (D2): a dead agent is only a hard-recovery candidate once it has
    // been observed dead PAST the boot window — a freshly-relaunched agent (session registered,
    // tmux not yet back) is still booting and must NOT be hard-recovered. Detection-only here; the
    // partition just labels the log so the observability is honest until Phase C consumes it.
    const trackDead = opts.trackDead ?? ((ids: string[], t: number) => trackDeadDebounce(ids, t))
    const deadPart: DeadPartition | null = dead.length ? trackDead(dead.map((a) => a.agentId), now()) : null
    if (stalled.length || tokenBlocked.length || dead.length) {
      const parts: string[] = []
      if (stalled.length) parts.push(`${stalled.length} stalled: ${stalled.map((a) => a.name || a.agentId).join(', ')}`)
      if (tokenBlocked.length)
        parts.push(`${tokenBlocked.length} token-blocked: ${tokenBlocked.map((a) => a.name || a.agentId).join(', ')}`)
      if (dead.length && deadPart) {
        const nameOf = (id: string) => dead.find((a) => a.agentId === id)?.name || id
        if (deadPart.hardRecoverable.length)
          parts.push(
            `${deadPart.hardRecoverable.length} dead (crashed past boot window${hardEnabled ? '' : `, hard recovery OFF: ${HARD_RECOVERY_FLAG} not set`}): ${deadPart.hardRecoverable.map(nameOf).join(', ')}`,
          )
        if (deadPart.debouncing.length)
          parts.push(
            `${deadPart.debouncing.length} dead (within boot window — debouncing, NOT a recovery target): ${deadPart.debouncing.map(nameOf).join(', ')}`,
          )
      }
      const gate = snap.actuationBlocked
        ? ` (actuation BLOCKED: ${snap.actuationBlockReason})`
        : ` — recovery targets: ${snap.recoveryTargets.length}${fireEnabled ? '' : ' [detect-only: AIM_FLEET_RECOVERY_FIRE not set]'}`
      log(`[FleetLiveness] ${parts.join('; ')}${gate}`)
    }

    // Phase D-full: actuation, behind the default-OFF fire flag. Detection (above) always runs;
    // firing is opt-in. The scan already emptied recoveryTargets under a machine-wide STOP, so a
    // halted fleet loops over nothing here. Wrapped in its OWN try so a pass failure logs but never
    // discards the snapshot the caller returns (the read-only detection result stays intact).
    if (fireEnabled && snap.recoveryTargets.length > 0) {
      try {
        const pass =
          opts.runPass ??
          ((s: FleetLivenessSnapshot) => runRecoveryPass(s, defaultActuatorDeps(true, now), recoveryStore, now))
        const pr = await pass(snap)
        for (const f of pr.fired)
          log(`[FleetLiveness] recovery FIRED ${f.name || f.agentId}: ${f.rung}${f.ok ? '' : ` (enqueue issue: ${f.detail})`}`)
        for (const e of pr.escalationNeeded)
          log(`[FleetLiveness] recovery ESCALATION NEEDED ${e.name || e.agentId}: ${e.reason} — gentle ladder exhausted; human / Phase C`)
      } catch (err) {
        log(`[FleetLiveness] recovery pass failed (non-fatal): ${(err as Error)?.message || err}`)
      }
    }

    // Phase C: HARD recovery for genuinely dead agents (persisted + tmux gone), behind its OWN
    // default-OFF flag. Every dead agent is driven through the actuator (so its gates — boot
    // grace, tracker debounce, cooldown, crash-loop — are the live decision surface); only the
    // tracker-confirmed set can actually fire. Own try, like every other leg. The machine-wide
    // STOP is enforced inside the actuator's shared entry gates, so a halted fleet refuses here
    // even though `dead` agents never appear in recoveryTargets.
    if (hardEnabled && dead.length > 0 && deadPart) {
      try {
        const hardPass =
          opts.runHardPass ??
          ((d: { agentId: string; name?: string; class: 'dead' }[], ids: ReadonlySet<string>) =>
            runHardRecoveryPass(d, ids, defaultHardRecoveryDeps(true, now), hardRecoveryStore, now))
        const hp = await hardPass(
          dead.map((a) => ({ agentId: a.agentId, name: a.name, class: 'dead' as const })),
          new Set(deadPart.hardRecoverable),
        )
        for (const f of hp.fired)
          log(`[FleetLiveness] HARD recovery FIRED ${f.name || f.agentId}: ${f.rung}${f.ok ? '' : ` (wake issue: ${f.detail})`}`)
        for (const c of hp.crashLooping)
          log(`[FleetLiveness] HARD recovery CRASH LOOP ${c.name || c.agentId}: ladder exhausted (${c.detail}) — human needed`)
      } catch (err) {
        log(`[FleetLiveness] hard-recovery pass failed (non-fatal): ${(err as Error)?.message || err}`)
      }
    }

    // Model-fallback leg: when a MODEL-SCOPED window is exhausted but the account still has
    // headroom, switch the agents on that model instead of rotating the credential. This is the
    // only subsystem that can: the rotator tick has the window numbers and no agents, this
    // watchdog has the agents and no credential access, so the two meet at the persisted stamp.
    //
    // Own try, like every other leg — a fallback failure must never discard the liveness snapshot.
    if (opts.modelFallbackEnabled ?? DEFAULT_MODEL_FALLBACK) {
      try {
        const windows = readTickWindows()
        // No stamp, stale stamp, or no scoped window ⇒ nothing to decide on. Silent: this is the
        // overwhelmingly common case and a line per tick would drown the log a human reads.
        if (windows?.scopedModel != null && windows.scopedPct != null) {
          const agents: FallbackAgentRef[] = snap.agents.map((a) => ({ id: a.agentId, name: a.name }))
          const { candidates, unreadable } = await collectFallbackCandidates(agents)
          const out = await runModelFallbackSweep(
            {
              scopedModel: windows.scopedModel,
              scopedPct: windows.scopedPct,
              account5hPct: windows.fiveHourPct,
              account7dPct: windows.sevenDayPct,
              candidates,
              lastSweepAtMs: modelFallbackState.lastSweepAtMs,
              // The SAME per-agent clock the recovery ladder uses — the cooldown is per agent,
              // not per subsystem, or two legs each nudging "once per window" double-nudge.
              lastActuatedAtMs: (id) => recoveryStore.get(id)?.lastActuatedAtMs ?? null,
            },
            defaultModelFallbackDeps(true, (id) => agents.find((a) => a.id === id), now),
          )
          if (out.acted) {
            // Stamp the clock ONLY on a real switch. Stamping on a refusal would silence the
            // sweep for a further interval each tick and it would never make progress.
            modelFallbackState.lastSweepAtMs = now()
            recoveryStore.set(out.agentId, {
              attempt: recoveryStore.get(out.agentId)?.attempt ?? 0,
              lastActuatedAtMs: now(),
            })
            const c = out.decision.fired ? out.decision.confirmed : null
            log(
              `[FleetLiveness] model-fallback SWITCHED ${out.agentId} off ${windows.scopedModel} ` +
                `(${Math.round(windows.scopedPct)}%) — confirmed=${c === null ? 'unknown' : c}`,
            )
          } else if (out.reason !== 'paced' && out.reason !== 'no-agents-on-that-model') {
            // `paced` and the drained state are the healthy quiet cases. Everything else is a
            // refusal a human may want to know about.
            log(`[FleetLiveness] model-fallback held off: ${out.reason}${out.detail ? ` (${out.detail})` : ''}`)
          }
          if (unreadable.length > 0) {
            log(`[FleetLiveness] model-fallback could not read ${unreadable.length} pane(s): ${unreadable.join(', ')}`)
          }
        }
      } catch (err) {
        log(`[FleetLiveness] model-fallback leg failed (non-fatal): ${(err as Error)?.message || err}`)
      }
    }

    // AskUser auto-answer leg: accept the DEFAULT option of a selection menu an agent has been
    // parked on past the dwell window. `ask_user` ONLY — a permission prompt is never answered
    // (that would silently bypass the tool-permission system) and is reported instead. Own try,
    // like every other leg.
    if (opts.askUserAutoAnswerEnabled ?? DEFAULT_ASKUSER_AUTOANSWER) {
      try {
        const agents = snap.agents.map((a) => ({ id: a.agentId, name: a.name }))
        const pass =
          opts.runAskUser ??
          ((refs: { id: string; name?: string }[]) =>
            runAskUserAutoAnswerTick(
              refs,
              askUserStore,
              // The SAME per-agent clock the recovery ladder and the fallback leg stamp — the
              // cooldown is per agent, not per subsystem.
              defaultAskUserAnswerDeps(true, (id) => recoveryStore.get(id)?.lastActuatedAtMs ?? null, now),
            ))
        const ar = await pass(agents)
        for (const a of ar.answered) {
          // Stamp the shared clock only on a real keystroke, so the ladder respects this
          // actuation's cooldown exactly as it respects its own.
          recoveryStore.set(a.agentId, {
            attempt: recoveryStore.get(a.agentId)?.attempt ?? 0,
            lastActuatedAtMs: now(),
          })
          log(
            `[FleetAskUser] answered ${a.name || a.agentId} with default "${a.defaultLabel}" — ` +
              `confirmed=${a.confirmed === null ? 'unknown' : a.confirmed}${a.detail ? ` (${a.detail})` : ''}`,
          )
        }
        for (const s of ar.skipped) {
          // `dwell` is the healthy quiet case (every open menu spends ticks there); everything
          // else is worth a line — especially `permission_menu`, which is a fleet parked on a
          // prompt this leg is FORBIDDEN to touch.
          if (s.reason !== 'dwell') {
            log(`[FleetAskUser] ${s.name || s.agentId}: not answered (${s.reason}${s.detail ? `: ${s.detail}` : ''})`)
          }
        }
        if (ar.blocked) log(`[FleetAskUser] leg blocked: ${ar.blocked}`)
      } catch (err) {
        log(`[FleetAskUser] auto-answer pass failed (non-fatal): ${(err as Error)?.message || err}`)
      }
    }

    // Inbox-nudge leg (TRDD-7HRDAD0U): deliver AMP mail to idle agents that never fire idle_prompt,
    // so a filesystem-delivered mandate reaches a never-prompted worker. Independent of the liveness
    // classes above — runs every tick regardless of stalled/dead counts. Default-ON; its OWN try so a
    // nudge failure never discards the liveness snapshot the caller returns.
    const nudgeEnabled = opts.nudgeEnabled ?? DEFAULT_INBOX_NUDGE
    if (nudgeEnabled) {
      try {
        const nudge =
          opts.runNudge ?? (() => runInboxNudgeTick(defaultInboxNudgeDeps(), inboxNudgeStore, now))
        const nr = await nudge()
        for (const n of nr.nudged)
          log(`[FleetInboxNudge] nudged ${n.name || n.agentId}: ${n.unread} unread → injected inbox-check`)
      } catch (err) {
        log(`[FleetInboxNudge] nudge pass failed (non-fatal): ${(err as Error)?.message || err}`)
      }
    }

    // Terminal-continuity leg (TRDD-Y8VPE3NS E3 box 5) — THE poll site that drives the automaton.
    // Until this existed the detection, classification and actuation were all built and tested and
    // never called once: an event nobody asked about. Runs every tick and independently of the
    // liveness classes above, because a wedged agent is `active` by every liveness measure — it is
    // genuinely doing something, just doing it forever. Detection always runs; FIRING is gated
    // inside the actuator by AIM_FLEET_RECOVERY_FIRE, so a tick on a default host classifies and
    // reports without touching anything. Own try, like its siblings.
    try {
      const cont =
        opts.runContinuity ??
        (() => runContinuityTick(defaultContinuityDeps(continuityStore, now()), continuityStore, now()))
      const cr = await cont()
      for (const f of cr.fired) log(`[FleetContinuity] ${f.name || f.agentId}: ${f.eventId} → ${f.response}`)
      // Only non-'no_event' skips reach here, so this stays quiet on a healthy fleet instead of
      // printing a line per agent per tick forever.
      for (const s of cr.skipped) log(`[FleetContinuity] ${s.name || s.agentId}: not actuated (${s.reason})`)
    } catch (err) {
      log(`[FleetContinuity] continuity pass failed (non-fatal): ${(err as Error)?.message || err}`)
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
