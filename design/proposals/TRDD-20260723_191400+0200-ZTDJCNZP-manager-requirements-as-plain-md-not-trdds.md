---
trdd-id: ZTDJCNZP
title: MANAGER writes requirements as ad-hoc markdown never as TRDDs, and never pushes them to the project repo
column: planned
created: 2026-07-23T19:14:00+0200
updated: 2026-08-21T22:02:08+0200
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:02:08+0200
current-owner: scenario-runner
task-type: bugfix
scope: project
min-approval-requirement: manager
priority: 1
severity: medium
effort: small
labels: [scenario-improvement, scen-031, phase-1, manager-behaviour, governance]
external-refs: [reports/scenarios-runner/SCEN-031-phase-1b_20260723T170147Z.report.md]
---

# Requirements should be authored as project-scope TRDDs on `main`, not local markdown

## Problem

In SCEN-031 burst 1b, the MANAGER authored three high-quality requirement documents (correct CLI
specs, correct stdlib-only / no-decompression constraints, etc.) for zipsearcher, tarot-reader, and
weather-reporter. But it wrote them as plain markdown at
`~/agents/scen031-manager/design/specs/<name>.md` — not as TRDDs (no frontmatter, no `column:`),
not git-tracked (the MANAGER's workdir isn't even a git repo), and never pushed to any of the three
project repos. A worker waking in `~/agents/zipsearcher-dev/` would find nothing but the scaffolded
`CLAUDE.md` — not even a clone of the repo, let alone the spec.

## Root cause

The MANAGER role-plugin's persona has no explicit instruction to author requirements as project TRDDs
inside the TARGET repo (`design/tasks/` or `design/proposals/` per the tier), commit, and push to
`main` before considering a project "specified". Writing a local scratch file satisfies its own
planning need but produces nothing durable or shareable.

## Proposed fix

Cross-repo issue on `Emasoft/ai-maestro-assistant-manager-agent`: the persona's "define
requirements" step should end with: (1) clone or otherwise touch the target repo, (2) write the
requirements as a project-scope TRDD under that repo's `design/tasks/` (mandate-tier, since the
MANAGER's own authority already satisfies the approval — see `aimaestro-trdd-approval.md`
"Mandate TRDDs"), (3) commit + push to `main` BEFORE dispatching any worker (this is also the
precondition TRDD-BYCN5PB7 already requires — landing the NPT on `main` before dispatch is
meaningless if the NPT was never written as a TRDD in the first place).

## Verification

Re-run SCEN-031 burst 2a/3: each project's repo, at `design/tasks/TRDD-*.md`, carries the
requirements with correct v2 frontmatter, on `main`, before any worker session is woken.

## Estimated risk

LOW. Plugin-side persona/prompt change only; no schema or API change required.

## Approval log

- 2026-08-21T22:02:08+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager).
  Re-measured: the closed `ai-maestro-assistant-manager-agent#32`/`PR#33` fix landed the NPT-ordering
  and repo-delegation halves only; neither the closed issue's body nor the live persona's PROJECT
  BOOTSTRAP section instructs the MANAGER to author requirements AS a project-scope TRDD under
  `design/tasks/` rather than ad-hoc markdown. The specific defect this card names is unaddressed.
