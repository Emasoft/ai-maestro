---
trdd-id: GLFSHTBH
title: create library appends a second Approval log heading when the body already has one
column: todo
created: 2026-09-05T20:58:58+0200
updated: 2026-09-05T20:59:05+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T20:58:58+0200
labels: [trdd-tooling, trddgrep]
---

# create library appends a second Approval log heading when the body already has one

## Problem

lib/trdd-create.ts (~line 220) unconditionally does `lines.push('## Approval log', '')` followed by the MANDATE line, appended AFTER the caller-supplied body. When the body already contains a `## Approval log` heading (as the TRDD authoring rule instructs: "end with an empty ## Approval log placeholder"), the resulting card ends up with TWO `## Approval log` headings.

Observed on TRDD-66KNYSXY (design/tasks/TRDD-20260905_204834+0200-66KNYSXY-*.md, headings at lines 38 and 42) and on TRDD-10J18FZX (archived, headings at ~53 and ~58).

`trddgrep append <id> "## Approval log" ...` then appends under the FIRST heading only, stranding the auto-emitted MANDATE line under the second heading. `trddgrep validate --min-severity error` does not flag the duplicate heading. Once a card reaches a terminal column its body freezes (IND rule 12), so the duplicate becomes permanent and unfixable through normal tooling.

## Root cause

`createTrdd()` in lib/trdd-create.ts emits its own `## Approval log` + MANDATE line unconditionally, without checking whether the caller-supplied `--body` text already contains a `## Approval log` heading. Two independent sources (the caller's body text and the library's own emission) both believe they own that section.

## Proposed fix

In lib/trdd-create.ts: before emitting `## Approval log`, scan the caller-supplied body for an existing `## Approval log` heading. If found, append the MANDATE line under that existing heading instead of emitting a second `## Approval log` heading. If absent, emit as today. Add a unit test in tests/unit/trdd-create.test.ts covering both shapes (body without the heading -> library emits one; body with the heading -> library reuses it, exactly one heading in the result).

## Verification

`grep -c '^## Approval log' <card path>` on a card minted from a body that already contains the heading must print 1, not 2.

## Acceptance

- [ ] createTrdd() dedupes: MANDATE line lands under an existing `## Approval log` heading when the caller's body already has one
- [ ] tests/unit/trdd-create.test.ts covers both shapes (body with heading, body without heading)
- [ ] corpus grep `grep -c '^## Approval log' <file>' per open card in design/tasks/ finds no card with 2 headings (TRDD-66KNYSXY in design/tasks/ and TRDD-10J18FZX in design/archived/ are grandfathered/frozen pre-existing duplicates and are excluded from this box)

## Approval log

- 2026-09-05T20:58:58+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
