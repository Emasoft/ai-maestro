---
trdd-id: E5518NVG
title: Newly created worker agents have no clone of their assigned repo in their workdir
column: proposal
created: 2026-07-23T19:14:00+0200
updated: 2026-07-23T19:14:00+0200
current-owner: scenario-runner
task-type: bugfix
scope: project
min-approval-requirement: manager
priority: 1
severity: medium
effort: small
labels: [scenario-improvement, scen-031, phase-1, manager-behaviour, agent-lifecycle]
external-refs: [reports/scenarios-runner/SCEN-031-phase-1b_20260723T170147Z.report.md]
---

# A worker created to build project X starts with no clone of X's repo

## Problem

In SCEN-031 burst 1b, all six worker agents (`zipsearcher-dev`, `zipsearcher-maint`,
`tarot-reader-dev`, `tarot-reader-maint`, `weather-reporter-dev`, `weather-reporter-maint`) were
created via the standard Agent Creation Wizard/pipeline and, at the time of verification, their
working directories (`~/agents/<name>/`) contained only the scaffolded `CLAUDE.md` — no git clone
of the GitHub repo the agent exists to build. Even if a worker session were woken right now, its
first action would have to be "find out which repo I own and clone it" — information which, per
the companion finding TRDD-Z1VNCV3U, was never even sent to it via AMP.

## Root cause

Neither `CreateAgent` (the wizard pipeline, `services/element-management-service.ts`) nor the
MANAGER's own worker-creation step performs a `git clone <repo>` into the new agent's workdir when
the worker's whole purpose (as named by the MANAGER) is to build a specific, already-created repo.
This is a gap regardless of whose "job" cloning is — currently nobody's.

## Proposed fix

Two independent, complementary fixes (either alone helps; both together closes the gap):

1. **Dispatch-side (MANAGER persona, cross-repo on `ai-maestro-assistant-manager-agent`):** when
   the MANAGER's dispatch message wakes a worker, the dispatch payload (or a first NPT the worker
   executes) should include `git clone <repo-url> .` (or into a named subdir) as step 0.
2. **Platform-side (this repo, optional convenience):** consider whether `CreateAgent` should accept
   an optional `cloneRepo: <url>` field so a worker created explicitly "to build X" starts with X
   already checked out — mirroring the existing `allowExternalFolder` adoption path but for a fresh
   clone rather than an existing local folder.

Given the MANAGER already has the target repo URL at creation time (it just created the repo), (1)
is the higher-leverage fix and should land first; (2) is a nice-to-have platform capability.

## Verification

Re-run SCEN-031 burst 2a/3: after a worker's first wake, `~/agents/<worker>/.git` exists and
`git remote -v` points at the correct `Emasoft/<project>` repo.

## Estimated risk

LOW for (1) (persona-only change). LOW-MEDIUM for (2) (touches `CreateAgent` schema/pipeline;
would need its own TRDD and MANAGER-tier review since it changes agent-creation semantics).

## Approval log

(empty — awaiting screening)
