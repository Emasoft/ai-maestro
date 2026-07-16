---
trdd-id: 40CUZA1Z
title: Unified cross-host sidebar — all users and agents in one list; user and paired agent both shown (R46)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-07-16T09:47:54+0200
current-owner: opus-governance-rules-session
task-type: feature
relevant-rules: [46, 43, 39, 36, 37]
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T09:47:54+0200
labels: [multi-host, transition-phase]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved, NOT started.** Implementation TRDD for **R46** (committed `bf70bf47`, v4.4.0).
Held under the transition-phase hold — do NOT implement.

**NEXT ACTION when unheld:** build a unified-list data source merging local agents
(`lib/agent-registry.ts`) + cross-host peer agents (`lib/agent-directory.ts`) + users
(`lib/user-registry.ts`, local + peer), then render users AND agents as distinct entities in
`components/AgentList.tsx`, grouped only by team (same-host) / group (cross-host).

**Depends on:** the ASSISTANT pairing (TRDD-W9FA6ACZ) for the normal-user↔ASSISTANT rows; the peer
user-directory (shared with TRDD-HR8CES7H). Presentation only — authority (MANAGER governs,
ASSISTANT doesn't, R46.3) is enforced elsewhere; the sidebar only DISPLAYS it.

## Problem

R46.1 wants one unified sidebar of all agents AND users — same-host or cross-host, desktop or mobile
remote browser — divided only by teams/groups. R46.2 wants a user and its paired agent both listed
as distinct entities (MAESTRO user + MANAGER agent; normal user + ASSISTANT). Today
`components/AgentList.tsx` lists local agents only and shows no users at all.

## Approach (design sketch)

1. **Unified data source.** New API/hook merging: local registry agents + peer agents
   (`lib/agent-directory.ts`) + users (local + peer). Each entity tagged with its host id.
2. **Render users + agents as distinct entities (R46.2).** A MAESTRO user row alongside its MANAGER
   agent row; a normal-user row alongside its ASSISTANT row. A user is NOT its agent — two rows,
   visually paired.
3. **Group only by team/group (R46.1).** Teams (same-host) and groups (cross-host) are the ONLY
   dividers. Host shown as a badge, not a top-level divider.
4. **Authority display (R46.3).** MANAGER pairing shows a "governs" affordance; ASSISTANT pairing
   shows "Assistant of <user>" and no governing affordance. Display-only.
5. **Responsive.** Works on desktop + tablet + smartphone viewports (per the scenario device axis).

## Verification
- Sidebar shows local + at least one peer host's agents AND users.
- A user and its paired agent both appear, as two distinct rows.
- Team/group grouping is the only division; host is a badge.
- Renders correctly at smartphone/tablet widths.
- §0 mirror-sync: GOVERNANCE R46, scenario coverage (new SCEN-0NN, `interhosts: true`).

## Estimated risk
MED. UI + cross-host data merge; no new protocol. Depends on the peer directory (agents + users) and
the ASSISTANT role (W9FA6ACZ) for the normal-user pairing rows.

## Rollout cohort — multi-host governance (R43-R48), transition phase
Siblings: TRDD-OEG0V589 (migration R44) · TRDD-W9FA6ACZ (ASSISTANT R39) · TRDD-QR9FSL3Q (groups
R45) · TRDD-HR8CES7H (usernames R47) · TRDD-PLOVIPZE (console gates R48) · TRDD-OC9ELGSO (transport,
#40). §0 mirror-sync rides each TRDD's Verification.

## Approval log
- 2026-07-16T09:47:54+0200 — MANDATE issued by USER (min-approval-requirement: manager;
  user authority >= manager). Verbatim: *"author all those TRDDs, but wait to implement them."*
  Implementation HELD.

## Notes and lessons learned
