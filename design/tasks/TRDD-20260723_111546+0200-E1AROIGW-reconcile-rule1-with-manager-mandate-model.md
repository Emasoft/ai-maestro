---
trdd-id: E1AROIGW
title: Reconcile the global RULE-1 autonomy-boundary with the MANAGER-mandate model so fleet agents execute mandates
column: dev
created: 2026-07-23T11:15:46+0200
updated: 2026-07-23T11:15:46+0200
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
implementation-commits: []
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

**NEXT ACTION (surface 2, in-repo, this repo):** add ONE line to `rules/aimaestro/aimaestro-agent-rules.md`
— within its hard **2,200-byte budget** (`tests/unit/agent-operating-rules.test.ts`) — stating:
*a MANAGER mandate (`mandate:true`, git-tracked in the PRRD/TRDD) IS the explicit MANAGER permission
RULE 1 now names; executing it SATISFIES RULE 1 — do not wait for a separate human go-ahead.* Then
verify `lib/agent-rules-seed.ts` (`ensureAgentRules`) distributes it into every agent workdir and the
byte-budget test still passes. This makes agents apply the amended rule CONSISTENTLY with sub-clauses
1.2 ("wait for the user"), 1.5 ("status reports are not work orders"), 1.6 ("context ≠ permission") —
a mandate is an explicit MANAGER work order, NOT mere context.

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
