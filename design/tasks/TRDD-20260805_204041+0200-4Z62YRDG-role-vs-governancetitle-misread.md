---
trdd-id: 4Z62YRDG
title: Stop role from reading as a contradiction of governanceTitle
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-05T20:40:41+0200
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

- [ ] `show <agent>` displays `governanceTitle` (and its absence when unset).
- [ ] A record for a manager-titled agent no longer carries a defaulted
      `role` that reads as a contradiction — or, if item 2 is rejected,
      carries an explicit marker distinguishing default from explicit.
- [ ] The precedence rule is written somewhere an agent reads at runtime.
- [ ] A test asserts that a manager-titled agent's serialized record cannot
      be parsed as title-inconsistent by the documented precedence rule.

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