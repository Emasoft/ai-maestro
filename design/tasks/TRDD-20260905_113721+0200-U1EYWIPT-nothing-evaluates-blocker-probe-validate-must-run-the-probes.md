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

Nothing evaluates `blocker-probe:` / `blocker-holds-if:`. Measured 2026-09-05: lib/trdd-doctor.ts:1056-1065 checks only that a parked card CARRIES a probe and that `blocker-holds-if` is one of exit-0 | exit-nonzero | match: | not-match: (BLOCKED-WITHOUT-PROBE, BLOCKER-PROBE-BAD-PREDICATE); no `execSync`/`spawn` in lib/ or scripts/ runs a probe; the janitor 3.4.14 scripts contain no reference to the field at all — its trdd-drift evaluates the IND `unblock-when:` predicates instead. So the 23 parked cards that carry probes today release only when a human notices: DQVPODKW was released by a hand `set blocked-by` after 1LFRP6GJ closed, and U6AS2YWB's probe (052524f9) can never fire. SECURITY RULING (this card's first draft, same day): the doctor must NOT execute the stored `sh -c` strings — frontmatter is git-tracked and agent-writable, so running it from `validate` is arbitrary command execution for everyone who lints, including CI, the janitor heartbeat and cloners of this PUBLIC repo. The probes stay lint-only documentation. The evaluator is DECLARATIVE: for every `blocked` card with a non-empty `blocked-by`, resolve each id through findTrdd (all four zones, prefix and case insensitive); when EVERY blocker resolves to a terminal-done column, report **BLOCKER-RELEASED** (ERROR) naming the card, the terminal blockers and its `pre-block-column` (or "no restore point"); a blocker that does not resolve reports **BLOCKER-UNRESOLVED** (WARN) and the card stays blocked (fail-open). Never auto-move — a release is a decision the owner records. 21 of the 23 live probes compute exactly this predicate in shell; the declarative form covers them without executing anything.

## Acceptance

- [ ] `trddgrep validate` reports BLOCKER-RELEASED for a fixture blocked card whose every `blocked-by` id resolves to a terminal-done column, naming the restore column, without spawning any process
- [ ] a `blocked-by` id that resolves to nothing reports BLOCKER-UNRESOLVED and the card stays blocked (fail-open pinned by a test); a still-open blocker reports nothing
- [ ] a test pins both findings and a recorded neuter (skip the evaluation) reddens exactly those tests; no code path in the doctor executes `blocker-probe` (grep-pinned)
- [ ] the live corpus validate lists every currently-releasable parked card, and the coordinator releases each by hand (`trddgrep move <id> <pre-block-column>`) or records why not

## Approval log

- 2026-09-05T11:37:21+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:37:23+0200 — column → todo by manager. Tier 0 tool work: the drain rule's self-releasing park is fiction until something runs the probes. Authorization: USER /goal 2026-09-05.
