---
trdd-id: 1K2TZVIP
title: Enforce assignee + blocked-by + column + checklist on every TRDD with a checklist-gated completion
column: proposal
created: 2026-07-23T18:12:45+0200
updated: 2026-07-24T14:55:58+0200
current-owner: ai-maestro
task-type: docs
scope: project
min-approval-requirement: manager
priority: 1
severity: medium
effort: small
labels: [scenario-improvement, scen-031, batch-manual-harvest, governance]
external-refs: [reports/scenarios-runner/SCEN-031-phase-1_20260723T133825Z.report.md]
---

# Enforce the full field + checklist discipline on every TRDD, with a checklist-gated completion

> **USER RULING (2026-07-24) — this proposal's ORIGINAL stance was WRONG and is REVERSED.** The
> original text argued SCEN-031 should accept an `assignee`+`blocked-by` split as an *equal
> alternative to* the `column` field. The USER rejected that: *"every TRDD must have assignee,
> blocked-by (if blocked) AND column fields filled with the value. And those must be constantly
> updated at every change, along with the checklist at the bottom of every TRDD. completion only is
> possible when all checklist boxes are checked and the column is complete or deployed. not in any
> other case."* The three fields are NOT alternatives — they are all mandatory and all kept current.

## Problem

Two defects, one root:

1. **The fields are treated as substitutable.** SCEN-031's ownership check accepted a fleet that
   used `assignee`+`blocked-by` gating *in place of* per-column ownership. That is wrong: a TRDD's
   `assignee`, its `blocked-by` (whenever it is blocked), AND its `column` are all REQUIRED and must
   be kept current at every change — none stands in for another. `blocked-by` records *what gates
   this TRDD*; `column` records *where it is in the pipeline*; `assignee` records *who owns it*.
   Dropping `column` because a `blocked-by` edge exists loses the pipeline position the board reads.

2. **Completion is unenforced.** The approval ladder is advisory (ai-maestro#59): any agent can set
   `column: complete` on a TRDD whose work is not done and whose bottom checklist is unchecked.
   There is no gate asserting the terminal-column invariant.

## The ruling (what MUST hold)

- Every TRDD carries `assignee`, `column`, and — whenever it is blocked — a non-empty `blocked-by`,
  all filled and **kept current at every change**, together with the bottom `- [ ]` checklist.
- **Completion is allowed ONLY when every checklist box is `[x]` AND `column ∈ {complete, published,
  live}`.** In no other state may a TRDD be treated as done — not `dev`, not `testing`, not with an
  unchecked box.

## Proposed fix

This is an ENFORCEMENT change, implemented by **[[TRDD-UCC2QJH9]]** (Flock B):

1. **DEP overlay** — `rules/aimaestro/aimaestro-trdd-approval.md` §D4 states the invariant + makes it
   a watchdog check: (i) `assignee` present; `blocked-by` non-empty ⟺ `column: blocked`; `column` ∈
   the 17-column enum; (ii) parse the bottom checklist; (iii) terminal-column invariant above, else
   move the TRDD back and flag.
2. **The §D4 watchdog** (mechanism B is ratified — ai-maestro#59; the completion gate already landed
   in the IND base — janitor#81; the watchdog that ENFORCES it is being built — janitor#109) asserts
   the checks asynchronously, so agents are never blocked but violations are caught.

The SCEN-031 phase-file ownership check is corrected to require all three fields present+current
(NOT "either mechanism"), matching this ruling.

## Verification

- The DEP overlay §D4 lists the three checks; a `grep` confirms the terminal-column invariant wording.
- Re-run SCEN-031: a fleet is conforming only when every TRDD carries `assignee`+`column`
  (+`blocked-by` when blocked) all current, and no TRDD reaches `complete` with an unchecked box.

## Estimated risk

MEDIUM. Governance/rules + a watchdog behaviour change; it can flag previously-"passing" TRDDs that
were completed without a checked checklist — which is the intended tightening, not a regression.

## Approval log

(empty — awaiting screening)
