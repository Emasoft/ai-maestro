---
trdd-id: 5F3490TA
title: MANAGER should delegate repo-create + branch-rules + CI + clone to the MAINTAINER, not do it inline
column: planned
created: 2026-07-23T11:15:46+0200
updated: 2026-08-16T16:48:46+0200
current-owner: session
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T11:15:46+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: []
external-refs:
  - reports/fleet-evaluation/20260723_110953+0200-scen031-fleet-behaviour-eval.md
  - tests/scenarios/SCEN-031_end-to-end-fleet-ship.scen.md
---

## Problem (eval SH-3, P2)
In SCEN-031 the MANAGER (`scen031-manager`) created the GitHub repo itself
(`gh repo create Emasoft/zipsearcher --template … --private`) and attempted the branch rulesets
inline, then assigned only the release mandate to the MAINTAINER. The scenario intends the
**MAINTAINER** to own repo creation from template + branch rules + CI + clone (its S011 role). This
is over-centralization by the MANAGER and blurs the role boundary the scenario is designed to test.

## Proposed fix (cross-repo — file an issue/PR, do NOT edit in place)
On `Emasoft/ai-maestro-assistant-manager-agent` (the MANAGER role-plugin), clarify the persona: when
a project needs a repo, the MANAGER authors a **mandate TRDD assigned to the MAINTAINER** to
create-from-template + set branch rules + wire CI + clone — rather than running `gh repo create`
itself. The MANAGER orchestrates; the MAINTAINER executes repo bootstrap.

## Verification
Re-run SCEN-031: the repo is created by the MAINTAINER (its transcript shows `gh repo create`), not
the MANAGER; role boundaries intact.

## Estimated risk
LOW. Persona-clarity change, no code.

## Acceptance
- [ ] Issue/PR filed on `Emasoft/ai-maestro-assistant-manager-agent` (never edited in-place —
      cross-repo rule) proposing the persona clarification.
- [ ] The persona text explicitly states: when a project needs a repo, the MANAGER authors a
      mandate TRDD assigned to the MAINTAINER for create-from-template + branch rules + CI +
      clone, rather than running `gh repo create` itself — the RULE half.
- [ ] Enforcement, not just wording: the MAINTAINER role-plugin's own instructions already own
      the repo-bootstrap skill (branch-protect, CI wiring) the MANAGER is being told to delegate
      to — cited by file/skill name in the PR, so the boundary is not merely stated but has
      somewhere to land.
- [ ] Re-run SCEN-031: the MAINTAINER's transcript shows `gh repo create`, not the MANAGER's.
- [ ] Upstream PR merged (or explicitly refused with a recorded reason) — this TRDD does not
      close on "PR opened" alone.

## Approval log
- 2026-07-23 — MANDATE by USER (improvement series, "you have my trust").
