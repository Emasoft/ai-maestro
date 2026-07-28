---
trdd-id: C9LXXT76
title: R9.13 says HARD REJECT but ChangeTitle G17 persists a quarantined role-less agent
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-07-27T11:48:15+0200
updated: 2026-07-27T12:40:00+0200
created-by: ai-maestro-claude
current-owner: ai-maestro-claude
assignee: ai-maestro-claude
task-type: docs
min-approval-requirement: user
approved: true
approval-judge: user
approval-datetime: 2026-07-27T12:20:00+0200
mandate: true
mandated-by: user
derived: false
priority: 2
severity: medium
effort: small
release-via: none
labels: [governance, text-code-drift, r9.13, aio]
relevant-rules: [9]
npt: []
eht: []
blocked-by: []
external-refs:
  - docs/GOVERNANCE-ENFORCEMENT-MAP.md:117 (R9.13 row — CONTRADICTED, no guard, no test)
  - design/tasks/TRDD-20260621_224613+0200-47a35ba2-audit-remediation.md (SF5 — treats the quarantine as *enforcing* R9.13)
---

# R9.13 says HARD REJECT but ChangeTitle G17 persists a quarantined role-less agent

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-27

- **Status: RESOLVED — Option A, by USER ruling 2026-07-27.** The USER named the general
  procedure **FAAF (Fail-And-Activate-a-Fallback)** and settled the contradiction in favour of
  the code: a pipeline whose FAILURE would itself leave the system invalid does not restore the
  prior state — it activates a fallback. Quarantined-and-inert is a valid state.
- **What landed:**
  1. `design/specs/all-in-one-spec.md` §AIO-FAAF (new, spec-version 1.1.0) — FAAF as the THIRD
     outcome beside COMPLETE and REVERTED, with clauses 01-05 and the USER's ruling verbatim.
  2. `docs/GOVERNANCE-RULES.md` R9.13 amended — "MUST NOT leave an agent RUNNABLE with zero
     role-plugins"; revert when a clean restore exists (CreateAgent), FAAF when it does not
     (ChangeTitle).
  3. The enforcement-map row moved `CONTRADICTED` → `ENFORCED` with three real citations.
- **The bug this uncovered (fixed, and the reason the work was worth doing):** AIO-FAAF-04 says a
  quarantine flag is only real if some guard refuses to act on it. The `roleMissing` refusal
  existed ONLY in `app/api/agents/[id]/wake/route.ts`, while `services/headless-router.ts` calls
  `wakeAgent()` directly — so under `MAESTRO_MODE=headless` a quarantined agent woke normally,
  persona-less, sharing the fleet's single `gh` identity. The gate now lives in `wakeAgent`
  itself (Gate 1b). This also **overturns TRDD-47a35ba2's SF4 "REFUTED"** verdict, which had been
  reached by matching a COMMENT that cited the rule rather than a guard that enforced it.
- **NEXT ACTION:** none — closed. Both behaviours are pinned with recorded neuter runs.

## Problem

`docs/GOVERNANCE-ENFORCEMENT-MAP.md:117` records `R9.13 | CONTRADICTED | — | —`: no guard, no
test. The obvious reading is that the citation is stale, because `ChangeTitle::G17` plainly
contains an R9.13 enforcement path (its own ops line is `G17: R9.13 VIOLATION — …`).

That reading is wrong, and the map is right. The rule and the code disagree about the remedy.

**R9.13 as written** (`docs/GOVERNANCE-RULES.md:483`):

> CreateAgent, ChangeTitle, ChangeClient, ChangeTeam, and RegisterAgentFromSession MUST **reject**
> any desired state that would leave an agent with zero role-plugins. The only valid "no
> role-plugin" window is the transient instant inside a Change\* pipeline between uninstall and
> install — **the agent is never persisted in that state.**

**What `ChangeTitle::G17` actually does** (`services/element-management-service.ts`,
`enforceRoleOrHibernate`): it does not reject. The title was already written at G14. G17 retries
the install once, and if the agent is still role-less it sets `roleMissing: true`, hibernates the
agent, and emits a ledger op. The pipeline returns **success**.

So the agent *is* persisted with zero role-plugins. The rule forbids exactly that.

## Root cause

Not a bug in either artifact — a divergence that was never adjudicated.

G15 uninstalls the old role-plugin; G16 only WARNs on a failed install. The authors of the
recovery (TRDD-51ed3b0b / TRDD-c7a81642, and SF5 in TRDD-47a35ba2) correctly saw that a failed
install would otherwise leave a titled, role-less agent, and closed it with a forward-repair —
the same strategy as `ChangePlugin::PG04`. TRDD-47a35ba2 describes that path as "the recovery
re-scan that **enforces** R9.13", i.e. they read quarantine as satisfying the rule.

The rule's text says the opposite. Nobody reconciled the two, so the map recorded the honest
verdict — CONTRADICTED — and the guard went uncited and untested.

## Proposed fix — pick ONE (this is a governance decision, not mine to make)

**Option A — amend the rule to permit a quarantined state (recommended).** Change R9.13 to:
*"…MUST NOT leave an agent RUNNABLE with zero role-plugins. A pipeline that cannot restore a
required role-plugin MUST persist `roleMissing: true` and hibernate the agent, which `wakeAgent`
refuses to wake."* Then update the map row to `ENFORCED | ChangeTitle::G17 | <test>`.

Why this is the better option on the merits:
- **The security gap R9.13 exists to close is already closed by the quarantine** — TRUE, but
  ONLY AFTER the fix this TRDD produced. The rule's own rationale is that a persona-less agent
  "could destroy other agents' working directories, force-merge PRs, or mutate shared registry
  state". A hibernated agent does none of those, and the wake path now refuses to wake a
  `roleMissing` agent at `services/agents-core-service.ts:2066-2087` (`wakeAgent` Gate 1b,
  added 2026-07-27, pinned by `tests/services/agents-core-service.test.ts`).

  > **CORRECTION — the sentence this replaces was FALSE, and how it got written is the
  > lesson.** It read: *"`wakeAgent` (`services/agents-core-service.ts` ~:1958-1973) enforces a
  > `roleMissing` 409 — so the quarantine is effective, not cosmetic (verified in
  > TRDD-47a35ba2's SF4 refutation)."* Every part of that is wrong. `wakeAgent` enforced no such
  > thing; the only refusal lived in the Next.js ROUTE, so the headless path bypassed it. And
  > lines 1958-1973 contain ZERO occurrences of `roleMissing` — they are a comment block plus
  > the `enforceAgentInvariants` call.
  >
  > I did not verify any of it. I lifted the claim AND its line range verbatim from a previous
  > session's SF4 verdict and wrote the word **"verified"** in front of it. A second-hand report
  > is a HYPOTHESIS, whatever confidence the reporter expressed; it becomes a fact only when I
  > run the grep myself. One `grep -n roleMissing` — the command that later found the real bug —
  > would have caught it at authoring time. USER instruction, 2026-07-27: *"if a sub-agent
  > reports something, ask him to tell you the exact line of code, grep it yourself and verify."*
- **A true reject at G17 would be more dangerous than the quarantine.** By G17 the pipeline has
  already written the title (G14) *and* mutated host-wide governance (G10-G13: `removeManager`,
  block-all-teams, cleared team COS/ORCH). Rejecting there means rolling all of that back, and a
  failed rollback of a MANAGER demotion is the host-wide DoS that TRDD-EE5YX5LF was filed and
  fixed for. Trading a safe terminal state for a rollback that can itself fail is a bad trade.
- It aligns R9.13 with `ChangePlugin::PG04`, which already forward-repairs the same invariant.

**Option B — change the code to honour the text.** Make G17 refuse and roll back the title +
governance mutations. This costs the compensation machinery described above and reintroduces the
EE5YX5LF failure mode. I do not recommend it, but it is the option that leaves the rule untouched.

## Verification

Independent of which option is chosen, the current behaviour is pinned so it cannot drift while
the decision is pending:

- `tests/governance/r3-r9-team-governance.test.ts` — `ChangeTitle::G17` R9.13 characterization
  test: a required role-plugin whose install keeps failing ⇒ `roleMissing: true` is written AND
  the agent is hibernated AND the ops trace carries `G17: R9.13 VIOLATION`.
- Neuter run recorded in the commit message: removing the `enforceRoleOrHibernate()` call makes
  that named test fail.

On Option A the test needs no change (it already pins the quarantine). On Option B the test is
rewritten to assert the rejection + rollback, and becomes the acceptance criterion for that work.

## Estimated risk

**LOW as filed** — this TRDD changes no code and no rule; it records a contradiction and pins
existing behaviour. The risk lives in the chosen option: Option A is a documentation change
(low); Option B is a pipeline rewrite touching the same gates as TRDD-EE5YX5LF (HIGH).

## Approval log

- 2026-07-27T12:20:00+0200 — MANDATE / APPROVED by USER (min-approval-requirement: user).
  Option A, generalized: the USER named the procedure **FAAF (Fail-And-Activate-a-Fallback)** —
  *"a special PROCEDURE that arises when the failure to execute a all-in-one function will by
  itself cause the system to be in an invalid state. When this happen, the all-in-one function
  will not restore the system exactly as it found at the moment it was executed, but it will
  activate the FAAF."* Recorded in `design/specs/all-in-one-spec.md` §AIO-FAAF; R9.13 amended
  accordingly. Pre-approved: issuer authority (user) >= required approver (user).
- 2026-07-27T12:40:00+0200 — COMPLETED. Spec + rule + map landed; the AIO-FAAF-04 enforcement
  hole found while implementing it (headless wake bypass) fixed and pinned.
