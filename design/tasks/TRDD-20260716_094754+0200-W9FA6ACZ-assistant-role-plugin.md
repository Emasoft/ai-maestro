---
trdd-id: W9FA6ACZ
title: ASSISTANT role-plugin — ai-maestro-assistant-role-agent (MANAGER+AUTONOMOUS, ungoverned, user-bound) (R39)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-08-16T16:48:46+0200
current-owner: opus-governance-rules-session
task-type: feature
relevant-rules: [39, 46, 41, 26, 6, 11]
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T09:47:54+0200
labels: [multi-host, transition-phase]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved, NOT started.** Implementation TRDD for **R39.2/R39.5** (committed `bf70bf47`,
v4.4.0). Held under the transition-phase hold — do NOT implement.

**⚠ OPEN DECISION (R39.4) — gates the profile-panel field locks. Currently COMMITTED as KEEP.**
R39.4 as written: the user may edit the ASSISTANT's profile EXCEPT NAME/TITLE/ROLE-PLUGIN/TEAM,
which stay read-only to the user and change only by the MAESTRO (sudo, per R26). The USER's later
directive *"the ASSISTANT obeys ONLY its bound user, not even the MAESTRO"* (R39.5) governs
OPERATIONAL obedience; it is silent on whether the MAESTRO keeps **identity administration** of
those 4 locked fields. R39.4 was LEFT INTACT (= KEEP). **Recommendation: KEEP** — else a user could
re-title/re-role their own agent, breaking R26 + host security. Confirm KEEP vs STRIP with the USER
before building the panel locks. This is the only design fork in the cohort still open.

**⚠ CORRECTION (2026-07-16, verified) — THIS TRDD WAS WRONG: the plugin ALREADY EXISTS.**
Authored claiming the role-plugin "does not exist yet" and needed scaffolding from scratch into its
own GitHub repo. **Both claims are false**, and R39.2's own "(still to be created)" parenthetical is
stale. VERIFIED on disk:
`~/agents/role-plugins/roles-marketplace/ai-maestro-assistant-role-agent/` (created 2026-06-19) is
**quad-identity complete** — `.claude-plugin/plugin.json`, `ai-maestro-assistant-role-agent.agent.toml`
(`compatible-titles = ["ASSISTANT"]`, `compatible-clients = ["claude-code"]`), and
`agents/ai-maestro-assistant-role-agent-main-agent.md`. It is a **LOCAL source (decision D4)** —
intentionally NOT a published GitHub repo and correctly absent from `PREDEFINED_ROLE_PLUGIN_NAMES`
(`lib/ecosystem-constants.ts:280-288`), so `Emasoft/ai-maestro-assistant-role-agent` returning 404 is
BY DESIGN, not a gap. Much of R39 is also already BUILT: **R39.5/R39.6/R39.7 are ENFORCED** (guards in
`lib/communication-graph.ts` — incl. `AssistantSenderContext`, the ASSISTANT-may-message-only-its-user
block — and `services/element-management-service.ts`). Only **R39.1-R39.4 are UNENFORCED**.

**⚠ THE REAL BLOCKER — a 3-way composition drift the USER must rule on (escalated):**
| Source | Composition |
|---|---|
| **R39.2** (v4.4.0, today) | MANAGER + **MAINTAINER** |
| `lib/ecosystem-constants.ts:283` | MANAGER (planning) + **AUTONOMOUS** (programming) |
| **the built plugin** (2026-06-19) | persona references **autonomous** → built to the OLD spec |
**✅ RESOLVED 2026-07-22 — the USER RE-RULED: composition = MANAGER + AUTONOMOUS** (MANAGER because it
listens to its bound user; AUTONOMOUS because it codes independently — no team, not directed by the
MANAGER; consistent with R39.5). So **R39.2's "MAINTAINER" text (the 2026-07-16 v4.4.0 revision) was the
error**; the built persona + `ecosystem-constants.ts:283` were RIGHT all along. Reconciled this session
(TRDD-R8LJJDBQ commits): **R39.2 CORRECTED → MANAGER+AUTONOMOUS + version bump to GOVERNANCE-RULES v4.5.1**,
`design/specs/governance-spec.md` R39.2 synced, r39 project-memory note's stale "+ MAESTRO" fixed. The built
plugin needs **NO** change (already MANAGER+AUTONOMOUS). Originally reported to the MANAGER in
`ai-maestro-assistant-manager-agent` issue #28 §3.
**STILL OPEN:** only the R39.4 KEEP/STRIP decision below (recommendation: KEEP). The R39.1-R39.4 SURFACE
build stays HELD (transition phase) — this resolution is doc-reconciliation only, not surface-build.

**⚡ UPDATE 2026-07-22 — the USER unblocked the PLUGIN REWRITE and detailed its spec.** (1) Composition
RESOLVED (MANAGER+AUTONOMOUS) + R39 rules REFINED — R39.5/R39.7 revised, R39.8/R39.9 ADDED
(GOVERNANCE-RULES v4.6.0) encoding the ASSISTANT authority model below. (2) The USER supplied a working
folder — **`/Users/emanuelesabetta/Code/ai-maestro-assistant-role-agent`** (copied from the `~/agents/`
LOCAL/D4 source) — and said *"just use this folder for the plugin"*, lifting the out-of-project blocker
for the rewrite. So the plugin-content rewrite is **GO** (in that folder), conforming to the spec below.

**✅ PLUGIN REWRITE DONE 2026-07-22 (commit `e2fa6d4` in `~/Code/ai-maestro-assistant-role-agent`, v0.2.0).**
Persona rewritten to R39.8/R39.9; `team-governance` skill dropped from `.agent.toml` (the approve-others
machinery); `plugin.json` description synced; quad-identity preserved; MANAGER(planning)+AUTONOMOUS(programming)
fusion kept. **Terminology: "the MANAGER"** — the USER RETRACTED the earlier "MAESTRO agent" expression as wrong
(2026-07-22); use "the MANAGER" everywhere (persona + rules reverted, GOVERNANCE-RULES v4.7.1). **Obedience model:**
obeys its USER unconditionally + (only with the user's explicit permission) the MANAGER, whose tasks stay
refusable; does NOT obey the MAESTRO *user*. Rules synced to GOVERNANCE-RULES **v4.7.1** + spec.

**STILL OPEN (USER-only / separate items):** (1) the R39.4 KEEP/STRIP ruling below; (2) comm-graph ENFORCEMENT of
the MANAGER↔ASSISTANT edge (`lib/communication-graph.ts` stays safely stricter — pending); (3) the R39.1-R39.4
UI SURFACE build (auto-create, no-other-terminal, locked-field UI) — still HELD (transition phase); (4) FUTURE:
give the ASSISTANT MAINTAINER-style GitHub-repo skills, and improve the AUTONOMOUS role-plugin's GitHub skills.

## Problem

R39.1 auto-assigns every non-MAESTRO user an ASSISTANT agent (users are human — no terminal/client
of their own, R39). The role-plugin **exists** (above), built to **MANAGER+AUTONOMOUS** — which the
USER RE-RULED (2026-07-22) is the CORRECT composition: MANAGER because it listens to its bound user,
AUTONOMOUS because it codes independently (no team, not directed by the MANAGER), without
agent/team-creation privileges and without governing powers (R46.3). R39.2's momentary "MAINTAINER"
text (v4.4.0, 2026-07-16) was the drift, now CORRECTED to MANAGER+AUTONOMOUS (GOVERNANCE-RULES v4.5.1).
So the gap is NOT "create the plugin" and NOT "re-compose it"; it is only build the still-unenforced
R39.1-R39.4 surfaces (HELD under transition-phase).

## ASSISTANT plugin content spec (USER ruling 2026-07-22) — what the rewrite MUST do

Encoded as GOVERNANCE-RULES R39.8/R39.9 (v4.6.0). The plugin at `~/Code/ai-maestro-assistant-role-agent`
must be rewritten to:

- **STRIP all approve-other-agents machinery** inherited from the MANAGER/AMAMA half: every instruction
  and every script that approves, commands, or sends directives to ANOTHER agent's TRDD. The ASSISTANT
  approves **only its OWN** TRDDs — which are its user's work → **self-mandates (Tier 0)**, needing no
  MANAGER/COS/MAESTRO approval. It **never** asks the MANAGER to approve its own work (R39.8).
- **No AMP to any other agent.** The ASSISTANT cannot message any agent, and no agent may message it —
  **except the MANAGER** (R39.7/R39.9). Its own USER channel is always open.
- **The MANAGER channel is narrow:** the MANAGER may **assign** it a TRDD, but (a) only if the bound USER
  has **approved MANAGER-collaboration**, and (b) the ASSISTANT may **REFUSE any assigned task** — it is
  never a forced mandate target (R41). The MANAGER has **no** power over its CONFIG (config = USER-only via
  UI, R39.4).
- **Peer on shared projects:** on the SAME GitHub project as another agent it acts as a **peer with equal
  authority**, subordinate **only** to its USER (R39.9). Its latitude is deliberate — the USER is free, and
  the ASSISTANT must be free to follow.
- **Scoped, revocable collaboration expansion (R39.10, added 2026-07-22):** once the user permitted MANAGER
  collaboration, the MANAGER may assign ANOTHER agent to collaborate with the ASSISTANT on a specific shared
  GitHub project. Scoped to that, the ASSISTANT becomes MUTUALLY VISIBLE with that collaborator, may exchange
  AMP with it, and may receive kanban tasks on that project (each refusable). This is the ONLY opening of the
  R39.7 invisibility beyond the MANAGER — never general. The USER may STOP/PAUSE/REFUSE at any time.
  (Enforcement of the ASSISTANT↔collaborator AMP + kanban edges is a pending comm-graph build item.)
- **Everything else = a normal AUTONOMOUS agent** (MANAGER planning + AUTONOMOUS programming fusion; no
  governing powers; no agent/team creation).

**FUTURE (noted, not this rewrite):** give the ASSISTANT MAINTAINER-style GitHub-repo skills — and the
**AUTONOMOUS role-plugin itself has long lacked GitHub-repo skills** and should be improved (a separate
follow-up TRDD when scheduled).

**NOT in this plugin rewrite (separate pending items):** the comm-graph ENFORCEMENT of the MANAGER↔ASSISTANT
edge (`lib/communication-graph.ts` — code stays safely stricter than the rule until then), and the
R39.1-R39.4 UI surface build (auto-create-on-user, no-other-terminal UI, the 4 locked fields).

## Approach (design sketch — pending the USER rulings)

1. **Resolve the composition drift (USER ruling required).** Then align the ONE surviving answer
   across all three sources: R39.2's text, the `ecosystem-constants.ts:280-288` comment, and the
   built persona. Whichever wins, the other two are corrected in the same change — this drift exists
   precisely because they were allowed to disagree.
2. **Reconcile the existing plugin** (do not recreate): persona = the ruled composition, MINUS
   agent/team creation, MINUS governing powers (R46.3). Keep its LOCAL/D4 nature — do NOT publish it
   to GitHub or add it to `PREDEFINED_ROLE_PLUGIN_NAMES`.
3. **Persona rules (R39.5/R39.7) — already enforced server-side; make the persona MATCH.** Obeys ONLY
   its bound user — not even the MAESTRO. Isolation. Outside the governance chain: never a mandate
   target (R41), needs no MANAGER/COS/MAESTRO approval. Messages ONLY its own user. Inherits the
   user's tasks/permissions (R39.7). Invisible to other agents.
4. **Comm graph (R6) — VERIFY before touching.** `lib/communication-graph.ts` ALREADY carries the
   ASSISTANT sender/recipient logic (R39.5 ENFORCED). Do not re-add a node; audit the existing one
   against the final rule and sync the adjacency matrix in CLAUDE.md + GOVERNANCE-RULES if it drifts.
5. **Lifecycle (R39.6) — already ENFORCED** in `services/element-management-service.ts` (no
   independent delete; USER delete cascades). Verify, do not rebuild.
6. **Build the genuinely-missing R39.1-R39.4:** auto-create-on-user-creation (R39.1), the
   no-terminal/no-other-agent-access UI (R39.3), and the R39.4 identity locks per the OPEN DECISION.

## Verification
- Role-plugin passes CPV quad-identity + strict validation.
- Creating a normal user auto-creates exactly one ASSISTANT (R39.1/R39.6); deleting the user
  cascades the soft-delete.
- ASSISTANT → any other agent messaging is 403; ASSISTANT ↔ its user works.
- ASSISTANT is never delivered a mandate; acts without MANAGER/COS/MAESTRO approval.
- §0 mirror-sync: comm-graph matrix (CLAUDE.md + GOVERNANCE), personas, GOVERNANCE R39.

## Estimated risk
MED-HIGH. New title + new role-plugin + comm-graph node + user-lifecycle coupling. The R39.4 open
decision gates the profile-panel field locks — resolve it before that sub-task.

## Rollout cohort — multi-host governance (R43-R48), transition phase
Siblings: TRDD-OEG0V589 (migration R44) · TRDD-QR9FSL3Q (groups R45) · TRDD-HR8CES7H (usernames
R47) · TRDD-40CUZA1Z (sidebar R46) · TRDD-PLOVIPZE (console gates R48) · TRDD-OC9ELGSO (transport,
#40). §0 mirror-sync rides each TRDD's Verification.

## Acceptance
- [ ] R39.4 KEEP-vs-STRIP decision confirmed explicitly by the USER (currently only a
      recommendation) before the profile-panel field locks are built.
- [ ] R39.1 built: creating a normal user auto-creates exactly one ASSISTANT agent.
- [ ] R39.3 built: the ASSISTANT UI exposes no other-agent terminal/messaging surface — the
      no-terminal / no-other-agent-access UI is in place, not merely the server-side 403.
- [ ] R39.4 built: NAME/TITLE/ROLE-PLUGIN/TEAM fields are read-only to the bound user and
      changeable only by the MAESTRO (sudo, per R26) — matching the confirmed KEEP/STRIP ruling.
- [ ] Enforcement verified, not just persona text: ASSISTANT → any other agent messaging is
      403 in `lib/communication-graph.ts` (rule text alone is a suggestion — cite the guard
      line, e.g. the `AssistantSenderContext` block, that actually refuses it).
- [ ] ASSISTANT is never delivered as a mandate target (R41) and acts without MANAGER/COS/MAESTRO
      approval on its own TRDDs — verified via a self-mandated TRDD needing no approval log entry
      beyond the ASSISTANT itself.
- [ ] §0 mirror-sync done: comm-graph adjacency matrix (CLAUDE.md + GOVERNANCE-RULES), personas,
      GOVERNANCE-RULES R39 text all agree with the shipped MANAGER+AUTONOMOUS composition.

## Approval log
- 2026-07-16T09:47:54+0200 — MANDATE issued by USER (min-approval-requirement: manager;
  user authority >= manager). Verbatim: *"author all those TRDDs, but wait to implement them."*
  Implementation HELD. R39.4 KEEP/STRIP flagged as an open decision inside this TRDD.

## Notes and lessons learned

- 2026-07-16 — DO NOT infer "X is not built" from a rule's prose, BECAUSE this TRDD was authored
  asserting the ASSISTANT role-plugin "does not exist yet" (echoing R39.2's stale "(still to be
  created)") and planned a from-scratch scaffold into a GitHub repo — while the plugin had existed
  as a complete LOCAL/D4 plugin since 2026-06-19 and R39.5/R39.6/R39.7 were already ENFORCED with
  real guards. A rule states INTENT; only the filesystem, the enforcement map, and the code state
  FACT. DO check the disk + `docs/GOVERNANCE-ENFORCEMENT-MAP.md` verdicts before writing "not built"
  into a plan. Caught only because the USER demanded verification before acting.
- 2026-07-16 — A rule, a code comment, and the artifact can all disagree at once (R39.2 says
  MANAGER+MAINTAINER; `ecosystem-constants.ts:283` says MANAGER+AUTONOMOUS; the built persona says
  autonomous). When they do, the drift itself is the finding — escalate it rather than picking the
  source that happens to be newest.
- 2026-07-22 — RESOLUTION of the above (and proof of the lesson): the USER ruled MANAGER+AUTONOMOUS.
  The **newest** source (R39.2 v4.4.0, "MAINTAINER") was the WRONG one; the older code comment + the
  built persona were right. Had we auto-picked "newest wins" we'd have re-composed a correct plugin
  into a wrong one. DO NOT resolve a governance-vs-code drift by recency; escalate to the USER, whose
  intent is the tie-breaker. R39.2 CORRECTED → GOVERNANCE-RULES v4.5.1; spec + r39 memory note synced.
