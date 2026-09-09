---
trdd-id: 8L6GZOSE
title: Log each alternate's own model-scoped percent on the SCOPED-WALL verdict line
column: todo
created: 2026-09-09T12:28:26+0200
updated: 2026-09-09T12:35:33+0200
current-owner: governance-rules-session
created-by: governance-rules-session
task-type: feature
min-approval-requirement: none
assignee: governance-rules-session
mandate: true
mandated-by: none
approved: true
approval-judge: governance-rules-session
approval-datetime: 2026-09-09T12:28:26+0200
---

# Log each alternate's own model-scoped percent on the SCOPED-WALL verdict line

## Problem
Follow-up from TRDD-271764MC box 7. lib/oauth-rotator/tick.ts:1141 builds `liveDesc` from the LIVE account's windows plus ` +SCOPED-WALL`, but the alternates' own model-scoped percents — the values the rotation veto reads at tick.ts:1242 via `scopedVetoPct(...)` into `isSafeAlternate` (tick.ts:530, `scoped < SAFE_SCOPED`), and that tick.ts:691 reads a second time as a headroom check — never reach the log. A trace like the 2026-09-06 evidence in TRDD-271764MC therefore cannot show whether SAFE_SCOPED at 95 (vs the old 90) would have admitted an alternate: the veto's inputs are invisible.
ASSUMPTION to verify at verify_assumptions: the alternate loop near tick.ts:1242 emits no per-alternate scoped reading today (not read when filed; line numbers as of d1029a53).
## Proposed fix
On a tick whose verdict carries SCOPED-WALL, log one line per alternate `alt=<account> scoped=<model>@<pct>% verdict=safe|vetoed(SAFE_SCOPED=<n>)`, using the same values the veto reads — no second measurement, no change to the veto. Omit the line when the tick is not a SCOPED-WALL (log volume).
## Acceptance
- [ ] on a SCOPED-WALL tick the log names every alternate with its scoped model, percent and safe/vetoed verdict (one test; neuter: drop the percent from the format string → that test reds)
- [ ] on a non-SCOPED-WALL tick no per-alternate scoped line is emitted (one test)
- [ ] the veto's behaviour is unchanged: the rotator suites matching isSafeAlternate or planModelFallback stay green, `tsc --noEmit` prints 0 lines

## Approval log

- 2026-09-09T12:28:26+0200 — MANDATE issued by governance-rules-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-09T12:35:33+0200 — post-write review (fork, 0 tools) record-only findings: (a) frontmatter carries mandated-by: none as trddgrep new wrote it; the aimaestro-trdd-approval overlay names self for a tier-none self-mandate — tool-owned value, left as written, D4 ladder evaluates none >= none true; (b) the Problem's 'never reach the log' asserts what the ASSUMPTION line disclaims — resolve at verify_assumptions by reading the loop near tick.ts:1242, not before.
