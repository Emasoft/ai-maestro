/**
 * Curated agent-command allowlist (TRDD-TBGGUA2V, P2).
 *
 * The dashboard lets the user inject a small set of KNOWN, SAFE slash-commands
 * into an agent's Claude Code REPL via tmux (reload-plugins, compact, janitor
 * controls, …). Rather than accept arbitrary command text, the API accepts a
 * stable KEY from this allowlist and sends the corresponding FIXED literal
 * command string. That makes the surface injection-proof BY CONSTRUCTION:
 *   - the caller never supplies the command text, only a key;
 *   - each `command` below is a compile-time constant (no interpolation);
 *   - an unknown key resolves to `undefined` → the route rejects it.
 * This is defense-in-depth ON TOP OF the existing no-shell send path
 * (sendCommand → tmux send-keys -l, literal mode) — never a replacement for it.
 */

export interface AgentCommand {
  /** Stable key the API/UI references (kebab-case). */
  key: string
  /** Short human label for a UI button. */
  label: string
  /** The exact slash-command sent to the REPL. A constant literal — never interpolated. */
  command: string
  /**
   * Only deliver when the agent is at its idle prompt (the safe state with no
   * subagents running / no permission prompt pending). The route enforces this
   * by passing requireIdle to sendCommand.
   */
  requiresIdle: boolean
  /** Needs an explicit extra confirmation in the UI (irreversible / wipes context). */
  destructive?: boolean
  /** One-line explanation shown in the UI tooltip. */
  description: string
}

/**
 * The allowlist. Keep it SMALL and curated — every entry is a command we are
 * confident is safe to send to an agent at idle. Add new entries only after
 * confirming the slash-command exists and is non-destructive (or mark
 * `destructive: true`).
 */
export const AGENT_COMMANDS: readonly AgentCommand[] = [
  {
    key: 'reload-plugins',
    label: 'Reload plugins',
    command: '/reload-plugins',
    requiresIdle: true,
    description: 'Reload plugin hooks and skills after an update.',
  },
  {
    key: 'compact',
    label: 'Compact context',
    command: '/compact',
    requiresIdle: true,
    description: 'Compact the conversation to reclaim context window.',
  },
  // ── Model fallback (USER, 2026-08-06) ───────────────────────────────────────
  // A model-scoped weekly window (e.g. Fable) can be exhausted while the ACCOUNT
  // still has most of its 5h/7d capacity. Measured that day: the live account sat
  // at 5h 42% / 7d 60% with its Fable window at ~98%, and the rotator responded by
  // evicting the whole fleet onto accounts at 99% (5h) and 87% (7d) — because
  // `isSafeAlternate` treats "maxed on ANY window" as "unusable for ALL work", so
  // the healthiest account was disqualified by a limit that binds ONE model.
  //
  // Rotating the credential is the expensive answer to that. Switching the MODEL is
  // the cheap one: the account keeps serving every non-Fable request at full speed.
  // The owner's words: "fable window limit is not a true limit.. the solution is
  // simply to fallback to Opus 5".
  //
  // Fixed command strings, deliberately — no interpolated model name. A curated key
  // per target model cannot be steered by a caller, which is the whole point of an
  // allowlist standing in front of a pane write.
  //
  // requiresIdle: a model switch mid-turn would land in whatever the agent is typing.
  // Not destructive: it changes which model answers next; it wipes nothing.
  {
    key: 'model-opus',
    label: 'Switch model to Opus',
    command: '/model opus',
    requiresIdle: true,
    description: 'Fall back to Opus — use when a model-scoped window is exhausted but the account still has 5h/7d headroom.',
  },
  {
    key: 'model-sonnet',
    label: 'Switch model to Sonnet',
    command: '/model sonnet',
    requiresIdle: true,
    description: 'Switch to Sonnet — the cheaper fallback when Opus is also constrained.',
  },
  {
    key: 'clear',
    label: 'Clear context',
    command: '/clear',
    requiresIdle: true,
    destructive: true,
    description: 'Clear the conversation — WIPES the agent context. Irreversible.',
  },
  {
    key: 'janitor-arm',
    label: 'Janitor: arm',
    command: '/janitor-arm',
    requiresIdle: true,
    description: 'Arm the janitor heartbeat cron for this agent.',
  },
  {
    key: 'janitor-disarm',
    label: 'Janitor: disarm',
    command: '/janitor-disarm',
    requiresIdle: true,
    description: 'Disarm the janitor heartbeat cron for this agent.',
  },
  {
    key: 'janitor-pause',
    label: 'Janitor: pause',
    command: '/janitor-pause',
    requiresIdle: true,
    description: 'Pause the janitor detectors without removing the heartbeat.',
  },
  {
    key: 'janitor-unpause',
    label: 'Janitor: unpause',
    command: '/janitor-unpause',
    requiresIdle: true,
    description: 'Resume previously-paused janitor detectors.',
  },
  {
    key: 'janitor-audit',
    label: 'Janitor: audit',
    command: '/janitor-audit',
    requiresIdle: true,
    description: 'Run the janitor drift/security detectors once now.',
  },
  // Registered for the janitor #J soft-send migration to `queue --command-key`
  // (janitor#100 rev 3). All self-scoped janitor self-maintenance commands, safe at
  // idle, non-destructive. Command strings were CONFIRMED by the janitor against its
  // shipped senders (reload_trigger.py:138 → `/reload-plugins --force`;
  // reload_skills_trigger.py:136 → `/reload-skills`, the Claude Code built-in) — never
  // guessed (the verified allowlist is the injection boundary). `reload-plugins-force`
  // is a SEPARATE key from the plain UI `reload-plugins` so the dashboard button
  // semantics don't shift.
  {
    key: 'janitor-resume',
    label: 'Janitor: resume',
    command: '/janitor-resume',
    requiresIdle: true,
    description: 'Fire the janitor resume cue now (continue the pending task after a compact / rate-limit clear).',
  },
  {
    key: 'janitor-write-handoff',
    label: 'Janitor: write handoff',
    command: '/janitor-write-handoff',
    requiresIdle: true,
    description: 'Author a rich agent handoff to .janitor/state before a delicate compaction.',
  },
  // ── Externalized compaction (USER, 2026-08-15 — TRDD-IZ6KU37Y's sibling leg) ──────────────
  // The USER's ask was "implement the externalized-compact, OR make the janitor able to trigger
  // it from inside the ai-maestro server". This entry is the SECOND, and it is the correct one
  // — not a shortcut. `/janitor-externalized-compaction` fronts the janitor's
  // `external_handoff_clear.py`, which composes the handoff OUTSIDE the model (on-disk TRDD
  // STATE blocks + git log + the findings ledger, optionally upgraded through the llm-ext CLI),
  // then types `/clear` plus the verified bootstrap chain into THE SESSION'S OWN PANE, matched
  // by a breadcrumb that session recorded at start.
  //
  // THIS ENTRY IS THE ATTENDED PATH, NOT THE ONLY ONE. Injecting the command makes the AGENT'S
  // OWN SESSION run the script, so every veto is evaluated by the one process that can answer
  // them — `active-waiting` (a resume or BACKGROUND AGENT is in flight), `NO_RECORDED_PANE`,
  // `HANDOFF_NOT_CONCISE`, the opt-in `CLAUDE_PLUGIN_OPTION_EXTERNAL_IDLE_CLEAR_ENABLED` gate.
  // And it adds no trust surface: the caller supplies a KEY, never text (see the header).
  //
  // ⚠ CORRECTED 2026-08-15, and the correction matters. This comment first claimed the server
  // "must not" run the script itself because it self-targets and could never aim at another
  // pane. THAT IS FALSE — verified in their shipped code: `external_handoff_clear.py:402` calls
  // `fleet_restart.recorded_terminal(str(root))`, resolving the pane from the `--project-root`
  // PASSED IN, via `<root>/.janitor/state/terminal-identity.json`. So a per-agent subprocess is
  // legitimate, and it is the seam the janitor actually wants (their spec, 2026-08-15).
  //
  // The two paths are not rivals, and the difference is the one that matters for continuity:
  // an INJECTED command needs the agent's REPL to be responsive and at idle to consume the
  // keystroke — which is precisely what a wedged agent is not, and a wedged agent is exactly
  // when a shrink is needed. The subprocess path (`lib/external-compaction.ts`) works on an
  // agent that can no longer act for itself. Keep this key for the human/UI trigger; reach for
  // the runner for unattended continuity.
  //
  // Reachable from the dashboard listing, `POST /api/agents/[id]/session`, and the internal
  // actuators that resolve by key (fleet-recovery-actuator / model-fallback-actuator).
  //
  // destructive: TRUE. It ends in `/clear`. The composed handoff + bootstrap chain make the
  // session RECOVERABLE, which is not the same as the clear being reversible — the live
  // conversation is gone either way, so the UI must ask. Classifying it with `compact` (which
  // wipes nothing) to avoid a confirmation dialog would be trading the user's data for a click.
  {
    key: 'janitor-externalized-compaction',
    label: 'Janitor: externalized compaction',
    command: '/janitor-externalized-compaction',
    requiresIdle: true,
    destructive: true,
    description:
      'Shrink the agent: compose a handoff from on-disk state OUTSIDE the model, then /clear and bootstrap back. Cheaper than /compact (no authoring turn) — but it WIPES the live conversation. The agent keeps every veto: it refuses while background agents are running.',
  },
  {
    key: 'reload-plugins-force',
    label: 'Reload plugins (force)',
    command: '/reload-plugins --force',
    requiresIdle: true,
    description: 'Reload plugin hooks/skills, forcing past a mid-use plugin that would refuse a plain reload.',
  },
  {
    key: 'reload-skills',
    label: 'Reload skills',
    command: '/reload-skills',
    requiresIdle: true,
    description: 'Reload standalone (non-plugin) skills — the Claude Code built-in, distinct from reload-plugins.',
  },
] as const

/** Resolve a command by key. Returns undefined for any key not in the allowlist. */
export function getAgentCommand(key: string): AgentCommand | undefined {
  return AGENT_COMMANDS.find((c) => c.key === key)
}

/** All allowlisted keys (for UI enumeration / validation messages). */
export function agentCommandKeys(): string[] {
  return AGENT_COMMANDS.map((c) => c.key)
}
