---
trdd-id: RWA6YD80
title: Grant surface for userPermitsManagerCollaboration — route UI and producer wiring
column: proposal
status: proposed
created: 2026-09-27T01:16:09+0200
updated: 2026-09-27T01:16:09+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: feature
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false

---

# Grant surface for userPermitsManagerCollaboration — route UI and producer wiring

## Problem

`userPermitsManagerCollaboration` — the R39.9 standing permission — has its STORAGE and DEFAULT
ruled (parent TRDD-HW72YBZW, 2026-08-22: a field on `UserRecord` beside `assistantAgentId`
(`types/user.ts:69`), default `false`, deny-by-default) but has **NO GRANT SURFACE**: no route, no
setting, no UI. Default-off with no way to turn it on makes R39.9 a dead letter, and the
ASSISTANT→MANAGER channel (HW72YBZW half 2) cannot go live.

## Root cause

HW72YBZW half 1 landed (`bb910a7f`): `recipientIsActiveMaestro` was replaced by a
`recipientIsManager` disjunct gated on `userPermitsManagerCollaboration`
(`lib/communication-graph.ts:83` type, `:394` read). The parent's 2026-08-22 ruling decided
storage and default but explicitly declined to invent the grant surface — its own words:
"HALF 2 IS NOT A WIRING COMMIT" — and called for exactly this separate feature card. So the gate
reads a field nothing can write, the ASSISTANT-sender branch stays unreachable at runtime, and
`tests/unit/communication-graph-user-routing.test.ts` pins the unreachability with its
"NO PRODUCTION CALLER builds an assistantSender block" lock (line 217). The producer cannot be
wired until a user can grant the standing permission.

## Proposed fix

The MINIMUM surface, consistent with the parent ruling:

1. **Field** — `UserRecord` gains `userPermitsManagerCollaboration: boolean` beside
   `assistantAgentId` (`types/user.ts:69`). An absent field reads as `false`, never
   unset-so-allow (same fail-closed shape the parent ruling pinned).
2. **Route** — a PATCH handler on `/api/governance/users` (the route that already exposes
   `assistantAgentId` at line 47; currently GET-only) that flips the flag on the USER's own
   record. Refusable and USER-authenticated. **No auto-grant.**
3. **UI** — a minimal toggle in the user's own settings panel. Verified: the local human user's
   panel is `components/HumanUserPanel.tsx` (chat-only panel for the human user, already reads
   the user profile from `/api/governance`); the toggle rides there.
4. **In-scope per the parent card's own acceptance list** (they ride THIS card, not a sibling):
   the `assistantSender` producer wiring; the SAME-COMMIT deletion of the lock test
   (`tests/unit/communication-graph-user-routing.test.ts` line 217) — it exists to force this
   card, so it must not become a permanent lock; and the re-upgrade of the CONTRADICTED
   R39.5/R39.7 rows in `docs/GOVERNANCE-ENFORCEMENT-MAP.md`.
5. The MANAGER channel carries **only a refusable, USER-gated task assignment** (R39.9) — never a
   command, never a mandate (R41 holds). No auto-grant, no batch grant, no API for another agent
   to flip the flag.

## Verification

- **Gate neuter** — neuter the `userPermitsManagerCollaboration` gate in
  `lib/communication-graph.ts`: it reddens EXACTLY the flag-gated allow (ASSISTANT → MANAGER),
  and nothing else.
- **Absent-field reads as deny** — a `UserRecord` predating the field yields the same verdict as
  flag `false` (deny), never unset-so-allow.
- **Default-deny allow-pair** — ASSISTANT → MANAGER with the flag set = allow; the identical
  request with the flag false = deny; proven by neutering the gate, not the edge.
- The lock-test deletion and the producer wiring land in ONE commit; the map-row re-upgrade cites
  the new test.

## Estimated risk

MED-HIGH. This is a security boundary on the communication graph: the failure mode of getting the
gate wrong is an agent commanding a user's ASSISTANT. Mitigated — the branch is unreachable
today, so work starts from deny-all rather than from a live edge, and half 1's two DISTINCT denials
(landed in `bb910a7f`) already keep a neutered gate from reading as the no-edge case.

## Acceptance

- [ ] `UserRecord.userPermitsManagerCollaboration` exists beside `assistantAgentId` and an absent field reads as `false`
- [ ] A PATCH handler on `/api/governance/users` flips the flag; refusable, USER-authenticated, no auto-grant
- [ ] A UI toggle for the flag exists in the user's settings panel
- [ ] A production caller wires the `assistantSender` block, and the same commit deletes the lock test (`tests/unit/communication-graph-user-routing.test.ts` "NO PRODUCTION CALLER")
- [ ] The CONTRADICTED R39.5/R39.7 rows in `docs/GOVERNANCE-ENFORCEMENT-MAP.md` are re-upgraded with the new citation
- [ ] A gate-neuter test reddens exactly the flag-gated allow, and an absent-field test proves the deny default

## Approval log

- (empty — filed as `column: proposal`, `min-approval-requirement: manager`. Parent TRDD-HW72YBZW
  holds at `human_review` until this card exists; it now does, and the parent's NEXT ACTION is
  satisfied.)

## Approval log
