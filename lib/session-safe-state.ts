/**
 * Safe-state helpers for session stop/restart (TRDD-O8NCNRWO).
 *
 * Claude Code ≥2.1.198 runs subagents in the BACKGROUND by default, so a main
 * session can sit at its idle input prompt while subagents are still working.
 * That broke the old premise "idle_prompt ⟹ no subagents ⟹ safe to /exit":
 * sending /exit with live background agents lands on Claude's abandon-
 * confirmation dialog instead of exiting (2.1.203 changelog confirms the
 * dialog fires whenever background agents are genuinely running).
 *
 * This module is the single server-side reader of the hook's chat-state
 * subagent counter. IMPORTANT TRUST NOTE: the counter can be stale-LOW —
 * ai-maestro-plugin's hook currently REPLACES the state file on idle_prompt,
 * dropping subagentCount (Emasoft/ai-maestro-plugin#17) — so a 0/absent value
 * must never be treated as proof of safety, only a >0 value as proof of
 * danger. The gate therefore only BLOCKS on a positive count and stays
 * permissive otherwise; the restart poll's abandon-prompt detection is the
 * backstop for the undetectable case.
 */
import fs from 'fs'
import { chatStateFileFor } from '@/lib/chat-state-path'

/**
 * Read the live subagent counter from the hook's chat-state file for a workdir.
 *
 * Returns:
 *  - a number ≥ 0 when the file exists and carries a numeric subagentCount
 *  - null when unknown (no workdir, no state file, unreadable JSON, field
 *    absent or non-numeric) — callers MUST treat null as "cannot prove
 *    danger", not as "safe" (see the trust note above).
 */
export function readSubagentCount(workingDir: string | undefined | null): number | null {
  if (!workingDir) return null
  try {
    // ONE resolver (lib/chat-state-path): the hook's own index, never a mirrored hash algorithm —
    // the md5 mirror that lived here read a non-existent file for 3 months (see that module).
    const stateFile = chatStateFileFor(workingDir)
    if (!fs.existsSync(stateFile)) return null
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
    const count = state?.subagentCount
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
    return count
  } catch {
    return null
  }
}

/**
 * Read the hook's activity notification for a workdir — the 5-state signal
 * (`status`, `notificationType` ∈ idle_prompt | permission_prompt | idle | …) —
 * from the SAME chat-state file as readSubagentCount. Used by the fleet-liveness
 * scanner (TRDD-CHN16JXZ) to tell a permission-waiting agent (needs the user, do
 * not touch) from a genuinely stalled one. Null when unknown/unreadable (fail-safe:
 * an absent notification is never read as "stalled").
 */
export function readHookNotification(
  workingDir: string | undefined | null,
): { status: string | null; notificationType: string | null } | null {
  if (!workingDir) return null
  try {
    // ONE resolver (lib/chat-state-path): the hook's own index, never a mirrored hash algorithm —
    // the md5 mirror that lived here read a non-existent file for 3 months (see that module).
    const stateFile = chatStateFileFor(workingDir)
    if (!fs.existsSync(stateFile)) return null
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
    return {
      status: typeof state?.status === 'string' ? state.status : null,
      notificationType: typeof state?.notificationType === 'string' ? state.notificationType : null,
    }
  } catch {
    return null
  }
}

/**
 * Pure gate decision for the stop/restart routes: block only on a PROVEN
 * positive subagent count and no force override. `count === null` (unknown)
 * never blocks — the counter is not trustworthy enough to refuse service on
 * absence of evidence (plugin#17), and blocking every unknown would brick
 * stop/restart for agents whose hook predates the counter entirely.
 */
export function evaluateExitGate(
  count: number | null,
  force: boolean,
  // The counter can also be stale-HIGH (measured 2026-08-20, TRDD-O8NCNRWO e2e round 3): a
  // force-stop kills the main session while a subagent runs, so SubagentStop never fires and
  // the file keeps `subagentCount: 1` FOREVER — every later stop/restart of that agent then
  // 409s on a pane that is a bare shell, with nothing left to protect. `programRunning` is the
  // LIVE signal that breaks the loop: pass `false` ONLY when the pane provably is not running
  // the program (its current command is a shell) — then the gate never blocks. `true`/undefined/
  // null (running / not checked / tmux unreadable) keep the conservative behavior unchanged.
  programRunning?: boolean | null,
): { blocked: boolean; subagentCount: number | null } {
  return { blocked: !force && count !== null && count > 0 && programRunning !== false, subagentCount: count }
}

/**
 * LIVE probe for the gate's stale-HIGH escape: is the session's pane still running a program
 * (vs sitting at a bare shell)? Returns:
 *  - false — the pane's current command IS a shell: nothing to exit, the gate must not block;
 *  - true  — some non-shell program is in the pane (claude, node, …): gate applies;
 *  - null  — tmux unreadable / no such session: UNKNOWN, gate applies (conservative).
 * Same shell set as lib/session-restart.ts::SHELL_COMMANDS (not imported — that module pulls in
 * the restart machinery; this one stays a leaf both serving modes load).
 */
export function sessionProgramRunning(sessionName: string): boolean | null {
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    const cmd = execFileSync('tmux', ['display-message', '-p', '-t', sessionName, '#{pane_current_command}'], {
      timeout: 5000,
      encoding: 'utf8',
    }).trim()
    if (!cmd) return null
    return !new Set(['zsh', 'bash', 'sh', 'fish', '-zsh', '-bash']).has(cmd)
  } catch {
    return null
  }
}

/**
 * Does a tmux pane tail look like Claude Code's "background agents still
 * running" abandon-confirmation dialog (the thing /exit lands on when
 * background subagents are live)? Kept deliberately broad: the dialog's exact
 * copy varies across CC versions, but every observed variant names the
 * running/background agents and asks for confirmation.
 */
export function looksLikeAbandonPrompt(paneText: string): boolean {
  // Three families, because the dialog's copy has already changed once and each family was
  // observed, not guessed:
  //  1. "background/running (sub)agents … exit/abandon" (and the reverse order) — the
  //     2.1.203-era wording this function originally targeted;
  //  2. "Background work is running" — CC 2.1.235's wording, captured LIVE 2026-08-19 from a
  //     force-stopped session ("Background work is running / The following will stop when you
  //     exit: / ❯ 1. Exit and stop tasks"). It never says "agents", so family 1 MISSED it and
  //     both probes (restart's, and the stop path added the same day) were blind on current CC;
  //  3. the menu line "Exit and stop tasks" — distinctive on its own and likely the most stable
  //     of the three (it is the dialog's action, not its prose).
  return (
    /(background|running)\s+(sub)?agents?[\s\S]{0,120}(exit|abandon|are you sure|anyway)|(exit|abandon)[\s\S]{0,80}(background|running)\s+(sub)?agents?/i.test(paneText) ||
    /background\s+work\s+is\s+running/i.test(paneText) ||
    /exit\s+and\s+stop\s+tasks/i.test(paneText)
  )
}
