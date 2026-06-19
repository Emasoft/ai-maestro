/**
 * Agent Authentication for Internal APIs
 *
 * Bridges AMP API key auth, AID governance tokens, and browser session cookies
 * to governance-restricted internal API calls.
 *
 * Four outcomes:
 * 1. Valid session cookie (aim_session) → system owner (web UI) → { agentId: undefined }
 * 2. Bearer aim_tk_* → AID governance token → { agentId, governanceTitle, teamId }
 * 3. Bearer amp_live_sk_* → legacy AMP API key → { agentId }
 * 4. No valid credentials → { error, status: 401 }
 *
 * SF-058 CLOSED: No auth headers AND no session cookie → rejected.
 * The web UI user must log in with governance password to get the session cookie.
 * Agents use Bearer tokens. There is no "free" system-owner access anymore.
 */
import { authenticateRequest } from './amp-auth'
import { validateGovernanceToken } from './aid-token'
import { extractSessionFromCookie, validateSessionWithUser } from './session-auth'
import { isSessionSecret, validateSessionSecret } from './session-secret'
import { verifyCompactIbct } from './ibct'
import { loadSecurityConfig } from './security-config'
import { isAidAssociated } from './aid-ledger-authority'
import { getAgent as getAgentRecord } from './agent-registry'
import type { UserTitle } from '@/types/user'

export interface AgentAuthResult {
  /** Verified agent ID, or undefined for system owner / web UI */
  agentId?: string
  /** Governance title — from AID token (embedded) or registry (session secret / AMP key) */
  governanceTitle?: string
  /** Team ID — from AID token (embedded) or registry (session secret / AMP key). null = no team. */
  teamId?: string | null
  /**
   * R36/R37 — verified human-USER id. Present for a web session (the active
   * MAESTRO under the single-operator model) and for a user-AID Bearer token.
   * A user has NO agentId; a request is never both an agent and a user.
   */
  userId?: string
  /** R36/R37 — the user's authority title (when userId is set). */
  userTitle?: UserTitle
  /** IBCT scope claims — present only for AIP token auth. Downstream must check scope.includes(required). */
  ibctScope?: string[]
  /** IBCT max delegation depth — present only for AIP token auth. */
  ibctMaxDepth?: number
  /** Error message if authentication failed */
  error?: string
  /** HTTP status code for the error */
  status?: number
}

/**
 * Authenticate a caller from HTTP header values.
 *
 * @param authHeader - Value of Authorization header (or null)
 * @param agentIdHeader - Value of X-Agent-Id header (or null)
 * @param cookieHeader - Value of Cookie header (or null) — for browser session auth
 * @returns AgentAuthResult with agentId for success, error for failure, or empty for system owner
 */
export function authenticateAgent(
  authHeader: string | null,
  agentIdHeader: string | null,
  cookieHeader?: string | null
): AgentAuthResult {
  // Case 1: No Bearer token — check for browser session cookie
  if (authHeader === null && agentIdHeader === null) {
    // BYPASS-2 CLOSED (SEC-PHASE-6): the previous behavior here returned
    // open access whenever no governance password was configured. That
    // backdoor is gone — first-run callers MUST go through the OS-
    // notification setup flow at POST /api/auth/setup-init followed by
    // POST /api/auth/setup-verify. The middleware whitelists those two
    // endpoints (plus /api/v1/health and /api/v1/info) so the unbootstrapped
    // browser can reach them.
    const sessionToken = extractSessionFromCookie(cookieHeader ?? null)
    if (sessionToken) {
      // R36/R37 — resolve the web session to a user when the user-authority
      // model is on. validateSessionWithUser returns userId only when the model
      // is enabled (the logged-in web session = the active MAESTRO); with the
      // model OFF it returns { valid } with no userId, so the result below is
      // `{}` — byte-identical to the legacy "valid session → system owner".
      const sess = validateSessionWithUser(sessionToken)
      if (sess.valid) {
        if (sess.userId) {
          const userTitle = resolveUserTitle(sess.userId)
          return { userId: sess.userId, userTitle }
        }
        // Valid session cookie, model OFF → legacy system owner (web UI user)
        return {}
      }
    }

    // Distinguish "first run, please bootstrap" from "ordinary unauth"
    // so the browser can steer the user to the right screen.
    try {
      const { loadGovernance } = require('./governance')
      if (!loadGovernance().passwordHash) {
        return {
          error: 'first_run_required: Governance password is not configured. Call POST /api/auth/setup-init to begin the OS-notification verified bootstrap.',
          status: 401,
        }
      }
    } catch { /* governance module not available — fall through to ordinary unauth */ }

    return {
      error: 'Authentication required. Log in at /api/auth/login or provide a Bearer token.',
      status: 401
    }
  }

  // Case 2: X-Agent-Id present without Authorization → reject (identity spoofing)
  if (agentIdHeader && !authHeader) {
    return {
      error: 'Agent identity requires authentication. Include Authorization: Bearer <api-key> header.',
      status: 401
    }
  }

  // Case 3: Authorization header present → validate token
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader

    // Case 3a: AID governance token (aim_tk_*) — includes title + team
    if (token.startsWith('aim_tk_')) {
      const aidRecord = validateGovernanceToken(token)
      if (!aidRecord) {
        return {
          error: 'Invalid or expired governance token',
          status: 401
        }
      }

      // Case 3a-user (R36.1): a human-USER AID token. There is NO agent behind
      // it — agent_id carries the USER id, user_title the authority title.
      if (aidRecord.subject_type === 'user') {
        const userId = aidRecord.agent_id
        // R35/R40 foreign-user approval gate: refuse an UNAPPROVED foreign user
        // (native===false && no approvedByMaestroAt). Mirrors the foreign-agent
        // approval. A native user, or an approved foreign user, passes.
        try {
          const { getUser } = require('./user-registry') as typeof import('./user-registry')
          const userRec = getUser(userId)
          if (userRec && userRec.native === false && !userRec.approvedByMaestroAt) {
            return {
              error: 'Foreign user not approved by this host\'s MAESTRO (R35/R40)',
              status: 403,
            }
          }
        } catch (err) {
          // Fail closed: if we cannot verify the user record, refuse the token.
          console.warn('[agent-auth] user-AID approval check failed, denying:', err)
          return { error: 'User identity could not be verified', status: 401 }
        }
        return {
          userId,
          userTitle: (aidRecord.user_title ?? 'user') as UserTitle,
        }
      }

      // If X-Agent-Id is also present, it must match
      if (agentIdHeader && agentIdHeader !== aidRecord.agent_id) {
        return {
          error: 'X-Agent-Id does not match authenticated agent identity',
          status: 403
        }
      }

      // R34.1 SPEND gate (no-op when enforceAidAssociation is OFF — default).
      if (!assertAidLedgerBacked(aidRecord.agent_id)) {
        return {
          error: 'aid_no_ledger_history: AID has no signed-ledger association on this host (R34.1)',
          status: 403,
        }
      }

      return {
        agentId: aidRecord.agent_id,
        governanceTitle: aidRecord.governance_title,
        teamId: aidRecord.team_id
      }
    }

    // Case 3b: Server-issued session secret (mst_*) — local agents only
    // The server generated this at session launch and set it as a tmux env var.
    // Title + team are looked up from current registry state (always fresh).
    if (isSessionSecret(token)) {
      const agentRecord = findAgentBySessionSecret(token)
      if (!agentRecord) {
        return {
          error: 'Invalid or expired session secret',
          status: 401
        }
      }

      if (agentIdHeader && agentIdHeader !== agentRecord.id) {
        return {
          error: 'X-Agent-Id does not match authenticated agent identity',
          status: 403
        }
      }

      // R34.1 SPEND gate (no-op when enforceAidAssociation is OFF — default).
      if (!assertAidLedgerBacked(agentRecord.id)) {
        return {
          error: 'aid_no_ledger_history: AID has no signed-ledger association on this host (R34.1)',
          status: 403,
        }
      }

      // Look up current governance context from registry (always fresh — no stale token)
      const govContext = resolveGovernanceContext(agentRecord.id)
      return {
        agentId: agentRecord.id,
        governanceTitle: govContext.title,
        teamId: govContext.teamId
      }
    }

    // Case 3c: Legacy AMP API key (amp_live_sk_* or amp_test_sk_*)
    const result = authenticateRequest(authHeader)

    if (!result.authenticated || !result.agentId) {
      return {
        error: result.message || 'Invalid or expired API key',
        status: 401
      }
    }

    // If X-Agent-Id is also present, it must match the authenticated agent
    if (agentIdHeader && agentIdHeader !== result.agentId) {
      return {
        error: 'X-Agent-Id does not match authenticated agent identity',
        status: 403
      }
    }

    return { agentId: result.agentId }
  }

  // Unreachable: all cases handled above. Throw to catch logic bugs instead of silently granting access.
  throw new Error('Unreachable: authenticateAgent logic error')
}

/**
 * Convenience: authenticate from a Request/NextRequest object.
 * Extracts Authorization, X-Agent-Id, and Cookie headers automatically.
 * Use this in API routes to avoid repeating the 3-header extraction pattern.
 */
export function authenticateFromRequest(request: { headers: { get(name: string): string | null } }): AgentAuthResult {
  return authenticateAgent(
    request.headers.get('Authorization'),
    request.headers.get('X-Agent-Id'),
    request.headers.get('Cookie')
  )
}

/**
 * Async variant that additionally supports AIP compact IBCT tokens (JWT/EdDSA).
 * Falls back to the sync authenticateAgent for all non-IBCT token types.
 *
 * IBCT tokens are detected by their JWT structure: base64url header starting
 * with 'eyJ'. The jose library verifies the Ed25519 signature and extracts
 * scope claims. The `sub` claim maps to agentId; governance title and team
 * are resolved from the scope array (not embedded in the JWT to avoid stale
 * claims — the scope is the source of truth for what the token allows).
 */
export async function authenticateFromRequestAsync(
  request: { headers: { get(name: string): string | null } }
): Promise<AgentAuthResult> {
  const authHeader = request.headers.get('Authorization')

  if (authHeader) {
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader

    if (token.startsWith('eyJ')) {
      try {
        const claims = await verifyCompactIbct(token)

        if (!claims.iss.startsWith('aip:key:ed25519:')) {
          return { error: 'IBCT issuer not recognized', status: 401 }
        }

        const agentId = claims.sub.startsWith('aip:key:ed25519:')
          ? claims.sub.slice('aip:key:ed25519:'.length)
          : claims.sub

        // R34.1 SPEND gate (no-op when enforceAidAssociation is OFF — default).
        if (!assertAidLedgerBacked(agentId)) {
          return {
            error: 'aid_no_ledger_history: AID has no signed-ledger association on this host (R34.1)',
            status: 403,
          }
        }

        const govContext = resolveGovernanceContext(agentId)
        return {
          agentId,
          governanceTitle: govContext.title,
          teamId: govContext.teamId,
          ibctScope: claims.scope,
          ibctMaxDepth: claims.max_depth,
        }
      } catch {
        return { error: 'Invalid or expired AIP token', status: 401 }
      }
    }
  }

  return authenticateFromRequest(request)
}

/**
 * Authorization context passed to Change* functions in element-management-service.
 *
 * MANDATORY: Every Change* / Delete* call must provide an AuthContext — the
 * `!authContext` bypass was closed in gate0Auth (BYPASS-1). Direct callers
 * build one via buildAuthContext(authenticateFromRequest(request)) or, for
 * internal system flows (server startup, cron, tests), via
 * buildSystemAuthContext(reason).
 */
export interface AuthContext {
  /** Verified agent ID, or undefined for system owner / web UI */
  agentId?: string
  /**
   * True when the caller is the system owner.
   *
   * SEMANTICS DEPEND ON THE USER-AUTHORITY MODEL FLAG (R36/R37, decision D3):
   *  - model OFF (default): legacy meaning — `!agentId` (any web session is the
   *    system owner). Byte-identical to pre-model behavior.
   *  - model ON: the ACTIVE MAESTRO — `userTitle ∈ {maestro, maestro-delegate}`.
   *    A normal user has a session but `isSystemOwner=false`.
   * The flip lives in buildAuthContext and is the single switch all gates read.
   */
  isSystemOwner: boolean
  /** CC-GOV-004: Governance title from auth result — avoids redundant registry lookup */
  governanceTitle?: string
  /** CC-GOV-004: Team ID from auth result — avoids redundant registry lookup */
  teamId?: string | null
  /** R36/R37 — verified human-USER id (web session = active MAESTRO, or user-AID token). */
  userId?: string
  /** R36/R37 — the user's authority title (when userId is set). */
  userTitle?: UserTitle
  /** IBCT scope claims — present when caller authenticated via AIP token */
  ibctScope?: string[]
  /** IBCT max delegation depth */
  ibctMaxDepth?: number
  /**
   * AUTH-MIN-03 fix: short audit reason (e.g. "server-startup",
   * "scheduled-health-check", "cemetery-gc"). Set by buildSystemAuthContext()
   * for system-initiated calls so downstream loggers can record WHY the
   * system context was claimed without dual-logging at every call site.
   */
  reason?: string
}

/**
 * Build an AuthContext from an AgentAuthResult.
 * Convenience for API routes that call Change* functions directly.
 *
 * R36/R37 (decision D3) — THE isSystemOwner SEMANTIC FLIP, flag-gated:
 *  - model OFF (default): isSystemOwner = !agentId (legacy — any web session is
 *    the system owner). userId/userTitle are passed through additively but do
 *    NOT change the gate, so flag-off behavior is byte-identical.
 *  - model ON: isSystemOwner = the caller is the ACTIVE MAESTRO, i.e.
 *    userTitle ∈ {maestro, maestro-delegate}. A normal user (userTitle==='user')
 *    has a session/userId but isSystemOwner=false → the 24 enforceSystemOwner
 *    routes correctly reject it.
 * The flag is read via lib/governance (runtime require to avoid a static cycle).
 */
export function buildAuthContext(authResult: AgentAuthResult): AuthContext {
  let isSystemOwner: boolean
  let modelEnabled = false
  try {
    const { isUserAuthorityModelEnabled } = require('./governance') as typeof import('./governance')
    modelEnabled = isUserAuthorityModelEnabled()
  } catch {
    modelEnabled = false
  }
  if (modelEnabled) {
    // Active-MAESTRO semantics. An agent (agentId set) is never the system
    // owner. A user is the system owner ONLY when its title is maestro or the
    // acting maestro-delegate.
    isSystemOwner = !authResult.agentId &&
      (authResult.userTitle === 'maestro' || authResult.userTitle === 'maestro-delegate')
  } else {
    // Legacy semantics — unchanged.
    isSystemOwner = !authResult.agentId
  }
  return {
    agentId: authResult.agentId,
    isSystemOwner,
    governanceTitle: authResult.governanceTitle,
    teamId: authResult.teamId,
    userId: authResult.userId,
    userTitle: authResult.userTitle,
    ibctScope: authResult.ibctScope,
    ibctMaxDepth: authResult.ibctMaxDepth,
  }
}

/**
 * Build a system-owner AuthContext for internal callers that run outside
 * any HTTP request (server startup, scheduled tasks, cron jobs, migrations,
 * tests, CLI utilities). This replaces the legacy "undefined authContext =
 * authorized" bypass in gate0Auth — internal callers must now explicitly
 * state that they are acting as the host operator.
 *
 * The system-owner context goes through the same authorize() pipeline as
 * user/agent contexts, so every action still needs to match an allowed
 * permission for the system-owner role. There is no silent pass-through.
 *
 * SECURITY: callers must not accept `reason` from untrusted input. The
 * parameter is purely for audit logging so server logs show which internal
 * subsystem claimed the context.
 *
 * @param reason Short description logged for audit (e.g. "server-startup",
 *               "scheduled-health-check", "cemetery-gc").
 */
export function buildSystemAuthContext(reason: string): AuthContext {
  if (!reason || typeof reason !== 'string') {
    throw new Error('buildSystemAuthContext: reason is required for audit logging')
  }
  return {
    agentId: undefined,
    isSystemOwner: true,
    governanceTitle: 'system',
    teamId: null,
    // AUTH-MIN-03 fix: store the audit reason in the context. Previously the
    // function validated `reason` was non-empty but discarded it, so downstream
    // audit logging that read the AuthContext could not see WHY the system
    // context was claimed.
    reason,
  }
}

// ============================================================================
// Session Secret Helpers (local agent identity)
// ============================================================================

/**
 * Find an agent by their session secret.
 * Uses the validateSessionSecret import (mockable in tests).
 */
function findAgentBySessionSecret(secret: string): { id: string; name: string } | null {
  try {
    // Dynamic import to avoid circular dependency with agent-registry

    const agentRegistry = require('./agent-registry')
    const agents: Array<{ id: string; name: string; metadata?: Record<string, unknown> }> = agentRegistry.loadAgents()
    for (const agent of agents) {
      const storedHash = agent.metadata?.sessionSecretHash as string | undefined
      if (storedHash && validateSessionSecret(secret, storedHash)) {
        return { id: agent.id, name: agent.name }
      }
    }
    return null
  } catch (err) {
    // Surface the swallowed exception (consistent with the AUTH-MIN-02 fix in
    // resolveGovernanceContext below). A registry-load / disk failure here
    // silently denies an otherwise-valid agent; without this log the denial
    // is invisible to operations. We still return null (fail-closed — a
    // session-secret holder cannot authenticate while the registry is
    // unreadable), but the WHY is now recorded.
    console.warn('[agent-auth] findAgentBySessionSecret failed, denying:', err)
    return null
  }
}

/**
 * Resolve current governance title and team for an agent.
 * Always returns current state (no stale-token problem).
 */
function resolveGovernanceContext(agentId: string): { title: string; teamId: string | null } {
  try {
    // Dynamic imports to avoid circular dependencies

    const governance = require('./governance')
    if (governance.isManager(agentId)) return { title: 'manager', teamId: resolveTeamId(agentId) }
    if (governance.isChiefOfStaffAnywhere(agentId)) return { title: 'chief-of-staff', teamId: resolveTeamId(agentId) }


    const agentRegistry = require('./agent-registry')
    const agent = agentRegistry.getAgent(agentId)
    const title = (agent?.governanceTitle as string) || 'autonomous'
    return { title, teamId: resolveTeamId(agentId) }
  } catch (err) {
    // AUTH-MIN-02 fix: surface the swallowed exception in logs instead of
    // silently falling back to 'autonomous'. A registry corruption or disk
    // error here was previously invisible. The fallback to 'autonomous' is
    // still applied (so transient errors don't hard-fail the request) but
    // operations now see why it happened.
    console.warn('[agent-auth] resolveGovernanceContext failed, falling back to autonomous:', { agentId, err })
    return { title: 'autonomous', teamId: null }
  }
}

/**
 * R36/R37 — resolve a user's authority title from the user-registry. Used for a
 * web session resolved to a user id (the active MAESTRO under the single-operator
 * model). Falls back to 'maestro' when the record is the configured maestro but
 * unreadable, else 'user'. The session→user binding only happens when the model
 * is on, so this is never reached with the model off.
 */
function resolveUserTitle(userId: string): UserTitle {
  try {
    const userRegistry = require('./user-registry') as typeof import('./user-registry')
    const rec = userRegistry.getUser(userId)
    if (rec) return rec.title
    // The active-maestro id resolved but the record is gone — treat as a normal
    // user (fail toward LESS privilege, never silently grant maestro).
    return 'user'
  } catch (err) {
    console.warn('[agent-auth] resolveUserTitle failed, defaulting to user:', err)
    return 'user'
  }
}

/**
 * R34.1 SPEND gate — is the agent behind a minted token still backed by a
 * signed-ledger AID association?
 *
 * Decision D5 (staged): when ledger.enforceAidAssociation is OFF (default) this
 * returns true UNCONDITIONALLY — token spend behaves EXACTLY as before R34, so
 * there is zero regression. When ON, a token whose agent has no current (non-
 * revoked) ledger association to its own fingerprint is rejected.
 *
 * This is NOT a sudo gate (R32): it is the R28 check-1 AID-validity check, which
 * agents are supposed to pass. It only ever DENIES an agent whose identity the
 * ledger does not back (tampered registry / revoked / deleted agent).
 *
 * Lazy-`require`s its deps (same cycle-avoidance as the helpers above).
 */
function assertAidLedgerBacked(agentId: string): boolean {
  // loadSecurityConfig + isAidAssociated are STATIC imports (top of file): they
  // are cycle-free (neither imports agent-auth), and a static import resolves the
  // module identically in production AND under vitest's mock layer — a runtime
  // `require('./security-config')` here did NOT pick up vi.mock in tests.
  if (!loadSecurityConfig().ledger.enforceAidAssociation) return true
  try {
    // getAgentRecord is a STATIC import (top of file) — vitest's runtime
    // `require('./agent-registry')` does NOT resolve the .ts in tests, and the
    // static edge adds no new cycle (aid-ledger-authority, also static-imported
    // here, already pulls agent-registry).
    const agent = getAgentRecord(agentId)
    const fp = (agent?.metadata?.amp as Record<string, unknown> | undefined)?.fingerprint as string | undefined
    if (!fp) return false
    const a = isAidAssociated(fp)
    return a.ok && a.agentId === agentId && !a.revoked
  } catch (err) {
    // Enforcement is ON but we cannot verify → fail CLOSED (deny). With the flag
    // OFF we already returned true above, so this never affects default behavior.
    console.warn('[agent-auth] assertAidLedgerBacked verification failed, denying:', err)
    return false
  }
}

function resolveTeamId(agentId: string): string | null {
  try {

    const teamRegistry = require('./team-registry')
    const teams = teamRegistry.loadTeams()
    for (const team of teams) {
      if (
        team.agentIds?.includes(agentId) ||
        team.chiefOfStaffId === agentId ||
        team.orchestratorId === agentId
      ) {
        return team.id
      }
    }
    return null
  } catch (err) {
    // Surface the swallowed exception (consistent with the AUTH-MIN-02 fix in
    // resolveGovernanceContext). A team-registry load failure silently resolves
    // the caller to "no team", which can change a COS/orchestrator's effective
    // permissions downstream — so the failure must not be invisible. We still
    // return null (fail-closed: absent team membership rather than a guessed
    // one), but operations now see why.
    console.warn('[agent-auth] resolveTeamId failed, treating as no team:', err)
    return null
  }
}
