---
trdd-id: HW72YBZW
title: Build the ASSISTANT-MANAGER channel and drop the superseded MAESTRO grant
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: todo
created: 2026-07-30T13:09:14+0200
updated: 2026-07-30T13:09:14+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: true
derived-kind: eht
parent-trdd: SPS63XHA
relevant-rules: [R39, R41]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

The implementation half of the TRDD-SPS63XHA ruling, which decided *which side is authoritative*
(the TEXT) and explicitly deferred the code change to a separate card.

**The ruling's one OPEN question is now ANSWERED, by reading R39.5's messaging clause in full as it
instructed.** R39.5 says the ASSISTANT *"may message **only its own user and the MANAGER** — the
single agent it may exchange messages with (R39.9); every other agent is unreachable in both
directions"*, and separately that it obeys *"no one else — not the MAESTRO **user**"*. So:

- `recipientIsActiveMaestro` is a SEPARATE disjunct from `recipientIsOwnUser`
  (`lib/communication-graph.ts:365`), therefore a genuinely BROADER grant, not the
  "own user who happens to be the maestro" case (that one is already `recipientIsOwnUser`).
- It is code LOOSER than the text — the one direction the ruling's principle forbids.
- The alternative reading the ruling floated (that it is the MANAGER channel under the retracted
  name *"the MAESTRO agent"*) does not survive: the branch's own comment and the type field both say
  MAESTRO, and `AssistantSenderContext` has **no `recipientIsManager` field at all**, so there is
  nothing misnamed — the channel simply does not exist.

**AND THE WHOLE BRANCH IS UNREACHABLE, which is why this is a LATENT hole and not a live one.**
`assistantSender` is declared once, read once in `validateMessageRoute`, and constructed **only in
tests** — no route, service, or handler supplies it, so at runtime an ASSISTANT sender always falls
through to the fail-closed deny. Pinned by `tests/unit/communication-graph-user-routing.test.ts`
("NO PRODUCTION CALLER builds an assistantSender block"), which reddens the moment a producer is
wired. Neuter recorded: adding a real producer to a `lib/` file reddens exactly that test.

NEXT ACTION: do BOTH halves in ONE commit, because doing either alone is a regression. Adding the
producer without fixing the grant activates the over-broad edge; removing the grant without adding
the MANAGER channel leaves the ASSISTANT with no agent channel at all, which the text requires it to
have.

## Proposed fix

1. `AssistantSenderContext` gains `recipientIsManager: boolean` and DROPS `recipientIsActiveMaestro`.
2. The R39.5 branch allows `recipientIsOwnUser || recipientIsManager`, and its comment states the
   post-2026-07-22 shape.
3. The MANAGER channel carries **only a refusable, USER-gated task assignment** (R39.9) — never a
   command, never a mandate (R41 holds). That gate is part of this card, not a follow-up: a channel
   without it is a command channel the rule does not grant.
4. R39.10's MANAGER-assigned collaborator edge (scoped + revocable, on a shared repo) is the same
   relational shape — decide in this card whether it lands here or as a sibling.
5. Wire the producer(s) so the branch is reachable, and delete the no-producer test in the SAME
   commit (it exists to force this card, so it must not become a permanent lock).
6. Re-upgrade the R39.5/R39.7 map rows from CONTRADICTED, with the new citation and this card's test.

## Verification

- The superseded-shape test (`ASSISTANT → active MAESTRO = allow`) INVERTS to a deny, and its comment
  is replaced by the current-shape reasoning.
- A new test: ASSISTANT → MANAGER allowed only with the USER-gated flag set, denied without it.
  Proven by a neuter of the gate, not of the edge.
- `tests/unit/communication-graph-assistant.test.ts` invisibility cases stay green — the MANAGER is
  an EXCEPTION to invisibility, not its removal.

## Estimated risk

MED-HIGH. This is a comm-graph edge on a security boundary; the failure mode of getting the gate
wrong is an agent commanding a user's ASSISTANT. Mitigated by the branch being unreachable today, so
the change starts from deny-all rather than from a live edge.

## Approval log

- 2026-07-30T13:09:14+0200 — FILED, `min-approval-requirement: manager`. NOT a mandate: it changes
  the comm-graph's shape on a security boundary, which the parent ruling was careful to keep out of
  the agent's own hands. The ruling's open question is answered IN THIS CARD (above) rather than by
  editing code, so the answer is reviewable before anything is built.
