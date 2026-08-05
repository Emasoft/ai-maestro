---
trdd-id: BCECOHJ2
title: agent-messaging skill must document field semantics and sender-authority verification
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-05T20:40:41+0200
current-owner: ai-maestro
created-by: assistant-manager-agent
assignee: ai-maestro
task-type: docs
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
labels: [manager-filed, testbot-session, owner-plugin]
external-refs: [Emasoft/ai-maestro#124]
---
# agent-messaging skill must document field semantics and sender-authority verification

## Problem

`agent-messaging` v3.0.4 documents the R6 routing graph and the `amp-*`
command surface well, and documents nothing about evaluating an inbound
message. Zero occurrences of `governanceTitle`, mandate, approval, spoof,
or trust. The `--type` vocabulary is undocumented. The only listed
verification command resolves the agent's OWN identity, not the sender's.

The skill therefore instructs agents to STOP and act on inbound mandates
while giving them no procedure for deciding whether a mandate is
legitimate. Each agent improvises one.

On 2026-08-05 an AUTONOMOUS agent improvised by reading `registry.json`
directly, misread `role` (messaging role, default `autonomous`) as
contradicting `governanceTitle: manager`, and refused a legitimate MANAGER
mandate, blocking on a human prompt. Fixing the adjacent-field problem
alone would not fix this: the agent should not have been deriving its own
verification procedure at all.

## Scope

1. Add a **field-semantics reference** to the skill: `from`, `to`,
   `subject`, `type` (each value's obligation on the recipient),
   `priority`, `reply-to`, `context`, attachments — each with its meaning
   and its trust status.
2. Add the **sender-authority procedure** as the single canonical check:
   `governanceTitle`, resolved server-side, with an explicit warning that
   `role` defaults to `autonomous` and is never evidence about authority.
   An agent name is likewise never evidence about title.
3. Document **what a recipient may and may not conclude** — an in-body
   authority claim is self-certified; the registry check is an identity
   check and not message provenance; signed tokens are the real answer and
   are not yet enforced. State the current limitation rather than letting
   each agent discover it.
4. Document **the failure path**: what to do when verification fails or is
   impossible. Both silent compliance and silent refusal are wrong. A
   refusal must go back to the sender naming the specific check that
   failed, so the sender can correct it.
5. Document **the sender's obligation**: a mandate should name the check
   the recipient is expected to run.
6. Apply the same to the role-plugin messaging skills that mirror this one
   (e.g. `amoa-messaging-templates`), so the guidance does not exist in
   only one of several places an agent might load.

## Acceptance criteria

- [ ] Field-semantics table present, covering every field `amp-send`
      accepts and every field `amp-read` displays.
- [ ] The `governanceTitle` check is documented as THE authority check,
      with the `role` warning adjacent to it.
- [ ] The current verifiability limitation is stated explicitly, with a
      pointer to the token work rather than an implied promise.
- [ ] Failure-path behaviour documented for both directions (recipient
      cannot verify; sender receives a refusal).
- [ ] A behavioural check: hand a fresh agent an inbound mandate from a
      correctly-titled sender and confirm it verifies and proceeds without
      escalating; hand it one from an untitled sender and confirm it
      refuses AND names the failed check.

## Non-goals

- Implementing signed mandate verification. That is #47 / #27. This TRDD
  documents the procedure that exists today and states honestly what it
  cannot prove.
- Changing R6 routing or the command surface. Both are already documented
  well; this is purely the evaluation half.

## Verification

Behavioural, not textual. A word-count on the skill proves nothing — the
failure mode was an agent that read the skill and still improvised. Test
by giving an agent the two inbound-mandate cases above and observing what
it does.