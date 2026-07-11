/**
 * The agent-workdir invariant registry (TRDD-VYQ8N4KR).
 *
 * ONE list of everything ai-maestro guarantees about an agent's working
 * directory, ONE runner, ONE watchdog. Before this file, each guarantee was a
 * hand-rolled try/catch copy-pasted into three call sites (CreateAgent G05b/G05c,
 * importAgent, ensureCorePluginInstalled), and only one of them had a timer. That
 * shape has two failure modes and we hit both:
 *
 *   - ADD an invariant and you must remember all N call sites. Miss one and the
 *     guarantee silently holds for some agents and not others.
 *   - Every invariant that is only enforced on WAKE is enforced by the very agent
 *     that may have broken it — it decides when the repair lands, which is not a
 *     guarantee at all.
 *
 * So: an invariant is a DECLARATION here, not a call site. Adding one means adding
 * a row. The runner enforces the rows that apply to the trigger it was given, and
 * the watchdog runs the periodic-safe subset across the whole fleet.
 *
 * WHY `triggers` exists (and is not just "always"): not every invariant is safe on
 * a timer. Repairing the core plugin shells out to `claude plugin install` — network
 * I/O, a package manager, and a registry write. Running that unattended on a loop is
 * a different and much riskier thing than rewriting a file, and R17 deliberately has
 * no periodic loop (see the note in server.mjs). Making that exclusion an explicit,
 * reviewable field beats leaving it implicit in which function someone remembered to
 * call.
 */
import { mkdir } from 'fs/promises'
import { join } from 'path'

export type InvariantTrigger = 'create' | 'wake' | 'periodic'

export type ClientType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' | 'unknown'

export interface AgentInvariantContext {
  agentId: string
  agentName?: string
  workdir: string
  clientType: ClientType
  trigger: InvariantTrigger
  /** Passed through to privileged repairs (the core-plugin install). */
  authContext?: unknown
}

export interface InvariantOutcome {
  id: string
  /** ok = already held · repaired = it did not hold and was fixed · skipped = N/A here · failed = could not fix */
  status: 'ok' | 'repaired' | 'skipped' | 'failed'
  detail?: string
}

export interface AgentInvariant {
  /** Stable id — appears in logs and in the AIO `ops` arrays. */
  id: string
  /** What must be true of the workdir. One line. */
  description: string
  /** Where this invariant may be enforced. Omitting 'periodic' is a deliberate act. */
  triggers: readonly InvariantTrigger[]
  enforce(ctx: AgentInvariantContext): Promise<InvariantOutcome>
}

/**
 * THE LIST. Everything ai-maestro promises about an agent workdir.
 *
 * To add a guarantee: add a row. Do not add a call site.
 */
export const AGENT_INVARIANTS: readonly AgentInvariant[] = [
  {
    id: 'claude-dir',
    description: '`.claude/` exists in the workdir',
    triggers: ['create', 'wake', 'periodic'],
    async enforce({ workdir }: AgentInvariantContext) {
      await mkdir(join(workdir, '.claude'), { recursive: true })
      return { id: 'claude-dir', status: 'ok' }
    },
  },

  {
    id: 'dep-rules',
    description: 'the shipped aimaestro-*.md rules are present, unmodified, and read-only',
    triggers: ['create', 'wake', 'periodic'],
    async enforce({ workdir }: AgentInvariantContext) {
      const { ensureAgentRules } = await import('@/lib/agent-rules-seed')
      const r = await ensureAgentRules(workdir)
      const repaired = [
        ...r.seeded.map((f) => `re-created ${f}`),
        ...r.updated.map((f) => `restored ${f}`),
        ...r.remoded.map((f) => `re-protected ${f}`),
      ]
      return repaired.length > 0
        ? { id: 'dep-rules', status: 'repaired', detail: repaired.join(', ') }
        : { id: 'dep-rules', status: 'ok' }
    },
  },

  {
    id: 'git-exclude',
    description: 'a git-repo workdir carries the managed git-exclude block',
    triggers: ['create', 'wake', 'periodic'],
    async enforce({ workdir }: AgentInvariantContext) {
      const { ensureWorkdirGitignore } = await import('@/lib/workdir-gitignore-seed')
      const r = await ensureWorkdirGitignore(workdir)
      if (r.skipped) return { id: 'git-exclude', status: 'skipped', detail: 'not a git repo' }
      if (r.created) return { id: 'git-exclude', status: 'repaired', detail: 'created' }
      if (r.updated) return { id: 'git-exclude', status: 'repaired', detail: 'restored' }
      return { id: 'git-exclude', status: 'ok' }
    },
  },

  {
    id: 'core-plugin',
    // WAKE ONLY — and this narrow trigger list is the whole point of the field.
    //
    // NOT 'periodic': the repair is `claude plugin install` — network I/O, a
    // package manager, and a registry write. A background loop that silently
    // reinstalls plugins across the fleet is a far bigger promise than "rewrite
    // a file", and R17 deliberately has no periodic loop (see server.mjs).
    //
    // NOT 'create': today the core plugin is installed on an agent's FIRST WAKE,
    // not at creation. Adding it here would be a behavior change smuggled into a
    // consolidation — a separate decision, to be made on its own merits.
    description: 'the ai-maestro-plugin (R17) is installed and enabled at local scope',
    triggers: ['wake'],
    async enforce(ctx: AgentInvariantContext) {
      const { isCorePluginPresent } = await import('@/services/agents-core-service')
      if (await isCorePluginPresent(ctx.agentId)) return { id: 'core-plugin', status: 'ok' }

      const { InstallElement } = await import('@/services/element-management-service')
      const { buildSystemAuthContext } = await import('@/lib/agent-auth')
      const auth = (ctx.authContext as Parameters<typeof InstallElement>[1] | undefined)
        || buildSystemAuthContext('agent-invariant-core-plugin')

      const result = await InstallElement({
        name: 'ai-maestro-plugin',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'local',
        agentDir: ctx.workdir,
        agentId: ctx.agentId,
        clientType: ctx.clientType,
      }, auth)

      return result.success
        ? { id: 'core-plugin', status: 'repaired', detail: `installed (${result.operations.length} gates)` }
        : { id: 'core-plugin', status: 'failed', detail: result.error || 'install failed' }
    },
  },
]

export interface EnforceResult {
  outcomes: InvariantOutcome[]
  /** Invariants that did not hold and were fixed. */
  repaired: InvariantOutcome[]
  /** Invariants that did not hold and could NOT be fixed. */
  failed: InvariantOutcome[]
}

/**
 * Enforce every invariant that applies to this trigger.
 *
 * An invariant that THROWS is recorded as `failed` and the rest still run: one
 * broken guarantee must not cancel the others (the whole reason the old
 * copy-pasted try/catch blocks existed — now written once).
 */
export async function enforceAgentInvariants(ctx: AgentInvariantContext): Promise<EnforceResult> {
  const outcomes: InvariantOutcome[] = []

  for (const inv of AGENT_INVARIANTS) {
    if (!inv.triggers.includes(ctx.trigger)) continue
    try {
      outcomes.push(await inv.enforce(ctx))
    } catch (err) {
      outcomes.push({
        id: inv.id,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    outcomes,
    repaired: outcomes.filter((o) => o.status === 'repaired'),
    failed: outcomes.filter((o) => o.status === 'failed'),
  }
}

/** One line per agent, only when something actually drifted. Silence is the steady state. */
export function formatEnforceResult(agent: string, r: EnforceResult): string | null {
  if (r.repaired.length === 0 && r.failed.length === 0) return null
  const parts = [...r.repaired, ...r.failed].map(
    (o) => `${o.id}=${o.status}${o.detail ? ` (${o.detail})` : ''}`
  )
  return `${agent}: ${parts.join(' · ')}`
}

// ── The single watchdog ────────────────────────────────────────────────────

/** 0 disables it. Default 5 min: cheap, and it bounds how long a broken invariant lives. */
const WATCHDOG_INTERVAL_MS = Math.max(
  0,
  Number(process.env.AIM_INVARIANTS_WATCHDOG_INTERVAL_MS) || 300_000
)

let watchdogTimer: NodeJS.Timeout | null = null

export interface WatchdogAgent {
  agentId: string
  agentName?: string
  workdir: string
  clientType: ClientType
}

/**
 * The ONE periodic enforcement loop. Runs the `periodic`-safe invariants across
 * every agent the supplier returns.
 *
 * This is what makes the guarantees hold for an agent that is never woken, and
 * what bounds the lifetime of a tamper to one interval instead of leaving the
 * repair schedule to the process that did the tampering.
 *
 * Idempotent (a second call is a no-op — two loops would double every sweep) and
 * `unref`'d, so it never holds the process open at shutdown. Never throws: an
 * invariant sweep must not be able to take the server down.
 */
export function startAgentInvariantsWatchdog(
  listAgents: () => readonly WatchdogAgent[],
  intervalMs: number = WATCHDOG_INTERVAL_MS
): boolean {
  if (watchdogTimer !== null || intervalMs <= 0) return false

  watchdogTimer = setInterval(() => {
    void (async () => {
      try {
        for (const a of listAgents()) {
          const r = await enforceAgentInvariants({ ...a, trigger: 'periodic' })
          const line = formatEnforceResult(a.agentName || a.agentId, r)
          if (line) console.warn(`[InvariantsWatchdog] ${line}`)
        }
      } catch (err) {
        console.warn('[InvariantsWatchdog] sweep failed:', err instanceof Error ? err.message : err)
      }
    })()
  }, intervalMs)

  watchdogTimer.unref?.()
  return true
}

/** Stop the watchdog (tests, graceful shutdown). */
export function stopAgentInvariantsWatchdog(): void {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
}
