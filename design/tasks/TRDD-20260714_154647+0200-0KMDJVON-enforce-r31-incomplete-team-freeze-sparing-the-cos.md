---
trdd-id: 0KMDJVON
title: Enforce R31 incomplete-team freeze — and the freeze MUST spare the CHIEF-OF-STAFF
column: blocked
created: 2026-07-14T15:46:47+0200
updated: 2026-09-08T22:45:22+0200
current-owner: claude-opus-session
created-by: maestro
task-type: bugfix
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-14T15:46:47+0200
priority: 1
severity: high
effort: medium
release-via: none
relevant-rules: [9, 12, 29, 30, 31]
labels: [governance, teams, lifecycle, chief-of-staff, r31]
assignee: ai-maestro-hub-session
eht: [RND4LDFK]
blocked-by: [RND4LDFK]
pre-block-column: dev
blocker-probe: sh -c 'for id in RND4LDFK; do f=$(find design -iname "*${id}*.md" 2>/dev/null | head -1); c=$(grep -m1 -h "^column:" "$f" 2>/dev/null); echo "$id $c"; done | grep -qviE "column:[[:space:]](published|complete|live|failed|superseded|cancelled|refused)$" && echo NOT-ALL-TERMINAL || echo ALL-TERMINAL'
blocker-holds-if: match:NOT-ALL-TERMINAL
blocker-probe-canary: match:NOT-ALL-TERMINAL|ALL-TERMINAL
---

# Enforce R31 incomplete-team freeze — and the freeze MUST spare the CHIEF-OF-STAFF

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-08

**LANDED on governance-rules:** freeze + completeness helpers in `lib/team-registry.ts`; freeze on createNewTeam with undo; re-evaluation on ChangeTitle (G23), ChangeTeam (G04e/G07b), DeleteAgent (G04b) in `services/element-management-service.ts` — 3847007d, 299ae728; wakeAgent Gate 1c refuses a frozen team's non-COS member (409 `team_frozen:`, COS exempt, isSystemOwner does not bypass) and every undo clears `frozen` and saves BEFORE waking — 9ef24a62, WHY-comment 35e2c3bd.
Measured 2026-09-08 (reports/lean-worker/20260908_154528+0200-r48-freeze-bypass-measure.md): no restart path bypasses Gate 1c (restart only drives an existing tmux pane); the 409 is preserved by the wake route and the headless router; all five undos persist via saveTeams before waking; loadTeams reads disk, never a cache.
Correction: 35e2c3bd's subject says the symmetry argument was "measured" — it was reasoned, not observed. Owner exemption is deliberately absent: R31.1 names none. Open question: a dead COS leaves its team frozen with no owner override — the unfreeze path is replacing the COS, not yet verified.
The DEADLOCK TRAP below still binds: never reuse `blockAllTeams()` — it freezes the one agent that can lift the freeze.

- **NEXT ACTION (2026-09-08T21:24:43+0200):** USER decision — (a) land the echo half now (post-commit `notifyCosOfFreeze`, list-shaped ChangeTeam ctx per TRDD-LZR1M3TQ, one more review round) or (b) hold until TRDD-RND4LDFK (EHT, manager tier) is ruled. Box 6 stays UNTICKED; column blocked on RND4LDFK, pre-block-column dev: the birth freeze tells nobody (auto-COS has no session, teams-service.ts:427) and the durable AMP path is denied for a system sender (message-filter.ts Step 1) and wrapped data-only (sendFromUI isFromVerified=false).
- SUPERSEDED 2026-09-08: "then close the approval log and move the column to testing" — not while box 6 is open. If (a) is chosen, TRDD-LZR1M3TQ is an NPT of the echo half: add it to npt/blocked-by, move it off backburner in the same commit, and keep this card in blocked until LZR1M3TQ is terminal (pre-block-column is dev, and a card must not re-enter dev with an unmet NPT).

## Problem

**R31 (IRON, USER-set) has ZERO enforcement.** A sweep of `lib/ services/ app/ components/`
finds no incomplete-team freeze anywhere; the only `frozen`/`blocked` code is R9.8's
no-MANAGER-on-host cascade, which is a *different rule*.

Combined with the fact that **`createNewTeam` creates only the auto-COS** (which is CORRECT —
see below), the consequence is:

> **Every team is born at 1-of-5 and stays there indefinitely, reporting as healthy.**

Under **R12.2** that is a **NON-FUNCTIONAL TEAM** by definition — and nothing detects it,
nothing freezes it, and nothing makes the COS repair it.

**This is the "unenforced rules produce successes, not errors" pattern**
([[an-unenforced-rule-produces-a-success-not-an-error]]): the team creates fine, deletes fine,
and every happy-path test passes, while violating R12.1 continuously.

## What the rules actually say (reconciled — they disagree, and R12 wins)

| Rule | Says |
|---|---|
| **R12.1 (CRITICAL — AUTHORITATIVE)** | A team is **5 agents**: 1 **CHIEF-OF-STAFF**, 1 ARCHITECT, 1 ORCHESTRATOR, 1 INTEGRATOR, 1 MEMBER. **The COS is one of the 5.** |
| **R12.2** | A team lacking any of the 5 is NON-FUNCTIONAL — **the CHIEF-OF-STAFF must immediately add the missing agents** |
| **R31.1** | An incomplete team is FROZEN: **only the CHIEF-OF-STAFF may be active**; all other team agents are hibernated **until the COS finishes creating + configuring all basic members** |
| **R30.3** | Extras beyond the base must be **MEMBER**-titled with a specialized role-plugin (e.g. a website team gets an extra MEMBER carrying a webdesign role-plugin) |
| **R29.1** | ⚠ **WRONG — it says a team "auto-creates the CHIEF-OF-STAFF *+ the 5 basic team members*" (= 6 agents, system-created). It miscounts AND names the wrong actor.** Fixing its text is a separate USER-only edit (IRON). |

**So `createNewTeam` creating ONLY the auto-COS is CORRECT behaviour**, not the bug I first
took it for. The system creates the COS; **the COS creates the other 4.** USER confirmed
verbatim (2026-07-14): *"a team cannot work if it is missing any of the 5 basic roles:
CHIEF-OF-STAFF, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER"* and *"the CHIEF-OF-STAFF is the
one tasked with the responsibility to create the missing members."*

## ⚠ THE DEADLOCK TRAP — the whole reason this TRDD exists

**`blockAllTeams()` (`lib/team-registry.ts:427`) hibernates the COS along with everyone else:**

```ts
for (const team of teams) {
  for (const id of team.agentIds) teamAgentIds.add(id)
  if (team.chiefOfStaffId) teamAgentIds.add(team.chiefOfStaffId)   // ← COS hibernated
  if (team.orchestratorId) teamAgentIds.add(team.orchestratorId)
}
// … then kills the tmux session of every id in the set
```

That is **correct for R9.8** and **fatal for R31**. Two freezes share the word and invert the
COS rule:

| | trigger | COS | why |
|---|---|---|---|
| **R9.8 block** | no MANAGER on the host | **hibernated** | nothing in-band can fix it; only the USER can assign a MANAGER |
| **R31 freeze** | team missing ≥1 of the 5 | **STAYS ACTIVE** | the COS is the *only* agent that can lift the freeze (R12.2, R31.1) |

**Reusing `blockAllTeams()` for R31 produces a permanent deadlock:** team incomplete → freeze →
COS hibernated → nobody creates the missing 4 → team incomplete forever. The rule designed to
*repair* the team would be what kills it. And the reuse is the natural mistake — the function
is right there, it is named "block the team", and it does 90% of the job.

**USER, 2026-07-14:** *"technically at least one member of a team does not need to be hibernated
but must be active: the COS."*

## Proposed change

1. **New `freezeIncompleteTeam(teamId)`** in `lib/team-registry.ts` — do NOT extend
   `blockAllTeams()`. It hibernates `team.agentIds` **minus `team.chiefOfStaffId`**, and sets a
   `frozen: true` (distinct from `blocked`, which is R9.8's).
2. **New `isTeamComplete(team)`** — true iff all 5 R12.1 titles are present among its live
   (non-tombstoned) agents. This is the predicate R12.2 needs and nothing currently has.
3. **Call it on every roster mutation** — `createNewTeam` (a fresh team is incomplete BY
   DESIGN, so it is frozen from birth, with its COS active and tasked), `ChangeTeam`,
   `DeleteAgent` of a team member, and `ChangeTitle` that moves a title in/out of a team.
4. **Unfreeze** when `isTeamComplete()` flips true — wake the hibernated members (R31.2).
5. **Tell the COS its job.** A frozen team with an idle COS is still a dead team. On freeze,
   the COS must be *informed* what is missing — an AMP message / injected directive naming the
   absent titles. Without this, R31 enforcement just hibernates 4 agents and waits forever.
6. **Edge case — the COS itself is missing.** The COS cannot self-heal. That team can only be
   repaired by the MANAGER (which is what team creation already does). Handle explicitly; do
   not let it fall into the "COS will fix it" path.

## Verification (all NEGATIVE — a happy-path test proves nothing here)

- A newly created team → **frozen**, COS **active**, no other agents present.
- COS creates ARCHITECT + ORCHESTRATOR + INTEGRATOR + MEMBER → team **unfreezes**, members wake.
- Delete a member from a complete team → team **re-freezes**, and the **COS stays awake**.
- A frozen team's non-COS agent → cannot be woken while frozen (R31.1).
- **THE REGRESSION TEST THAT MATTERS:** freeze a team, then assert the COS's tmux session is
  **still alive**. This is the one that catches a future refactor collapsing the two freezes
  back into `blockAllTeams()`.
- R9.8's block is unchanged: with no MANAGER, **everything** hibernates, COS included.

## Estimated risk

**MEDIUM.** The logic is small; the danger is entirely in the collision with the existing,
similarly-named, similarly-shaped `blockAllTeams()`. Get the COS exemption wrong and every team
on the host deadlocks — a worse failure than the unenforced rule it replaces. The regression
test above is not optional.

## Acceptance

- [x] `freezeIncompleteTeam(teamId)` exists as a new function in `lib/team-registry.ts`, distinct from `blockAllTeams()`, and hibernates `team.agentIds` MINUS `team.chiefOfStaffId`.
- [x] `isTeamComplete(team)` exists and returns true iff all 5 R12.1 titles are present among the team's live (non-tombstoned) agents.
- [x] `freezeIncompleteTeam`/`isTeamComplete` are called on every roster mutation: `createNewTeam`, `ChangeTeam`, `DeleteAgent` of a team member, and `ChangeTitle` moving a title in/out of a team.
- [x] A newly created team is frozen, its COS active, no other agents present — and the regression test asserting the COS's tmux session stays alive under freeze passes.
- [x] Deleting a member from a complete team re-freezes it while the COS stays awake; a frozen team's non-COS agent cannot be woken while frozen.
- [ ] The COS receives an AMP message / injected directive naming the missing titles when its team freezes.
- [x] R9.8's block is unchanged: with no MANAGER, every agent including the COS hibernates.

## Approval log

- 2026-07-14T15:46:47+0200 — MANDATE issued by USER (maestro) (min-approval-requirement: user).
  Pre-approved. Basis: the USER's verbatim rulings on the 5-role base (R12.1) and on the COS
  remaining active during a freeze. No approval request was sent.
- 2026-09-06T03:00:20+0200 — implemented isTeamComplete + freezeIncompleteTeam in lib/team-registry.ts (new functions, blockAllTeams untouched behaviorally, only its hibernate-loop extracted to a shared helper hibernateTeamAgentSession); test tests/unit/team-registry-freeze-incomplete.test.ts green (3 tests), neuter reddened 'an incomplete team (missing ARCHITECT) freezes and hibernates every non-COS agent, sparing the COS'; tsc clean; call-site wiring deferred: services/teams-service.ts:275 (createNewTeam), services/element-management-service.ts:6992 (ChangeTeam), :9083 (DeleteAgent), :2486 (ChangeTitle); COS notification and unfreeze-on-repair also deferred. Uncommitted — coordinator commits.
- 2026-09-06T03:25:17+0200 — createNewTeam wired: freeze gate + compensation in services/teams-service.ts (~lines 350-624: freezeUndo declared before try, freeze call + gate FRZ after orchestrator assignment, undo in the outer catch clearing frozen + waking hibernated agents via services/agents-core-service.wakeAgent); tests/unit/create-team-freezes-incomplete.test.ts green (3), neuter (removed the freezeUndo assignment) reddened 'a downstream failure after the freeze wakes every hibernated agent and clears the frozen flag' only, reverted; existing tests/services/teams-service.test.ts + tests/governance/r1-teams-service.test.ts + tests/unit/team-registry-freeze-incomplete.test.ts stay green (107 total, after adding the new stage label to that suite's REAL_STAGES allowlist); tsc rc 0. Box 3 still open for ChangeTeam/DeleteAgent/ChangeTitle. Uncommitted — coordinator commits.
- 2026-09-06T03:32:14+0200 — createNewTeam freeze gate made fail-fast: the try/catch that logged and continued on a freeze error was removed (R51 — a team reporting created while its R31 freeze silently failed is an invalid state); test (d) proves a throwing freeze rejects the creation and the existing compensations run, neuter (re-adding the swallow) reddened it. Box 4 caveat: ticked on a flag-level assertion in a deps-mocked harness — the COS's liveness is asserted as no kill-session issued for it, not as a live tmux session. Uncommitted — coordinator commits.
- 2026-09-06T03:43:41+0200 — createNewTeam wiring landed in 94f17915 (gate FRZ, fail-fast; the undo in the outer catch clears frozen and wakes the recorded ids with system-owner authority) on top of 965e3dcd; the roster-mutation re-freeze at ChangeTitle/ChangeTeam/DeleteAgent (services/element-management-service.ts) is in the tree uncommitted pending the coordinator's own acceptance run. Correction to the 03:1x line above: 'measured before the compensations were written' means measured before the createNewTeam gate existed — that gate and its compensation now exist and are pinned by tests/unit/create-team-freezes-incomplete.test.ts (4 tests, coordinator re-run 4/4). Two defects in 94f17915 to be corrected forward this session: the freeze block's WHY overstates the outer catch ('plus every other rollback' — measured, the catch runs ONLY the freeze undo; createNewTeam has no team-level rollback, TRDD-C3CHP8L2), and the undo's system-owner wake carries no WHY at the call.
- 2026-09-06T05:11:27+0200 — roster-mutation re-freeze landed in 3847007d: G23 (ChangeTitle), G04e/G07b (ChangeTeam remove/add), G04b (DeleteAgent) call freezeIncompleteTeam after the mutation, fail-fast, each undo waking exactly the ids its gate hibernated; four fixtures gained the getTeam/freezeIncompleteTeam mock exports. Box 3 (every roster mutation) is satisfied by 94f17915 + 3847007d. Still open: the wake path does not yet refuse a frozen team's non-COS agent (box 5 second half), and no roster mutation yet calls unfreezeTeamIfComplete (Proposed change #4). Coordinator re-ran the five-file suite (5 files, 38 tests green) and tsc (rc 0) at 05:04 on the tree 3847007d commits.
- 2026-09-06T06:01:13+0200 — unfreeze-on-repair landed in 299ae728 (Proposed change #4): G07b (ChangeTeam add) and G23 (ChangeTitle) call unfreezeTeamIfComplete when the freeze reports the team complete and it was frozen before the gate; nobody is woken; the outcome is a separate ctx flag (unfroze) whose undo re-sets frozen under the teams lock. Coordinator re-ran tests/unit/roster-mutation-refreeze.test.ts (green, 6 tests) and tsc (rc 0) before 299ae728. Still open: box 5 second half (the wake path refuses a frozen team's non-COS agent — in flight with the undo reorder clear-then-wake) and box 6 (COS notification).
- 2026-09-08T20:07:47+0200 — Box 5 ticked on measured facts: re-freeze on member delete landed 3847007d/299ae728; wakeAgent Gate 1c refuses a frozen team's non-COS member (409 team_frozen, COS exempt, isSystemOwner does not bypass) 9ef24a62, WHY-comment 35e2c3bd; reports/lean-worker/20260908_154528+0200-r48-freeze-bypass-measure.md measured: no restart path bypasses Gate 1c (runRestartSequence only drives an existing tmux pane), 409 preserved by the wake route and the headless router, all five undos saveTeams before waking, loadTeams reads disk. Correction: 35e2c3bd's subject says the symmetry argument was measured — it was reasoned, not observed. Owner exemption deliberately absent (R31.1 names none). Open: a dead COS leaves its team frozen with no owner override; unfreeze path = replace the COS, unverified. Box 6 (COS AMP message naming the missing titles) stays open.
- 2026-09-08T21:24:43+0200 — Box 6 measured BLOCKED, not ticked: the tmux echo cannot reach the birth-freeze COS (createSession:false at services/teams-service.ts:427; notification-service.ts:141-143 returns No sessions) and the durable AMP path cannot carry a system directive to a closed-team COS (lib/message-filter.ts Step 1 null-sender denial; lib/message-send.ts:164-174 isFromVerified=false; lib/content-security.ts:140-190 data-only wrap). EHT TRDD-RND4LDFK (proposal, manager tier) opened for a trusted in-process system sender; review forks 36/37 rejected shape A (retraction at undo) and found ChangeTeam's shared freeze ctx (TRDD-LZR1M3TQ). Card moves to blocked on RND4LDFK.
- 2026-09-08T22:42:02+0200 — STATE block reconciled in c815fa93/3d7627a7 (NEXT ACTION moved into the top STATE block, the plan step "move the column to testing" superseded while box 6 is open, the bottom STATE section blanked); post-write review (fork 42) applied in part — two findings rejected, stated in the session reply: the STATE line now notes that choice (a) makes TRDD-LZR1M3TQ an NPT of the echo half. No column change.




