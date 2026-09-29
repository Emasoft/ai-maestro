---
trdd-id: 4DC4QYP1
title: Issue 163 migration - new canonical 3-pillars corpus layout
column: backburner
status: tasked
created: 2026-09-29T14:49:22+0200
updated: 2026-09-29T20:09:21+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: infra
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-09-29T14:49:22+0200
---

# Issue 163 migration - new canonical 3-pillars corpus layout

OWNER DIRECTIVE (Emasoft/ai-maestro#163, 2026-09-12): new canonical 3-pillars corpus layout — project <root>/design/, local <root>/.claude/local/design/, user ~/.claude/cross-projects-coordination/<group>/design/. Migrate tools, skills and rules to the new scope paths. Surfaces: trddgrep/memgrep --design-dir defaults, shipped rules (trdd-design-tasks.md USER copy), plugin skills. Assessment note 2026-09-29: largest open directive; spans tools+rules+skills across repos; this card is the dedicated TRDD required before dispatch.

## Approval log

- 2026-09-29T14:49:22+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
OWNER DECISION 2026-09-29 ~19:0x+0200 (pasted verbatim): "E: batch-design-cycle — note: first examine carefully the plans/tasks and evaluate if they are still feasible or superseeded. Then consider all the changes and recent improvements we introduced to the design folder and to the 3 pillar system, and to the 4 tools (trddgrep, prrdgrep, specsgrep, kanban), and to the specs. for example the refused folder was merged with the proposals folder, since they are always refused many times and redesigned before being approved, so the two folders should be one, since every refused trdd is also a proposed trdd waiting to be improved/modified to be submitted again for approval. another change is the fact that once in the archived folder, the TRDD are immutable. they cannot ever be resurrected, since they are proof/trails of events of dev history. the new proposed design is most likely about creating 3 design folders: user scope (cross project), project scope and local scope. But for local scope memories we use the slugs under the projects folder of claude code, so it would be better to do the same for the local design folder too. this is another change on the original proposals. the project scoped design folder path will be left unchanged.  the aim of these proposal was to allows user scoped design folders to be shared between agents in the same group. that is the true purpouse. the local scope design folder is a secondary aim, mainly targeted at preserving the privacy of local changes. so plan wisely with these two points in mind." — NEXT ACTION per this decision: a feasibility examination FIRST (are the plans/tasks still feasible or superseded?), against the current 3-pillar/tooling state, honoring the two design points: (1) TRUE PURPOSE = user-scoped design folders SHARED BETWEEN AGENTS IN THE SAME GROUP; (2) local-scope design should mirror the ~/.claude/projects/<slug>/ slug convention (like local memory), while project-scope path stays unchanged. Note the owner's examples: refused→proposals folder merge rationale, and archived-folder immutability.

## STATE — feasibility examination 2026-09-29

FEASIBLE — amended design (E-directive) needs LESS than the original #163 directive; the user-scope group-sharing purpose (#164 access layer fenced out as separate card) is the real remaining work. Per-surface: trddgrep/prrdgrep/specgrep EXTENDS (corpusRootFor local line flips, kinds.ts:273; scopeOfDesignDir ALREADY classifies slug paths as local, kinds.ts:336-352 + tests/unit/pillar-kinds.test.ts:91-100; isUserCorpusPath ALREADY recognizes cross-projects-coordination, kinds.ts:293); project scope UNCHANGED (118/118 scope'd cards are project, 0 local/user); memgrep's Python sibling CONFLICTS (janitor trdd_common.py:187-200 local_design_root must re-point; dormant memory_scopes.py mirror becomes live again); shipped rules EXTENDS+REVERSAL (trdd-design-tasks.md LOCAL row reverts to slug path — undoing WY198OIP's edit; universal-kanban.md:58 drops refused/ folder; governance-trdd-kanban.md:150 ALREADY matches the slug path); ai-maestro overlays ALREADY ALIGNED (aimaestro-kanban-multiagent.md:65 slug root; aimaestro-trdd-approval.md:110-121 discriminator table drafted awaiting the IND base); specs CATCH-UP (3-pillars-spec 3P-TRDD-06:347 ALREADY says slug-path local; 3P-ZON-01/-02/-04 still teach the refused FOLDER the code dropped — MAJOR bump 4.0.0 to 5.0.0 under 3P-VER-01). SUPERSESSION ANSWER: WY198OIP (archived-complete, janitor repo) coexists with the amendment on disk today and is SUPERSEDED IN DIRECTION for the design corpus ONLY — local design returns to the slug tree (stronger privacy: outside every repo, nothing leakable by push), the MEMORY half WY198OIP explicitly left untouched stays; the card is archived-immutable so supersession records on a NEW card citing it; the dual-layout classifier WY198OIP's follow-up built is what makes the reversal cheap. LIVE DEBT EITHER WAY: 21 of 23 distinct local card ids are DUPLICATED across both local roots on this host right now (31 slug files / 24 in-tree files, both written post-2026-09-17; WY198OIP's own both-exist refusal stalled its migration) — 3P-IDX id-uniqueness is unenforceable until ONE root is emptied; migration design must pick survivors by CONTENT not folder. Also: 3 legacy cards sit in design/refused/ (LEGACY-REFUSED-FOLDER lint WARN), settle via trddgrep move. Full evidence: reports/20260929_1930+0200-issue163-feasibility-examination.md
