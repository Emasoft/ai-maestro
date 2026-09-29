---
trdd-id: 4DC4QYP1
title: Issue 163 migration - new canonical 3-pillars corpus layout
column: backburner
status: tasked
created: 2026-09-29T14:49:22+0200
updated: 2026-09-29T19:25:23+0200
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
