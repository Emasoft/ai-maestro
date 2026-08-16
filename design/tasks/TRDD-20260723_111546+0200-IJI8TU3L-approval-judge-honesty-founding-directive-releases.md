---
trdd-id: IJI8TU3L
title: Release TRDDs derived from the founding directive must not stamp approval-judge user for a decision the USER did not individually make
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
  - rules/aimaestro/aimaestro-trdd-approval.md
---

## Problem (eval SH-5, P4)
In SCEN-031 the MANAGER's release TRDD `I11M3W33` carried `mandated-by: user`,
`min-approval-requirement: user`, `approval-judge: user` — it attributed the JUDGMENT to the USER.
This is defensible via the founding directive (the USER's one sentence named "ship a v1.0.0 release"),
but the USER never individually judged THIS TRDD. The approval-record contract's §D4 watchdog check
(`approval-judge` authority ≥ `min-approval-requirement`, judge actually decided) could read this as an
agent self-attributing USER authority — a governance-honesty hole.

## Proposed fix
Clarify in `rules/aimaestro/aimaestro-trdd-approval.md` (the approval-record section) AND the MANAGER
role-plugin persona (cross-repo → issue/PR): for a release (or any) TRDD whose authorization DERIVES
from the founding directive rather than an individual USER judgment, keep
`approval-judge` = the actual judging agent (the MANAGER) and **cite the USER directive verbatim in the
`## Approval log` body** ("authorized by the founding directive: '<quote>'"), rather than stamping
`approval-judge: user`. `mandated-by:` may still trace to `user` (the directive's origin), but the
JUDGE field records who actually judged.

## Verification
Re-run SCEN-031: the release TRDD shows `approval-judge: scen031-manager` with the USER directive
quoted in its `## Approval log`; the §D4 watchdog check passes cleanly.

## Estimated risk
LOW. Governance-honesty clarification; no behaviour change to the work itself.

## Acceptance
- [ ] `rules/aimaestro/aimaestro-trdd-approval.md` approval-record section is updated to state
      the rule explicitly: for a TRDD whose authorization DERIVES from a founding directive
      rather than an individual USER judgment, `approval-judge:` names the actual judging agent,
      never `user`.
- [ ] The rule requires the founding directive to be quoted verbatim in the TRDD's
      `## Approval log` body ("authorized by the founding directive: '<quote>'") whenever
      `approval-judge` is not `user`.
- [ ] Cross-repo issue/PR filed on `Emasoft/ai-maestro-assistant-manager-agent` clarifying the
      MANAGER persona to follow this rule (never edited in-place).
- [ ] §D4 watchdog check (`approval-judge` authority ≥ `min-approval-requirement`, judge
      actually decided) is confirmed to pass cleanly against a TRDD authored under the corrected
      convention — not merely asserted, run the check.
- [ ] Re-run SCEN-031: the release TRDD shows `approval-judge: scen031-manager` (or the actual
      agent name) with the USER directive quoted, not `approval-judge: user`.

## Approval log
- 2026-07-23 — MANDATE by USER (improvement series, "you have my trust").
