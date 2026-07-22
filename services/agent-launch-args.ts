/**
 * Launch-arg enforcement: a titled Claude agent MUST run its role-plugin
 * main-agent persona (TRDD-GZ1KOHNR). USER mandate 2026-07-22: "the --agent
 * specification must be enforced.. no agent can be executed without it."
 *
 * The bug this fixes: a freshly-created titled agent launches as generic
 * `claude` — no `--agent` — so its role persona never loads and (e.g.) a
 * MANAGER behaves like vanilla Claude (builds solo, never creates/delegates a
 * fleet). Root cause: CreateAgent stores the default programArgs
 * (`--dangerously-skip-permissions`, no `--agent`) at G04; G06 ChangeTitle
 * later injects `--agent` into the REGISTRY, but the launch chokepoints build
 * the command from a stale/param programArgs. Rather than chase every stale
 * copy, we DERIVE `--agent` from the installed role-plugin AT the launch
 * chokepoint — the role-plugin is the single source of truth for which persona
 * this agent runs, and it is guaranteed installed by then (CreateAgent G07c
 * hard-rejects a role-plugin-less agent; R9.13).
 *
 * Claude-only: Codex/Gemini/OpenCode/Kiro do NOT select a persona via a CLI
 * flag — they read per-client manifest files — so a non-Claude program passes
 * through untouched (mirrors the same opt-in in lib/program-args.ts).
 */
import { setClaudeAgentFlag } from '@/lib/program-args'

/** A launch either proceeds with enforced args, or is refused (fail-fast). */
export type LaunchArgsResult =
  | { kind: 'ok'; args: string }
  | { kind: 'refuse'; reason: string }

function isClaudeProgram(program: string): boolean {
  return (program || '').toLowerCase().includes('claude')
}

/**
 * PURE decision (no scan, no tmux — unit-testable).
 *
 * @param program       The agent's program/client (e.g. "claude code", "codex").
 * @param programArgs   The stored/param CLI args string (may lack --agent).
 * @param mainAgentName The installed role-plugin's main-agent basename
 *                      (e.g. `ai-maestro-assistant-manager-agent-main-agent`),
 *                      or null when none resolves.
 *
 * - non-Claude program                → ok(passthrough): persona is loaded via
 *   a client manifest, not `--agent`.
 * - Claude + mainAgentName            → ok(setClaudeAgentFlag → inject/replace
 *   `--agent`, idempotent, all other tokens preserved).
 * - Claude + null mainAgentName       → REFUSE: launching generic `claude`
 *   without a persona is exactly the bug we forbid; fail-fast so a persona-less
 *   zombie is never started (an R9.13 violation the caller surfaces).
 */
export function enforceLaunchAgentFlag(
  program: string,
  programArgs: string,
  mainAgentName: string | null,
): LaunchArgsResult {
  if (!isClaudeProgram(program)) {
    return { kind: 'ok', args: programArgs }
  }
  if (mainAgentName) {
    return { kind: 'ok', args: setClaudeAgentFlag(programArgs, mainAgentName) }
  }
  return {
    kind: 'refuse',
    reason:
      'Claude agent has no resolvable role-plugin main-agent, so `--agent` cannot be enforced. ' +
      'R9.13 requires every agent to carry a role-plugin; assign one via Profile → Config before launching.',
  }
}

/** Injectable resolver seam so the wired path is unit-testable with no real scan. */
export interface ResolveLaunchArgsDeps {
  resolveMainAgent?: (agentId: string) => string | null | Promise<string | null>
}

async function defaultResolveMainAgent(agentId: string): Promise<string | null> {
  // Lazy import (the codebase's services→services pattern) — avoids a hard
  // import cycle at module load and keeps this file's static deps to lib only.
  const { scanAgentLocalConfig } = await import('@/services/agent-local-config-service')
  const scan = scanAgentLocalConfig(agentId)
  return scan?.data?.rolePlugin?.mainAgentName ?? null
}

/**
 * WIRED enforcement for a launch chokepoint (wakeAgent / createSession / restart).
 * Resolves the installed role-plugin's main-agent for the agent and applies the
 * pure decision above. Async only because the scanner is lazy-imported; the
 * decision itself (enforceLaunchAgentFlag) is pure and sync.
 *
 * @param agentId  The registered agent id, or undefined for a raw (agentless)
 *                 session — those pass through unchanged: there is no role-plugin
 *                 to enforce and they are not fleet personas.
 */
export async function resolveLaunchArgs(
  agentId: string | undefined,
  program: string,
  programArgs: string,
  deps: ResolveLaunchArgsDeps = {},
): Promise<LaunchArgsResult> {
  if (!agentId) {
    // Raw session with no registered agent — nothing to enforce.
    return { kind: 'ok', args: programArgs }
  }
  const resolveMainAgent = deps.resolveMainAgent ?? defaultResolveMainAgent
  const mainAgentName = await resolveMainAgent(agentId)
  return enforceLaunchAgentFlag(program, programArgs, mainAgentName)
}
