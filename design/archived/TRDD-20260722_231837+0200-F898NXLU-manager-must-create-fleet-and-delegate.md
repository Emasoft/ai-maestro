---
trdd-id: F898NXLU
title: MANAGER role-plugin must mandate create-the-fleet-and-delegate, never build solo with vanilla subagents
column: cancelled
created: 2026-07-22T23:18:37+0200
updated: 2026-08-21T22:36:05+0200
current-owner: scenario-runner
task-type: bugfix
min-approval-requirement: manager
priority: 0
severity: high
effort: medium
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:36:05+0200
labels: [scenario-improvement, scen-031, manager-role-plugin, cross-repo]
external-refs:
  - reports/scenarios-runner/SCEN-031_20260722T203644Z.report.md
  - https://github.com/Emasoft/ai-maestro-assistant-manager-agent
---

## UPDATE 2026-07-23 (SCEN-031 re-run) — largely RESOLVED by TRDD-GZ1KOHNR

The prior FAIL was caused by the launch chokepoint dropping `--agent`, so the MANAGER ran as
GENERIC `claude` with no persona and built solo. With TRDD-GZ1KOHNR live (commits eff07647 +
2bd8969c), the SCEN-031 re-run showed the OPPOSITE behavior: the MANAGER persona loaded (live
process `claude --agent ai-maestro-assistant-manager-agent-main-agent`, banner confirms), and
it CREATED an AUTONOMOUS + a MAINTAINER agent and DELEGATED via real AMP mandates — exactly what
this proposal asked for. The solo-build regression is not reproduced. The residual concern is
narrower and now split off: the MANAGER front-loaded the MAINTAINER's repo-creation job itself
(created the repo before the agents existed) rather than delegating it — a role-plugin
labour-division nuance, not a solo build. The NEW blocker is downstream (workers never wake on
the AMP mandate — see TRDD-4ALV5ISB). Recommend screening this toward the narrower nuance or
closing it as superseded by GZ1KOHNR + 4ALV5ISB.

## Problem

SCEN-031 gave a freshly Wizard-created MANAGER (`scen031-manager`) ONE directive — "build me a
CLI tool `zipsearcher` ... create an autonomous developer agent and a maintainer agent ... use
GitHub with PR review ... ship a v1.0.0 release, from template `fannijako/repo_template`" — then
stopped driving. The MANAGER booted correctly (live Opus 4.8 REPL, MANAGER title, role-plugin +
core installed, governance rules loaded). But it then built the software **solo**:

- wrote NO requirements TRDD in its design tree;
- created ZERO ai-maestro AUTONOMOUS / MAINTAINER worker personas (registry diff: only the
  MANAGER was new-live);
- created `Emasoft/zipsearcher` **itself** (from the template) and cloned it into its OWN workdir;
- built it with **vanilla Claude Code subagents** (pane: "I'll dispatch a worker", "← 2 agents",
  "Waiting for 1 background agent to finish", "I'll report when the release is cut").

The MANAGER→AUTONOMOUS→MAINTAINER fleet never formed; there was no AMP delegation, no shared
`design/` kanban board, no cross-agent PR review loop. This defeats the entire fleet-autonomy
premise (R6/R9 and the manager-gated governance model).

## Root cause

Two contributing causes:

1. **Launch drops `--agent` (ai-maestro server / sessions-service — same-repo).** The registry
   `programArgs` for the MANAGER is `--agent ai-maestro-assistant-manager-agent-main-agent
   --dangerously-skip-permissions`, but the actual launched process (verified via `ps`) is
   `claude --dangerously-skip-permissions`. So the role-plugin **main-agent persona is not the
   active agent** — the generic claude agent runs instead, with governance rules + skills but not
   the MANAGER behavioral system prompt. (Tracked as SCEN-031 BUG-001.)

2. **The MANAGER persona (SEPARATE repo `Emasoft/ai-maestro-assistant-manager-agent`) does not
   forcefully mandate delegation.** Even the governance rules that ARE loaded describe approval
   tiers/comm-graph but do not strongly instruct "you are a MANAGER: when the user asks for
   software, create the AUTONOMOUS developer + MAINTAINER personas via `aimaestro-agent.sh` (the
   `ai-maestro-agents-management` skill) and delegate via AMP — NEVER do the dev work yourself
   with Claude Code Task subagents." A generic agent, absent that mandate, defaults to building
   the tool itself.

Per `~/.claude/rules/how-to-fix-issues-of-other-projects.md`, the persona fix lives in a
DIFFERENT repo and must be filed as a proposal/issue, not an in-repo edit here.

## Proposed fix

- **(a) MANAGER role-plugin persona** — file an issue / PR on
  `Emasoft/ai-maestro-assistant-manager-agent` (`agents/ai-maestro-assistant-manager-agent-main-agent.md`):
  add an explicit, top-of-persona operating mandate: on a software-build directive, the MANAGER
  MUST (1) author the requirements as a TRDD, (2) CREATE the AUTONOMOUS developer + MAINTAINER
  personas via the `ai-maestro-agents-management` skill / `aimaestro-agent.sh` (never native
  Claude Code subagents for the build), (3) delegate via AMP and monitor via status verbs, (4)
  NEVER create the repo or write the code itself — that is the AUTONOMOUS/MAINTAINER's job.
  Add an explicit anti-pattern: "Do NOT use the Task/subagent tool to build the deliverable."
- **(b) ai-maestro server (this repo)** — investigate why the configured `--agent` flag is dropped
  from the launched command (BUG-001). Either honor it (so the persona loads) or, if local-scope
  `--agent` is deliberately omitted, ensure the persona is delivered another way (e.g. seed the
  MANAGER main-agent persona into the workdir `CLAUDE.md` at create time so it loads every turn
  regardless of `--agent`). Files to inspect: `services/sessions-service.ts` (programArgs
  sanitize/build ~line 1090-1099), `lib/agent-runtime.ts` (getForegroundCommand / launch).

## Verification

Re-run SCEN-031 through S008: after the one directive, `GET /api/agents` must show two NEW
personas with `governanceTitle` `autonomous` and `maintainer` (created BY the MANAGER), a
requirements TRDD must appear, and the MANAGER pane must show `aimaestro-agent.sh`/AMP delegation
rather than "dispatch a worker / background agent". The repo must be created by the MAINTAINER,
not the MANAGER.

## Estimated risk

MED. (a) is a persona-doc change in an external repo (low code risk, needs republish so the
Wizard installs the updated persona). (b) touches the launch path — must not regress the
"bare-shell on unresolved `--agent`" failure mode seen in earlier runs; pair the persona-via-CLAUDE.md
approach with keeping the REPL boot intact. Depends on: `ai-maestro-assistant-manager-agent`
maintainer accepting the persona change.

## Approval log

- 2026-08-21T22:36:05+0200 — CANCELLED by ai-maestro-hub-session (min-approval-requirement: manager). Re-measured: this card's own body already recorded (b) as largely resolved by TRDD-GZ1KOHNR. Confirmed: GZ1KOHNR is `column: complete`, fixed the launch chokepoint (implementation-commits eff07647, 2bd8969c) and was verified live in the SCEN-031 re-run — the MANAGER's persona loads and it self-organized a real fleet. (a), the external-repo persona-mandate change, was routed (not re-proposed here) by TRDD-H4L3HHKX (`column: complete`): `ai-maestro-assistant-manager-agent#32` and `#34` already carry the SCEN-031 evidence + normative delegation-mandate enforcement, so no duplicate issue was filed (dedup, per that card's own C2 disposition). The residual downstream gap this card flagged (workers never waking on the AMP mandate) is tracked separately at TRDD-4ALV5ISB, not by this proposal. Superseded, not declined.
