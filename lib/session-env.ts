/**
 * The ONE builder of an agent's tmux session environment (TRDD-L1OYEVSN).
 *
 * WHY THIS FILE EXISTS — it is not a tidy-up.
 *
 * There are two paths that start an agent's tmux session:
 *   - CREATE  — CreateAgent → sessions-service::createSession
 *   - WAKE    — POST /api/agents/[id]/wake → agents-core-service::wakeAgent,
 *               which is ALSO what boot-restore calls for every agent on startup.
 *
 * Each used to hand-roll its own `initialEnv` literal. They drifted: CREATE
 * minted and injected `AID_AUTH` (the secret the agent presents to the
 * ai-maestro HTTP API); WAKE did not. Because a restart restores every agent
 * through WAKE, **every server restart silently stripped the credential from the
 * entire fleet** — measured 8/8 live sessions with no AID_AUTH, while 5/8 still
 * had AGENT_WORK_DIR from the same bag. Every agent→server API call 401'd, which
 * killed the script layer (the only interface plugins are permitted to use).
 *
 * The fix is not "add AID_AUTH to wakeAgent too" — that is what created the bug,
 * one copy at a time. The env bag now has a single constructor. Adding a variable
 * is a one-line change here that BOTH paths inherit; forgetting one is no longer
 * something a caller is able to do.
 *
 * THE TIMING CONSTRAINT (why this must be built BEFORE the session exists):
 * `tmux set-environment` only reaches FUTURE panes — the initial pane's process
 * tree is already running and inherits nothing from it. So a variable that is not
 * in the `tmux new-session -e KEY=VAL` bag is not visible to the `claude` process
 * that pane launches, and there is no second chance. Everything the agent needs
 * must be resolved here, before `runtime.createSession` is called.
 */
import { initAgentAMPHome, getAgentAMPDir } from '@/lib/amp-inbox-writer'

/**
 * The complete contract of an agent session's environment. Enumerated once, here,
 * so no comment elsewhere has to keep a list of it in sync (a comment in
 * agents-core-service used to enumerate four of these as though the set were
 * complete — it read as reassurance while being the evidence of the omission).
 */
export const SESSION_ENV_KEYS = [
  'AGENT_WORK_DIR', // sandbox boundary read by the directory-guard shell hook
  'AIM_AGENT_NAME', // AMP messaging + state-tracking hooks
  'AIM_AGENT_ID',   // as above; absent when the agent is not registered
  'AMP_DIR',        // per-agent AMP mailbox; best-effort
  'AID_AUTH',       // the agent's API credential — absent ⇒ every API call 401s
] as const

export type SessionEnvKey = (typeof SESSION_ENV_KEYS)[number]

export interface BuildAgentSessionEnvInput {
  agentName: string
  /** Registry id. Undefined when registration failed — see the fail-open note. */
  agentId?: string
  workingDirectory: string
}

export interface BuiltAgentSessionEnv {
  /** Pass straight to `runtime.createSession(name, cwd, env)`. */
  env: Record<string, string>
  /** True only when a secret was minted AND its hash was durably persisted. */
  aidAuthSet: boolean
  /** Resolved AMP mailbox, when init succeeded. */
  ampDir?: string
}

/**
 * Build the full env bag for a new agent session.
 *
 * Failure policy, stated explicitly because the silent version of it is what hid
 * TRDD-L1OYEVSN for months:
 *
 *   - fail-OPEN on the SESSION: AMP init or secret minting failing does not stop
 *     the pane from opening. A terminal with no API access is still useful, and
 *     refusing to wake an agent because its mailbox could not be created would
 *     trade a degraded agent for no agent.
 *   - fail-CLOSED on the CREDENTIAL: if the hash cannot be persisted, no
 *     `AID_AUTH` is handed out at all. A secret the server did not store would
 *     401 anyway — but opaquely, looking like a permissions bug instead of a
 *     bootstrap failure.
 *   - LOUD either way. Both failures warn with the agent named. A quiet fail-open
 *     on a credential is indistinguishable from success right up until the whole
 *     fleet is silently unauthenticated.
 */
export async function buildAgentSessionEnv(
  input: BuildAgentSessionEnvInput,
): Promise<BuiltAgentSessionEnv> {
  const { agentName, agentId, workingDirectory } = input

  const env: Record<string, string> = {
    AGENT_WORK_DIR: workingDirectory,
    AIM_AGENT_NAME: agentName,
  }
  if (agentId) {
    env.AIM_AGENT_ID = agentId
  }

  // AMP mailbox (best-effort; AMP is not required for a session to function).
  let ampDir: string | undefined
  try {
    await initAgentAMPHome(agentName, agentId)
    ampDir = getAgentAMPDir(agentName, agentId) || undefined
    if (ampDir) env.AMP_DIR = ampDir
  } catch (ampErr) {
    console.warn(`[SessionEnv] Could not init AMP home for ${agentName}:`, ampErr)
  }

  // AID_AUTH — the agent's API credential.
  //
  // The server spawns the agent, so it IS the identity authority for a local
  // agent: it mints the secret, stores only the hash, and hands the plaintext to
  // the pane exactly once, via the tmux `-e` bag.
  //
  // No agentId ⇒ nothing to bind the secret to. Skip it, and say so, rather than
  // minting an orphan credential the server could never validate.
  let aidAuthSet = false
  if (!agentId) {
    console.warn(
      `[SessionEnv] ${agentName}: no registry id — starting session WITHOUT AID_AUTH. ` +
        `Agent API calls from this session will return 401.`,
    )
    return { env, aidAuthSet, ampDir }
  }

  try {
    // Dynamic imports: element-management-service is a service layer and lib/
    // must not take a static dependency on it (import cycle). This mirrors what
    // the create path already did inline.
    const { generateSessionSecret } = await import('@/lib/session-secret')
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const { buildSystemAuthContext } = await import('@/lib/agent-auth')

    const { secret, secretHash } = generateSessionSecret()

    // R21.4: metadata mutation routes through the ChangeMetadata AIO (auth +
    // validation + ledger op) rather than a raw registry write. Session bootstrap
    // is a privileged internal operation, hence the system auth context.
    const r = await ChangeMetadata(
      agentId,
      { sessionSecretHash: secretHash },
      buildSystemAuthContext('session-bootstrap'),
      { mode: 'merge' },
    )
    if (!r.success) {
      throw new Error(r.error || 'ChangeMetadata failed during session bootstrap')
    }

    // Only now — hash durably stored — is the secret safe to hand out.
    env.AID_AUTH = secret
    aidAuthSet = true
  } catch (secretErr) {
    console.warn(
      `[SessionEnv] ${agentName}: could not establish AID_AUTH — session will start ` +
        `UNAUTHENTICATED (every agent API call returns 401):`,
      secretErr,
    )
  }

  return { env, aidAuthSet, ampDir }
}
