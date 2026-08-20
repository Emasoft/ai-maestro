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
import { mkdir, readFile } from 'fs/promises'
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
 * Client tools an agent inside the ai-maestro harness may NOT use (USER directive
 * 2026-08-20: "inside the ai-maestro harness the SendMessage functionality will be
 * blocked, and the agents must be forced to only use AMP messaging").
 *
 * WHY the client's own cross-session `SendMessage` is not an acceptable second channel:
 * AMP (`amp-send.sh` → the server's SendMessage AIO pipeline) is gated by the R6
 * communication graph, carries the sender's verified AID, and is logged. The client tool
 * is none of those — it addresses another session by NAME, so a MEMBER could message a
 * MANAGER directly, around its CHIEF-OF-STAFF, with nothing recording that it happened.
 * Two channels for one thing means the governed one is optional; denying the tool is what
 * makes AMP the only door.
 *
 * This binds AGENT WORKDIRS only. A human's own Claude session (this repo included) is
 * not a registered agent workdir and keeps the tool.
 */
export const HARNESS_DENIED_TOOLS: readonly string[] = ['SendMessage']

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
    id: 'amp-only-messaging',
    // A pure settings write — same class as dep-rules, safe on the timer.
    description: 'the client peer-messaging tool is DENIED in the workdir — inside the harness agents talk over AMP only',
    triggers: ['create', 'wake', 'periodic'],
    async enforce({ workdir }: AgentInvariantContext) {
      const { readSettings, editSettings } = await import('@/lib/settings-gate')
      const path = join(workdir, '.claude', 'settings.local.json')

      const read = await readSettings(path)
      // MISSING is the first-run case and must still be repaired (editSettings creates
      // it). UNREADABLE must NOT be: a lenient read here would rebuild the file from
      // `{}` and destroy whatever the agent actually has.
      if (!read.ok && read.reason === 'unreadable') {
        return { id: 'amp-only-messaging', status: 'failed', detail: `settings.local.json unreadable: ${read.error ?? 'parse error'}` }
      }

      const permissions = read.ok ? read.data.permissions : undefined
      const existing = (permissions && typeof permissions === 'object' && !Array.isArray(permissions))
        ? (permissions as Record<string, unknown>).deny
        : undefined
      const deny = Array.isArray(existing) ? existing.filter((e): e is string => typeof e === 'string') : []

      const missing = HARNESS_DENIED_TOOLS.filter((t) => !deny.includes(t))
      if (missing.length === 0) return { id: 'amp-only-messaging', status: 'ok' }

      // Read-then-write outside the lock: the write itself is lock-guarded, this
      // watchdog is the only writer of THIS key, and a lost update is repaired on the
      // next periodic beat. Not worth a read-modify-write primitive of its own.
      await editSettings(path, [{ op: 'set', keyPath: ['permissions', 'deny'], value: [...deny, ...missing] }])
      return { id: 'amp-only-messaging', status: 'repaired', detail: `denied ${missing.join(', ')}` }
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

  {
    id: 'role-plugin',
    // WAKE ONLY — the same contract as core-plugin, for the same reason: the
    // repair shells out to `claude plugin install` (network I/O, a package
    // manager), which must never run unattended on the periodic loop. A test
    // pins triggers === ['wake'] so a future edit cannot quietly turn the
    // watchdog into a background plugin installer (TRDD-CNF1X3J7 Gate 2).
    description: "the agent's role-plugin is INSTALLED, not merely enabled — `claude --agent` exits when it is missing",
    triggers: ['wake'],
    async enforce(ctx: AgentInvariantContext) {
      // The verifiable failure mode is Claude-specific today (`claude plugin
      // list` is the ground truth). Other clients: skip, never falsely refuse.
      if (ctx.clientType !== 'claude') {
        return { id: 'role-plugin', status: 'skipped', detail: `no CLI check for client "${ctx.clientType}"` }
      }

      // Resolve WHICH plugin is this agent's ROLE. The scanner's quad-match
      // only sees plugins whose files exist on disk, so in the exact state
      // this gate exists for — enabled in settings.local.json but absent from
      // the install cache (the 2026-07-12 outage) — it returns null. The
      // launch args are the truthful fallback: `--agent <plugin>-main-agent`
      // names precisely what the client will try (and fail) to load.
      const { scanAgentLocalConfig } = await import('@/services/agent-local-config-service')
      const scanned = scanAgentLocalConfig(ctx.agentId).data?.rolePlugin ?? null
      let name = scanned?.name ?? null
      if (!name) {
        const { getAgent } = await import('@/lib/agent-registry')
        const m = getAgent(ctx.agentId)?.programArgs?.match(/--agent[= ]+["']?([A-Za-z0-9_-]+)-main-agent/)
        name = m ? m[1] : null
      }
      if (!name) {
        // No role resolvable anywhere. Policing R9.13 (every agent carries
        // exactly one ROLE) belongs to CreateAgent/ChangeTitle; with no
        // `--agent` flag there is nothing for the client to fail on, so
        // skipping here cannot mask the outage this gate guards against.
        return { id: 'role-plugin', status: 'skipped', detail: 'no role-plugin resolvable' }
      }

      // Marketplace: the scan knows it when the files exist; otherwise the
      // settings key suffix IS the marketplace; otherwise predefined names
      // ship from the GitHub marketplace and customs from the local one.
      const { MARKETPLACE_NAME, LOCAL_MARKETPLACE_NAME, PREDEFINED_ROLE_PLUGIN_NAMES } = await import('@/lib/ecosystem-constants')
      let marketplace = scanned?.marketplace ?? null
      if (!marketplace) {
        try {
          const raw = await readFile(join(ctx.workdir, '.claude', 'settings.local.json'), 'utf8')
          const settings = JSON.parse(raw) as { enabledPlugins?: Record<string, boolean> }
          const key = Object.keys(settings.enabledPlugins ?? {}).find((k) => k.startsWith(`${name}@`))
          if (key) marketplace = key.slice(name.length + 1)
        } catch {
          // no settings file / unparsable — fall through to the defaults
        }
      }
      if (!marketplace) {
        marketplace = (PREDEFINED_ROLE_PLUGIN_NAMES as readonly string[]).includes(name)
          ? MARKETPLACE_NAME
          : LOCAL_MARKETPLACE_NAME
      }
      const pluginKey = `${name}@${marketplace}`

      // Ground truth is `claude plugin list` — NEVER settings.local.json,
      // which is exactly the file that lies in the enabled-but-not-installed
      // state (see lib/claude-plugin-list.ts). Any enabled scope counts as
      // installed: a user-scope install also makes `claude --agent` resolve.
      const { listInstalledClaudePlugins } = await import('@/lib/claude-plugin-list')
      const installed = await listInstalledClaudePlugins(ctx.workdir)
      const hit = installed.find((p) => p.id === pluginKey && p.enabled)
      if (hit) return { id: 'role-plugin', status: 'ok', detail: `${pluginKey} (${hit.scope})` }

      const { InstallElement } = await import('@/services/element-management-service')
      const { buildSystemAuthContext } = await import('@/lib/agent-auth')
      const auth = (ctx.authContext as Parameters<typeof InstallElement>[1] | undefined)
        || buildSystemAuthContext('agent-invariant-role-plugin')

      const result = await InstallElement({
        name,
        marketplace,
        action: 'install',
        scope: 'local',
        agentDir: ctx.workdir,
        agentId: ctx.agentId,
        clientType: ctx.clientType,
      }, auth)

      return result.success
        ? { id: 'role-plugin', status: 'repaired', detail: `installed ${pluginKey}` }
        : { id: 'role-plugin', status: 'failed', detail: result.error || `install of ${pluginKey} failed` }
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
/** The sweep currently running, so a stop can await it rather than race it. */
let inFlightSweep: Promise<void> | null = null
/** Set by stop(); checked between agents so a stop takes effect promptly. */
let stopping = false

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

  stopping = false

  watchdogTimer = setInterval(() => {
    // ── ONE SWEEP AT A TIME (TRDD-L541EREU) ──
    //
    // A sweep that outlives its interval used to be joined by the next tick, and two
    // concurrent sweeps break this loop in two ways:
    //
    //   1. THE REPAIR OPENS THE TAMPER WINDOW IT EXISTS TO CLOSE. `ensureAgentRules`
    //      overwrites a rule whose bytes differ, and `writeProtected` must first
    //      `chmod 0o644` to defeat its own 0444 protection. `writeFile` is not atomic,
    //      so a concurrent sweep reads a PARTIALLY-written rule, concludes "bytes
    //      differ", and chmods it writable — a DEP rule is transiently writable
    //      *because* the watchdog is repairing it. Caught as `expected 420 to be 292`
    //      (0o644 vs 0o444) in agent-invariants.test.ts under full-suite load.
    //   2. `stop()` LIES. The `.finally` below nulls a SHARED variable, so sweep A
    //      finishing cleared sweep B's handle and `stop()` returned while B was still
    //      writing — exactly the bug TRDD-F4UUM8RZ fixed, surviving in the overlap case.
    //
    // Skipping is correct, not lossy: the sweep is idempotent enforcement, so a tick
    // that finds one already running has nothing of its own to add.
    if (inFlightSweep !== null) return

    // Hold the sweep so stopAgentInvariantsWatchdog() can AWAIT it. Without this
    // the sweep is fire-and-forget and `stop()` stops only the SCHEDULE: an
    // in-flight sweep keeps running, and it is a WRITER (it re-creates .claude/,
    // rewrites the shipped aimaestro-*.md rules, seeds the git-exclude block). A
    // caller that stops the watchdog and then removes a workdir would therefore
    // race a process that puts files back — the re-appearing-workdir class of bug
    // (TRDD-KERM18NX). TRDD-F4UUM8RZ.
    const sweep = (async () => {
      // Fleet-level check, ONCE per sweep, BEFORE the per-agent loop — never
      // per-agent. The keychain-blindness this detects is a property of the
      // tmux SERVER every pane is forked from, not of any one agent's workdir,
      // so running it per-agent would both waste the sweep and turn one root
      // cause into N alarm lines (TRDD-78J4I4QS). A sweep failure here must not
      // cancel the per-agent invariants below — same isolation contract as the
      // outer catch two lines down.
      try {
        const { sweepTmuxServerKeychain } = await import('@/lib/tmux-server-keychain-watchdog')
        await sweepTmuxServerKeychain()
      } catch (err) {
        console.warn('[InvariantsWatchdog] tmux-server-keychain sweep failed:', err instanceof Error ? err.message : err)
      }

      try {
        for (const a of listAgents()) {
          // Stop BETWEEN agents, never inside one. An invariant repair is itself a
          // short write sequence, so aborting halfway would leave exactly the
          // partial state R51 forbids; finishing the current agent and then
          // stopping is the correct granularity.
          if (stopping) break
          const r = await enforceAgentInvariants({ ...a, trigger: 'periodic' })
          const line = formatEnforceResult(a.agentName || a.agentId, r)
          if (line) console.warn(`[InvariantsWatchdog] ${line}`)
        }
      } catch (err) {
        console.warn('[InvariantsWatchdog] sweep failed:', err instanceof Error ? err.message : err)
      }
    })()
    inFlightSweep = sweep
    // Cleared only by the sweep that SET it. With the guard above there is never a
    // second sweep to clobber it, and the identity check costs one comparison to make
    // that true independently of the guard staying correct.
    void sweep.finally(() => { if (inFlightSweep === sweep) inFlightSweep = null })
  }, intervalMs)

  watchdogTimer.unref?.()
  return true
}

/**
 * Stop the watchdog (tests, graceful shutdown) AND wait for the in-flight sweep.
 *
 * Returns a promise that resolves only once no sweep is still writing. That is the
 * whole point: the previous `void` version cleared the interval and returned while
 * a sweep kept re-creating files, so "stopped" was not a state any caller could
 * rely on before deleting a workdir. Existing fire-and-forget call sites still
 * compile; a caller that needs the guarantee awaits it (TRDD-F4UUM8RZ).
 */
export function stopAgentInvariantsWatchdog(): Promise<void> {
  stopping = true
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  return inFlightSweep ?? Promise.resolve()
}
