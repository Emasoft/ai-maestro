---
trdd-id: H18PO5YJ
title: Finalize ai-maestro to a 3-role-plugin governance model (MANAGER/MAINTAINER/AUTONOMOUS) for the PR
column: design
created: 2026-07-21T21:45:10+0200
updated: 2026-07-21T21:52:00+0200
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
- **Role-plugins (8):** `lib/ecosystem-constants.ts` (`ROLE_PLUGIN_{MANAGER=ai-maestro-assistant-
  manager-agent, COS, ARCHITECT, INTEGRATOR, ORCHESTRATOR, PROGRAMMER, MAINTAINER, AUTONOMOUS}`),
  surfaced via `GovernanceTitle` (8-value union, `types/governance.ts`), `TITLE_PLUGIN_MAP`,
  `PLUGIN_COMPATIBLE_TITLES`, `PREDEFINED_ROLE_PLUGIN_NAMES`, the 8×8 comm graph
  (`lib/communication-graph.ts`), the DEP overlays (`rules/aimaestro/*`), and 8 external repos.
- **Fleet is ALREADY ~3-role-shaped:** 23 live agents — 13 `none` + 7 `autonomous` (→ AUTONOMOUS),
  2 `maintainer` (already there), **1 `architect`** (the only off-target title), **0 MANAGER** and
  **0** of COS/ORCHESTRATOR/INTEGRATOR/MEMBER. So fleet reassignment is tiny: 1 agent + create a MANAGER.

### RECOMMENDED SHAPE (my judgment; awaiting USER confirm on the 3 forks below)
**Restrict-to-3, keep 5 dormant** — non-destructive, reversible, mandate-aligned
("prefer integrating over deleting"), fastest to a working version. Keep the `GovernanceTitle`
union + comm graph + 5 role-plugin repos as code; expose ONLY MANAGER/MAINTAINER/AUTONOMOUS in the
wizard, marketplace listing, `PREDEFINED_ROLE_PLUGIN_NAMES`, and `TITLE_PLUGIN_MAP`. A later pass
can collapse the type union if the "final form" wants it — restrict is a stepping stone, not a wall.

### OPEN FORKS — awaiting USER (asked 2026-07-21, no response in 300s; using safe defaults meanwhile)
1. **Reduction shape:** restrict-to-3-keep-dormant (default, safe) **vs** collapse the type union to 3
   (clean but a large breaking refactor across hundreds of sites).
2. **MANAGER "created anew":** adapt the existing `ai-maestro-assistant-manager-agent` (AMAMA — reuse,
   already MANAGER-titled with approval skills) **vs** author a brand-new role-plugin repo. NB: both
   live in a SEPARATE GitHub repo — per the cross-project rule this repo can only do the SERVER-side
   wiring; the plugin itself is authored/adapted in its own repo. **COORDINATED with AMAMA's Claude on
   Emasoft/ai-maestro#66 (2026-07-21):** gave it the 3-role direction, answered its Q1-Q7 in the new
   frame, recommended *adapt AMAMA*, and asked what it needs from the server side. Awaiting its reply +
   the USER's fork confirm.
3. **Branch litter:** delete the 224 backup/worktree branches now **vs** leave them (inert). Deferred
   by default — destructive, and some are ahead-of-gov (RULE 0: no delete without explicit go).

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

## Approval log
- 2026-07-21T21:45:10+0200 — MANDATE (goal user-directed). The 3 SHAPE forks await USER confirm before
  execution proceeds past `design`; asked via the dashboard, no response in 300s — proceeding on safe
  defaults (restrict / adapt / defer-branch-delete) and documenting here.
