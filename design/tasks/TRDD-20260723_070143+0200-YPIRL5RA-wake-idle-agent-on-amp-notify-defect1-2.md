---
trdd-id: YPIRL5RA
title: Wake an idle agent on an AMP notification — press Enter on the inbox alert, gate the sibling notify path
column: testing
created: 2026-07-23T07:01:43+0200
updated: 2026-07-23T07:07:00+0200
current-owner: session
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
relevant-rules: []
eht: []
npt: []
implementation-commits: [d7d3e712, 9d44c29c]
external-refs:
  - design/proposals/TRDD-20260723_063443+0200-4ALV5ISB-idle-agent-never-wakes-on-amp-mandate.md
  - reports/worker-wake-investigation/20260723_065318+0200-4ALV5ISB-plan.md
  - reports/scenarios-runner/SCEN-031_20260723T033213Z.report.md
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-23

**▶ CODE LANDED (`d7d3e712` DEFECT 1, `9d44c29c` DEFECT 2). Gates GREEN:** tsc 0 · vitest 226 files /
3246 passed · build clean. (Also archived the stale-in-tasks `complete` TRDD-GZ1KOHNR that the corpus linter
flagged — orthogonal housekeeping, same commit as this doc.) **NEXT (in order):** (1) refresh the INSTALLED copy
`~/.local/bin/aimaestro-hook.sh` from the repo (install-messaging.sh copies scripts/*.sh there; running agents use
the installed copy, so the repo edit is inert until refreshed). (2) EMPIRICAL: `aimaestro-hook.sh notify --cwd
<live idle agent workdir> --message test` + `tmux capture-pane` → confirm the text is now SUBMITTED (a turn begins)
— this ALSO answers whether the notification chain even fires for an ALREADY-idle agent (if it does NOT re-fire,
DEFECT 3/heartbeat is load-bearing, not optional). (3) Decide DEFECT 3 (4ALV5ISB fork) + re-run SCEN-031.

**WHY:** the harness-readiness blocker after GZ1KOHNR. SCEN-031 re-run proved the MANAGER now self-organizes a
fleet and delegates via real AMP mandates — but both worker agents NEVER WOKE to act on their inbound mandate
(0 tokens, idle 6+ min). Root cause pinpointed by a read-only investigation agent (report in external-refs).

**SCOPE OF THIS TRDD — the two BOUNDED in-repo bugfixes (DEFECT 1 + DEFECT 2). NOT the architectural fork.**
The umbrella proposal `4ALV5ISB` also carries DEFECT 3 (arm the janitor-heartbeat cron for every agent — an
architectural fork between an in-repo `AGENT_INVARIANTS` row vs a cross-repo janitor auto-arm). DEFECT 3 stays a
tier-2 proposal awaiting USER direction; this TRDD ships ONLY the two Tier-0 bugfixes.

**DEFECT 1 (load-bearing, SCEN-031-critical) — `scripts/aimaestro-hook.sh::cmd_notify()` never presses Enter.**
Line 163 built the inbox-alert command with `addNewline: false`, so `sendAgentSessionCommand` →
`runtime.sendKeys(..., { enter: false })` TYPED the `[AMP-INBOX-NOTIFICATION]` text into the idle pane but never
SUBMITTED it — no turn, so the recipient never reads its inbox. The `.cjs` message-notification hook fires this
`notify` subcommand ONLY off Claude Code's `idle_prompt`/`agent_needs_input` signal (box empty + ready), which is
exactly why `requireIdle: false` is correct here — the same pattern `drainCommandQueueForSession`
(`services/agents-core-service.ts:1658-1662`) documents: the hook-driven idle proof is stronger than the
`isSessionIdle` activity-timestamp heuristic. FIX = flip `addNewline: false → true` only; keep `requireIdle: false`.
`cmd_notify` is single-purpose (one dispatch caller, `notify)` line 196), so the blast radius is exactly the
message-notification path. Minimal, one-word, pattern-consistent.

**DEFECT 2 (adjacent safety hardening, NOT on the SCEN-031 path) — `lib/notification-service.ts::sendTmuxNotification`
has no safe-state gate.** It calls `runtime.sendKeys(..., { enter: true })` UNCONDITIONALLY, so a
governance/teams/groups/transfer notification (its ONLY reachable callers — `message-delivery.ts`, teams/groups/
governance-service, transfers; NEVER the amp-send.sh CLI filesystem path) can inject `echo '…'`+Enter into a BUSY
pane mid-turn. FIX = read `readHookNotification(agent.workingDirectory)` and SKIP the send on a KNOWN-busy
notificationType (anything other than `idle_prompt`), while FAIL-OPEN on a null/absent state file (matching the
existing convention — many agents have no hook state). Does NOT touch the SCEN-031 wake, so it is a separate commit.

**NEXT ACTION (in order):**
1. Edit DEFECT 1 (`scripts/aimaestro-hook.sh:163`) + a WHY comment; commit `fix(hook): press Enter on inbox notify …`.
2. Edit DEFECT 2 (`lib/notification-service.ts` gate) + a WHY comment; commit `fix(notify): safe-state gate …`.
3. Verify: `bash scripts/with-node.sh npx tsc --noEmit` · `bash scripts/with-node.sh yarn test` · `bash scripts/with-node.sh yarn build`.
4. EMPIRICAL: `aimaestro-hook.sh notify --cwd <a live idle agent workdir> --message test` and `tmux capture-pane`
   to confirm the text is now SUBMITTED (a fresh turn begins) — this ALSO answers the §5 open question (does the
   notification chain even fire for an already-idle agent, or is DEFECT 3/heartbeat load-bearing?).
5. Based on (4): if DEFECT 1 alone wakes an idle agent on message-arrival → DEFECT 3 is optional defense-in-depth →
   surface the fork to the USER with a recommendation, then re-run SCEN-031. If it does NOT (chain doesn't re-fire
   for an already-idle agent) → DEFECT 3 (heartbeat) is load-bearing → surface the fork as blocking.

**VERIFY:** tsc/test/build green; the empirical notify test submits a turn; SCEN-031 re-run shows workers consuming
tokens on their mandate without runner intervention.

## Problem
See DEFECT 1 / DEFECT 2 above (from the read-only investigation report, source-verified this session).

## Proposed fix
DEFECT 1: `addNewline: false → true` in `cmd_notify` (keep `requireIdle: false`). DEFECT 2: idle-gate
`sendTmuxNotification` via `readHookNotification`, fail-open on absent state.

## Verification
tsc/test/build green + an empirical notify against a live idle agent that submits a turn; then a SCEN-031 re-run.

## Estimated risk
LOW. DEFECT 1 is a one-word flip in a fire-and-forget, `--max-time`-bounded script whose only caller fires off the
idle_prompt signal. DEFECT 2 adds a gate that can only REDUCE injections (skip on known-busy), fail-open preserves
current behavior where no hook state exists.

## Approval log
- 2026-07-23 — MANDATE (standing harness-ready goal, USER). Both changes are Tier-0 in-repo bugfixes
  (min-approval-requirement: none). DEFECT 3 (the fleet-wide cron-arming fork) is NOT in this TRDD — it stays the
  tier-2 proposal 4ALV5ISB awaiting USER direction.
