---
trdd-id: N33FVBSZ
title: MAINTAINER branch-protection fallback when GitHub rulesets 403 on a private/free-plan repo
column: planned
created: 2026-07-23T11:15:46+0200
updated: 2026-08-16T16:48:46+0200
current-owner: session
task-type: feature
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

## Problem (eval SH-4, P3)
In SCEN-031 the `baseline-history-protect` ruleset attempt **403'd** ("Upgrade to GitHub Pro") because
`Emasoft/zipsearcher` is PRIVATE on a plan without repo rulesets. `main` ended with **no enforced
branch protection**, and no fallback landed — so the ratified "PRs gated on green CI / no force-push /
no delete" floor was silently skipped. Partly a GitHub-plan limitation, but left unresolved.

## Proposed fix (cross-repo — file an issue/PR on the MAINTAINER role-plugin / its branch-protect skill)
When applying the branch-protection baseline returns 403 due to plan limits, the MAINTAINER must NOT
silently skip the floor. It must either:
1. fall back to **classic branch protection** (the older API that works on private/free repos), OR
2. record the gap explicitly AND author a mandate TRDD to make the repo **public before the release**
   (so rulesets become available), surfacing the decision rather than shipping unprotected.

## Verification
Re-run SCEN-031 on a private repo: the maintainer either applies classic protection or records the gap
+ a public-before-release mandate; the floor is never silently absent.

## Estimated risk
LOW. Additive fallback; does not weaken the baseline where rulesets ARE available.

## Acceptance
- [ ] Issue/PR filed on the MAINTAINER role-plugin repo (its branch-protect skill), never
      edited in-place, proposing the 403-fallback behaviour.
- [ ] The fallback logic is specified: on a 403 from the ruleset API due to plan limits, the
      MAINTAINER either (a) applies classic branch protection via the older API, or (b) records
      the gap explicitly and authors a mandate TRDD proposing the repo go public before release.
- [ ] The floor is never silently skipped — a 403 always produces EITHER an applied classic
      protection OR a recorded gap + mandate TRDD, verifiable by grepping the MAINTAINER's own
      run output/logs for one of the two outcomes.
- [ ] Existing baseline behaviour is unchanged where rulesets ARE available (additive fallback
      only, verified by re-running the baseline apply on a repo with ruleset support).
- [ ] Re-run SCEN-031 on a private repo: the maintainer either applies classic protection or
      records the gap + public-before-release mandate — main never ends with zero enforced
      protection and no record.

## Approval log
- 2026-07-23 — MANDATE by USER (improvement series, "you have my trust").
