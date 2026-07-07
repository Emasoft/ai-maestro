---
trdd-id: KPPD109P
title: Consider a deterministic-but-readable label for auto-created COS agents
column: proposal
created: 2026-07-07T12:35:40+0200
updated: 2026-07-07T12:35:40+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: NIT
effort: S
labels: [scenario-improvement, scen-024, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
---

# TRDD-KPPD109P — Consider a deterministic-but-readable label for auto-created COS agents

## Problem
When a team is created without an explicit `chiefOfStaffId`, `services/teams-service.ts`
auto-creates a COS agent with a deterministic agent NAME `cos-<teamslug>` (confirmed
present at `services/teams-service.ts:355` on 2026-07-07: `const cosName =
\`cos-${teamSlug}\``) but a RANDOM robot persona LABEL (e.g. "Kairo", "Tatiana",
"Aria", "Mia" — the surrounding comment at the same location still describes "a
random robot persona name" as of 2026-07-07, confirming this behavior is unchanged).
This makes scenario authoring harder (the label can't be hardcoded/predicted) and can
confuse users who see an unexplained persona name as a team's COS with no visual link
to the team it serves.

## Root cause
The random-persona-name generator used for ordinary agent creation was reused verbatim
for auto-COS creation, without considering that a COS's identity is inherently tied to
its team (unlike a general-purpose agent, which benefits from personality/flair in its
label).

## Proposed fix
This is a **user-facing UX preference change, not a bug** — flag for discussion before
implementing. If approved, change the auto-COS label generation in
`services/teams-service.ts` (near line 355, alongside the existing `cosName`
assignment) from a random persona name to a team-derived label, e.g.:
```typescript
const cosLabel = `Chief-of-${team.name}`   // e.g. "Chief-of-scen024-team"
// or, more casual:
const cosLabel = `${team.name} COS`         // e.g. "scen024-team COS"
```
Keep the agent NAME deterministic as `cos-<teamslug>` (API/registry stability
unaffected — only the display label changes). Some users may prefer the existing
random-persona flair (it gives team agents individual personalities), so this should
be presented as an option/discussion point rather than landed unilaterally.

## Verification
Create a team without specifying a COS; confirm the resulting agent's persona label
is now team-derived and predictable (e.g. `Chief-of-<teamname>`) instead of random,
while `agent.name` remains `cos-<teamslug>` unchanged.

## Estimated risk
LOW (technically) / MEDIUM (product-preference) — trivial code change, but changes
user-visible behavior that some users may prefer as-is. Needs an explicit go/no-go
decision before implementation, not a default execute-on-approval. Dependencies: none.

## Approval log
