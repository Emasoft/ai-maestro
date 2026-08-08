---
trdd-id: 0FCR6KOW
title: RP-spec rule — every role plugin main agent must enumerate its own skill menu
column: complete
created: 2026-08-08T12:01:51+0200
updated: 2026-08-08T12:40:00+0200
current-owner: ai-maestro-hub-session
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
project-id: ai-maestro
labels: [fleet-readiness, role-plugins, spec]
external-refs: []
---

# RP-spec rule: the main agent enumerates its own skills

## Why (measured 2026-08-08 at the 10 remote tips)

The skill-menu convention exists de facto and unevenly: COS enumerates its skills 64×, AMAMA
richly, programmer minimally, others not at all. Nothing in `design/specs/role-plugins-spec.md`
mandates it. The failure mode is documented and real: the programmer session found agents
booting without knowing their own procedures (the disable-model-invocation preload exclusion,
now fixed fleet-wide) — an agent that cannot SEE its skill inventory does not reach for it, and
skill descriptions alone under-trigger for role-specific procedures.

## The rule (draft RP-SKILL-MENU-01)

Every role plugin's MAIN agent file MUST carry a compact skill menu: one line per shipped
skill — name + when-to-reach-for-it — kept in sync with `skills/` (a stale menu is worse than
none; the publish gate should count menu lines vs shipped SKILL.md files). Subagents are
exempt (they receive task-scoped prompts).

## Scope

- This card: the spec edit in THIS repo (design/specs/role-plugins-spec.md) + notifying the
  role-plugin sessions that the rule exists with a compliance-by-next-release expectation.
- Per-plugin menu authoring: each plugin's own Tier-0 card.

## Acceptance

- [x] RP-SKILL-MENU-01 added (spec 1.1.0, eaf609ad; programmer row corrected a00e64f6) to role-plugins-spec.md (version bumped per spec convention)
- [x] Conformance suite green (no census pins this spec — verified by consumer grep before editing) after the edit (spec census tests may pin clause counts — re-derive
      the census by grep, never copy from failure output)
- [x] Fleet notified (6 sessions + maintainer#36, 2026-08-08 ~12:45) (the live sessions + a line in the next work orders)

## Approval log
