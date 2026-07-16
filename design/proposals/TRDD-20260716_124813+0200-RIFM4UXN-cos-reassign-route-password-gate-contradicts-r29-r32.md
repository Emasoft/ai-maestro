---
trdd-id: RIFM4UXN
title: COS-reassign route requires the governance password — contradicts R29/R32 and defeats MANAGER ruling #64
column: proposal
created: 2026-07-16T12:48:13+0200
updated: 2026-07-16T13:22:00+0200
current-owner: ai-maestro
task-type: audit
scope: project
min-approval-requirement: user
approved: false
relevant-rules: [29, 32, 9]
labels: [governance, security, core-readiness, script-decoupling, decouple-blocked]
external-refs: [Emasoft/ai-maestro-plugin#29, Emasoft/ai-maestro#64]
---

# COS-reassign route requires the governance password — contradicts R29/R32 and defeats MANAGER ruling #64

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**A finding, awaiting a USER ruling — NOT a mandate.** Surfaced 2026-07-16 while
verifying (USER ask) whether the ai-maestro plugins call any script command the
frozen CLI layer lacks. Answer: **no missing commands.** But the one script verb the
plugins flag as "pending" (`assign/remove COS on an existing team`, MANAGER ruling
ai-maestro#64) **did ship** as `aimaestro-teams.sh reassign-cos` — and it calls a
route that is **governance-password-gated**, so agents (even a MANAGER) cannot use
it. That contradicts the ratified design.

**NEXT ACTION:** USER (or MANAGER, if within tier) rules Option A vs B below. The
follow-through is trivial either way (one route flag + one core-plugin doc marker).
Held until then; do NOT edit the route or the core doc before the ruling (either
would silently encode one side of a governance decision).

**▶ 2026-07-16 — CORE INDEPENDENTLY CONFIRMED Option A + added a missing guard
(`Emasoft/ai-maestro#69`, comment 11:05Z).** Told by the USER to "rewrite the
requested commands to be secure", CORE restated the COS-assign verb as a security
contract: **`aimaestro-teams.sh update --cos <id>` (+ clear-path `--cos ""`/`--remove-cos`)
= MANAGER-title-by-AID ONLY (R29/R9.11 — no user approval, NO gov-password ever through
a model, R32.3), NEVER self-assignable (an agent cannot make itself or its ally the
COS).** That is Option A, and it adds a guard THIS TRDD missed: the **self-assign ban**
("without it, it would be a fleet-takeover primitive"). So the ruling is effectively
**A + self-assign ban**, pending the USER's nod. NOTE a verb-name choice remains: CORE/
#64 want it under `aimaestro-teams.sh update --cos`; the repo currently ships it as the
password-gated `reassign-cos`. Fold both into Option A: expose it AID-MANAGER + self-assign
ban, under the #64-named `update --cos` (keep `reassign-cos` as an alias or retire it).
This item is now part of the CORE #69 work package (4 server-side asks, all R23-mine).

## Problem — a contradiction, not a missing command

Three artifacts disagree about how "assign/remove a Chief-of-Staff on an
**already-existing** team" is authorized:

1. **Governance design (R29 / R32 / R9.11), as the core plugin's own
   `team-governance` skill states it (SKILL.md lines 21, 49, 58):** the MANAGER
   performs team-governance ops **by AID, with no user approval and no password**;
   "agents **never** face a sudo gate … a `--password` flag on a deployed CLI is a
   **USER/UI residual you surface to the user, never supply yourself**" (R32); COS
   assignment "needs **no agent password**" (R29/R9.11).

2. **The shipped route `app/api/teams/[id]/chief-of-staff/route.ts`:** `password:
   z.string().min(1).max(256)` — **REQUIRED**; `verifyPassword(password)` → `401`
   with **no MANAGER bypass**; the handler then acts *as* `getManagerId()` — i.e.
   **the password IS the authorization** ("stronger than ACL", route comment L61).
   → the operation is **USER/UI-only** in practice: only a holder of the governance
   password (the human, via the UI) can do it.

3. **MANAGER ruling ai-maestro#64:** committed the hub to build an **agent-usable**
   COS-assign verb **before launch** (under R6 v3 the COS is the sole entry into a
   team, so assigning one on an existing team is a real operational need). The verb
   shipped (`reassign-cos`) but, being password-gated, is **not agent-usable** — the
   #64 intent is unmet. This is the same "verb shipped ≠ consumer can use it" drift
   class recorded in the memory corpus (script↔server drift).

**Smoking gun — an INTERNAL inconsistency, not merely doc-vs-code:** the sibling
governance route `app/api/teams/[id]/route.ts` (team **update/delete**, same MANAGER
actor, same op class) makes the password **`.optional()`** — i.e. it honors the
AID-MANAGER path exactly as the skill (SKILL.md L49) says delete does. Only the
COS-assign route makes it **required**. COS-assign is uniquely over-gated relative to
its own siblings.

## Root cause

The COS-assign route was written to gate on the governance password ("stronger than
ACL") without reconciling against R32 ("agents never face a password gate") or the
sibling routes (password optional). MANAGER ruling #64 then commissioned a CLI verb
for it, and the verb was built and shipped — but nobody checked that the ROUTE it
targets is agent-callable. So the verb exists and is green, yet the capability #64
asked for (a MANAGER agent assigning a COS) does not exist.

## Proposed fix — one of two; this is a USER/MANAGER decision (touches R32, a security rule)

**Option A (RECOMMENDED) — align the route to the ratified design.**
- Make `password` `.optional()` on `app/api/teams/[id]/chief-of-staff/route.ts`
  (mirroring the update/delete route); authenticate the MANAGER by AID via
  `enforceAuth` + a MANAGER check; verify the password only when supplied (the
  USER/UI convenience path).
- Then `reassign-cos` becomes the agent-usable verb #64 intended; the core plugin's
  `team-governance` skill is already correct — it needs only the stale DECOUPLE-BLOCKED
  marker dropped (SKILL.md L60, REFERENCE.md L36/L69/L122/L126) and a `reassign-cos`
  example added.
- **Consistency:** satisfies R29 (MANAGER team-gov ops need no user approval), R32
  (no agent password gate), the sibling-route pattern, and the #64 intent.
- **Security note the USER must weigh:** this lets a **MANAGER agent** reassign a COS
  **without the human's password**. R29 already grants the MANAGER team-governance
  authority "with no user approval", so this is *within* the ratified design — but COS
  is the sole team gateway, so it is a genuine autonomy-vs-human-in-loop tradeoff.

**Option B — align the design to the route.**
- Rule COS-assign/remove **USER/UI-only** (keep the password gate), carve it out of
  R32's "no agent password" blanket, and have the MANAGER re-scope #64 accordingly.
- Update the core `team-governance` skill to say so explicitly: assign/remove COS on
  an existing team is USER/UI-only (governance-password-gated); agents set `--cos` at
  **create** time or ask the human; `reassign-cos --password` is a USER/UI verb, never
  agent-called.
- **Cost:** weakens R32 (a security governance rule) → **USER-only** ruling; and the
  #64 "agent-usable verb pre-launch" goal is formally abandoned.

## Verification (after the ruling)
- Option A: `password.optional()` on the COS route + a MANAGER AID check; a MANAGER
  AID call with no password → `200`; a non-MANAGER → `403`; a USER/UI call with the
  password still → `200`. `bash scripts/with-node.sh yarn test` green; add a route test.
  Core doc marker dropped + `reassign-cos` example added (PR to Emasoft/ai-maestro-plugin).
- Option B: core `team-governance` skill reclassifies the op USER/UI-only; R32 carve-out
  authored in the PRRD/GOVERNANCE-RULES; #64 re-scoped by the MANAGER.

## Estimated risk
- Option A: **MED** — a governance-route auth change; blast radius = who can reassign a
  COS. Reversible. Depends on a MANAGER AID-title check existing (it does; `enforceAuth`
  + registry title).
- Option B: **LOW code / HIGH governance** — no code change to the route, but amends a
  ratified security rule (R32) and a MANAGER ruling (#64).

## Approval log
