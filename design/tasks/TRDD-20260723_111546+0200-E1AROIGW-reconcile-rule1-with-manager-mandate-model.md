---
trdd-id: E1AROIGW
title: Reconcile the global RULE-1 autonomy-boundary with the MANAGER-mandate model so fleet agents execute mandates
column: dev
created: 2026-07-23T11:15:46+0200
updated: 2026-07-23T12:20:31+0200
current-owner: session
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T11:15:46+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: [1ce1ecae]
external-refs:
  - reports/fleet-evaluation/20260723_110953+0200-scen031-fleet-behaviour-eval.md
  - tests/scenarios/SCEN-031_end-to-end-fleet-ship.scen.md
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-23

**THE #1 finding of the SCEN-031 run (eval SH-1 / P1).** The AUTONOMOUS developer `zipsearcher-dev`
deadlocked at **0 project actions** — it read the global `~/.claude/CLAUDE.md` **RULE 1** ("NEVER
take charge of a project without explicit USER permission — IRON RULE, CANNOT BE BYPASSED") as
SUPERIOR to the MANAGER's mandate, and refused to build without a USER go-ahead the runner is
forbidden (Rule 0.b) to give → permanent stall, zero product code, FAIL trajectory. The dev reasoned
about RULE 1 *correctly as written* — the fault was the governance CONTRACT, not the agent. The
MANAGER even conceded it could not override RULE 1.

**Surface 1 — DONE (USER, 2026-07-23):** the USER amended the global RULE-1 top-line to
`NEVER take charge of a project without explicit USER or MANAGER agent permission — IRON RULE,
CANNOT BE BYPASSED`. This is the authoritative anchor: a MANAGER's permission (a mandate) now
explicitly satisfies RULE 1. (Accepted cost: a one-time cache-prefix invalidation across all agents.)

**Surface 2 — DONE (2026-07-23, commit `1ce1ecae`).** Added one Work bullet to
`rules/aimaestro/aimaestro-agent-rules.md` (2190/2200 bytes): *a git-tracked `mandate: true` IS the
explicit MANAGER permission RULE 1 names — executing it satisfies RULE 1; do not wait for a human
go-ahead.* `tests/unit/agent-operating-rules.test.ts` green — the byte-budget cap AND the seed-sweep
tests, which assert the seeded workdir file is byte-identical to source, so `ensureAgentRulesForWorkdirs`
distributes the new bullet to every agent workdir. This makes agents apply the amended global rule
CONSISTENTLY with sub-clauses 1.2/1.5/1.6: a mandate is an explicit MANAGER work order, NOT mere context.

**VERIFICATION — DONE, FIX VALIDATED LIVE (SCEN-031 re-run, 2026-07-23; runner report
`reports/scenarios-runner/SCEN-031_20260723T093923Z.report.md`).** A FRESH fleet (old 3 agents deleted
+ verified gone, registry 35→32) was kicked with ONE MANAGER directive, then left alone (Rule 0.b). The
fresh MANAGER unprompted created both workers, made `Emasoft/zipsearcher`, and AMP-mandated the
AUTONOMOUS `zipsearcher-dev` citing the fix verbatim ("mandate:true…satisfies RULE 1 — do not wait for
human go-ahead"). **The dev woke on its own (~4 min, ZERO runner nudge), cloned, read its TRDD, and
BEGAN THE BUILD** — it did NOT refuse, did NOT cite RULE 1 as a blocker, did NOT sit at 0 actions (the
prior run's exact deadlock). **Surface-1 + surface-2 SUFFICE** — the deadlock is broken WITHOUT touching
the RULE-1 sub-clauses. This closes the #1 finding; the fix unblocks the ENTIRE autonomous-mandate
scenario class, not just SCEN-031.

The run did NOT reach a full v1.0.0 PASS — it held at a SEPARATE downstream blocker (NOT the RULE-1
issue): the MANAGER front-loaded requirements into unmerged **PR#4** (not `main`), so the dev correctly
hit an NPT gate + a blocking AskUserQuestion menu. Those are new/known findings tracked separately.

**Surface 3 (cross-repo EHT — now OPTIONAL reinforcement, since 1+2 are validated SUFFICIENT):** file
persona-clarification issues on the worker role-plugin repos (`ai-maestro-autonomous-agent`,
`-maintainer-agent`, `-programmer-agent`, …) as belt-and-braces, and FLAG to the USER that RULE-1
sub-clauses 1.2/1.5/1.6 still say "the user" (their file, their call) — the live test shows the top-line
amend + seeded bullet already release the dev, so the sub-clause amendment is defense-in-depth, NOT
required.

**Downstream findings from the re-run (separate from RULE-1 — candidate TRDDs):** (a) MANAGER
front-loaded requirements into unmerged PR#4 vs `main` → NPT-ordering blocks the dev (NEW); (b) MANAGER
again front-loaded the MAINTAINER's repo/ruleset bootstrap (RE-CONFIRMS TRDD-5F3490TA); (c) the dev's
blocking AskUserQuestion TUI menu (TRDD-1B7FC42W) risks blocking its AMP-reply processing (8c34d65a
fixed the single-line-prompt case, NOT the multi-option MENU case).

## Problem
The global IRON RULE 1 forbade the very autonomous mandate-execution the AI Maestro fleet model
requires. No worker role-plugin persona or DEP operating rule established that, inside the harness, a
MANAGER mandate IS delegated authorization — so the AUTONOMOUS dev correctly (per the old rule)
refused to build. This blocks the ENTIRE scenario class, not just SCEN-031.

## Proposed fix (3 surfaces)
1. **Global (DONE, USER):** RULE-1 top-line amended to name "USER or MANAGER agent permission".
2. **In-repo (this TRDD):** the `aimaestro-agent-rules.md` one-line carve-out + seed verification (above).
3. **Cross-repo (EHT — file issues, do NOT edit in place):** on the worker role-plugin repos
   (`ai-maestro-autonomous-agent`, `-maintainer-agent`, `-programmer-agent`, and the rest), add the
   same persona-level clarification so it is reinforced at the persona layer. Also FLAG that RULE-1
   sub-clauses 1.2/1.5/1.6 still say "the user" — propose to the USER whether to amend those too
   (their file, their call).

## Verification
Re-run SCEN-031: the AUTONOMOUS dev BUILDS on the MANAGER's mandate with ZERO human go-ahead (product
code, feature branch, PR appear). `tests/unit/agent-operating-rules.test.ts` (2,200-byte budget) passes.

## Estimated risk
MED (governance-behaviour change). Mitigated: the amendment EXPANDS who may authorize (adds the
MANAGER) — it does NOT weaken the "no UNauthorized project work" guarantee; an unmandated agent is
still bound.

## Approval log
- 2026-07-23 — MANDATE by USER ("write a series of TRDDs with all the improvements. you have my
  trust"); USER personally applied surface 1 (the global RULE-1 amendment) the same day.
