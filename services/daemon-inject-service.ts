// The daemon injection service — ONE implementation, two thin routes (TRDD-APN5WB2L, #60).
//
// ── WHY A SERVICE AND NOT TWO ROUTE HANDLERS ─────────────────────────────────────────────────────
// This repo's own R10.6 parity test exists because a gate was duplicated into a Next route and two
// headless handlers, and one of them drifted — full mode 403'd a restart that headless allowed for
// weeks. A security-bearing decision duplicated across modes WILL drift, so the verification and
// the dispatch live here, once, and both routes are argument-passing shells over it.
//
// ── WHY THE DAEMON'S AUTHORITY IS MINTED HERE AND NOT INHERITED ──────────────────────────────────
// A verified daemon request is executed with `isSystemOwner: true` — but ONLY for the one call
// this function makes, and only after `verifyDaemonRequest` proved the signature, freshness, nonce
// and that the verb is inside the two-verb grant. The daemon never holds an owner credential, and
// there is no path from this module to any other operation: the switch below is exhaustive over
// DAEMON_VERBS, so a third verb cannot be reached even if one is added to the type without being
// handled here (it falls to the default and is refused).

import { getAgent } from '@/lib/agent-registry'
import { computeSessionName } from '@/types/agent'
import { verifyDaemonRequest, saveDaemonEnrollment, loadDaemonEnrollment, type DaemonEnrollment } from '@/lib/daemon-principal'
import { sendCommand, interruptSession } from '@/services/sessions-service'
import { ServiceResult } from '@/types/service'
import type { AuthContext } from '@/lib/agent-auth'

/** The context a VERIFIED daemon request executes under. Minted per call; never persisted, never
 *  handed back to the caller, and never reachable without a passing signature check. */
const DAEMON_EXECUTION_CONTEXT: AuthContext = { isSystemOwner: true, agentId: undefined }

/**
 * Enroll the daemon's public key. THE CALLER MUST HAVE PROVEN OWNER AUTHORITY — the route does
 * that with the sudo gate (strict classification), and this function refuses anything that does
 * not arrive with an owner context, so neither layer alone is load-bearing.
 *
 * Re-enrollment is ALLOWED and is the key-rotation path (the daemon regenerates and re-enrolls);
 * it is safe precisely because it is owner-gated. What is NOT allowed is the daemon enrolling
 * itself — nothing in this module can be reached with a daemon signature.
 */
export async function enrollDaemonPrincipal(
  body: unknown,
  authContext: AuthContext | null,
): Promise<ServiceResult<{ success: boolean; fingerprintPrefix?: string; replaced?: boolean }>> {
  if (!authContext?.isSystemOwner) {
    return { error: 'Daemon enrollment requires the system owner', status: 403, data: undefined }
  }
  const b = body as { publicKeyHex?: unknown; label?: unknown } | null
  if (typeof b?.publicKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(b.publicKeyHex)) {
    // The length check is not cosmetic: `verifySignature` reconstructs an SPKI DER from exactly 32
    // bytes, so a wrong-length key would fail verification later with a confusing message instead
    // of being refused here where the operator can see it.
    return { error: 'publicKeyHex must be 64 hex characters (an Ed25519 public key)', status: 400, data: undefined }
  }
  const previous = loadDaemonEnrollment()
  const enrollment: DaemonEnrollment = {
    publicKeyHex: b.publicKeyHex.toLowerCase(),
    enrolledAt: new Date().toISOString(),
    label: typeof b.label === 'string' ? b.label.slice(0, 200) : undefined,
  }
  saveDaemonEnrollment(enrollment)
  return {
    // A prefix, never the whole key in a response body: enough for an operator to confirm WHICH
    // key is enrolled, nothing extra echoed into logs.
    data: { success: true, fingerprintPrefix: enrollment.publicKeyHex.slice(0, 16), replaced: !!previous },
    status: 200,
  }
}

/**
 * Execute one signed daemon request.
 *
 * The refusal statuses are deliberately distinguished: 401 for "this is not the enrolled daemon"
 * (not_enrolled / bad_signature), 400 for a malformed body, 403 for a verb outside the grant, 409
 * for freshness/replay. A caller that only ever sees 403 cannot tell a clock-skew problem from an
 * attempted replay from an ungranted verb, and the janitor's recovery loop needs to.
 */
export async function daemonInject(
  body: unknown,
  nowS?: number,
): Promise<ServiceResult<Record<string, unknown>>> {
  const verdict = verifyDaemonRequest(body, nowS)
  if (!verdict.ok) {
    const status =
      verdict.reason === 'malformed_request'
        ? 400
        : verdict.reason === 'unknown_verb'
          ? 403
          : verdict.reason === 'stale_request' || verdict.reason === 'replayed_nonce'
            ? 409
            : 401
    return { error: `${verdict.reason}: ${verdict.message}`, status, data: undefined }
  }

  // Target by agent UUID; the SERVER derives the pane. A caller-supplied session name would be
  // rename-unstable — after a rename it aims the recovery at whatever now owns the old name.
  const agent = getAgent(verdict.target!)
  if (!agent) {
    return { error: 'Agent not found', status: 404, data: undefined }
  }
  const sessionName = computeSessionName(agent.name || 'unknown', 0)

  const req = body as { payload?: string }
  switch (verdict.verb) {
    case 'submit-recovery-prompt': {
      const payload = typeof req.payload === 'string' ? req.payload : ''
      if (!payload) {
        return { error: 'submit-recovery-prompt requires a non-empty payload', status: 400, data: undefined }
      }
      // requireIdle:false is the whole point — a FROZEN agent is by definition not idle, so the
      // default would refuse every recovery exactly when it is needed (#110's trap).
      const r = await sendCommand(sessionName, payload, {
        requireIdle: false,
        addNewline: true,
        authContext: DAEMON_EXECUTION_CONTEXT,
      })
      return { data: r.data as Record<string, unknown>, error: r.error, status: r.status }
    }
    case 'interrupt': {
      const r = await interruptSession(sessionName, { authContext: DAEMON_EXECUTION_CONTEXT })
      return { data: r.data as Record<string, unknown>, error: r.error, status: r.status }
    }
    default:
      // Unreachable while the switch covers DAEMON_VERBS — kept as a REFUSAL rather than a
      // fall-through, so that a verb added to the type but not handled here is denied instead of
      // silently doing nothing and reporting success.
      return { error: 'Verb is not implemented', status: 403, data: undefined }
  }
}
