---
trdd-id: S97TNMIJ
title: Lessons harvest — the 2026-08-18 Phase-2 orchestration day, annotated and converted per USER directive
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-18T20:19:21+0200
updated: 2026-08-18T20:19:21+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: low
effort: S
labels: [lessons, docs, TRDD-BRRJK57P]
external-refs: [TRDD-BRRJK57P]
---

# Lessons harvest — 2026-08-18 orchestration day

USER directive (verbatim, mid-turn 2026-08-18): *"remember to annotate every lesson learned and
convert them into TRDDs"*. This card is the conversion for the hub's four NEW lessons of the day;
lessons already present in the corpus were not duplicated. Fleet sessions were told the same
directive rides every future hub dispatch.

## The four lessons (full text landed in `.claude/rules/lessons-verification.md`, same commit)

1. **A hand-kept "who has reported" roster goes stale silently** — the janitor sat "outstanding"
   42 h with 7 reports on disk; derive membership from `find` at read time. → also corrected in
   BRRJK57P's STATE (committed 6969ac3c).
2. **A needle built from the contract's vocabulary cannot count the artifact** — `CONFIRMED` ×0
   across 9 files saying `Confirmed:`, then the heading form missed too; read one artifact first,
   then positive-control the count on it.
3. **Ancestry is not shipment — a revert is also an ancestor**; prove shipment against the
   released TREE, never the log. (Blocked a wrong 8-card flip in the programmer repo.)
4. **A declaration consumed widen-only is not a setting** — a below-default bound is ignored by
   design; the mirror doc row that recorded it as effective is corrected in the same commit.

## Acceptance

- [x] All four lessons appended to `.claude/rules/lessons-verification.md` (verified: append ran,
      file now carries them at the tail).
- [x] The one lesson that falsified a shipped doc (widen-only) has its doc corrected in the same
      commit (`docs/claimed-chores-contract.md` github-config-audit row).
- [x] This card cites the incidents' cards/commits so the backtrack chain holds.
- [x] Wikimem harvest: routed to the janitor's memory-harvest chore (its owned mechanism) rather
      than hand-authoring pages — the chore reads the lessons file and the ledger; nothing further
      owed here.

## Approval log

- 2026-08-18T20:19:21+0200 — MANDATE issued by the USER (mid-turn directive quoted above).
  Authored, executed and closed in one commit; Tier 0 docs work in this repo.
