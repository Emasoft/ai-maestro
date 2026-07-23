---
trdd-id: 1K2TZVIP
title: SCEN-031 should accept blocked-by/assignee gating as an equal alternative to column-ownership fields
column: proposal
created: 2026-07-23T18:12:45+0200
updated: 2026-07-23T18:12:45+0200
current-owner: scenario-runner
task-type: docs
scope: project
min-approval-requirement: manager
approval-tier: 2
priority: 3
severity: trivial
effort: small
labels: [scenario-improvement, scen-031, batch-manual-harvest]
external-refs: [reports/scenarios-runner/SCEN-031-phase-1_20260723T133825Z.report.md]
---

# Recognize blocked-by gating as a valid column-ownership design

## Problem

SCEN-031 phase 1 (`S008b`) expects the MANAGER to split work into TRDDs with **column-level
ownership fields** ("AUTONOMOUS: todo/dev/testing; MAINTAINER: ai_review/human_review/publish").
The fleet instead produced two TRDDs with an **`assignee` split + `blocked-by` gate**: the dev
owns the implementation TRDD (`release-via: publish`), the maintainer owns a separate audit/review
TRDD, and the maintainer's TRDD gates the dev's via `blocked-by`.

This achieves the identical functional goal — clear, non-siloed ownership with the maintainer
gating the release — through a different, equally-valid mechanism. The phase file's own text
anticipates this ("the sensible split is what a correct fleet arrives at on its own"), yet its
literal verification criteria describe only the column-field mechanism, so a strict reading would
flag a correct fleet as non-conforming.

## Root cause

The verification criteria encode ONE implementation of "ownership + release gate" (column fields
on a single TRDD) as if it were the requirement, when the actual requirement is the outcome
(non-siloed ownership, maintainer gates release). TRDD-level `blocked-by` between two assigned
TRDDs is a legitimate second implementation and is arguably cleaner (one concern per TRDD).

## Proposed fix

Amend the SCEN-031 phase-file verification (and the reference split it cites) to accept EITHER
mechanism as conforming:

1. column-ownership fields on a shared TRDD, OR
2. an `assignee` split with a maintainer-owned TRDD gating the dev's TRDD via `blocked-by`.

State the requirement as the outcome — "the maintainer gates the release and no single agent owns
the whole lifecycle" — and list both mechanisms as acceptable evidence.

## Verification

Re-run SCEN-031 phase 1 (or its 2a burst equivalent): a fleet that produces the `blocked-by`
variant passes the ownership check without a fix-as-you-go override.

## Estimated risk

LOW. Documentation/criteria change only; broadens what counts as conforming, so it cannot make a
previously-passing run fail. No code touched.

## Approval log

(empty — awaiting screening)
