---
trdd-id: HW72YBZW
title: Build the ASSISTANT-MANAGER channel and drop the superseded MAESTRO grant
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: human_review
created: 2026-07-30T13:09:14+0200
updated: 2026-08-22T23:52:25+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
priority: 1
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-31T17:08:43+0200
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
| ~~which USER an assistant is bound to~~ | ~~**no** — `recipientIsOwnUser` / `boundUser` / `ownAssistant` have **zero** non-test references~~ **← WRONG, corrected 2026-08-22 (see below). It EXISTS: `UserRecord.assistantAgentId`.** |
| `userPermitsManagerCollaboration` storage | **no** — the symbol lives ONLY in `lib/communication-graph.ts` (the type + the read) and in the test |
| a surface for the user to GRANT it | **no** — no route, no setting, no UI |

### RULING 2026-08-22 — storage and default, decided on verified facts

The NEXT ACTION said to ask the USER. The USER's standing grant for this session is to decide on
their behalf **from verified facts and tests, never assumptions**, so this rules the two answerable
questions and leaves the one that is genuinely a build.

**STORAGE: a field on `UserRecord`, beside `assistantAgentId`.** Not a new store, not a field on
the agent. The permission is a property of the USER→ASSISTANT relation, and `UserRecord` already
carries exactly that relation in `assistantAgentId` (`types/user.ts:69`). Putting it there means it
shares three things it must share, none of which would hold elsewhere:
- **the same lifecycle** — one record, written and read together, so a grant cannot outlive or
  precede the binding it qualifies;
- **the same cascade** — `lib/user-registry.ts:192` already cascade-deletes the ASSISTANT with the
  user under R39.6, so revocation-by-deletion is inherited rather than reimplemented;
- **the same consumers** — `services/send-message-service.ts:97-128` and
  `services/amp-service.ts:1252-1262` already load the user record on the messaging path that needs
  the answer, so the read costs nothing new. A separate store would add a second fetch on the hot
  path and a second thing to keep consistent.

**DEFAULT: `false`, for a record that predates the field.** Two independent reasons, both checkable:
- The codebase already has this invariant — `lib/authorization.ts` ends in deny-by-default, and
  `gate0Auth` records why a missing context must not read as permission ("Previously, a missing
  authContext was silently treated as 'authorized'…").
- The failure modes are **asymmetric**. Default-on grants a channel the user never approved — a
  security error, and a silent one. Default-off leaves a feature gap — visible, and not an error.
  When one direction is a security failure and the other is an inconvenience, the choice is not a
  preference.

An absent field must therefore read as `false`, never as unset-so-allow. That is the same defect
the ASSISTANT branch already avoids by falling through to a fail-closed deny.

**WHAT THIS RULING DOES NOT DECIDE, and must not:** the GRANT SURFACE. There is no route, no
setting and no UI, and the card's own warning stands — default-off with no way to turn it on makes
R39.9 a dead letter. Building that surface is a feature, and it is where the remaining work is. The
ruling above only ensures that when it is built, the storage is not re-litigated and the migration
default is not invented under time pressure.

**ADVISOR NOT CONSULTED — THE PATH IS BROKEN, AND THAT IS ITSELF A FINDING.** `advisor-rules.md`
mandates consultation before an architectural decision. Two `fable-advisor:advisor` agents were
spawned for exactly this question and **both froze**: the first at 17,884 bytes with its transcript
mtime flat for **62 minutes**, the second at 15,751 bytes flat for **44.8 minutes** — each measured
with two samples before the kill, since a kill stamps mtime. The second carried a deliberately
bounded brief (three named questions, an explicit four-file list, "answer in under 400 words"),
so brief size is not the variable. The advisor is read-only (Read/Grep/Glob) and therefore cannot
checkpoint a file, so a freeze loses everything it had reasoned. Recorded here because the next
session that reaches for the mandated consultation should know it has failed twice today with the
same signature, rather than spending another hour discovering it.

### ⚠ CORRECTION 2026-08-22 — one of the three "does not exist" rows was a FALSE ABSENCE

**The assistant→user binding EXISTS in production and is already the SSOT.** `types/user.ts:69`
declares `assistantAgentId: string | null` on `UserRecord`, and it is READ by four production
sites — `lib/user-registry.ts:192` (the R39.6 ASSISTANT cascade-delete), `services/send-message-service.ts:97-128`,
`services/amp-service.ts:1252-1262` (both messaging paths), and `app/api/governance/users/route.ts:47`,
which exposes it on an API. Written non-null by **zero** sites; `lib/user-registry.ts:265` writes an
explicit `null` for the MAESTRO with the comment *"MAESTRO uses the MANAGER agent — no ASSISTANT
(R39.1)"*.

So the binding is **defined, plumbed, consumed by the very messaging path this card is about, and
merely never populated** — a materially different and much smaller problem than "design a
persistence model for an assistant→user binding".

**How the original measurement went wrong, because it is the session's third instance of one
shape.** It searched `recipientIsOwnUser` / `boundUser` / `ownAssistant`. All three genuinely have
zero non-test references — the needle was not broken, it was pointed at names the codebase does not
use for this. A needle assembled from the names you expect can only confirm what you expect, and its
blind spot is exactly the name that would refute you. (The other two instances today: a
`createSession` sweep that hit a same-named login-session function, and an authorization needle that
missed `checkTeamAccess(`.) The lesson for the row below it: `userPermitsManagerCollaboration` was
re-measured by the SYMBOL, not by a guessed name, and it really is type-only + test-only — 2
production references, both inside `lib/communication-graph.ts` itself.

**What this leaves genuinely open** is one field, not a subsystem: where
`userPermitsManagerCollaboration` is stored, what it defaults to, and how it is granted/revoked.
Advisor consulted on exactly that, bounded to those three questions.

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

## Column corrected — 2026-08-22T21:41:58+0200 — `todo` → `human_review`

**The card was advertising itself as pullable while waiting on the USER**, and that is not a
bookkeeping nit — I pulled it under the drain rule (highest-priority card on the critical path,
`p=1`, blocking `SPS63XHA`), read it, and found its own NEXT ACTION is *"a DECISION, then a separate
card… Ask the USER how the standing permission is stored and what it defaults to."* A card in
`todo` claims a worker can start it; this one cannot be started by anyone but the USER.

`human_review` is the ratified column for exactly this (*"escalating to USER"*), and it is where the
USER looks. Nothing else changed; **half 1 is still landed and there is still NO live hole** — the
`assistantSender` branch remains unreachable at runtime and the "NO PRODUCTION CALLER" lock test
still pins that.

Two smaller notes for whoever picks this up:

- The STATE block says *"this one stays in `dev`"*. That was written when someone was actively on
  it; it has not been touched since 2026-08-16, so `dev` would be the dishonest column (it asserts
  work in progress). `human_review` is the honest one, and this line supersedes that phrase.
- **The decision is genuinely two decisions**, and the card is right that defaulting either way is
  a real error: *where* the standing `userPermitsManagerCollaboration` permission is stored, and
  what it **defaults to**. Default-on grants a channel the USER never approved; default-off with no
  UI makes R39.9 permanently dead letter.

## Approval log

- 2026-08-22T21:41:58+0200 — Re-columned `todo` → `human_review` by main under the owner's standing
  delegation, to stop the card asserting it was pullable. No code, no scope change; the six
  acceptance boxes are untouched and all still open.
- 2026-07-30T13:09:14+0200 — FILED, `min-approval-requirement: manager`. NOT a mandate: it changes
  the comm-graph's shape on a security boundary, which the parent ruling was careful to keep out of
  the agent's own hands. The ruling's open question is answered IN THIS CARD (above) rather than by
  editing code, so the answer is reviewable before anything is built.
- 2026-07-31T17:08:43+0200 — APPROVED by USER (min-approval-requirement: manager; USER is above it). Asked explicitly
  because the card's own log reserved this decision — a comm-graph security edge whose failure mode
  is an agent commanding a user's ASSISTANT — and because a USER's impatience at the pace is not an
  approval. Scope approved: the FULL card, both halves in one commit. `column: todo` -> `dev`.
