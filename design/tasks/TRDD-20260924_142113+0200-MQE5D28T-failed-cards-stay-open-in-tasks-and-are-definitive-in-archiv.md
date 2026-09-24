---
trdd-id: MQE5D28T
status: tasked
title: Failed cards stay open in tasks and are definitive in archived - owner ruling
column: backburner
created: 2026-09-24T14:21:13+0200
updated: 2026-09-24T19:10:23+0200
current-owner: ai-maestro-main-session
created-by: ai-maestro-main-session
task-type: docs
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: ai-maestro-main-session
mandate: true
mandated-by: user
approved: true
approval-judge: ai-maestro-main-session
approval-datetime: 2026-09-24T14:21:13+0200
---

# Failed cards stay open in tasks and are definitive in archived - owner ruling

## Approval log

- 2026-09-24T14:21:13+0200 — MANDATE issued by ai-maestro-main-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent. (identity redacted 2026-09-24: OS login replaced)

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
- [x] step 1: plan and decisions recorded on this card
- [ ] step 2: remove design/refused/, move its 32 cards to proposals/
- [x] step 3: add status: proposed|tasked|archived, enforced by the trddgrep linter
- [ ] step 4: archive preserves the card's column; add archive authority table; wire the trddgrep archive verb
- [ ] step 5: close immutability gaps on archived cards (no Approval-log append, no bump, no in-place rewrite, no check-box, no doctor --fix)
- [ ] step 6: reconcile design/specs/3-pillars-spec.md and GOVERNANCE-RULES.md via specgrep, close janitor #308, run full verification
- step 2 is PARTIAL (unticked 2026-09-24 after review): 26 cards moved in bc02c5129, not 32; design/refused/ still holds 5 janitor ticket cards pending ai-maestro-janitor#309, so the folder is not removed yet. Tick it when #309 lands and the 5 cards move.
- step-5 queue addition (2026-09-24): STATUS-ZONE-MISMATCH on an ARCHIVED card becomes a WARN (history — the card is immutable, e.g. archived by AMAMA's mover, which never writes status: — Emasoft/ai-maestro-assistant-manager-agent#40). Same treatment as step-5 G8 for the checklist gate. Also: readyQueueFrom (trddgrep next) must skip zone archived (deferred from the kanban follow-ups; lives in lib/trdd-doctor.ts).
- D3 gap (2026-09-24, found by review): created-by is rewritable after creation (trddgrep set has no authority check; no write gate makes it write-once), so the author-only proposal-archive rule is not yet enforceable. Fix queued with #168: created-by and created become write-once in the shared write gates (CLI set/edit and API PATCH).

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

## Lifecycle plan and decisions — 2026-09-24

Owner delegation (verbatim): "fix all of those issues. i leave the rest of the decisions to you. remember to base the decisions of verified facts and tests. never assume anything."
Owner rulings also to quote verbatim: "wait: i only asked for refused to be a metadata, not a folder. but you added the folder by error, and we ended with the refused folder now. you can keep it if you want, but you must know that is redundant, since it is no dfferent than the proposal folder, since all proposed trdd are edited and refused multiple times before being approved. so i would prefer to not have a refusal folder, since it will become filled with all proposals very soon." and "yes. status. enforced to the 3 values by the trddgrep linter."
D1: "marked as filed" in R1 = archived (R1 contrasts "stays open for retry" with "filed"; R3 names the same MANAGER/COS pair for archiving a failed card). So marking a card failed keeps the pre-existing authority "MANAGER or USER"; archiving a failed card = MANAGER or CHIEF-OF-STAFF; outside the harness, the user or the main agent (R1). This is a reading, flagged to the owner in the final report.
D2: Archiving preserves the card's column as-is ("An archived card can be in any column state", "photographed forever in the state it was when it was archived"). Keeping the column loses no information (a kept column plus status: archived can still be read as cancelled later), while rewriting it destroys forensic evidence on a card that can never be edited again. The owner's wording also supports it ("any column state", "photographed forever"). A reading where only failed is kept is possible; this choice preserves the strictly larger set of facts.
D3: Archive authority — a tasked card is archived by its owner or MANAGER, as today, unchanged; a failed card specifically is archived by MANAGER or CHIEF-OF-STAFF only (R1/R3). Proposed stage: its author only. Outside the harness or for a local-scope TRDD: the main agent. Author-only archiving of proposals is enforced by the server route; the trddgrep CLI cannot verify caller identity until issue #168 is fixed.
D4: status: proposed | tasked | archived, enforced by the trddgrep linter whenever present, and it must match the folder. The tools write it on every create or stage move. trddgrep fix may add it to non-archived cards only. The 418 existing archived cards stay untouched (immutable), and a missing status there is accepted.
D5: Finished cards not yet archived keep today's rule-12 protection (no ruling changes it).
D6: Refuse sets column: refused and the card stays in proposals/, editable and re-proposable. design/refused/ is removed and its 32 cards move to proposals/. Who may refuse is unchanged.
D7: move to a finished column still archives. The new trddgrep archive verb (TRDD-4NISAY49) archives from any column, preserving it.
D8: Archived cards are immutable with no exceptions: no Approval-log append, no updated bump, no in-place archived→superseded rewrite (a replacement records supersedes: instead), no check-box, no doctor --fix repair. No un-archive path exists; a test pins that.
Steps: 1 this one; 2 remove design/refused/; 3 the status field; 4 archive preserves the column, plus authority and the archive verb; 5 immutability gaps; 6 specs (via specgrep), GOVERNANCE-RULES, janitor #308, and a full verification. Each step gets tests, neuter runs, and one reviewed commit.
A2 (decided 2026-09-24, landed in 470da9cb2): a CHIEF-OF-STAFF may archive a failed card only when the assignee of the card is in its own team; an unresolvable assignee is denied (fail closed). Consequence: TRDD-G6EBLBIQ has no assignee, so only MANAGER or the human owner can archive it.
A3: owner means assignee OR created-by, unchanged.
A4: the human owner is granted before the authorization matrix; the author-only rule for proposals binds agents only.
A5: the owner cannot archive its own failed card (the column is read from disk, so `state: cancelled` cannot launder it in one step). A retry (failed → dev) followed by a cancel is accepted as a legitimate retry-then-give-up.
D9 (a reading, open question to the owner): in "Only when the agent or the MANAGER / COS decide to give up", the code reads "the agent" as the main agent outside the harness (R1). The agent assigned to a card may NOT archive its failed card until the owner confirms otherwise.
Commit 920d4361d withdrew, for agents, the in-place archived→superseded API path delivered by TRDD-MUB7NTRF (D8). The human owner and the trddgrep CLI still reach the store until step-5 G9 closes it.
Queued for step 5: (a) the write gate (validateTrddCandidate, used by `set` and the API PATCH) does not enforce the three status values or folder agreement; (b) the fixer date block uses the loaded column and runs before the v1 migration; (c) the v1 migration writes to a card that the same pass makes finished; (d) the lint promises autofix on a YAML-only card with no closing `---`, but the fix skips it.
D6 correction: of the 32 cards in design/refused/, 26 moved to proposals/ (bc02c5129); 5 janitor ticket cards remain there (D49OPVWP, Q47OTJ14, V630G4CY, VCEWKBQX, XOHLHQOF) pending Emasoft/ai-maestro-janitor#309; ECOPBKN6 was deleted by the janitor (a dedupe, inferred from its keys).
Owner ruling 2026-09-24 on card authorship (verbatim): "how can a session name be the author of a card? there is something wrong with that. author can only be a main agent from a specific project folder, or the user (rare, the user delegate the writing of trdd to the main agent usually), or (when inside the ai-maestro harness) an agent with a specific name and id." Tracked with Emasoft/ai-maestro#168. The created-by of this very card (`ai-maestro-main-session`) is an instance of that defect.
Commits for this card on branch fix/pillar-cli-issues-165-167 (no implementation-commits field exists): step 2 bc02c5129; step 3 f84851018 (code) and ff28129be (239-card status backfill); overlay wording 23fdb2348; archive authority 470da9cb2 and 920d4361d; kanban index 7bf577be0.
