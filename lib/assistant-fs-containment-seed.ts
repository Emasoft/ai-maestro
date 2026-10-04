/**
 * ASSISTANT-role filesystem containment seeding (TRDD-U7MJUHWJ).
 *
 * Expands the USER ruling recorded in TRDD-3QRUDK12: an ASSISTANT agent's
 * reads AND writes outside its workdir are blocked by role-specific hooks,
 * with an enumerated exception list only. The hook script
 * (`rules/aimaestro-hooks/assistant-fs-containment-guard.sh`) is copied into
 * the workdir and a PreToolUse entry wired into `.claude/settings.local.json`
 * — installed by ONE invariant row (`assistant-fs-containment` in
 * lib/agent-invariants.ts), which runs on create, wake AND the periodic
 * watchdog. "Installs automatically as part of ASSISTANT provisioning"
 * (the card's third acceptance box) is that create/wake trigger plus the
 * fleet-wide boot sweep: no manual opt-in step exists.
 *
 * OWNERSHIP CONTRACT — same shape as lib/agent-rules-seed.ts, and for the
 * same reason: the GOVERNED party must not be able to rewrite the rules
 * that govern it. The hook entry and the script are the server's; an agent
 * that deletes or edits either is reverted on the next create/wake/periodic
 * pass. The env allowlist VALUES are recomputed from the registry on every
 * pass, so an agent-side edit survives at most one interval and a
 * collaboration grant lands only by a server write (TRDD-U4KP0H92 path).
 *
 * HONEST LIMIT (inherited): agents share the server's UID, so a determined
 * ASSISTANT can chmod/edit its own settings file and the containment holds
 * only until the next watchdog beat (≤5 min). This makes escape TRANSIENT
 * and self-healing, not impossible — real prevention needs per-agent UID
 * isolation (TRDD-a1019073). Do not read this module as a sandbox.
 */
import { chmod, copyFile, mkdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { readSettings, editSettings } from '@/lib/settings-gate'

/** Stable identifiers — exported for the invariant row and tests. */
export const CONTAINMENT_INVARIANT_ID = 'assistant-fs-containment'
export const CONTAINMENT_HOOK_SCRIPT_NAME = 'assistant-fs-containment-guard.sh'

/** settings.local.json env keys the invariant OWNS for ASSISTANT agents. */
export const LOCAL_FOLDERS_ENV = 'ASSISTANT_LOCAL_FOLDERS'
export const PROJECT_FOLDERS_ENV = 'ASSISTANT_PROJECT_FOLDERS'

/** Bundled hook script source — process.cwd() is the app install dir (same
 *  resolution as lib/agent-rules-seed.ts's DEFAULT_RULES_SOURCE_DIR). */
const HOOK_SOURCE_PATH = join(process.cwd(), 'rules', 'aimaestro-hooks', CONTAINMENT_HOOK_SCRIPT_NAME)

/**
 * The exact PreToolUse command wired into the workdir settings. CLAUDE_PROJECT_DIR
 * is the ASSISTANT's own workdir (Claude Code sets it per session), so the guard's
 * workdir allowlist entry IS that session's cwd — no per-agent path baking.
 */
export function containmentHookCommand(): string {
  return `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${CONTAINMENT_HOOK_SCRIPT_NAME}`
}

/** The matcher covers every tool whose input names a filesystem path. */
export const CONTAINMENT_HOOK_MATCHER = 'Read|Glob|Grep|LS|Write|Edit|MultiEdit|NotebookEdit|Bash'

/**
 * Designated locally-scoped folders — the machine-level half of the
 * enumerated exception list. A server-process env var, not a setting store:
 * which host folders any ASSISTANT may reach is an install-owner decision
 * changed rarely and read every watchdog beat. Empty by default; wiring a
 * richer per-install source is downstream work when the first deployment
 * needs one.
 */
export function readAssistantLocalFolders(): string[] {
  const raw = process.env.AIM_ASSISTANT_LOCAL_FOLDERS ?? ''
  return raw.split(/[\s,]+/).filter(Boolean)
}

/**
 * Approved project folders for THIS agent — the collaboration half of the
 * allowlist. The only source of truth is the agent's own registry entry
 * (`assistantProjectFolders`), which the collaboration-approval pipeline
 * writes (TRDD-U4KP0H92; the server-side approval flow itself is that
 * card's scope). Absent field → empty: by default an ASSISTANT reaches
 * nothing beyond its workdir and dot-state.
 */
export function getAssistantCollabFolders(
  agent: object | null | undefined
): string[] {
  const raw = (agent as { assistantProjectFolders?: unknown } | null | undefined)
    ?.assistantProjectFolders
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}

export interface ContainmentSeedResult {
  /** ok = already held · repaired = something was fixed · failed = could not fix */
  status: 'ok' | 'repaired' | 'failed'
  detail?: string
}

/** True iff the PreToolUse entry this module owns is present and exact. */
function hooksBlockMatches(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return false
  const pre = (hooks as Record<string, unknown>).PreToolUse
  if (!Array.isArray(pre)) return false
  return pre.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const e = entry as Record<string, unknown>
    if (e.matcher !== CONTAINMENT_HOOK_MATCHER) return false
    const inner = e.hooks
    if (!Array.isArray(inner)) return false
    return inner.some((h) => {
      if (!h || typeof h !== 'object') return false
      const hook = h as Record<string, unknown>
      return hook.type === 'command' && hook.command === containmentHookCommand()
    })
  })
}

/**
 * Install/repair the containment hook for one ASSISTANT workdir.
 * Best-effort like every file-level invariant: per-step errors are
 * returned as `failed`, never thrown past the invariant runner.
 *
 * The env VALUES are rewritten on EVERY pass (even when already present):
 * they are the server's allowlist projection — the registry's approved
 * project folders plus the machine's designated local folders — so an
 * agent-side edit to either survives at most one enforcement interval.
 */
export async function ensureAssistantFsContainment(
  workdir: string,
  opts: { localFolders?: string[]; projectFolders?: string[] } = {}
): Promise<ContainmentSeedResult> {
  const repaired: string[] = []

  // ── 1. The script itself, byte-owned like a DEP rule ──
  const hooksDir = join(workdir, '.claude', 'hooks')
  const destScript = join(hooksDir, CONTAINMENT_HOOK_SCRIPT_NAME)
  try {
    const src = await readFile(HOOK_SOURCE_PATH)
    let dest: Buffer | null = null
    try {
      dest = await readFile(destScript)
    } catch {
      dest = null
    }
    if (dest === null || !dest.equals(src)) {
      await mkdir(hooksDir, { recursive: true })
      await copyFile(HOOK_SOURCE_PATH, destScript)
      await chmod(destScript, 0o755)
      repaired.push(dest === null ? 'installed script' : 'restored script bytes')
    } else {
      const mode = (await stat(destScript)).mode & 0o777
      if (mode !== 0o755) {
        await chmod(destScript, 0o755)
        repaired.push('restored script mode')
      }
    }
  } catch (err) {
    return { status: 'failed', detail: `script sync failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // ── 2. The settings.local.json hooks entry + owned env keys ──
  const settingsPath = join(workdir, '.claude', 'settings.local.json')
  try {
    const read = await readSettings(settingsPath)
    // UNREADABLE must NOT be rebuilt from {} — same contract as the
    // amp-only-messaging invariant: a lenient read here would destroy
    // whatever the agent actually has.
    if (!read.ok && read.reason === 'unreadable') {
      return { status: 'failed', detail: 'settings.local.json unreadable (parse error); refusing to overwrite' }
    }

    const current = read.ok ? read.data : {}
    const hooksOk = hooksBlockMatches(current)
    const localWant = (opts.localFolders ?? []).join(' ')
    const projectWant = (opts.projectFolders ?? []).join(' ')
    const env = current.env
    const envIsObj = !!env && typeof env === 'object' && !Array.isArray(env)
    const envOk = envIsObj &&
      (env as Record<string, unknown>)[LOCAL_FOLDERS_ENV] === localWant &&
      (env as Record<string, unknown>)[PROJECT_FOLDERS_ENV] === projectWant

    if (hooksOk && envOk) {
      if (repaired.length > 0) return { status: 'repaired', detail: repaired.join('; ') }
      return { status: 'ok' }
    }

    const ops: Parameters<typeof editSettings>[1] = []
    if (!hooksOk) {
      ops.push({
        op: 'set',
        keyPath: ['hooks', 'PreToolUse'],
        value: [
          {
            matcher: CONTAINMENT_HOOK_MATCHER,
            hooks: [{ type: 'command', command: containmentHookCommand(), timeout: 10 }],
          },
        ],
      })
      repaired.push('wired PreToolUse entry')
    }
    // Always set both env keys when we are here — presence-with-drifted-value
    // and absence take the same repair path, and the write is idempotent.
    ops.push({ op: 'set', keyPath: ['env', LOCAL_FOLDERS_ENV], value: localWant })
    ops.push({ op: 'set', keyPath: ['env', PROJECT_FOLDERS_ENV], value: projectWant })
    repaired.push('projected allowlist env')

    await editSettings(settingsPath, ops)
    return { status: 'repaired', detail: repaired.join('; ') }
  } catch (err) {
    return { status: 'failed', detail: `settings write failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
