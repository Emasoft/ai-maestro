---
trdd-id: H4L3HHKX
title: Route MANAGER and worker behaviour fixes to the plugin repos
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T15:07:44+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: docs
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: route the 6 MANAGER/worker behaviour proposals surfaced by SCEN-031 to the correct plugin
repos as cross-repo GitHub issues/comments (PRRD-G1 self-identified). NEXT ACTION: execute NPT C1
(tie evidence to existing issues), then C2 (MANAGER delegation-mandate issue), then C3
(AUTONOMOUS/MAINTAINER wake-drain issue). Not started.

## Spec

- C0 (this TRDD) is the parent routing the 6 behaviour proposals to the plugin repos.
- C1 — Tie SCEN-031 evidence to the 4 existing issues. Comment on ai-maestro#51 (idle-wake=
  4ALV5ISB worker side), #90 (retry-wedge), #89 (R42=F1S7QQX6 server half), #86/#87 (MANAGER
  defects) — each with the SCEN-031 burst-1b evidence (0 AMP, workers never woken, MANAGER coded
  it itself). No duplicate issues.
- C2 — New issue on `ai-maestro-assistant-manager-agent`: the delegation mandate. On a build
  directive the MANAGER MUST — create-the-fleet-and-delegate (never solo, never Task/subagent the
  deliverable: Z1VNCV3U/F898NXLU); author requirements as a project-scope TRDD + commit+push to
  the repo BEFORE dispatch (ZTDJCNZP/BYCN5PB7); include `git clone <repo>` in the dispatch payload
  (E5518NVG); WAKE + AMP-dispatch each worker, then monitor via read-only status.
- C3 — New issue on `ai-maestro-autonomous-agent` + `ai-maestro-maintainer-agent`. On wake, drain
  the AMP inbox and act on an inbound mandate (4ALV5ISB worker side); clone the assigned repo as
  step 0 (E5518NVG). (OQIA2DCR's server `--agent`-resolution half stays an in-repo TRDD — partly
  fixed by GZ1KOHNR.)

## Acceptance

- [ ] C1: 4 comments posted (ai-maestro#51, #90, #89, #86/#87)
- [ ] C2: issue filed on `ai-maestro-assistant-manager-agent` with the 4 proposal bodies as evidence
- [ ] C3: issue(s) filed on `ai-maestro-autonomous-agent` and `ai-maestro-maintainer-agent`
- [ ] Parent C0 closed once C1, C2, C3 are terminal

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: manager). Pre-approved; born approved to author+execute.
