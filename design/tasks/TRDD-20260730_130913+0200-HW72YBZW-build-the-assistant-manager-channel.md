---
trdd-id: HW72YBZW
title: Build the ASSISTANT-MANAGER channel and drop the superseded MAESTRO grant
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: todo
created: 2026-07-30T13:09:14+0200
updated: 2026-08-16T16:51:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
derived: true
derived-kind: eht
parent-trdd: SPS63XHA
relevant-rules: [R39, R41]
blocked-by: []
npt: []
eht: []
implementation-commits: [bb910a7f]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

The implementation half of the TRDD-SPS63XHA ruling, which decided *which side is authoritative*
(the TEXT) and explicitly deferred the code change to a separate card.

> ⚠ **THE NEXT THREE PARAGRAPHS ARE THE PRE-FIX DIAGNOSIS (2026-07-30) — SUPERSEDED by the
> `bb910a7f` section below.** They are kept because they carry the REASONING that justified the
> change, but they describe `recipientIsActiveMaestro` in the PRESENT tense and it no longer
> exists. Do not act on them; read the ✅ section for what is true now.

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

## ✅ HALF 1 IS DONE (`bb910a7f`) — and the old NEXT ACTION is SUPERSEDED, 2026-07-31 19:15

It said *"do BOTH halves in ONE commit, because doing either alone is a regression"*. That was
right when the grant was still over-broad; it is now **impossible as written and wrong twice over**.

**What landed** (`bb910a7f`): `recipientIsActiveMaestro` is GONE — it was a separate disjunct from
`recipientIsOwnUser`, i.e. a genuinely broader grant reaching the MAESTRO *user*, whom R39.5 names
as someone the ASSISTANT does not answer to. Replaced by `recipientIsManager` gated on
`userPermitsManagerCollaboration` (R39.9), with the two denials kept DISTINCT (merged, any neuter of
the gate reads identically to the no-edge case). A test had ASSERTED the defect; it is inverted, with
the history in its comment. Neuters: gate-always-open → 2 red; over-broad human grant → 1 red. 151/151.

**HALF 2 IS NOT A WIRING COMMIT — it is a FEATURE, and this is measured, not estimated.** Three
things the producer needs do not exist ANYWHERE in production:

| Needed | Present in production? |
|---|---|
| which USER an assistant is bound to | **no** — `recipientIsOwnUser` / `boundUser` / `ownAssistant` have **zero** non-test references |
| `userPermitsManagerCollaboration` storage | **no** — the symbol lives ONLY in `lib/communication-graph.ts` (the type + the read) and in the test |
| a surface for the user to GRANT it | **no** — no route, no setting, no UI |

`assistant` IS a real title (`types/agent.ts:486`), so the title half is fine; it is the RELATIONAL
half that is absent. Wiring a producer therefore means designing a persistence model for an
assistant→user binding AND a standing per-assistant permission — whose storage, default, and
revocation are a **governance decision under R39.9**, not an implementation detail. Defaulting it
wrong in either direction is a real error: default-on grants a channel the user never approved;
default-off with no UI makes R39.9 permanently dead letter.

**So the honest state: there is NO live hole.** The branch is still unreachable at runtime (the
ASSISTANT sender falls through to the fail-closed deny), and
`tests/unit/communication-graph-user-routing.test.ts` pins that with the "NO PRODUCTION CALLER
builds an assistantSender block" lock, which reddens the moment a producer appears.

**NEXT ACTION — a DECISION, then a separate card.** Ask the USER how the standing permission is
stored and what it defaults to; that answer is the card. Until then this one stays in `dev` with
half 1 landed. Do NOT "just wire it" with an invented default — and when the producer does land, the
SAME commit must delete the lock test and re-upgrade the CONTRADICTED R39.5/R39.7 rows in
`docs/GOVERNANCE-ENFORCEMENT-MAP.md`, which the lock test names.

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

## Acceptance
- [ ] A persistence model exists for the assistant→user binding (`recipientIsOwnUser`/`boundUser`/`ownAssistant` has a real, non-test production reference)
- [ ] `userPermitsManagerCollaboration` (R39.9 standing permission) is persisted somewhere, with a stated default and revocation path
- [ ] A surface exists for the user to GRANT/revoke the MANAGER-collaboration permission (route, setting, or UI)
- [ ] A production caller wires the `assistantSender` block, so `tests/unit/communication-graph-user-routing.test.ts`'s "NO PRODUCTION CALLER" lock is deleted in the same commit
- [ ] The contradicted R39.5/R39.7 rows in `docs/GOVERNANCE-ENFORCEMENT-MAP.md` are re-upgraded with the new citation
- [ ] A new test proves ASSISTANT → MANAGER is allowed only with the USER-gated flag set, denied without it, via a neuter of the gate (not the edge)

## Approval log

- 2026-07-30T13:09:14+0200 — FILED, `min-approval-requirement: manager`. NOT a mandate: it changes
  the comm-graph's shape on a security boundary, which the parent ruling was careful to keep out of
  the agent's own hands. The ruling's open question is answered IN THIS CARD (above) rather than by
  editing code, so the answer is reviewable before anything is built.
- 2026-07-31T17:08:43+0200 — APPROVED by USER (min-approval-requirement: manager; USER is above it). Asked explicitly
  because the card's own log reserved this decision — a comm-graph security edge whose failure mode
  is an agent commanding a user's ASSISTANT — and because a USER's impatience at the pace is not an
  approval. Scope approved: the FULL card, both halves in one commit. `column: todo` -> `dev`.
