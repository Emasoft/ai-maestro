/**
 * Centralized Authorization (RBAC)
 *
 * Single point of RBAC decisions for AI Maestro governance.
 * Replaces per-endpoint governance checks with a consistent policy.
 *
 * Auth hierarchy:
 *   system-owner (web UI) → all allowed
 *   MANAGER → all allowed
 *   CHIEF-OF-STAFF → own team agents only
 *   Others → self only
 */

import type { AgentAuthResult } from './agent-auth'
// TRDD-0IPK36MS: these were previously lazy `require('./…')` calls inside
// lookupGovernanceTitle/lookupTeamIdForAgent. That pattern is invisible to
// production bundlers (webpack/Turbopack resolve a literal require() fine)
// but is UNRESOLVABLE under this project's Vitest/vite-node setup — a
// synchronous `require()` of a relative, extensionless .ts sibling from
// deep inside a function call is not intercepted by vite-node's transform,
// so Node's native CJS resolver looks for `./team-registry.js` (no `.ts`
// fallback) and always throws MODULE_NOT_FOUND. The catch block then
// silently failed CLOSED (team-less / autonomous) on EVERY call, which
// meant authorize()'s COS-own-team change-title branch had NEVER been
// exercised for real by any test in this codebase — every existing test
// that touches this path fully mocks '@/lib/authorization' instead.
// Static imports resolve identically in both production and tests, with no
// circular-import risk (verified: none of these three modules import this
// file, directly or transitively).
import { isManager, isChiefOfStaffAnywhere } from './governance'
import { getAgent } from './agent-registry'
import { loadTeams } from './team-registry'

// ============================================================================
// Types
// ============================================================================

export type AuthAction =
  | 'modify-agent'      // PATCH agent properties (name, folder, avatar, etc.) — NOT title
  | 'change-title'      // Change governance title — special rules: only MANAGER/COS, never self
  | 'delete-agent'      // DELETE agent
  | 'send-command'      // Send command to agent's tmux session
  | 'restart-session'   // Restart agent session
  | 'hibernate-agent'   // Hibernate agent
  | 'wake-agent'        // Wake agent
  | 'link-session'      // Link a tmux session name to an agent record (registry write)
  | 'delete-session'    // Kill an agent's tmux session and/or unlink it (no agent delete)
  | 'create-session'    // SVC2-MAJ-01: createSession is a registry-write + tmux-spawn primitive
  | 'register-agent'    // Register/overwrite an agent record (filesystem write primitive)
  | 'manage-team'       // Create/modify/delete teams
  | 'manage-skills'     // Install/remove skills on an agent
  | 'manage-group'      // SVC2-MAJ-07/08: create/update/delete groups + subscribe/notify
  // TRDD-K2WJH7RF: the 3-pillars TRDD lifecycle write verbs. This is the FIRST
  // action that is NOT agent-targeted: a TRDD has no target agent — it has an
  // approval TIER, and the tier names who may act. Its matrix therefore mirrors
  // aimaestro-trdd-approval.md, not the "may caller X act on agent Y" model every
  // other action uses. The ROUTE resolves the TRDD's facts from disk and passes
  // them in as TrddAuthContext, so authorize() stays synchronous and does no I/O.
  | 'manage-trdd'       // PATCH /api/trdd/[id] + approve|refuse|promote|archive
  // 'manage-amp-address' (SVC2-MAJ-18) was DELETED by TRDD-YEE33F3A Part 3: it was
  // wired to zero routes while all four address routes authorize with 'modify-agent'.
  // An action that exists only in a test reads as coverage. Re-adding it means
  // migrating all four address routes at once — never wiring it into just one.
  | 'export-agent'      // TRDD-YEE33F3A: download an agent's full archive — INCLUDING keys/private.pem
  | 'view-agent'        // Read agent data (currently open, for future lockdown)

export interface AuthorizationResult {
  allowed: boolean
  reason?: string
}

/** The TRDD lifecycle write verbs (TRDD-K2WJH7RF Part 1). */
export type TrddVerb = 'edit' | 'approve' | 'refuse' | 'promote' | 'archive'

/**
 * The TITLE that must approve a TRDD — its `min-approval-requirement:` field.
 * This is the authority ladder of aimaestro-trdd-approval.md, verbatim.
 */
export type TrddApprovalTitle = 'none' | 'orchestrator' | 'chief-of-staff' | 'manager' | 'user'

/**
 * The TRDD facts a `manage-trdd` decision needs.
 *
 * The ROUTE reads these off disk and passes them in. authorize() deliberately
 * does NOT grow a filesystem read: it is synchronous and today touches only the
 * registry and the team file. Keeping it honest about what it knows is why the
 * tier arrives as an argument rather than being resolved here (TRDD-K2WJH7RF).
 */
export interface TrddAuthContext {
  /** Which write verb is being attempted. */
  verb: TrddVerb
  /** The target TRDD's `min-approval-requirement:` — the title that must approve. */
  minApproval: TrddApprovalTitle
  /** The TRDD's `assignee:` (agent id), if any — it may `edit` its own card. */
  assigneeAgentId?: string | null
  /** The TRDD's author (`created-by:`). Self-approval is refused — see below. */
  createdByAgentId?: string | null
}

/**
 * The one authority ladder. `user` is NOT an agent: no agent ever satisfies it,
 * which is exactly what makes a Tier-3 (USER-reserved) TRDD unapprovable by the
 * whole fleet, MANAGER included.
 *
 * Titles absent from this map (member, architect, integrator, maintainer,
 * autonomous) have NO approval authority — they score 0 and may approve only a
 * `none`-tier TRDD, which by definition needs no approval at all.
 */
const TRDD_AUTHORITY: Record<string, number> = {
  none: 0,
  orchestrator: 1,
  'chief-of-staff': 2,
  manager: 3,
  user: 4,
}

/** Authority of an AGENT caller. Never returns the USER rung — agents cannot hold it. */
function agentAuthority(title: string | undefined | null): number {
  if (!title) return 0
  const rung = TRDD_AUTHORITY[title]
  // `user` is unreachable for an agent even if a registry record somehow said so.
  return rung === undefined || rung >= TRDD_AUTHORITY.user ? 0 : rung
}

/**
 * The actions an agent may perform on ITSELF (TRDD-D3RP7KQZ, USER decision
 * 2026-07-09). Every other action, applied to self, is denied.
 *
 * The line is between DRIVING a surface and CHANGING what the agent IS.
 *
 * An agent may never reconfigure itself: title, role plugin, skills, MCP
 * servers, hooks, sub-agents, team membership, name, folder. Only a MANAGER,
 * the agent's own COS, or the human via the UI may. The reason is that a
 * self-reconfigure is the one mistake an agent cannot recover from — uninstall
 * the role plugin that defines your job, or drop yourself from your team, and
 * nothing is left that can put it back.
 *
 * Driving its own surface is not that, and is allowed:
 *   • send-command    — inject into its own terminal (the janitor's idiom:
 *                       `/compact`, `/reload-plugins`), answer its own pending
 *                       permission prompt, enqueue a command on itself, push
 *                       HTML to its own dashboard panel. All four routes carry
 *                       this action.
 *   • hibernate-agent — put itself to sleep. `wake-agent` is deliberately NOT
 *                       here: a sleeping agent cannot be the one to wake itself.
 *
 * The test for membership is mechanical: nothing in this set writes the agent's
 * registry record; everything outside it does. That is why it is a small closed
 * set here rather than a per-route exemption scattered across the guard.
 *
 * These grant an agent nothing it could not already do by typing into its own
 * terminal. Configuration is not like that — a self-reconfigure over the API
 * would bypass the Change* governance pipelines entirely.
 */
const SELF_DRIVE_ACTIONS: ReadonlySet<AuthAction> = new Set<AuthAction>([
  'send-command',
  'hibernate-agent',
])

// ============================================================================
// Authorization
// ============================================================================

/**
 * Authorize an action based on authenticated identity.
 *
 * @param auth - Result from authenticateAgent()
 * @param action - What the caller wants to do
 * @param targetAgentId - Agent being acted upon (if applicable)
 * @returns Whether the action is allowed, with reason if denied
 */
export function authorize(
  auth: AgentAuthResult,
  action: AuthAction,
  targetAgentId?: string,
  trdd?: TrddAuthContext
): AuthorizationResult {
  // ── AUTH-CRIT-01 fix (2026-05-04) — fail-closed on errored auth result ──
  // BUG: previous version returned { allowed: true } for any auth result with
  // !auth.agentId, including failures where agentId is undefined because the
  // token was rejected. The error path coexisted with the system-owner path:
  // an `AgentAuthResult` from a failed authenticate() (e.g. malformed token)
  // would set { error: 'token_invalid', agentId: undefined } and slip into the
  // system-owner branch, granting unrestricted access to any caller that
  // forwarded the failed result. Verified by the comm-graph review agent.
  // FIX: check auth.error FIRST. Only when there is no error AND no agentId
  // is the caller a legitimate system-owner (web UI without agent identity).
  if (auth.error) {
    return { allowed: false, reason: auth.error }
  }

  // ── M1/U1 fix (2026-06-19 R26-R40 audit) — deny-by-default for a model-ON
  // non-system-owner USER principal ──────────────────────────────────────
  // BUG: under the user-authority model (R36/R37), a non-maestro web/AID user
  // resolves to { userId, userTitle:'user' } with NO agentId. The legacy
  // `!agentId ⇒ system-owner` grant below would then hand that ordinary user
  // unrestricted access on every agent-callable strict route (delete-agent,
  // delete-team, session kill/stop/restart). A `userId`-bearing principal whose
  // title is NOT maestro/maestro-delegate is the active-non-owner user and MUST
  // be denied here, NOT fall through into the system-owner branch.
  // ZERO-REGRESSION: this keys on the PRESENCE of `userId`, never on `!agentId`.
  // The flag-OFF web session resolves to `{}` (no userId — see agent-auth.ts
  // authenticateAgent Case 1), so it skips this branch and is still granted by
  // the legacy path below — byte-equivalent to pre-model behavior. A model-ON
  // system-owner (userTitle 'maestro' / 'maestro-delegate') also skips this
  // branch and keeps its system-owner grant.
  if (auth.userId && auth.userTitle !== 'maestro' && auth.userTitle !== 'maestro-delegate') {
    return {
      allowed: false,
      reason: `User "${auth.userTitle ?? 'user'}" is not authorized to ${action} via the AI Maestro API`,
    }
  }

  // System-owner (web UI) → always allowed (no error AND no agentId)
  if (!auth.agentId) {
    return { allowed: true }
  }

  // Resolve title: prefer session secret (always current), fall back to registry lookup
  const title = auth.governanceTitle || lookupGovernanceTitle(auth.agentId)

  // ── Special rule: change-title ──────────────────────────────
  // Title changes have unique governance constraints:
  //   - No agent can change its OWN title (not even MANAGER)
  //   - Only MANAGER and COS can change titles at all
  //   - COS is restricted to agents in their own team
  if (action === 'change-title') {
    // Self-assignment is always forbidden
    if (targetAgentId && targetAgentId === auth.agentId) {
      return { allowed: false, reason: 'No agent can change its own governance title' }
    }

    // MANAGER can change any other agent's title
    if (title === 'manager') {
      return { allowed: true }
    }

    // COS can change titles of agents in their own team
    if (title === 'chief-of-staff') {
      if (!targetAgentId) {
        return { allowed: false, reason: 'Chief-of-Staff must specify target agent for title change' }
      }
      const cosTeamId = auth.teamId ?? lookupTeamIdForAgent(auth.agentId)
      const targetTeamId = lookupTeamIdForAgent(targetAgentId)
      if (cosTeamId && cosTeamId === targetTeamId) {
        return { allowed: true }
      }
      return { allowed: false, reason: 'Chief-of-Staff can only change titles of agents in their own team' }
    }

    // Everyone else: denied
    return { allowed: false, reason: `Only MANAGER or CHIEF-OF-STAFF can change governance titles` }
  }

  // ── Special rule: delete-agent ──────────────────────────────
  // Only system-owner and MANAGER can delete agents.
  // No agent can delete itself via API. COS cannot delete.
  if (action === 'delete-agent') {
    if (targetAgentId && targetAgentId === auth.agentId) {
      return { allowed: false, reason: 'No agent can delete itself via API' }
    }
    if (title === 'manager') {
      return { allowed: true }
    }
    return { allowed: false, reason: 'Only MANAGER can delete agents' }
  }

  // ── Special rule: manage-team (create/delete teams) ─────────
  // Only system-owner and MANAGER can create or delete teams.
  if (action === 'manage-team') {
    if (title === 'manager') {
      return { allowed: true }
    }
    return { allowed: false, reason: 'Only MANAGER can manage teams' }
  }

  // ── Special rule: register-agent ───────────────────────────
  // SVC2-CRIT-04 fix (2026-05-06): registerAgent writes ~/.aimaestro/agents/<id>.json
  // and creates tmux sessions under arbitrary names. Only system-owner is permitted —
  // not even MANAGER, because registerAgent is the bootstrap primitive that mints
  // agent records. Use createAgent + ChangeTitle pipelines for in-band agent creation.
  if (action === 'register-agent') {
    return { allowed: false, reason: 'Only the system owner can register agent records' }
  }

  // ── Special rule: export-agent ─────────────────────────────
  // TRDD-YEE33F3A. The export archive is not "the agent's data" — it is the
  // agent's IDENTITY. exportAgentZip() does `archive.directory(getKeysDir(id),
  // 'keys')` (services/agents-transfer-service.ts), copying the directory whose
  // private.pem lib/amp-keys.ts annotates "Agent's private key (NEVER shared)".
  // The same archive carries registrations/ (external AMP provider API keys),
  // agent.db, and every inbox/sent/archived message.
  //
  // Handing that to ANY agent — MANAGER and the target's own COS included —
  // creates an unbounded, undetectable impersonation capability. The holder can
  // forge Ed25519-signed AMP messages as the victim forever, and no downstream
  // governance check can tell those from the real thing, because they ARE
  // correctly signed. MANAGER already governs an agent completely without ever
  // needing its signing key; COS coordinates a team, it does not impersonate its
  // members. There is no role here for which "can sign as you" is the right
  // grant.
  //
  // So this mirrors `register-agent`: system-owner ONLY. The `!auth.agentId`
  // branch above has already granted the human/web caller, so by the time
  // control reaches this line the caller is provably an agent. Deny, always.
  //
  // Self-export is denied too, and deliberately. It grants an agent nothing it
  // lacks (it can read its own keys off disk today) while turning the API into a
  // single-request exfiltration channel for a compromised one. If a real
  // self-backup flow ever needs this, widen it here, on purpose, with a test.
  if (action === 'export-agent') {
    return {
      allowed: false,
      reason: 'Only the system owner can export an agent — the archive contains keys/private.pem',
    }
  }

  // ── Special rule: manage-trdd (TRDD-K2WJH7RF) ──────────────
  // The first NON-agent-targeted action, and it MUST return early. Every rule
  // below keys on a target agent, and in particular the general
  // "MANAGER → always allowed" would otherwise let a MANAGER approve a Tier-3
  // (USER-reserved) TRDD and approve its OWN proposal — the two things this
  // matrix exists to forbid.
  //
  // The human/system-owner never reaches this line (granted at `!auth.agentId`
  // above), so the caller here is provably an AGENT.
  if (action === 'manage-trdd') {
    if (!trdd) {
      // Fail closed. A manage-trdd check with no TRDD context cannot be decided,
      // and guessing would mean guessing an approval tier.
      return {
        allowed: false,
        reason: 'manage-trdd requires the TRDD context (verb + min-approval-requirement)',
      }
    }

    const callerRung = agentAuthority(title)
    // An unrecognized tier is treated as MANAGER-level, never as `none`: an
    // unparseable frontmatter field must not silently open a card to everyone.
    const requiredRung = TRDD_AUTHORITY[trdd.minApproval] ?? TRDD_AUTHORITY.manager

    switch (trdd.verb) {
      // `edit` = the mechanical column transitions, which are EXEMPT from
      // approval (aimaestro-manager-approval-defaults.md §A). So the gate is
      // OWNERSHIP, not tier: the card's assignee drives its own card, its team's
      // ORCHESTRATOR dispatches it, MANAGER may always act.
      case 'edit': {
        if (title === 'manager') return { allowed: true }
        if (trdd.assigneeAgentId && trdd.assigneeAgentId === auth.agentId) {
          return { allowed: true }
        }
        if (title === 'orchestrator' && trdd.assigneeAgentId) {
          const orchTeamId = auth.teamId ?? lookupTeamIdForAgent(auth.agentId)
          const assigneeTeamId = lookupTeamIdForAgent(trdd.assigneeAgentId)
          if (orchTeamId && orchTeamId === assigneeTeamId) return { allowed: true }
          return {
            allowed: false,
            reason: 'ORCHESTRATOR can only edit TRDDs assigned within its own team',
          }
        }
        return {
          allowed: false,
          reason: 'Only the TRDD assignee, its team ORCHESTRATOR, or MANAGER can edit a TRDD',
        }
      }

      // approve / promote share one rule because promotion IS the approval act.
      // Letting them diverge would make `promote` a way to launder an approval
      // the caller could not grant.
      case 'approve':
      case 'promote': {
        // Self-approval defeats the approval system entirely. Mirrors the way
        // change-title already refuses self even for a MANAGER.
        if (trdd.createdByAgentId && trdd.createdByAgentId === auth.agentId) {
          return { allowed: false, reason: `An agent cannot ${trdd.verb} a TRDD it authored` }
        }
        if (trdd.minApproval === 'user') {
          return {
            allowed: false,
            reason: `This TRDD requires USER approval — no agent can ${trdd.verb} it`,
          }
        }
        if (callerRung < requiredRung) {
          return {
            allowed: false,
            reason: `${title || 'agent'} cannot ${trdd.verb} a TRDD requiring ${trdd.minApproval} approval`,
          }
        }
        return { allowed: true }
      }

      // `refuse` carries the same authority as approve — deciding a proposal is
      // ONE gate, whichever way it goes. Self is deliberately NOT banned here:
      // refusing your own proposal is a withdrawal, and withdrawing costs the
      // system nothing.
      case 'refuse': {
        if (trdd.minApproval === 'user') {
          return {
            allowed: false,
            reason: 'This TRDD requires USER approval — no agent can refuse it',
          }
        }
        if (callerRung < requiredRung) {
          return {
            allowed: false,
            reason: `${title || 'agent'} cannot refuse a TRDD requiring ${trdd.minApproval} approval`,
          }
        }
        return { allowed: true }
      }

      // `archive` retires a terminal-DONE card. The owner or MANAGER may.
      // WHICH states are archivable — never `failed` — is a DATA invariant and
      // lives in the route, because it must bind the human owner too (who is
      // granted unconditionally above and never reaches this matrix).
      case 'archive': {
        if (title === 'manager') return { allowed: true }
        const isOwner =
          (trdd.assigneeAgentId && trdd.assigneeAgentId === auth.agentId) ||
          (trdd.createdByAgentId && trdd.createdByAgentId === auth.agentId)
        if (isOwner) return { allowed: true }
        return { allowed: false, reason: 'Only the TRDD owner or MANAGER can archive a TRDD' }
      }

      default: {
        // Exhaustiveness: a new verb must STATE its policy here, never inherit one.
        const unknown: never = trdd.verb
        return { allowed: false, reason: `Unknown TRDD verb: ${String(unknown)}` }
      }
    }
  }

  // ── Universal rule: no agent can RECONFIGURE itself via API ─
  // Agents cannot change their own properties, title, skills, plugins, MCP
  // servers, hooks, sub-agents or team, and cannot delete themselves. Only the
  // MANAGER, the agent's own COS, or the human via the UI may do that.
  //
  // SELF-DRIVE is the exception and returns ALLOWED here. It must return early:
  // the general rules below deny any non-MANAGER/COS caller that names a target,
  // and "itself" is a target.
  if (targetAgentId && targetAgentId === auth.agentId) {
    if (SELF_DRIVE_ACTIONS.has(action)) {
      return { allowed: true }
    }
    return { allowed: false, reason: 'No agent can modify itself via the AI Maestro API' }
  }

  // ── General rules ──────────────────────────────────────────

  // MANAGER → always allowed (for actions on OTHER agents)
  if (title === 'manager') {
    return { allowed: true }
  }

  // CHIEF-OF-STAFF → own team agents only (target required for agent-scoped actions)
  if (title === 'chief-of-staff') {
    if (!targetAgentId) {
      return { allowed: false, reason: 'Chief-of-Staff must specify a target agent' }
    }
    const cosTeamId = auth.teamId ?? lookupTeamIdForAgent(auth.agentId)
    const targetTeamId = lookupTeamIdForAgent(targetAgentId)
    if (cosTeamId && cosTeamId === targetTeamId) {
      return { allowed: true }
    }
    return { allowed: false, reason: `Chief-of-Staff can only ${action} agents in their own team` }
  }

  // All other titles → denied (no agent can modify other agents)
  if (!targetAgentId) {
    return { allowed: false, reason: `${title || 'agent'} cannot ${action}` }
  }

  return { allowed: false, reason: `${title || 'agent'} cannot ${action} other agents` }
}

// ============================================================================
// Governance Lookup Helpers (for legacy AMP key path)
// ============================================================================

/**
 * Look up governance title from registry. Used when AID token is not available
 * (legacy AMP API key path where title is not embedded in the token).
 */
function lookupGovernanceTitle(agentId: string): string {
  try {
    // Check if agent is the MANAGER
    if (isManager(agentId)) return 'manager'
    if (isChiefOfStaffAnywhere(agentId)) return 'chief-of-staff'

    // Fall back to agent record
    const agent = getAgent(agentId)
    return (agent?.governanceTitle as string) || 'autonomous'
  } catch (err) {
    // AUTH-MIN-02 fix: surface the swallowed exception in logs instead of
    // silently falling back to 'autonomous'. A registry corruption or disk
    // error here was previously invisible.
    console.warn('[authorization] lookupGovernanceTitle failed, falling back to autonomous:', { agentId, err })
    return 'autonomous'
  }
}

/**
 * Find which team an agent belongs to. Returns team ID or null.
 */
function lookupTeamIdForAgent(agentId: string): string | null {
  try {
    const teams = loadTeams()
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
    // Surface the swallowed exception in logs instead of silently returning
    // null — matches the AUTH-MIN-02 treatment of lookupGovernanceTitle. A
    // team-registry read failure (corruption, disk error) here previously
    // collapsed a COS membership check to "no team" with zero diagnostics,
    // which fails CLOSED (the COS is denied, never wrongly granted) — that
    // safe direction is preserved, but the failure is no longer invisible.
    console.warn('[authorization] lookupTeamIdForAgent failed, treating agent as team-less (deny):', { agentId, err })
    return null
  }
}
