---
trdd-id: MQE5D28T
title: Failed cards stay open in tasks and are definitive in archived - owner ruling
column: backburner
created: 2026-09-24T14:21:13+0200
updated: 2026-09-24T14:28:03+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: docs
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: emanuelesabetta
mandate: true
mandated-by: user
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-24T14:21:13+0200
---

# Failed cards stay open in tasks and are definitive in archived - owner ruling

## Approval log

- 2026-09-24T14:21:13+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Problem

The overlay governance rules (rules/aimaestro/aimaestro-trdd-approval.md, aimaestro-manager-approval-defaults.md) said a failed TRDD is NEVER moved to design/archived/ - stays OPEN, never archived. The owner overruled this: a failed card can be archived, but only by an explicit MANAGER/CHIEF-OF-STAFF decision (or, outside the harness, the USER or main agent), and once archived it is a closed, non-retryable verdict.

## Owner rulings, verbatim (2026-09-24)

1. "of course they stays open for retry. they can only marked as filed on an express MANAGER or CHIEF-OF-STAFF decision. Or, outside the harness, by a user or main agent decision."
2. "failed in tasks -> retry / failed in archived -> frozen/ended (wrong road, never try again, lesson learned)"
3. "frozen is an ambiguous term. it could suggest that the trdd can be unfrozen in the future. but if the MANAGER or the CHIEF-OF-STAFF archive a failed card, that card must never be tried anymore. so use another terminology."
4. "why ended? don't we have failed? just failed in archived -> definitive"

## Code change

Commit 6cf17450f ("fix(trdd): one definitive-card rule for append --create and edit/set; failed in tasks/ stays open") is the code-side landing of this ruling. Related: Emasoft/ai-maestro-janitor#308.

## Overlay rule files updated

rules/aimaestro/aimaestro-trdd-approval.md: the ASCII lifecycle diagram (failed box, archived box, the OPEN-TRDD note) and Part B2 (new failed-tasks-to-archived row plus a dedicated subsection quoting all four rulings and explaining why definitive was chosen over frozen/ended).
rules/aimaestro/aimaestro-manager-approval-defaults.md: section Y — split the old single failed row into an abandon-for-now row and a new definitive-archive row naming the required authority, quoting the first ruling.

## Conflicting clauses NOT edited (specgrep-only; listed for reconciliation)

design/specs/3-pillars-spec.md:503-505, clause 3P-ZON-06 (failed-is-open): "MUST NOT: move a failed card to archived/ ... An archived failed card is indistinguishable from work abandoned silently." Conflicts with ruling 1: needs a carve-out for an express MANAGER/CHIEF-OF-STAFF (or USER/main-agent) decision, making the resulting archived card DEFINITIVE. A MUST change requires a spec-version MAJOR bump per 3P-VER-01 (currently 3.0.0).
design/specs/3-pillars-spec.md:235, clause 3P-KAN-07 (failed): "retryable; stays on the board; NEVER auto-archived." Not contradicted (archiving under the ruling is never automatic), but should cross-reference the amended 3P-ZON-06 once it exists.
docs/GOVERNANCE-RULES.md: grepped for 'failed'/'archived'/'frozen' near terminal-column or archival language; no clause found asserting failed cards are never archived or are frozen once archived, so no conflict located there as of this card's authoring.

## Acceptance

- [x] Overlay rule aimaestro-trdd-approval.md updated to reflect owner rulings 1-4, verbatim-quoted
- [x] Overlay rule aimaestro-manager-approval-defaults.md section Y updated with a dedicated definitive-archive row
- [x] Governance/spec sweep run (docs/GOVERNANCE-RULES.md, design/specs/) and conflicts listed above rather than edited (specgrep-only surface)
- [ ] proposed: reconcile design/specs/3-pillars-spec.md clause 3P-ZON-06 with this ruling via specgrep, bumping spec-version per 3P-VER-01 (a MUST changes)
- [ ] proposed: the corpus tooling's archive-eligibility check should accept a failed card moving into archived/ when the move is attributed to the MANAGER or CHIEF-OF-STAFF (or, outside the harness, the USER or main agent) — today's zone-mismatch logic (ZONE-MISMATCH / expectedZone) treats failed as tasks/-only and would need to allow this one exception, not a general one
- [ ] proposed: once a failed card has been archived under this ruling it becomes definitive, and the tooling that currently lets any archived/refused card be moved or its column reopened should refuse to do so for a definitive card specifically, i.e. it must never leave archived/ or return to an open column again

## Provenance correction

mandated-by corrected from the default 'none' to 'user': the content of this card (the Part B2/section-Y authority-table changes) is the owner's own direct ruling, quoted verbatim above, not this session's Tier-0 judgement call - so the true authority behind it is the USER, not a self-mandate, and the frontmatter now says so explicitly rather than reading as a possible under-classified Tier-2 edit.
