---
trdd-id: 5F3490TA
title: MANAGER should delegate repo-create + branch-rules + CI + clone to the MAINTAINER, not do it inline
column: planned
created: 2026-07-23T11:15:46+0200
updated: 2026-09-05T18:59:14+0200
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
created-by: session
assignee: ai-maestro-hub-session
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
- [x] Issue/PR filed on `Emasoft/ai-maestro-assistant-manager-agent` (never edited in-place —
      cross-repo rule) proposing the persona clarification.
- [x] The persona text explicitly states: when a project needs a repo, the MANAGER authors a
      mandate TRDD assigned to the MAINTAINER for create-from-template + branch rules + CI +
      clone, rather than running `gh repo create` itself — the RULE half.
- [x] Enforcement, not just wording: the MAINTAINER role-plugin's own instructions already own
      the repo-bootstrap skill (branch-protect, CI wiring) the MANAGER is being told to delegate
      to — cited by file/skill name in the PR, so the boundary is not merely stated but has
      somewhere to land.
- [ ] Re-run SCEN-031: the MAINTAINER's transcript shows `gh repo create`, not the MANAGER's.
- [x] Upstream PR merged (or explicitly refused with a recorded reason) — this TRDD does not
      close on "PR opened" alone.

## Approval log
- 2026-07-23 — MANDATE by USER (improvement series, "you have my trust").
- 2026-09-05 — close-out verification: box1 PROVEN (issue #32 + PR #33 exist and closed, verified via gh api); box2 PROVEN (persona file on Emasoft/ai-maestro-assistant-manager-agent main line ~810/813 states the MANAGER-mandates-MAINTAINER rule, verified via gh api contents fetch); box3 PROVEN (MAINTAINER role-plugin skills `workflow-bootstrap` (CI wiring + stashes branch-ruleset specs) and `workflow-protect-branch` (applies branch rulesets) cited by exact name via gh api repos/Emasoft/ai-maestro-maintainer-agent/contents/skills); box4 NOT PROVEN (no SCEN-031 re-run report exists after the fix landed (created 2026-07-23T11:15:46+0200); latest reports checked — SCEN-031-phase-1_20260723T133825Z, -phase-1a_20260723T163953Z, -phase-1b_20260723T170147Z — contain zero mentions of `gh repo create` by either agent; the only hit for that phrase is in the 2026-07-22T20:12:34Z pre-fix report and describes the capability as unobservable, not demonstrated); box5 PROVEN (PR #33 was not merged (mergedAt: null) but closed as "superseded" with a recorded reason on 2026-08-05 — the fix landed directly as commit c24e00b, independently re-verified via gh api compare/c24e00b...main = status ahead, ahead_by 137, behind_by 0, i.e. c24e00b is an ancestor of main). 4/5 boxes ticked; box4 left unchecked pending an actual SCEN-031 re-run.
- 2026-09-05 — precision on the box4 verdict above: "no SCEN-031 re-run report exists" should read "none found under reports/ and reports_dev/ on this host" — reports/scenarios-runner and reports_dev/scenarios-runner are gitignored, so a run on another host or a later day is invisible to this search; box4 stays unchecked either way since no such evidence is present here. Box3's tick is grounded in naming workflow-bootstrap and workflow-protect-branch from the MAINTAINER repo's own skills/ listing (per gh api repos/Emasoft/ai-maestro-maintainer-agent/contents/skills), not from the compare-status check. Box5's tick is grounded in PR #33's own closing comment recording a reason (closed as superseded), not from the compare-status check; the compare check only independently corroborated issue #32's claim that commit c24e00b landed on main.
