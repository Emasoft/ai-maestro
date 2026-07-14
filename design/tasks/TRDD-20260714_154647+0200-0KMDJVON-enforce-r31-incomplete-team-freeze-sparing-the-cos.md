---
trdd-id: 0KMDJVON
title: Enforce R31 incomplete-team freeze — and the freeze MUST spare the CHIEF-OF-STAFF
column: planned
created: 2026-07-14T15:46:47+0200
updated: 2026-07-14T15:46:47+0200
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
---

# Enforce R31 incomplete-team freeze — and the freeze MUST spare the CHIEF-OF-STAFF

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14

**USER MANDATE — already approved. The single load-bearing fact is the DEADLOCK TRAP below;
read it before writing a line of code.** The obvious implementation (`blockAllTeams()`, which
already exists and is literally named "block the team") **freezes the one agent that can lift
the freeze.**

- **NEXT ACTION:** implement `freezeIncompleteTeam(teamId)` as a NEW function. Do **not** reuse
  or extend `blockAllTeams()`.

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

## Approval log

- 2026-07-14T15:46:47+0200 — MANDATE issued by USER (maestro) (min-approval-requirement: user).
  Pre-approved. Basis: the USER's verbatim rulings on the 5-role base (R12.1) and on the COS
  remaining active during a freeze. No approval request was sent.
