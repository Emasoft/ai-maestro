/**
 * Cross-Host Governance Service (Layer 3)
 *
 * Orchestrates governance operations that span host boundaries in the mesh network.
 * Local callers submit requests; remote hosts receive, approve, reject, or execute them.
 *
 * Request lifecycle:
 *   submit (local) -> receive (remote) -> approve/reject (either side) -> execute (target)
 *
 * All public functions return ServiceResult<T> for uniform error handling by API routes.
 */

import { ServiceResult } from '@/types/service'
// ServiceResult imported directly from canonical source
import type { GovernanceRequest, GovernanceRequestType, GovernanceRequestStatus, GovernanceRequestPayload, ConfigurationPayload } from '@/types/governance-request'
import type { AgentRole } from '@/types/agent'
import { verifyPassword, isManager, isChiefOfStaffAnywhere, getManagerId } from '@/lib/governance'
import { getAgent } from '@/lib/agent-registry'
import { getHosts, getSelfHostId, isSelf, getHostById } from '@/lib/hosts-config'
import {
  createGovernanceRequest,
  getGovernanceRequest,
  listGovernanceRequests,
  approveGovernanceRequest,
  rejectGovernanceRequest,
  loadGovernanceRequests,
  saveGovernanceRequests,
  markExecutionRefused,
} from '@/lib/governance-request-registry'
import { broadcastGovernanceSync } from '@/lib/governance-sync'
import { signHostAttestation } from '@/lib/host-keys'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { withLock } from '@/lib/file-lock'
import { loadTeams, saveTeams } from '@/lib/team-registry'
import { shouldAutoApprove } from '@/lib/manager-trust'

/** Timeout for outbound HTTP requests to peer hosts (milliseconds) -- matches governance-sync.ts */
const FETCH_TIMEOUT_MS = 5000

/** Log prefix for all cross-host governance operations */
const LOG_PREFIX = '[cross-host-governance]'

/**
 * NT-011: Extracted helper -- sends config request outcome notification with error suppression.
 * Lazy-imports config-notification-service to avoid circular dependency chains.
 */
async function safeNotifyConfigOutcome(request: GovernanceRequest, outcome: 'approved' | 'rejected'): Promise<void> {
  try {
    const { notifyConfigRequestOutcome } = await import('@/services/config-notification-service')
    await notifyConfigRequestOutcome(request, outcome)
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to send config notification:`, err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// 1. submitCrossHostRequest -- local caller initiates a cross-host operation
// ---------------------------------------------------------------------------

export async function submitCrossHostRequest(params: {
  type: GovernanceRequestType
  targetHostId: string
  requestedBy: string
  requestedByRole: AgentRole
  payload: GovernanceRequestPayload
  password?: string
  note?: string
// IBKR7F74 (R32 / RIFM4UXN Option A): `opts.aidVerifiedRequester` is set ONLY by a
// transport handler that verified the caller's AID token — it enables the
// passwordless agent path. It is a SEPARATE argument (not a params field) on
// purpose: the headless router passes the raw request body as `params`, so any
// in-band sentinel (password: null, aidPath: true, …) would be forgeable by a
// caller who simply puts it in the JSON. A second positional argument cannot be
// populated from a body passthrough.
}, opts?: { aidVerifiedRequester?: string }): Promise<ServiceResult<GovernanceRequest>> {
  if (opts?.aidVerifiedRequester !== undefined) {
    // AID path: the transport verified the caller's identity token. The password
    // gate and its brute-force rate limit are password-path concerns and are
    // skipped (there is no password to brute-force). Double-lock: the request
    // must be filed AS the authenticated agent, never as someone else.
    if (params.requestedBy !== opts.aidVerifiedRequester) {
      return { error: 'requestedBy must be the authenticated agent', status: 403 }
    }
  } else {
    // Password path (USER/UI) — unchanged. A missing/null/non-string password
    // fails verifyPassword, so a raw body passthrough can never skip this gate.
    // Rate-limit governance password attempts to prevent brute-force attacks.
    // Per-agent keys so one agent's failures don't lock out all others.
    // Use atomic checkAndRecordAttempt to eliminate TOCTOU window.
    const submitRateLimitKey = `cross-host-gov-submit:${params.requestedBy}`
    const rateCheck = checkAndRecordAttempt(submitRateLimitKey)
    if (!rateCheck.allowed) {
      const retryAfterSeconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return { error: `Too many failed attempts. Try again in ${retryAfterSeconds}s`, status: 429 }
    }

    // Verify governance password -- reset rate limit on success. `?? ''` is the
    // forgery control: a raw body passthrough with a missing/null password lands
    // on this path and fails 401 — it can never reach the AID skip above.
    if (!(await verifyPassword(params.password ?? ''))) {
      return { error: 'Invalid governance password', status: 401 }
    }
    resetRateLimit(submitRateLimitKey)
  }

  // Validate that the requesting agent exists locally
  const agent = getAgent(params.requestedBy)
  if (!agent) {
    return { error: `Agent '${params.requestedBy}' not found in local registry`, status: 404 }
  }

  // Validate that requestedByRole matches the agent's actual role
  if (params.requestedByRole === 'manager' && !isManager(params.requestedBy)) {
    return { error: `Agent '${params.requestedBy}' is not the MANAGER`, status: 403 }
  }
  if (params.requestedByRole === 'chief-of-staff' && !isChiefOfStaffAnywhere(params.requestedBy)) {
    return { error: `Agent '${params.requestedBy}' is not a Chief of Staff`, status: 403 }
  }

  // Validate targetHostId is a known peer host (not self)
  const hosts = getHosts()
  const targetHost = hosts.find(h => h.id === params.targetHostId)
  if (!targetHost) {
    return { error: `Unknown target host '${params.targetHostId}'`, status: 404 }
  }
  if (isSelf(params.targetHostId)) {
    return { error: 'Target host cannot be self -- use local governance APIs for same-host operations', status: 400 }
  }

  // Only allow implemented cross-host request types
  const IMPLEMENTED_TYPES: GovernanceRequestType[] = ['add-to-team', 'remove-from-team', 'assign-cos', 'remove-cos', 'transfer-agent', 'configure-agent']
  if (!IMPLEMENTED_TYPES.includes(params.type)) {
    return { error: `Request type '${params.type}' is not yet implemented`, status: 400 }
  }

  // Validate configure-agent payload has required configuration field
  if (params.type === 'configure-agent') {
    if (!params.payload.configuration) {
      return { error: 'configure-agent requests require a configuration payload', status: 400 }
    }
    if (!params.payload.configuration.operation) {
      return { error: 'configure-agent configuration must specify an operation', status: 400 }
    }
    // Cross-host only supports local scope (user/project scopes are local-only by design)
    if (params.payload.configuration.scope && params.payload.configuration.scope !== 'local') {
      return { error: `Cross-host configure-agent only supports 'local' scope (got '${params.payload.configuration.scope}')`, status: 400 }
    }
  }

  // Create local record with sourceHostId = this host
  const selfHostId = getSelfHostId()
  const request = await createGovernanceRequest({
    type: params.type,
    sourceHostId: selfHostId,
    targetHostId: params.targetHostId,
    requestedBy: params.requestedBy,
    requestedByRole: params.requestedByRole,
    payload: params.payload,
    note: params.note,
  })

  // Fire-and-forget: send the request to the target host
  sendRequestToRemoteHost(targetHost.url, request).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_PREFIX} Failed to send request ${request.id} to ${params.targetHostId}: ${msg}`)
  })

  return { data: request, status: 201 }
}

// ---------------------------------------------------------------------------
// 2. receiveCrossHostRequest -- remote host receives a request from a peer
// ---------------------------------------------------------------------------

export async function receiveCrossHostRequest(
  fromHostId: string,
  request: GovernanceRequest,
): Promise<ServiceResult<{ ok: boolean; requestId: string }>> {
  // Validate fromHostId is a known host
  const hosts = getHosts()
  const senderHost = hosts.find(h => h.id === fromHostId)
  if (!senderHost) {
    return { error: `Unknown sender host '${fromHostId}'`, status: 403 }
  }

  // Validate required request fields
  // Also validate requestedBy -- a missing requestedBy would bypass downstream
  // role checks that depend on knowing who submitted the request
  if (!request.id || !request.type || !request.requestedBy || !request.payload?.agentId) {
    return { error: 'Invalid governance request: missing id, type, requestedBy, or payload.agentId', status: 400 }
  }

  // Validate that request.type is a recognized GovernanceRequestType
  const VALID_REQUEST_TYPES: GovernanceRequestType[] = [
    'add-to-team', 'remove-from-team', 'assign-cos', 'remove-cos',
    'transfer-agent', 'create-agent', 'delete-agent', 'configure-agent',
  ]
  if (!VALID_REQUEST_TYPES.includes(request.type)) {
    return { error: `Invalid governance request type: '${request.type}'`, status: 400 }
  }

  // Validate requestedByRole is a valid AgentRole
  const VALID_ROLES: AgentRole[] = ['manager', 'chief-of-staff', 'architect', 'orchestrator', 'integrator', 'member', 'autonomous']
  if (!request.requestedByRole || !VALID_ROLES.includes(request.requestedByRole)) {
    return { error: `Invalid requestedByRole: '${request.requestedByRole}'`, status: 400 }
  }

  // Validate that the request's sourceHostId matches the actual sender
  if (request.sourceHostId !== fromHostId) {
    return { error: 'Source host ID in request does not match sender', status: 400 }
  }

  // Store locally using the same ID from the remote request
  // Re-create via createGovernanceRequest to get proper file-locking and persistence
  // Note: createGovernanceRequest generates a new UUID; we store the remote request directly instead
  // Track whether the request was newly inserted vs skipped (duplicate).
  // Only run auto-approve logic for genuinely new requests to avoid re-approving duplicates.
  const isNew = await withLock('governance-requests', () => {
    const file = loadGovernanceRequests()

    // Prevent duplicate: skip if a request with this ID already exists
    const existing = file.requests.find(r => r.id === request.id)
    if (existing) {
      console.log(`${LOG_PREFIX} Request ${request.id} already exists locally, skipping duplicate`)
      return false
    }

    // SF-001: Use explicit allowlist instead of spread to prevent untrusted remote fields
    // (e.g. createdAt, rejectReason, undocumented fields) from leaking into the local store.
    // status is always forced to 'pending' and approvals cleared regardless of what remote sent.
    // A malicious peer could send status:'executed' with pre-filled approvals to bypass the
    // dual-approval workflow. We always start received requests as 'pending' with empty approvals.
    const now = new Date().toISOString()
    file.requests.push({
      id: request.id,
      type: request.type,
      sourceHostId: request.sourceHostId,
      targetHostId: request.targetHostId,
      requestedBy: request.requestedBy,
      requestedByRole: request.requestedByRole,
      payload: request.payload,
      ...(request.note ? { note: request.note } : {}),
      approvals: {},
      status: 'pending' as GovernanceRequestStatus,
      createdAt: request.createdAt,
      updatedAt: now,
    })
    saveGovernanceRequests(file)
    return true
  })

  console.log(`${LOG_PREFIX} Received request ${request.id} (type=${request.type}) from host ${fromHostId}`)

  // Layer 4: Auto-approve if the requesting manager is in the trust registry.
  // Only auto-approve genuinely new requests -- skip duplicates to avoid re-execution.
  if (isNew && shouldAutoApprove(request)) {
    console.log(`${LOG_PREFIX} Auto-approving request ${request.id} from trusted manager on host ${fromHostId}`)
    // Auto-approve as targetManager (we are the target host)
    const localManagerId = getManagerId()
    if (localManagerId) {
      const approvedRequest = await approveGovernanceRequest(request.id, localManagerId, 'targetManager')
      if (approvedRequest?.status === 'executed') {
        // TRDD-XTDMQO68: a refused execution is recorded on the request ('rejected' + reason) and is never
        // announced as approved. The 200 below only acknowledges RECEIPT of the request, not its execution.
        const outcome = await performRequestExecution(approvedRequest)
        // Notify the requesting agent of the real outcome of their configure-agent request
        if (approvedRequest.type === 'configure-agent') {
          await safeNotifyConfigOutcome(approvedRequest, outcome.executed ? 'approved' : 'rejected')
        }
      }
    }
  }

  return {
    data: { ok: true, requestId: request.id },
    status: 200,
  }
}

// ---------------------------------------------------------------------------
// 3. approveCrossHostRequest -- approve a pending governance request
// ---------------------------------------------------------------------------

export async function approveCrossHostRequest(
  requestId: string,
  approverAgentId: string,
  /** Governance password, or null when the ROUTE has already authenticated the
   *  caller by AID token as `approverAgentId` (R32 / RIFM4UXN Option A — an
   *  agent never faces a password gate; TRDD-IBKR7F74). null is ROUTE-vouched:
   *  pass it ONLY after verifying the caller's identity token. Handlers that
   *  forward a body field never produce null here (they 400 or pass a string),
   *  so a JSON body cannot select this path on its own. */
  password: string | null,
): Promise<ServiceResult<GovernanceRequest>> {
  if (password !== null) {
    // Rate-limit governance password attempts to prevent brute-force attacks.
    // Per-agent keys so one agent's failures don't lock out all others.
    // Use atomic checkAndRecordAttempt to eliminate TOCTOU window.
    const approveRateLimitKey = `cross-host-gov-approve:${approverAgentId}`
    const rateCheck = checkAndRecordAttempt(approveRateLimitKey)
    if (!rateCheck.allowed) {
      const retryAfterSeconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return { error: `Too many failed attempts. Try again in ${retryAfterSeconds}s`, status: 429 }
    }

    // Verify governance password -- reset rate limit on success
    if (!(await verifyPassword(password))) {
      return { error: 'Invalid governance password', status: 401 }
    }
    resetRateLimit(approveRateLimitKey)
  }

  // Load the request
  const request = getGovernanceRequest(requestId)
  if (!request) {
    return { error: `Governance request '${requestId}' not found`, status: 404 }
  }

  // Self-approval ban, AID path only (K2WJH7RF / the CORE #69 takeover class):
  // an agent must not approve the request it itself filed — that defeats the
  // approval system entirely. The password path stays exempt: the governance
  // password is the human owner's own confirmation, and the human may approve
  // anything (RIFM4UXN Option A symmetry with the COS-assign route).
  if (password === null && request.requestedBy === approverAgentId) {
    return { error: 'An agent cannot approve its own governance request', status: 403 }
  }

  // Determine approverType based on the approver's role and which host they are on
  const selfHostId = getSelfHostId()
  const isOnSourceHost = request.sourceHostId === selfHostId
  const isOnTargetHost = request.targetHostId === selfHostId

  // Reject if this host is neither source nor target of the request
  if (!isOnSourceHost && !isOnTargetHost) {
    return { error: 'This host is neither source nor target of this request', status: 400 }
  }

  let approverType: 'sourceCOS' | 'sourceManager' | 'targetCOS' | 'targetManager'

  if (isManager(approverAgentId)) {
    // Approver is the MANAGER — host role is guaranteed by the guard above
    approverType = isOnSourceHost ? 'sourceManager' : 'targetManager'
  } else if (isChiefOfStaffAnywhere(approverAgentId)) {
    // Approver is a COS — host role is guaranteed by the guard above
    approverType = isOnSourceHost ? 'sourceCOS' : 'targetCOS'
  } else {
    return { error: 'Only MANAGER or Chief of Staff can approve governance requests', status: 403 }
  }

  // Pre-check for terminal state to prevent re-execution of finalized requests
  if (request.status === 'executed' || request.status === 'rejected') {
    return { error: `Request '${requestId}' is already ${request.status}`, status: 409 }
  }

  // Record the approval and update status
  const updated = await approveGovernanceRequest(requestId, approverAgentId, approverType)
  if (!updated) {
    return { error: `Failed to approve request '${requestId}'`, status: 500 }
  }

  // SF-006: Detect TOCTOU race -- only execute if WE were the approver that recorded the vote
  // causing the transition to 'executed'. Checking preApprovalStatus is insufficient: a concurrent
  // approver could have already executed the request inside the lock between our pre-check and the
  // lock-protected approveGovernanceRequest call, making preApprovalStatus stale.
  // Checking our vote was actually recorded (agentId matches) reliably identifies our causal role.
  const weRecordedVote = updated.approvals[approverType]?.agentId === approverAgentId
  const weTriggeredExecution = weRecordedVote && updated.status === 'executed'

  if (weTriggeredExecution) {
    const outcome = await performRequestExecution(updated)

    // Notify the requesting agent of the real outcome of their configure-agent request
    if (updated.type === 'configure-agent') {
      await safeNotifyConfigOutcome(updated, outcome.executed ? 'approved' : 'rejected')
    }

    // TRDD-XTDMQO68: a refused execution must not answer 200 "executed" -- both managers would believe
    // the change happened. 409 follows this function's existing convention for a request that cannot
    // proceed ("already executed"); the reason is the refusal message.
    if (!outcome.executed) {
      return { error: `Request '${requestId}' was approved but its execution was refused: ${outcome.reason}`, status: 409 }
    }
  }

  return { data: updated, status: 200 }
}

// ---------------------------------------------------------------------------
// 4. rejectCrossHostRequest -- reject a pending governance request
// ---------------------------------------------------------------------------

export async function rejectCrossHostRequest(
  requestId: string,
  rejectorAgentId: string,
  /** Governance password, or null when the ROUTE has already authenticated the
   *  caller by AID token as `rejectorAgentId` (same contract as approve —
   *  TRDD-IBKR7F74). Unlike approve there is NO self-ban here: a titled agent
   *  rejecting its own request is a WITHDRAWAL, which is legitimate. */
  password: string | null,
  reason?: string,
): Promise<ServiceResult<GovernanceRequest>> {
  if (password !== null) {
    // Rate-limit governance password attempts to prevent brute-force attacks.
    // Per-agent keys so one agent's failures don't lock out all others.
    // Use atomic checkAndRecordAttempt to eliminate TOCTOU window.
    const rejectRateLimitKey = `cross-host-gov-reject:${rejectorAgentId}`
    const rateCheck = checkAndRecordAttempt(rejectRateLimitKey)
    if (!rateCheck.allowed) {
      const retryAfterSeconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return { error: `Too many failed attempts. Try again in ${retryAfterSeconds}s`, status: 429 }
    }

    // Verify governance password -- reset rate limit on success
    if (!(await verifyPassword(password))) {
      return { error: 'Invalid governance password', status: 401 }
    }
    resetRateLimit(rejectRateLimitKey)
  }

  // Validate rejector is MANAGER or COS
  if (!isManager(rejectorAgentId) && !isChiefOfStaffAnywhere(rejectorAgentId)) {
    return { error: 'Only MANAGER or Chief of Staff can reject governance requests', status: 403 }
  }

  // Load the request to check if it originated from another host
  const request = getGovernanceRequest(requestId)
  if (!request) {
    return { error: `Governance request '${requestId}' not found`, status: 404 }
  }

  // Record the rejection
  const updated = await rejectGovernanceRequest(requestId, rejectorAgentId, reason)
  if (!updated) {
    return { error: `Failed to reject request '${requestId}'`, status: 500 }
  }

  // Notify the requesting agent that their configure-agent request was rejected
  if (updated.type === 'configure-agent') {
    await safeNotifyConfigOutcome(updated, 'rejected')
  }

  // If the request originated from another host, notify the source host (fire-and-forget)
  const selfHostId = getSelfHostId()
  if (request.sourceHostId !== selfHostId) {
    const sourceHost = getHostById(request.sourceHostId)
    if (sourceHost) {
      notifyRemoteHostOfRejection(sourceHost.url, requestId, rejectorAgentId, reason).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`${LOG_PREFIX} Failed to notify source host ${request.sourceHostId} of rejection: ${msg}`)
      })
    }
  }

  return { data: updated, status: 200 }
}

// ---------------------------------------------------------------------------
// 5. performRequestExecution -- execute the actual team/agent mutation
// ---------------------------------------------------------------------------

// TRDD-XTDMQO68 (R50/R51): a refusal must never read as success. The request is already 'executed'
// (approveGovernanceRequest sets it BEFORE this runs), so every refusal or failure here is REPORTED to the
// caller as { executed: false, reason } AND the request is turned into 'rejected' with that reason via
// markExecutionRefused. Before this, each refusal was `console.error(...); return` inside the lock callback,
// so the request stayed 'executed' and the caller answered 200 "Successfully executed" with nothing written.
type ExecutionOutcome = { executed: true } | { executed: false; reason: string }

// Records a refusal on the stored request and NEVER throws. Why it must not throw: the requester has to
// get the 409 for the ORIGINAL refusal. A throw here (lock timeout, write failure) used to land in
// performRequestExecution's catch, which re-recorded with the recording error as the reason (hiding the
// original one) and could throw out of the function. A failed or no-op record (null: unknown id or not
// 'executed') is logged and the request may stay 'executed' on disk -- that is reported, never silent.
async function recordExecutionRefusal(requestId: string, reason: string): Promise<boolean> {
  try {
    const marked = await markExecutionRefused(requestId, reason)
    if (!marked) {
      console.error(`${LOG_PREFIX} Could not record execution refusal for request ${requestId}: request not found or not in 'executed' status (refusal: ${reason})`)
    }
    return !!marked
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_PREFIX} Failed to record execution refusal for request ${requestId}: ${msg} (refusal: ${reason})`)
    return false
  }
}

// Appended to the refusal reason the requester receives when the refusal could not be recorded: the stored
// request may still read 'executed' although nothing was written, and the requester must not be left to
// assume the record agrees with the 409.
const REFUSAL_NOT_RECORDED_NOTE = '; the stored request could not be updated and may still read executed'

// TRDD-XTDMQO68: when the execution of a request that came from ANOTHER host is refused here, tell that host.
// Why: the request is rejected locally (markExecutionRefused) but the source host's copy stayed 'pending'
// until TTL, so its manager kept believing the change was in flight. Same fire-and-forget contract as
// rejectCrossHostRequest: a notification failure is logged (no token/secret is ever in the message) and never
// changes the outcome returned to the caller. A same-host request has nobody to tell.
// Rejector id: this host is the target, so the agent whose approval triggered the refused execution is the
// local target-side approver recorded on the request (targetManager, else targetCOS). The remote route requires
// a UUID rejectorAgentId and only stores it with the reason; no local approver recorded = nothing honest to
// send, so that case is logged and skipped rather than invented.
function notifySourceOfExecutionRefusal(request: GovernanceRequest, reason: string): void {
  try {
    if (request.sourceHostId === getSelfHostId()) return
    const sourceHost = getHostById(request.sourceHostId)
    if (!sourceHost) return
    const approverId = request.approvals.targetManager?.agentId ?? request.approvals.targetCOS?.agentId
    if (!approverId) {
      console.error(`${LOG_PREFIX} Not notifying source host ${request.sourceHostId} of refused execution of ${request.id}: no local approver recorded`)
      return
    }
    notifyRemoteHostOfRejection(sourceHost.url, request.id, approverId, `Execution refused: ${reason}`).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${LOG_PREFIX} Failed to notify source host ${request.sourceHostId} of refused execution: ${msg}`)
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_PREFIX} Failed to notify source host ${request.sourceHostId} of refused execution: ${msg}`)
  }
}

// TRDD-XTDMQO68: refusal reason when seating `agentId` in a team would break a membership rule, else null.
// Why: this path writes through loadTeams/saveTeams, which validate nothing, and it runs inside the
// non-reentrant 'teams' lock so it cannot call updateTeam (TRDD-A50RC5G8). team.agentIds is read as authority
// (chief-of-staff grants, portfolio-token mint), so an approved request must not seat (1) an id no live agent
// holds -- getAgent excludes soft-deleted -- nor (2) a second membership: R4.1, one team per agent, MANAGER
// exempt, as validateTeamMutation does. `leavingTeamId` is the transfer source: the agent is leaving it.
function membershipRefusal(type: string, agentId: string, teams: ReturnType<typeof loadTeams>, landingTeamId: string, leavingTeamId?: string, alreadyInLanding = false): string | null {
  if (!getAgent(agentId)) {
    return `Cannot execute ${type}: agent '${agentId}' is not a live agent`
  }
  // Liveness above is unconditional; the one-team half is skipped when the landing team already lists the agent.
  if (alreadyInLanding || agentId === getManagerId()) return null
  // Same three-condition membership test as getTeamsForAgent: a chair or orchestrator not listed in agentIds is still a member.
  const other = teams.find(t => t.id !== landingTeamId && t.id !== leavingTeamId &&
    (t.agentIds.includes(agentId) || t.chiefOfStaffId === agentId || t.orchestratorId === agentId))
  if (other) {
    return `Cannot execute ${type}: agent '${agentId}' is already in team '${other.id}'; remove it from that team first`
  }
  return null
}

async function performRequestExecution(request: GovernanceRequest): Promise<ExecutionOutcome> {
  console.log(`${LOG_PREFIX} Executing request ${request.id} (type=${request.type})`)

  // Logs the refusal (same message as before) and reports it instead of returning silently.
  const refuse = (reason: string): ExecutionOutcome => {
    console.error(`${LOG_PREFIX} ${reason}`)
    return { executed: false, reason }
  }

  try {
    // Acquire the teams lock for the entire mutation to prevent concurrent corruption
    const outcome = await withLock('teams', async (): Promise<ExecutionOutcome> => {
      switch (request.type) {
        case 'add-to-team': {
          // Add the agent to the target team
          const teams = loadTeams()
          const team = teams.find(t => t.id === request.payload.teamId)
          if (!team) {
            return refuse(`Cannot execute add-to-team: team '${request.payload.teamId}' not found`)
          }
          if (!team.agentIds.includes(request.payload.agentId)) {
            const membershipError = membershipRefusal('add-to-team', request.payload.agentId, teams, team.id)
            if (membershipError) return refuse(membershipError)
            team.agentIds.push(request.payload.agentId)
          }
          // All teams are closed (governance simplification) — no open team membership revocation needed
          saveTeams(teams)
          return { executed: true }
        }

        case 'remove-from-team': {
          // Remove the agent from the target team
          const teams = loadTeams()
          const team = teams.find(t => t.id === request.payload.teamId)
          if (!team) {
            return refuse(`Cannot execute remove-from-team: team '${request.payload.teamId}' not found`)
          }
          // SF-005: Guard against removing the team's COS -- doing so would leave
          // chiefOfStaffId pointing at a non-member, creating an invalid team state.
          if (team.chiefOfStaffId === request.payload.agentId) {
            return refuse(`Cannot execute remove-from-team: agent '${request.payload.agentId}' is the team COS; unassign COS first`)
          }
          team.agentIds = team.agentIds.filter(id => id !== request.payload.agentId)
          saveTeams(teams)
          return { executed: true }
        }

        case 'assign-cos': {
          // Set the chiefOfStaffId on the target team
          const teams = loadTeams()
          const team = teams.find(t => t.id === request.payload.teamId)
          if (!team) {
            return refuse(`Cannot execute assign-cos: team '${request.payload.teamId}' not found`)
          }
          // R1.8: COS can only be assigned to closed teams
          if (team.type !== 'closed') {
            return refuse(`Cannot assign COS: team '${team.id}' is not a closed team (type=${team.type})`)
          }
          // G3 (v2 Rule 7): An agent can only be COS of one team at a time
          const alreadyCos = teams.find(t => t.id !== team.id && t.chiefOfStaffId === request.payload.agentId)
          if (alreadyCos) {
            return refuse(`Cannot assign COS: agent '${request.payload.agentId}' is already COS of team '${alreadyCos.id}'`)
          }
          // TRDD-A50RC5G8: team.chiefOfStaffId is the trust anchor of every chief-of-staff grant, so the
          // chair must be a live agent (getAgent excludes soft-deleted) and never the MANAGER. This path
          // cannot call updateTeam (it already holds the non-reentrant 'teams' lock), so it repeats
          // the checks lib/team-registry.ts applies to createTeam/updateTeam.
          if (request.payload.agentId === getManagerId()) {
            return refuse(`Cannot assign COS: agent '${request.payload.agentId}' is the MANAGER`)
          }
          if (!getAgent(request.payload.agentId)) {
            return refuse(`Cannot assign COS: agent '${request.payload.agentId}' is not a live agent`)
          }
          team.chiefOfStaffId = request.payload.agentId
          // Ensure the COS is also in agentIds (R4.6: COS must be a member)
          if (!team.agentIds.includes(request.payload.agentId)) {
            team.agentIds.push(request.payload.agentId)
          }
          saveTeams(teams)
          return { executed: true }
        }

        case 'remove-cos': {
          // Clear the chiefOfStaffId on the target team
          const teams = loadTeams()
          const team = teams.find(t => t.id === request.payload.teamId)
          if (!team) {
            return refuse(`Cannot execute remove-cos: team '${request.payload.teamId}' not found`)
          }
          team.chiefOfStaffId = null
          saveTeams(teams)
          return { executed: true }
        }

        case 'transfer-agent': {
          // Move agent between teams: remove from source, add to destination
          const teams = loadTeams()
          const fromTeam = request.payload.fromTeamId ? teams.find(t => t.id === request.payload.fromTeamId) : null
          const toTeam = request.payload.toTeamId ? teams.find(t => t.id === request.payload.toTeamId) : null

          // TRDD-XTDMQO68: without a destination the agent would be removed from the source and added
          // nowhere. A missing source team is a legitimate no-op ONLY on a cross-host transfer (the source
          // team may live on the peer host). When sourceHostId === targetHostId both teams are on this host,
          // so a given-but-unknown fromTeamId is a typo: proceeding would leave the agent in its real team
          // AND add it to the destination, breaking single-team membership past validateTeamMutation.
          if (request.payload.fromTeamId && !fromTeam && request.sourceHostId === request.targetHostId) {
            return refuse(`Cannot execute transfer-agent: source team '${request.payload.fromTeamId}' not found`)
          }
          if (!request.payload.toTeamId) {
            return refuse(`Cannot execute transfer-agent: no destination team (toTeamId) in the request`)
          }
          if (!toTeam) {
            return refuse(`Cannot execute transfer-agent: destination team '${request.payload.toTeamId}' not found`)
          }
          // Checked before ANY mutation: refusing after the source removal would leave the agent in no team.
          const membershipError = membershipRefusal('transfer-agent', request.payload.agentId, teams, toTeam.id, fromTeam?.id, toTeam.agentIds.includes(request.payload.agentId))
          if (membershipError) return refuse(membershipError)
          if (fromTeam) {
            fromTeam.agentIds = fromTeam.agentIds.filter(id => id !== request.payload.agentId)
          }
          if (!toTeam.agentIds.includes(request.payload.agentId)) {
            toTeam.agentIds.push(request.payload.agentId)
          }
          saveTeams(teams)
          return { executed: true }
        }

        case 'configure-agent': {
          // Deploy configuration to the target agent
          const config = request.payload.configuration
          if (!config) {
            return refuse(`configure-agent request ${request.id} missing configuration payload`)
          }
          // Lazy import: agents-config-deploy-service imports getAgent which imports governance,
          // creating a potential circular dependency chain. Keep lazy to be safe.
          const { deployConfigToAgent } = await import('@/services/agents-config-deploy-service')
          const deployResult = await deployConfigToAgent(request.payload.agentId, config, request.requestedBy)
          if (deployResult.error) {
            return refuse(`configure-agent execution failed for request ${request.id}: ${deployResult.error}`)
          }
          console.log(`${LOG_PREFIX} configure-agent executed for agent ${request.payload.agentId}: ${config.operation}`)
          return { executed: true }
        }

        case 'delete-agent': {
          // Execute agent deletion via the all-in-one pipeline.
          // COS requested it, MANAGER approved → DeleteAgent runs as system-owner.
          const { DeleteAgent } = await import('@/services/element-management-service')
          const deleteResult = await DeleteAgent(request.payload.agentId, {
            authContext: { isSystemOwner: true }, // Approved by MANAGER → system-level execution
          })
          if (!deleteResult.success) {
            return refuse(`delete-agent execution failed for request ${request.id}: ${deleteResult.error}`)
          }
          console.log(`${LOG_PREFIX} delete-agent executed for agent ${request.payload.agentId}`)
          return { executed: true }
        }

        default:
          return refuse(`Request type '${request.type}' execution is not yet implemented`)
      }
    })

    if (!outcome.executed) {
      // The 'teams' lock is released here, so taking 'governance-requests' respects the lock order.
      const recorded = await recordExecutionRefusal(request.id, outcome.reason)
      notifySourceOfExecutionRefusal(request, outcome.reason)
      return recorded ? outcome : { executed: false, reason: outcome.reason + REFUSAL_NOT_RECORDED_NOTE }
    }

    // Broadcast the governance state change to all peers (only for an operation that really happened)
    broadcastGovernanceSync('team-updated', { requestId: request.id, type: request.type }).catch(() => {})

    console.log(`${LOG_PREFIX} Successfully executed request ${request.id} (type=${request.type})`)
    return outcome
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_PREFIX} Failed to execute request ${request.id}: ${msg}`)
    // A throw is a failed execution just like a refusal: same terminal status, same reported outcome.
    const recorded = await recordExecutionRefusal(request.id, msg)
    // The peer gets a FIXED reason, never msg: a raw exception message can carry a local file path or other
    // host-private detail, and this text leaves the host. The local log above and the locally recorded reason keep msg.
    notifySourceOfExecutionRefusal(request, 'execution failed on the target host')
    return { executed: false, reason: recorded ? msg : msg + REFUSAL_NOT_RECORDED_NOTE }
  }
}

// ---------------------------------------------------------------------------
// 6. listCrossHostRequests -- query stored governance requests with filters
// ---------------------------------------------------------------------------

export function listCrossHostRequests(filter?: {
  status?: GovernanceRequestStatus
  type?: GovernanceRequestType
  hostId?: string
  agentId?: string
}): ServiceResult<GovernanceRequest[]> {
  const requests = listGovernanceRequests(filter)
  return { data: requests, status: 200 }
}

// ---------------------------------------------------------------------------
// Internal helpers -- fire-and-forget HTTP to peer hosts
// ---------------------------------------------------------------------------

/**
 * Send a governance request to a remote host for processing.
 * Uses the same 5-second timeout pattern as governance-sync.ts.
 */
async function sendRequestToRemoteHost(hostUrl: string, request: GovernanceRequest): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const url = `${hostUrl}/api/v1/governance/requests`
    // Sign the outbound request with this host's Ed25519 key (SR-001)
    const timestamp = new Date().toISOString()
    const signedData = `gov-request|${request.sourceHostId}|${timestamp}`
    const signature = signHostAttestation(signedData)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Host-Id': request.sourceHostId,
        'X-Host-Timestamp': timestamp,
        'X-Host-Signature': signature,
      },
      body: JSON.stringify({
        fromHostId: request.sourceHostId,
        request,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error(`${LOG_PREFIX} Remote host returned HTTP ${response.status} for request ${request.id}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Notify a remote host that a governance request was rejected.
 * Fire-and-forget: logs errors but never throws to callers.
 */
async function notifyRemoteHostOfRejection(
  hostUrl: string,
  requestId: string,
  rejectorAgentId: string,
  reason?: string,
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const url = `${hostUrl}/api/v1/governance/requests/${requestId}/reject`
    // Sign the outbound rejection notification with this host's Ed25519 key (SR-001)
    const selfHost = getSelfHostId()
    const timestamp = new Date().toISOString()
    const signedData = `gov-request|${selfHost}|${timestamp}`
    const signature = signHostAttestation(signedData)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Host-Id': selfHost,
        'X-Host-Timestamp': timestamp,
        'X-Host-Signature': signature,
      },
      body: JSON.stringify({
        rejectorAgentId,
        reason,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error(`${LOG_PREFIX} Remote host returned HTTP ${response.status} for rejection notification of ${requestId}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// 7. receiveRemoteRejection -- handle rejection notifications from peer hosts
//    (SR-P4-001: separate path that uses host-signature auth instead of password)
// ---------------------------------------------------------------------------

/**
 * Process a rejection notification from a remote host.
 * Called after route-level host-signature verification succeeds.
 * Does NOT require governance password (the sending host already verified authority).
 */
export async function receiveRemoteRejection(
  requestId: string,
  fromHostId: string,
  rejectorAgentId: string,
  reason?: string,
): Promise<ServiceResult<GovernanceRequest>> {
  // Load the request to validate it exists and came from the notifying host
  const request = getGovernanceRequest(requestId)
  if (!request) {
    return { error: `Governance request '${requestId}' not found`, status: 404 }
  }

  // Verify the rejection notification comes from a host involved in this request
  if (request.sourceHostId !== fromHostId && request.targetHostId !== fromHostId) {
    return { error: 'Rejecting host is neither source nor target of this request', status: 403 }
  }

  // Record the rejection
  const updated = await rejectGovernanceRequest(requestId, rejectorAgentId, reason)
  if (!updated) {
    return { error: `Failed to reject request '${requestId}'`, status: 500 }
  }

  return { data: updated, status: 200 }
}
