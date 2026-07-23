# Orchestrating a long unattended fleet watch

_Playbook for the session (human orchestrator or ORCHESTRATOR-title agent) that
stewards a multi-hour, unsupervised fleet run — e.g. a SCEN-031 end-to-end ship.
Captured from real token/process mistakes made during the 2026-07-23 SCEN-031
watch (TRDD-DY0E76EQ). Read it at **turn 1** of any long watch, before the first
fan-out._

The governing constraint is `~/.claude/rules/token-economy-agents-and-scenarios.md`:
a long persistent session **re-bills its entire context every turn**, so cost is
`turns × per-turn-context`. Everything below follows from that one fact.

## 1. Turn 1 — set up event-driven monitors, then stop polling

Establish the watch as **event-driven**, never poll-driven:

- Arm a **ship-progress `Monitor`** that wakes you on milestones and failure
  signatures (product commits, PR opened/merged, "FAILED"/"Traceback"/"Killed"),
  not a per-heartbeat status sweep.
- Let the **janitor heartbeat** do its job: each fire runs the stub and a one-line
  reply. Do **NOT** turn a heartbeat into a detailed registry/pane/PR audit — that
  re-bills the whole persistent context for information you don't need yet.

Anti-pattern (real, 2026-07-23): several early turns of detailed
`GET /api/agents` + `tmux capture-pane` + `gh pr view` checks on every heartbeat.
Each one re-billed a large context to learn "still building" — pure waste.

## 2. Arm the burn guard BEFORE any fan-out — not after

Arm `agentlenspro --guard` **before** spawning the first agent wave, filtered to
the real stop-signals (**CACHE_THRASH** + **server-health**), so a runaway is
caught at launch, not after it has already spent. The skill says arm-first; do it.

## 3. Gate on COST, not token-count

- `get_window_eta` (cost-based) is the **authoritative** week-window check. Run it
  at deliberate checkpoints, not continuously.
- A raw **BURN_SPIKE** token-rate alert is **not by itself a stop condition** — it
  false-trips on a just-completed subagent, a post-compaction re-warm, or another
  project's cache-reads sharing the window. Confirm with `investigate_burn` /
  `get_window_eta` before reacting; a transient spike that is already settling is
  not a runaway.
- When the window ETA genuinely threatens the week budget, **that** is the stop
  condition — pause fan-out, let in-flight waves settle, warm a cold cache with ONE
  agent, and prefer cheap models for bulk work.

## 4. Keep the persistent session LEAN

- **Fork UI-heavy / high-turn work to sub-runners** (scenario-runner, lean-worker).
  The long session stays thin; the volatile snapshots/screenshots ride the fork's
  context, not yours.
- **Keep status TERSE.** A verbose per-turn status block re-bills every subsequent
  turn. Compressed `/distill` state lines, not paragraphs.
- **Read fixed inputs once, up front** (rules, the scenario file, the TRDD STATE
  block); never re-read them mid-watch — recall instead.

## 5. Decide fast once the key facts are in

A reversible, bounded decision (launch now vs. wait 5 min; kill a stalled fleet vs.
nudge it) does not deserve several turns of deliberation — each turn re-bills the
context. Gather the load-bearing facts, pick, move. Circling a cheap-to-reverse
call is itself a token cost.

## 6. Respect the governance boundary — some steps are the human's

A long autonomous watch still stops at the walls the rules draw:
- **External-repo releases** (merging a PR, running `publish.py`, tagging) on a
  role-plugin repo are **USER-gated** — file the PR (Method 2) and hand off; never
  merge/republish autonomously (`~/.claude/rules/how-to-fix-issues-of-other-projects.md`).
- When the critical path is blocked on such a step, **say so plainly and hold** —
  do not manufacture busywork to appear productive, and do not breach the boundary
  to close a Stop-hook loop.

## Verification that this playbook is working

On the next long watch: event-driven monitors are live from turn 1, the burn guard
was armed before the first fan-out, heartbeats produce one-line replies (no fleet
polling), status is terse, and the week-window is gated on `get_window_eta` cost —
not on raw token-rate spikes.
