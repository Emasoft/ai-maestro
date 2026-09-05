---
trdd-id: U1EYWIPT
title: Nothing evaluates blocker-probe — validate must run the probes and report BLOCKER-RELEASED, never silence
column: todo
created: 2026-09-05T11:37:21+0200
updated: 2026-09-05T11:37:23+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: infra
min-approval-requirement: none
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-05T11:37:21+0200
---

# Nothing evaluates blocker-probe — validate must run the probes and report BLOCKER-RELEASED, never silence

Nothing evaluates `blocker-probe:` / `blocker-holds-if:`. Measured 2026-09-05: lib/trdd-doctor.ts:1056-1065 checks only that a parked card CARRIES a probe and that `blocker-holds-if` is one of exit-0 | exit-nonzero | match: | not-match: (BLOCKED-WITHOUT-PROBE, BLOCKER-PROBE-BAD-PREDICATE); no `execSync`/`spawn` in lib/ or scripts/ runs a probe; the janitor 3.4.14 scripts contain no reference to the field at all — its trdd-drift evaluates the IND `unblock-when:` predicates instead. So the 23 parked cards that carry probes today (`grep -l '^blocker-probe:' design/tasks/*.md`) release only when a human notices: DQVPODKW was released by a hand `set blocked-by` after 1LFRP6GJ closed, and U6AS2YWB's probe (052524f9) can never fire. A probe nobody runs is a value wearing a predicate's field — the exact defect the doctor's own message warns about. Fix, in-repo, in the tool the cards are lint-gated by: `trddgrep validate` (and `next`) runs each blocked card's `blocker-probe` with cwd = the design root's repo, a 10 s timeout and no network, applies `blocker-holds-if`, and when the predicate NO LONGER HOLDS reports **BLOCKER-RELEASED** as an ERROR-level finding naming the card and its `pre-block-column` — it never auto-moves (a release is a decision the owner records). A probe that cannot run reports **PROBE-FAILED** (fail-OPEN: the card stays blocked) — never silence, because silence is how a stale probe reads as current.

## Acceptance

- [ ] `trddgrep validate` runs every blocked card's probe and reports BLOCKER-RELEASED for a fixture whose probe output makes its `blocker-holds-if` false, naming the restore column
- [ ] a probe that exits non-zero for a reason other than its predicate, times out, or is absent reports PROBE-FAILED and the card stays blocked (fail-open pinned by a test)
- [ ] a test pins both findings and a recorded neuter (skip the run) reddens exactly those tests
- [ ] the 23 live probes run under the new pass with zero PROBE-FAILED, or every failing one is listed here with its card id

## Approval log

- 2026-09-05T11:37:21+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:37:23+0200 — column → todo by manager. Tier 0 tool work: the drain rule's self-releasing park is fiction until something runs the probes. Authorization: USER /goal 2026-09-05.
