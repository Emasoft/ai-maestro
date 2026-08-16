---
trdd-id: BYCN5PB7
title: MANAGER must land the requirements on main (or an already-merged base) before dispatching the dev — never leave them in an unmerged PR that gates the NPT
column: planned
created: 2026-07-23T12:25:30+0200
updated: 2026-08-16T16:48:46+0200
current-owner: session
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T12:25:30+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: [276cef26]
external-refs:
  - reports/scenarios-runner/SCEN-031_20260723T093923Z.report.md
  - design/tasks/TRDD-20260723_111546+0200-5F3490TA-manager-delegate-repo-bootstrap-to-maintainer.md
  - design/tasks/TRDD-20260723_111546+0200-E1AROIGW-reconcile-rule1-with-manager-mandate-model.md
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-23

**IN-REPO HALF DONE — commit `276cef26`.** The fix below was authored as *cross-repo only*
("file an issue/PR on the MANAGER role-plugin, do NOT edit in place"). That scoping was too
narrow and left the TRDD blocked on someone else's merge queue. **Corrected approach:** the
invariant is not a MANAGER quirk — ANY dispatching agent (MANAGER / COS / ORCHESTRATOR) can
strand a worker the same way — so it now lives in the **governance overlay** as a normative
subsection of `rules/aimaestro/aimaestro-trdd-approval.md` Part B2 ("The dispatch
precondition — never dispatch against an unsatisfiable NPT").

**Why this deploys without any cross-repo action:** `lib/agent-rules-seed.ts` reads
**every** `.md` in `rules/aimaestro/` **live** from `process.cwd()` and seeds it read-only
into each agent workdir (create trigger + wake + the 5-min invariants watchdog). No rebuild,
no plugin republish, no PR merge. This is the same lever that carried the RULE-1 carve-out
(TRDD-E1AROIGW surface 2, `1ce1ecae`) and was **validated live** in the SCEN-031 re-run.

**The rule, as landed:** before moving a TRDD to `dev`, the dispatcher MUST ensure the BASE
the worker branches from already satisfies every NPT that worker's TRDD declares.
Requirements staged in a PR must be merged — or the base otherwise made to satisfy the NPT —
BEFORE dispatch. General form: *do not declare a prerequisite you then leave unmet on the
base you dispatch against; an NPT is a promise to the worker, and the dispatcher owns
keeping it.*

**NOT superseded — still open, and still someone else's:** `Emasoft/ai-maestro-assistant-manager-agent`
**PR #33** ("sequence project-bootstrap NPT + delegate repo creation to MAINTAINER") is the
**persona half** and remains OPEN. It is a DIFFERENT repo — **never merge, tag, or publish
it from here** (cross-repo rule). The two halves are complementary: PR #33 fixes how the
MANAGER *sequences* bootstrap; `276cef26` makes the contract binding on *every* dispatcher
regardless of persona, so the fleet is protected even while PR #33 waits.

**NEXT ACTION:** verification is a SCEN-031 re-run — launched 2026-07-23 after this commit.
Pass criterion: at the moment the MANAGER dispatches the dev, the dev's NPT gate is
satisfiable from `main` (requirements present on the base), with no requirements-only PR
left unmerged while the dev waits.

## Problem (SCEN-031 re-run, 2026-07-23 — the downstream blocker AFTER the RULE-1 fix)

With the RULE-1 deadlock fixed (TRDD-E1AROIGW — the AUTONOMOUS dev now BUILDS on the mandate), the
SCEN-031 re-run held short of a full v1.0.0 PASS at a **new** blocker of the MANAGER's own making. The
MANAGER front-loaded the project requirements into an **unmerged PR (#4, "adopt template and land
requirements")** instead of onto `main`. Hard evidence at hold: `gh pr list` shows PR#4 OPEN;
`repos/Emasoft/zipsearcher/commits` shows `main` = only "Initial commit". The dev cloned, read its
TRDD, and correctly refused to build past the TRDD's STATE-block **NPT gate** ("requirements must be
in place") because the requirements are NOT on the base it branches from — they sit in an unmerged PR.
The dev then flagged the MANAGER via AMP and raised a blocking user-menu. Net: a **self-inflicted NPT
soft-deadlock** — the dev is correct to wait, the requirements are unreachable, and the MANAGER has not
merged PR#4. This is NOT the RULE-1 issue and NOT covered by TRDD-5F3490TA (that is about who CREATES
the repo; this is about the SEQUENCING of requirements delivery vs dev dispatch).

## Proposed fix (cross-repo — file an issue/PR on the MANAGER role-plugin, do NOT edit in place)

On `Emasoft/ai-maestro-assistant-manager-agent` (the MANAGER role-plugin persona), clarify the
project-bootstrap sequence: the base a worker branches from MUST already contain everything the
worker's NPT gate requires. Concretely — land the requirements/spec on `main` (or a base branch that
is merged BEFORE dispatch), THEN hand the dev its build TRDD. If requirements are staged in a PR, the
MANAGER MUST merge that PR (or otherwise make the base satisfy the NPT) **before** telling the dev to
build — never dispatch a dev whose declared NPT is satisfied only by an unmerged PR. Pairs with
TRDD-5F3490TA (delegate repo bootstrap to the MAINTAINER) as the two halves of a correct
MANAGER project-bootstrap workflow.

## Verification

Re-run SCEN-031: at the moment the MANAGER dispatches the dev, the dev's NPT gate is satisfiable from
`main` (requirements present on the base), so the dev proceeds to build without an NPT soft-deadlock;
no requirements-only PR sits unmerged while the dev waits.

## Estimated risk

LOW. Persona-sequencing clarification; no code, no weakening of any gate. It makes the MANAGER's own
NPT contract self-consistent (do not declare a prerequisite you then leave unmet on the base).

## Acceptance
- [ ] In-repo governance-overlay half landed: the dispatch-precondition rule added to
      `rules/aimaestro/aimaestro-trdd-approval.md` Part B2, generalized to ANY dispatching agent
      (MANAGER/COS/ORCHESTRATOR), commit `276cef26` (STATE block claims done — re-verify: text is
      present in the current file and `git show 276cef26` touches it before ticking).
- [ ] Deployment verified live without rebuild/republish: `lib/agent-rules-seed.ts` reads
      `rules/aimaestro/*.md` from `process.cwd()` and seeds it read-only into agent workdirs
      (STATE block claims validated live in the SCEN-031 re-run — re-verify against that run's
      report before ticking).
- [ ] SCEN-031 re-run confirms the pass criterion: at the moment the MANAGER dispatches the dev,
      the dev's NPT gate is satisfiable from `main` (requirements present on the base) with no
      requirements-only PR left unmerged while the dev waits.
- [ ] Cross-repo persona half (`Emasoft/ai-maestro-assistant-manager-agent` PR #33 — "sequence
      project-bootstrap NPT + delegate repo creation to MAINTAINER") merged or explicitly
      resolved — tracked here but actioned only in its own repo, never merged/tagged from here.
- [ ] §0 mirror-sync: `docs/API-CHANGES.md` / governance docs reflect the landed dispatch
      precondition, if applicable.

## Approval log
- 2026-07-23 — MANDATE by USER (improvement series, "write a series of TRDDs with all the
  improvements. you have my trust"). Authored from the SCEN-031 re-run that VALIDATED the RULE-1 fix
  and surfaced this as the next downstream blocker.
