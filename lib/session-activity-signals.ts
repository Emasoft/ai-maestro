/**
 * Read-only session-activity signals for NON-self panes (TRDD-ZLBBD4E3).
 *
 * The consumer is the janitor's fleet guardian + injection gates: before touching a
 * pane they must know "is a turn running / when did the human last type / is the
 * transcript still moving". Today they infer from transcript mtimes and probe HID via
 * ioreg, which goes blind under load (the 2026-08-19 type-over-the-user incident,
 * janitor TRDD-D2DD5GO8). R42 keeps `state --pane` SELF-only because it returns pane
 * CONTENT; this module returns DERIVED SIGNALS ONLY — booleans and epochs, never pane
 * text, never transcript text — which is the property that makes a non-self read safe.
 * That property is NORMATIVE: widening this to carry content is a different (refused)
 * design, not an extension.
 *
 * Movement is the caller's to derive: `transcript_last_write_epoch` is one sample, and
 * one sample of a moving quantity licenses nothing (the janitor's own frozen-vs-live
 * lesson) — two calls spaced past the tool-call cadence answer "advancing?". The server
 * deliberately does NOT hold per-caller state to fake a boolean here.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { chatStateFileFor } from '@/lib/chat-state-path'
import { conversationSlug } from '@/lib/claude-conversation'
import { getPresence } from '@/lib/user-presence'

export interface SessionActivitySignals {
  session: string
  agentId: string
  workdir: string
  /** true = a turn is running (hook status active|busy|subagents_running|compacting);
   *  false = idle/waiting/stopped/error; null = no hook state on disk (unknown). */
  in_turn: boolean | null
  /** The hook's RAW status — no server-side aging: `hook_updated_at_epoch` lets the
   *  caller judge staleness against its own window instead of inheriting ours. */
  hook_status: string | null
  hook_updated_at_epoch: number | null
  /** Machine-global human-input epoch (seconds) from the presence store — the signal
   *  the janitor's ioreg HID probe approximates. Null = never recorded. */
  last_user_input_epoch: number | null
  /** Newest transcript write for this workdir's conversation slug (seconds). */
  transcript_last_write_epoch: number | null
}

const IN_TURN_STATUSES = new Set(['active', 'busy', 'subagents_running', 'compacting'])

function newestTranscriptEpoch(workdir: string): number | null {
  const dir = path.join(os.homedir(), '.claude', 'projects', conversationSlug(workdir))
  try {
    let newest = 0
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const m = fs.statSync(path.join(dir, f)).mtimeMs
      if (m > newest) newest = m
    }
    return newest > 0 ? Math.floor(newest / 1000) : null
  } catch {
    return null // no transcript dir yet — a fresh agent, not an error
  }
}

/** Resolve the agent by tmux session name and derive the signals. Null = no such agent. */
export async function sessionActivitySignals(sessionName: string): Promise<SessionActivitySignals | null> {
  const { getAgentBySession } = await import('@/lib/agent-registry')
  const agent = getAgentBySession(sessionName)
  const workdir: string | undefined = agent?.workingDirectory
    ?? agent?.sessions?.find((s: { index?: number }) => s.index === 0)?.workingDirectory
  if (!agent || !workdir) return null

  let hookStatus: string | null = null
  let hookEpoch: number | null = null
  try {
    const raw = JSON.parse(fs.readFileSync(chatStateFileFor(workdir), 'utf8'))
    if (typeof raw?.status === 'string') hookStatus = raw.status
    const t = new Date(String(raw?.updatedAt)).getTime()
    if (Number.isFinite(t) && t > 0) hookEpoch = Math.floor(t / 1000)
  } catch {
    // missing/unreadable state file ⇒ hookStatus stays null ⇒ in_turn is UNKNOWN,
    // never "not in turn" — an injection gate must not read absence as safety.
  }

  return {
    session: sessionName,
    agentId: agent.id,
    workdir,
    in_turn: hookStatus === null ? null : IN_TURN_STATUSES.has(hookStatus),
    hook_status: hookStatus,
    hook_updated_at_epoch: hookEpoch,
    last_user_input_epoch: getPresence().last_user_input_epoch,
    transcript_last_write_epoch: newestTranscriptEpoch(workdir),
  }
}
