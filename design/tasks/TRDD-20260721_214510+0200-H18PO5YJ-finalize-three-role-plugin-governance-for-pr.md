---
trdd-id: H18PO5YJ
title: Finalize ai-maestro to a 3-role-plugin governance model (MANAGER/MAINTAINER/AUTONOMOUS) for the PR
column: todo
created: 2026-07-21T21:45:10+0200
updated: 2026-08-16T16:51:06+0200
current-owner: ai-maestro
task-type: refactor
scope: project
project-id: ai-maestro
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-21T21:45:10+0200
relevant-rules: []
labels: [finalization, governance, role-plugins, final-form, pr-prep]
external-refs: [Emasoft/ai-maestro#66, Emasoft/ai-maestro#65, Emasoft/ai-maestro-assistant-manager-agent#28]
release-via: none
---

# Finalize ai-maestro to a 3-role-plugin governance model for the PR

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-21

**⛔ REVERTED / MISREAD — 2026-07-22. DO NOT ACT ON ANYTHING BELOW THIS BANNER.**
The "restrict the OFFERED titles to 3 (`ACTIVE_GOVERNANCE_TITLES`)" approach in this TRDD was a MISREAD of the
mandate. The USER clarified: *"i didn't say to remove all titles except those 3 — for the initial test we only
need to get ready those 3 role plugins."* The other titles are NOT removed/hidden. The restrict code was
reverted (`04108dbc`), the wrong memory note removed (`7935c68a`), and the live server rebuilt + restarted
(HEAD `7935c68a`) to UN-deploy it. Everything below (P0 restrict / keep-dormant / P1–P3) is retained ONLY as a
record of the wrong approach.
**CORRECT goal:** get the 3 role-plugins (MANAGER / MAINTAINER / AUTONOMOUS) READY for the initial test —
titles stay unrestricted. Awaiting USER clarification on what "ready" concretely requires (likely role-plugin
readiness, mostly CROSS-REPO — NOT a server-side title-restriction change).

**[superseded — the line below is the reverted claim, kept for the record]** ✅ P0 LANDED — commit `963d3cda` (2026-07-21T22:26). The "run with only 3 role plugins" version WORKS.
SSOT `ACTIVE_GOVERNANCE_TITLES` (`types/agent.ts`) gates the 2 title-offer sites (wizard picker + title-
assignment dialog; dialog keeps the agent's CURRENT title visible). Full 9-title set + `TITLE_PLUGIN_MAP` +
comm graph + role-plugin repos DORMANT/intact. `tsc --noEmit` + `yarn build` green; +1 unit test. **NOT yet
deployed** — working-tree-is-production ⇒ live on the next `pm2 restart` (batch with the T2DVNWVI oracle).

**P1–P3 PAUSED — need USER/AMAMA input (each mutates live fleet, another repo, or requires a push):**
- **P1** reconcile the 1 `architect` live agent → `autonomous` (do it via the now-restricted title dialog —
  it shows the agent's current `architect` + the 3 active — or authorize a server-side `ChangeTitle` run);
  and ensure a MANAGER exists (adapt-AMAMA is CROSS-REPO; awaiting AMAMA's #66 follow-up on server-side needs).
- **P2** MANAGER-handles-all-governance comm-graph collapse — cross-repo persona + server routing.
- **P3** branch-litter delete + the `governance-rules → main` PR — needs USER go (push is USER-gated: ai-maestro
  is NOT a plugin project).

**USER directive (verbatim intent):** *"merge, we cannot have multiple branches now. we need to
finalize so we get toward the ai-maestro final form that we will use to make the PR in the end.
now we need a version capable of running the current governance rules with only 3 role plugins:
MANAGER (created anew, an agent capable of handling all the governance rules), MAINTAINER (all
the plugins that we will import as agents), AUTONOMOUS (all existing agents)."*

**GOAL:** a working ai-maestro whose governance RULES are unchanged but whose ROLE set is exactly
3 — MANAGER (single governance authority), MAINTAINER (imported-plugin agents), AUTONOMOUS
(existing agents) — the minimal usable "final form" that becomes the eventual `governance-rules → main` PR.

### FACTS (verified 2026-07-21)
- **Branches:** governance-rules is the ONLY active line (one worktree @ `5a91b7fb`). The other
  **224 local branches** are all machine-litter (`backup/*`, `worktree-agent-*`, `wt/*`,
  `worktree-wf_*`): every one is fully-merged (0 ahead) or an ancient snapshot (1600-2000 behind).
  **Nothing to merge; no valuable work exists outside governance-rules.** BUT several `backup/*`
  are 79-171 commits AHEAD of gov (commits not in gov) → a blind delete is real loss (reflog-only).
- **Role-plugins — 9 TITLES / 8 predefined (compaction summary said 8; VERIFIED wrong 2026-07-21):**
  `lib/ecosystem-constants.ts` has `ROLE_PLUGIN_{MANAGER=ai-maestro-assistant-manager-agent, COS,
  ARCHITECT, INTEGRATOR, ORCHESTRATOR, PROGRAMMER, MAINTAINER, AUTONOMOUS}` (8, in
  `PREDEFINED_ROLE_PLUGIN_NAMES`) PLUS a 9th `ROLE_PLUGIN_ASSISTANT=ai-maestro-assistant-role-agent`
  (R39.2 — LOCAL source, deliberately NOT in `PREDEFINED_*`, but IS in `TITLE_PLUGIN_MAP` +
  `PLUGIN_COMPATIBLE_TITLES` with title `ASSISTANT`). Surfaced via `GovernanceTitle` union
  (`types/governance.ts`), `TITLE_PLUGIN_MAP`, `PLUGIN_COMPATIBLE_TITLES`, the comm graph
  (`lib/communication-graph.ts`), the DEP overlays (`rules/aimaestro/*`).
  → **Exposed target = {MANAGER, MAINTAINER, AUTONOMOUS} (3); DORMANT = 6** (COS, ARCHITECT,
  INTEGRATOR, ORCHESTRATOR, MEMBER, ASSISTANT).
- **Fleet is ALREADY ~3-role-shaped:** 23 live agents — 13 `none` + 7 `autonomous` (→ AUTONOMOUS),
  2 `maintainer` (already there), **1 `architect`** (the only off-target title), **0 MANAGER** and
  **0** of COS/ORCHESTRATOR/INTEGRATOR/MEMBER. So fleet reassignment is tiny: 1 agent + create a MANAGER.

### RECOMMENDED SHAPE (my judgment; awaiting USER confirm on the 3 forks below)
**Restrict-to-3, keep 5 dormant** — non-destructive, reversible, mandate-aligned
("prefer integrating over deleting"), fastest to a working version. Keep the `GovernanceTitle`
union + comm graph + 5 role-plugin repos as code; expose ONLY MANAGER/MAINTAINER/AUTONOMOUS in the
wizard, marketplace listing, `PREDEFINED_ROLE_PLUGIN_NAMES`, and `TITLE_PLUGIN_MAP`. A later pass
can collapse the type union if the "final form" wants it — restrict is a stepping stone, not a wall.

### DECISION (2026-07-21T22:08 — PROCEEDING under `/go-on-yourself`, session unattended)
The forks were asked; no USER response across 300s + a compaction (session idle). `/go-on-yourself`
= act without waiting approval; the finalization is USER-MANDATED (`approved: true, mandate: true`).
All three forks have SAFE, REVERSIBLE, mandate-aligned defaults — AMAMA endorsed the same frame on
#66 — so I proceed on the defaults and record them here:
1. **Reduction shape → 1a RESTRICT-to-3-keep-6-dormant.** Non-destructive, reversible, a stepping
   stone that does NOT foreclose a later union-collapse. Keeps the `GovernanceTitle` union + comm
   graph + all role-plugin code intact; existing agents on dormant titles keep working.
2. **MANAGER → adapt AMAMA (`ai-maestro-assistant-manager-agent`).** Cross-repo: the persona/skills
   are authored in AMAMA's own repo (I cannot touch it — cross-project rule). **My SERVER-side P0 is
   IDENTICAL either way** — the 3 exposed roles are fixed regardless of adapt-vs-new. AMAMA's pending
   #66 follow-up (what server capabilities it needs) is ADDITIVE/later — P0 does not depend on it.
3. **Branch litter → DEFER.** Destructive; several `backup/*` are 79-171 ahead-of-gov (RULE 0). No
   action without explicit USER go.

### P0 DESIGN (SSOT restrict — the actual code change, reversible)
Add ONE SSOT constant in `lib/ecosystem-constants.ts`:
  `export const ACTIVE_GOVERNANCE_TITLES = ['MANAGER','MAINTAINER','AUTONOMOUS'] as const`
  (+ `ACTIVE_ROLE_PLUGIN_NAMES` derived via `TITLE_PLUGIN_MAP`, + an `isActiveGovernanceTitle()` helper).
Then FILTER every USER-FACING ENUMERATION through it (wizard offered titles, title-assignment dialog,
marketplace/role-plugin listing). Do NOT touch: the `GovernanceTitle` union, `TITLE_PLUGIN_MAP`,
`PLUGIN_COMPATIBLE_TITLES`, `PREDEFINED_ROLE_PLUGIN_NAMES`, the comm graph — those stay full so pure
LOOKUPS for dormant titles keep resolving and existing dormant-title agents don't break. Reversal =
flip the one constant back to the full set.
→ **Exact enumeration sites being mapped by a read-only scout (Explore agent, dispatched 22:08);
edit plan finalized + executed on its return.** Then: tests + `tsc` + build (quality gates), docs
(CLAUDE.md "Agent Terminology" note, GOVERNANCE-RULES), commit (NOT push). Column flips design→dev at
first code edit.

## Phased plan (execute after the forks are confirmed)
- **P0 (safe, in-repo, reversible) — server-side restrict to 3:** narrow `PREDEFINED_ROLE_PLUGIN_NAMES`,
  `TITLE_PLUGIN_MAP`, the wizard's offered titles, and the marketplace listing to
  MANAGER/MAINTAINER/AUTONOMOUS. Keep the union/comm-graph/repos intact. Update tests + docs (CLAUDE.md
  "Agent Terminology", GOVERNANCE-RULES, the marketplace tables).
- **P1 — fleet reconciliation:** reassign the 1 `architect` agent (and any future off-target) to
  AUTONOMOUS via the ChangeTitle pipeline; ensure a MANAGER exists (fork 2 decides how).
- **P2 — MANAGER-handles-all-governance:** the governance authority collapses COS/ARCHITECT/ORCHESTRATOR/
  INTEGRATOR duties into MANAGER for the comm graph + approval routing (cross-repo for the persona;
  server-side for the routing). Derived: comm-graph edges for the dropped titles become unreachable but
  are kept dormant (restrict shape) — verify no route 403s a legitimate MANAGER/MAINTAINER/AUTONOMOUS msg.
- **P3 — branch + PR prep:** (after fork 3) prune litter; confirm CI can run on governance-rules
  (currently 0 check-runs, 1777 ahead of main); open the PR.

## Derived consequences to handle (NPTs when execution starts)
- Existing agents on dropped titles → must reconcile (only 1 today, but the wizard restriction must not
  strand them). 
- `R9.13` (every agent carries exactly one role) must still hold under 3 roles.
- The DEP overlays + GOVERNANCE-RULES still describe the 8-title ladder — decide keep-as-reference vs trim.
- CI has NEVER run on governance-rules — the PR is the first validation of 1777 commits (biggest risk).

## Verification
- `bash scripts/with-node.sh yarn test` + `tsc --noEmit` green after each phase.
- Wizard/marketplace/API expose exactly 3 role-plugins; the 1 architect agent reconciled; a MANAGER exists.
- No comm-graph route wrongly 403s a MANAGER/MAINTAINER/AUTONOMOUS message.

## Acceptance
- [ ] USER clarification obtained on what "ready" concretely requires for MANAGER/MAINTAINER/AUTONOMOUS (server-side work vs cross-repo role-plugin work) — the STATE block records this as still open
- [ ] A MANAGER agent exists in the live fleet (0 today per the FACTS section)
- [ ] The single legacy `architect` live agent is reconciled to a title consistent with the clarified scope
- [ ] `bash scripts/with-node.sh yarn test` and `tsc --noEmit` green
- [ ] No comm-graph route incorrectly 403s a legitimate MANAGER/MAINTAINER/AUTONOMOUS message
- [ ] Branch-litter cleanup (P3) and the `governance-rules → main` PR are either explicitly deferred with USER go recorded, or completed — not silently dropped

## Approval log
- 2026-07-21T21:45:10+0200 — MANDATE (goal user-directed). The 3 SHAPE forks await USER confirm before
  execution proceeds past `design`; asked via the dashboard, no response in 300s — proceeding on safe
  defaults (restrict / adapt / defer-branch-delete) and documenting here.
- 2026-07-21T22:26:29+0200 — P0 (restrict-to-3, restrict-keep-dormant) IMPLEMENTED + committed `963d3cda`
  under `/go-on-yourself` on the safe defaults (1a restrict / 2 adapt-AMAMA / 3 defer-branch-delete). `tsc`
  + `yarn build` green; the only red test is a PRE-EXISTING, unrelated ZONE-MISMATCH corpus lint
  (`4P1M8I18`/`OPNDCKVA` sit in `design/tasks/` while `column: complete`) — fixed in a separate hygiene
  commit, NOT part of P0. Column design→dev. P1–P3 paused for USER/AMAMA input (see STATE block).
- 2026-07-22T00:32:28+0200 — **REVERTED.** The restrict-to-3 approach was a MISREAD (USER: "i only said for
  the initial test we need to get ready those 3 role plugins"). Reverted code `04108dbc`; removed the wrong
  memory note `7935c68a`; rebuilt + restarted to un-deploy. KEPT the unrelated correct commits (`b4887d20`
  corpus hygiene, `fe3061d0` T2DVNWVI oracle). Column dev→todo; awaiting USER clarification on the real
  "ready the 3 role-plugins for the initial test" scope (titles stay unrestricted).
