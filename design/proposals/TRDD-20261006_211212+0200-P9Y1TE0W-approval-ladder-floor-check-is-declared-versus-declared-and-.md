---
trdd-id: P9Y1TE0W
title: Approval ladder floor check is declared-versus-declared and the sweep is unscheduled
column: proposal
status: proposed
created: 2026-10-06T21:12:12+0200
updated: 2026-10-06T21:23:30+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
priority: 0
severity: high
---

# Approval ladder floor check is declared-versus-declared and the sweep is unscheduled

## Problem
Issue 59 premise (no section D4 watchdog exists) is stale: lib/trdd-doctor.ts implements most of it. The bypass the issue was filed about is still live. MANDATE-FORGED compares mandated-by against min-approval-requirement, both read from the card's own frontmatter, so a card that understates its own floor and self-issues a mandate (floor none, mandate true, mandated-by self) passes clean. The objective-floor half (section D3, recomputed from what the change touches) is absent, and trdd-doctor runs only when a human types it: it is in package.json scripts and in no workflow or githook.
CORRECTION 2026-10-06 (verified in code): the objective floor and the schedule both EXIST. lib/trdd-watchdog.ts computes the D3 floor from the changed paths of implementation-commits (pathFloor, 3P-ZON-11) and emits MANDATE-FORGED / MANDATE-BELOW-OBJECTIVE-FLOOR against it; lib/trdd-watchdog-scheduler.ts runs the sweep every 6 h from server.mjs (AIM_TRDD_WATCHDOG_INTERVAL_MS, 0 disables). Only lib/trdd-doctor.ts MANDATE-FORGED is declared-versus-declared. Asks (1) to (3) are therefore largely delivered (archived AYBAMFN2, TGNU1EP7, 8F8PJEXI); what may remain is that the DOCTOR's own check, which gates commits, still compares declared to declared, and whether the sweep reaches a card with no implementation-commits yet.
## Current open ask
Model B was ratified (files are the single source of truth plus async audit; the aimaestro-trdd.sh write verbs are correctness wrappers with no authority meaning). The watchdog build was assigned to the janitor as ai-maestro-janitor issue 109. What remains on this repo per the hub comment of 2026-08-21: (1) derive the objective floor from the changed paths of the commits that cite the TRDD in implementation-commits, retrospectively, so it needs no author cooperation; (2) feed that floor into the MANDATE-FORGED comparison in place of the declared floor; (3) schedule the sweep so it runs without a human typing it, janitor heartbeat versus server being the open placement question. The issue stays open until the sweep runs.
SURVIVING ASK (2026-10-06, verified in code): only the commit-gating doctor remains declared-versus-declared — lib/trdd-doctor.ts:1426-1444 compares mandated-by to the card's own min-approval-requirement; the objective floor lives only in lib/trdd-watchdog.ts (content floor :294, path floor from implementation-commits :365-382), and the commit-path half is retrospective by design (:362 'no commits, no finding'), so a mandate card with no implementation-commits yet is checked against content signals only. Priority stays 0.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 59: only archived cards 8F8PJEXI and TGNU1EP7; live 2LIS20K1 is issue 47. A grep of design/tasks and design/proposals for watchdog, MANDATE-FORGED and objective floor found no live card tracking this.
## Acceptance
- [ ] Objective floor derived from commits citing the card and used by MANDATE-FORGED
- [ ] The seeded bypass shape (floor none, mandate true, mandated-by self, diff touching a manager-floor path) is reported, with a neuter run
- [ ] The sweep is scheduled and its placement decision recorded
external-refs: Emasoft/ai-maestro issue #59 (https://github.com/Emasoft/ai-maestro/issues/59)
- [ ] trddgrep validate rejects an illegal mandated-by value (none is not a title; legal: self or a governance title) — seen on SZZTVPJF

## Approval log
