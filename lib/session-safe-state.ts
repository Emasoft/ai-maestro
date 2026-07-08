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
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { statePath } from '@/lib/ecosystem-constants'

/** Mirror of the hook's cwd hashing (ai-maestro-hook.cjs / agents-chat-service). */
function hashCwd(cwd: string): string {
  return crypto.createHash('md5').update(cwd || '').digest('hex').substring(0, 16)
}

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
    const stateFile = path.join(statePath('chat-state'), `${hashCwd(workingDir)}.json`)
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
 * Pure gate decision for the stop/restart routes: block only on a PROVEN
 * positive subagent count and no force override. `count === null` (unknown)
 * never blocks — the counter is not trustworthy enough to refuse service on
 * absence of evidence (plugin#17), and blocking every unknown would brick
 * stop/restart for agents whose hook predates the counter entirely.
 */
export function evaluateExitGate(
  count: number | null,
  force: boolean,
): { blocked: boolean; subagentCount: number | null } {
  return { blocked: !force && count !== null && count > 0, subagentCount: count }
}

/**
 * Does a tmux pane tail look like Claude Code's "background agents still
 * running" abandon-confirmation dialog (the thing /exit lands on when
 * background subagents are live)? Kept deliberately broad: the dialog's exact
 * copy varies across CC versions, but every observed variant names the
 * running/background agents and asks for confirmation.
 */
export function looksLikeAbandonPrompt(paneText: string): boolean {
  return /(background|running)\s+(sub)?agents?[\s\S]{0,120}(exit|abandon|are you sure|anyway)|(exit|abandon)[\s\S]{0,80}(background|running)\s+(sub)?agents?/i.test(paneText)
}
