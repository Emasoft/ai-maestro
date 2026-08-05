---
trdd-id: 4Z62YRDG
title: Stop role from reading as a contradiction of governanceTitle
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-06T00:32:20+0200
implementation-commits: [b9f7e401, 4262889f, 4b039716]
current-owner: ai-maestro
created-by: assistant-manager-agent
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T20:40:41+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [manager-filed, testbot-session, owner-ours]
external-refs: [Emasoft/ai-maestro#122]
---
# Stop role from reading as a contradiction of governanceTitle

## ⏵ RESOLUTION — USER ruling 2026-08-06 (supersedes Scope items 2 and 3)

> "there is no such thing as a `role`. There is the `title`, and there is the
> `role-plugin`. role is not part of the taxonomy."

The field is REMOVED, not conditionally omitted (`4b039716`). Scope item 2's
"omit when never explicitly set" and item 3's `messagingRole` rename are both
moot: there is no field to omit or rename. `createAgent` writes no `role` under
any input; the `loadAgents` migration strips a legacy key WHATEVER its value;
the type surface (Agent, AgentSummary, CreateAgentRequest, UpdateAgentRequest,
AgentSession, GovernanceRequestPayload) no longer declares it.

USER follow-up ruling (2026-08-06, same thread): where `role` was used in a
DECISION (agent validity, plugin compatibility), removal must be a REPLACEMENT
with the `title` field, never a bare deletion. Verified satisfied: the one
decision site that ever read `role` as authority — composition-check's
`(governanceTitle || role || 'unknown')` fallback — was replaced with the
title in `b9f7e401` and is pinned by the falsification-pair test; every line
removed by `4b039716` was a WRITE or dead passthrough. Post-removal sweeps
(typed reads via tsc; untyped casts; runtime `lib/*.mjs` + `server.mjs`;
126 shell scripts), each positive-controlled, found zero remaining readers.

## Problem

`Agent.role` (messaging role, default `'autonomous'`) and
`Agent.governanceTitle` share the `AgentRole` type and therefore the same
value vocabulary. In a serialized record, a defaulted `role: "autonomous"`
on a `governanceTitle: "manager"` agent is indistinguishable from a real
title contradiction.

On 2026-08-05 this caused a live AUTONOMOUS agent to refuse a legitimate
MANAGER mandate and block on a human prompt. Two separate Claude instances
independently misread the same record the same way before either consulted
`types/agent.ts`.

Neither field is buggy. The defect is that the record does not carry enough
information to be read correctly by its intended consumer, and the
disambiguating knowledge lives only in a source comment.

Aggravating factor: `aimaestro-agent.sh show` omits `governanceTitle`
entirely, so the obvious verb does not answer the governance question and
pushes readers toward raw registry JSON, where the two fields sit adjacent.

## Scope

1. Add `governanceTitle` to `aimaestro-agent.sh show` output.
2. Omit `role` from serialized output when it was never explicitly set,
   rather than emitting the default. Verify no consumer depends on the
   defaulted value being present before changing this.
3. Decide whether the serialized/API name can become `messagingRole` while
   the DB column and `AgentRole` type name stay put for compat.
4. Document the precedence rule where agents read it, not only in
   `types/agent.ts`: governance authority is `governanceTitle` alone;
   `role` is never evidence about authority in either direction.

## Acceptance criteria

- [x] `show <agent>` displays `governanceTitle` (and its absence when unset).
      — `scripts/agent-commands.sh::cmd_show`, in `b9f7e401`.
- [x] A record for a manager-titled agent no longer carries a defaulted
      `role` that reads as a contradiction.
      — Satisfied STRONGER than written, per the USER ruling: NO record carries
      a `role` key at all. `createAgent` never writes one (`4262889f` stopped
      the default, `4b039716` removed the field), and the `loadAgents`
      migration strips any legacy key whatever its value. The misread shape is
      now impossible by construction, not merely disambiguated.
- [x] The precedence rule is written somewhere an agent reads at runtime.
      — `rules/aimaestro/aimaestro-agent-rules.md` § Truth, which the server
      seeds into EVERY agent workdir and every agent loads on every turn. That
      is the fix the incident actually calls for: the record was misread by two
      Claude instances who never opened `types/agent.ts`, so a source comment
      was never going to reach them. It now states both directions — `role` is
      not evidence FOR authority and not evidence AGAINST it, and a defaulted
      `role: autonomous` beside `governanceTitle: manager` is a DEFAULT, not a
      contradiction, and not grounds to refuse a mandate.
- [x] A test asserts that a manager-titled agent's serialized record cannot
      be parsed as title-inconsistent by the documented precedence rule.
      — Now pinned at the RECORD level, unblocked by the box above: the
      "role is not part of the taxonomy" describe block in
      `tests/agent-registry.test.ts` asserts (1) createAgent persists NO role
      key, in the returned record AND on disk; (2) a role smuggled by a stale
      caller is IGNORED; (3) the migration strips a legacy key whatever its
      value ('autonomous' AND 'member'), leaving `governanceTitle: manager`
      untouched. Neuter pair OBSERVED (scripts/dev/neuter, restores
      blob-verified): re-adding the write → exactly the 2 createAgent pins
      red; narrowing the migration to `=== 'autonomous'` → exactly the
      migration pin red. Disjoint sets — each guard attributed to its own test.
      The other half stands: `tests/governance/authority-never-reads-role.test.ts`
      (source ratchet, no production site reads role as authority) and
      `tests/governance/composition-check-title-authority.test.ts`, whose
      fixtures DELIBERATELY keep seeding a `role` key into mock data — legacy
      records may carry it until the migration runs, and the route must ignore
      it even then.

## Non-goals

- Renaming the `AgentRole` type or the DB column. Line 483 states these are
  kept for backward compat; this TRDD does not relitigate that.
- Changing messaging-role semantics or defaults in behaviour. This is about
  what a reader can conclude from a record, not about what the field does.

## Verification

Reproduce the original misread: take a manager-titled agent's serialized
record, hand it to a reader with no access to `types/agent.ts`, and confirm
that the correct governance conclusion is now reachable from the record
alone. That is the actual failure mode — not a unit-test-shaped one, so
test it as it actually failed.

**Closed 2026-08-06:** the reproduction is now impossible by construction — a
serialized record cannot carry a `role` key (never written; stripped on load),
so the ambiguous shape the two Claude readers misread no longer exists. The
runtime precedence rule (`aimaestro-agent-rules.md` § Truth) remains as the
guard for the transition window before a host's migration has run.

## Approval log

- 2026-08-06T00:32:20+0200 — COMPLETED by ai-maestro (mandate, mandated-by:
  user). All 4 boxes checked; USER ruling recorded verbatim in RESOLUTION;
  code in b9f7e401 + 4262889f + 4b039716; neuter pair observed and disjoint.