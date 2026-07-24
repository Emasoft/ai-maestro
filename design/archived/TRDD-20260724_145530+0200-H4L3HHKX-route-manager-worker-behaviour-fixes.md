---
trdd-id: H4L3HHKX
title: Route MANAGER and worker behaviour fixes to the plugin repos
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T16:00:53+0200
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
repos as cross-repo GitHub issues/comments (PRRD-G1 self-identified). **DONE 2026-07-24** — column
`complete`. C1 = 3 evidence/cross-link comments (ai-maestro#51, #89, #90); #86/#87 skipped (no
fresh SCEN-031 evidence this run — the re-run showed the MANAGER coordinating correctly, so a
"burst-1b" comment there would be noise). C2 = no new issue; ai-maestro-assistant-manager-agent#32
already carries the full evidence (dispatch-precondition BYCN5PB7 + delegate-repo-bootstrap
5F3490TA) and #34 digests the NORMATIVE overlay enforcement — dedup, not a dropped task. C3 = 2
worker-side issues filed: ai-maestro-autonomous-agent#17 + ai-maestro-maintainer-agent#33 (drain
AMP inbox on wake + clone/bootstrap repo step 0). All routing delivered; the plugin-side FIXES now
live on the plugin repos, out of this TRDD's scope.

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

- [x] C1: 3 evidence/cross-link comments posted — ai-maestro#51 (idle-wake AMP-inbox), #89 (R42
  403 fan-out), #90 (retry-wedge server-impl cross-link). #86/#87 deliberately SKIPPED — no fresh
  SCEN-031 evidence this run; a comment there would be noise, not a finding.
- [x] C2: no new issue needed — ai-maestro-assistant-manager-agent#32 already carries the full
  SCEN-031 evidence (BYCN5PB7 sequencing + 5F3490TA delegation) and #34 digests the NORMATIVE
  overlay enforcement. Duplicate avoided per the dedup discipline.
- [x] C3: 2 worker-side issues filed — ai-maestro-autonomous-agent#17 + ai-maestro-maintainer-agent#33
  (drain AMP inbox on wake + clone/bootstrap the assigned repo as step 0).
- [x] Parent C0 terminal — all routing delivered; plugin-side fixes tracked on the plugin repos.

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: manager). Pre-approved; born approved to author+execute.
- 2026-07-24T16:00:53+0200 — COMPLETED by ai-maestro. All 3 sub-tasks terminal (3 comments + 2 new worker-side issues; C2 satisfied by existing #32/#34). Routing delivered; column → complete.
