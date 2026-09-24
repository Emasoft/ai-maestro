---
trdd-id: MQE5D28T
title: Failed cards stay open in tasks and are definitive in archived - owner ruling
column: backburner
created: 2026-09-24T14:21:13+0200
updated: 2026-09-24T15:55:53+0200
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
- ~~proposed: the corpus tooling's archive-eligibility check should accept a failed card moving into archived/ when the move is attributed to the MANAGER or CHIEF-OF-STAFF (or, outside the harness, the USER or main agent) — today's zone-mismatch logic (ZONE-MISMATCH / expectedZone) treats failed as tasks/-only and would need to allow this one exception, not a general one~~ SUPERSEDED 2026-09-24 by the second USER ruling on this card ("no matter the column it is in ... it will be archived"); the zone-rule change is owned by TRDD-4NISAY49.
- [ ] proposed: once a failed card has been archived under this ruling it becomes definitive, and the tooling that currently lets any archived/refused card be moved or its column reopened should refuse to do so for a definitive card specifically, i.e. it must never leave archived/ or return to an open column again
- [ ] Apply the 2026-09-24 USER rulings (section "USER rulings — 2026-09-24") to the 3-pillars spec, this repo's rules and the plugin-owned rules/skills, per the reviewed proposal

## Provenance correction

mandated-by corrected from the default 'none' to 'user': the content of this card (the Part B2/section-Y authority-table changes) is the owner's own direct ruling, quoted verbatim above, not this session's Tier-0 judgement call - so the true authority behind it is the USER, not a self-mandate, and the frontmatter now says so explicitly rather than reading as a possible under-classified Tier-2 edit.

## USER rulings — 2026-09-24

USER 2026-09-24 (verbatim): "a failed TRDD can still be kept in the tasks folder if its not archived. because a failed TRDD can always be tried again (it can be put back to dev or design). but if a card is archived, no matter if it is failed or any other column, its definitive: no more tries. the 3 life-stages are all irreversible: 1. proposed (in proposals/), 2. tasked (in tasks/), 3. archived (in archived/). this is why they are 3 folders and not just a frontmatter metadata (but they also have the metadata indicating the stage of life). The stage 3 is definitive and irreversible. Even if a similar task should be done again, a new card must be created. So failed is just a temporary column state. A trdd can fail hundreds of times before succeeding. Only when the agent or the MANAGER / COS decide to give up, it becomes an archived card. Is it clear? write this in the specs of the 3 pillars and update all 3-pilllars rule files and skills files."
USER 2026-09-24 (verbatim): "also there should be a special option to archive a trdd card in the trddgrep tool, so that it is not possible to be ambiguous. if the MANAGER decides to archive a card, no matter the column it is in, it must simply execute `trddgrep archive <TRDD-ID>` or `trddgrep archive <TRDD FILE PATH>` in the root of the project it belongs and it will be archived."

## Related

The trddgrep archive verb is tracked in TRDD-4NISAY49.

## Owner rulings — 2026-09-24 (session 2)

USER 2026-09-24 (verbatim): "an archived trdd is automatically cancelled, but if the state column is failed, it must be preserved to show that when it was archived it was failed. An archived card can be in any column state. The archived cards are like corpses: you cannot change them anymore, since they become history that can be used by forensic to reconstruct the iter of an issue or the action of a malicious agent. The archived card is photographed forever in the state it was when it was archived. you can search with trddgrep among all archived cards, but no option in the trddgredp must exist to un-archive a trdd. its definitive. there is the 3 stage life metadata field in the frontmatter too that reports the 3 possible stages: proposed, tasked, archived. (but i don't remember the exact naming at the moment. maybe status? or life-stage?. Anyway, it can be a field that only has those 3 possible states."
USER 2026-09-24 (verbatim, second ruling): "refused means that a card is not approved to become a task, but it does not become archived. it remains in the proposals and can be edited and improved and proposed again to the manager. if the author decides to archive it, it can be archived. but the manager and the cos never archive a proposal. only the author can. (outside of the harness or for local scoped trdd these figures are replaced by the main agent of the project, of course, so he can do all of it by itself). this is important: a MANAGER or a COS cannot archive a TRDD in the proposed stage. Only the author can."
