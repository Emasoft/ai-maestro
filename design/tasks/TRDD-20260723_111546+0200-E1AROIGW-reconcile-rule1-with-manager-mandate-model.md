---
trdd-id: E1AROIGW
title: Reconcile the global RULE-1 autonomy-boundary with the MANAGER-mandate model so fleet agents execute mandates
column: dev
created: 2026-07-23T11:15:46+0200
updated: 2026-07-23T11:31:17+0200
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

**NEXT ACTION (verification — the whole point):** re-run SCEN-031 with a FRESH fleet so the workers
load the amended global RULE-1 + this seeded bullet from turn 1, and confirm the AUTONOMOUS dev BUILDS
on the MANAGER's mandate with zero human go-ahead (product code + feature branch + PR appear). The
current deadlocked fleet (scen031-manager, zipsearcher-dev, zipsearcher-maintainer + repo
`Emasoft/zipsearcher`) is a documented FAIL that cannot recover in-place — clean it up first.

**Surface 3 (cross-repo EHT, still open):** file persona-clarification issues on the worker role-plugin
repos (`ai-maestro-autonomous-agent`, `-maintainer-agent`, `-programmer-agent`, …) and FLAG to the USER
that RULE-1 sub-clauses 1.2/1.5/1.6 still say "the user" (their file, their call).

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
