/**
 * Element Management Service
 *
 * Centralized gateway for ALL plugin install/uninstall/enable/disable operations.
 * Consolidates scattered logic from role-plugin-service.ts into one place.
 *
 * Functions moved here from role-plugin-service.ts:
 *   - installPluginLocally()
 *   - uninstallPluginLocally()
 *   - autoAssignRolePluginForTitle()
 *   - uninstallAllRolePlugins()
 *   - syncRolePlugin() (renamed from syncRolePluginForTitle)
 *
 * New wrapper functions:
 *   - installPlugin()    — general plugin install with role-plugin guard
 *   - uninstallPlugin()  — general plugin uninstall
 *   - enablePlugin()     — enable a disabled plugin
 *   - disablePlugin()    — disable without uninstalling
 *
 * All settings.json writes are serialized via withSettingsLock() to prevent
 * concurrent read-modify-write races.
 */

import type { AgentRole } from '@/types/agent'
import { join } from 'path'
import { homedir } from 'os'
import { statePath } from '@/lib/ecosystem-constants'
import { mkdir, writeFile, readFile, rm, copyFile, readdir, stat, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  MARKETPLACE_NAME as GITHUB_MARKETPLACE_NAME_IMPORT,
  LOCAL_MARKETPLACE_NAME,
  LOCAL_MARKETPLACE_DIR_NAME,
  CUSTOM_MARKETPLACE_NAME,
  MAIN_PLUGIN_NAME,
  PREDEFINED_ROLE_PLUGIN_NAMES,
  ROLE_PLUGIN_MAIN_AGENTS,
  TITLE_PLUGIN_MAP as ECOSYSTEM_TITLE_PLUGIN_MAP,
} from '@/lib/ecosystem-constants'

const execFileAsync = promisify(execFile)

// ── Auth context (Phase 1: optional, Phase 2: required per SF-058) ──
import type { AuthContext } from '@/lib/agent-auth'

// ── Adapter calling-context sentinel (R21.4 enforcement) ────────
// Every adapter mutation call (install/uninstall/enable/disable) MUST
// be wrapped in inAdapterContext('<AIO name>', () => adapter.X(...))
// so the adapter's runtime guard recognises it as a legitimate caller.
import { inAdapterContext } from '@/lib/client-plugin-adapters/adapter-context'

// ── Per-op ledger emit helper (TRDD-eac02238) ───────────────────
// Every Change* pipeline calls this right before returning success.
// Wraps emitAgentOp with a try/catch + ops.push so a ledger append
// failure never blocks the pipeline response and always leaves a
// breadcrumb in the operations log. Centralised here so the boilerplate
// stays in ONE place instead of repeated at ~15 success sites.
async function tryEmitLedgerOp(
  op: import('@/types/ledger').LedgerOp,
  diff: import('@/types/json-patch').JsonPatch,
  authContext: AuthContext | null | undefined,
  action: string,
  ops: string[],
): Promise<void> {
  try {
    const { emitAgentOp } = await import('@/lib/ledger-emit')
    emitAgentOp(op, diff, {
      action,
      agentId: authContext?.agentId ?? null,
      actor: authContext?.agentId ? 'agent' : 'user',
    })
  } catch (ledgerErr) {
    ops.push(`LEDGER: WARN — per-op append failed: ${ledgerErr instanceof Error ? ledgerErr.message : ledgerErr}`)
  }
}

// ── Paths ─────────────────────────────────────────────────────
const HOME = homedir()
const ROLE_PLUGINS_DIR = join(HOME, 'agents', LOCAL_MARKETPLACE_DIR_NAME)
const PLUGINS_DIR = join(ROLE_PLUGINS_DIR, 'plugins')
const CLAUDE_DIR = join(HOME, '.claude')
// User-global Claude Code settings. NOT settings.local.json (which is a
// project-only override). Claude CLI stores user-scope enabledPlugins and
// extraKnownMarketplaces in ~/.claude/settings.json — see BUG-POLLUTION-001.
const USER_GLOBAL_SETTINGS = join(CLAUDE_DIR, 'settings.json')
const INSTALLED_FILE = join(CLAUDE_DIR, 'plugins', 'installed_plugins.json')

// Local marketplace name — for custom Haephestos-generated role-plugins
const MARKETPLACE_NAME = LOCAL_MARKETPLACE_NAME

// ── Shared Gate 0: Authorization helper for all Change* functions ────
// Each Change* function calls this as Gate 0. The action determines the rules:
// - 'change-title': only MANAGER/COS, never self (strictest)
// - 'modify-agent': system-owner/MANAGER/COS/self (default for most properties)
// Returns null if allowed, error string if denied.
async function gate0Auth(
  action: import('@/lib/authorization').AuthAction,
  agentId: string,
  authContext: AuthContext,
  ops: string[]
): Promise<string | null> {
  // Security invariant (Apr 2026): authContext is MANDATORY for every call.
  // There is no "internal call" bypass anymore — internal callers (server
  // startup, scheduled tasks, tests) MUST construct a SystemAuthContext via
  // lib/agent-auth.ts::buildSystemAuthContext() which goes through the same
  // authorization pipeline as user/agent contexts. Previously, a missing
  // authContext was silently treated as "authorized" which allowed any route
  // that forgot to pass it to bypass all security checks.
  if (authContext.isSystemOwner) {
    ops.push('G00: System-owner — authorized')
    return null
  }
  const { authorize } = await import('@/lib/authorization')
  // CC-GOV-004: Pass governanceTitle and teamId to avoid redundant registry lookups.
  // M1 fix (2026-06-19 R26-R40 audit): also forward userId/userTitle so authorize()
  // can apply its deny-by-default rule for a model-ON non-system-owner USER. Without
  // these, a non-maestro user (userTitle 'user', no agentId) was stripped to a
  // no-agentId authResult and slipped into authorize()'s legacy system-owner grant.
  // isSystemOwner was already false for such a user (buildAuthContext), so the
  // short-circuit above is not taken — the deny now fires in authorize(). Flag-OFF:
  // a web session has no userId, so this changes nothing (still system-owner above);
  // an agent caller has no userId either, so its existing authz is unaffected.
  const authResult: import('@/lib/agent-auth').AgentAuthResult = {
    agentId: authContext.agentId,
    governanceTitle: authContext.governanceTitle,
    teamId: authContext.teamId,
    userId: authContext.userId,
    userTitle: authContext.userTitle,
  }
  const authz = authorize(authResult, action, agentId)
  if (!authz.allowed) {
    ops.push(`G00: DENIED — ${authz.reason}`)
    return authz.reason || 'Not authorized'
  }
  ops.push(`G00: Authorized (caller=${authContext.agentId}, action=${action})`)
  return null
}

// ── R40 foreign-user per-command guard ──────────────────────────
//
// R40.1: a non-native (foreign) USER needs MAESTRO approval for EVERY agent or
// team creation; R40.2: the MANAGER may restrict specific API commands per
// foreign user. The restrictable command set for v1 (decision D5) is
// {create_agent, create_team}. A foreign user may run such a command ONLY when
// its ForeignApprovalEntry grants it (grantedCommands).
//
// NATURALLY INERT WHEN THE USER-AUTHORITY MODEL IS OFF: with the model off,
// buildAuthContext never sets authContext.userId (no user identity is resolved),
// so isForeignUser() is false and assertForeignUserMayCall() always allows —
// zero behavior change for the single-operator deployment.

/** The R40.2 restrictable command set (v1). */
export const R40_RESTRICTABLE_COMMANDS: ReadonlySet<string> = new Set(['create_agent', 'create_team'])

/**
 * Is the caller a FOREIGN human user? True only when an authenticated user id is
 * present AND its registry record exists with native===false. A native user, the
 * MAESTRO/system-owner, and any agent caller are NOT foreign users.
 */
export async function isForeignUser(authContext: AuthContext | null | undefined): Promise<boolean> {
  if (!authContext?.userId) return false
  try {
    const { getUser } = await import('@/lib/user-registry')
    const rec = getUser(authContext.userId)
    return !!rec && rec.native === false
  } catch {
    // Fail toward LESS restriction on a registry glitch — R40 only ADDS a gate
    // for foreign users; if we cannot prove the user is foreign, treat as native
    // (the user's own AID approval gate in agent-auth already fenced foreign users).
    return false
  }
}

/**
 * R40 guard — throw-free deny check. Returns an error string when a foreign user
 * is NOT permitted to run `command`, else null (allowed). `command` must be one
 * of R40_RESTRICTABLE_COMMANDS. A native/MAESTRO/agent caller is always allowed
 * here (their authority is governed elsewhere — R38/R28/gate0Auth).
 */
export async function assertForeignUserMayCall(
  authContext: AuthContext | null | undefined,
  command: string,
): Promise<string | null> {
  if (!(await isForeignUser(authContext))) return null
  // It IS a foreign user. Only restrictable commands are gated by R40.2; a
  // non-restrictable command falls through to the normal R38 path.
  if (!R40_RESTRICTABLE_COMMANDS.has(command)) return null
  try {
    const { getUser } = await import('@/lib/user-registry')
    const { loadForeignApprovals } = await import('@/lib/foreign-approval-registry')
    const rec = getUser(authContext!.userId!)
    const fp = rec?.aid
    if (!fp) {
      return `R40: foreign user has no AID on record; "${command}" denied`
    }
    // Find this user's approval entry (kind:'user') by fingerprint.
    const grant = loadForeignApprovals().find(e => e.kind === 'user' && e.fingerprint === fp)
    if (grant && grant.status === 'approved' && (grant.grantedCommands ?? []).includes(command)) {
      return null
    }
    return `R40: foreign user is not granted "${command}" by the MAESTRO`
  } catch (err) {
    // Fail CLOSED for a foreign user on a restrictable command — R40 is a
    // security ADD; a glitch must not silently grant a foreign user create rights.
    return `R40: could not verify foreign-user grant for "${command}" (${err instanceof Error ? err.message : 'error'})`
  }
}

// GitHub marketplace for predefined role plugins
export const GITHUB_MARKETPLACE_NAME = GITHUB_MARKETPLACE_NAME_IMPORT

// ── Predefined role plugins (from ecosystem-constants) ────────

/** The 7 predefined AI Maestro role plugins keyed by name */
export const PREDEFINED_ROLE_PLUGINS: Record<string, { marketplace: string; mainAgent: string }> =
  Object.fromEntries(
    PREDEFINED_ROLE_PLUGIN_NAMES.map(name => [
      name,
      { marketplace: GITHUB_MARKETPLACE_NAME, mainAgent: ROLE_PLUGIN_MAIN_AGENTS[name] },
    ])
  )

// ── Title → plugin mapping (lower-case keys for API compat) ──

const TITLE_PLUGIN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ECOSYSTEM_TITLE_PLUGIN_MAP).map(([k, v]) => [k.toLowerCase(), v])
)

// ── JSON helpers ──────────────────────────────────────────────

async function loadJsonSafe(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveJsonSafe(path: string, data: Record<string, unknown>): Promise<void> {
  // MAJ-01 fix (2026-05-04) — atomic write via tmp + rename.
  // Previous version wrote directly to `path`. A crash mid-write
  // (OOM kill, SIGKILL, power cut) left the JSON file partially
  // written, which is unrecoverable for downstream loaders that
  // strict-parse it (registry.json, teams.json, settings.local.json).
  // The write-tmp + rename pattern is atomic on POSIX same-filesystem
  // moves: a reader either sees the old content or the new content,
  // never a torn file. The tmp filename embeds pid + a counter so
  // two saveJsonSafe calls for different files (or the same file
  // serialised by withSettingsLock) cannot collide on the tmp slot.
  const dir = join(path, '..')
  await mkdir(dir, { recursive: true })
  const tmpPath = `${path}.tmp.${process.pid}.${++_atomicWriteCounter}`
  const payload = JSON.stringify(data, null, 2) + '\n'
  try {
    await writeFile(tmpPath, payload, 'utf-8')
    await rename(tmpPath, path)
  } catch (err) {
    // Best-effort cleanup of the orphan tmp file; ignore errors here
    // because the caller already knows the rename failed.
    try { await rm(tmpPath, { force: true }) } catch {}
    throw err
  }
}

// Module-local counter for atomic-write tmp filenames. Combined with
// process.pid this is unique per write within a single process.
let _atomicWriteCounter = 0

// ── Settings mutex ────────────────────────────────────────────
//
// MAJ-02 fix (2026-05-04) — cross-process exclusion via a sibling
// lockfile (`.lock` directory next to the target file). The previous
// version was a process-local Promise queue, which serialises within
// a single Node process but cannot prevent two processes (PM2 cluster
// mode, simultaneous full + headless servers, test harness + dev
// server) from interleaving writes to the same JSON file. mkdir is
// atomic on POSIX — only the first concurrent process wins; others
// poll for release. A stale-lock recovery valve breaks lockdirs older
// than STALE_LOCK_MS so a crashed process cannot deadlock writers
// indefinitely.

const settingsLocks = new Map<string, Promise<void>>()
const STALE_LOCK_MS = 30_000
const LOCK_POLL_MS = 50
const LOCK_MAX_WAIT_MS = 10_000

async function _acquireFileLock(filePath: string): Promise<() => Promise<void>> {
  const lockDir = `${filePath}.lock`
  const start = Date.now()
  while (true) {
    try {
      // mkdir without `recursive` is atomic — fails with EEXIST if dir
      // already exists. That's the lock-held signal.
      await mkdir(lockDir, { recursive: false })
      // Acquired. Return a releaser that removes the lockdir.
      return async () => { try { await rm(lockDir, { recursive: true, force: true }) } catch {} }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EEXIST') throw err
      // Already held — check if it's stale.
      try {
        const st = await stat(lockDir)
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          // Break the stale lock; another caller may have done the
          // same in parallel — that's fine, mkdir below will sort it.
          try { await rm(lockDir, { recursive: true, force: true }) } catch {}
          continue
        }
      } catch {
        // stat failed (lock disappeared) — retry mkdir
        continue
      }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        throw new Error(`withSettingsLock: timeout waiting for ${lockDir}`)
      }
      await new Promise(r => setTimeout(r, LOCK_POLL_MS))
    }
  }
}

async function withSettingsLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  // In-process queue keeps the existing within-process serialisation
  // semantics (so concurrent withSettingsLock calls from the same Node
  // process don't compete for the cross-process lock).
  const key = filePath
  const prev = settingsLocks.get(key) ?? Promise.resolve()
  let resolve: () => void
  const next = new Promise<void>(r => { resolve = r })
  settingsLocks.set(key, next)
  try {
    await prev
    // Also acquire the cross-process file lock so other Node
    // processes (PM2 cluster, headless + full mode, tests) cannot
    // interleave with us.
    const release = await _acquireFileLock(filePath)
    try {
      return await fn()
    } finally {
      await release()
    }
  } finally {
    resolve!()
    if (settingsLocks.get(key) === next) settingsLocks.delete(key)
  }
}

// ══════════════════════════════════════════════════════════════
// InstallElement — All-in-one plugin/marketplace/element installer
// ══════════════════════════════════════════════════════════════
//
// SINGLE ENTRY POINT for all installation operations in AI Maestro.
// Replaces scattered `claude plugin install`, `claude plugin marketplace add`,
// `execSync('claude plugin ...')` calls throughout the codebase.
//
// Every caller (CreateAgent G11, wakeAgent R17 gate, server.mjs startup,
// register-agent-from-session, API routes) MUST use this function.

/** Known marketplace identifiers that map to specific behaviors */
type KnownMarketplace = 'ai-maestro-plugins' | 'ai-maestro-local-roles-marketplace' | 'ai-maestro-local-custom-marketplace'
type MarketplaceRef = KnownMarketplace | string  // string = GitHub org/repo URL or custom marketplace name

/** Client types supported by the cross-client conversion pipeline */
type ClientType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' | 'unknown'

export interface InstallElementResult {
  success: boolean
  operations: string[]
  error?: string
  /** CLI stdout (for diagnostics sent to MANAGER/COS on failure) */
  stdout?: string
  /** CLI stderr */
  stderr?: string
  /** True if the agent's client session needs restarting for the change to take effect */
  restartNeeded?: boolean
}

/**
 * All-in-one element installer. Handles marketplace registration, plugin
 * install/uninstall/enable/disable/update, cross-client conversion, and
 * scope enforcement — all in a single gated pipeline.
 *
 * PRE-EXECUTION GATES (14 gates, each checks ONE condition):
 *   G00: Validate element name format
 *   G01: Validate marketplace provided
 *   G02: Validate action (install|uninstall|enable|disable|update)
 *   G03: Validate scope (local|user)
 *   G04: Resolve agent context (agentDir, clientType from registry)
 *   G05: Validate agentDir for local scope
 *   G06: Path security — reject traversal
 *   G07: Verify directory exists (or create .claude/ for install)
 *   G08: Core plugin guard (R17.14–R17.17 — cannot uninstall/disable/user-scope)
 *   G09: Role-plugin guard (predefined role-plugins via ChangeTitle only)
 *   G10: Idempotency check (skip execution if already in desired state)
 *   G11: Ensure marketplace is registered
 *   G12: Detect client type and conversion need
 *   G13: Convert via Universal Plugin IR (if non-Claude client)
 *
 * EXECUTION:
 *   EXE: Execute action (CLI with fallback to direct settings write)
 *
 * POST-EXECUTION GATES (always run, even for idempotent results):
 *   PG01: Verify action took effect (read back settings)
 *   PG02: Update registry flags (corePluginMissing)
 *   PG03: Scope consistency — disable core plugin at user scope if found (R17.17)
 *   PG04: Title-plugin binding repair (R11) — via ChangeTitle() if titled agent lost role-plugin
 *   PG05: Core plugin defense in depth — via recursive InstallElement() if G08 was bypassed
 *   PG06: Team composition integrity (R12) — flag team as non-functional if missing required titles
 *   PG07: Duplicate scope detection — disable user-scope copy if same plugin installed locally
 *   PG08: Restart notification — signal agent needs client restart
 */
export async function InstallElement(
  desired: {
    name: string                       // Plugin or element name (e.g. "ai-maestro-plugin")
    marketplace: MarketplaceRef        // Marketplace to install from
    action: 'install' | 'uninstall' | 'enable' | 'disable' | 'update'
    scope: 'local' | 'user'           // local = agent's settings.local.json, user = ~/.claude/settings.local.json
    agentDir?: string                  // Required for local scope
    agentId?: string                   // Agent ID (for registry flag updates)
    clientType?: ClientType            // If known; auto-detected from agent registry if agentId provided
    /** Bypass role-plugin guard (for ChangeTitle pipeline calling internally) */
    rolePluginSwap?: boolean
  },
  authContext: AuthContext,
): Promise<InstallElementResult> {
  const ops: string[] = []
  const result: InstallElementResult = { success: false, operations: ops }

  try {
    // ── G-AUTH: Authorization (CRIT-07 fix, 2026-05-04) ──────
    // InstallElement was previously the WIDEST hole in the auth surface:
    // it had no authContext parameter at all, so any caller — internal,
    // external, route handler, background task — could install or uninstall
    // any plugin (including the role-plugin) on any agent. Hard-reject on
    // missing authContext, then run gate0Auth('manage-skills'). Internal
    // callers (server startup, ChangeTitle pipeline, wake-on-R17) must
    // pass either the real route authContext or buildSystemAuthContext().
    if (!authContext) {
      result.error = 'authContext is mandatory for InstallElement (security invariant)'
      ops.push('G-AUTH: DENIED — missing authContext')
      return result
    }
    {
      const g0err = await gate0Auth('manage-skills', desired.agentId || '', authContext, ops)
      if (g0err) { result.error = g0err; return result }
    }

    const { name, marketplace, action, scope } = desired
    let agentDir = desired.agentDir
    let clientType = desired.clientType || 'claude'
    let agentProgram = ''

    // ═══════════════════════════════════════════════════════════
    // PRE-EXECUTION GATES
    // ═══════════════════════════════════════════════════════════

    // ── G00: Validate element name format ─────────────────────
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      result.error = `Invalid element name "${name}". Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
      ops.push(`G00: DENIED — invalid name "${name}"`)
      return result
    }
    ops.push(`G00: Name "${name}" valid`)

    // ── G01: Validate marketplace ─────────────────────────────
    if (!marketplace) {
      result.error = 'Marketplace is required'
      ops.push(`G01: DENIED — marketplace missing`)
      return result
    }
    ops.push(`G01: Marketplace "${marketplace}" provided`)

    // ── G02: Validate action ──────────────────────────────────
    if (!['install', 'uninstall', 'enable', 'disable', 'update'].includes(action)) {
      result.error = `Invalid action "${action}". Must be install|uninstall|enable|disable|update`
      ops.push(`G02: DENIED — invalid action`)
      return result
    }
    ops.push(`G02: Action "${action}" valid`)

    // ── G03: Validate scope ───────────────────────────────────
    if (!['local', 'user'].includes(scope)) {
      result.error = `Invalid scope "${scope}". Must be local|user`
      ops.push(`G03: DENIED — invalid scope`)
      return result
    }
    ops.push(`G03: Scope "${scope}" valid`)

    // ── G04: Resolve agent context ────────────────────────────
    if (scope === 'local' && !agentDir && desired.agentId) {
      const { getAgent } = await import('@/lib/agent-registry')
      const ag = getAgent(desired.agentId)
      if (ag?.workingDirectory) {
        agentDir = ag.workingDirectory
        agentProgram = ag.program || ''
        if (!desired.clientType) {
          const { detectClientType } = await import('@/lib/client-capabilities')
          clientType = detectClientType(agentProgram) as ClientType
        }
        ops.push(`G04: Resolved from registry — dir="${agentDir}", client="${clientType}"`)
      } else {
        result.error = `Agent ${desired.agentId} has no workingDirectory in registry`
        ops.push(`G04: DENIED — agent has no workingDirectory`)
        return result
      }
    } else if (scope === 'local' && agentDir && desired.agentId && !desired.clientType) {
      const { getAgent } = await import('@/lib/agent-registry')
      const ag = getAgent(desired.agentId)
      if (ag?.program) {
        const { detectClientType } = await import('@/lib/client-capabilities')
        clientType = detectClientType(ag.program) as ClientType
        agentProgram = ag.program
      }
      ops.push(`G04: Client type resolved from registry — "${clientType}"`)
    } else {
      ops.push(`G04: Using provided context — dir="${agentDir || 'N/A'}", client="${clientType}"`)
    }

    // ── G05: Validate agentDir for local scope ────────────────
    if (scope === 'local' && !agentDir) {
      result.error = 'agentDir is required for local scope (or provide agentId for auto-resolution)'
      ops.push(`G05: DENIED — no agentDir for local scope`)
      return result
    }
    ops.push(`G05: agentDir ${scope === 'local' ? `"${agentDir}"` : 'N/A (user scope)'}`)

    // ── G06: Path security — reject traversal ─────────────────
    if (agentDir) {
      agentDir = agentDir.startsWith('~') ? agentDir.replace('~', HOME) : agentDir
      if (agentDir.includes('..')) {
        result.error = 'agentDir must not contain ".." (path traversal rejected)'
        ops.push(`G06: DENIED — path traversal`)
        return result
      }
      ops.push(`G06: Path safe — no traversal`)
    } else {
      ops.push(`G06: No agentDir — skipped`)
    }

    // ── G07: Verify directory exists (or create for install) ──
    //
    // CLIENT CAPABILITY GATE (SCEN-008): For non-Claude clients without
    // plugin support (gemini, opencode, aider), refuse to create .claude/
    // — these clients cannot read claude plugin config and the orphan dir
    // would leak claude-specific state into a non-claude agent folder.
    if (agentDir) {
      if (action === 'install') {
        const { getClientCapabilities } = await import('@/lib/client-capabilities')
        const instCaps = getClientCapabilities(agentProgram || clientType)
        if (!instCaps.plugins) {
          result.error = `Client "${clientType}" has no plugin support — refusing to install "${name}". InstallElement is Claude-compatible only (writes .claude/settings.local.json).`
          ops.push(`G07: DENIED — client "${clientType}" rejects plugin install`)
          return result
        }
        await mkdir(join(agentDir, '.claude'), { recursive: true })
        ops.push(`G07: .claude/ directory ensured in ${agentDir}`)
      } else if (!existsSync(agentDir)) {
        result.error = `Agent directory does not exist: ${agentDir}`
        ops.push(`G07: DENIED — agentDir does not exist`)
        return result
      } else {
        ops.push(`G07: Directory exists — ${agentDir}`)
      }
    } else {
      ops.push(`G07: User scope — no dir check`)
    }

    // ── G08: Core plugin guard (R17.14–R17.17) ────────────────
    // SCEN-017 P1-PROP-002 hardening: use the MAIN_PLUGIN_NAME constant
    // (single source of truth in ecosystem-constants) instead of a literal
    // string, and reject BOTH install AND enable at user scope. Enable is
    // equivalent to install once a plugin is in settings.json — without
    // this, an attacker (or a stale settings file) could leave the plugin
    // disabled at user scope and then re-enable it, bypassing R17.17.
    if (name === MAIN_PLUGIN_NAME) {
      if (action === 'uninstall' || action === 'disable') {
        // Use explicit past-tense to avoid grammar error on 'uninstall' (would
        // become 'uninstalld' with naive `${action}d` template expansion).
        const pastTense = action === 'uninstall' ? 'uninstalled' : 'disabled'
        result.error = `The ${MAIN_PLUGIN_NAME} is a core system plugin and cannot be ${pastTense} (R17.14–R17.15). ` +
          `Without this plugin, the agent has no hooks, no state detection, no messaging — it cannot function.`
        ops.push(`G08: DENIED — core plugin ${action} blocked by R17`)
        return result
      }
      if ((action === 'install' || action === 'enable') && scope === 'user') {
        result.error = `The ${MAIN_PLUGIN_NAME} must NOT be ${action === 'enable' ? 'enabled' : 'installed'} at user scope (R17.17). ` +
          `User-scope ${action === 'enable' ? 'enabling' : 'installation'} would load it in ALL Claude Code projects, not just AI Maestro agents.`
        ops.push(`G08: DENIED — core plugin user-scope ${action} blocked by R17.17`)
        return result
      }
      ops.push(`G08: Core plugin — action "${action}" allowed`)
    } else {
      ops.push(`G08: Not core plugin — no R17 restrictions`)
    }

    // ── G09: Role-plugin guard ────────────────────────────────
    const isRolePlugin = !!PREDEFINED_ROLE_PLUGINS[name]
      || (PREDEFINED_ROLE_PLUGIN_NAMES as readonly string[]).includes(name)
    if (isRolePlugin && !desired.rolePluginSwap) {
      if (action === 'install' || action === 'uninstall') {
        result.error = `"${name}" is a predefined role-plugin. Role-plugins are managed via ChangeTitle(), not InstallElement(). ` +
          `Use PATCH /api/agents/{id} with governanceTitle to assign/remove roles.`
        ops.push(`EXE: DENIED — role-plugin must use ChangeTitle`)
        return result
      }
    }
    if (isRolePlugin) {
      ops.push(`EXE: Role-plugin "${name}" — ${desired.rolePluginSwap ? 'bypass active' : 'non-install action allowed'}`)
    } else {
      ops.push(`EXE: Not a role-plugin`)
    }

    // ── G10: Idempotency check ────────────────────────────────
    // Local scope → project-level settings.local.json. User scope → ~/.claude/settings.json
    // (NOT settings.local.json — see BUG-POLLUTION-001).
    const settingsPath = scope === 'local'
      ? join(agentDir!, '.claude', 'settings.local.json')
      : USER_GLOBAL_SETTINGS
    const resolvedMarketplace = resolveMarketplaceName(marketplace)
    const pluginKey = `${name}@${resolvedMarketplace}`

    {
      const currentSettings = await loadJsonSafe(settingsPath) as Record<string, Record<string, unknown>>
      const ep = (currentSettings.enabledPlugins || {}) as Record<string, boolean>
      // SCEN-012 FIX: Boundary-aware match (see PG01 comment for the false-positive
      // case this avoids — ai-maestro-plugin vs ai-maestro-plugins marketplace).
      const existingKey = Object.keys(ep).find(k => {
        const at = k.indexOf('@')
        const pluginPart = at >= 0 ? k.substring(0, at) : k
        return pluginPart === name
      })
      const currentlyInstalled = !!existingKey
      const currentlyEnabled = currentlyInstalled && ep[existingKey!] !== false

      if (action === 'install' && currentlyInstalled && currentlyEnabled) {
        ops.push(`G10: IDEMPOTENT — "${name}" already installed and enabled. Skipping.`)
        result.success = true
        // Still run post-gates to clear stale flags
      } else if (action === 'uninstall' && !currentlyInstalled) {
        ops.push(`G10: IDEMPOTENT — "${name}" not installed. Nothing to uninstall.`)
        result.success = true
      } else if (action === 'enable' && currentlyEnabled) {
        ops.push(`G10: IDEMPOTENT — "${name}" already enabled.`)
        result.success = true
      } else if (action === 'disable' && currentlyInstalled && !currentlyEnabled) {
        ops.push(`G10: IDEMPOTENT — "${name}" already disabled.`)
        result.success = true
      } else {
        ops.push(`G10: State change needed — currently ${currentlyInstalled ? (currentlyEnabled ? 'installed+enabled' : 'installed+disabled') : 'not installed'}, desired: ${action}`)
      }
    }

    // Non-Claude clients need their per-client adapter for install/uninstall
    // (copies files into client-native paths: .codex-plugin/, .agents/, etc.)
    // and for PG01 state verification. Declared here so both EXE (inside the
    // non-idempotent block) and PG01 (after the block closes) can see it.
    const useClientAdapter = clientType !== 'claude' && clientType !== 'unknown'

    // If idempotent, skip execution but still run post-gates
    if (!result.success) {

    // ── G11: Ensure marketplace is registered ─────────────────
    try {
      if (marketplace.includes('/') || marketplace === 'ai-maestro-plugins') {
        const mktRepo = marketplace.includes('/') ? marketplace : `Emasoft/${marketplace}`
        await execFileAsync('claude', ['plugin', 'marketplace', 'add', mktRepo], {
          timeout: 15000,
          cwd: agentDir || HOME,
        }).catch(() => { /* already registered */ })
        ops.push(`G11: Marketplace "${mktRepo}" registered (or already present)`)
      } else if (marketplace === 'ai-maestro-local-roles-marketplace') {
        // Local roles marketplace — verify directory exists
        const { getLocalMarketplacePath } = await import('@/lib/ecosystem-constants')
        const mktPath = getLocalMarketplacePath()
        if (existsSync(mktPath)) {
          ops.push(`G11: Local roles marketplace at ${mktPath}`)
        } else {
          ops.push(`G11: WARN — Local roles marketplace directory not found at ${mktPath}`)
        }
      } else if (marketplace === 'ai-maestro-local-custom-marketplace') {
        const { getCustomMarketplacePath } = await import('@/lib/ecosystem-constants')
        const mktPath = getCustomMarketplacePath()
        if (existsSync(mktPath)) {
          ops.push(`G11: Custom marketplace at ${mktPath}`)
        } else {
          ops.push(`G11: WARN — Custom marketplace directory not found at ${mktPath}`)
        }
      } else {
        ops.push(`G11: Custom marketplace "${resolvedMarketplace}" — assuming registered`)
      }
    } catch {
      ops.push(`G11: WARN — Marketplace registration check failed (CLI not available or timeout)`)
    }

    // ── G12: Detect client type and conversion need ───────────
    const needsConversion = clientType !== 'claude' && clientType !== 'unknown'
    if (needsConversion) {
      ops.push(`G12: Non-Claude client "${clientType}" — conversion required`)
    } else {
      ops.push(`G12: Claude client — direct installation`)
    }

    // ── G13: Convert via Universal Plugin IR (if needed) ──────
    let convertedDir: string | null = null
    if (needsConversion && (action === 'install' || action === 'update')) {
      try {
        const { convertAndStorePlugin, emitForClient } = await import('@/services/plugin-storage-service')
        const targetClient = clientType as 'codex' | 'gemini' | 'opencode' | 'kiro'
        await convertAndStorePlugin(name, 'claude', [targetClient])
        convertedDir = await emitForClient(name, targetClient)
        if (convertedDir) {
          ops.push(`G13: Converted for ${clientType} → ${convertedDir}`)
        } else {
          ops.push(`G13: WARN — Conversion returned no output directory`)
        }
      } catch (convErr) {
        ops.push(`G08: WARN — Cross-client conversion failed: ${convErr instanceof Error ? convErr.message : convErr}`)
      }
    } else {
      ops.push(`G13: No conversion needed`)
    }

    // ═══════════════════════════════════════════════════════════
    // EXECUTION
    // ═══════════════════════════════════════════════════════════

    // ── EXE: Execute the action ────────────────────────────────
    const cwd = scope === 'local' ? agentDir! : HOME

    if (scope === 'local') {
      await mkdir(join(cwd, '.claude'), { recursive: true })
    }

    try {
      switch (action) {
        case 'install': {
          if (useClientAdapter) {
            const { getAdapter } = await import('@/lib/client-plugin-adapters')
            const { clientTypeToProviderId } = await import('@/lib/client-capabilities')
            const adapter = await getAdapter(clientType)
            if (!adapter) {
              result.error = `EXE: No plugin adapter for client "${clientType}"`
              ops.push(result.error)
              return result
            }
            let storageDir = convertedDir
            if (!storageDir) {
              const { emitForClient } = await import('@/services/plugin-storage-service')
              storageDir = await emitForClient(name, clientType as 'codex' | 'gemini' | 'opencode' | 'kiro')
            }
            if (!storageDir) {
              result.error = `EXE: No converted plugin dir for ${name}@${clientType} — conversion (G13) must have failed`
              ops.push(result.error)
              return result
            }
            const providerId = clientTypeToProviderId(clientType)
            if (!providerId) {
              result.error = `EXE: No provider ID for client "${clientType}"`
              ops.push(result.error)
              return result
            }
            const adapterRes = await inAdapterContext('ChangePlugin', () => adapter.install(
              { name, clientType, storageDir, providerId },
              cwd,
              { scope: 'local' }
            ))
            if (!adapterRes.success) {
              result.error = `EXE: ${clientType}-adapter install failed: ${adapterRes.error || 'unknown'}`
              ops.push(result.error)
              return result
            }
            ops.push(`EXE: Installed via ${clientType}-adapter (${adapterRes.installedPaths.length} files copied from ${storageDir})`)
            break
          }

          let cliSuccess = false
          try {
            const cliResult = await execFileAsync('claude', [
              'plugin', 'install', `${name}@${resolvedMarketplace}`, '--scope', scope,
            ], { timeout: 30000, cwd })
            result.stdout = cliResult.stdout
            result.stderr = cliResult.stderr
            cliSuccess = true
            ops.push(`EXE: Installed via CLI — ${name}@${resolvedMarketplace} --scope ${scope}`)
          } catch (cliErr: unknown) {
            const err = cliErr as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
            result.stdout = String(err.stdout || '')
            result.stderr = String(err.stderr || '')
            ops.push(`EXE: CLI install failed (${err.message?.slice(0, 80) || 'unknown'}) — falling back to direct write`)
          }

          if (!cliSuccess) {
            await withSettingsLock(settingsPath, async () => {
              const settings = await loadJsonSafe(settingsPath) as Record<string, Record<string, unknown>>
              const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
              ep[pluginKey] = true
              settings.enabledPlugins = ep
              await saveJsonSafe(settingsPath, settings)
            })
            ops.push(`EXE: Installed via direct settings write — ${pluginKey} → true`)
          } else if (scope === 'local' && clientType === 'claude') {
            // SCEN-012 FIX: Belt-and-braces write-back for local Claude installs.
            // The `claude plugin install` CLI can fail silently when invoked from
            // a server child process due to PATH / env differences (same root
            // cause fixed in ChangeClient G08b). Verify the key is actually in
            // settings.local.json and write it back if not. Without this, G11
            // (install ai-maestro-plugin during CreateAgent) can return success
            // while the plugin is not actually enabled, violating R17.1/R17.6.
            try {
              await withSettingsLock(settingsPath, async () => {
                const settings = await loadJsonSafe(settingsPath) as Record<string, Record<string, unknown>>
                const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
                if (ep[pluginKey] !== true) {
                  ep[pluginKey] = true
                  settings.enabledPlugins = ep
                  await saveJsonSafe(settingsPath, settings)
                  ops.push(`EXE: Write-back — CLI claimed success but ${pluginKey} missing; force-wrote ${pluginKey} → true`)
                }
              })
            } catch (wbErr) {
              ops.push(`EXE: WARN — Write-back fallback failed: ${wbErr instanceof Error ? wbErr.message : wbErr}`)
            }
          }
          break
        }

        case 'uninstall': {
          if (useClientAdapter) {
            const { getAdapter } = await import('@/lib/client-plugin-adapters')
            const { clientTypeToProviderId } = await import('@/lib/client-capabilities')
            const adapter = await getAdapter(clientType)
            const providerId = clientTypeToProviderId(clientType)
            if (adapter && providerId) {
              const adapterRes = await inAdapterContext('ChangePlugin', () => adapter.uninstall(
                { name, clientType, storageDir: convertedDir || '', providerId },
                cwd,
                { scope: 'local' }
              ))
              if (adapterRes.success) {
                ops.push(`EXE: Uninstalled via ${clientType}-adapter`)
                break
              }
              ops.push(`EXE: ${clientType}-adapter uninstall failed: ${adapterRes.error || 'unknown'} — falling back`)
            }
          }

          try {
            const cliResult = await execFileAsync('claude', [
              'plugin', 'uninstall', `${name}@${resolvedMarketplace}`, '--scope', scope,
            ], { timeout: 30000, cwd })
            result.stdout = cliResult.stdout
            result.stderr = cliResult.stderr
            ops.push(`EXE: Uninstalled via CLI`)
          } catch {
            await withSettingsLock(settingsPath, async () => {
              const settings = await loadJsonSafe(settingsPath) as Record<string, Record<string, unknown>>
              const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
              // SCEN-012 FIX: Boundary-aware match. Old `k.includes(name)` deleted
              // ai-maestro-autonomous-agent@ai-maestro-plugins when uninstalling
              // ai-maestro-plugin, because "ai-maestro-plugins" contains "ai-maestro-plugin"
              // as substring. Require exact name match before "@".
              for (const k of Object.keys(ep)) {
                const at = k.indexOf('@')
                const pluginPart = at >= 0 ? k.substring(0, at) : k
                if (pluginPart === name) delete ep[k]
              }
              settings.enabledPlugins = ep
              await saveJsonSafe(settingsPath, settings)
            })
            ops.push(`EXE: Uninstalled via direct settings removal`)
          }

          // SCEN-019 P0-001: Always clean up plugin cache dir on user-scope
          // uninstall. When the CLI fails and we fall through to direct
          // settings removal, the cache dir `~/.claude/plugins/cache/
          // <marketplace>/<plugin>/` is left behind. Next time `claude` reads
          // the cache, it still sees the plugin files and may silently
          // "re-enable" via orphaned marketplace manifests. Only applies to
          // user scope — local scope doesn't own the shared cache, and
          // other agents may still depend on the cached plugin.
          if (scope === 'user' && clientType === 'claude') {
            try {
              const { rm: rmCache } = await import('fs/promises')
              const { resolve: resolveCache } = await import('path')
              const cacheDir = resolveCache(HOME, '.claude', 'plugins', 'cache', resolvedMarketplace, name)
              const claudeCacheRoot = resolveCache(HOME, '.claude', 'plugins', 'cache')
              // Safety: refuse to rm anything outside ~/.claude/plugins/cache/
              if (cacheDir.startsWith(claudeCacheRoot + '/') && cacheDir !== claudeCacheRoot) {
                await rmCache(cacheDir, { recursive: true, force: true })
                ops.push(`EXE: Removed plugin cache dir ${cacheDir}`)
              }
            } catch (cacheErr) {
              ops.push(`EXE: WARN — cache dir cleanup failed: ${cacheErr instanceof Error ? cacheErr.message : cacheErr}`)
            }
          }
          break
        }

        case 'enable': {
          await withSettingsLock(settingsPath, async () => {
            const settings = await loadJsonSafe(settingsPath) as Record<string, Record<string, unknown>>
            const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
            // SCEN-012 FIX: Boundary-aware match (see PG01 comment).
            const existingKey = Object.keys(ep).find(k => {
              const at = k.indexOf('@')
              const pluginPart = at >= 0 ? k.substring(0, at) : k
              return pluginPart === name
            }) || pluginKey
            ep[existingKey] = true
            settings.enabledPlugins = ep
            await saveJsonSafe(settingsPath, settings)
          })
          ops.push(`EXE: Enabled — ${name} → true`)
          break
        }

        case 'disable': {
          await withSettingsLock(settingsPath, async () => {
            const settings = await loadJsonSafe(settingsPath) as Record<string, Record<string, unknown>>
            const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
            // SCEN-012 FIX: Boundary-aware match (see PG01 comment).
            const existingKey = Object.keys(ep).find(k => {
              const at = k.indexOf('@')
              const pluginPart = at >= 0 ? k.substring(0, at) : k
              return pluginPart === name
            }) || pluginKey
            ep[existingKey] = false
            settings.enabledPlugins = ep
            await saveJsonSafe(settingsPath, settings)
          })
          ops.push(`EXE: Disabled — ${name} → false`)
          break
        }

        case 'update': {
          try {
            const cliResult = await execFileAsync('claude', [
              'plugin', 'update', `${name}@${resolvedMarketplace}`,
            ], { timeout: 60000, cwd })
            result.stdout = cliResult.stdout
            result.stderr = cliResult.stderr
            ops.push(`EXE: Updated via CLI`)
          } catch (updateErr: unknown) {
            const err = updateErr as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
            result.stdout = String(err.stdout || '')
            result.stderr = String(err.stderr || '')
            ops.push(`EXE: WARN — Update failed: ${err.message || 'unknown'}`)
          }
          break
        }
      }
    } catch (execErr) {
      // EMS-MIN-01 fix: this catch belongs to the EXE (execution) section,
      // not Gate 9. The "G09:" prefix collides with the actual Gate 9 label
      // (R9.13 role-plugin enforcement) and confuses pipeline log readers.
      result.error = `EXE: Action "${action}" failed: ${execErr instanceof Error ? execErr.message : execErr}`
      ops.push(result.error)
      return result
    }

    result.success = true

    } // end of !result.success (non-idempotent) block

    // ═══════════════════════════════════════════════════════════
    // POST-EXECUTION GATES (always run, even for idempotent results)
    // ═══════════════════════════════════════════════════════════

    // ── PG01: Verify action took effect ───────────────────────
    // Non-Claude clients: ask the per-client adapter whether the plugin is
    // detected at its native paths (.codex-plugin/, .gemini/, etc.).
    // Claude/unknown: fall back to the original .claude/settings.local.json
    // reading.
    if (scope === 'local' && agentDir) {
      if (useClientAdapter) {
        try {
          const { getAdapter } = await import('@/lib/client-plugin-adapters')
          const adapter = await getAdapter(clientType)
          if (!adapter) {
            ops.push(`PG01: WARN — No adapter for "${clientType}" to verify state`)
          } else {
            const state = await adapter.detectState(name, agentDir)
            const stateSummary = `installed=${state.installed} enabled=${state.enabled} method=${state.method}`
            if (action === 'install' || action === 'enable') {
              const ok = state.installed && state.enabled
              ops.push(ok
                ? `PG01: Verified via ${clientType}-adapter — ${stateSummary}`
                : `PG01: WARN — ${clientType}-adapter reports ${stateSummary} after ${action}`)
              if (!ok) result.success = false
            } else if (action === 'uninstall') {
              const ok = !state.installed
              ops.push(ok
                ? `PG01: Verified via ${clientType}-adapter — ${name} removed`
                : `PG01: WARN — ${clientType}-adapter reports ${stateSummary} after uninstall`)
            } else if (action === 'disable') {
              const ok = !state.enabled || !state.installed
              ops.push(ok
                ? `PG01: Verified via ${clientType}-adapter — ${stateSummary}`
                : `PG01: WARN — ${clientType}-adapter reports ${stateSummary} after disable`)
            } else {
              ops.push(`PG01: Verification for "${action}" — skipped`)
            }
          }
        } catch (verifyErr) {
          ops.push(`PG01: WARN — ${clientType}-adapter verify threw: ${verifyErr instanceof Error ? verifyErr.message : verifyErr}`)
        }
      } else {
        const verifyPath = join(agentDir, '.claude', 'settings.local.json')
        try {
          const settings = await loadJsonSafe(verifyPath) as Record<string, Record<string, unknown>>
          const ep = settings.enabledPlugins as Record<string, boolean> | undefined
          // SCEN-012 FIX: Use boundary-aware matching instead of substring `includes`.
          // The old `k.includes(name)` returned TRUE for "ai-maestro-autonomous-agent@ai-maestro-plugins"
          // when looking for "ai-maestro-plugin" (because "ai-maestro-plugins" contains "ai-maestro-plugin"
          // as substring). That caused G11 ai-maestro-plugin install to be marked successful even though
          // the key was never written — violating R17.1/R17.6. Match on exact name before "@".
          const matchesName = (k: string): boolean => {
            const at = k.indexOf('@')
            const pluginPart = at >= 0 ? k.substring(0, at) : k
            return pluginPart === name
          }
          if (action === 'install' || action === 'enable') {
            const found = ep && Object.keys(ep).some(k => matchesName(k) && ep[k] !== false)
            ops.push(found
              ? `PG01: Verified — ${name} present and enabled`
              : `PG01: WARN — ${name} not found or disabled after ${action}`)
            if (!found) result.success = false
          } else if (action === 'uninstall') {
            const stillPresent = ep && Object.keys(ep).some(k => matchesName(k))
            ops.push(stillPresent
              ? `PG01: WARN — ${name} still present after uninstall`
              : `PG01: Verified — ${name} removed`)
          } else if (action === 'disable') {
            const isDisabled = ep && Object.keys(ep).some(k => matchesName(k) && ep[k] === false)
            ops.push(isDisabled
              ? `PG01: Verified — ${name} is disabled`
              : `PG01: WARN — ${name} not in expected disabled state`)
          } else {
            ops.push(`PG01: Verification for "${action}" — skipped (update verified by CLI exit code)`)
          }
        } catch {
          ops.push(`PG01: WARN — Could not read settings for verification`)
        }
      }
    } else {
      ops.push(`PG01: User-scope verification skipped`)
    }

    // ── PG02: Update registry flags ───────────────────────────
    if (desired.agentId && name === 'ai-maestro-plugin') {
      try {
        const { updateAgent: updateAgentAIO } = await import('@/lib/agent-registry')
        const shouldBeMissing = action === 'uninstall' || action === 'disable' || !result.success
        await updateAgentAIO(desired.agentId, { corePluginMissing: shouldBeMissing } as import('@/types/agent').UpdateAgentRequest)
        ops.push(`PG02: Registry flag corePluginMissing=${shouldBeMissing}`)
      } catch {
        ops.push(`PG02: WARN — Failed to update registry flag`)
      }
    } else {
      ops.push(`PG02: No registry flag update needed`)
    }

    // ── PG03: Scope consistency (R17.17) ──────────────────────
    // If we just installed ai-maestro-plugin at local scope, ensure it's NOT also
    // enabled at user scope (which would cause double-loading and scope confusion).
    if (name === 'ai-maestro-plugin' && action === 'install' && scope === 'local') {
      const userSettingsPath = USER_GLOBAL_SETTINGS
      if (existsSync(userSettingsPath)) {
        try {
          await withSettingsLock(userSettingsPath, async () => {
            const us = await loadJsonSafe(userSettingsPath) as Record<string, Record<string, unknown>>
            const uep = (us.enabledPlugins || {}) as Record<string, boolean>
            // SCEN-012 FIX: Boundary-aware match. Old `k.includes('ai-maestro-plugin')`
            // also matched role-plugin names like ai-maestro-autonomous-agent@ai-maestro-plugins
            // (marketplace name contains "ai-maestro-plugin" as substring).
            const userKey = Object.keys(uep).find(k => {
              const at = k.indexOf('@')
              const pluginPart = at >= 0 ? k.substring(0, at) : k
              return pluginPart === 'ai-maestro-plugin'
            })
            if (userKey && uep[userKey] !== false) {
              uep[userKey] = false
              us.enabledPlugins = uep
              await saveJsonSafe(userSettingsPath, us)
              ops.push(`PG03: Disabled ai-maestro-plugin at user scope (R17.17 — must be local-only)`)
            } else {
              ops.push(`PG03: User scope clean — no ai-maestro-plugin enabled`)
            }
          })
        } catch {
          ops.push(`PG03: WARN — Could not check user scope settings`)
        }
      } else {
        ops.push(`PG03: No user settings file — clean`)
      }
    } else {
      ops.push(`PG03: Scope consistency check not applicable`)
    }

    // ── PG04: Title-plugin binding repair (R11, R9.13) ─────────
    // If we uninstalled a role-plugin from ANY agent (including AUTONOMOUS),
    // that agent now violates R9.13 (role-plugin is mandatory for every
    // agent). Call ChangeTitle to reinstall the default plugin for their
    // title. AUTONOMOUS now maps to ai-maestro-autonomous-agent, so the
    // repair path is identical to every other title.
    //
    // TRDD-c7a81642 extension (2026-04-20): when both the fallback scan
    // AND the default-plugin reinstall fail, the agent is persisted
    // with NO role-plugin. That violates R9.13 and the agent must be
    // simultaneously hibernated with `roleMissing=true`. Wake attempts
    // will then return 409 role_plugin_required until the Profile
    // Config tab assigns a plugin. A `hibernate_role_missing` ledger op
    // is emitted so state-restore can replay and the Diagnostics panel
    // can count auto-hibernations.
    if (desired.agentId && action === 'uninstall' && isRolePlugin && result.success) {
      try {
        const { getAgent: getAgentPG04, updateAgent: updateAgentPG04 } = await import('@/lib/agent-registry')
        const agentPG04 = getAgentPG04(desired.agentId)
        const title = (agentPG04?.governanceTitle || 'autonomous').toLowerCase()
        const defaultPlugin = TITLE_PLUGIN_MAP[title]
        // System-initiated repair: PG04 is triggered from ChangePlugin's post-gate
        // on behalf of an R9.13 recovery, NOT a user action. isSystemOwner is the
        // honest authContext here — no external principal is making this request.
        const pg04AuthContext: AuthContext = { isSystemOwner: true as const }

        // Check if ANY compatible role-plugin still remains installed
        // before attempting a fresh install. If so, PG04 is a no-op.
        let compatibleSurvived = false
        try {
          const { scanAgentLocalConfig } = await import('@/services/agent-local-config-service')
          const cfgResult = scanAgentLocalConfig(desired.agentId)
          const cfg = cfgResult.data
          if (cfg?.rolePlugin?.name) {
            compatibleSurvived = true
            ops.push(`PG04: compatible role-plugin "${cfg.rolePlugin.name}" still installed — no repair needed`)
          }
        } catch (scanErr) {
          ops.push(`PG04: WARN — scanAgentLocalConfig failed: ${scanErr instanceof Error ? scanErr.message : scanErr}`)
        }

        let repairSucceeded = compatibleSurvived
        if (!compatibleSurvived) {
          if (defaultPlugin && defaultPlugin !== name) {
            ops.push(`PG04: R9.13 violation — agent has title "${title}" but lost role-plugin "${name}". Reinstalling default "${defaultPlugin}" via ChangeTitle.`)
            const titleResult = await ChangeTitle(desired.agentId, title, { authContext: pg04AuthContext })
            repairSucceeded = titleResult.success
            ops.push(repairSucceeded
              ? `PG04: ChangeTitle restored default plugin "${defaultPlugin}" (${titleResult.operations.length} sub-gates)`
              : `PG04: ChangeTitle failed: ${titleResult.error}`)
          } else if (defaultPlugin === name) {
            ops.push(`PG04: Uninstalled the default plugin for title "${title}" — reinstalling via ChangeTitle`)
            const titleResult = await ChangeTitle(desired.agentId, title, { authContext: pg04AuthContext })
            repairSucceeded = titleResult.success
            ops.push(repairSucceeded
              ? `PG04: Default plugin "${defaultPlugin}" reinstalled`
              : `PG04: Reinstall failed: ${titleResult.error}`)
          } else {
            ops.push(`PG04: No default plugin mapping for title "${title}" — skipped`)
          }
        }

        // TRDD-c7a81642: if repair didn't succeed AND no compatible plugin
        // survived, the agent is now in R9.13 violation. Set roleMissing +
        // hibernate so `/wake` refuses until the Config tab assigns one.
        if (!repairSucceeded) {
          try {
            await updateAgentPG04(desired.agentId, { roleMissing: true })
            ops.push(`PG04: set roleMissing=true (R9.13-extension)`)
            // Fire-and-forget hibernate via the canonical pipeline so
            // the tmux session is killed and session status flipped to
            // offline. Authorization reuses the system-owner context.
            const { hibernateAgent } = await import('@/services/agents-core-service')
            const hibResult = await hibernateAgent(desired.agentId, {
              sessionIndex: 0,
              authContext: pg04AuthContext,
            })
            ops.push(hibResult?.data?.success
              ? `PG04: auto-hibernated agent (reason: role_plugin_missing)`
              : `PG04: WARN — hibernate after roleMissing set: ${hibResult?.error ?? 'unknown'}`)
            // Ledger-emit: record the governance-class event so the
            // Diagnostics panel / state-restore tool can count it.
            await tryEmitLedgerOp(
              'hibernate_role_missing',
              [{ op: 'replace', path: `/agents/${desired.agentId}/roleMissing`, value: true }],
              pg04AuthContext,
              'pg04-hibernate-role-missing',
              ops,
            )
          } catch (hibErr) {
            ops.push(`PG04: WARN — roleMissing/hibernate path failed: ${hibErr instanceof Error ? hibErr.message : hibErr}`)
          }
        }
      } catch (pg04Err) {
        ops.push(`PG04: WARN — Title-plugin repair failed: ${pg04Err instanceof Error ? pg04Err.message : pg04Err}`)
      }
    } else {
      ops.push(`PG04: Title-plugin binding check not applicable`)
    }

    // ── PG05: Core plugin defense in depth ────────────────────
    // If by any code path the core plugin ended up uninstalled or disabled
    // (shouldn't happen — G08 blocks it — but defense in depth), reinstall it.
    if (desired.agentId && name === 'ai-maestro-plugin' && (action === 'uninstall' || action === 'disable')) {
      ops.push(`PG05: CRITICAL — Core plugin ${action} bypassed G08! Force-reinstalling.`)
      const reinstallResult = await InstallElement({
        name: 'ai-maestro-plugin',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'local',
        agentDir,
        agentId: desired.agentId,
        clientType,
      }, authContext)
      ops.push(reinstallResult.success
        ? `PG05: Core plugin force-reinstalled`
        : `PG05: CRITICAL — Force-reinstall FAILED: ${reinstallResult.error}`)
    } else {
      ops.push(`PG05: Core plugin defense — not triggered`)
    }

    // ── PG06: Team composition integrity (R12) ────────────────
    // If a team agent lost its role-plugin (PG04 may have reverted to AUTONOMOUS
    // or reassigned a title), the team may now violate R12 (minimum 5 required titles).
    // Check and flag the team as non-functional if composition is broken.
    if (desired.agentId && action === 'uninstall' && isRolePlugin && result.success) {
      try {
        const { getAgent: getAgentPG06 } = await import('@/lib/agent-registry')
        const agentPG06 = getAgentPG06(desired.agentId)
        if (agentPG06?.team) {
          const { loadTeams: loadTeamsPG06 } = await import('@/lib/team-registry')
          const allTeams = loadTeamsPG06()
          const team = allTeams.find(t => t.agentIds?.includes(desired.agentId!))
          if (team) {
            // Check if team still has all 5 required titles
            const { loadAgents: loadAllPG06 } = await import('@/lib/agent-registry')
            const allAgents = loadAllPG06()
            const teamAgents = allAgents.filter(a => team.agentIds.includes(a.id))
            const requiredTitles = ['chief-of-staff', 'architect', 'orchestrator', 'integrator', 'member']
            const presentTitles = new Set(teamAgents.map(a => (a.governanceTitle || 'autonomous').toLowerCase()))
            const missingTitles = requiredTitles.filter(t => !presentTitles.has(t))
            if (missingTitles.length > 0) {
              ops.push(`PG06: WARN — Team "${team.name}" missing required titles after plugin removal: ${missingTitles.join(', ')}. Team is NON-FUNCTIONAL (R12). COS must recreate missing agents.`)
            } else {
              ops.push(`PG06: Team "${team.name}" composition still valid (${requiredTitles.length}/${requiredTitles.length} titles present)`)
            }
          } else {
            ops.push(`PG06: Agent not in a team — composition check skipped`)
          }
        } else {
          ops.push(`PG06: Agent has no team — composition check skipped`)
        }
      } catch (pg06Err) {
        ops.push(`PG06: WARN — Team composition check failed: ${pg06Err instanceof Error ? pg06Err.message : pg06Err}`)
      }
    } else {
      ops.push(`PG06: Team composition check not applicable`)
    }

    // ── PG07: Duplicate scope detection ───────────────────────
    // After any install at local scope, check if the SAME plugin is also enabled
    // at user scope. Double-loading causes unpredictable behavior (duplicate hooks,
    // duplicate skills, config conflicts). Disable the user-scope copy.
    if (action === 'install' && scope === 'local' && agentDir) {
      const userSettingsPath = USER_GLOBAL_SETTINGS
      if (existsSync(userSettingsPath)) {
        try {
          await withSettingsLock(userSettingsPath, async () => {
            const us = await loadJsonSafe(userSettingsPath) as Record<string, Record<string, unknown>>
            const uep = (us.enabledPlugins || {}) as Record<string, boolean>
            // SCEN-012 FIX: Boundary-aware match.
            const userKey = Object.keys(uep).find(k => {
              const at = k.indexOf('@')
              const pluginPart = at >= 0 ? k.substring(0, at) : k
              return pluginPart === name
            })
            if (userKey && uep[userKey] !== false) {
              uep[userKey] = false
              us.enabledPlugins = uep
              await saveJsonSafe(userSettingsPath, us)
              ops.push(`PG07: Disabled "${name}" at user scope — was duplicate of local install (prevents double-loading)`)
            } else {
              ops.push(`PG07: No duplicate at user scope`)
            }
          })
        } catch {
          ops.push(`PG07: WARN — Could not check user scope for duplicates`)
        }
      } else {
        ops.push(`PG07: No user settings file — no duplicate possible`)
      }
    } else {
      ops.push(`PG07: Duplicate scope check not applicable`)
    }

    // ── PG08: Restart notification ────────────────────────────
    // Plugin changes require restarting the client session to take effect.
    // Signal this to callers via the result so they can queue a restart.
    if (desired.agentId && (action === 'install' || action === 'uninstall' || action === 'update')) {
      result.restartNeeded = true
      ops.push(`PG08: Agent restart needed for ${action} to take effect`)
    } else {
      ops.push(`PG08: No restart needed`)
    }

    console.log(`[InstallElement] ${action} "${name}" — ${result.success ? 'OK' : 'FAILED'} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[InstallElement] FAILED:`, result.error)
    return result
  }
}

/** Resolve marketplace shorthand to the name Claude CLI expects */
function resolveMarketplaceName(marketplace: MarketplaceRef): string {
  // MAJ-03 fix (2026-05-04) — drop the inline `require()`. The
  // CUSTOM_MARKETPLACE_NAME constant is already imported at the top of
  // the file (the same import block that brings GITHUB_MARKETPLACE_NAME_IMPORT
  // and LOCAL_MARKETPLACE_NAME into scope), so the dynamic require was
  // redundant AND broken under strict ESM execution / bundlers that
  // don't polyfill `require`.
  if (marketplace === 'ai-maestro-plugins') return GITHUB_MARKETPLACE_NAME_IMPORT
  if (marketplace === 'ai-maestro-local-roles-marketplace') return LOCAL_MARKETPLACE_NAME
  if (marketplace === 'ai-maestro-local-custom-marketplace') {
    return CUSTOM_MARKETPLACE_NAME
  }
  // GitHub org/repo format → extract basename
  if (marketplace.includes('/') && !marketplace.includes(' ')) {
    return marketplace.split('/').pop() || marketplace
  }
  return marketplace
}

// ── Legacy helpers (delegate to InstallElement) ──────────────

/**
 * Install a role-plugin into an agent's working directory.
 * @deprecated Use InstallElement() instead. Kept for backward compatibility during migration.
 */
export async function installPluginLocally(
  pluginName: string,
  agentDir: string,
  marketplaceName: string = MARKETPLACE_NAME,
): Promise<void> {
  // Validate plugin name
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(pluginName)) {
    throw new Error(`Invalid plugin name "${pluginName}"`)
  }

  // SAFEGUARD: Role-plugins MUST be local-scope only. This function enforces it
  // by requiring agentDir (no user-scope path). Fail-fast if agentDir is missing.
  if (!agentDir || agentDir.trim() === '') {
    throw new Error(`installPluginLocally requires agentDir — role-plugins MUST be local scope`)
  }

  // Resolve ~ in agentDir
  const resolvedDir = agentDir.startsWith('~')
    ? agentDir.replace('~', HOME)
    : agentDir

  // Reject path traversal in agentDir
  if (resolvedDir.includes('..')) {
    throw new Error('agentDir must not contain ".."')
  }

  // For predefined marketplace role-plugins AND any other non-custom plugin:
  // use `claude plugin install` CLI. This ensures the plugin is actually
  // downloaded into the user-scope cache (~/.claude/plugins/cache/<mkt>/<name>/)
  // and that the agent's `.claude/settings.local.json` enabledPlugins key is
  // added atomically. The check for LOCAL_MARKETPLACE_NAME / CUSTOM_MARKETPLACE_NAME
  // routes Haephestos-authored local plugins through the legacy direct-settings
  // write path (those plugins live in `~/agents/{role,custom}-plugins/…` and
  // cannot be resolved by Claude CLI).
  const isLocalOnlyMarketplace = (
    marketplaceName === LOCAL_MARKETPLACE_NAME ||
    marketplaceName === CUSTOM_MARKETPLACE_NAME
  )
  if (!isLocalOnlyMarketplace) {
    try {
      await execFileAsync('claude', [
        'plugin', 'install', pluginName, marketplaceName, '--scope', 'local',
      ], { timeout: 120000, cwd: resolvedDir })
      console.log(`[element-mgmt] Installed ${pluginName} from ${marketplaceName} via Claude CLI (scope: local, cwd: ${resolvedDir})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to install plugin "${pluginName}" from ${marketplaceName}: ${msg}`)
    }
    return
  }

  // For Haephestos-authored local/custom plugins, write settings.local.json directly.
  // These plugins live in `~/agents/{role,custom}-plugins/…` and cannot be
  // resolved by Claude CLI's marketplace lookup.
  const pluginKey = `${pluginName}@${marketplaceName}`
  const claudeDir = join(resolvedDir, '.claude')
  const localSettings = join(claudeDir, 'settings.local.json')

  await withSettingsLock(localSettings, async () => {
    // Create .claude directory in agent's project
    await mkdir(claudeDir, { recursive: true })

    // Read or create settings.local.json
    const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
    const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
    ep[pluginKey] = true
    settings.enabledPlugins = ep
    await saveJsonSafe(localSettings, settings)
  })

  // Track in global installed_plugins.json
  await withSettingsLock(INSTALLED_FILE, async () => {
    await mkdir(join(CLAUDE_DIR, 'plugins'), { recursive: true })
    const installed = await loadJsonSafe(INSTALLED_FILE) as Record<string, unknown>
    const pluginsMap = (installed.plugins || {}) as Record<string, unknown>
    const now = new Date().toISOString().replace('+00:00', 'Z')
    pluginsMap[pluginKey] = [{
      scope: 'local',
      version: '1.0.0',
      installedAt: now,
      lastUpdated: now,
      installPath: join(PLUGINS_DIR, pluginName),
      projectPath: resolvedDir,
    }]
    installed.plugins = pluginsMap
    await saveJsonSafe(INSTALLED_FILE, installed)
  })
}

/**
 * Uninstall a role-plugin from an agent's working directory.
 */
export async function uninstallPluginLocally(
  pluginName: string,
  agentDir: string,
  marketplaceName: string = MARKETPLACE_NAME,
): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(pluginName)) {
    throw new Error(`Invalid plugin name "${pluginName}"`)
  }

  const resolvedDir = agentDir.startsWith('~')
    ? agentDir.replace('~', HOME)
    : agentDir

  if (resolvedDir.includes('..')) {
    throw new Error('agentDir must not contain ".."')
  }

  const pluginKey = `${pluginName}@${marketplaceName}`

  // For non-custom marketplaces: use `claude plugin uninstall` CLI + settings cleanup.
  // This matches installPluginLocally's symmetric path — Claude CLI owns the
  // plugin cache and the agent's enabledPlugins entry for any plugin whose
  // source is a registered GitHub marketplace (predefined role-plugins and
  // third-party plugins alike). Haephestos-authored local customs keep the
  // legacy direct-settings path.
  const isLocalOnlyMarketplace = (
    marketplaceName === LOCAL_MARKETPLACE_NAME ||
    marketplaceName === CUSTOM_MARKETPLACE_NAME
  )
  if (!isLocalOnlyMarketplace) {
    try {
      await execFileAsync('claude', [
        'plugin', 'uninstall', pluginName, marketplaceName, '--scope', 'local',
      ], { timeout: 30000, cwd: resolvedDir })
      console.log(`[element-mgmt] Uninstalled ${pluginName} from ${marketplaceName} via Claude CLI (scope: local, cwd: ${resolvedDir})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('not found') && !msg.includes('not installed')) {
        console.warn(`[element-mgmt] CLI uninstall failed for ${pluginName}: ${msg}`)
      }
    }
    // SAFEGUARD: Also remove from settings.local.json directly (defence in depth —
    // Claude CLI has historically been flaky about settings.local.json cleanup).
    const localSettings = join(resolvedDir, '.claude', 'settings.local.json')
    if (existsSync(localSettings)) {
      await withSettingsLock(localSettings, async () => {
        const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
        const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
        if (pluginKey in ep) {
          delete ep[pluginKey]
          settings.enabledPlugins = ep
          await saveJsonSafe(localSettings, settings)
          console.log(`[element-mgmt] Removed ${pluginKey} from settings.local.json (safeguard cleanup)`)
        }
      })
    }
    // Fall through to installed_plugins.json cleanup below.
  } else {
    // For Haephestos-authored local/custom plugins: manipulate settings.local.json directly
    const localSettings = join(resolvedDir, '.claude', 'settings.local.json')

    if (existsSync(localSettings)) {
      await withSettingsLock(localSettings, async () => {
        const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
        const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
        delete ep[pluginKey]
        settings.enabledPlugins = ep
        await saveJsonSafe(localSettings, settings)
      })
    }
  }

  // Remove from installed_plugins.json
  if (existsSync(INSTALLED_FILE)) {
    await withSettingsLock(INSTALLED_FILE, async () => {
      const installed = await loadJsonSafe(INSTALLED_FILE) as Record<string, unknown>
      const pluginsMap = (installed.plugins || {}) as Record<string, unknown>
      delete pluginsMap[pluginKey]
      installed.plugins = pluginsMap
      await saveJsonSafe(INSTALLED_FILE, installed)
    })
  }
}

// ── Governance title → role-plugin lifecycle ──────────────────

/**
 * Get the DEFAULT role-plugin name for a governance title (hardcoded fallback).
 * For dynamic N:1 compatibility, use getCompatiblePluginsForTitle() instead.
 */
export function getRequiredPluginForTitle(title: string): string | null {
  return TITLE_PLUGIN_MAP[title] || null
}

/**
 * Get compatible role-plugins for a title + client combo (N:1 model).
 * Scans all installed role-plugins for .agent.toml compatible-titles and compatible-clients.
 * Falls back to TITLE_PLUGIN_MAP default if no dynamic plugins found.
 */
export async function getCompatiblePluginsForTitle(
  title: string,
  clientType?: string
): Promise<{ name: string; marketplace?: string; source?: string; compatibleClients?: string[] }[]> {
  try {
    const { getPluginsForTitle } = await import('@/services/role-plugin-service')
    const plugins = await getPluginsForTitle(title, clientType)
    if (plugins.length > 0) {
      return plugins.map(p => ({
        name: p.name,
        marketplace: p.marketplace,
        source: p.source,
        compatibleClients: p.compatibleClients,
      }))
    }
  } catch {
    // Fallback to hardcoded map if role-plugin-service unavailable
  }
  // Fallback: return the hardcoded default plugin (if any)
  const defaultPlugin = TITLE_PLUGIN_MAP[title?.toLowerCase()]
  if (defaultPlugin) {
    return [{ name: defaultPlugin, marketplace: GITHUB_MARKETPLACE_NAME, source: 'marketplace' }]
  }
  return []
}

/**
 * Auto-assign the required role-plugin when a governance title is set.
 * Returns the installed plugin name, or null if no auto-assignment needed (MEMBER).
 */
export async function autoAssignRolePluginForTitle(
  title: AgentRole,
  agentId: string
): Promise<string | null> {
  const requiredPlugin = TITLE_PLUGIN_MAP[title]
  if (!requiredPlugin) return null // MEMBER -- no forced plugin

  // Look up the agent from the registry
  const { getAgent } = await import('@/lib/agent-registry')
  const agent = getAgent(agentId)
  if (!agent) throw new Error(`Agent ${agentId} not found`)

  // Detect client type — non-Claude agents get plugins via the adapter system
  const { detectClientType } = await import('@/lib/client-capabilities')
  const clientType = detectClientType(agent.program || '')

  const agentDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
  if (!agentDir) throw new Error(`Agent ${agentId} has no working directory`)

  // SAFEGUARD: Uninstall ALL other role-plugins before installing the new one.
  const marketplace = GITHUB_MARKETPLACE_NAME
  for (const [, otherPlugin] of Object.entries(TITLE_PLUGIN_MAP)) {
    if (otherPlugin !== requiredPlugin) {
      await uninstallPluginLocally(otherPlugin, agentDir, marketplace).catch(() => {})
    }
  }

  if (clientType !== 'claude') {
    // Non-Claude: convert and install via adapter
    const { convertAndStorePlugin, emitForClient } = await import('@/services/plugin-storage-service')
    const { getAdapter } = await import('@/lib/client-plugin-adapters')
    const { clientTypeToProviderId } = await import('@/lib/client-capabilities')
    const targetProviderId = clientTypeToProviderId(clientType)
    if (!targetProviderId) throw new Error(`No converter provider for client type: ${clientType}`)
    await convertAndStorePlugin(requiredPlugin, 'claude', [clientType as 'codex' | 'gemini' | 'opencode' | 'kiro'])
    const emittedDir = await emitForClient(requiredPlugin, clientType as 'codex' | 'gemini' | 'opencode' | 'kiro')
    if (!emittedDir) throw new Error(`Failed to emit plugin "${requiredPlugin}" for ${clientType}`)
    const adapter = await getAdapter(clientType)
    if (!adapter) throw new Error(`No plugin adapter for client type: ${clientType}`)
    await inAdapterContext('autoAssignRolePluginForTitle', () => adapter.install(
      { name: requiredPlugin, clientType, storageDir: emittedDir, providerId: targetProviderId },
      agentDir,
      { scope: 'local' }
    ))
  } else {
    // Claude: install directly (existing behavior)
    await installPluginLocally(requiredPlugin, agentDir, marketplace)
  }

  console.log(`[element-mgmt] Auto-assigned role-plugin ${requiredPlugin} to agent ${agentId} (title: ${title}, client: ${clientType})`)
  return requiredPlugin
}

/**
 * Uninstall ALL role-plugins from an agent's working directory.
 * Used when switching to AUTONOMOUS or MEMBER (no required plugin).
 */
export async function uninstallAllRolePlugins(agentDir: string): Promise<void> {
  for (const [, pluginName] of Object.entries(TITLE_PLUGIN_MAP)) {
    await uninstallPluginLocally(pluginName, agentDir, GITHUB_MARKETPLACE_NAME).catch(() => {})
  }
}

/**
 * CENTRALIZED role-plugin lifecycle for governance title changes.
 *
 * This is the SINGLE entry point that ALL title-change paths MUST call.
 * It handles the full lifecycle:
 *   1. Uninstalls ALL existing role-plugins (safeguard: only one can exist)
 *   2. Installs the correct role-plugin for the new title (if any)
 *   3. AUTONOMOUS / MEMBER / null -> no plugin installed (clean state)
 *
 * @param agentId - The agent UUID
 * @param newTitle - The new governance title (null = cleared/AUTONOMOUS)
 * @returns The installed plugin name, or null if no plugin needed
 */
export async function syncRolePlugin(
  agentId: string,
  newTitle: string | null | undefined,
): Promise<string | null> {
  const { getAgent } = await import('@/lib/agent-registry')
  const agent = getAgent(agentId)
  if (!agent) {
    console.warn(`[element-mgmt] syncRolePlugin: agent ${agentId} not found, skipping`)
    return null
  }

  const agentDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
  if (!agentDir) {
    console.warn(`[element-mgmt] syncRolePlugin: agent ${agentId} has no working directory, skipping`)
    return null
  }

  const requiredPlugin = newTitle ? getRequiredPluginForTitle(newTitle) : null

  if (requiredPlugin) {
    // New title requires a plugin -- autoAssignRolePluginForTitle handles
    // uninstalling ALL others first, then installing the new one
    return autoAssignRolePluginForTitle(newTitle as AgentRole, agentId)
  } else {
    // No plugin required (AUTONOMOUS/MEMBER/null) -- uninstall ALL role-plugins
    await uninstallAllRolePlugins(agentDir)
    console.log(`[element-mgmt] Cleared all role-plugins for agent ${agentId} (title: ${newTitle || 'none'})`)
    return null
  }
}

// Backward-compatible alias
export const syncRolePluginForTitle = syncRolePlugin

// ── New wrapper functions ─────────────────────────────────────

// @deprecated Use ChangePlugin() instead
/**
 * Install a plugin at the specified scope.
 * REJECTS role-plugin names -- those MUST go through syncRolePlugin().
 */
export async function installPlugin(
  pluginName: string,
  marketplace: string,
  options: { scope: 'user' | 'local'; agentDir?: string; force?: boolean },
): Promise<void> {
  // Guard: role-plugins must use syncRolePlugin()
  if (PREDEFINED_ROLE_PLUGINS[pluginName]) {
    throw new Error(
      `Role-plugins must be installed via syncRolePlugin(), not installPlugin() directly. ` +
      `Plugin "${pluginName}" is a predefined role-plugin.`
    )
  }

  // SAFEGUARD: Even if the role-plugin check above is somehow bypassed,
  // NEVER allow a role-plugin name at user scope. Belt + suspenders.
  if (options.scope === 'user' && (PREDEFINED_ROLE_PLUGIN_NAMES as readonly string[]).includes(pluginName)) {
    throw new Error(
      `SECURITY: Role-plugin "${pluginName}" cannot be installed at user scope. ` +
      `Role-plugins MUST use --scope local to avoid affecting all sessions.`
    )
  }

  if (options.scope === 'user') {
    const args = ['plugin', 'install', pluginName, marketplace, '--scope', 'user']
    if (options.force) args.push('--force')
    await execFileAsync('claude', args, { timeout: 120000 })
    console.log(`[element-mgmt] Installed ${pluginName} from ${marketplace} (scope: user)`)
    return
  }

  // Local scope
  if (!options.agentDir) {
    throw new Error('agentDir is required for local scope installations')
  }

  const resolvedDir = options.agentDir.startsWith('~')
    ? options.agentDir.replace('~', HOME)
    : options.agentDir

  const pluginKey = `${pluginName}@${marketplace}`
  const claudeDir = join(resolvedDir, '.claude')
  const localSettings = join(claudeDir, 'settings.local.json')

  await withSettingsLock(localSettings, async () => {
    await mkdir(claudeDir, { recursive: true })
    const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
    const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
    ep[pluginKey] = true
    settings.enabledPlugins = ep
    await saveJsonSafe(localSettings, settings)
  })

  console.log(`[element-mgmt] Installed ${pluginName} from ${marketplace} (scope: local, dir: ${resolvedDir})`)
}

// @deprecated Use ChangePlugin() instead
/**
 * Uninstall a plugin at the specified scope.
 */
export async function uninstallPlugin(
  pluginName: string,
  marketplace: string,
  options: { scope: 'user' | 'local'; agentDir?: string },
): Promise<void> {
  // SAFEGUARD: Role-plugins at user scope should not exist. Block uninstall from
  // masking the problem — fail-fast so the root cause is investigated.
  if (options.scope === 'user' && PREDEFINED_ROLE_PLUGINS[pluginName]) {
    throw new Error(
      `SECURITY: Role-plugin "${pluginName}" should never exist at user scope. ` +
      `Investigate how it was installed. Role-plugins MUST be --scope local.`
    )
  }

  if (options.scope === 'user') {
    await execFileAsync('claude', [
      'plugin', 'uninstall', pluginName, marketplace, '--scope', 'user',
    ], { timeout: 30000 })
    console.log(`[element-mgmt] Uninstalled ${pluginName} from ${marketplace} (scope: user)`)
    return
  }

  // Local scope
  if (!options.agentDir) {
    throw new Error('agentDir is required for local scope uninstallation')
  }

  const resolvedDir = options.agentDir.startsWith('~')
    ? options.agentDir.replace('~', HOME)
    : options.agentDir

  const pluginKey = `${pluginName}@${marketplace}`
  const localSettings = join(resolvedDir, '.claude', 'settings.local.json')

  if (existsSync(localSettings)) {
    await withSettingsLock(localSettings, async () => {
      const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
      const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
      delete ep[pluginKey]
      settings.enabledPlugins = ep
      await saveJsonSafe(localSettings, settings)
    })
  }

  console.log(`[element-mgmt] Uninstalled ${pluginName} from ${marketplace} (scope: local, dir: ${resolvedDir})`)
}

// @deprecated Use ChangePlugin() instead
/**
 * Enable a disabled plugin.
 */
export async function enablePlugin(
  pluginKey: string,
  options: { scope: 'user' | 'local'; agentDir?: string },
): Promise<void> {
  if (options.scope === 'user') {
    await execFileAsync('claude', [
      'plugin', 'enable', pluginKey, '--scope', 'user',
    ], { timeout: 30000 })
    console.log(`[element-mgmt] Enabled ${pluginKey} (scope: user)`)
    return
  }

  // Local scope
  if (!options.agentDir) {
    throw new Error('agentDir is required for local scope enable')
  }

  const resolvedDir = options.agentDir.startsWith('~')
    ? options.agentDir.replace('~', HOME)
    : options.agentDir

  const localSettings = join(resolvedDir, '.claude', 'settings.local.json')

  await withSettingsLock(localSettings, async () => {
    await mkdir(join(resolvedDir, '.claude'), { recursive: true })
    const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
    const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
    ep[pluginKey] = true
    settings.enabledPlugins = ep
    await saveJsonSafe(localSettings, settings)
  })

  console.log(`[element-mgmt] Enabled ${pluginKey} (scope: local, dir: ${resolvedDir})`)
}

// @deprecated Use ChangePlugin() instead
/**
 * Disable a plugin without uninstalling.
 */
export async function disablePlugin(
  pluginKey: string,
  options: { scope: 'user' | 'local'; agentDir?: string },
): Promise<void> {
  if (options.scope === 'user') {
    await execFileAsync('claude', [
      'plugin', 'disable', pluginKey, '--scope', 'user',
    ], { timeout: 30000 })
    console.log(`[element-mgmt] Disabled ${pluginKey} (scope: user)`)
    return
  }

  // Local scope
  if (!options.agentDir) {
    throw new Error('agentDir is required for local scope disable')
  }

  const resolvedDir = options.agentDir.startsWith('~')
    ? options.agentDir.replace('~', HOME)
    : options.agentDir

  const localSettings = join(resolvedDir, '.claude', 'settings.local.json')

  await withSettingsLock(localSettings, async () => {
    await mkdir(join(resolvedDir, '.claude'), { recursive: true })
    const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
    const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
    ep[pluginKey] = false
    settings.enabledPlugins = ep
    await saveJsonSafe(localSettings, settings)
  })

  console.log(`[element-mgmt] Disabled ${pluginKey} (scope: local, dir: ${resolvedDir})`)
}

// ══════════════════════════════════════════════════════════════
// ChangeTitle — Full desired-state reconciliation pipeline
// ══════════════════════════════════════════════════════════════

export interface ChangeTitleResult {
  success: boolean
  agentId: string
  oldTitle: string | null
  newTitle: string | null
  operations: string[]
  installedPlugin: string | null
  uninstalledPlugin: string | null
  restartNeeded: boolean
  error?: string
}

const VALID_TITLES: ReadonlySet<string> = new Set([
  // R39.1/R39.2: 'assistant' is the 9th governance title — the per-user ASSISTANT
  // agent running the ai-maestro-assistant-role-agent role-plugin. Without it,
  // ChangeTitle(agentId,'assistant',…) is rejected at Gate 1 ("Invalid title").
  'manager', 'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member', 'autonomous', 'maintainer', 'assistant',
])

// Titles that require team membership
const TEAM_TITLES: ReadonlySet<string> = new Set([
  'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member',
])

// Titles that are standalone (no team required)
// R39.4: ASSISTANT has NO team affiliation (its panel shows "Assistant of <user>"
// where the team label would be), so it is standalone — mirroring autonomous /
// maintainer. This makes the team-membership gate (Gate 9) skip it.
const STANDALONE_TITLES: ReadonlySet<string> = new Set([
  'manager', 'autonomous', 'maintainer', 'assistant',
])

// Singleton titles (only one agent can hold this on the host/team)
const SINGLETON_TEAM_TITLES: ReadonlySet<string> = new Set(['chief-of-staff', 'orchestrator'])

export async function ChangeTitle(
  agentId: string,
  newTitle: string | null,
  options: {
    authContext: AuthContext,
    teamIds?: string[]
    skipPluginSync?: boolean
    skipRestart?: boolean
    /** R19.2: MAINTAINER requires githubRepo in "owner/repo" format (Gate 9a) */
    githubRepo?: string
  },
): Promise<ChangeTitleResult> {
  const ops: string[] = []
  const result: ChangeTitleResult = {
    success: false,
    agentId,
    oldTitle: null,
    newTitle: newTitle || null,
    operations: ops,
    installedPlugin: null,
    uninstalledPlugin: null,
    restartNeeded: false,
  }

  try {
    // ── GATE 0: Authorization (change-title: MANAGER/COS only, never self) ──
    if (!options?.authContext) {
      result.error = 'authContext is mandatory for ChangeTitle (security invariant)'
      return result
    }
    const g0err = await gate0Auth('change-title', agentId, options.authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── GATE 0b: IBCT scope enforcement ──────────────────────
    {
      const { checkIbctScope } = await import('@/lib/ibct-scope-check')
      const scopeErr = checkIbctScope(options.authContext, 'ChangeTitle')
      if (scopeErr) { result.error = scopeErr; return result }
      ops.push('G0b: IBCT scope check passed')
    }

    // ── GATE 1: Validate title value ─────────────────────────
    // R9.13: 'autonomous' is a real title bound to `ai-maestro-autonomous-agent`.
    // Two NORMALIZATIONS happen here to keep callers + legacy clients honest:
    //   (a) No `autonomous → null` collapse on the way OUT (effectiveTitle
    //       stays `'autonomous'` if that's what was requested). This prevents
    //       the old bug where `null` was treated as "no title = skip plugin
    //       install" even when the user actually wanted AUTONOMOUS.
    //   (b) `null → 'autonomous'` collapse on the way IN. Every caller that
    //       passes `null` today means "revert to AUTONOMOUS" (teams-service
    //       on member-remove, governance-service on manager-demote, the
    //       chief-of-staff replace route, and the TitleAssignmentDialog
    //       which sends `{governanceTitle: null, role: 'autonomous'}`).
    //       Previously `null` slipped through Gates 15/16 without installing
    //       `ai-maestro-autonomous-agent`, violating R9.13 silently. The
    //       normalization here fixes that regression end-to-end.
    // See docs/GOVERNANCE-RULES.md R9.13 / R11.12.
    const rawTitle = newTitle
    const effectiveTitle = newTitle === null ? 'autonomous' : newTitle
    if (effectiveTitle && !VALID_TITLES.has(effectiveTitle)) {
      result.error = `Invalid title "${effectiveTitle}". Valid: ${[...VALID_TITLES].join(', ')}`
      return result
    }
    if (rawTitle === null) {
      ops.push(`G01: Null title normalized to "autonomous" (R9.13: every agent carries a role-plugin)`)
    } else {
      ops.push(`G01: Title "${effectiveTitle}" is valid`)
    }
    // Update the result record so the API response reflects the actual
    // title that will be persisted, not the raw `null` the client sent.
    result.newTitle = effectiveTitle

    // ── GATE 2: Validate agent exists ────────────────────────
    const { getAgent, updateAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G02: Agent "${agent.name}" found`)

    // ── GATE 3: Check agent client + compatible plugins ────────
    // N:1 model: multiple plugins can serve one title. Check if ANY compatible
    // plugin exists for this title + agent's client combo.
    // If no native match exists, mark for auto-conversion at Gate 16.
    //
    // CLIENT CAPABILITY GATE (SCEN-008): For clients that have NO role-plugin
    // support at all (e.g. gemini, opencode, aider), skip plugin installation
    // entirely. The title still applies, but no plugin is installed because
    // these clients cannot load Claude Code role-plugins.
    // Uses effectiveTitle (post-Gate 1 normalization). Previously this
    // referenced `newTitle` directly, which meant a PATCH body of
    // `{governanceTitle: null, role: 'autonomous'}` passed through as
    // "no title → no plugin required", skipping Gates 15/16 and leaving
    // the agent with no role-plugin. Now `null` becomes `'autonomous'`
    // at Gate 1 and this check correctly resolves `ai-maestro-autonomous-agent`.
    const titleRequiresPlugin = effectiveTitle ? !!getRequiredPluginForTitle(effectiveTitle) : false
    let agentClientType = 'claude' // default
    let needsPluginConversion = false
    let clientSupportsRolePlugins = true
    if (titleRequiresPlugin) {
      try {
        const { detectClientType, getClientCapabilities } = await import('@/lib/client-capabilities')
        agentClientType = detectClientType(agent.program || '')

        // Self-healing: if program is empty/unknown, infer from agent state
        if (agentClientType === 'unknown') {
          let inferredClient: string | null = null
          const evidence: string[] = []
          const clientField = (agent as unknown as Record<string, unknown>).client as string | undefined
          if (clientField) { evidence.push(`client='${clientField}'`); inferredClient = clientField.toLowerCase() }
          const args = agent.programArgs || ''
          if (!inferredClient && (args.includes('--agent') || args.includes('--chrome'))) { evidence.push('Claude-only flags'); inferredClient = 'claude' }
          const wDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
          if (!inferredClient && wDir && existsSync(join(wDir, '.claude'))) { evidence.push('.claude/ dir'); inferredClient = 'claude' }
          if (inferredClient) {
            await updateAgent(agentId, { program: inferredClient } as Record<string, unknown>)
            agentClientType = inferredClient
            ops.push(`G03: program was empty — auto-fixed to '${inferredClient}' (evidence: ${evidence.join(', ')})`)
          }
        }

        // Check if the client even supports role-plugins. Gemini, opencode, aider
        // do NOT support them. Skip the conversion + install path entirely.
        const caps = getClientCapabilities(agent.program || agentClientType)
        clientSupportsRolePlugins = !!caps.rolePlugins
        if (!clientSupportsRolePlugins) {
          ops.push(`G03: Client "${agentClientType}" has no role-plugin support — skipping plugin install (title only)`)
        } else {
          // Check if compatible plugins exist for this title + client.
          // Uses effectiveTitle (post-Gate-1 normalization). Previously
          // `newTitle!` would throw when the caller passed null for AUTONOMOUS.
          const compatiblePlugins = await getCompatiblePluginsForTitle(effectiveTitle, agentClientType)
          if (compatiblePlugins.length > 0) {
            ops.push(`G03: ${compatiblePlugins.length} compatible plugin(s) for ${effectiveTitle.toUpperCase()}+${agentClientType}`)
          } else {
            // No plugins for this client — check if plugins exist for OTHER clients (auto-convert)
            const anyPlugins = await getCompatiblePluginsForTitle(effectiveTitle)
            if (anyPlugins.length > 0) {
              needsPluginConversion = true
              ops.push(`G03: No native ${agentClientType} plugin for ${effectiveTitle.toUpperCase()} — will auto-convert from ${anyPlugins[0].name}`)
            } else {
              // R9.13: role-plugin is mandatory. If not even a fallback entry
              // exists in TITLE_PLUGIN_MAP, the title has no governance persona
              // and the operation MUST be rejected rather than leaving the agent
              // without a plugin.
              ops.push(`G03: DENIED — no compatible role-plugin found for title "${effectiveTitle}" (R9.13: role-plugin is mandatory)`)
              result.error = `role-plugin is mandatory — no compatible plugin found for title "${effectiveTitle}" (R9.13)`
              return result
            }
          }
        }
      } catch {
        ops.push(`G03: Client/plugin compatibility check skipped (service unavailable)`)
      }
    } else {
      ops.push(`G03: No plugin required — client check skipped`)
    }

    // ── GATE 4: Check agent has working directory ────────────
    const agentDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
    if (titleRequiresPlugin && !agentDir) {
      result.error = `Agent "${agent.name}" has no working directory — cannot install role-plugin`
      return result
    }
    ops.push(`G04: Working directory ${agentDir ? 'available' : 'N/A (no plugin needed)'}`)

    // ── GATE 5: Detect current title from ALL sources ────────
    const { isManager, getManagerId, isChiefOfStaffAnywhere } = await import('@/lib/governance')
    let oldTitle: string | null = agent.governanceTitle || null
    if (!oldTitle && isManager(agentId)) oldTitle = 'manager'
    if (!oldTitle && isChiefOfStaffAnywhere(agentId)) oldTitle = 'chief-of-staff'
    result.oldTitle = oldTitle
    ops.push(`G05: Old title detected as "${oldTitle || 'none'}"`)

    // ── GATE 6: No-op check ─────────────────────────────────
    // Compare against REGISTRY value, not inferred oldTitle. If the team says COS
    // but the registry doesn't have governanceTitle stored, we still need to write
    // the registry and install the plugin.
    const registryTitle = agent.governanceTitle || null
    if (oldTitle === effectiveTitle && registryTitle === effectiveTitle) {
      result.success = true
      ops.push(`G06: Title already "${effectiveTitle || 'none'}" — no change`)
      return result
    }
    ops.push(`G06: Title change needed: "${oldTitle || 'none'}" → "${effectiveTitle || 'none'}"`)

    // ── GATE 7: Singleton check — MANAGER ────────────────────
    if (newTitle === 'manager') {
      const currentManagerId = getManagerId()
      if (currentManagerId && currentManagerId !== agentId) {
        const currentManager = getAgent(currentManagerId)
        result.error = `Only one MANAGER allowed. "${currentManager?.name || currentManagerId}" already holds this title.`
        return result
      }
      ops.push(`G07: MANAGER singleton check passed`)
    } else {
      ops.push(`G07: Not MANAGER — singleton check skipped`)
    }

    // ── GATE 8: Singleton check — COS/ORCHESTRATOR per team ──
    // SCEN-001 BUG-001 fix: enforce the per-team singleton here too, not
    // only in the calling UI. The TitleAssignmentDialog reads
    // team.orchestratorId / team.chiefOfStaffId to grey out the option,
    // but if the caller bypasses the UI (API PATCH, MANAGER flow, COS
    // reassign, etc.) the check must still trigger. G13b below sets
    // these fields after a successful title change, so this gate is the
    // pre-write counterpart.
    if (newTitle && SINGLETON_TEAM_TITLES.has(newTitle)) {
      const { loadTeams: loadTeamsG8 } = await import('@/lib/team-registry')
      const allTeamsG8 = loadTeamsG8()
      const memberTeamG8 = allTeamsG8.find(t => t.agentIds.includes(agentId))
      if (memberTeamG8) {
        if (newTitle === 'orchestrator' && memberTeamG8.orchestratorId && memberTeamG8.orchestratorId !== agentId) {
          const currentOrch = getAgent(memberTeamG8.orchestratorId)
          result.error = `Only one Orchestrator is allowed per team. "${currentOrch?.name || memberTeamG8.orchestratorId}" already holds this title in team "${memberTeamG8.name}".`
          ops.push(`G08: DENIED — ORCHESTRATOR singleton already held by ${memberTeamG8.orchestratorId}`)
          return result
        }
        if (newTitle === 'chief-of-staff' && memberTeamG8.chiefOfStaffId && memberTeamG8.chiefOfStaffId !== agentId) {
          const currentCos = getAgent(memberTeamG8.chiefOfStaffId)
          result.error = `Only one Chief-of-Staff is allowed per team. "${currentCos?.name || memberTeamG8.chiefOfStaffId}" already holds this title in team "${memberTeamG8.name}".`
          ops.push(`G08: DENIED — CHIEF-OF-STAFF singleton already held by ${memberTeamG8.chiefOfStaffId}`)
          return result
        }
      }
      ops.push(`G08: ${newTitle.toUpperCase()} per-team singleton check passed`)
    } else {
      ops.push(`G08: Not a per-team singleton title`)
    }

    // ── GATE 9: Team membership validation ───────────────────
    // Team titles (member, chief-of-staff, orchestrator, architect, integrator)
    // can ONLY be assigned to agents that belong to a team. If the agent has no
    // team, the title is rejected. Only MANAGER and AUTONOMOUS are standalone.
    // Uses effectiveTitle (post-Gate-1 null→'autonomous' normalization).
    if (TEAM_TITLES.has(effectiveTitle)) {
      const { loadTeams: loadTeamsG9 } = await import('@/lib/team-registry')
      const allTeamsG9 = loadTeamsG9()
      const agentInTeam = allTeamsG9.some(t => t.agentIds.includes(agentId))
      if (!agentInTeam) {
        result.error = `Title "${effectiveTitle.toUpperCase()}" requires team membership. Assign the agent to a team first.`
        return result
      }
      ops.push(`EXE: ${effectiveTitle.toUpperCase()} requires team — agent is in a team ✓`)
    } else if (STANDALONE_TITLES.has(effectiveTitle)) {
      // R3 enforcement (reverse direction): STANDALONE titles
      // (MANAGER, AUTONOMOUS, MAINTAINER) MUST NOT be assigned to an agent
      // that is currently a member of any team. The forward direction is
      // already enforced (Gate 9 above rejects TEAM_TITLES when the agent
      // has no team). The reverse was missing — found by SCEN-001 BUG-002:
      // ARCHITECT → AUTONOMOUS while still in a team would succeed,
      // setting agent.team=null but leaving the agent's id in
      // team.agentIds (registry drift, R3 violation).
      // The fix: refuse here. Caller must first ChangeTeam the agent out
      // of the team, then ChangeTitle to the standalone title.
      const { loadTeams: loadTeamsG9b } = await import('@/lib/team-registry')
      const allTeamsG9b = loadTeamsG9b()
      const memberTeamG9b = allTeamsG9b.find(t => t.agentIds.includes(agentId))
      if (memberTeamG9b) {
        result.error = `R3: ${effectiveTitle.toUpperCase()} is a standalone title and cannot be assigned while the agent is in a team. Remove agent from team "${memberTeamG9b.name}" first (Team UI → Members → Remove, or ChangeTeam pipeline), then re-attempt the title change.`
        return result
      }
      ops.push(`EXE: ${effectiveTitle.toUpperCase()} is standalone — agent is not in any team ✓ (R3)`)
    } else {
      ops.push(`EXE: Title "${effectiveTitle}" — team check N/A`)
    }

    // ── GATE 9a: MAINTAINER validation (R19.2, R19.3) ────────
    // When assigning MAINTAINER: require githubRepo, check repo uniqueness.
    // Polling-based design (no webhook, no port, no secret).
    if (newTitle === 'maintainer') {
      // R19.2: githubRepo required and must match owner/repo format
      const githubRepo = options?.githubRepo
      if (!githubRepo || typeof githubRepo !== 'string') {
        result.error = 'MAINTAINER requires a githubRepo attribute (format: "owner/repo")'
        return result
      }
      if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) {
        result.error = `Invalid githubRepo format: "${githubRepo}". Must be "owner/repo" (e.g. "Emasoft/my-project")`
        return result
      }
      // R19.3: One MAINTAINER per repo on this host
      // BUG-FIX (SCEN-018 BUG-R19.3-UNIQUENESS-001): use loadAgents() (full Agent objects)
      // instead of listAgents() (AgentSummary strips governanceTitle/githubRepo fields,
      // making the uniqueness check always pass silently).
      const { loadAgents } = await import('@/lib/agent-registry')
      const allAgents = loadAgents()
      const existingMaintainer = allAgents.find(a =>
        a.id !== agentId &&
        a.governanceTitle === 'maintainer' &&
        a.githubRepo === githubRepo &&
        !a.deletedAt
      )
      if (existingMaintainer) {
        result.error = `Repository "${githubRepo}" is already maintained by "${existingMaintainer.name}". One MAINTAINER per repo per host (R19.3).`
        return result
      }
      // Store githubRepo on agent
      await updateAgent(agentId, { githubRepo } as Record<string, unknown>)
      ops.push(`G9a: MAINTAINER validated — repo="${githubRepo}"`)
    } else {
      ops.push(`G9a: Not MAINTAINER — maintainer validation skipped`)
    }

    // ── GATE 10: Clear old MANAGER from governance.json ──────
    if (oldTitle === 'manager') {
      const { removeManager } = await import('@/lib/governance')
      await removeManager()
      ops.push(`G10: Removed manager from governance.json`)
      // MANAGER removed → block all teams + hibernate team agents
      try {
        const { blockAllTeams } = await import('@/lib/team-registry')
        const hibernated = await blockAllTeams()
        ops.push(`G10: Blocked all teams, hibernated ${hibernated.length} team agent(s)`)
      } catch (err) {
        ops.push(`G10: WARN — blockAllTeams failed: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      ops.push(`G10: Old title not MANAGER — governance.json unchanged`)
    }

    // ── GATE 11: Clear old COS — clear team + reject pending requests ─
    if (oldTitle === 'chief-of-staff' && newTitle !== 'chief-of-staff') {
      // Clear chiefOfStaffId from all teams where this agent is COS
      try {
        const { loadTeams, updateTeam } = await import('@/lib/team-registry')
        const teams = loadTeams()
        for (const team of teams) {
          if (team.chiefOfStaffId === agentId) {
            const managerId = getManagerId()
            await updateTeam(team.id, { chiefOfStaffId: null }, managerId)
            ops.push(`G11: Cleared chiefOfStaffId on team "${team.name}"`)
          }
        }
      } catch (err) {
        ops.push(`G11: WARN — Failed to clear chiefOfStaffId: ${err instanceof Error ? err.message : err}`)
      }
      // Auto-reject pending configure-agent requests from this COS
      try {
        const { loadGovernanceRequests, rejectGovernanceRequest } = await import('@/lib/governance-request-registry')
        const file = loadGovernanceRequests()
        const pendingFromCOS = file.requests.filter((r: { type: string; status: string; requestedBy: string }) =>
          r.type === 'configure-agent' && r.status === 'pending' && r.requestedBy === agentId
        )
        for (const req of pendingFromCOS) {
          const managerId = getManagerId()
          await rejectGovernanceRequest(req.id, managerId || 'system', `COS role revoked`)
        }
        if (pendingFromCOS.length > 0) {
          ops.push(`G11: Auto-rejected ${pendingFromCOS.length} pending config request(s) from old COS`)
        } else {
          ops.push(`G11: No pending requests to reject`)
        }
      } catch {
        ops.push(`G11: Pending request rejection skipped (registry unavailable)`)
      }
    } else {
      ops.push(`G11: Old title not COS — skipped`)
    }

    // ── GATE 12: Clear old ORCHESTRATOR from team ────────────
    if (oldTitle === 'orchestrator' && newTitle !== 'orchestrator') {
      try {
        const { loadTeams, updateTeam } = await import('@/lib/team-registry')
        const teams = loadTeams()
        for (const team of teams) {
          if (team.orchestratorId === agentId) {
            const managerId = getManagerId()
            await updateTeam(team.id, { orchestratorId: null }, managerId)
            ops.push(`G12: Cleared orchestratorId on team "${team.name}"`)
          }
        }
        if (!teams.some(t => t.orchestratorId === agentId)) {
          ops.push(`G12: No team had this agent as orchestrator`)
        }
      } catch (err) {
        ops.push(`G12: WARN — Failed to clear orchestratorId: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      ops.push(`G12: Old title not ORCHESTRATOR — team.orchestratorId unchanged`)
    }

    // ── GATE 13: Set new MANAGER in governance.json ──────────
    if (newTitle === 'manager') {
      const { setManager } = await import('@/lib/governance')
      await setManager(agentId)
      ops.push(`G13: Set manager in governance.json + broadcast to mesh`)
      // MANAGER assigned → unblock all teams (agents stay hibernated, manual wake required)
      try {
        const { unblockAllTeams } = await import('@/lib/team-registry')
        // REG-MAJ-03 fix (2026-05-04): unblockAllTeams is now async +
        // takes the 'teams' lock. Await it so a racing createTeam can't
        // interleave with the unblock save.
        await unblockAllTeams()
        ops.push(`G13: Unblocked all teams — agents remain hibernated until manually woken`)
      } catch (err) {
        ops.push(`G13: WARN — unblockAllTeams failed: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      ops.push(`G13: New title not MANAGER — governance.json unchanged`)
    }

    // ── GATE 13b: Set orchestratorId/chiefOfStaffId on the team ─
    // SCEN-001 BUG-001 fix: when an agent becomes ORCHESTRATOR or
    // CHIEF-OF-STAFF of a team, record the agent's id on the team so
    // the UI dialog, the per-team singleton check, and the DeleteTeam
    // revert path can find it. Without this, the team keeps
    // orchestratorId=null even though the agent is the orchestrator,
    // and a second agent can be assigned orchestrator in the same
    // team.
    if (newTitle === 'orchestrator' || newTitle === 'chief-of-staff') {
      try {
        const { loadTeams: loadTeamsG13b, updateTeam: updateTeamG13b } = await import('@/lib/team-registry')
        const allTeamsG13b = loadTeamsG13b()
        const memberTeamG13b = allTeamsG13b.find(t => t.agentIds.includes(agentId))
        if (memberTeamG13b) {
          const managerIdG13b = getManagerId()
          if (newTitle === 'orchestrator' && memberTeamG13b.orchestratorId !== agentId) {
            await updateTeamG13b(memberTeamG13b.id, { orchestratorId: agentId }, managerIdG13b)
            ops.push(`G13b: Set orchestratorId=${agentId} on team "${memberTeamG13b.name}"`)
          } else if (newTitle === 'chief-of-staff' && memberTeamG13b.chiefOfStaffId !== agentId) {
            await updateTeamG13b(memberTeamG13b.id, { chiefOfStaffId: agentId }, managerIdG13b)
            ops.push(`G13b: Set chiefOfStaffId=${agentId} on team "${memberTeamG13b.name}"`)
          } else {
            ops.push(`G13b: ${newTitle} id already set on team "${memberTeamG13b.name}"`)
          }
        } else {
          ops.push(`G13b: WARN — agent ${agentId} is ${newTitle} but not in any team (Gate 9 should have caught this)`)
        }
      } catch (err) {
        ops.push(`G13b: WARN — Failed to set ${newTitle}Id on team: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      ops.push(`G13b: New title not ORCHESTRATOR/CHIEF-OF-STAFF — team ids unchanged`)
    }

    // ── GATE 14: Write governanceTitle to agent registry ─────
    //
    // BUG-SCEN-002-P0-1 fix: verify the write actually persisted. Previous
    // behavior silently accepted whatever updateAgent returned — if the
    // write failed (cache glitch, lock contention, updateAgent returning
    // null) the pipeline continued and the old title stayed on disk,
    // creating UI/persistence drift. We now:
    //   1. Capture updateAgent's return value (null = agent not found)
    //   2. Re-read from disk (bypassing the agent cache) to confirm the
    //      in-memory change was flushed to registry.json
    //   3. FAIL the entire ChangeTitle pipeline if persistence verification
    //      does not match — callers (DeleteTeam, TitleAssignmentDialog)
    //      then know the registry is in an inconsistent state and can
    //      surface the error rather than silently succeed.
    const g14Updated = await updateAgent(agentId, { governanceTitle: effectiveTitle as any })
    if (!g14Updated) {
      result.error = `G14: updateAgent returned null for ${agentId} — registry not written`
      ops.push(`G14: DENIED — updateAgent returned null`)
      return result
    }
    if ((g14Updated.governanceTitle || null) !== (effectiveTitle || null)) {
      result.error = `G14: in-memory post-write mismatch — expected "${effectiveTitle || 'null'}", got "${g14Updated.governanceTitle || 'null'}"`
      ops.push(`G14: DENIED — in-memory post-write mismatch`)
      return result
    }
    // Re-verify by re-reading from disk. The file must reflect the new
    // title; any drift means saveAgents() silently dropped the field or
    // a concurrent writer clobbered it.
    try {
      const { readFileSync } = await import('fs')
      const { join: pathJoin } = await import('path')
      const REGISTRY_PATH = pathJoin(HOME, '.aimaestro', 'agents', 'registry.json')
      const diskAgents = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as Array<Record<string, unknown>>
      const diskAgent = diskAgents.find((a) => a.id === agentId)
      if (!diskAgent) {
        result.error = `G14: registry.json does not contain agent ${agentId} after write`
        ops.push(`G14: DENIED — agent missing from registry.json after write`)
        return result
      }
      const diskTitle = (diskAgent.governanceTitle as string | null | undefined) ?? null
      const expectedTitle = effectiveTitle ?? null
      if (diskTitle !== expectedTitle) {
        result.error = `G14: registry.json title drift — disk="${diskTitle ?? 'null'}", expected="${expectedTitle ?? 'null'}"`
        ops.push(`G14: DENIED — registry.json shows "${diskTitle ?? 'null'}" after write, expected "${expectedTitle ?? 'null'}"`)
        return result
      }
      ops.push(`G14: Set governanceTitle="${effectiveTitle || 'null'}" in registry (verified on disk)`)
    } catch (verifyErr) {
      // If we cannot even read the registry file, the write is unverifiable
      // and the pipeline must NOT continue as if it succeeded.
      result.error = `G14: registry verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`
      ops.push(`G14: DENIED — registry verification failed`)
      return result
    }

    // ── G14c: Per-op ledger entry for title change (TRDD-eac02238) ─
    // Emit a discrete 'change_title' entry AFTER the registry write is
    // verified on disk. Fire-and-forget — see lib/ledger-emit.ts for
    // failure semantics. The save-level bulk diff emitted by
    // lib/agent-registry.ts::saveAgents() is kept as a belt-and-braces
    // safety net; the per-op entry here gives state-restore tooling
    // the operation granularity it needs.
    try {
      const { emitAgentOp } = await import('@/lib/ledger-emit')
      emitAgentOp(
        'change_title',
        [
          {
            op: 'replace',
            path: `/agents/${agentId}/governanceTitle`,
            value: effectiveTitle ?? null,
          },
        ],
        {
          action: 'change-title',
          agentId: options.authContext.agentId ?? null,
          actor: options.authContext.agentId ? 'agent' : 'user',
        },
      )
      ops.push(`G14c: Per-op ledger entry emitted (change_title: "${oldTitle || 'null'}" → "${effectiveTitle || 'null'}")`)
    } catch (emitErr) {
      // Fire-and-forget: an emit failure does NOT fail ChangeTitle
      // because the save-level ledger entry still captured the mutation.
      console.error('[ChangeTitle] G14c ledger-emit threw (non-fatal):', emitErr instanceof Error ? emitErr.message : emitErr)
    }

    // ── GATE 14b: Revoke existing AID governance tokens ─────
    // Title changed → existing tokens embed the old title → revoke them.
    // Agent must re-authenticate to get a token with the new title.
    try {
      const { revokeTokensForAgent } = await import('@/lib/aid-token')
      const revoked = await revokeTokensForAgent(agentId)
      if (revoked > 0) {
        ops.push(`G14b: Revoked ${revoked} AID governance token(s) (old title invalidated)`)
      } else {
        ops.push(`G14b: No active AID tokens to revoke`)
      }
    } catch {
      ops.push(`G14b: WARN — Token revocation skipped (aid-token module error)`)
    }

    // ── GATE 14e: Revoke portfolio tokens this agent MINTED (R28) ─────
    // When a title change REMOVES manager/COS authority, every approval/mandate
    // this agent issued as a delegated authority must die — otherwise a demoted
    // MANAGER's grants would keep authorizing operations. (The portfolio-check
    // re-validates the issuer's current title as defence-in-depth, but the
    // sweep here is the primary, eager revocation.)
    {
      const oldWasIssuer =
        oldTitle === 'manager' || oldTitle === 'chief-of-staff'
      const newIsIssuer =
        effectiveTitle === 'manager' || effectiveTitle === 'chief-of-staff'
      if (oldWasIssuer && !newIsIssuer) {
        try {
          const { revokeTokensFromIssuer } = await import('@/lib/portfolio-store')
          const revoked = await revokeTokensFromIssuer(agentId)
          if (revoked > 0) {
            const { emitPortfolioOp } = await import('@/lib/portfolio-ledger')
            void emitPortfolioOp(
              'revoke_portfolio_token',
              agentId,
              [{ op: 'replace', path: `/portfolios/_issuer/${agentId}/status`, value: 'revoked' }],
              {
                action: 'revoke-issuer-portfolio-tokens',
                agentId: options.authContext.agentId ?? null,
                actor: options.authContext.agentId ? 'agent' : 'user',
              },
            )
            ops.push(`G14e: Revoked ${revoked} portfolio token(s) minted by this agent (lost issuer authority)`)
          } else {
            ops.push(`G14e: No portfolio tokens minted by this agent to revoke`)
          }
        } catch (pErr) {
          ops.push(`G14e: WARN — portfolio token revocation skipped: ${pErr instanceof Error ? pErr.message : pErr}`)
        }
      }
    }

    // ── GATE 14d: Uninstall role-plugin bound to the OLD title ─────────
    // (EMS-MIN-02 fix: this gate was previously labeled G14c, colliding
    // with the per-op ledger emit at line ~2304. Renamed to G14d so the
    // sequential gate labels stay unique.)
    //
    // Before G15 computes the target plugin, explicitly uninstall any
    // role-plugin that is incompatible with the NEW title. This is the
    // symmetric counterpart to G16's plugin install and closes the
    // "AUTONOMOUS agent still carries its orchestrator plugin" hole
    // exposed by SCEN-002 P0-002:
    //
    //   1. DeleteTeam reverts all team agents to AUTONOMOUS.
    //   2. Without G14d, G15's `uninstallAllRolePlugins()` sweeps with
    //      the GitHub marketplace name only, and silently no-ops for any
    //      plugin whose marketplace key does not match. The agent then
    //      has governanceTitle=null while still carrying its old plugin.
    //   3. G14d detects the plugin via its FULL settings.local.json key
    //      (`name@marketplace`) and routes it through ChangePlugin with
    //      `rolePluginSwap: true`, giving us the full uninstall pipeline
    //      (CLI uninstall + settings.local.json safeguard + final state
    //      verification) regardless of which marketplace it came from.
    //
    // G14d only runs when:
    //   - oldTitle is set and differs from the new effectiveTitle
    //   - agent has a working directory
    //   - client supports role-plugins
    //   - the agent actually has a role-plugin installed
    //   - that plugin is NOT compatible with the new title
    //
    // Compatibility is checked via getCompatiblePluginsForTitle(). If the
    // plugin IS compatible (e.g. MANAGER → ARCHITECT swap keeps a plugin
    // that happens to be compatible with both), G14d is a no-op and G15
    // handles the rest.
    if (!options?.skipPluginSync && agentDir && clientSupportsRolePlugins && oldTitle && oldTitle !== effectiveTitle) {
      try {
        const localSettingsPath = join(
          agentDir.startsWith('~') ? agentDir.replace('~', HOME) : agentDir,
          '.claude',
          'settings.local.json',
        )
        if (existsSync(localSettingsPath)) {
          const settings = await loadJsonSafe(localSettingsPath) as Record<string, Record<string, unknown>>
          const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
          // Collect ALL role-plugin keys currently enabled so we can uninstall
          // each one (an agent should only ever carry one, but if two sneaked
          // in — e.g. via a race condition — we clean both to avoid the G17
          // mismatch warning later).
          const roleEntries: Array<{ name: string; marketplace: string }> = []
          for (const fullKey of Object.keys(ep)) {
            if (!ep[fullKey]) continue
            const atIdx = fullKey.indexOf('@')
            if (atIdx < 0) continue
            const plugName = fullKey.substring(0, atIdx)
            const plugMarket = fullKey.substring(atIdx + 1)
            // Recognize a plugin as a role-plugin if it is predefined OR
            // appears in the TITLE_PLUGIN_MAP (covers the 7 canonical names).
            const isRole =
              (PREDEFINED_ROLE_PLUGIN_NAMES as readonly string[]).includes(plugName) ||
              Object.values(TITLE_PLUGIN_MAP).includes(plugName)
            if (!isRole) continue
            // If the plugin is compatible with the NEW title, keep it —
            // G15 will preserve it. Otherwise schedule for uninstall.
            if (effectiveTitle) {
              try {
                const compatible = await getCompatiblePluginsForTitle(effectiveTitle, agentClientType)
                if (compatible.some(p => p.name === plugName)) {
                  continue // plugin is compatible with new title → keep it
                }
              } catch {
                // If compatibility check fails, err on the safe side and
                // include the plugin in the uninstall list. Better to
                // uninstall + reinstall than leave a stale plugin that
                // grants governance-scoped permissions the new title must not have.
              }
            }
            roleEntries.push({ name: plugName, marketplace: plugMarket })
          }

          if (roleEntries.length === 0) {
            ops.push(`G14d: No role-plugin bound to old title "${oldTitle}" to uninstall`)
          } else {
            for (const entry of roleEntries) {
              try {
                const cpResult = await ChangePlugin(
                  agentId,
                  {
                    name: entry.name,
                    marketplace: entry.marketplace,
                    action: 'uninstall',
                    scope: 'local',
                    agentDir,
                    rolePluginSwap: true, // bypass role-plugin guard — this IS the governance pipeline
                  },
                  options.authContext,
                )
                if (cpResult.success) {
                  ops.push(`G14d: Uninstalled "${entry.name}@${entry.marketplace}" (bound to old title "${oldTitle}")`)
                  // Propagate ChangePlugin's restartNeeded into the outer ChangeTitle result.
                  // G19 below compares currentPluginName vs targetPluginName to decide whether
                  // to mark restartNeeded. But G14d has ALREADY stripped the old plugin from
                  // settings.local.json, so G19 reads currentPluginName=null and, if the new
                  // title's target plugin is also absent (or matches the empty state), G19
                  // would set restartNeeded=false — yet the tmux session is STILL running
                  // with the uninstalled plugin loaded in Claude's process memory until a
                  // manual restart. Propagating cpResult.restartNeeded here (OR-merge style —
                  // true wins, G19 cannot downgrade a prior true) matches the fact that we
                  // DID mutate the agent's plugin set and the client binary must relaunch.
                  if (cpResult.restartNeeded) {
                    result.restartNeeded = true
                  }
                } else {
                  ops.push(`G14d: WARN — ChangePlugin uninstall failed for "${entry.name}": ${cpResult.error || 'unknown'}`)
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                ops.push(`G14d: WARN — ChangePlugin exception for "${entry.name}": ${msg}`)
              }
            }
          }
        } else {
          ops.push(`G14d: No settings.local.json — nothing to uninstall`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ops.push(`G14d: WARN — settings scan failed: ${msg}`)
      }
    } else if (options?.skipPluginSync) {
      ops.push(`G14d: Skipped (skipPluginSync=true)`)
    } else if (!oldTitle || oldTitle === effectiveTitle) {
      ops.push(`G14d: Skipped (no old title change to revert)`)
    } else {
      ops.push(`G14d: Skipped (no agentDir or client has no role-plugin support)`)
    }

    // ── GATE 15: Determine plugin swap (N:1 compatible-plugins model) ──
    // Find what plugin the agent currently has installed, and what plugin
    // is compatible with the NEW title + client combo.
    let currentPluginName: string | null = null
    let targetPluginName: string | null = null
    let targetMarketplace: string = GITHUB_MARKETPLACE_NAME

    if (!options?.skipPluginSync && agentDir && clientSupportsRolePlugins) {
      // Detect currently installed role-plugin from settings.local.json
      try {
        const localSettingsPath = join(agentDir.startsWith('~') ? agentDir.replace('~', HOME) : agentDir, '.claude', 'settings.local.json')
        if (existsSync(localSettingsPath)) {
          const settings = await loadJsonSafe(localSettingsPath) as Record<string, Record<string, unknown>>
          const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
          // Find the first enabled role-plugin
          for (const key of Object.keys(ep)) {
            if (ep[key]) {
              const plugName = key.split('@')[0]
              // Check if this is a role-plugin (has .agent.toml or is in predefined list)
              if (Object.values(TITLE_PLUGIN_MAP).includes(plugName) || (PREDEFINED_ROLE_PLUGIN_NAMES as readonly string[]).includes(plugName)) {
                currentPluginName = plugName
                break
              }
            }
          }
        }
      } catch { /* best effort */ }

      if (effectiveTitle) {
        // Find compatible plugins for new title + agent client
        const compatibles = await getCompatiblePluginsForTitle(effectiveTitle, agentClientType)
        if (compatibles.length > 0) {
          // If current plugin is already compatible with new title → keep it
          if (currentPluginName && compatibles.some(p => p.name === currentPluginName)) {
            targetPluginName = currentPluginName
            ops.push(`G15: Current plugin "${currentPluginName}" is compatible with ${effectiveTitle.toUpperCase()} — keeping`)
          } else {
            // Pick the first compatible plugin
            targetPluginName = compatibles[0].name
            targetMarketplace = compatibles[0].marketplace || GITHUB_MARKETPLACE_NAME
            ops.push(`G15: Selected compatible plugin "${targetPluginName}" for ${effectiveTitle.toUpperCase()}+${agentClientType}`)
          }
        } else if (needsPluginConversion) {
          // No native plugin for this client — use default and mark for conversion
          const defaultPlugin = getRequiredPluginForTitle(effectiveTitle)
          if (defaultPlugin) {
            targetPluginName = defaultPlugin
            ops.push(`G15: No native ${agentClientType} plugin — will install "${defaultPlugin}" (needs conversion)`)
          }
        } else {
          // R9.13 defence in depth: Gate 3 should already have rejected this
          // path (unreachable for valid titles), but if somehow we reach here,
          // HARD REJECT rather than proceed to Gate 16 with no plugin.
          ops.push(`G15: DENIED — no compatible role-plugin for ${effectiveTitle.toUpperCase()} (R9.13: role-plugin is mandatory)`)
          result.error = `role-plugin is mandatory — no compatible plugin for title "${effectiveTitle}" (R9.13 / Gate 15)`
          return result
        }
      }

      // Uninstall old if swapping
      if (currentPluginName && currentPluginName !== targetPluginName) {
        await uninstallAllRolePlugins(agentDir)
        result.uninstalledPlugin = currentPluginName
        ops.push(`G15: Uninstalled old role-plugin "${currentPluginName}"`)
      } else if (!currentPluginName && agentDir) {
        // Clean stale role-plugins just in case
        await uninstallAllRolePlugins(agentDir).catch(() => {})
        ops.push(`G15: Cleaned stale role-plugins`)
      }
    } else {
      ops.push(`G15: Plugin sync skipped`)
    }

    // ── GATE 16: Install new role-plugin ─────────────────────
    if (!options?.skipPluginSync && clientSupportsRolePlugins && targetPluginName && agentDir && targetPluginName !== currentPluginName) {
      try {
        if (needsPluginConversion) {
          // Non-Claude client: convert plugin to target format and install via adapter
          const { convertAndStorePlugin, emitForClient } = await import('@/services/plugin-storage-service')
          const { getAdapter } = await import('@/lib/client-plugin-adapters')
          const { clientTypeToProviderId } = await import('@/lib/client-capabilities')
          const targetClientType = agentClientType as 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro'
          const targetPid = clientTypeToProviderId(targetClientType)
          await convertAndStorePlugin(targetPluginName, 'claude', [targetClientType])
          const emittedDir = await emitForClient(targetPluginName, targetClientType)
          if (emittedDir && targetPid) {
            const adapter = await getAdapter(targetClientType)
            if (adapter) {
              const installResult = await inAdapterContext('ChangeTitle', () => adapter.install(
                { name: targetPluginName, clientType: targetClientType, storageDir: emittedDir, providerId: targetPid },
                agentDir,
                { scope: 'local' }
              ))
              if (installResult.success) {
                result.installedPlugin = targetPluginName
                ops.push(`G16: Converted + installed role-plugin "${targetPluginName}" for ${agentClientType} via adapter`)
              } else {
                ops.push(`G16: WARN — Adapter install failed: ${installResult.error}`)
              }
            } else {
              ops.push(`G16: WARN — No adapter for ${agentClientType}`)
            }
          } else {
            ops.push(`G16: WARN — Failed to emit plugin "${targetPluginName}" for ${agentClientType}`)
          }
        } else {
          // Claude client: install directly (existing behavior)
          await installPluginLocally(targetPluginName, agentDir, targetMarketplace)
          result.installedPlugin = targetPluginName
          ops.push(`G16: Installed role-plugin "${targetPluginName}"`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ops.push(`G16: WARN — Failed to install "${targetPluginName}": ${msg}`)
      }
    } else if (options?.skipPluginSync) {
      ops.push(`G16: Plugin install skipped (skipPluginSync=true)`)
    } else if (!targetPluginName) {
      ops.push(`G16: No plugin to install for ${effectiveTitle || 'none'}`)
    } else {
      ops.push(`G16: Plugin "${targetPluginName}" already installed — no change`)
    }

    // ── GATE 16b: Sync programArgs `--agent` flag to the new main-agent ──
    // Without this rewrite, the agent's wake command keeps pointing at
    // the OLD plugin's main-agent (or at no plugin at all), so Claude
    // either loads a stale persona or falls back to the default Claude
    // assistant — exactly the symptom witnessed 2026-05-06 with jack-bot
    // (MANAGER plugin installed but `--agent` still
    // `backend-infrastructure-engineer-main-agent`).
    //
    // Only Claude uses `--agent <name>` to load personas; for non-Claude
    // clients the persona is loaded via per-client manifest files written
    // by the adapter system, so we MUST NOT touch their programArgs here.
    if (
      agentClientType === 'claude' &&
      currentPluginName !== targetPluginName &&
      !options?.skipPluginSync
    ) {
      try {
        const { setClaudeAgentFlag, mainAgentNameForPlugin } = await import('@/lib/program-args')
        const desiredMainAgent = targetPluginName ? mainAgentNameForPlugin(targetPluginName) : null
        const oldArgs = agent.programArgs || ''
        const newArgs = setClaudeAgentFlag(oldArgs, desiredMainAgent)
        if (newArgs !== oldArgs) {
          const updated = await updateAgent(agentId, { programArgs: newArgs })
          if (updated) {
            ops.push(`G16b: Rewrote programArgs --agent flag: "${oldArgs}" → "${newArgs}"`)
            agent.programArgs = newArgs
          } else {
            ops.push(`G16b: WARN — updateAgent returned null when rewriting programArgs`)
          }
        } else {
          ops.push(`G16b: programArgs --agent flag already in sync`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ops.push(`G16b: WARN — Failed to rewrite programArgs: ${msg}`)
      }
    } else if (agentClientType !== 'claude') {
      ops.push(`G16b: Skipped (client="${agentClientType}" — persona not loaded via --agent)`)
    } else {
      ops.push(`G16b: Skipped (plugin unchanged or skipPluginSync)`)
    }

    // ── GATE 17: Verify plugin state consistency ─────────────
    if (!options?.skipPluginSync && clientSupportsRolePlugins && agentDir) {
      try {
        const localSettings = join(agentDir.startsWith('~') ? agentDir.replace('~', HOME) : agentDir, '.claude', 'settings.local.json')
        if (existsSync(localSettings)) {
          const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
          const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
          const activeRolePlugins = Object.keys(ep).filter(k => {
            const name = k.split('@')[0]
            return Object.values(TITLE_PLUGIN_MAP).includes(name)
          })
          if (activeRolePlugins.length > 1) {
            ops.push(`G17: WARN — ${activeRolePlugins.length} role-plugins active (expected 0 or 1). Cleaning.`)
            await uninstallAllRolePlugins(agentDir)
            if (targetPluginName) {
              await installPluginLocally(targetPluginName, agentDir, targetMarketplace).catch(() => {})
            }
          } else if (targetPluginName && activeRolePlugins.length === 1) {
            // Verify the active plugin matches the expected one for this title
            const activeName = activeRolePlugins[0].split('@')[0]
            if (activeName !== targetPluginName) {
              ops.push(`G17: MISMATCH — active "${activeName}" != expected "${targetPluginName}" for ${effectiveTitle}. Fixing.`)
              await uninstallAllRolePlugins(agentDir)
              await installPluginLocally(targetPluginName, agentDir, targetMarketplace).catch(() => {})
            } else {
              ops.push(`G17: Plugin state consistent (${activeName} matches ${effectiveTitle})`)
            }
          } else {
            ops.push(`G17: Plugin state consistent (${activeRolePlugins.length} role-plugin(s))`)
          }
        } else {
          ops.push(`G17: No settings.local.json — plugin state clean`)
        }
      } catch {
        ops.push(`G17: Plugin verification skipped (read error)`)
      }
    } else {
      ops.push(`G17: Plugin verification skipped`)
    }

    // ── GATE 18: Broadcast governance sync to mesh ───────────
    // setManager/removeManager already broadcast for MANAGER changes.
    // For other titles, broadcast a team-updated event.
    if (newTitle !== 'manager' && oldTitle !== 'manager') {
      try {
        const { broadcastGovernanceSync } = await import('@/lib/governance-sync')
        await broadcastGovernanceSync('team-updated', {
          agentId,
          oldTitle,
          newTitle: effectiveTitle,
          timestamp: new Date().toISOString(),
        }).catch(() => {})
        ops.push(`G18: Broadcast governance sync to mesh peers`)
      } catch {
        ops.push(`G18: Governance sync broadcast skipped (module unavailable)`)
      }
    } else {
      ops.push(`G18: MANAGER change — broadcast already sent by governance.ts`)
    }

    // ── GATE 19: Determine if restart needed ─────────────────
    // Restart is needed if the role-plugin changed (agent needs to reload)
    if (currentPluginName !== targetPluginName) {
      result.restartNeeded = true
      ops.push(`G19: Restart needed (plugin changed: ${currentPluginName || 'none'} → ${targetPluginName || 'none'})`)
    } else {
      ops.push(`G19: No restart needed (plugin unchanged)`)
    }

    // ── GATE 20: Queue restart if session is active ──────────
    if (result.restartNeeded && !options?.skipRestart) {
      // Check if agent has an active session
      const sessions = agent.sessions || []
      const hasActiveSession = sessions.length > 0
      if (hasActiveSession) {
        ops.push(`G20: Agent has active session(s) — restart queued for caller`)
        // Note: actual restart is triggered by the UI via useRestartQueue hook
        // The API returns restartNeeded=true, the UI handles the rest
      } else {
        ops.push(`G20: No active session — restart not applicable`)
      }
    } else {
      ops.push(`G20: Restart ${options?.skipRestart ? 'skipped (skipRestart)' : 'not needed'}`)
    }

    // ── GATE 21: Auto-title transition protection ────────────
    // Protect against team PUT route overwriting title with 'member'
    // when adding MANAGER to a team. MANAGER/COS/ORCHESTRATOR/ARCHITECT/INTEGRATOR
    // take precedence over 'member'.
    // This gate is informational — the protection is in the team PUT handler.
    if (newTitle === 'manager' || newTitle === 'chief-of-staff') {
      ops.push(`G21: ${(newTitle || '').toUpperCase()} takes precedence over team auto-title`)
    } else {
      ops.push(`G21: Auto-title protection N/A`)
    }

    // ── GATE 22: Verify final state in registry ──────────────
    // CRITICAL (SCEN-007 P0-003, SCEN-020 BUG-001, SCEN-002 P0-001):
    // This gate MUST hard-fail if the registry write did not persist.
    // Previously this was a silent WARN, which let callers claim success
    // while governanceTitle stayed null in ~/.aimaestro/agents/registry.json.
    // The UI masked the bug via a fallback `governanceTitle ?? (team ?
    // 'member' : 'autonomous')` — users only noticed when hitting the API
    // directly. Fail fast instead. Additionally, re-read from disk so any
    // late clobber (G15–G21 side effects, concurrent writer) is caught
    // before declaring success.
    const verifyAgent = getAgent(agentId)
    const finalTitle = verifyAgent?.governanceTitle || null
    if (finalTitle !== (effectiveTitle || null)) {
      result.error = `G22: Final in-memory title drift — registry shows "${finalTitle || 'null'}", expected "${effectiveTitle || 'null'}"`
      ops.push(`G22: DENIED — in-memory registry title drift`)
      return result
    }
    try {
      const { readFileSync } = await import('fs')
      const { join: pathJoin } = await import('path')
      const REGISTRY_PATH = pathJoin(HOME, '.aimaestro', 'agents', 'registry.json')
      const diskAgents = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as Array<Record<string, unknown>>
      const diskAgent = diskAgents.find((a) => a.id === agentId)
      const diskFinalTitle = (diskAgent?.governanceTitle as string | null | undefined) ?? null
      if (diskFinalTitle !== (effectiveTitle || null)) {
        result.error = `G22: Final on-disk title drift — registry.json shows "${diskFinalTitle || 'null'}", expected "${effectiveTitle || 'null'}"`
        ops.push(`G22: DENIED — on-disk registry title drift`)
        return result
      }
      ops.push(`G22: Final title verified in cache + registry.json: "${effectiveTitle || 'null'}"`)
    } catch (verifyErr) {
      result.error = `G22: Final verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`
      ops.push(`G22: DENIED — final verification failed`)
      return result
    }

    // ── GATE 23: Verify governance.json consistency ──────────
    if (newTitle === 'manager') {
      const storedManagerId = getManagerId()
      if (storedManagerId !== agentId) {
        ops.push(`G23: WARN — governance.json managerId "${storedManagerId}" != "${agentId}"`)
      } else {
        ops.push(`G23: governance.json managerId verified`)
      }
    } else if (oldTitle === 'manager') {
      const storedManagerId = getManagerId()
      if (storedManagerId === agentId) {
        ops.push(`G23: WARN — governance.json still has old managerId`)
      } else {
        ops.push(`G23: governance.json managerId cleared`)
      }
    } else {
      ops.push(`G23: governance.json check N/A`)
    }

    result.success = true
    console.log(`[ChangeTitle] Agent ${agentId} "${agent.name}": ${oldTitle || 'none'} → ${effectiveTitle || 'none'} (${ops.length} gates, restart=${result.restartNeeded})`)

    // ISSUE-001: Broadcast governance update so UI refreshes instantly.
    // Broadcasts effectiveTitle (post-Gate-1 normalization). Previously
    // sent the raw `newTitle` which meant that a revert-to-AUTONOMOUS
    // PATCH with `{governanceTitle: null}` would push `null` to every
    // client — the sidebar would flash "no title" for up to 10s until
    // the next poll reconciled it back to "AUTONOMOUS".
    try {
      const { broadcastGovernanceUpdate } = await import('@/services/shared-state')
      broadcastGovernanceUpdate(agentId, effectiveTitle)
    } catch { /* non-fatal — UI will still catch up via 10s poll */ }

    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeTitle] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// ChangePlugin — Desired-state reconciliation for plugins
// ══════════════════════════════════════════════════════════════

export interface ChangePluginResult {
  success: boolean
  pluginKey: string
  action: string
  operations: string[]
  restartNeeded: boolean
  error?: string
}

const SETTINGS_JSON = join(HOME, '.claude', 'settings.json')

export async function ChangePlugin(
  agentId: string | null,
  desired: {
    name: string
    marketplace: string
    action: 'install' | 'uninstall' | 'enable' | 'disable' | 'update'
    scope: 'user' | 'local'
    /** Agent working directory (required for local scope, auto-resolved from agentId if not provided) */
    agentDir?: string
    /** N:1 model: bypass role-plugin guard for compatible plugin swaps from RoleTab dropdown */
    rolePluginSwap?: boolean
  },
  authContext: AuthContext,
): Promise<ChangePluginResult> {
  const ops: string[] = []
  const pluginKey = `${desired.name}@${desired.marketplace}`
  const result: ChangePluginResult = {
    success: false,
    pluginKey,
    action: desired.action,
    operations: ops,
    restartNeeded: false,
  }

  try {
    // ── G00: Authorization (CRIT-04 fix, 2026-05-04) ──────────
    // Plugins ship code that runs in agent context (skills, agents, hooks,
    // MCPs, LSPs, role-personas). Anyone who can mutate the plugin set can
    // inject code into a target agent. The previous version had a
    // conditional `if (authContext) { ibctScopeCheck }` — internal callers
    // that forgot to pass authContext bypassed the check entirely. Hard-
    // reject now, then run gate0Auth, THEN the IBCT scope check.
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangePlugin (security invariant)'
      return result
    }
    const g0err = await gate0Auth('manage-skills', agentId || '', authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G00b: IBCT scope enforcement ──────────────────────────
    {
      const { checkIbctScope } = await import('@/lib/ibct-scope-check')
      const scopeOp = desired.action === 'uninstall' ? 'UninstallPlugin' : 'ChangePlugin'
      const scopeErr = checkIbctScope(authContext, scopeOp)
      if (scopeErr) { result.error = scopeErr; return result }
      ops.push('G00b: IBCT scope check passed')
    }

    // ── G01: Validate plugin name format ──────────────────────
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(desired.name)) {
      result.error = `Invalid plugin name "${desired.name}". Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
      return result
    }
    ops.push(`G01: Plugin name "${desired.name}" is valid`)

    // ── G01b: Core plugin guard (R17) ────────────────────────
    // ai-maestro-plugin cannot be uninstalled or disabled via the UI/API.
    // It can only be installed, enabled, or updated.
    if (desired.name === 'ai-maestro-plugin' && (desired.action === 'uninstall' || desired.action === 'disable')) {
      const pastTense = desired.action === 'uninstall' ? 'uninstalled' : 'disabled'
      result.error = `The ai-maestro-plugin is a core system plugin and cannot be ${pastTense} (R17). It is required for all agents to participate in the AI Maestro ecosystem.`
      return result
    }
    // ai-maestro-plugin must not be installed at user scope — only local scope.
    if (desired.name === 'ai-maestro-plugin' && desired.action === 'install' && desired.scope === 'user') {
      result.error = `The ai-maestro-plugin must be installed with --scope local, not user scope (R17.8). User-scope installation would affect all projects, not just this agent.`
      return result
    }
    if (desired.name === 'ai-maestro-plugin') {
      ops.push(`G01b: Core plugin — action "${desired.action}" allowed`)
    }

    // ── G02: Role-plugin guard ────────────────────────────────
    // Predefined role-plugins can only be installed via ChangeTitle pipeline,
    // UNLESS the caller explicitly passes rolePluginSwap=true (from RoleTab N:1 dropdown).
    const isRolePlugin = !!PREDEFINED_ROLE_PLUGINS[desired.name]
      || (PREDEFINED_ROLE_PLUGIN_NAMES as readonly string[]).includes(desired.name)
    if (isRolePlugin && !desired.rolePluginSwap) {
      result.error = `Role-plugins must be managed via ChangeTitle(), not ChangePlugin(). Use PATCH /api/agents/{id} with governanceTitle instead.`
      return result
    }
    ops.push(isRolePlugin ? `G02: Role-plugin swap (N:1 model) — allowed` : `G02: Not a role-plugin — proceed`)

    // ── G03: Resolve agent context ────────────────────────────
    let agentDir = desired.agentDir || null
    if (agentId) {
      const { getAgent } = await import('@/lib/agent-registry')
      const agent = getAgent(agentId)
      if (!agent) {
        result.error = `Agent ${agentId} not found`
        return result
      }
      if (!agentDir) {
        agentDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory || null
      }
      ops.push(`G03: Agent "${agent.name}" found, workDir=${agentDir || 'none'}`)
    } else {
      ops.push(`G03: No agentId — using explicit agentDir=${agentDir || 'none'}`)
    }

    // ── G04: Check scope validity ─────────────────────────────
    if (desired.scope === 'local' && !agentDir) {
      result.error = `agentDir is required for local scope`
      return result
    }
    ops.push(`G04: Scope "${desired.scope}" valid`)

    // ── G05: Build plugin key ─────────────────────────────────
    ops.push(`G05: Plugin key = "${pluginKey}"`)

    // ── G06: Detect current state ─────────────────────────────
    let currentState: boolean | undefined = undefined
    if (desired.scope === 'user') {
      const settingsData = await withSettingsLock(SETTINGS_JSON, async () => {
        return await loadJsonSafe(SETTINGS_JSON) as Record<string, Record<string, unknown>>
      })
      const ep = (settingsData.enabledPlugins || {}) as Record<string, boolean>
      currentState = ep[pluginKey] !== undefined ? ep[pluginKey] : undefined
    } else {
      // Local scope
      const resolvedDir = agentDir!.startsWith('~') ? agentDir!.replace('~', HOME) : agentDir!
      const localSettings = join(resolvedDir, '.claude', 'settings.local.json')
      const settingsData = await withSettingsLock(localSettings, async () => {
        return await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
      })
      const ep = (settingsData.enabledPlugins || {}) as Record<string, boolean>
      currentState = ep[pluginKey] !== undefined ? ep[pluginKey] : undefined
    }
    ops.push(`G06: Current state = ${currentState === undefined ? 'not installed' : currentState ? 'enabled' : 'disabled'}`)

    // ── G07: No-op check ──────────────────────────────────────
    if (
      (desired.action === 'install' && currentState === true) ||
      (desired.action === 'uninstall' && currentState === undefined) ||
      (desired.action === 'enable' && currentState === true) ||
      (desired.action === 'disable' && currentState === false)
    ) {
      result.success = true
      result.action = 'no-op'
      ops.push(`G07: No-op — already in desired state`)
      return result
    }
    ops.push(`G07: Action needed — "${desired.action}"`)

    // ── G08: Title dependency check on uninstall ──────────────
    if (desired.action === 'uninstall' && agentId) {
      const { getAgent } = await import('@/lib/agent-registry')
      const agent = getAgent(agentId)
      if (agent?.governanceTitle) {
        const requiredPlugin = getRequiredPluginForTitle(agent.governanceTitle)
        if (requiredPlugin === desired.name) {
          result.error = `Cannot uninstall ${desired.name} — it's required by the agent's ${agent.governanceTitle} title. Change the title first.`
          return result
        }
      }
      ops.push(`G08: Title dependency check passed`)
    } else {
      ops.push(`G08: Title dependency check ${desired.action !== 'uninstall' ? 'N/A (not uninstall)' : 'N/A (no agentId)'}`)
    }

    // ── G09: Execute action ───────────────────────────────────
    if (desired.action === 'install') {
      if (desired.scope === 'user') {
        await execFileAsync('claude', ['plugin', 'install', desired.name, desired.marketplace, '--scope', 'user'], { timeout: 120000 })
      } else {
        await installPluginLocally(desired.name, agentDir!, desired.marketplace)
      }
      ops.push(`EXE: Installed ${pluginKey} (scope: ${desired.scope})`)

    } else if (desired.action === 'uninstall') {
      if (desired.scope === 'user') {
        await execFileAsync('claude', ['plugin', 'uninstall', desired.name, desired.marketplace, '--scope', 'user'], { timeout: 30000 })
      } else {
        await uninstallPluginLocally(desired.name, agentDir!, desired.marketplace)
      }
      ops.push(`EXE: Uninstalled ${pluginKey} (scope: ${desired.scope})`)

    } else if (desired.action === 'enable') {
      if (desired.scope === 'user') {
        await execFileAsync('claude', ['plugin', 'enable', pluginKey, '--scope', 'user'], { timeout: 30000 })
      } else {
        const resolvedDir = agentDir!.startsWith('~') ? agentDir!.replace('~', HOME) : agentDir!
        const localSettings = join(resolvedDir, '.claude', 'settings.local.json')
        await withSettingsLock(localSettings, async () => {
          await mkdir(join(resolvedDir, '.claude'), { recursive: true })
          const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
          const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
          ep[pluginKey] = true
          settings.enabledPlugins = ep
          await saveJsonSafe(localSettings, settings)
        })
      }
      ops.push(`EXE: Enabled ${pluginKey} (scope: ${desired.scope})`)

    } else if (desired.action === 'disable') {
      if (desired.scope === 'user') {
        await execFileAsync('claude', ['plugin', 'disable', pluginKey, '--scope', 'user'], { timeout: 30000 })
      } else {
        const resolvedDir = agentDir!.startsWith('~') ? agentDir!.replace('~', HOME) : agentDir!
        const localSettings = join(resolvedDir, '.claude', 'settings.local.json')
        await withSettingsLock(localSettings, async () => {
          await mkdir(join(resolvedDir, '.claude'), { recursive: true })
          const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
          const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
          ep[pluginKey] = false
          settings.enabledPlugins = ep
          await saveJsonSafe(localSettings, settings)
        })
      }
      ops.push(`EXE: Disabled ${pluginKey} (scope: ${desired.scope})`)

    } else if (desired.action === 'update') {
      if (desired.scope === 'user') {
        await execFileAsync('claude', ['plugin', 'update', desired.name, desired.marketplace, '--scope', 'user'], { timeout: 120000 })
      } else {
        // Local: uninstall then reinstall
        await uninstallPluginLocally(desired.name, agentDir!, desired.marketplace)
        await installPluginLocally(desired.name, agentDir!, desired.marketplace)
      }
      ops.push(`EXE: Updated ${pluginKey} (scope: ${desired.scope})`)
    }

    // ── G10: Settings safeguard ───────────────────────────────
    if (desired.scope === 'local' && (desired.action === 'install' || desired.action === 'uninstall')) {
      const resolvedDir = agentDir!.startsWith('~') ? agentDir!.replace('~', HOME) : agentDir!
      const localSettings = join(resolvedDir, '.claude', 'settings.local.json')
      if (existsSync(localSettings)) {
        const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
        const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
        if (desired.action === 'install' && !ep[pluginKey]) {
          ops.push(`G10: WARN — settings.local.json missing plugin after install, writing safeguard`)
          await withSettingsLock(localSettings, async () => {
            const s = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
            const e = (s.enabledPlugins || {}) as Record<string, boolean>
            e[pluginKey] = true
            s.enabledPlugins = e
            await saveJsonSafe(localSettings, s)
          })
        } else if (desired.action === 'uninstall' && ep[pluginKey] !== undefined) {
          ops.push(`G10: WARN — settings.local.json still has plugin after uninstall, cleaning safeguard`)
          await withSettingsLock(localSettings, async () => {
            const s = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
            const e = (s.enabledPlugins || {}) as Record<string, boolean>
            delete e[pluginKey]
            s.enabledPlugins = e
            await saveJsonSafe(localSettings, s)
          })
        } else {
          ops.push(`G10: Settings safeguard passed`)
        }
      } else {
        ops.push(`G10: No settings.local.json to verify`)
      }
    } else {
      ops.push(`G10: Settings safeguard N/A (scope=${desired.scope}, action=${desired.action})`)
    }

    // ── G11: Verify final state ───────────────────────────────
    let finalState: boolean | undefined = undefined
    if (desired.scope === 'user') {
      const settingsData = await withSettingsLock(SETTINGS_JSON, async () => {
        return await loadJsonSafe(SETTINGS_JSON) as Record<string, Record<string, unknown>>
      })
      const ep = (settingsData.enabledPlugins || {}) as Record<string, boolean>
      finalState = ep[pluginKey] !== undefined ? ep[pluginKey] : undefined
    } else {
      const resolvedDir = agentDir!.startsWith('~') ? agentDir!.replace('~', HOME) : agentDir!
      const localSettings = join(resolvedDir, '.claude', 'settings.local.json')
      const settingsData = await withSettingsLock(localSettings, async () => {
        return await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
      })
      const ep = (settingsData.enabledPlugins || {}) as Record<string, boolean>
      finalState = ep[pluginKey] !== undefined ? ep[pluginKey] : undefined
    }

    const expectedState = desired.action === 'uninstall' ? undefined
      : desired.action === 'disable' ? false
      : true
    if (finalState !== expectedState) {
      ops.push(`G11: WARN — Final state ${finalState} != expected ${expectedState}`)
    } else {
      ops.push(`G11: Final state verified`)
    }

    // ── G11b: Role-plugin-swap programArgs rewrite ───────────
    // When this is a role-plugin SWAP install (RoleTab N:1 dropdown,
    // ChangeTitle's internal role-plugin transition, or any other path
    // that sets rolePluginSwap=true), the agent's persisted programArgs
    // is almost certainly carrying `--agent <old-plugin>-main-agent`
    // from the previous role. After the swap, that main-agent file is
    // gone — claude either falls back to the default persona or refuses
    // to launch on the next restart, depending on the client. Rewrite
    // the flag here so the registry's programArgs is self-consistent
    // with the just-installed plugin. /api/sessions/[id]/restart will
    // then read the correct value back from the registry.
    //
    // Bound conditions (intentionally narrow):
    //   - rolePluginSwap === true (caller opted in to role-plugin semantics)
    //   - action === 'install' (uninstall has no new --agent target)
    //   - agentDir resolves an agent (lookup by id, fallback by workdir)
    //   - target agent's client is claude (--agent is claude-specific)
    //
    // Skipped silently for non-claude clients — Codex/Gemini/Kiro pick
    // the persona from per-client manifest files, not from a CLI flag.
    if (
      desired.rolePluginSwap === true &&
      desired.action === 'install' &&
      agentDir
    ) {
      try {
        const { loadAgents } = await import('@/lib/agent-registry')
        const all = loadAgents()
        const owner = agentId
          ? all.find(a => a.id === agentId && !a.deletedAt)
          : all.find(a => a.workingDirectory === agentDir && !a.deletedAt)
        if (!owner) {
          ops.push(`G11b: SKIP — no agent owns ${agentDir} (was the agent deleted mid-install?)`)
        } else if ((owner.program || 'claude') !== 'claude') {
          ops.push(`G11b: SKIP — agent ${owner.id} runs ${owner.program}, not claude`)
        } else {
          const { setClaudeAgentFlag, mainAgentNameForPlugin } = await import('@/lib/program-args')
          const newMainAgent = mainAgentNameForPlugin(desired.name)
          const oldArgs = owner.programArgs || ''
          const newArgs = setClaudeAgentFlag(oldArgs, newMainAgent)
          if (newArgs !== oldArgs) {
            // AIO composition rule (IRON): when one AIO needs to perform a
            // task that another AIO already covers, it MUST call that AIO
            // — not duplicate the underlying primitive. programArgs
            // mutation is owned by ChangeCLIArgs, so we dispatch through
            // that pipeline instead of touching `updateAgent` directly.
            // Internal callers pass the system-owner authContext (same
            // pattern as the auto-update scheduler) so Gate 0 lets the
            // call through without a per-agent caller identity.
            const r = await ChangeCLIArgs(owner.id, newArgs, { isSystemOwner: true } as AuthContext)
            if (r.success) {
              ops.push(`G11b: programArgs rewritten via ChangeCLIArgs — --agent ${newMainAgent}`)
            } else {
              // Don't unwind — the plugin install already landed. Surface
              // the failure as a WARN so the operator can correct via the
              // Profile panel's CLI args field.
              ops.push(`G11b: WARN — ChangeCLIArgs refused: ${r.error || 'unknown'}`)
            }
          } else {
            ops.push(`G11b: programArgs already correct for ${desired.name}`)
          }
        }
      } catch (err) {
        // Best-effort — a registry write failure here doesn't unwind the
        // plugin install (which already succeeded). Log and continue;
        // the user can manually correct via the Profile panel if needed.
        ops.push(`G11b: WARN — programArgs rewrite failed: ${err instanceof Error ? err.message : err}`)
      }
    }

    // ── G12: Determine restart needed ─────────────────────────
    // All plugin state mutations require restart
    result.restartNeeded = true
    ops.push(`G12: Restart needed (action=${desired.action})`)

    // ── G13: Return result ────────────────────────────────────
    result.success = true
    ops.push(`G13: Success`)

    // TRDD-eac02238 step 6 (fan-out, 2026-04-20): emit per-op ledger
    // entry for ChangePlugin. Covers install/uninstall/enable/disable.
    // state-restore replays from this by re-applying the action to
    // the agent's client settings file.
    try {
      const { emitAgentOp } = await import('@/lib/ledger-emit')
      // ChangePlugin can operate user-scope (agentId === null) or local-scope
      // (agentId === the target agent). The ledger path reflects the scope
      // so state-restore can distinguish global vs per-agent plugin moves.
      const ledgerPath = agentId
        ? `/agents/${agentId}/plugins/${pluginKey}`
        : `/user/plugins/${pluginKey}`
      emitAgentOp(
        'change_plugin',
        [
          {
            op: 'replace',
            path: ledgerPath,
            value: { action: desired.action, marketplace: desired.marketplace, scope: desired.scope },
          },
        ],
        {
          action: `change-plugin-${desired.action}`,
          agentId: authContext?.agentId ?? null,
          actor: authContext?.agentId ? 'agent' : 'user',
        },
      )
    } catch (ledgerErr) {
      ops.push(`LEDGER: WARN — per-op append failed: ${ledgerErr instanceof Error ? ledgerErr.message : ledgerErr}`)
    }

    console.log(`[ChangePlugin] ${pluginKey}: ${desired.action} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangePlugin] FAILED for ${pluginKey}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// Plugin-scoped AIOs (R21.5 naming convention):
//
//   InstallPlugin   — install a plugin into ONE OR MORE targets
//   UninstallPlugin — remove a plugin from EVERY target it lives in
//   UpdatePlugin    — update a plugin in EVERY target where it's installed
//   CheckPluginUpdates — read-only outdated-version detection
//
// All four are thin orchestrators: they enumerate target locations via
// the shared lib/plugin-enumeration helpers (which never write), then
// cascade through ChangePlugin per (target, scope). R21.4 — one piece
// of code per concern. The mutation always lands inside ChangePlugin,
// so its full gate pipeline (G00..G13 + G11b + PG01..PG08) fires for
// every target.
// ══════════════════════════════════════════════════════════════

/** Aggregate result returned by plugin-scoped + marketplace-scoped AIOs.
 *  `targets` carries one entry per (target, scope) pair the operation
 *  touched, in the order it was visited. The top-level `success` is true
 *  IFF every per-target call succeeded — partial-success is reported via
 *  a populated `targets` array with mixed `success` flags. */
export interface PluginScopeResult {
  success: boolean
  operations: string[]
  restartNeeded: boolean
  error?: string
  /** One entry per per-target ChangePlugin call. */
  targets: Array<{
    name: string
    marketplace: string
    scope: 'user' | 'local'
    agentId?: string
    success: boolean
    restartNeeded: boolean
    error?: string
    /** Optional — when scope='local' and the agent has an online session,
     *  callers may queue this for restart through useRestartQueue. */
    sessionName?: string
  }>
}

/**
 * Install a plugin into ONE OR MORE targets.
 *
 * Targets are explicit — caller specifies (scope, agentDir?) tuples.
 * No automatic discovery: an Install operation needs an explicit "where"
 * decision (which agent to install for, or whether to install at user
 * scope). The auto-update scheduler does NOT use this function — it only
 * updates plugins that are already installed, never installs new ones.
 *
 * Cascades through ChangePlugin per target (R21.4).
 */
export async function InstallPlugin(desired: {
  name: string
  marketplace: string
  /** One entry per target. Each entry must specify scope; for local scope,
   *  also agentDir (the per-agent install location). agentId is optional
   *  but recommended — it lets ChangePlugin's G11b find the agent without
   *  scanning the registry by workdir. */
  targets: Array<{ scope: 'user' | 'local'; agentId?: string; agentDir?: string }>
  /** Bypass G02 role-plugin guard. Default false. The N:1 RoleTab swap
   *  is the primary caller setting this true. */
  rolePluginSwap?: boolean
}, authContext: AuthContext): Promise<PluginScopeResult> {
  const ops: string[] = []
  const out: PluginScopeResult = { success: false, operations: ops, restartNeeded: false, targets: [] }
  if (!authContext) { out.error = 'authContext is mandatory'; return out }
  if (!desired.name || !desired.marketplace) { out.error = 'name and marketplace are required'; return out }
  if (desired.targets.length === 0) { out.error = 'at least one target required'; return out }
  ops.push(`InstallPlugin: ${desired.name}@${desired.marketplace} → ${desired.targets.length} target(s)`)
  for (const t of desired.targets) {
    const r = await ChangePlugin(t.agentId ?? null, {
      name: desired.name,
      marketplace: desired.marketplace,
      action: 'install',
      scope: t.scope,
      agentDir: t.agentDir,
      rolePluginSwap: desired.rolePluginSwap ?? false,
    }, authContext)
    out.targets.push({
      name: desired.name,
      marketplace: desired.marketplace,
      scope: t.scope,
      agentId: t.agentId,
      success: r.success,
      restartNeeded: r.restartNeeded,
      error: r.error,
    })
    if (r.restartNeeded) out.restartNeeded = true
  }
  out.success = out.targets.every(t => t.success)
  if (!out.success) out.error = `Some targets failed (${out.targets.filter(t => !t.success).length}/${out.targets.length})`
  return out
}

/**
 * Uninstall a plugin from EVERY target where it's currently installed.
 *
 * Discovers targets automatically by scanning user-scope settings.json
 * + every agent's local-scope settings.local.json. This is the cascade
 * that `UninstallMarketplace` calls per plugin: without it, agents are
 * left with dangling `<plugin>@<deleted-marketplace>` keys (R21.6).
 *
 * Cascades through ChangePlugin per target (R21.4).
 */
export async function UninstallPlugin(desired: {
  name: string
  marketplace: string
  /** Bypass G02 role-plugin guard. Default true because UninstallPlugin
   *  is most often called from UninstallMarketplace's cascade where the
   *  user has already confirmed the destructive op. */
  rolePluginSwap?: boolean
}, authContext: AuthContext): Promise<PluginScopeResult> {
  const ops: string[] = []
  const out: PluginScopeResult = { success: false, operations: ops, restartNeeded: false, targets: [] }
  if (!authContext) { out.error = 'authContext is mandatory'; return out }
  if (!desired.name || !desired.marketplace) { out.error = 'name and marketplace are required'; return out }

  const { listInstallsOf } = await import('@/lib/plugin-enumeration')
  const installs = await listInstallsOf(desired.name, desired.marketplace)
  ops.push(`UninstallPlugin: ${desired.name}@${desired.marketplace} → ${installs.length} target(s) found`)
  if (installs.length === 0) {
    // Nothing to uninstall — that's a SUCCESS (R21.15 idempotency: target
    // is already in the desired "absent" state). Callers (especially
    // UninstallMarketplace) rely on this no-op behaviour.
    out.success = true
    return out
  }

  for (const inst of installs) {
    const r = await ChangePlugin(inst.agentId ?? null, {
      name: desired.name,
      marketplace: desired.marketplace,
      action: 'uninstall',
      scope: inst.scope,
      agentDir: inst.agentDir,
      rolePluginSwap: desired.rolePluginSwap ?? true,
    }, authContext)
    out.targets.push({
      name: desired.name,
      marketplace: desired.marketplace,
      scope: inst.scope,
      agentId: inst.agentId,
      success: r.success,
      restartNeeded: r.restartNeeded,
      error: r.error,
      sessionName: inst.sessionName,
    })
    if (r.restartNeeded) out.restartNeeded = true
  }
  out.success = out.targets.every(t => t.success)
  if (!out.success) out.error = `Some uninstall targets failed (${out.targets.filter(t => !t.success).length}/${out.targets.length})`
  return out
}

/**
 * Update a plugin in EVERY target where it's installed.
 *
 * Discovers targets automatically (same enumeration as UninstallPlugin).
 * Each target gets `ChangePlugin(action='update')` which does a fresh
 * pull from the marketplace cache.
 *
 * Cascades through ChangePlugin per target (R21.4). The auto-update
 * scheduler is the primary caller. Manual UI Update buttons go through
 * the per-agent ChangePlugin path directly (the user is opting in for
 * one specific agent, not the whole host).
 */
export async function UpdatePlugin(desired: {
  name: string
  marketplace: string
  rolePluginSwap?: boolean
}, authContext: AuthContext): Promise<PluginScopeResult> {
  const ops: string[] = []
  const out: PluginScopeResult = { success: false, operations: ops, restartNeeded: false, targets: [] }
  if (!authContext) { out.error = 'authContext is mandatory'; return out }
  if (!desired.name || !desired.marketplace) { out.error = 'name and marketplace are required'; return out }

  const { listInstallsOf } = await import('@/lib/plugin-enumeration')
  const installs = await listInstallsOf(desired.name, desired.marketplace)
  ops.push(`UpdatePlugin: ${desired.name}@${desired.marketplace} → ${installs.length} target(s)`)
  if (installs.length === 0) {
    // Plugin not installed anywhere → idempotent no-op success (no work
    // to do, no error to report).
    out.success = true
    return out
  }

  for (const inst of installs) {
    const r = await ChangePlugin(inst.agentId ?? null, {
      name: desired.name,
      marketplace: desired.marketplace,
      action: 'update',
      scope: inst.scope,
      agentDir: inst.agentDir,
      rolePluginSwap: desired.rolePluginSwap ?? true,
    }, authContext)
    out.targets.push({
      name: desired.name,
      marketplace: desired.marketplace,
      scope: inst.scope,
      agentId: inst.agentId,
      success: r.success,
      restartNeeded: r.restartNeeded,
      error: r.error,
      sessionName: inst.sessionName,
    })
    if (r.restartNeeded) out.restartNeeded = true
  }
  out.success = out.targets.every(t => t.success)
  if (!out.success) out.error = `Some update targets failed (${out.targets.filter(t => !t.success).length}/${out.targets.length})`
  return out
}

/**
 * Read-only check: is a given plugin outdated in any target where it's
 * installed? Returns the list of (target, currentVersion, latestVersion)
 * for every target where current ≠ latest.
 *
 * Auth note: read-only ops still take authContext for consistency with
 * the rest of the AIO surface (G00 may consult identity to decide what
 * the caller is allowed to see). For now this returns the same data to
 * every authenticated caller — no per-agent visibility filtering yet.
 */
export async function CheckPluginUpdates(desired: {
  name: string
  marketplace: string
}, authContext: AuthContext): Promise<{
  success: boolean
  outdated: Array<{
    scope: 'user' | 'local'
    agentId?: string
    agentDir?: string
    currentVersion?: string
    latestVersion?: string
  }>
  error?: string
}> {
  if (!authContext) return { success: false, outdated: [], error: 'authContext is mandatory' }
  if (!desired.name || !desired.marketplace) return { success: false, outdated: [], error: 'name and marketplace required' }

  // Look up the latest version from the cached marketplace manifest.
  const { listPluginsInMarketplace, listInstallsOf } = await import('@/lib/plugin-enumeration')
  const inMkt = await listPluginsInMarketplace(desired.marketplace)
  if (!inMkt.find(p => p.name === desired.name)) {
    return { success: true, outdated: [] }  // plugin not in this marketplace anymore — nothing outdated
  }
  // We don't have a cheap way to read installed-version per target without
  // re-shelling claude — the user's directive said to avoid CLI shell-outs
  // wherever an AIO already does the work. The auto-update scheduler
  // therefore relies on `claude plugin update` being a no-op when the
  // version matches (handled inside ChangePlugin's update path). Until we
  // teach plugin-enumeration to also read installed versions, this
  // check returns the install matrix and lets the caller decide which
  // ones are outdated. Marked as a known limitation.
  const installs = await listInstallsOf(desired.name, desired.marketplace)
  return {
    success: true,
    outdated: installs.map(i => ({
      scope: i.scope,
      agentId: i.agentId,
      agentDir: i.agentDir,
      // currentVersion / latestVersion intentionally undefined for now.
    })),
  }
}

// ══════════════════════════════════════════════════════════════
// ChangeResult — Shared result type for all Change* functions
// ══════════════════════════════════════════════════════════════

export interface ChangeResult {
  success: boolean
  operations: string[]
  restartNeeded: boolean
  error?: string
}

// ── Path safety helper ───────────────────────────────────────

/** Reject names containing path traversal or slash characters */
function isSafePathComponent(name: string): boolean {
  return !/\.\./.test(name) && !/[/\\]/.test(name) && name.length > 0
}

/** Resolve agent working directory from agentId or explicit agentDir */
async function resolveAgentDir(agentId: string | null, agentDir?: string): Promise<string | null> {
  if (agentDir) {
    return agentDir.startsWith('~') ? agentDir.replace('~', HOME) : agentDir
  }
  if (agentId) {
    const { getAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) return null
    const dir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
    return dir ? (dir.startsWith('~') ? dir.replace('~', HOME) : dir) : null
  }
  return null
}

// ── copyDirRecursive helper ──────────────────────────────────

async function copyDirRecursive(src: string, dest: string, depth = 0): Promise<void> {
  if (depth > 10) throw new Error('copyDir: max depth exceeded')
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue // skip symlinks
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath, depth + 1)
    } else {
      await copyFile(srcPath, destPath)
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Step 2: ChangeMarketplace
// ══════════════════════════════════════════════════════════════

// SCEN-017 P0-002: first-class CreateMarketplace / DeleteMarketplace / UpdateMarketplace
// pipeline functions. These are thin wrappers around ChangeMarketplace so every
// caller goes through the same gates (name validation, source validation,
// CLI invocation, cache-dir cleanup, settings.json extraKnownMarketplaces
// sync). The POST /api/settings/marketplaces route calls these wrappers
// instead of running `claude plugin marketplace add/remove/update` via
// execSync, which used to bypass the pipeline entirely.
//
// Rationale: giving each lifecycle action its own named entry point (even
// if they all delegate to ChangeMarketplace) lets future gates be layered
// onto one specific action without affecting the others — for example, a
// future R17-core-hosting-marketplace guard on DeleteMarketplace is easy
// to add here, whereas adding it inside the shared ChangeMarketplace
// `if (action === 'remove')` branch would be fragile.
export async function CreateMarketplace(desired: {
  name: string
  source: { repo: string } | { path: string }
}, authContext: AuthContext): Promise<ChangeResult> {
  return ChangeMarketplace({ action: 'add', name: desired.name, source: desired.source }, authContext)
}

export async function DeleteMarketplace(desired: {
  name: string
}, authContext: AuthContext): Promise<ChangeResult> {
  return ChangeMarketplace({ action: 'remove', name: desired.name }, authContext)
}

export async function UpdateMarketplace(desired: {
  name: string
}, authContext: AuthContext): Promise<ChangeResult> {
  return ChangeMarketplace({ action: 'update', name: desired.name }, authContext)
}

export async function ChangeMarketplace(desired: {
  action: 'add' | 'remove' | 'update'
  name: string
  source?: { repo: string } | { path: string }
}, authContext: AuthContext): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (CRIT-05 fix, 2026-05-04) ──────────
    // Marketplace add/remove/update changes which plugins are installable
    // on this host. Every agent that later installs a plugin from this
    // marketplace inherits anything that lives in it. Hard-reject on
    // missing authContext, then run gate0Auth('manage-skills'). Previously
    // the parameter was prefixed `_authContext`, signalling "ignored" —
    // which it literally was, an unauthenticated caller could swap a
    // marketplace under every agent on the host.
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeMarketplace (security invariant)'
      return result
    }
    const g0err = await gate0Auth('manage-skills', '', authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate marketplace name format ─────────────────
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(desired.name)) {
      result.error = `Invalid marketplace name "${desired.name}". Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
      return result
    }
    ops.push(`G01: Marketplace name "${desired.name}" is valid`)

    // ── G02: Validate source for add ──────────────────────────
    if (desired.action === 'add' && !desired.source) {
      result.error = `Source is required for add action`
      return result
    }
    ops.push(`G02: Source validated`)

    // ── G03: Execute action ───────────────────────────────────
    if (desired.action === 'add') {
      const source = desired.source!
      const sourceArg = 'repo' in source ? source.repo : source.path
      await execFileAsync('claude', ['plugin', 'marketplace', 'add', sourceArg], { timeout: 120000 })
      ops.push(`G03: Added marketplace "${desired.name}" from ${sourceArg}`)
    } else if (desired.action === 'remove') {
      // ── G02b: CASCADE through UninstallPlugin (R21.6) ────────
      // Before tearing down the marketplace registration / cache / settings,
      // uninstall every plugin that came from this marketplace from every
      // target where it's installed (user-scope + every agent's local-scope).
      // Without this cascade, agents are left with dangling
      // `<plugin>@<deleted-marketplace>` keys in settings.local.json — the
      // next claude launch breaks because the marketplace no longer exists.
      //
      // We do this BEFORE the CLI/cache/settings cleanup so:
      //   1. The plugin enumeration helpers can still find the marketplace
      //      manifest at ~/.claude/plugins/marketplaces/<name>/ to list
      //      its plugins. After G04 below clears the cache directory the
      //      manifest is gone and the cascade would have nothing to walk.
      //   2. ChangePlugin's per-target uninstall can still verify final
      //      state via PG01 — the marketplace registration lookup still
      //      resolves at this point.
      //
      // Each cascade failure is logged but does NOT abort the marketplace
      // removal — the user explicitly chose to delete this marketplace,
      // and a stuck per-agent uninstall (e.g. read-only filesystem on a
      // remote host) should not block the local cleanup. The aggregate
      // result is reported via the operations log.
      try {
        const { listPluginsInMarketplace } = await import('@/lib/plugin-enumeration')
        const plugins = await listPluginsInMarketplace(desired.name)
        ops.push(`G02b: Cascade — ${plugins.length} plugin(s) in marketplace, dispatching UninstallPlugin per plugin`)
        let totalTargets = 0
        let totalFailures = 0
        for (const p of plugins) {
          const ur = await UninstallPlugin({
            name: p.name,
            marketplace: desired.name,
            rolePluginSwap: true,
          }, authContext)
          totalTargets += ur.targets.length
          totalFailures += ur.targets.filter(t => !t.success).length
        }
        ops.push(`G02b: Cascade complete — ${totalTargets} per-target uninstall(s), ${totalFailures} failure(s)`)
      } catch (cascadeErr) {
        const msg = cascadeErr instanceof Error ? cascadeErr.message : String(cascadeErr)
        ops.push(`G02b: Cascade WARN — ${msg} (proceeding with marketplace removal anyway)`)
      }

      // SCEN-019 BUG-004 (2026-04-30): the CLI returns non-zero with
      // "not found" if the marketplace name isn't registered with Claude
      // CLI itself. That is NOT a fatal error for the pipeline — the
      // caller may be cleaning up an orphan key in settings.json (e.g.
      // a derived owner-repo name that the route stamped but the CLI
      // never registered). Treat "not found" as a no-op for G03 and
      // proceed to G04 (cache cleanup) and G05 (settings cleanup), so
      // an orphan extraKnownMarketplaces key can still be reaped.
      try {
        await execFileAsync('claude', ['plugin', 'marketplace', 'remove', desired.name], { timeout: 120000 })
        ops.push(`G03: Removed marketplace "${desired.name}"`)
      } catch (cliErr) {
        const msg = cliErr instanceof Error ? cliErr.message : String(cliErr)
        if (msg.includes('not found')) {
          ops.push(`G03: CLI did not know "${desired.name}" — proceeding to file cleanup (orphan path)`)
        } else {
          throw cliErr
        }
      }

      // Clean up cached plugins
      const cacheDir = join(HOME, '.claude', 'plugins', 'marketplaces', desired.name)
      if (existsSync(cacheDir)) {
        await rm(cacheDir, { recursive: true, force: true })
        ops.push(`G04: Cleaned up cached plugins at ${cacheDir}`)
      }

      // Remove from extraKnownMarketplaces in settings.json
      await withSettingsLock(SETTINGS_JSON, async () => {
        const settings = await loadJsonSafe(SETTINGS_JSON) as Record<string, Record<string, unknown>>
        const ekm = settings.extraKnownMarketplaces as Record<string, unknown> | undefined
        if (ekm && ekm[desired.name] !== undefined) {
          delete ekm[desired.name]
          settings.extraKnownMarketplaces = ekm
          await saveJsonSafe(SETTINGS_JSON, settings)
          ops.push(`G05: Removed from extraKnownMarketplaces`)
        }
      })
    } else if (desired.action === 'update') {
      await execFileAsync('claude', ['plugin', 'marketplace', 'update', desired.name], { timeout: 120000 })
      ops.push(`G03: Updated marketplace "${desired.name}"`)
    }

    // ── Final ─────────────────────────────────────────────────
    result.success = true
    result.restartNeeded = desired.action !== 'update'
    ops.push(`G06: Success`)
    console.log(`[ChangeMarketplace] ${desired.name}: ${desired.action} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeMarketplace] FAILED for ${desired.name}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// Step 3: ChangeSkill
// ══════════════════════════════════════════════════════════════

export async function ChangeSkill(agentId: string | null, desired: {
  name: string
  action: 'install' | 'remove' | 'convert'
  scope: 'user' | 'local'
  sourcePath?: string
  targetClient?: string
  agentDir?: string
}, authContext: AuthContext): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (CRIT-06 fix, 2026-05-04) ──────────
    // Skills ship code that runs in agent context. The previous parameter
    // name `_authContext` signalled "ignored" and the function literally
    // never authenticated the caller — anyone could install or remove a
    // skill in any agent's local scope (or in user scope, affecting every
    // agent on the host). Hard-reject on missing authContext, then run
    // gate0Auth('manage-skills').
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeSkill (security invariant)'
      return result
    }
    const g0err = await gate0Auth('manage-skills', agentId || '', authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate skill name ──────────────────────────────
    if (!isSafePathComponent(desired.name)) {
      result.error = `Invalid skill name "${desired.name}". Must not contain ".." or "/" characters`
      return result
    }
    ops.push(`G01: Skill name "${desired.name}" is valid`)

    // ── G02: Resolve agent context ────────────────────────────
    const resolvedDir = await resolveAgentDir(agentId, desired.agentDir)
    if (desired.scope === 'local' && !resolvedDir) {
      result.error = `agentDir is required for local scope`
      return result
    }
    ops.push(`G02: Agent context resolved (dir=${resolvedDir || 'user-scope'})`)

    // ── G03: Resolve target directory ─────────────────────────
    const baseDir = desired.scope === 'user'
      ? join(HOME, '.claude', 'skills')
      : join(resolvedDir!, '.claude', 'skills')
    const targetDir = join(baseDir, desired.name)
    ops.push(`G03: Target = ${targetDir}`)

    // ── G04-G09: Execute action ───────────────────────────────
    if (desired.action === 'install') {
      if (!desired.sourcePath) {
        result.error = `sourcePath is required for install action`
        return result
      }
      if (!existsSync(desired.sourcePath)) {
        result.error = `Source path "${desired.sourcePath}" not found`
        return result
      }
      if (existsSync(targetDir)) {
        result.error = `Skill "${desired.name}" already exists at ${targetDir}`
        return result
      }
      await mkdir(baseDir, { recursive: true })
      await copyDirRecursive(desired.sourcePath, targetDir)
      ops.push(`G04: Installed skill from ${desired.sourcePath}`)
    } else if (desired.action === 'remove') {
      if (!existsSync(targetDir)) {
        result.error = `Skill "${desired.name}" not found at ${targetDir}`
        return result
      }
      await rm(targetDir, { recursive: true, force: true })
      ops.push(`G04: Removed skill directory`)
    } else if (desired.action === 'convert') {
      if (!desired.targetClient) {
        result.error = `targetClient is required for convert action`
        return result
      }
      const { convertElements } = await import('@/services/cross-client-conversion-service')
      type ProviderId = Parameters<typeof convertElements>[0]['targetClient']
      const convertResult = await convertElements({
        source: desired.sourcePath || targetDir,
        targetClient: desired.targetClient as ProviderId,
        elements: ['skills'],
        scope: desired.scope === 'user' ? 'user' : 'project',
      })
      if (!convertResult.ok) {
        result.error = convertResult.error || 'Conversion failed'
        return result
      }
      ops.push(`G04: Converted skill to ${desired.targetClient}`)
    }

    // ── Verify final state ────────────────────────────────────
    if (desired.action === 'install' && !existsSync(targetDir)) {
      ops.push(`G05: WARN — target dir missing after install`)
    } else if (desired.action === 'remove' && existsSync(targetDir)) {
      ops.push(`G05: WARN — target dir still exists after remove`)
    } else {
      ops.push(`G05: Final state verified`)
    }

    {
      const scopePath = agentId ? `/agents/${agentId}/skills/${desired.name}` : `/user/skills/${desired.name}`
      await tryEmitLedgerOp(
        'change_skill',
        [{ op: 'replace', path: scopePath, value: { action: desired.action, scope: desired.scope } }],
        authContext,
        `change-skill-${desired.action}`,
        ops,
      )
    }
    result.success = true
    result.restartNeeded = true
    ops.push(`G06: Success`)
    console.log(`[ChangeSkill] ${desired.name}: ${desired.action} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeSkill] FAILED for ${desired.name}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// Step 4: ChangeAgentDef, ChangeCommand, ChangeRule, ChangeOutputStyle
// ══════════════════════════════════════════════════════════════

/** Internal helper for single-file elements (.md files in .claude/ subdirectories) */
async function changeSimpleElement(
  elementType: string,
  subDir: string,
  extension: string,
  agentId: string | null,
  desired: {
    name: string
    action: 'install' | 'remove'
    scope: 'user' | 'local'
    sourcePath?: string
    content?: string
    agentDir?: string
  },
  // TRDD-eac02238 step 6 (fan-out): per-op ledger emit is shared across
  // the 4 simple-element Change* pipelines (AgentDef, Command, Rule,
  // OutputStyle). Caller passes the specific LedgerOp + authContext so
  // one helper covers all four.
  ledgerOp?: import('@/types/ledger').LedgerOp,
  authContext?: AuthContext,
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G01: Validate name ────────────────────────────────────
    if (!isSafePathComponent(desired.name)) {
      result.error = `Invalid ${elementType} name "${desired.name}". Must not contain ".." or "/" characters`
      return result
    }
    ops.push(`G01: Name "${desired.name}" is valid`)

    // ── G02: Resolve agent context ────────────────────────────
    const resolvedDir = await resolveAgentDir(agentId, desired.agentDir)
    if (desired.scope === 'local' && !resolvedDir) {
      result.error = `agentDir is required for local scope`
      return result
    }
    ops.push(`G02: Agent context resolved`)

    // ── G03: Resolve target path ──────────────────────────────
    const baseDir = desired.scope === 'user'
      ? join(HOME, '.claude', subDir)
      : join(resolvedDir!, '.claude', subDir)
    const targetPath = join(baseDir, `${desired.name}${extension}`)
    ops.push(`G03: Target = ${targetPath}`)

    // ── G04-G07: Execute action ───────────────────────────────
    if (desired.action === 'install') {
      if (!desired.sourcePath && !desired.content) {
        result.error = `sourcePath or content is required for install action`
        return result
      }
      if (existsSync(targetPath)) {
        result.error = `${elementType} "${desired.name}" already exists at ${targetPath}`
        return result
      }
      await mkdir(baseDir, { recursive: true })
      if (desired.sourcePath) {
        await copyFile(desired.sourcePath, targetPath)
        ops.push(`G04: Installed from ${desired.sourcePath}`)
      } else {
        await writeFile(targetPath, desired.content!, 'utf-8')
        ops.push(`G04: Installed from content`)
      }
    } else if (desired.action === 'remove') {
      if (!existsSync(targetPath)) {
        result.error = `${elementType} "${desired.name}" not found at ${targetPath}`
        return result
      }
      await rm(targetPath, { recursive: true, force: true })
      ops.push(`G04: Removed ${elementType}`)
    }

    // ── Verify final state ────────────────────────────────────
    if (desired.action === 'install' && !existsSync(targetPath)) {
      ops.push(`G05: WARN — target missing after install`)
    } else if (desired.action === 'remove' && existsSync(targetPath)) {
      ops.push(`G05: WARN — target still exists after remove`)
    } else {
      ops.push(`G05: Final state verified`)
    }

    if (ledgerOp) {
      const scopePath = agentId
        ? `/agents/${agentId}/${subDir}/${desired.name}`
        : `/user/${subDir}/${desired.name}`
      await tryEmitLedgerOp(
        ledgerOp,
        [{ op: 'replace', path: scopePath, value: { action: desired.action, scope: desired.scope } }],
        authContext,
        `${ledgerOp}-${desired.action}`,
        ops,
      )
    }

    result.success = true
    result.restartNeeded = true
    ops.push(`G06: Success`)
    console.log(`[Change${elementType}] ${desired.name}: ${desired.action} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[Change${elementType}] FAILED for ${desired.name}:`, result.error)
    return result
  }
}

export async function ChangeAgentDef(
  agentId: string | null,
  desired: { name: string; action: 'install' | 'remove'; scope: 'user' | 'local'; sourcePath?: string; content?: string; agentDir?: string },
  authContext: AuthContext,
): Promise<ChangeResult> {
  return changeSimpleElement('agent definition', 'agents', '.md', agentId, desired, 'change_agent_def', authContext)
}

export async function ChangeCommand(
  agentId: string | null,
  desired: { name: string; action: 'install' | 'remove'; scope: 'user' | 'local'; sourcePath?: string; content?: string; agentDir?: string },
  authContext: AuthContext,
): Promise<ChangeResult> {
  return changeSimpleElement('command', 'commands', '.md', agentId, desired, 'change_command', authContext)
}

export async function ChangeRule(
  agentId: string | null,
  desired: { name: string; action: 'install' | 'remove'; scope: 'user' | 'local'; sourcePath?: string; content?: string; agentDir?: string },
  authContext: AuthContext,
): Promise<ChangeResult> {
  return changeSimpleElement('rule', 'rules', '.md', agentId, desired, 'change_rule', authContext)
}

export async function ChangeOutputStyle(
  agentId: string | null,
  desired: { name: string; action: 'install' | 'remove'; scope: 'user' | 'local'; sourcePath?: string; content?: string; agentDir?: string },
  authContext: AuthContext,
): Promise<ChangeResult> {
  return changeSimpleElement('output style', 'output-styles', '.md', agentId, desired, 'change_output_style', authContext)
}

// ══════════════════════════════════════════════════════════════
// Step 5: ChangeMCP
// ══════════════════════════════════════════════════════════════

export async function ChangeMCP(agentId: string | null, desired: {
  name: string
  action: 'add' | 'remove'
  scope: 'user' | 'local' | 'project'
  config?: Record<string, unknown>
  agentDir?: string
}, authContext: AuthContext): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (CRIT-01 fix, 2026-05-04) ──────────
    // MCP servers run code in agent context. Anyone who can mutate the MCP
    // list can inject a malicious tool into a target agent. Hard-reject on
    // missing authContext, then run gate0Auth('manage-skills').
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeMCP (security invariant)'
      return result
    }
    const g0err = await gate0Auth('manage-skills', agentId || '', authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate server name ─────────────────────────────
    if (!isSafePathComponent(desired.name)) {
      result.error = `Invalid MCP server name "${desired.name}". Must not contain ".." or "/" characters`
      return result
    }
    ops.push(`G01: Server name "${desired.name}" is valid`)

    // ── G02: Resolve agent context ────────────────────────────
    const resolvedDir = await resolveAgentDir(agentId, desired.agentDir)
    ops.push(`G02: Agent context resolved (dir=${resolvedDir || 'none'})`)

    // ── G03: Validate config for add ──────────────────────────
    if (desired.action === 'add' && !desired.config) {
      result.error = `config is required for add action`
      return result
    }
    ops.push(`G03: Config validated`)

    // ── G04: Execute action ───────────────────────────────────
    const scopeArgs = ['--scope', desired.scope]
    const cwd = resolvedDir || undefined

    if (desired.action === 'add') {
      const configJson = JSON.stringify(desired.config)
      await execFileAsync('claude', ['mcp', 'add-json', desired.name, configJson, ...scopeArgs], { timeout: 120000, cwd })
      ops.push(`G04: Added MCP server "${desired.name}" (scope: ${desired.scope})`)
    } else if (desired.action === 'remove') {
      await execFileAsync('claude', ['mcp', 'remove', desired.name, ...scopeArgs], { timeout: 120000, cwd })
      ops.push(`G04: Removed MCP server "${desired.name}" (scope: ${desired.scope})`)
    }

    {
      const scopePath = agentId ? `/agents/${agentId}/mcp/${desired.name}` : `/user/mcp/${desired.name}`
      await tryEmitLedgerOp(
        'change_mcp',
        [{ op: 'replace', path: scopePath, value: { action: desired.action, scope: desired.scope } }],
        authContext,
        `change-mcp-${desired.action}`,
        ops,
      )
    }
    result.success = true
    result.restartNeeded = true
    ops.push(`G05: Success`)
    console.log(`[ChangeMCP] ${desired.name}: ${desired.action} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeMCP] FAILED for ${desired.name}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// Step 6: ChangeLSP
// ══════════════════════════════════════════════════════════════

export async function ChangeLSP(agentId: string | null, desired: {
  name: string
  action: 'add' | 'remove'
  config?: Record<string, unknown>
  agentDir?: string
}, authContext: AuthContext): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (CRIT-02 fix, 2026-05-04) ──────────
    // LSP servers run as child processes in agent context. Same threat model
    // as MCP. Hard-reject on missing authContext, then run gate0Auth.
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeLSP (security invariant)'
      return result
    }
    const g0err = await gate0Auth('manage-skills', agentId || '', authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate name ────────────────────────────────────
    if (!isSafePathComponent(desired.name)) {
      result.error = `Invalid LSP server name "${desired.name}". Must not contain ".." or "/" characters`
      return result
    }
    ops.push(`G01: LSP name "${desired.name}" is valid`)

    // ── G02: Validate config for add ──────────────────────────
    if (desired.action === 'add' && !desired.config) {
      result.error = `config is required for add action`
      return result
    }
    ops.push(`G02: Config validated`)

    // ── G03: Resolve target .lsp.json ─────────────────────────
    const resolvedDir = await resolveAgentDir(agentId, desired.agentDir)
    const lspJsonPath = resolvedDir
      ? join(resolvedDir, '.lsp.json')
      : join(HOME, '.lsp.json')
    ops.push(`G03: LSP config path = ${lspJsonPath}`)

    // ── G04: Read/Write .lsp.json ─────────────────────────────
    let lspConfig: Record<string, unknown> = {}
    if (existsSync(lspJsonPath)) {
      try {
        const raw = await readFile(lspJsonPath, 'utf-8')
        lspConfig = JSON.parse(raw) as Record<string, unknown>
      } catch {
        lspConfig = {}
      }
    }

    if (desired.action === 'add') {
      lspConfig[desired.name] = desired.config
      await writeFile(lspJsonPath, JSON.stringify(lspConfig, null, 2), 'utf-8')
      ops.push(`G04: Added LSP "${desired.name}" to ${lspJsonPath}`)
    } else if (desired.action === 'remove') {
      if (lspConfig[desired.name] === undefined) {
        result.error = `LSP "${desired.name}" not found in ${lspJsonPath}`
        return result
      }
      delete lspConfig[desired.name]
      await writeFile(lspJsonPath, JSON.stringify(lspConfig, null, 2), 'utf-8')
      ops.push(`G04: Removed LSP "${desired.name}" from ${lspJsonPath}`)
    }

    {
      const scopePath = agentId ? `/agents/${agentId}/lsp/${desired.name}` : `/user/lsp/${desired.name}`
      await tryEmitLedgerOp(
        'change_lsp',
        [{ op: 'replace', path: scopePath, value: { action: desired.action } }],
        authContext,
        `change-lsp-${desired.action}`,
        ops,
      )
    }
    result.success = true
    result.restartNeeded = true
    ops.push(`G05: Success`)
    console.log(`[ChangeLSP] ${desired.name}: ${desired.action} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeLSP] FAILED for ${desired.name}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// Step 6: ChangeHook
// ══════════════════════════════════════════════════════════════

const VALID_HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'Stop', 'Notification',
  'SubagentStop', 'SubagentStart',
])

export async function ChangeHook(agentId: string | null, desired: {
  event: string
  action: 'add' | 'remove'
  hookConfig?: { command: string; matcher?: string; timeout?: number }
  scope: 'user' | 'local'
  agentDir?: string
}, authContext: AuthContext): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (CRIT-03 fix, 2026-05-04) ──────────
    // Hooks run arbitrary shell commands when matched events fire. This is
    // the highest-impact code-injection vector in the entire pipeline:
    // anyone who can call ChangeHook without auth can land a Bash command
    // that runs whenever the agent uses any tool. Hard-reject on missing
    // authContext, then run gate0Auth.
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeHook (security invariant)'
      return result
    }
    const g0err = await gate0Auth('manage-skills', agentId || '', authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate event name ──────────────────────────────
    if (!isSafePathComponent(desired.event) || !VALID_HOOK_EVENTS.has(desired.event)) {
      result.error = `Invalid hook event "${desired.event}". Must be one of: ${[...VALID_HOOK_EVENTS].join(', ')}`
      return result
    }
    ops.push(`G01: Event "${desired.event}" is valid`)

    // ── G02: Validate hookConfig for add ──────────────────────
    if (desired.action === 'add' && !desired.hookConfig) {
      result.error = `hookConfig is required for add action`
      return result
    }
    ops.push(`G02: Config validated`)

    // ── G03: Resolve settings file path ───────────────────────
    let settingsPath: string
    if (desired.scope === 'user') {
      settingsPath = SETTINGS_JSON
    } else {
      const resolvedDir = await resolveAgentDir(agentId, desired.agentDir)
      if (!resolvedDir) {
        result.error = `agentDir is required for local scope`
        return result
      }
      settingsPath = join(resolvedDir, '.claude', 'settings.local.json')
    }
    ops.push(`G03: Settings path = ${settingsPath}`)

    // ── G04: Read/Write hooks in settings ─────────────────────
    await withSettingsLock(settingsPath, async () => {
      const settings = await loadJsonSafe(settingsPath) as Record<string, unknown>
      const hooks = (settings.hooks || {}) as Record<string, Array<Record<string, unknown>>>
      const eventHooks = hooks[desired.event] || []

      if (desired.action === 'add') {
        const hookEntry: Record<string, unknown> = { command: desired.hookConfig!.command }
        if (desired.hookConfig!.matcher) hookEntry.matcher = desired.hookConfig!.matcher
        if (desired.hookConfig!.timeout) hookEntry.timeout = desired.hookConfig!.timeout
        eventHooks.push(hookEntry)
        hooks[desired.event] = eventHooks
        settings.hooks = hooks
        await saveJsonSafe(settingsPath, settings as Record<string, unknown>)
        ops.push(`G04: Added hook for ${desired.event}`)
      } else if (desired.action === 'remove') {
        if (!desired.hookConfig) {
          result.error = `hookConfig is required for remove action (to identify which hook to remove)`
          return
        }
        const idx = eventHooks.findIndex(h => h.command === desired.hookConfig!.command)
        if (idx === -1) {
          result.error = `Hook with command "${desired.hookConfig.command}" not found for event ${desired.event}`
          return
        }
        eventHooks.splice(idx, 1)
        if (eventHooks.length === 0) {
          delete hooks[desired.event]
        } else {
          hooks[desired.event] = eventHooks
        }
        settings.hooks = hooks
        await saveJsonSafe(settingsPath, settings as Record<string, unknown>)
        ops.push(`G04: Removed hook for ${desired.event}`)
      }
    })

    // If an error was set inside withSettingsLock, return it
    if (result.error) return result

    {
      const scopePath = agentId ? `/agents/${agentId}/hooks/${desired.event}` : `/user/hooks/${desired.event}`
      await tryEmitLedgerOp(
        'change_hook',
        [{ op: 'replace', path: scopePath, value: { action: desired.action, scope: desired.scope } }],
        authContext,
        `change-hook-${desired.action}`,
        ops,
      )
    }
    result.success = true
    result.restartNeeded = true
    ops.push(`G05: Success`)
    console.log(`[ChangeHook] ${desired.event}: ${desired.action} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeHook] FAILED for ${desired.event}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// Step 7: ChangeTeam
// ══════════════════════════════════════════════════════════════

export async function ChangeTeam(
  agentId: string,
  desired: {
    teamId: string | null  // null = remove from all teams
    role?: string           // 'member' | 'chief-of-staff' | 'orchestrator' | 'architect' | 'integrator'
  },
  authContext: AuthContext,
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── GATE 0: authContext is MANDATORY (security invariant) ──
    // Recovered from a07b0972 (worktree, EnterWorktree-bug-tainted, never merged).
    // Every other mutation function (ChangeTitle, ChangeName, ChangeFolder,
    // ChangeAvatar, ChangeCLIArgs, ChangeClient, DeleteTeam, DeleteAgent) has
    // this guard. ChangeTeam was the lone gap — auto-team-add cascading into
    // ChangeTitle without an authContext was the original SCEN-001 BUG-002
    // surface. If a future refactor passes null/undefined here, this guard
    // prevents silent authorization bypass.
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeTeam (security invariant)'
      return result
    }
    // MAJ-09 fix (2026-05-04): the null-guard is not enough. The earlier
    // recovery commit (abb185c9) added the null-guard but skipped the
    // actual authorization check, which meant any agent with a
    // fabricated non-null authContext (correct shape, wrong title) could
    // perform team mutations. Add gate0Auth so the action-vs-title check
    // fires here, matching every other Change* function.
    const g0err = await gate0Auth('manage-team', agentId, authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate agent exists ────────────────────────────
    const { getAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G01: Agent "${agent.name}" found`)

    // ── G01b: Manager gate — no team mutations without a MANAGER ──
    // Exception: team REMOVAL (teamId=null) is allowed without MANAGER — it's a teardown operation
    const { getTeam, updateTeam, loadTeams } = await import('@/lib/team-registry')
    const { getManagerId, isManager } = await import('@/lib/governance')
    if (!getManagerId() && desired.teamId !== null) {
      result.error = 'Team operations are blocked: no MANAGER exists on this host. Assign a MANAGER first.'
      return result
    }

    if (desired.teamId) {
      const team = getTeam(desired.teamId)
      if (!team) {
        result.error = `Team ${desired.teamId} not found`
        return result
      }
      ops.push(`G02: Team "${team.name}" found`)
    } else {
      ops.push(`G02: Removing from team — no team ID to validate`)
    }

    // ── G03: Detect current team membership ───────────────────
    const allTeams = loadTeams()
    const currentTeams = allTeams.filter(t => t.agentIds.includes(agentId))
    const currentTeam = currentTeams.length > 0 ? currentTeams[0] : null
    ops.push(`G03: Agent is in ${currentTeams.length} team(s)${currentTeam ? ` (current: "${currentTeam.name}")` : ''}`)

    const managerId = getManagerId()

    // ── REMOVE from team (teamId=null) ────────────────────────
    if (desired.teamId === null) {
      if (!currentTeam) {
        result.success = true
        ops.push(`G04: Agent not in any team — no-op`)
        return result
      }

      // G04a: COS cannot be removed from their team (R4.7 — COS immutability invariant)
      // COS title is locked to team lifecycle — only deleting the team removes COS.
      if (currentTeam.chiefOfStaffId === agentId) {
        result.error = `Cannot remove COS "${agent.name}" from team "${currentTeam.name}". COS is locked to team lifecycle (R4.7). Delete the team to remove the COS.`
        ops.push(`G04a: DENIED — Agent is COS of "${currentTeam.name}" — R4.7 COS immutability`)
        return result
      }

      // G04b: Check if agent is orchestrator
      if (currentTeam.orchestratorId === agentId) {
        ops.push(`G04b: Agent is orchestrator of "${currentTeam.name}" — clearing orchestratorId`)
        await updateTeam(currentTeam.id, { orchestratorId: null }, managerId)
      } else {
        ops.push(`G04b: Agent is not orchestrator — skip`)
      }

      // G04c: Remove agent from team.agentIds
      const newAgentIds = currentTeam.agentIds.filter(id => id !== agentId)
      await updateTeam(currentTeam.id, { agentIds: newAgentIds }, managerId)
      ops.push(`G04c: Removed agent from team "${currentTeam.name}" agentIds`)

      // G04d: Revert title to AUTONOMOUS
      // CRITICAL (SCEN-010/020 P0): Pass authContext so ChangeTitle Gate 0 doesn't
      // hard-reject with "authContext is mandatory". Without this, the title write
      // silently fails and the registry governanceTitle becomes stale/null.
      const titleResult = await ChangeTitle(agentId, 'autonomous', { authContext })
      if (!titleResult.success) {
        ops.push(`G04d: WARN — ChangeTitle to AUTONOMOUS failed: ${titleResult.error}`)
      } else {
        ops.push(`G04d: Title reverted to AUTONOMOUS`)
      }

      // PG01: Clear agent's team field in registry
      const { updateAgent } = await import('@/lib/agent-registry')
      await updateAgent(agentId, { team: '' })
      ops.push(`PG01: Cleared agent team field in registry`)

      result.restartNeeded = titleResult.restartNeeded
      await tryEmitLedgerOp(
        'change_team',
        [{ op: 'replace', path: `/agents/${agentId}/team`, value: null }],
        authContext,
        'change-team-remove',
        ops,
      )
      result.success = true
      console.log(`[ChangeTeam] Agent ${agentId} "${agent.name}": removed from team "${currentTeam.name}" (${ops.length} gates)`)
      return result
    }

    // ── ADD to team (teamId provided) ─────────────────────────
    const targetTeam = getTeam(desired.teamId)!

    // G05: Check single-team membership (unless MANAGER)
    if (currentTeam && currentTeam.id !== desired.teamId && !isManager(agentId)) {
      result.error = `Agent "${agent.name}" is already in team "${currentTeam.name}". Remove from current team first (closed teams enforce single membership).`
      return result
    }
    ops.push(`G05: Single-team membership check passed`)

    // G06: Check if already in target team
    if (targetTeam.agentIds.includes(agentId)) {
      ops.push(`G06: Agent already in target team — skip add`)
    } else {
      // G06: Add agentId to team.agentIds
      const newAgentIds = [...targetTeam.agentIds, agentId]
      await updateTeam(desired.teamId, { agentIds: newAgentIds }, managerId)
      ops.push(`G06: Added agent to team "${targetTeam.name}" agentIds`)
    }

    // G07: Set title
    // CRITICAL (SCEN-007/010/020 P0): The effective role MUST be a canonical kebab
    // string from VALID_TITLES (e.g., 'member', 'chief-of-staff'), never a display
    // label like "MEMBER" or "Chief of Staff". desired.role is already kebab by
    // contract; we also normalize defensively by lower-casing to prevent UI
    // regressions from writing a display value into the registry.
    const effectiveRole = (desired.role || 'member').toLowerCase()
    // CRITICAL: Pass authContext so ChangeTitle Gate 0 doesn't hard-reject with
    // "authContext is mandatory". Without this, ChangeTeam would silently fail
    // to assign the title — leaving agent in team but governanceTitle=null.
    // This is the root cause of SCEN-020 BUG-001 / SCEN-007 P0-003.
    const titleResult = await ChangeTitle(agentId, effectiveRole, { authContext })
    if (!titleResult.success) {
      ops.push(`G07: WARN — ChangeTitle to ${effectiveRole} failed: ${titleResult.error}`)
    } else {
      ops.push(`G07: Title set to ${effectiveRole.toUpperCase()}`)
    }

    // PG01: Set agent's team field in registry
    const { updateAgent } = await import('@/lib/agent-registry')
    await updateAgent(agentId, { team: targetTeam.name })
    ops.push(`PG01: Set agent team field to "${targetTeam.name}" in registry`)

    result.restartNeeded = titleResult.restartNeeded
    await tryEmitLedgerOp(
      'change_team',
      [{ op: 'replace', path: `/agents/${agentId}/team`, value: targetTeam.name }],
      authContext,
      'change-team-add',
      ops,
    )
    result.success = true
    console.log(`[ChangeTeam] Agent ${agentId} "${agent.name}": added to team "${targetTeam.name}" as ${effectiveRole.toUpperCase()} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeTeam] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// Step 8: ChangeName, ChangeFolder, ChangeAvatar, ChangeCLIArgs
// ══════════════════════════════════════════════════════════════

export async function ChangeName(
  agentId: string,
  newName: string,
  authContext: AuthContext,
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (modify-agent: self/MANAGER/COS) ──
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeName (security invariant)'
      return result
    }
    const g0err = await gate0Auth('modify-agent', agentId, authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate name format ─────────────────────────────
    const normalized = newName.toLowerCase()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
      result.error = `Invalid agent name "${newName}". Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ and be lowercase`
      return result
    }
    ops.push(`G01: Name "${normalized}" is valid`)

    // ── G02: Get agent from registry ──────────────────────────
    const { getAgent, updateAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G02: Agent "${agent.name}" found`)

    // ── G03: No-op check ──────────────────────────────────────
    if (agent.name === normalized) {
      result.success = true
      ops.push(`G03: Name already "${normalized}" — no-op`)
      return result
    }
    ops.push(`G03: Name change needed: "${agent.name}" → "${normalized}"`)

    // ── G04: Write to registry (uniqueness + tmux rename handled by updateAgent) ──
    const updated = await updateAgent(agentId, { name: normalized })
    if (!updated) {
      result.error = `Failed to update agent name in registry`
      return result
    }
    ops.push(`G04: Updated name in registry`)

    // ── G05: Determine restart needed ─────────────────────────
    const sessions = agent.sessions || []
    if (sessions.length > 0) {
      result.restartNeeded = true
      ops.push(`G05: Restart needed (${sessions.length} active session(s))`)
    } else {
      ops.push(`G05: No active sessions — no restart needed`)
    }

    // ── G06: Verify final state ───────────────────────────────
    const verified = getAgent(agentId)
    if (verified?.name !== normalized) {
      ops.push(`G06: WARN — Final name "${verified?.name}" != expected "${normalized}"`)
    } else {
      ops.push(`G06: Final name verified: "${normalized}"`)
    }

    await tryEmitLedgerOp(
      'change_name',
      [{ op: 'replace', path: `/agents/${agentId}/name`, value: normalized }],
      authContext,
      'change-name',
      ops,
    )
    result.success = true
    console.log(`[ChangeName] Agent ${agentId}: "${agent.name}" → "${normalized}" (${ops.length} gates, restart=${result.restartNeeded})`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeName] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

export async function ChangeFolder(
  agentId: string,
  newFolder: string,
  authContext: AuthContext,
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (modify-agent: self/MANAGER/COS) ──
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeFolder (security invariant)'
      return result
    }
    const g0err = await gate0Auth('modify-agent', agentId, authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate path ────────────────────────────────────
    if (/\.\./.test(newFolder)) {
      result.error = `Path traversal ("..") not allowed in working directory`
      return result
    }
    const resolved = newFolder.startsWith('~') ? newFolder.replace('~', HOME) : newFolder
    ops.push(`G01: Path "${resolved}" validated (no traversal)`)

    // ── G01b: Confine to ~/agents/ (SECURITY — workdir-write boundary) ──
    // The agent-shell-guard permits writes anywhere under the agent's
    // workingDirectory, and DeleteAgent's folder-delete safety (G09) is gated
    // on the folder being under ~/agents/. Relocating an agent OUTSIDE
    // ~/agents/ would let it write into the user's home / source / config
    // trees AND orphan its folder from the delete-safety guard — so a folder
    // change MUST stay under ~/agents/. Mirrors CreateAgent G03-ENFORCE and
    // DeleteAgent G09; the PATCH route (app/api/agents/[id]/route.ts) already
    // documents this as the intended ChangeFolder Gate-3 invariant, but it was
    // MISSING here (G03 only fetched the agent — no confinement). Checked
    // BEFORE the existsSync/stat probe so an out-of-bounds path never touches
    // the filesystem.
    const { resolve } = await import('path')
    const agentsRoot = resolve(HOME, 'agents')
    const normalizedTarget = resolve(resolved)
    if (normalizedTarget !== agentsRoot && !normalizedTarget.startsWith(agentsRoot + '/')) {
      result.error = `Working directory must be under ~/agents/ (got "${resolved}"). Relocating an agent outside ~/agents/ would escape the per-agent write boundary.`
      ops.push(`G01b: REFUSED — "${resolved}" is outside ~/agents/`)
      return result
    }
    ops.push(`G01b: "${resolved}" confined to ~/agents/`)

    // ── G02: Check path exists and is directory ───────────────
    if (!existsSync(resolved)) {
      result.error = `Path "${resolved}" does not exist`
      return result
    }
    const stats = await stat(resolved)
    if (!stats.isDirectory()) {
      result.error = `Path "${resolved}" is not a directory`
      return result
    }
    ops.push(`G02: Path exists and is a directory`)

    // ── G03: Get agent from registry ──────────────────────────
    const { getAgent, updateAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G03: Agent "${agent.name}" found`)

    // ── G04: No-op check ──────────────────────────────────────
    const currentDir = agent.workingDirectory || ''
    const currentResolved = currentDir.startsWith('~') ? currentDir.replace('~', HOME) : currentDir
    if (currentResolved === resolved) {
      result.success = true
      ops.push(`G04: Folder already "${resolved}" — no-op`)
      return result
    }
    ops.push(`G04: Folder change needed: "${currentResolved}" → "${resolved}"`)

    // ── G05: Write to registry ────────────────────────────────
    const updated = await updateAgent(agentId, { workingDirectory: resolved })
    if (!updated) {
      result.error = `Failed to update working directory in registry`
      return result
    }
    ops.push(`G05: Updated workingDirectory in registry`)

    // ── G06: Note about local-scope plugins ───────────────────
    console.log(`[ChangeFolder] Agent ${agentId} "${agent.name}": local-scope plugins may need re-linking after folder change`)
    ops.push(`G06: NOTE — Local-scope plugins may need re-linking`)

    // ── G07: Restart needed ───────────────────────────────────
    result.restartNeeded = true
    ops.push(`G07: Restart needed (working directory changed)`)

    await tryEmitLedgerOp(
      'change_folder',
      [{ op: 'replace', path: `/agents/${agentId}/workingDirectory`, value: resolved }],
      authContext,
      'change-folder',
      ops,
    )
    result.success = true
    console.log(`[ChangeFolder] Agent ${agentId} "${agent.name}": "${currentResolved}" → "${resolved}" (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeFolder] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

export async function ChangeAvatar(
  agentId: string,
  avatarPath: string,
  authContext: AuthContext,
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (modify-agent: self/MANAGER/COS) ──
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeAvatar (security invariant)'
      return result
    }
    const g0err = await gate0Auth('modify-agent', agentId, authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate file exists ─────────────────────────────
    // Avatar paths can be: web-relative (/avatars/women_01.jpg → public/avatars/...),
    // home-relative (~/path), or absolute (/Users/.../path)
    let resolved: string
    if (avatarPath.startsWith('/avatars/')) {
      // Web-relative URL served from public/ directory
      resolved = join(process.cwd(), 'public', avatarPath)
    } else if (avatarPath.startsWith('~')) {
      resolved = avatarPath.replace('~', HOME)
    } else {
      resolved = avatarPath
    }
    if (!existsSync(resolved)) {
      result.error = `Avatar file "${resolved}" not found`
      return result
    }
    ops.push(`G01: Avatar file exists at "${resolved}"`)

    // ── G02: Get agent from registry ──────────────────────────
    const { getAgent, updateAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G02: Agent "${agent.name}" found`)

    // ── G03: Write to registry ────────────────────────────────
    const updated = await updateAgent(agentId, { avatar: avatarPath })
    if (!updated) {
      result.error = `Failed to update avatar in registry`
      return result
    }
    ops.push(`G03: Updated avatar in registry`)

    await tryEmitLedgerOp(
      'change_avatar',
      [{ op: 'replace', path: `/agents/${agentId}/avatar`, value: avatarPath }],
      authContext,
      'change-avatar',
      ops,
    )
    result.success = true
    console.log(`[ChangeAvatar] Agent ${agentId} "${agent.name}": avatar → "${avatarPath}" (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeAvatar] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

/**
 * ChangeMetadata — agent-scoped AIO for the `metadata` field.
 *
 * Per R21.4 (AIO composition), all mutations of agent.metadata MUST go through
 * this AIO instead of calling `updateAgent` directly. This pipeline:
 *  - Authorises the caller (modify-agent: self / MANAGER / COS).
 *  - Validates shape (plain object, ≤64 KB JSON, ≤5 nesting levels).
 *  - Supports a CLEAR mode (`mode='clear'`) that nulls every existing key so
 *    `updateAgent`'s spread-merge actually wipes the field. The DELETE route
 *    used to assemble this map by hand — now it lives in one place.
 *  - Emits a ledger op so metadata changes are auditable like every other AIO.
 *
 * No restart needed: metadata is server-only state that never reaches tmux.
 */
export async function ChangeMetadata(
  agentId: string,
  metadata: Record<string, unknown>,
  authContext: AuthContext,
  options?: { mode?: 'merge' | 'clear' },
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }
  const mode = options?.mode ?? 'merge'

  try {
    // ── G00: Authorization (modify-agent: self/MANAGER/COS) ──
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeMetadata (security invariant)'
      return result
    }
    const g0err = await gate0Auth('modify-agent', agentId, authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Shape validation ─────────────────────────────────
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      result.error = 'Metadata must be a plain object'
      return result
    }
    ops.push('G01: Metadata is a plain object')

    // ── G02: Size cap (64 KB JSON) ────────────────────────────
    // 'clear' mode skips size check — payload is generated from existing keys.
    if (mode === 'merge') {
      const metadataStr = JSON.stringify(metadata)
      if (metadataStr.length > 65536) {
        result.error = 'Metadata exceeds maximum size (64KB)'
        return result
      }
      ops.push(`G02: Metadata size ${metadataStr.length} bytes ≤ 64 KB`)
    } else {
      ops.push('G02: skipped (clear mode)')
    }

    // ── G03: Nesting depth cap (≤5) ──────────────────────────
    if (mode === 'merge') {
      const checkDepth = (obj: unknown, depth: number): boolean => {
        if (depth > 5) return false
        if (obj !== null && typeof obj === 'object') {
          for (const val of Object.values(obj as Record<string, unknown>)) {
            if (!checkDepth(val, depth + 1)) return false
          }
        }
        return true
      }
      if (!checkDepth(metadata, 1)) {
        result.error = 'Metadata exceeds maximum nesting depth (5)'
        return result
      }
      ops.push('G03: Nesting depth ≤ 5')
    } else {
      ops.push('G03: skipped (clear mode)')
    }

    // ── G04: Resolve agent ────────────────────────────────────
    const { getAgent, updateAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G04: Agent "${agent.name}" found`)

    // ── EXE: Apply update ─────────────────────────────────────
    // 'clear' mode: build an undefined-valued map for every existing key so
    // updateAgent's spread-merge wipes them. (See MF-001 in agent-registry.ts.)
    let payload: Record<string, unknown>
    if (mode === 'clear') {
      const nulled: Record<string, undefined> = {}
      if (agent.metadata) {
        for (const key of Object.keys(agent.metadata)) {
          nulled[key] = undefined
        }
      }
      payload = nulled as Record<string, unknown>
    } else {
      payload = metadata
    }
    const updated = await updateAgent(agentId, { metadata: payload })
    if (!updated) {
      result.error = 'Failed to update metadata in registry'
      return result
    }
    ops.push(`EXE: metadata ${mode === 'clear' ? 'cleared' : 'merged'} via updateAgent`)

    // ── PG01: Ledger op ──────────────────────────────────────
    await tryEmitLedgerOp(
      'change_metadata',
      [{ op: mode === 'clear' ? 'remove' : 'replace', path: `/agents/${agentId}/metadata`, value: mode === 'clear' ? undefined : metadata }],
      authContext,
      'change-metadata',
      ops,
    )

    result.success = true
    console.log(`[ChangeMetadata] Agent ${agentId} "${agent.name}": metadata ${mode} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeMetadata] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

export async function ChangeCLIArgs(
  agentId: string,
  newArgs: string,
  authContext: AuthContext,
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (modify-agent: self/MANAGER/COS) ──
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeCLIArgs (security invariant)'
      return result
    }
    const g0err = await gate0Auth('modify-agent', agentId, authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate args (basic sanitization) ───────────────
    // Allow: a-z A-Z 0-9 space - _ . = / : @ (covers paths, flags, persona names)
    if (/[^a-zA-Z0-9 \-_\.=\/:@]/.test(newArgs)) {
      result.error = `CLI args contain unsafe characters. Allowed: a-z A-Z 0-9 space - _ . = / : @`
      return result
    }
    ops.push(`G01: CLI args validated`)

    // ── G02: Get agent from registry ──────────────────────────
    const { getAgent, updateAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G02: Agent "${agent.name}" found`)

    // ── G03: No-op check ──────────────────────────────────────
    if (agent.programArgs === newArgs) {
      result.success = true
      ops.push(`G03: CLI args already "${newArgs}" — no-op`)
      return result
    }
    ops.push(`G03: CLI args change needed: "${agent.programArgs || ''}" → "${newArgs}"`)

    // ── G04: Write to registry ────────────────────────────────
    const updated = await updateAgent(agentId, { programArgs: newArgs })
    if (!updated) {
      result.error = `Failed to update programArgs in registry`
      return result
    }
    ops.push(`G04: Updated programArgs in registry`)

    // ── G05: Restart needed ───────────────────────────────────
    result.restartNeeded = true
    ops.push(`G05: Restart needed (CLI args changed)`)

    await tryEmitLedgerOp(
      'change_cli_args',
      [{ op: 'replace', path: `/agents/${agentId}/programArgs`, value: newArgs }],
      authContext,
      'change-cli-args',
      ops,
    )
    result.success = true
    console.log(`[ChangeCLIArgs] Agent ${agentId} "${agent.name}": args → "${newArgs}" (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeCLIArgs] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// ChangeClient — Switch an agent's AI client (program)
//
// R18 (Plugin Continuity on Client Change) — CRITICAL
// ----------------------------------------------------
// Changing an agent's client is NEVER a simple field update. Every plugin
// installed for the old client MUST be re-emitted in the new client's format
// BEFORE any uninstall happens. If ANY plugin cannot be converted, the entire
// operation aborts — no partial state is allowed. See docs/GOVERNANCE-RULES.md
// R18.1-R18.10 and CLAUDE.md "ChangeClient — Plugin Continuity (R18)".
// ══════════════════════════════════════════════════════════════

const VALID_CLIENTS = new Set(['claude', 'codex', 'gemini', 'opencode', 'kiro'])

type ChangeClientTarget = 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro'

interface PluginConversionPlan {
  pluginName: string
  /** Marketplace name (e.g. "ai-maestro-plugins") — needed to build plugin keys for uninstall */
  marketplace?: string
  isRolePlugin: boolean
  sourceDir: string | null
  targetDir: string
  /** How we will obtain the new-client version */
  strategy: 'native-exists' | 'emit-from-ir' | 'convert-from-source'
}

export async function ChangeClient(
  agentId: string,
  newClient: string,
  authContext: AuthContext,
): Promise<ChangeResult> {
  const ops: string[] = []
  const result: ChangeResult = { success: false, operations: ops, restartNeeded: false }

  try {
    // ── G00: Authorization (modify-agent: self/MANAGER/COS) ──
    if (!authContext) {
      result.error = 'authContext is mandatory for ChangeClient (security invariant)'
      return result
    }
    const g0err = await gate0Auth('modify-agent', agentId, authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate client value ─────────────────────────────
    const normalized = newClient.toLowerCase().trim() as ChangeClientTarget
    if (!VALID_CLIENTS.has(normalized)) {
      result.error = `Invalid client "${newClient}". Valid: ${[...VALID_CLIENTS].join(', ')}`
      return result
    }
    ops.push(`G01: Client "${normalized}" is valid`)

    // ── G02: Get agent from registry ───────────────────────────
    const { getAgent, updateAgent } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId)
    if (!agent) {
      result.error = `Agent ${agentId} not found`
      return result
    }
    ops.push(`G02: Agent "${agent.name}" found`)

    // ── G03: No-op check ───────────────────────────────────────
    const oldProgram = ((agent.program || 'claude').toLowerCase()) as ChangeClientTarget
    if (oldProgram === normalized) {
      result.success = true
      ops.push(`G03: Client already "${normalized}" — no-op`)
      return result
    }
    ops.push(`G03: Client change needed: "${oldProgram}" → "${normalized}"`)

    // ── G04: Resolve agent working directory ────────────────────
    const agentDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
    if (!agentDir) {
      result.error = `Agent "${agent.name}" has no working directory — cannot reinstall plugins`
      return result
    }
    ops.push(`G04: Agent working directory "${agentDir}"`)

    // ── G05: Snapshot ALL currently installed plugins (R18.2) ────
    // Plugin names must be captured BEFORE any uninstall. Includes:
    //   - the role-plugin (if any)
    //   - all normal plugins (enabled AND disabled — we preserve both)
    const { scanAgentLocalConfig } = await import('@/services/agent-local-config-service')
    const scanResult = scanAgentLocalConfig(agentId)
    if (scanResult.error || !scanResult.data) {
      result.error = `Failed to scan agent config: ${scanResult.error || 'unknown'}`
      return result
    }
    const snapshot = scanResult.data
    // Preserve marketplace per plugin name — needed to build plugin keys for
    // the old adapter's uninstall call (Claude uses "name@marketplace" keys).
    const snapshotPlugins = new Map<string, { marketplace?: string; isRolePlugin: boolean }>()
    if (snapshot.rolePlugin?.name) {
      snapshotPlugins.set(snapshot.rolePlugin.name, {
        marketplace: snapshot.rolePlugin.marketplace,
        isRolePlugin: true,
      })
    }
    for (const p of snapshot.plugins || []) {
      if (!snapshotPlugins.has(p.name)) {
        snapshotPlugins.set(p.name, { marketplace: p.marketplace, isRolePlugin: false })
      }
    }

    // R17 safety net: the ai-maestro-plugin core plugin is mandatory on every
    // agent. If scanAgentLocalConfig couldn't see it (e.g., agent is currently
    // on a non-Claude client and its plugin lives outside .claude/), add it
    // manually to guarantee R17 is satisfied after the client change.
    const CORE_PLUGIN_NAME = 'ai-maestro-plugin'
    if (!snapshotPlugins.has(CORE_PLUGIN_NAME)) {
      snapshotPlugins.set(CORE_PLUGIN_NAME, {
        marketplace: 'ai-maestro-plugins',
        isRolePlugin: false,
      })
      ops.push(`G05b: Added ${CORE_PLUGIN_NAME} to snapshot (R17 safety net — was missing from .claude/ scan)`)
    }

    ops.push(`G05: Snapshot — ${snapshotPlugins.size} plugin(s): ${[...snapshotPlugins.keys()].join(', ') || 'none'}`)

    // ── G06: Build conversion plan for every plugin (R18.3) ─────
    // MUST succeed for ALL plugins before we touch the agent directory.
    const { convertAndStorePlugin, emitForClient, getUniversalIR } =
      await import('@/services/plugin-storage-service')

    const homeDir = process.env.HOME || ''
    const plans: PluginConversionPlan[] = []

    // R18.3d priority resolver — always prefer native sources over conversion.
    // Conversion is lossy in every direction (Claude has the richest format but
    // non-Claude clients also have features Claude lacks). Native plugins are
    // authoritative; we must use them as-is whenever they exist.
    const { findNativePluginForClient } = await import('@/services/plugin-storage-service')

    // Check if a role-plugin in ~/agents/role-plugins/<name>/ is compatible
    // with the target client by reading compatible-clients from .agent.toml.
    const isRolePluginCompatibleWithClient = (pluginName: string, client: ChangeClientTarget): boolean => {
      const profilePath = join(homeDir, 'agents', 'role-plugins', pluginName, `${pluginName}.agent.toml`)
      if (!existsSync(profilePath)) return false
      try {
        const { readFileSync } = require('fs') as typeof import('fs')
        const content = readFileSync(profilePath, 'utf-8') as string
        // Match compatible-clients = ["claude-code", "codex", ...]
        const m = content.match(/compatible-clients\s*=\s*\[([^\]]*)\]/m)
        if (!m) return false
        const list = m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '').toLowerCase())
        // Normalize claude/claude-code
        const normalizedClient = client === 'claude' ? 'claude-code' : client
        return list.includes(normalizedClient) || list.includes(client)
      } catch {
        return false
      }
    }

    // Find the richest available source for a plugin targeting `client`.
    // Returns { dir, strategy } or null if nothing found.
    const findBestSource = async (
      pluginName: string,
      client: ChangeClientTarget,
      isRolePlugin: boolean,
    ): Promise<{ dir: string; strategy: 'native-exists' | 'emit-from-ir' } | null> => {
      // (1) Client-native plugin cache (~/.{client}/plugins/cache/, etc.)
      const nativeDir = await findNativePluginForClient(pluginName, client)
      if (nativeDir) return { dir: nativeDir, strategy: 'native-exists' }

      // (2) Local role-plugins marketplace — only if compatible-clients matches
      if (isRolePlugin && isRolePluginCompatibleWithClient(pluginName, client)) {
        const rolePluginDir = join(homeDir, 'agents', 'role-plugins', pluginName)
        if (existsSync(rolePluginDir)) return { dir: rolePluginDir, strategy: 'native-exists' }
      }

      // (3) Previously emitted custom-plugins
      const suffixed = join(homeDir, 'agents', 'custom-plugins', client, `${pluginName}-${client}`)
      if (existsSync(suffixed)) return { dir: suffixed, strategy: 'native-exists' }
      const unsuffixed = join(homeDir, 'agents', 'custom-plugins', client, pluginName)
      if (existsSync(unsuffixed)) return { dir: unsuffixed, strategy: 'native-exists' }

      // (4) Universal IR emit — only if IR exists
      const ir = await getUniversalIR(pluginName)
      if (ir) {
        try {
          const emitted = await emitForClient(pluginName, client)
          if (emitted) return { dir: emitted, strategy: 'emit-from-ir' }
        } catch (err) {
          console.warn(`[ChangeClient] emitForClient failed for "${pluginName}" → ${client}:`, err)
        }
      }

      return null
    }

    for (const [name, meta] of snapshotPlugins) {
      const { marketplace, isRolePlugin } = meta

      // Priority search: try (1)-(4) in R18.3d order.
      const found = await findBestSource(name, normalized, isRolePlugin)
      if (found) {
        plans.push({
          pluginName: name,
          marketplace,
          isRolePlugin,
          sourceDir: found.dir,
          targetDir: found.dir,
          strategy: found.strategy,
        })
        continue
      }

      // (5) Last resort: fresh conversion. Forbidden when target is Claude
      // (R18.3b — X→Claude conversion is lossy and cannot invent lost features).
      if (normalized === 'claude') {
        result.error = `R18.3b violation: no canonical Claude source found for plugin "${name}". X→Claude conversion is lossy and forbidden. Restore the plugin in ~/.claude/plugins/cache/ or reinstall it from the marketplace, then retry.`
        console.error(`[ChangeClient] ${result.error}`)
        return result
      }

      // Non-Claude targets: convert from source as absolute last resort.
      // Prefer Claude as conversion source when available (richest format).
      try {
        const claudeCanonical = await findNativePluginForClient(name, 'claude')
        const conversionSource: ChangeClientTarget = claudeCanonical ? 'claude' : oldProgram
        await convertAndStorePlugin(name, conversionSource, [normalized])
        const emitted = await emitForClient(name, normalized)
        if (emitted) {
          plans.push({ pluginName: name, marketplace, isRolePlugin, sourceDir: emitted, targetDir: emitted, strategy: 'convert-from-source' })
          continue
        }
      } catch (err) {
        result.error = `R18 violation: cannot convert plugin "${name}" to ${normalized}: ${err instanceof Error ? err.message : String(err)}. Aborting before any uninstall.`
        console.error(`[ChangeClient] ${result.error}`)
        return result
      }

      // No strategy worked — abort to prevent leaving the agent without plugins
      result.error = `R18 violation: no conversion strategy succeeded for plugin "${name}" (old=${oldProgram}, new=${normalized}). Aborting before any uninstall.`
      console.error(`[ChangeClient] ${result.error}`)
      return result
    }
    ops.push(`G06: ${plans.length} plugin conversion plan(s) ready (strategies: ${plans.map(p => p.strategy).join(', ')})`)

    // ── G07: Uninstall old-client plugins from agent dir (R18.4) ─
    // Now that we know every plugin has a converted version waiting, it is
    // safe to remove the old-client versions.
    const { getAdapter } = await import('@/lib/client-plugin-adapters')
    const { clientTypeToProviderId } = await import('@/lib/client-capabilities')
    const oldAdapter = await getAdapter(oldProgram)
    const oldProviderId = clientTypeToProviderId(oldProgram)
    if (oldAdapter && oldProviderId) {
      for (const plan of plans) {
        try {
          await oldAdapter.uninstall(
            {
              name: plan.pluginName,
              clientType: oldProgram,
              storageDir: plan.sourceDir || '',
              providerId: oldProviderId,
              // Claude adapter builds the plugin key from name + sourcePlugin (hack:
              // sourcePlugin is used as marketplace name in buildPluginKey).
              sourcePlugin: plan.marketplace,
            },
            agentDir,
            { scope: 'local' }
          )
        } catch (err) {
          console.warn(`[ChangeClient] Best-effort uninstall failed for "${plan.pluginName}":`, err)
        }
      }

      // Belt-and-braces: strip the old-client plugin entries from .claude/settings.local.json
      // even if the CLI uninstall silently skipped them (which can happen for local-scope
      // plugins on offline clients). Without this, the agent ends up with both the old
      // Claude plugin key and the new Codex plugin elements, violating R18.4.
      if (oldProgram === 'claude') {
        try {
          const settingsPath = join(agentDir, '.claude', 'settings.local.json')
          if (existsSync(settingsPath)) {
            const { readFileSync, writeFileSync } = await import('fs')
            const raw = readFileSync(settingsPath, 'utf-8')
            const settings = JSON.parse(raw) as Record<string, unknown>
            const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
            let changed = false
            for (const plan of plans) {
              const key = plan.marketplace ? `${plan.pluginName}@${plan.marketplace}` : plan.pluginName
              if (key in ep) {
                delete ep[key]
                changed = true
              }
              if (plan.pluginName in ep) {
                delete ep[plan.pluginName]
                changed = true
              }
            }
            if (changed) {
              settings.enabledPlugins = ep
              writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
            }
          }
        } catch (err) {
          console.warn('[ChangeClient] Settings strip fallback failed:', err)
        }
      }

      ops.push(`G07: Uninstalled ${plans.length} old-client plugin(s) from agent dir`)
    } else {
      ops.push(`G07: No adapter/provider for old client "${oldProgram}" — skipped uninstall (best-effort)`)
    }

    // ── G08: Install new-client plugins into agent dir (R18.4) ──
    // Converted / emitted plugins live in the local custom marketplace
    // (~/agents/custom-plugins/ with a marketplace.json manifest). For Claude
    // targets the adapter needs to know this marketplace name to build the
    // correct plugin key. Role-plugins use the local roles marketplace instead.
    // MIN-03 fix (2026-05-04): drop the redundant `await import()` —
    // CUSTOM_MARKETPLACE_NAME is already imported statically at the top
    // of the file. Same rationale as MAJ-03.
    const newAdapter = await getAdapter(normalized)
    const newProviderId = clientTypeToProviderId(normalized)
    if (!newAdapter || !newProviderId) {
      result.error = `No adapter/provider for new client "${normalized}" — cannot install converted plugins`
      return result
    }
    for (const plan of plans) {
      // Which marketplace does the converted plugin belong to?
      //   - Role-plugin → LOCAL_MARKETPLACE_NAME ("ai-maestro-local-roles-marketplace")
      //   - Normal plugin converted from source → CUSTOM_MARKETPLACE_NAME ("ai-maestro-local-custom-marketplace")
      //   - Native (pre-existing) plugin → keep the original marketplace if we know it
      let installMarketplace: string | undefined
      if (plan.isRolePlugin) {
        installMarketplace = LOCAL_MARKETPLACE_NAME
      } else if (plan.strategy === 'native-exists') {
        installMarketplace = plan.marketplace
      } else {
        installMarketplace = CUSTOM_MARKETPLACE_NAME
      }

      try {
        await newAdapter.install(
          {
            name: plan.pluginName,
            clientType: normalized,
            storageDir: plan.targetDir,
            providerId: newProviderId,
            // Claude adapter builds the plugin key via sourcePlugin as marketplace (see buildPluginKey).
            sourcePlugin: installMarketplace,
          },
          agentDir,
          { scope: 'local', marketplace: installMarketplace }
        )
      } catch (err) {
        result.error = `Failed to install converted plugin "${plan.pluginName}" for ${normalized}: ${err instanceof Error ? err.message : String(err)}`
        console.error(`[ChangeClient] ${result.error}`)
        return result
      }
    }

    // Belt-and-braces: for Claude targets, verify the plugin key is actually
    // present in .claude/settings.local.json and write it back if not. The
    // claude plugin CLI can fail silently when invoked from a server child
    // process due to PATH / env differences, leaving the install as a no-op.
    if (normalized === 'claude') {
      try {
        const settingsPath = join(agentDir, '.claude', 'settings.local.json')
        const { readFileSync, writeFileSync, mkdirSync } = await import('fs')
        mkdirSync(join(agentDir, '.claude'), { recursive: true })
        let settings: Record<string, unknown> = {}
        if (existsSync(settingsPath)) {
          try { settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) } catch { /* keep empty */ }
        }
        const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
        let changed = false
        for (const plan of plans) {
          const mkt = plan.isRolePlugin
            ? LOCAL_MARKETPLACE_NAME
            : (plan.strategy === 'native-exists' ? (plan.marketplace || 'ai-maestro-plugins') : CUSTOM_MARKETPLACE_NAME)
          const key = `${plan.pluginName}@${mkt}`
          if (ep[key] !== true) {
            ep[key] = true
            changed = true
          }
        }
        if (changed) {
          settings.enabledPlugins = ep
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
          ops.push(`G08b: Settings write-back — ensured ${plans.length} plugin key(s) in .claude/settings.local.json`)
        }
      } catch (err) {
        console.warn('[ChangeClient] Claude settings write-back fallback failed:', err)
      }
    }

    ops.push(`G08: Installed ${plans.length} new-client plugin(s) into agent dir`)

    // ── G09: Write new program to registry ─────────────────────
    const updated = await updateAgent(agentId, { program: normalized })
    if (!updated) {
      result.error = `Failed to update program in registry`
      return result
    }
    ops.push(`G09: Updated program in registry`)

    // ── G10: Restart needed (R18.7) ────────────────────────────
    result.restartNeeded = true
    ops.push(`G10: Restart needed (client + plugins changed)`)

    await tryEmitLedgerOp(
      'change_client',
      [{ op: 'replace', path: `/agents/${agentId}/program`, value: normalized }],
      authContext,
      'change-client',
      ops,
    )
    result.success = true
    console.log(`[ChangeClient] Agent ${agentId} "${agent.name}": client "${oldProgram}" → "${normalized}" (${ops.length} gates, ${plans.length} plugins converted)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[ChangeClient] FAILED for agent ${agentId}:`, result.error)
    return result
  }
}

// ══════════════════════════════════════════════════════════════
// DeleteTeam — All-in-one team deletion with full gate pipeline
// ══════════════════════════════════════════════════════════════

export interface DeleteTeamResult {
  success: boolean
  teamId: string
  teamName: string | null
  operations: string[]
  error?: string
}

/**
 * All-in-one team deletion. The ONLY function that can delete a team.
 * Replaces: deleteTeamById (teams-service).
 *
 * Gates:
 *   G00: Authorization — system-owner or MANAGER only
 *   G00b: Governance password verification + rate limiting
 *   G01: Team exists
 *   G02: Archive team state before mutations
 *   G03: Revert all team agents to AUTONOMOUS via ChangeTitle (strips role-plugins)
 *   G04: Remove team from teams.json
 *   G05: Cancel pending transfers + reject governance requests (R8.3)
 *   G06: Delete team data files (tasks, documents)
 *   G07: (removed) Agents preserved as AUTONOMOUS — deletion only via Profile → Danger Zone
 */
export async function DeleteTeam(
  teamId: string,
  options: {
    authContext: AuthContext
    password?: string         // Governance password (required when passwordHash is set)
    /**
     * Proposal 7 (2026-04-20): when true, cascade-delete every team
     * agent through the DeleteAgent pipeline AFTER the team itself is
     * removed. The default (false) preserves agents as AUTONOMOUS — the
     * long-standing behavior. Set from the "Delete Agents Too" checkbox
     * in the sidebar Team Delete dialog. Deletion goes through the full
     * DeleteAgent pipeline (never raw registry deletion), with hard=true
     * and deleteFolder=true, so each agent's ~/agents/<name>/ workdir
     * is wiped and a per-agent ledger entry is emitted.
     */
    deleteAgents?: boolean
  },
): Promise<DeleteTeamResult> {
  const ops: string[] = []
  const result: DeleteTeamResult = { success: false, teamId, teamName: null, operations: ops }

  try {
    // ── G00: Authorization ─────────────────────────────────────
    // Team deletion is a destructive operation requiring governance password.
    // Only system-owner (web UI) or MANAGER can delete teams.
    if (!options?.authContext) {
      result.error = 'authContext is mandatory for DeleteTeam (security invariant)'
      return result
    }
    const g0err = await gate0Auth('manage-team', teamId, options.authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // G00c: IBCT scope enforcement
    {
      const { checkIbctScope } = await import('@/lib/ibct-scope-check')
      const scopeErr = checkIbctScope(options.authContext, 'DeleteTeam')
      if (scopeErr) { result.error = scopeErr; return result }
      ops.push('G00c: IBCT scope check passed')
    }

    // G00b: Governance password verification + rate limiting
    {
      const { loadGovernance, verifyPassword } = await import('@/lib/governance')
      const config = loadGovernance()
      if (config.passwordHash) {
        if (!options?.password) {
          result.error = 'Team deletion requires governance password'
          ops.push('G00b: DENIED — governance password not provided')
          return result
        }
        // Rate-limit password attempts to prevent brute-force
        try {
          const { checkAndRecordAttempt, resetRateLimit } = await import('@/lib/rate-limit')
          const rateKey = `team-delete-password:${teamId}`
          const rateCheck = checkAndRecordAttempt(rateKey)
          if (!rateCheck.allowed) {
            result.error = `Too many failed attempts. Try again in ${Math.ceil(rateCheck.retryAfterMs / 1000)}s`
            ops.push('G00b: DENIED — rate limited')
            return result
          }
          const valid = await verifyPassword(options.password)
          if (!valid) {
            result.error = 'Invalid governance password'
            ops.push('G00b: DENIED — invalid governance password')
            return result
          }
          resetRateLimit(rateKey)
        } catch {
          // Rate-limit module unavailable — still verify password
          const valid = await verifyPassword(options.password)
          if (!valid) {
            result.error = 'Invalid governance password'
            ops.push('G00b: DENIED — invalid governance password')
            return result
          }
        }
        ops.push('G00b: Governance password verified')
      } else {
        ops.push('G00b: No governance password set — skipped')
      }
    }

    // ── G01: Team exists ───────────────────────────────────────
    const { getTeam, deleteTeam: registryDeleteTeam } = await import('@/lib/team-registry')
    const team = getTeam(teamId)
    if (!team) {
      result.error = 'Team not found'
      ops.push('G01: Team not found')
      return result
    }
    result.teamName = team.name
    ops.push(`G01: Team "${team.name}" found (${team.agentIds.length} agents)`)

    // ── G02: Archive team state before mutations ───────────────
    // Capture full team structure for potential future recovery.
    const _teamSnapshot = JSON.parse(JSON.stringify(team)) // archived for future recovery
    ops.push(`G02: Team state archived (COS=${team.chiefOfStaffId || 'none'}, ORCH=${team.orchestratorId || 'none'})`)

    // ── G03: Revert all team agents to AUTONOMOUS + hibernate ──
    // Collect all unique agents: agentIds + COS + Orchestrator.
    // Team deletion strips role-plugins (via ChangeTitle → AUTONOMOUS) and
    // then hibernates each agent so the running session is stopped. Running
    // a stale role-plugin after its files have been removed is an inconsistent
    // state; forcing hibernation guarantees the agent restarts cleanly next
    // time it is woken. Agents are NEVER deleted by team deletion — the ONLY
    // path to delete an agent is Profile → Advanced → Danger Zone.
    const agentsToRevert = [...new Set([
      ...team.agentIds,
      ...(team.chiefOfStaffId ? [team.chiefOfStaffId] : []),
      ...(team.orchestratorId && !team.agentIds.includes(team.orchestratorId) ? [team.orchestratorId] : []),
    ])]
    // SCEN-002 P0-001: Collect any per-agent title-revert failures. Any
    // failure is a persistence-layer bug — registry.json would show a
    // non-AUTONOMOUS title on an agent whose team has been deleted. Do
    // NOT treat as "best effort WARN"; escalate to pipeline error so the
    // UI surfaces it and the operator can retry or intervene.
    const revertFailures: Array<{ agentId: string; error: string }> = []
    if (agentsToRevert.length > 0) {
      const { hibernateAgent } = await import('@/services/agents-core-service')
      const { getAgent: getAgentFromRegistry, updateAgent } = await import('@/lib/agent-registry')
      // Titles that are team-scoped and MUST be reverted when their team is deleted.
      // MANAGER and MAINTAINER are global (host-scoped) titles — they are NOT
      // team-specific. Even if a MANAGER was used as the bootstrap agent when
      // creating a team (because the Create Team modal forces ≥1 agent), deleting
      // that team MUST NOT strip the MANAGER title — otherwise every subsequent
      // team operation is blocked because no MANAGER exists. AUTONOMOUS agents
      // in the list (should not happen, but defensive) are also skipped.
      // See: tests/scenarios/reports/scenario_proposed-improvements_007_20260414T015913Z.md (P0).
      const TEAM_SCOPED_TITLES = new Set([
        'member',
        'chief-of-staff',
        'orchestrator',
        'architect',
        'integrator',
      ])
      for (const agentId of agentsToRevert) {
        let currentTitle: string | null = null
        let agentExists = false
        try {
          const a = getAgentFromRegistry(agentId)
          if (a) {
            agentExists = true
            currentTitle = a.governanceTitle || null
          }
        } catch { /* best effort */ }

        // SCEN-008 BUG-001 fix (2026-04-30): If an agent ID is in team.agentIds
        // but the agent no longer exists in the registry (orphan reference from
        // prior failed cleanup, manual JSON edits, etc.), skip the title-revert
        // and hibernate gracefully. Returning a "not found" error here would
        // permanently brick the team (DeleteTeam aborts on revert failures to
        // preserve consistency, but the consistency we're protecting is between
        // EXISTING agents — orphan IDs already represent broken state and
        // blocking on them prevents the cleanup the operator is trying to do).
        if (!agentExists) {
          ops.push(`G03: Agent ${agentId.substring(0, 8)} not found in registry (orphan reference) — skipped`)
          continue
        }

        const shouldRevertTitle = currentTitle
          ? TEAM_SCOPED_TITLES.has(currentTitle)
          : true // unknown title → err on safe side and revert

        if (!shouldRevertTitle) {
          ops.push(`G03: Agent ${agentId.substring(0, 8)} title "${currentTitle}" is global — NOT reverted (R7: MANAGER/MAINTAINER are host-scoped, not team-scoped)`)
        } else {
          // SCEN-001 BUG-003 fix (2026-04-26): remove agent from team.agentIds
          // BEFORE calling ChangeTitle. The ChangeTitle pipeline gained a Gate
          // 9b R3-reverse-enforcement check (commit 50673eac, BUG-002 fix)
          // that REJECTS revert-to-AUTONOMOUS while the agent is still listed
          // in any team's agentIds. Without this preliminary removal, every
          // DeleteTeam call now fails on the first agent because the team
          // hasn't been deleted yet (G04 runs later) so Gate 9b sees the
          // agent in team.agentIds and refuses. Pre-removing from agentIds
          // here keeps the pipeline atomic from the agent's perspective —
          // the team itself is deleted from teams.json a few gates later.
          // If the agent is the team's COS, clear chiefOfStaffId in the same
          // updateTeam call to satisfy R4.7 (cannot remove COS from agentIds
          // unless COS role is also cleared) and R4.6 (auto-add COS to
          // agentIds is harmless when chiefOfStaffId is null).
          try {
            const { loadTeams: loadTeamsG03, updateTeam: updateTeamG03 } = await import('@/lib/team-registry')
            const teamsG03 = loadTeamsG03()
            const teamG03 = teamsG03.find(t => t.id === teamId)
            if (teamG03 && teamG03.agentIds.includes(agentId)) {
              const newAgentIds = teamG03.agentIds.filter(x => x !== agentId)
              const updates: { agentIds: string[]; chiefOfStaffId?: string | null; orchestratorId?: string | null } = { agentIds: newAgentIds }
              if (teamG03.chiefOfStaffId === agentId) {
                updates.chiefOfStaffId = null
              }
              if (teamG03.orchestratorId === agentId) {
                updates.orchestratorId = null
              }
              await updateTeamG03(teamId, updates)
              ops.push(`G03: Removed ${agentId.substring(0, 8)} from team.agentIds (pre-revert, R3 Gate 9b prep)`)
            }
          } catch (err) {
            ops.push(`G03: WARN — pre-revert agentIds removal failed for ${agentId.substring(0, 8)}: ${err instanceof Error ? err.message : err}`)
          }
          try {
            // BUG-002 fix (SCEN-005): ChangeTitle requires authContext as a security
            // invariant. Without it the call returns "authContext is mandatory" and
            // the COS/Member never reverts to AUTONOMOUS — the team gets deleted but
            // its former agents retain their titles AND their role-plugins. Pass
            // through the DeleteTeam authContext so ChangeTitle treats this revert
            // as an already-authorized governance operation.
            const titleResult = await ChangeTitle(agentId, 'autonomous', {
              authContext: options.authContext,
            })
            if (titleResult.success) {
              ops.push(`G03: Agent ${agentId.substring(0, 8)} → AUTONOMOUS (verified in registry)`)
            } else {
              // SCEN-002 P0-001: ChangeTitle now includes strong persistence
              // verification (G14 + G22). A non-success result here means
              // the title reversion did NOT land on disk, so we MUST surface
              // the error rather than claim success.
              const reason = titleResult.error || 'unknown'
              revertFailures.push({ agentId, error: reason })
              ops.push(`G03: FAILED — ChangeTitle failed for ${agentId.substring(0, 8)}: ${reason}`)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            revertFailures.push({ agentId, error: msg })
            ops.push(`G03: FAILED — ChangeTitle exception for ${agentId.substring(0, 8)}: ${msg}`)
          }
        }

        // Clear the legacy `team` field on the agent's registry record.
        // ChangeTitle only writes `governanceTitle`; it does NOT clear `team`.
        // Without this, the agent's record keeps the old team name as a ghost
        // reference (seen in SCEN-007 ISSUE-001).
        try {
          await updateAgent(agentId, { team: '' })
          ops.push(`G03: Cleared legacy team field for ${agentId.substring(0, 8)}`)
        } catch (err) {
          ops.push(`G03: WARN — team field clear failed for ${agentId.substring(0, 8)}: ${err instanceof Error ? err.message : err}`)
        }
        // Hibernate the agent via the canonical hibernateAgent pipeline
        // (same code path used by POST /api/agents/[id]/hibernate). This
        // kills the tmux session, updates the registry session status to
        // offline, and cleans up any stale activity entry. Running with a
        // stale role-plugin after ChangeTitle stripped it would be an
        // inconsistent state; hibernation forces a clean restart on next
        // wake. We pass authContext so the internal authorization gate
        // treats this as an already-authorized team-delete call.
        try {
          const hibResult = await hibernateAgent(agentId, {
            sessionIndex: 0,
            authContext: options.authContext,
          })
          if (hibResult.data?.success) {
            ops.push(`G03: Hibernated ${agentId.substring(0, 8)}`)
          } else if (hibResult.error) {
            // Session-not-found, already-offline, etc. are not fatal —
            // log as a warning but continue the pipeline.
            ops.push(`G03: ${agentId.substring(0, 8)} hibernate note: ${hibResult.error}`)
          }
        } catch (err) {
          ops.push(`G03: WARN — hibernate exception for ${agentId.substring(0, 8)}: ${err instanceof Error ? err.message : err}`)
        }
      }
    } else {
      ops.push('G03: No agents in team — skipped')
    }

    // SCEN-002 P0-001 fix: If ANY agent title revert failed, abort BEFORE
    // deleting the team from the registry. Continuing would leave the
    // system in the exact inconsistent state the bug reports flagged:
    // team gone from teams.json, but its former agents still carry the
    // old title in agents/registry.json (ghost titles). The caller can
    // inspect `operations` for per-agent reasons and retry if desired.
    if (revertFailures.length > 0) {
      result.error = `DeleteTeam aborted: ${revertFailures.length} agent(s) failed to revert to AUTONOMOUS. ` +
        `Team NOT deleted to preserve consistency. Retry or inspect operations log. First failure: ` +
        `${revertFailures[0].agentId.substring(0, 8)}=${revertFailures[0].error}`
      ops.push(`G03: ABORTED — ${revertFailures.length} title revert failure(s); team preserved`)
      return result
    }

    // ── G04: Delete team from registry ─────────────────────────
    const deleted = await registryDeleteTeam(teamId)
    if (!deleted) {
      result.error = 'Team deletion from registry failed'
      ops.push('G04: FAILED — registry delete returned false')
      return result
    }
    ops.push('G04: Deleted from teams.json')

    // ── G05: Cancel pending transfers + reject governance requests ──
    // Single pass over governance requests: cancel transfers involving this team (R8.3)
    // AND reject any other pending requests targeting this team.
    try {
      const { loadGovernanceRequests, rejectGovernanceRequest } = await import('@/lib/governance-request-registry')
      const file = loadGovernanceRequests()
      const caller = options?.authContext?.agentId || 'system'
      let transfersCancelled = 0
      let requestsRejected = 0
      for (const req of file.requests) {
        if (req.status !== 'pending') continue
        const p = req.payload as { fromTeamId?: string; toTeamId?: string; teamId?: string; agentId?: string }
        const involvesTeam = p.teamId === teamId || p.fromTeamId === teamId || p.toTeamId === teamId
        if (!involvesTeam) continue
        if (req.type === 'transfer-agent') {
          await rejectGovernanceRequest(req.id, caller, 'Team deleted — transfer cancelled')
          transfersCancelled++
        } else {
          await rejectGovernanceRequest(req.id, caller, 'Team deleted')
          requestsRejected++
        }
      }
      ops.push(`G05: ${transfersCancelled} transfer(s) cancelled, ${requestsRejected} governance request(s) rejected`)
    } catch (err) {
      ops.push(`G05: WARN — governance cleanup failed: ${err instanceof Error ? err.message : err}`)
    }

    // ── G06: Delete team data files ────────────────────────────
    try {
      const { existsSync, unlinkSync } = await import('fs')
      const path = await import('path')
      const TEAMS_DIR = statePath('teams')
      const safeId = teamId.replace(/[^a-f0-9-]/gi, '')
      const taskFile = path.join(TEAMS_DIR, `tasks-${safeId}.json`)
      const docsFile = path.join(TEAMS_DIR, `docs-${safeId}.json`)
      let cleaned = 0
      if (existsSync(taskFile)) { unlinkSync(taskFile); cleaned++ }
      if (existsSync(docsFile)) { unlinkSync(docsFile); cleaned++ }
      ops.push(cleaned > 0 ? `G06: Deleted ${cleaned} team data file(s)` : 'G06: No team data files to clean')
    } catch (err) {
      ops.push(`G06: WARN — data file cleanup failed: ${err instanceof Error ? err.message : err}`)
    }

    // ── G07: Optional cascade — delete team agents (proposal 7) ────
    // Opt-in via the "Delete Agents Too" checkbox in the sidebar Team
    // Delete dialog. Cascade goes through the DeleteAgent pipeline per
    // agent (NEVER raw registry deletion, never bash rm), inherits the
    // caller's authContext, and sets hard=true + deleteFolder=true so
    // the workdir is wiped too. Per-agent failures do NOT roll back —
    // the team is already gone from the registry; the operator can
    // re-try individual deletions via Profile → Danger Zone if any
    // fail. Every successful DeleteAgent emits its own ledger entry
    // (see TRDD-eac02238).
    if (options?.deleteAgents && agentsToRevert.length > 0) {
      const { getAgent: getAgentForCascade } = await import('@/lib/agent-registry')
      const deleteFailures: Array<{ agentId: string; error: string }> = []
      let deletedCount = 0
      for (const agentId of agentsToRevert) {
        // SCEN-008 BUG-001 fix (2026-04-30): Skip orphan IDs in cascade delete
        // for the same reason as the G03 revert path — the agent already
        // doesn't exist, so calling DeleteAgent would just produce a
        // misleading "not found" failure. Treat it as already deleted.
        try {
          const exists = !!getAgentForCascade(agentId)
          if (!exists) {
            ops.push(`G07: Agent ${agentId.substring(0, 8)} not in registry (orphan) — skipped`)
            continue
          }
        } catch { /* if registry read throws, fall through and let DeleteAgent surface */ }
        try {
          const delResult = await DeleteAgent(agentId, {
            authContext: options.authContext,
            hard: true,
            deleteFolder: true,
          })
          if (delResult.success) {
            deletedCount++
            ops.push(`G07: DeleteAgent succeeded for ${agentId.substring(0, 8)} (hard, folder wiped)`)
          } else {
            deleteFailures.push({ agentId, error: delResult.error || 'unknown' })
            ops.push(`G07: DeleteAgent FAILED for ${agentId.substring(0, 8)}: ${delResult.error || 'unknown'}`)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          deleteFailures.push({ agentId, error: msg })
          ops.push(`G07: DeleteAgent EXCEPTION for ${agentId.substring(0, 8)}: ${msg}`)
        }
      }
      ops.push(`G07: Cascade summary — ${deletedCount}/${agentsToRevert.length} agents deleted, ${deleteFailures.length} failed`)
      if (deleteFailures.length > 0) {
        // Team is already deleted — surface a non-fatal warning in the
        // success path so the caller can display a toast but the sidebar
        // still removes the team row.
        result.error = `Team deleted, but ${deleteFailures.length} of ${agentsToRevert.length} agents failed to delete. ` +
          `First failure: ${deleteFailures[0].agentId.substring(0, 8)}=${deleteFailures[0].error}. ` +
          `Retry via Profile → Advanced → Danger Zone → Delete Agent.`
      }
    } else {
      ops.push('G07: Agents preserved as AUTONOMOUS (deleteAgents not requested)')
    }

    result.success = true
    console.log(`[DeleteTeam] "${team.name}" deleted (${ops.length} gates, ${agentsToRevert.length} agents reverted${options?.deleteAgents ? ', cascade delete requested' : ''})`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[DeleteTeam] FAILED for ${teamId}:`, result.error)
    return result
  }
}

// DeleteAgent — All-in-one agent deletion with full gate pipeline
// ══════════════════════════════════════════════════════════════

export interface DeleteAgentResult {
  success: boolean
  agentId: string
  hard: boolean
  operations: string[]
  error?: string
}

/**
 * All-in-one agent deletion. The ONLY function that can delete an agent.
 * Replaces: deleteAgentById (core), deleteAgentSelf (amp), deleteAssistantAgent (help).
 *
 * Gates:
 *   G00: Authorization — system-owner/MANAGER can delete any agent; others denied
 *   G01: Validate agent exists
 *   G01b: R39.6 — block INDEPENDENT deletion of an ASSISTANT agent
 *   G02: Auto-demote MANAGER to AUTONOMOUS (triggers R10 blocking cascade)
 *   G03: Strip COS/Orchestrator title from teams
 *   G04: Remove agent from all teams
 *   G05: Kill tmux sessions
 *   G06: Revoke AMP API keys + AID governance tokens
 *   G07: Auto-reject pending governance requests
 *   G08: Soft-delete or hard-delete from registry
 *   G09: Optionally delete agent folder (safety: only under ~/agents/)
 */
export async function DeleteAgent(
  agentId: string,
  options: {
    authContext: AuthContext
    hard?: boolean          // true = permanent delete with backup; false = soft-delete (default)
    deleteFolder?: boolean  // true = also rm -rf the agent's ~/agents/<name>/ folder
    /**
     * R39.6 — set ONLY by the user-delete cascade. An ASSISTANT agent cannot be
     * deleted independently; it is soft-deleted exclusively as a side effect of
     * deleting its owning USER. This flag is the seam that lets the Phase-B
     * user-delete cascade (gated by governance.userAuthorityModelEnabled) bypass
     * the G01b independent-delete block. Every other caller (UI/API direct
     * delete) leaves it false, so G01b refuses.
     */
    cascadeFromUser?: boolean
  },
): Promise<DeleteAgentResult> {
  const ops: string[] = []
  const hard = options?.hard ?? false
  const result: DeleteAgentResult = { success: false, agentId, hard, operations: ops }

  try {
    // ── G00: Authorization ─────────────────────────────────────
    // Delete is a privileged operation: only system-owner and MANAGER.
    // COS cannot delete agents (they request MANAGER to do it).
    // No agent can delete itself via API (use /exit to stop, MANAGER deletes).
    if (!options?.authContext) {
      result.error = 'authContext is mandatory for DeleteAgent (security invariant)'
      return result
    }
    const g0err = await gate0Auth('delete-agent', agentId, options.authContext, ops)
    if (g0err) { result.error = g0err; return result }

    // ── G01: Validate agent exists ─────────────────────────────
    const { getAgent, deleteAgent: registryDelete } = await import('@/lib/agent-registry')
    const agent = getAgent(agentId, true) // include soft-deleted to distinguish 404 vs 410
    if (!agent) {
      result.error = 'Agent not found'
      ops.push('G01: Agent not found')
      return result
    }
    if (agent.deletedAt && !hard) {
      result.error = 'Agent already deleted (soft). Use hard=true for permanent deletion.'
      ops.push('G01: Already soft-deleted')
      return result
    }
    ops.push(`G01: Agent "${agent.name}" found (id=${agentId.substring(0, 8)})`)

    // ── G01b: R39.6 — block INDEPENDENT deletion of an ASSISTANT ──
    // An ASSISTANT agent CANNOT be deleted on its own. Every user must always
    // have exactly one ASSISTANT for as long as the user exists; the ASSISTANT's
    // lifecycle is bound to its user — only deleting the USER cascades a (soft)
    // delete to the ASSISTANT (cemetery model). The only caller permitted to
    // delete an ASSISTANT is that user-delete cascade, which sets
    // options.cascadeFromUser=true (Phase B, behind the user-authority model).
    // Any other delete path (UI/API direct, MANAGER, system-owner) is refused
    // here — the most-secure interpretation of "cannot be deleted independently".
    // This runs BEFORE G02/G03 so we never auto-demote or archive an ASSISTANT
    // we are about to refuse to delete.
    if (agent.governanceTitle === 'assistant' && !options?.cascadeFromUser) {
      result.error = 'An ASSISTANT agent cannot be deleted independently (R39.6). It is deleted only when its user is deleted.'
      ops.push('G01b: DENIED — ASSISTANT independent delete blocked (R39.6)')
      return result
    }
    if (agent.governanceTitle === 'assistant') {
      ops.push('G01b: ASSISTANT delete authorized via user cascade (R39.6)')
    } else {
      ops.push('G01b: Not an ASSISTANT — OK to delete')
    }

    // ── G02: Auto-demote MANAGER before deletion ───────────────
    // If the agent is MANAGER, auto-demote to AUTONOMOUS first. This removes
    // the MANAGER designation (triggering R10 blocking cascade on all teams)
    // but avoids forcing the user through 2 manual steps.
    try {
      const { isManager: checkManager } = await import('@/lib/governance')
      if (checkManager(agentId)) {
        ops.push('G02: Agent is MANAGER — auto-demoting to AUTONOMOUS before deletion')
        const titleResult = await ChangeTitle(agentId, 'autonomous', {
          authContext: options?.authContext,
          skipRestart: true,  // No point restarting — we're about to delete
        })
        if (!titleResult.success) {
          result.error = `Cannot delete the MANAGER: auto-demotion failed — ${titleResult.error}`
          ops.push(`G02: FAILED — ChangeTitle to AUTONOMOUS failed: ${titleResult.error}`)
          return result
        }
        ops.push('G02: MANAGER auto-demoted to AUTONOMOUS — proceeding with deletion')
      } else {
        ops.push('G02: Agent is not MANAGER — OK to delete')
      }
    } catch {
      ops.push('G02: WARN — governance check failed, proceeding')
    }

    // ── G03: Archive agent to cemetery BEFORE any cleanup ─────
    // Must happen before team/session/credential cleanup so the archive
    // captures the agent's full state (team membership, COS slot, title, etc.).
    if (!hard) {
      try {
        const { exportAgentZip } = await import('@/services/agents-transfer-service')
        const zipResult = await exportAgentZip(agentId)
        if (zipResult.data) {
          const cemeteryDir = statePath('cemetery')
          const { mkdirSync, writeFileSync } = await import('fs')
          mkdirSync(cemeteryDir, { recursive: true, mode: 0o700 })
          const archFile = join(cemeteryDir, zipResult.data.filename)
          writeFileSync(archFile, zipResult.data.buffer)
          ops.push(`G03: Archived to cemetery: ${zipResult.data.filename} (${Math.round(zipResult.data.buffer.length / 1024)}KB)`)
        } else {
          ops.push(`G03: WARN — zip export failed: ${zipResult.error || 'unknown'}. Proceeding without archive.`)
        }
      } catch (err) {
        ops.push(`G03: WARN — cemetery archive failed: ${err instanceof Error ? err.message : err}. Proceeding without archive.`)
      }
    } else {
      ops.push('G03: Hard-delete — skipping cemetery archive')
    }

    // ── G04: Strip COS/Orchestrator from teams + remove from all teams ──
    // Atomic: load teams once, make all changes, save once.
    try {
      const { loadTeams, saveTeams } = await import('@/lib/team-registry')
      const teams = loadTeams()
      let dirty = false
      for (const team of teams) {
        if (team.chiefOfStaffId === agentId) {
          team.chiefOfStaffId = null
          ops.push(`G04: Cleared COS slot in team "${team.name}"`)
          dirty = true
        }
        if (team.orchestratorId === agentId) {
          team.orchestratorId = null
          ops.push(`G04: Cleared Orchestrator slot in team "${team.name}"`)
          dirty = true
        }
        const before = team.agentIds.length
        team.agentIds = team.agentIds.filter((id: string) => id !== agentId)
        if (team.agentIds.length < before) {
          ops.push(`G04: Removed from team "${team.name}"`)
          dirty = true
        }
      }
      if (dirty) saveTeams(teams)
      else ops.push('G04: Agent not in any team')
    } catch (err) {
      ops.push(`G04: WARN — team cleanup failed: ${err instanceof Error ? err.message : err}`)
    }

    // ── G05: Kill tmux sessions ────────────────────────────────
    // The agent's tmux session name is the agent name (convention)
    try {
      const { getRuntime } = await import('@/lib/agent-runtime')
      const runtime = getRuntime()
      const sessionName = agent.name
      if (sessionName) {
        try {
          await runtime.killSession(sessionName as string)
          ops.push(`G05: Killed tmux session "${sessionName}"`)
        } catch {
          ops.push(`G05: Session "${sessionName}" already dead or not found`)
        }
      } else {
        ops.push('G05: No session name — skipped')
      }
    } catch (err) {
      ops.push(`G05: WARN — session kill failed: ${err instanceof Error ? err.message : err}`)
    }

    // ── G06: Revoke credentials ────────────────────────────────
    // Revoke AMP API keys so stolen keys can't be reused
    try {
      const { revokeAllKeysForAgent } = await import('@/lib/amp-auth')
      await revokeAllKeysForAgent(agentId)
      ops.push('G06: AMP API keys revoked')
    } catch (err) {
      ops.push(`G06: WARN — AMP key revocation failed: ${err instanceof Error ? err.message : err}`)
    }
    // Revoke AID governance tokens
    try {
      const { revokeTokensForAgent } = await import('@/lib/aid-token')
      const count = await revokeTokensForAgent(agentId)
      ops.push(`G06: ${count} AID governance token(s) revoked`)
    } catch {
      ops.push('G06: AID token revocation skipped')
    }

    // ── G07: Auto-reject pending governance requests ───────────
    try {
      const { loadGovernanceRequests, rejectGovernanceRequest } = await import('@/lib/governance-request-registry')
      const file = loadGovernanceRequests()
      const pending = file.requests.filter((r: { status: string; payload: { agentId?: string } }) =>
        r.status === 'pending' && r.payload?.agentId === agentId
      )
      for (const req of pending) {
        await rejectGovernanceRequest(req.id, options?.authContext?.agentId || 'system', 'Target agent deleted')
      }
      if (pending.length > 0) {
        ops.push(`G07: Auto-rejected ${pending.length} pending governance request(s)`)
      } else {
        ops.push('G07: No pending governance requests')
      }
    } catch (err) {
      ops.push(`G07: WARN — governance request cleanup failed: ${err instanceof Error ? err.message : err}`)
    }

    // ── G07b: Cancel pending transfers involving this agent (R8.3) ──
    try {
      const { loadGovernanceRequests, rejectGovernanceRequest: rejectGov } = await import('@/lib/governance-request-registry')
      const file = loadGovernanceRequests()
      const transfersPending = file.requests.filter((r: { type: string; status: string; payload: { agentId?: string } }) =>
        r.status === 'pending' && r.type === 'transfer-agent' && r.payload?.agentId === agentId
      )
      for (const req of transfersPending) {
        await rejectGov(req.id, options?.authContext?.agentId || 'system', 'Agent deleted — transfer cancelled')
      }
      if (transfersPending.length > 0) {
        ops.push(`G07b: Cancelled ${transfersPending.length} pending transfer(s)`)
      } else {
        ops.push('G07b: No pending transfers')
      }
    } catch (err) {
      ops.push(`G07b: WARN — transfer cleanup failed: ${err instanceof Error ? err.message : err}`)
    }

    // ── G07c: Unsubscribe from all groups ─────────────────────
    try {
      const { loadGroups, saveGroups } = await import('@/lib/group-registry')
      const groups = loadGroups()
      let unsubbed = 0
      for (const group of groups) {
        if (group.subscriberIds?.includes(agentId)) {
          group.subscriberIds = group.subscriberIds.filter((id: string) => id !== agentId)
          unsubbed++
        }
      }
      if (unsubbed > 0) {
        saveGroups(groups)
        ops.push(`G07c: Unsubscribed from ${unsubbed} group(s)`)
      } else {
        ops.push('G07c: Not in any groups')
      }
    } catch (err) {
      ops.push(`G07c: WARN — group cleanup failed: ${err instanceof Error ? err.message : err}`)
    }

    // ── G08: Delete from registry ──────────────────────────────
    const deleted = await registryDelete(agentId, hard)
    if (!deleted) {
      result.error = 'Registry deletion failed'
      ops.push('G08: FAILED — registry delete returned false')
      return result
    }
    ops.push(`G08: ${hard ? 'Hard' : 'Soft'}-deleted from registry`)

    // ── G08b: Verify deletion landed on disk ───────────────────
    // SCEN-002 P0-003: registryDelete() can return true even when the
    // on-disk write silently failed (cache glitch, lock contention). Without
    // this check, UI reports success while ~/.aimaestro/agents/registry.json
    // still contains the deleted agent — which resurrects on next restart.
    // For soft-delete: verify the agent has `deletedAt` set on disk.
    // For hard-delete: verify the agent entry is GONE from disk.
    try {
      const { readFileSync } = await import('fs')
      const { join: pathJoinG08 } = await import('path')
      const REGISTRY_PATH_G08 = pathJoinG08(HOME, '.aimaestro', 'agents', 'registry.json')
      const diskAgents = JSON.parse(readFileSync(REGISTRY_PATH_G08, 'utf-8')) as Array<Record<string, unknown>>
      const diskAgent = diskAgents.find((a) => a.id === agentId)
      if (hard) {
        if (diskAgent) {
          result.error = `G08b: Hard-delete verification failed — agent ${agentId} still present in registry.json`
          ops.push(`G08b: DENIED — agent still in registry.json after hard-delete`)
          return result
        }
        ops.push(`G08b: Verified on disk — agent removed from registry.json`)
      } else {
        if (!diskAgent) {
          // Soft-delete should KEEP the entry, just mark it deleted
          result.error = `G08b: Soft-delete verification failed — agent ${agentId} removed from registry.json (expected deletedAt marker)`
          ops.push(`G08b: DENIED — agent missing from registry.json after soft-delete`)
          return result
        }
        if (!diskAgent.deletedAt) {
          result.error = `G08b: Soft-delete verification failed — agent ${agentId} on disk lacks deletedAt`
          ops.push(`G08b: DENIED — agent lacks deletedAt after soft-delete`)
          return result
        }
        ops.push(`G08b: Verified on disk — agent marked deletedAt in registry.json`)
      }
    } catch (verifyErr) {
      result.error = `G08b: Registry verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`
      ops.push(`G08b: DENIED — registry verification failed`)
      return result
    }

    // ── G09: Delete agent folder (hard-delete only) ────────────
    // Soft-delete preserves the folder (data is in the cemetery zip).
    // Hard-delete + deleteFolder flag removes the ~/agents/<name>/ folder.
    if (hard && options?.deleteFolder && agent.workingDirectory) {
      try {
        const { resolve } = await import('path')
        const { rm, stat } = await import('fs/promises')
        const resolvedDir = resolve(agent.workingDirectory)
        const agentsRoot = resolve(HOME, 'agents')
        if (resolvedDir.startsWith(agentsRoot + '/') && resolvedDir !== agentsRoot) {
          const dirStat = await stat(resolvedDir).catch(() => null)
          if (dirStat?.isDirectory()) {
            await rm(resolvedDir, { recursive: true, force: true })
            ops.push(`EXE: Deleted agent folder ${resolvedDir}`)
          } else {
            ops.push(`EXE: Folder ${resolvedDir} not found — skipped`)
          }

          // SCEN-014 P0-002: purge Claude Code conversation history for this
          // workdir. Without this, ~/.claude/projects/-Users-<u>-agents-<n>/*.jsonl
          // survives the agent deletion. Two consequences:
          //   1) Re-creating an agent with the SAME workingDirectory loads the
          //      previous agent's transcript on first launch (`claude --continue`
          //      / `--resume` look up by workdir slug).
          //   2) Privacy leak: transcripts are full-fidelity logs of prior
          //      conversations and persist on disk after the user thinks the
          //      agent is gone.
          // SAFETY: the slug we derive must match Claude Code's encoding for
          // `resolvedDir` exactly (slashes -> '-', leading slash kept). We work
          // off `resolvedDir` (not `agent.workingDirectory`) so symlinks and
          // ~ expansion are normalised before slugging — otherwise an agent
          // whose registry workdir is `/Users/foo/agents/bar` and another
          // whose workdir is `/Users/foo//agents/bar` would derive different
          // slugs even though Claude resolved them to the same project. The
          // outer `startsWith(agentsRoot)` guard already proves resolvedDir
          // is inside ~/agents/, so the slug cannot accidentally target an
          // unrelated project (e.g. ~/Code/<name>).
          // TODO (per-client): also handle ~/.codex/sessions/<...> via
          // lib/client-plugin-adapters/codex.ts. For now Claude-only is OK.
          try {
            const workdirSlug = '-' + resolvedDir.replace(/\//g, '-').replace(/^-/, '')
            const claudeProjectsDir = resolve(HOME, '.claude', 'projects', workdirSlug)
            const claudeProjectsRoot = resolve(HOME, '.claude', 'projects')
            // Defensive: derived slug must actually live under ~/.claude/projects/
            // and must not equal the projects root itself. If both checks pass and
            // the dir exists, it is safe to remove.
            if (
              claudeProjectsDir.startsWith(claudeProjectsRoot + '/') &&
              claudeProjectsDir !== claudeProjectsRoot
            ) {
              const histStat = await stat(claudeProjectsDir).catch(() => null)
              if (histStat?.isDirectory()) {
                await rm(claudeProjectsDir, { recursive: true, force: true })
                ops.push(`EXE: Purged Claude conversation history ${claudeProjectsDir}`)
              } else {
                ops.push(`EXE: No Claude conversation history at ${claudeProjectsDir}`)
              }
            } else {
              ops.push(`EXE: REFUSED — derived Claude history slug outside ~/.claude/projects/: ${claudeProjectsDir}`)
            }
          } catch (histErr) {
            ops.push(`EXE: WARN — Claude history purge failed: ${histErr instanceof Error ? histErr.message : histErr}`)
          }
        } else {
          ops.push(`EXE: REFUSED — folder outside ~/agents/: ${resolvedDir}`)
        }
      } catch (err) {
        ops.push(`EXE: WARN — folder deletion failed: ${err instanceof Error ? err.message : err}`)
      }
    } else if (hard) {
      ops.push('G09: Hard-delete but no folder deletion requested')
    } else {
      ops.push('G09: Soft-delete — folder preserved')
    }

    // TRDD-eac02238 step 6 (fan-out, 2026-04-20): emit per-op ledger
    // entry for DeleteAgent. Diff encodes hard vs soft (remove vs
    // replace with deletedAt). Single op name 'delete_agent' per the
    // canonical LedgerOp enum; the action field + diff shape lets
    // state-restore distinguish the two cases.
    try {
      const { emitAgentOp } = await import('@/lib/ledger-emit')
      emitAgentOp(
        'delete_agent',
        [
          {
            op: hard ? 'remove' : 'replace',
            path: `/agents/${agentId}`,
            value: hard ? null : { ...agent, deletedAt: new Date().toISOString() },
          },
        ],
        {
          action: hard ? 'delete-agent-hard' : 'delete-agent-soft',
          agentId: options.authContext?.agentId ?? null,
          actor: options.authContext?.agentId ? 'agent' : 'user',
        },
      )
    } catch (ledgerErr) {
      ops.push(`LEDGER: WARN — per-op append failed: ${ledgerErr instanceof Error ? ledgerErr.message : ledgerErr}`)
    }

    // R34.1 — revoke the agent's AID association in the signed ledger. A deleted
    // agent's fingerprint must STOP backing any token: reconstruct + the R34.1
    // gate honor a later aid_revoke over the earlier aid_associate, so a stolen
    // token for a deleted agent is refused once enforcement is on. Best-effort:
    // never blocks the delete.
    try {
      const fp = (agent.metadata?.amp as Record<string, unknown> | undefined)?.fingerprint as string | undefined
      if (fp) {
        const { recordAidRevocation } = await import('@/lib/aid-ledger-authority')
        recordAidRevocation(
          agentId,
          fp,
          hard ? 'agent-hard-deleted' : 'agent-soft-deleted',
          options.authContext?.agentId ? 'agent' : 'user',
        )
      }
    } catch (revokeErr) {
      ops.push(`LEDGER: WARN — aid_revoke emit failed: ${revokeErr instanceof Error ? revokeErr.message : revokeErr}`)
    }

    result.success = true
    console.log(`[DeleteAgent] "${agent.name}" deleted (hard=${hard}, ${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[DeleteAgent] FAILED for ${agentId}:`, result.error)
    return result
  }
}

// CreateAgent — All-in-one agent creation with full gate pipeline
// ══════════════════════════════════════════════════════════════

export interface CreateAgentResult {
  success: boolean
  agentId: string | null
  operations: string[]
  restartNeeded: boolean
  error?: string
}

/**
 * All-in-one agent creation. Validates, infers, creates, and configures
 * the agent in a single pipeline. Replaces the old createNewAgent() thin wrapper.
 *
 * Gates:
 *   G01: Validate name format
 *   G02: Infer and set client/program (from client field, program field, or default)
 *   G03: Validate working directory (create ~/agents/<name>/ if needed)
 *   G04: Create agent in registry
 *   G05: Create .claude directory for Claude agents
 *   G06: Set governance title if requested (delegates to ChangeTitle)
 *   G07: Add to team if requested (delegates to ChangeTeam)
 *   G08: Install role-plugin if specified
 *   G09: Create tmux session if requested
 *   G10: Auto-provision Ed25519 keypair for AMP messaging
 *   G11: Install ai-maestro-plugin at local scope (R17 — core plugin for ecosystem participation)
 */
export async function CreateAgent(
  desired: {
    name: string
    label?: string
    client?: string           // 'claude' | 'codex' | 'gemini' | 'aider' | 'opencode'
    program?: string           // Explicit program path (overrides client inference)
    workingDirectory?: string
    allowExternalFolder?: boolean  // true ONLY when user explicitly chose "Browse existing folder" in wizard
    governanceTitle?: string   // If set, ChangeTitle is called after creation
    teamId?: string            // If set, ChangeTeam is called after creation
    avatar?: string
    programArgs?: string
    pluginName?: string          // Role-plugin to install (auto-converts for non-Claude clients)
    createSession?: boolean       // If true, creates tmux session after registration
    owner?: string
    tags?: string[]
    model?: string
    taskDescription?: string
    /** R19.2: MAINTAINER requires githubRepo in "owner/repo" format (forwarded to ChangeTitle Gate 9a) */
    githubRepo?: string
    /**
     * Mandatory auth context (SEC-PHASE-1). Forwarded to ChangeTitle / ChangeTeam.
     * HTTP callers build this via buildAuthContext(authenticateFromRequest(request)).
     * Internal callers build this via buildSystemAuthContext('create-agent-<reason>').
     */
    authContext: AuthContext
  },
): Promise<CreateAgentResult> {
  const ops: string[] = []
  const result: CreateAgentResult = { success: false, agentId: null, operations: ops, restartNeeded: false }

  try {
    // ── G00f: R40 foreign-user gate ──────────────────────────
    // A foreign (non-native) user needs an explicit MAESTRO grant for
    // create_agent (R40.1/R40.2). Inert for native users, the MAESTRO/system-
    // owner, and agents — and inert entirely when the user-authority model is
    // off (no userId is resolved then). Runs first so an ungranted foreign user
    // is refused before any work.
    {
      const foreignErr = await assertForeignUserMayCall(desired.authContext, 'create_agent')
      if (foreignErr) {
        result.error = foreignErr
        ops.push(`G00f: DENIED — ${foreignErr}`)
        return result
      }
      ops.push('G00f: R40 foreign-user check passed')
    }

    // ── G01: Validate name format ────────────────────────────
    const name = desired.name?.toLowerCase().trim()
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      result.error = `Invalid agent name "${desired.name}". Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
      return result
    }
    ops.push(`G01: Name "${name}" is valid`)

    // ── G01b: Check name uniqueness in registry ──────────────
    // BUG-FIX (SCEN-016): must filter tombstones (soft-deleted entries with
    // deletedAt set). Use getAgentByName() which already does that — don't
    // call loadAgents().find() directly, that sees tombstones and blocks
    // the wizard from reusing a name of a previously-deleted agent.
    {
      const { getAgentByName } = await import('@/lib/agent-registry')
      const existingByName = getAgentByName(name)
      if (existingByName) {
        result.error = `Agent with name "${name}" already exists (id=${existingByName.id}). Choose a different name.`
        return result
      }
      ops.push(`G01b: Name "${name}" is unique in registry`)
    }

    // ── G01c: Enforce agent creation limits (from security config) ────
    {
      const { loadSecurityConfig } = await import('@/lib/security-config')
      const { loadAgents } = await import('@/lib/agent-registry')
      const cfg = loadSecurityConfig().agentCreation

      // Max agents per host
      const allAgents = loadAgents().filter(a => !a.deletedAt)
      if (allAgents.length >= cfg.maxAgentsPerHost) {
        result.error = `Agent creation denied: host has ${allAgents.length} agents (max ${cfg.maxAgentsPerHost}). Delete unused agents or increase the limit in Security Settings.`
        return result
      }

      // Min interval between creations (anti-spam)
      const now = Date.now()
      const mostRecent = allAgents.reduce((latest, a) => {
        const ts = a.createdAt ? new Date(a.createdAt).getTime() : 0
        return ts > latest ? ts : latest
      }, 0)
      if (mostRecent > 0 && (now - mostRecent) < cfg.minIntervalSeconds * 1000) {
        const waitSec = Math.ceil((cfg.minIntervalSeconds * 1000 - (now - mostRecent)) / 1000)
        result.error = `Agent creation rate limit: wait ${waitSec}s between creations (configurable in Security Settings).`
        return result
      }
      ops.push(`G01c: Agent creation limits OK (${allAgents.length}/${cfg.maxAgentsPerHost}, interval OK)`)
    }

    // ── G01d: IBCT scope enforcement ──────────────────────────
    {
      const { checkIbctScope } = await import('@/lib/ibct-scope-check')
      const scopeErr = checkIbctScope(desired.authContext, 'CreateAgent')
      if (scopeErr) {
        result.error = scopeErr
        return result
      }
      ops.push('G01d: IBCT scope check passed')
    }

    // ── G01e: portfolio / mandate token check (R28 check #3) ──────────
    // The THIRD authorization check, after AID identity + TITLE. Runs EARLY
    // (before the title is delegated to ChangeTitle at G06) so a delegated
    // caller (COS and below) without a valid `agent:create` mandate is
    // refused before any directory or registry side effect. While
    // OPERATIONS_REQUIRING_TOKEN is empty (D2), this is a pure no-op. If a
    // ONE-SHOT approval matched, its id is threaded to the consume-after-
    // success tail below — the token is burned ONLY after the agent persists.
    let matchedPortfolioTokenId: string | null = null
    {
      const { matchPortfolioToken } = await import('@/lib/portfolio-check')
      const tokMatch = await matchPortfolioToken(desired.authContext, 'CreateAgent', {
        teamId: desired.teamId,
      })
      if (!tokMatch.ok) {
        result.error = tokMatch.reason
        return result
      }
      matchedPortfolioTokenId = tokMatch.token?.token_id ?? null
      ops.push('G01e: portfolio token check passed')
    }

    // ── G02: Infer client/program (smart, with deprecated client handling) ──
    // Supported clients ranked by capability (tiebreaker when counts are equal)
    // Order: plugin support, tool use, context window, ecosystem maturity
    // Power rank: plugin support, tool use, context window, ecosystem maturity
    const CLIENT_POWER_RANK: string[] = ['claude', 'codex', 'gemini', 'kiro', 'opencode']
    // Maps client type → CLI binary name (what gets stored as agent.program and launched in tmux)
    const SUPPORTED_CLIENTS: Record<string, string> = {
      claude: 'claude',
      codex: 'codex',
      gemini: 'gemini',
      kiro: 'kiro-cli',     // binary is 'kiro-cli' on all platforms (macOS, Linux, Windows)
      opencode: 'opencode',
    }
    const DEPRECATED_CLIENTS = new Set(['aider'])

    // Check if a CLI binary is installed on the system
    const { execFileSync } = await import('child_process')
    const isInstalled = (bin: string): boolean => {
      try {
        execFileSync('which', [bin], { timeout: 3000, stdio: 'pipe' })
        return true
      } catch {
        return false
      }
    }

    // Find the best installed client by power rank
    const bestInstalledClient = (): string => {
      for (const client of CLIENT_POWER_RANK) {
        if (isInstalled(SUPPORTED_CLIENTS[client])) return client
      }
      return 'claude' // absolute fallback even if not installed — let it fail at session start
    }

    let program = desired.program || ''
    const requestedClient = (desired.client || '').toLowerCase()

    if (!program && requestedClient) {
      if (DEPRECATED_CLIENTS.has(requestedClient)) {
        // Deprecated client: fallback to most-used installed client on this host
        const { loadAgents } = await import('@/lib/agent-registry')
        const { detectClientType } = await import('@/lib/client-capabilities')
        const agents = loadAgents()
        const clientCounts: Record<string, number> = {}
        for (const a of agents) {
          const ct = detectClientType(a.program || '')
          if (ct !== 'unknown' && !DEPRECATED_CLIENTS.has(ct) && isInstalled(SUPPORTED_CLIENTS[ct] || ct)) {
            clientCounts[ct] = (clientCounts[ct] || 0) + 1
          }
        }
        // Pick most popular installed client; tiebreak by power rank
        const sorted = Object.entries(clientCounts).sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1]
          return CLIENT_POWER_RANK.indexOf(a[0]) - CLIENT_POWER_RANK.indexOf(b[0])
        })
        const fallback = sorted.length > 0 ? sorted[0][0] : bestInstalledClient()
        program = SUPPORTED_CLIENTS[fallback] || fallback
        ops.push(`G02: Client "${requestedClient}" is deprecated — fallback to '${program}' (most used installed: ${sorted.map(([k, v]) => `${k}=${v}`).join(', ') || 'none'})`)
      } else if (SUPPORTED_CLIENTS[requestedClient]) {
        program = SUPPORTED_CLIENTS[requestedClient]
        // Verify the requested client is actually installed
        if (!isInstalled(program)) {
          program = bestInstalledClient()
          ops.push(`G02: Client "${requestedClient}" not installed — fallback to '${program}'`)
        } else {
          ops.push(`G02: Program set to '${program}' (from client field, verified installed)`)
        }
      } else {
        program = requestedClient
        ops.push(`G02: Unknown client "${requestedClient}" — using as direct program name`)
      }
    } else if (program) {
      const { detectClientType } = await import('@/lib/client-capabilities')
      const ct = detectClientType(program)
      if (DEPRECATED_CLIENTS.has(ct)) {
        const oldProgram = program
        program = bestInstalledClient()
        ops.push(`G02: Program "${oldProgram}" maps to deprecated client "${ct}" — fallback to '${program}'`)
      } else if (!isInstalled(program)) {
        const oldProgram = program
        program = bestInstalledClient()
        ops.push(`G02: Program "${oldProgram}" not installed — fallback to '${program}'`)
      } else {
        ops.push(`G02: Program set to '${program}' (explicit, verified installed)`)
      }
    } else {
      program = bestInstalledClient()
      ops.push(`G02: No client/program specified — defaulting to '${program}' (best installed)`)
    }

    // ── G03: Resolve working directory ───────────────────────
    // RULE: Non-AUTONOMOUS agents ALWAYS get ~/agents/<name>/ (no override allowed).
    // AUTONOMOUS agents may specify an existing project folder; otherwise ~/agents/<name>/.
    const { mkdir, stat } = await import('fs/promises')
    // Team titles (member, cos, orchestrator, etc.) are forced to ~/agents/<name>/
    // Non-team titles (autonomous, manager) can choose their own folder
    const NON_TEAM_TITLES = new Set(['autonomous', 'manager', 'maintainer', ''])
    const isTeamTitle = desired.governanceTitle && !NON_TEAM_TITLES.has(desired.governanceTitle)
    let workDir: string

    if (isTeamTitle) {
      // Non-AUTONOMOUS: always ~/agents/<name>/, ignore any override
      workDir = join(HOME, 'agents', name)
      if (desired.workingDirectory && desired.workingDirectory !== workDir) {
        ops.push(`G03: OVERRIDE — non-AUTONOMOUS agent forced to ~/agents/${name}/ (requested: ${desired.workingDirectory})`)
      }
    } else if (desired.workingDirectory) {
      // AUTONOMOUS with explicit folder (user chose an existing project)
      workDir = desired.workingDirectory.startsWith('~')
        ? desired.workingDirectory.replace(/^~/, HOME)
        : desired.workingDirectory
    } else {
      // AUTONOMOUS with no folder specified: auto-create ~/agents/<name>/
      workDir = join(HOME, 'agents', name)
    }

    // Name collision check: if workDir is ~/agents/<name>/ and it already exists
    // AND belongs to a different agent, reject
    const autoDir = join(HOME, 'agents', name)
    if (workDir === autoDir) {
      try {
        const dirStat = await stat(autoDir)
        if (dirStat.isDirectory()) {
          // Check if an agent with this name already exists in registry
          // BUG-FIX (SCEN-016): filter tombstones. A soft-deleted agent's folder
          // must be reusable by a new agent with the same name. Without the
          // filter, any scenario that deletes an agent then recreates one with
          // the same name is permanently blocked by the dead registry entry.
          const { loadAgents } = await import('@/lib/agent-registry')
          const existing = loadAgents().find(a => !a.deletedAt && a.name === name)
          if (existing) {
            result.error = `Agent folder ~/agents/${name}/ already exists and belongs to agent "${existing.label || existing.name}" (${existing.id}). Choose a different name.`
            return result
          }
          // Folder exists but no agent claims it — reuse (orphaned folder)
          ops.push(`G03: Reusing orphaned folder ~/agents/${name}/`)
        }
      } catch {
        // Folder doesn't exist — will be created below
      }
    }

    // G03-ENFORCE: Unless the user explicitly chose "Browse existing folder" in the wizard,
    // the working directory MUST be under ~/agents/. No exceptions. No fallbacks to cwd, /tmp,
    // $HOME, or any other location. This is the primary defense against agents being created
    // in the wrong place.
    const agentsRoot = join(HOME, 'agents')
    if (!desired.allowExternalFolder) {
      const normalizedForCheck = workDir.startsWith('~') ? workDir.replace(/^~/, HOME) : workDir
      if (!normalizedForCheck.startsWith(agentsRoot + '/') && normalizedForCheck !== agentsRoot) {
        // Force it back to ~/agents/<name>/
        console.warn(`[CreateAgent] G03-ENFORCE: Rejected workDir "${workDir}" (not under ~/agents/). Forcing to ~/agents/${name}/`)
        workDir = join(agentsRoot, name)
      }
    }

    // G03-SAFETY: Resolve path and reject forbidden directories + their children.
    // Uses path.resolve to neutralize traversal tricks (../../etc).
    const { resolve, sep } = await import('path')
    workDir = resolve(workDir)  // canonical absolute path, no .. or symlink tricks

    // Two categories of forbidden directories:
    // 1. BLOCKED_TREE: reject exact match AND any child/parent (e.g. process.cwd() and all children)
    // Note: '/' excluded — it would match every absolute path after normalization.
    // Instead, the $HOME check below and the ~/agents/ default prevent root usage.
    const BLOCKED_TREE = [
      process.cwd(),                          // AI Maestro source folder + children
      '/tmp',                                  // temp
    ].map(d => resolve(d))

    // 2. BLOCKED_EXACT: reject exact match only (children are OK — e.g. ~/agents/ is fine)
    const BLOCKED_EXACT = [
      '/',                                     // filesystem root
      HOME,                                    // $HOME itself (but ~/agents/ is fine)
      join(HOME, 'Desktop'),
      join(HOME, 'Documents'),
      join(HOME, 'Downloads'),
    ].map(d => resolve(d))

    const normalizedWorkDir = workDir.replace(/[/\\]+$/, '')

    // Check BLOCKED_TREE: exact + child + parent
    for (const forbidden of BLOCKED_TREE) {
      const normalizedForbidden = forbidden.replace(/[/\\]+$/, '')
      if (
        normalizedWorkDir === normalizedForbidden ||
        normalizedWorkDir.startsWith(normalizedForbidden + sep) ||
        normalizedForbidden.startsWith(normalizedWorkDir + sep)
      ) {
        result.error = `Working directory "${workDir}" is forbidden (overlaps with "${normalizedForbidden}"). Agents must use ~/agents/<name>/ or a dedicated project folder outside system/source directories.`
        return result
      }
    }

    // Check BLOCKED_EXACT: exact match only
    for (const forbidden of BLOCKED_EXACT) {
      const normalizedForbidden = forbidden.replace(/[/\\]+$/, '')
      if (normalizedWorkDir === normalizedForbidden) {
        result.error = `Working directory "${workDir}" is forbidden (exact match with "${normalizedForbidden}"). Use a subfolder like ~/agents/<name>/ instead.`
        return result
      }
    }

    // G03-OVERLAP: No two agents may share the same directory, or be parent/child of each other.
    // E.g. if agent A uses ~/agents/foo/, agent B cannot use ~/agents/foo/ OR ~/agents/foo/bar/
    // OR ~/agents/ (parent). This prevents agents from interfering with each other's files.
    // BUG-FIX (SCEN-016): filter tombstones (soft-deleted entries with deletedAt set).
    // Without this filter, a previously-deleted agent's working directory would
    // block new agents from reusing the same folder — even though the deleted agent's
    // registry entry should be invisible to new operations.
    {
      const { loadAgents: loadAllAgents } = await import('@/lib/agent-registry')
      const allAgents = loadAllAgents().filter(a => !a.deletedAt)
      const candidatePath = normalizedWorkDir + sep
      for (const existingAgent of allAgents) {
        const rawExisting = (existingAgent.workingDirectory || '').trim()
        if (!rawExisting || rawExisting === '.') continue
        const existingDir = resolve(rawExisting).replace(/[/\\]+$/, '') || '/'
        // Skip agents with forbidden workDirs — they are invalid claims that shouldn't block others
        if (BLOCKED_EXACT.includes(existingDir) || BLOCKED_TREE.some(b => existingDir === b || existingDir.startsWith(b + sep))) continue
        const existingPath = existingDir + sep
        // Check: exact match, candidate is child of existing, or candidate is parent of existing
        if (
          normalizedWorkDir === existingDir ||
          candidatePath.startsWith(existingPath) ||
          existingPath.startsWith(candidatePath)
        ) {
          result.error = `Working directory "${workDir}" overlaps with agent "${existingAgent.label || existingAgent.name}" (${existingAgent.id}) which uses "${existingDir}". Each agent must have its own isolated directory — no sharing, no parent/child nesting.`
          return result
        }
      }
      ops.push(`G03-OVERLAP: No directory overlap with ${allAgents.length} existing agents`)
    }

    await mkdir(workDir, { recursive: true })
    ops.push(`G03: Working directory: ${workDir}`)

    // ── G04: Create agent in registry ────────────────────────
    const { createAgent } = await import('@/lib/agent-registry')
    const agent = await createAgent({
      name,
      label: desired.label || undefined,
      program,
      workingDirectory: workDir,
      avatar: desired.avatar || undefined,
      programArgs: desired.programArgs || (program.includes('claude') ? '--dangerously-skip-permissions' : ''),
      owner: desired.owner || undefined,
      tags: desired.tags || undefined,
      model: desired.model || undefined,
      taskDescription: desired.taskDescription || '',
      role: 'autonomous',
    })
    result.agentId = agent.id
    ops.push(`G04: Agent created: id=${agent.id}, name=${agent.name}`)

    // ── G05: Create .claude directory for Claude agents ──────
    if (program.includes('claude')) {
      const claudeDir = join(workDir, '.claude')
      await mkdir(claudeDir, { recursive: true })
      ops.push(`G05: .claude/ directory ensured in working dir`)
    } else {
      ops.push(`G05: Non-Claude agent — skip .claude/ creation`)
    }

    // ── G06: Set governance title if requested ───────────────
    // BUG-002 FIX: On failure, ROLL BACK the agent and ABORT. Silently creating
    // an AUTONOMOUS agent when MAINTAINER was requested violates the user's
    // intent and was the root cause of SCEN-018 S005 failing with no error.
    //
    // SCEN-003 FIX: When a teamId is provided AND the title is a team-required
    // title (member, chief-of-staff, orchestrator, architect, integrator),
    // SKIP the title assignment here — ChangeTitle's Gate 9 would reject it
    // because the agent isn't in the team yet. The team join happens in G07,
    // then G07b applies the requested title after the agent is in the team.
    // Only standalone titles (manager, autonomous, maintainer) and
    // no-teamId-provided cases proceed at G06.
    const TEAM_REQUIRED_TITLES_G06 = new Set(['member', 'chief-of-staff', 'orchestrator', 'architect', 'integrator'])
    const titleNeedsTeamFirst = desired.governanceTitle &&
      desired.teamId &&
      TEAM_REQUIRED_TITLES_G06.has(desired.governanceTitle)

    // R9.13: AUTONOMOUS is now a real title that resolves to
    // ai-maestro-autonomous-agent. It MUST flow through ChangeTitle like any
    // other title so Gates 15/16 install its mandatory role-plugin. The
    // earlier `!== 'autonomous'` exclusion was the root cause of agents
    // being left with no persona and full gh-user privileges.
    if (desired.governanceTitle && !titleNeedsTeamFirst) {
      const titleResult = await ChangeTitle(agent.id, desired.governanceTitle, {
        authContext: desired.authContext,
        githubRepo: desired.githubRepo,
      })
      if (!titleResult.success) {
        // Roll back: delete the half-created agent so the caller can retry cleanly
        try {
          const { deleteAgent } = await import('@/lib/agent-registry')
          await deleteAgent(agent.id)
          ops.push(`G06: FAIL — ChangeTitle failed: ${titleResult.error}. Rolled back agent.`)
        } catch (rollbackErr) {
          ops.push(`G06: FAIL — ChangeTitle failed: ${titleResult.error}. ROLLBACK ALSO FAILED: ${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`)
        }
        result.error = `Title assignment failed: ${titleResult.error}`
        result.agentId = null
        return result
      }
      ops.push(`G06: Title set to ${desired.governanceTitle.toUpperCase()} (${titleResult.operations.length} sub-gates)`)
      result.restartNeeded = result.restartNeeded || titleResult.restartNeeded
    } else if (titleNeedsTeamFirst) {
      ops.push(`G06: DEFER — Title ${desired.governanceTitle?.toUpperCase()} requires team membership; will be applied at G07b after team join`)
    } else {
      // R9.13 fallback: every persisted agent MUST have a role-plugin. When
      // the caller omits governanceTitle entirely, default to AUTONOMOUS so
      // ChangeTitle installs ai-maestro-autonomous-agent — the minimum
      // privilege tier with an explicit governance persona.
      ops.push(`G06: No title requested — defaulting to AUTONOMOUS (R9.13 mandatory-plugin)`)
      const titleResult = await ChangeTitle(agent.id, 'autonomous', {
        authContext: desired.authContext,
      })
      if (!titleResult.success) {
        try {
          const { deleteAgent } = await import('@/lib/agent-registry')
          await deleteAgent(agent.id)
          ops.push(`G06: FAIL — default AUTONOMOUS assignment failed: ${titleResult.error}. Rolled back agent.`)
        } catch (rollbackErr) {
          ops.push(`G06: FAIL — default AUTONOMOUS assignment failed: ${titleResult.error}. ROLLBACK ALSO FAILED: ${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`)
        }
        result.error = `Default AUTONOMOUS assignment failed: ${titleResult.error}`
        result.agentId = null
        return result
      }
      result.restartNeeded = result.restartNeeded || titleResult.restartNeeded
    }

    // ── G07: Add to team if requested ────────────────────────
    if (desired.teamId) {
      // CRITICAL (SCEN-007/010/020 P0): Pass authContext so the internal
      // ChangeTitle call inside ChangeTeam can satisfy Gate 0 (authContext
      // is mandatory). Without this, ChangeTeam would auto-assign 'member'
      // silently failing — leaving governanceTitle=null in the registry.
      const teamResult = await ChangeTeam(agent.id, { teamId: desired.teamId }, desired.authContext)
      if (!teamResult.success) {
        ops.push(`G07: WARN — ChangeTeam failed: ${teamResult.error}`)
      } else {
        ops.push(`G07: Added to team (${teamResult.operations.length} sub-gates)`)
        result.restartNeeded = result.restartNeeded || teamResult.restartNeeded
      }

      // G07b: ChangeTeam tries to auto-assign "member" title, but that internal
      // ChangeTitle call lacks authContext and FAILS silently at Gate 0.
      // ALWAYS re-apply the requested title after team join (including 'member')
      // to guarantee governanceTitle is persisted to the registry.
      // This fixes SCEN-020 BUG-001 (registry missing governanceTitle after wizard
      // creation) and BUG-022 (non-member titles being ignored).
      if (desired.governanceTitle && desired.governanceTitle !== 'autonomous') {
        const retitleResult = await ChangeTitle(agent.id, desired.governanceTitle, {
          authContext: desired.authContext,
          githubRepo: desired.githubRepo,
        })
        if (!retitleResult.success) {
          // Roll back: delete the half-created agent (same reasoning as G06)
          try {
            const { deleteAgent } = await import('@/lib/agent-registry')
            await deleteAgent(agent.id)
            ops.push(`G07b: FAIL — Re-apply title ${desired.governanceTitle} after team join failed: ${retitleResult.error}. Rolled back agent.`)
          } catch (rollbackErr) {
            ops.push(`G07b: FAIL — Re-apply title ${desired.governanceTitle} after team join failed: ${retitleResult.error}. ROLLBACK ALSO FAILED: ${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`)
          }
          result.error = `Title assignment after team join failed: ${retitleResult.error}`
          result.agentId = null
          return result
        }
        ops.push(`G07b: Title confirmed as ${desired.governanceTitle.toUpperCase()} after team join`)
        result.restartNeeded = result.restartNeeded || retitleResult.restartNeeded
      }
    } else {
      ops.push(`G07: No team requested`)
    }

    // ── G08: Install role-plugin if specified ─────────────────
    // This handles the case where a specific plugin was chosen in the wizard
    // (independent of title — title auto-installs via ChangeTitle G17).
    //
    // SCEN-007 P0-001 fix: non-Claude clients must go through the R18
    // conversion pipeline (convertAndStorePlugin + emitForClient) BEFORE
    // install, not the legacy convertElements. R18.3d priority:
    //   1. If target client already has a native plugin in its cache → reuse
    //   2. Else if a compatible version exists in local role-plugins
    //      marketplace → reuse
    //   3. Else if previously emitted in custom-plugins/<client>/ → reuse
    //   4. Else emit from existing Universal IR
    //   5. Else fresh conversion via convertAndStorePlugin
    // The subsequent install goes through the per-client adapter (same as G11).
    if (desired.pluginName) {
      try {
        const { detectClientType } = await import('@/lib/client-capabilities')
        const clientType = detectClientType(program)

        if (clientType === 'claude') {
          // Direct install for Claude clients — createPersona is idempotent
          // and wraps the Claude CLI install.
          const { createPersona } = await import('@/services/role-plugin-service')
          await createPersona({
            personaName: desired.label || name,
            pluginName: desired.pluginName,
          })
          ops.push(`G08: Role-plugin "${desired.pluginName}" installed (Claude)`)
        } else if (clientType === 'codex' || clientType === 'gemini' || clientType === 'opencode' || clientType === 'kiro') {
          // R18 cross-client conversion + adapter install.
          try {
            const { convertAndStorePlugin, emitForClient, findNativePluginForClient } = await import('@/services/plugin-storage-service')

            // Step 1 (R18.3d.1): native in target client's cache — prefer if present.
            let emittedDir: string | null = await findNativePluginForClient(desired.pluginName, clientType)

            if (!emittedDir) {
              // Step 2-4 (R18.3d.3+): emit from existing Universal IR if present.
              try {
                emittedDir = await emitForClient(desired.pluginName, clientType)
              } catch {
                emittedDir = null
              }
            }

            if (!emittedDir) {
              // Step 5 (R18.3d.5): fresh conversion from Claude source.
              const claudeSource = await findNativePluginForClient(desired.pluginName, 'claude')
              if (!claudeSource) {
                throw new Error(`Source plugin "${desired.pluginName}" not found in Claude cache — cannot convert`)
              }
              await convertAndStorePlugin(desired.pluginName, 'claude', [clientType])
              ops.push(`G08: Role-plugin "${desired.pluginName}" converted Claude → ${clientType} (R18)`)
            } else {
              ops.push(`G08: Role-plugin "${desired.pluginName}" reused native/emitted ${clientType} version`)
            }

            // Step 2: install via the per-client adapter into the agent's
            // working directory. Uses the same path G11 uses.
            if (workDir) {
              const installResult = await InstallElement({
                name: desired.pluginName,
                marketplace: 'ai-maestro-local-roles-marketplace',
                action: 'install',
                scope: 'local',
                agentDir: workDir,
                agentId: agent.id,
                clientType: clientType as 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' | 'unknown',
              }, desired.authContext)
              if (installResult.success) {
                ops.push(`G08: Role-plugin installed via ${clientType}-adapter`)
              } else {
                ops.push(`G08: WARN — adapter install failed: ${installResult.error || 'unknown'}`)
              }
            } else {
              ops.push(`G08: WARN — no workDir, skipping adapter install`)
            }
          } catch (convErr) {
            ops.push(`G08: WARN — Cross-client conversion/install failed: ${convErr instanceof Error ? convErr.message : convErr}`)
          }
        } else {
          ops.push(`G08: WARN — Unknown client type "${clientType}" — plugin install skipped`)
        }
      } catch (err) {
        ops.push(`G08: WARN — Plugin install failed: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      ops.push(`G08: No explicit plugin requested`)
    }

    // ── G09: Create tmux session if requested ────────────────
    if (desired.createSession) {
      try {
        const { createSession } = await import('@/services/sessions-service')
        const sessResult = await createSession({
          name,
          workingDirectory: workDir,
          agentId: agent.id,
          label: desired.label || undefined,
          avatar: desired.avatar || undefined,
          program,
          programArgs: desired.programArgs || (program.includes('claude') ? '--dangerously-skip-permissions' : ''),
        })
        if (sessResult.error) {
          ops.push(`EXE: WARN — Session creation failed: ${sessResult.error}`)
        } else {
          ops.push(`EXE: tmux session created`)
        }
      } catch (err) {
        ops.push(`EXE: WARN — Session creation failed: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      ops.push(`EXE: No session requested (agent created hibernated)`)
    }

    // ── G10: Auto-provision Ed25519 keypair for AMP messaging ──
    // Keypair used for AMP message signing and remote AID proof-of-possession.
    // Local API auth uses server-issued session secrets (AID_AUTH env var,
    // set by sessions-service at tmux launch — not here).
    try {
      const { generateKeyPair: genKP, saveKeyPair: saveKP, hasKeyPair: hasKP } = await import('@/lib/amp-keys')
      if (!hasKP(agent.id)) {
        const keyPair = await genKP()
        saveKP(agent.id, keyPair)
        ops.push(`G10: Ed25519 keypair generated for AMP messaging (fingerprint=${keyPair.fingerprint.substring(0, 20)}...)`)
      } else {
        ops.push(`G10: Agent already has keypair — skipped`)
      }
    } catch (keyErr) {
      ops.push(`G10: WARN — Keypair generation failed: ${keyErr instanceof Error ? keyErr.message : keyErr}`)
    }

    // ── G11: Install ai-maestro-plugin at local scope (R17) ──
    // Delegates to the unified InstallElement AIO function.
    //
    // CLIENT CAPABILITY GATE (SCEN-008): For clients that have NO plugin
    // support at all (e.g. gemini, opencode, aider), skip the core plugin
    // install. Writing .claude/settings.local.json for these clients would
    // create an orphan config file their CLI can't read. The agent still
    // participates in the mesh through other channels.
    if (workDir) {
      const { detectClientType, getClientCapabilities } = await import('@/lib/client-capabilities')
      const clientType = detectClientType(program)
      const caps = getClientCapabilities(program)
      if (!caps.plugins) {
        ops.push(`G11: Client "${clientType}" has no plugin support — skipping ai-maestro-plugin install`)
      } else {
        const installResult = await InstallElement({
          name: 'ai-maestro-plugin',
          marketplace: 'ai-maestro-plugins',
          action: 'install',
          scope: 'local',
          agentDir: workDir,
          agentId: agent.id,
          clientType: clientType as 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' | 'unknown',
        }, desired.authContext)
        if (installResult.success) {
          ops.push(`G11: ${installResult.operations.filter(o => o.startsWith('G05') || o.startsWith('G06')).join('; ') || 'ai-maestro-plugin installed'}`)
        } else {
          ops.push(`G11: WARN — ${installResult.error || 'core plugin install failed'}`)
        }
      }
    } else {
      ops.push(`G11: No workDir — skipping local plugin install`)
    }

    // ── G12: Auto-initialize AMP identity (P002 / R-AMP) ─────
    // Runs amp-init.sh --force --name <name> to set up the per-agent AMP home
    // (~/.agent-messaging/agents/<name>/) with keys and config. This is what
    // enables inter-agent messaging immediately after creation — without it,
    // the agent cannot send or receive AMP messages until a manual init step.
    // Non-fatal: if it fails, the agent is flagged with ampIdentityMissing and
    // the dashboard shows a warning badge; users can reinitialize via the API.
    try {
      const { execFile } = await import('child_process')
      const { promisify: promisifyG12 } = await import('util')
      const execFileAsyncG12 = promisifyG12(execFile)
      const ampInitPath = join(HOME, '.local', 'bin', 'amp-init.sh')
      const { existsSync: existsAmpInit } = await import('fs')
      if (!existsAmpInit(ampInitPath)) {
        ops.push(`G12: WARN — amp-init.sh not found at ${ampInitPath}; agent flagged ampIdentityMissing`)
        try {
          const { updateAgent: markMissing } = await import('@/lib/agent-registry')
          await markMissing(agent.id, { ampIdentityMissing: true } as import('@/types/agent').UpdateAgentRequest)
        } catch { /* best effort */ }
      } else {
        const tenant = process.env.AIMAESTRO_ORG || 'default'
        const args = ['--force', '--name', name, '--tenant', tenant]
        // BUG-015-01 fix: provision the AMP home at the UUID-keyed path so
        // the server's UUID-based delivery lookup (`resolveAgentAMPHome` in
        // lib/amp-inbox-writer.ts) finds the freshly-initialized keys and
        // config instead of silently creating an empty stale UUID dir from
        // the machine-level ai-maestro defaults.
        const ampEnvDir = join(HOME, '.agent-messaging', 'agents', agent.id)
        try {
          await execFileAsyncG12(ampInitPath, args, {
            timeout: 30000,
            cwd: workDir,
            env: { ...process.env, AMP_DIR: ampEnvDir },
          })
          // Also register name→UUID in the AMP index so CLI name-based lookups
          // (`amp-send bob`, `amp-inbox` from outside the agent) resolve to the
          // same UUID-keyed home.
          //
          // EMS-MIN-04 fix: atomic write — temp file + rename. The previous
          // direct writeFile() call could leave .index.json half-written if
          // the process crashed mid-write, breaking name-based AMP routing for
          // ALL agents (next read would JSON.parse a malformed file and throw).
          // Also handle JSON.parse errors of an existing file by treating a
          // malformed index as empty, so a corrupted file self-heals on the
          // next CreateAgent call.
          try {
            const { promises: fsG12 } = await import('fs')
            const indexPath = join(HOME, '.agent-messaging', 'agents', '.index.json')
            let indexData: Record<string, string> = {}
            try {
              const raw = await fsG12.readFile(indexPath, 'utf-8')
              indexData = JSON.parse(raw) as Record<string, string>
            } catch {
              // Index file doesn't exist yet, OR exists but is malformed —
              // either way, fall back to an empty index. The atomic write
              // below will overwrite a malformed file with a clean one.
            }
            indexData[name] = agent.id
            const tmpIndexPath = `${indexPath}.tmp.${process.pid}.${Date.now()}`
            await fsG12.writeFile(tmpIndexPath, JSON.stringify(indexData, null, 2))
            await fsG12.rename(tmpIndexPath, indexPath)
          } catch (indexErr) {
            ops.push(`G12: WARN — failed to update .index.json: ${indexErr instanceof Error ? indexErr.message : indexErr}`)
          }
          ops.push(`G12: AMP identity initialized (${name}@${tenant}.local) at ${ampEnvDir}`)
        } catch (ampErr) {
          const msg = ampErr instanceof Error ? ampErr.message : String(ampErr)
          ops.push(`G12: WARN — amp-init failed: ${msg.slice(0, 200)}; agent flagged ampIdentityMissing`)
          try {
            const { updateAgent: markMissing2 } = await import('@/lib/agent-registry')
            await markMissing2(agent.id, { ampIdentityMissing: true } as import('@/types/agent').UpdateAgentRequest)
          } catch { /* best effort */ }
        }
      }
    } catch (g12Err) {
      ops.push(`G12: WARN — unexpected error: ${g12Err instanceof Error ? g12Err.message : g12Err}`)
    }

    // TRDD-eac02238 step 6 (fan-out, 2026-04-20): emit per-op ledger
    // entry for CreateAgent. Fire-and-forget to avoid blocking the
    // response; the save-level bulk-diff emitted by agent-registry
    // saveAgents() stays as a safety net.
    try {
      const { emitAgentOp } = await import('@/lib/ledger-emit')
      emitAgentOp(
        'create_agent',
        [
          {
            op: 'add',
            path: `/agents/${agent.id}`,
            value: {
              id: agent.id,
              name: agent.name,
              label: agent.label ?? null,
              program,
              governanceTitle: agent.governanceTitle ?? null,
              team: agent.team ?? null,
            },
          },
        ],
        {
          action: 'create-agent',
          agentId: desired.authContext?.agentId ?? null,
          actor: desired.authContext?.agentId ? 'agent' : 'user',
        },
      )
    } catch (ledgerErr) {
      ops.push(`LEDGER: WARN — per-op append failed: ${ledgerErr instanceof Error ? ledgerErr.message : ledgerErr}`)
    }

    // ── Consume-after-success (R28 §4.3) ──────────────────────────────
    // A ONE-SHOT approval token is consumed ONLY now — after every gate passed
    // AND the agent (+ title + team) persisted. Consuming earlier would burn a
    // token on a pipeline that later failed a downstream gate. Mandate tokens
    // (uses_remaining null) are a no-op in consumeToken — only approvals burn.
    if (matchedPortfolioTokenId) {
      try {
        const { consumeToken, getTokenById } = await import('@/lib/portfolio-store')
        const tok = getTokenById(matchedPortfolioTokenId)
        const consumed = await consumeToken(matchedPortfolioTokenId)
        if (consumed && tok) {
          const { emitPortfolioOp, consumeDiff } = await import('@/lib/portfolio-ledger')
          const remaining = (tok.uses_remaining ?? 1) - 1
          void emitPortfolioOp('consume_portfolio_token', tok.token_id, consumeDiff(tok, remaining), {
            action: 'consume-portfolio-token',
            agentId: desired.authContext?.agentId ?? null,
            actor: desired.authContext?.agentId ? 'agent' : 'user',
          })
          ops.push('G-consume: one-shot portfolio approval consumed')
        }
      } catch (consumeErr) {
        // Non-fatal: the agent is already created. A failed consume leaves the
        // approval usable once more — logged so it is auditable.
        ops.push(`G-consume: WARN — portfolio token consume failed: ${consumeErr instanceof Error ? consumeErr.message : consumeErr}`)
      }
    }

    result.success = true
    console.log(`[CreateAgent] "${name}" created (id=${agent.id}, program=${program}, ${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[CreateAgent] FAILED for "${desired.name}":`, result.error)
    return result
  }
}
