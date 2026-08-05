// Fleet-liveness scanner — CHN16JXZ Phase A (READ-ONLY classification, NO actuation).
//
// WHY this exists: the janitor daemon's `session-liveness` beat recovers frozen
// sessions, but it DECLINES to touch the harness agents a live ai-maestro server
// owns (`server_owned → recovery None`), on the contract that the server recovers
// its own. When the server is up the janitor daemon also exits (§7.2, ai-maestro#79),
// so NOTHING watches those agents unless the server does. A wedged agent then stays
// wedged, silently — "the only real coverage gap, and it exists from the first second
// the server runs" (the janitor's words). This module is the DETECTION half: it scans
// the server-owned fleet and classifies each agent so the actuation half (later
// phases) can resume the stalled ones. It performs NO actuation itself.
//
// SAFETY posture (Phase A):
//  - Read-only. It reads session status + the hook's chat-state; it drives nothing.
//  - Conservative classification: an agent is `stalled` ONLY when idle at its prompt
//    with NO activity for a long window (default 30 min) — never on ordinary
//    between-turns idle. A permission-prompt or an unhealthy account is explicitly
//    NOT a stall (those need the user / the OAuth cascade, not a resume nudge).
//  - `recoveryRecommended` is suppressed fleet-wide whenever the janitor control
//    plane signals a machine-wide STOP (kill-switch / pause / maintenance) — the halt
//    is the owner's and deliberate; recovering against it would be the two-daemon
//    fight the one-daemon-per-host rule forbids.

import { fleetActuationBlocked } from '@/lib/janitor-control'
import { classifyHibernation } from '@/lib/agent-hibernation'

/** Liveness classes, mirroring the janitor's diagnosis in server terms. */
export type LivenessClass =
  | 'active' // processing a turn — healthy
  | 'idle_waiting' // idle at prompt, within the stall window (waiting for the user) — healthy
  | 'permission_waiting' // blocked on a tool-permission prompt — needs the USER, never a resume target
  | 'stalled' // idle at prompt with no activity past the stall window — a recovery target (gentle ladder)
  | 'token_blocked' // account unhealthy — must be healed by the OAuth cascade before any resume
  | 'dead' // registry expects a running session but tmux is gone — a CRASHED process (Phase C hard-recovery)
  | 'offline' // no live session (hibernated/never-woken) — not a recovery target

/** The observed inputs the classifier decides from (all from read-only sources). */
export interface LivenessInput {
  /** The registry has a session record for index 0. */
  hasSession: boolean
  /** The tmux session actually exists in the runtime. */
  exists: boolean
  /** The hook's `notificationType` (idle_prompt | permission_prompt | …), or null. */
  notificationType?: string | null
  /** The hook's coarse `status` / activity (active | waiting | …), or null. */
  activityStatus?: string | null
  /** ms since last observed activity, or null when unknown. */
  timeSinceActivityMs?: number | null
  /** From the continuity `status` rollup: false ⇒ token-blocked. null/absent ⇒ unknown (assume ok). */
  accountHealthy?: boolean | null
  /**
   * Whether the server's session-persistence record (added on wake, removed on hibernate) still
   * lists this agent. It is the ONLY reliable crashed-vs-hibernated discriminator when `exists` is
   * false: persisted-but-absent ⇒ CRASHED (`dead`); not-persisted-but-absent ⇒ clean hibernate
   * (`offline`). `hasSession` cannot tell them apart — it is ~always true for a named agent
   * (CHN16JXZ Phase C, verified 2026-07-22). Absent/undefined ⇒ treat as not-persisted (offline).
   */
  isPersisted?: boolean
}

export interface LivenessVerdict {
  class: LivenessClass
  recoveryRecommended: boolean
  reason: string
}

/** Default: 30 min of unbroken prompt-idle before we call it a stall. Generous on
 *  purpose — a false "stalled" that nudges a healthy waiting agent is worse than a
 *  missed one the next scan catches. Override per-scan for tests / tuning. */
export const DEFAULT_STALL_THRESHOLD_MS = 30 * 60_000

/**
 * PURE classifier: given the observed inputs, name the liveness class and whether a
 * resume is the right action. Order matters — the earlier, safer classifications win
 * so we never mis-file a permission-waiting or token-blocked agent as a stall.
 */
export function classifyLiveness(
  input: LivenessInput,
  stallThresholdMs: number = DEFAULT_STALL_THRESHOLD_MS,
): LivenessVerdict {
  // The never-woken / hibernated / crashed split is ONE decision, shared with the janitor's
  // auth-free probe and the JANITOR REPORT (`lib/agent-hibernation.ts`). It used to be inlined here,
  // which made it reachable only from inside the running server; three consumers now need the same
  // answer, and a second copy of a four-way classification drifts toward "the fleet thinks it is
  // fine". Only the MAPPING onto liveness classes stays here, so this function's observable
  // behaviour — classes, flags and reason strings — is unchanged by the extraction.
  //
  // `dead` is DETECTION-ONLY (recoveryRecommended:false): hard recovery (relaunch) is the gated
  // Phase C hard-actuator, which also debounces the post-restart sessions.json overcompleteness
  // before it ever kills/relaunches anything.
  const hibernation = classifyHibernation({
    hasSession: input.hasSession,
    exists: input.exists,
    isPersisted: input.isPersisted,
  })
  switch (hibernation.state) {
    case 'never_woken':
      return { class: 'offline', recoveryRecommended: false, reason: 'no session record (hibernated/never-woken)' }
    case 'hibernated':
      return { class: 'offline', recoveryRecommended: false, reason: 'no live session (hibernated/offline)' }
    case 'crashed':
      return {
        class: 'dead',
        recoveryRecommended: false,
        reason: 'persisted session but tmux gone — process crashed (Phase C hard-recovery, gated)',
      }
    case 'running':
      break // a live tmux session — fall through to the liveness ladder below
  }
  // Token-blocked BEFORE anything else: resuming an agent whose credential is dead
  // just burns another turn. It must be healed by the OAuth cascade (1GGQ4HWY) first;
  // until that is live, we only flag it — never recover it here.
  if (input.accountHealthy === false) {
    return {
      class: 'token_blocked',
      recoveryRecommended: false,
      reason: 'account unhealthy — must be healed by the OAuth cascade before a resume',
    }
  }
  if (input.notificationType === 'permission_prompt') {
    return {
      class: 'permission_waiting',
      recoveryRecommended: false,
      reason: 'blocked on a tool-permission prompt — needs the user, not a resume',
    }
  }
  if (input.activityStatus === 'active') {
    return { class: 'active', recoveryRecommended: false, reason: 'actively processing a turn' }
  }
  const idle = input.notificationType === 'idle_prompt' || input.activityStatus === 'waiting'
  if (idle) {
    const t = input.timeSinceActivityMs
    if (typeof t === 'number' && Number.isFinite(t) && t >= stallThresholdMs) {
      return {
        class: 'stalled',
        recoveryRecommended: true,
        reason: `idle at prompt with no activity for ${Math.round(t / 60_000)}m (>= ${Math.round(
          stallThresholdMs / 60_000,
        )}m stall window)`,
      }
    }
    return { class: 'idle_waiting', recoveryRecommended: false, reason: 'idle at prompt, within the stall window' }
  }
  // Online but neither clearly active nor clearly idle — indeterminate. Do NOT actuate
  // on an ambiguous state; the next scan will reclassify once the hook resolves it.
  return { class: 'idle_waiting', recoveryRecommended: false, reason: 'online, state indeterminate — not a recovery target' }
}

/** A minimal agent view the scanner needs — kept structural so the scanner is
 *  testable without the registry. */
export interface FleetAgentRef {
  id: string
  name?: string
  workingDirectory?: string | null
}

export interface FleetScanDeps {
  /** The server-owned agents to scan (registry). */
  listAgents: () => FleetAgentRef[]
  /** Read-only session status: existence + activity timing. */
  getStatus: (agentId: string) => Promise<{ hasSession: boolean; exists: boolean; timeSinceActivityMs: number | null }>
  /** The hook's notification (idle_prompt/permission_prompt) + coarse status for a workdir. */
  getHookNotification: (
    workingDir: string | undefined | null,
  ) => { status: string | null; notificationType: string | null } | null
  /** Optional: the continuity account-health rollup (false ⇒ token-blocked). */
  getAccountHealthy?: (agentId: string) => Promise<boolean | null>
  /** Optional: whether the agent is in the server's session-persistence record — the
   *  crashed-vs-hibernated signal for the `dead` class. Absent ⇒ `dead` is never classified
   *  (a persisted-but-absent agent falls through to `offline`). */
  isPersisted?: (agentId: string) => boolean
  /** Defaults to the janitor control-plane gate. Injectable for tests. */
  actuationBlocked?: () => { blocked: boolean; reason: string | null }
  /** Override the stall window. */
  stallThresholdMs?: number
}

export interface FleetAgentLiveness extends LivenessVerdict {
  agentId: string
  name?: string
}

export interface FleetLivenessSnapshot {
  /** ms epoch the scan ran (stamped by the caller — this module takes no clock). */
  scannedAt: number
  actuationBlocked: boolean
  actuationBlockReason: string | null
  agents: FleetAgentLiveness[]
  /** agentIds that are stalled AND recoverable right now (empty when actuation is blocked). */
  recoveryTargets: string[]
}

/**
 * Scan the server-owned fleet and classify every agent. READ-ONLY: no actuation, no
 * writes. When the janitor control plane signals a machine-wide STOP, the per-agent
 * classes are still reported (visibility) but `recoveryTargets` is emptied — the halt
 * is deliberate. `scannedAt` MUST be supplied by the caller (this module holds no
 * clock, so it stays pure/deterministic under test).
 */
export async function scanFleetLiveness(deps: FleetScanDeps, scannedAt: number): Promise<FleetLivenessSnapshot> {
  const actuationBlocked = deps.actuationBlocked ?? fleetActuationBlocked
  const stall = deps.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS
  const gate = actuationBlocked()

  const agents: FleetAgentLiveness[] = []
  for (const ref of deps.listAgents()) {
    let status: { hasSession: boolean; exists: boolean; timeSinceActivityMs: number | null }
    try {
      status = await deps.getStatus(ref.id)
    } catch {
      // A status read that fails is not proof of a stall — record offline, never recover.
      agents.push({ agentId: ref.id, name: ref.name, class: 'offline', recoveryRecommended: false, reason: 'status read failed' })
      continue
    }
    const hook = deps.getHookNotification(ref.workingDirectory)
    let accountHealthy: boolean | null = null
    if (deps.getAccountHealthy) {
      try {
        accountHealthy = await deps.getAccountHealthy(ref.id)
      } catch {
        accountHealthy = null // unknown ⇒ assume ok (never invent a token-block)
      }
    }
    const verdict = classifyLiveness(
      {
        hasSession: status.hasSession,
        exists: status.exists,
        notificationType: hook?.notificationType ?? null,
        activityStatus: hook?.status ?? null,
        timeSinceActivityMs: status.timeSinceActivityMs,
        accountHealthy,
        isPersisted: deps.isPersisted?.(ref.id),
      },
      stall,
    )
    agents.push({ agentId: ref.id, name: ref.name, ...verdict })
  }

  const recoveryTargets = gate.blocked ? [] : agents.filter((a) => a.recoveryRecommended).map((a) => a.agentId)

  return {
    scannedAt,
    actuationBlocked: gate.blocked,
    actuationBlockReason: gate.reason,
    agents,
    recoveryTargets,
  }
}
