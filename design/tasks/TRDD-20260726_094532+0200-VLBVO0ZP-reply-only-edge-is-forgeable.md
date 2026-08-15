---
trdd-id: VLBVO0ZP
title: A reply-only communication edge is unlocked by any truthy string
scope: project
project-id: ai-maestro
column: todo
created: 2026-07-26T09:45:32+0200
updated: 2026-08-15T01:30:26+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: manager
mandate: false
approved: true
approval-judge: manager (emasoft-assistant-manager)
approval-datetime: 2026-08-15T01:30:26+0200
relevant-rules: [R6, R38]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-26

Surfaced by TRDD-H4Y9F25J batch 3 while pinning R6. **Nothing is broken today** — the exposure is
latent and becomes live the moment Phase-2 maestro auth makes the human user an AMP recipient. It is
filed now because that deadline is currently recorded nowhere but a code comment.

NEXT ACTION: decide (USER/MANAGER) whether to strengthen the check or to accept it with an explicit
expiry tied to the Phase-2 work. Do not "fix" it silently — the current behaviour is what the rule
text describes, so changing it changes governance.

## Problem

R6.10 governs `reply-only` (`1`) edges — the edges by which a team agent (COS, ORCHESTRATOR,
ARCHITECT, INTEGRATOR, MEMBER) may answer the human user but may never initiate. The rule says the
sender MUST pass `inReplyToMessageId`.

The check is exactly that and no more: **any truthy string satisfies it.** The graph layer does not
load the referenced message, does not verify that message was sent BY the recipient, does not verify
it was addressed TO the replier, and does not consume it — so the same literal unlocks the edge
again and again. `"x"` is a valid reply token.

R6.10's own rule text admits this ("Today the graph layer only requires the field to be a truthy
string; it does NOT load the referenced message, verify its sender…"), which is why the batch pinned
the WEAK contract rather than the strong one. That was the correct call for a test batch — writing
the strong test and then editing production to make it pass would have been a governance change
smuggled in as a test — but "documented" is not "safe".

**What the exposure actually is:** an agent whose only permitted edge to the human is reply-only can
initiate conversation with the human at will by inventing a message id, and can do so repeatedly.
The rule's entire purpose — team agents may answer, never initiate — is unenforced against an agent
that simply supplies a string.

**Why it is not exploitable today, stated precisely so nobody over- or under-reacts:** the human is
not yet an AMP recipient, so the reply-only branch is effectively dead code. That is a property of
an unfinished feature, not a mitigation. When Phase-2 maestro auth lands, the branch goes live in
whatever state it is in — and the only record of that coupling is a comment in the source.

## Proposed fix (the decision, not a foregone conclusion)

**Option A — enforce what the rule means.** Resolve `inReplyToMessageId` against the AMP inbox:
require the referenced message to exist, to have been sent by the intended recipient, to have been
addressed to the replier, and to be unconsumed; mark it consumed on success. This makes "exactly one
reply" true rather than aspirational. Cost: the comm-graph stops being a pure function — it is today
deliberately registry-free, with the caller passing relationship flags in — so the lookup belongs in
the CALLER (amp-service), with the graph continuing to decide only on flags it is handed.

**Option B — accept, with an expiry.** Keep the weak check, and record the coupling where it will be
seen: in R6.10's rule text and in the Phase-2 auth TRDD, so the strengthening is a gate on that work
rather than a comment nobody greps.

Option A is the right end state; B is legitimate only if Phase 2 is far off AND the gate is written
into that work. Either way the decision is a MANAGER's, not a test batch's — hence
`min-approval-requirement: manager` and `column: todo` rather than a self-mandate.

## Verification

- Whichever option: `tests/governance/r6-communication-graph.test.ts` currently pins the WEAK
  contract. If A is chosen, those assertions must be INVERTED in the same commit — a test that still
  asserts "any truthy string is accepted" after the fix would silently re-document the hole.
- Option A additionally: a forged id (well-formed but referencing nothing) is refused; a valid id
  works exactly ONCE; a valid id belonging to a different conversation is refused.
- Option B: R6.10's text carries the expiry, and the Phase-2 TRDD lists this as a blocking item.

## Estimated risk

Fixing: MED — it moves a decision from a pure function into the caller, and every reply-only path
must keep working. Not fixing: LOW today, and squarely MED the day Phase-2 auth ships, because the
rule silently stops meaning what it says.

## Acceptance

- [ ] USER/MANAGER picks A or B
- [ ] If A: the reply token is resolved, ownership-checked, and consumed; the batch-3 assertions are
      inverted in the same commit
- [ ] If B: the expiry is recorded in R6.10's text AND as a blocking item on the Phase-2 auth TRDD
- [ ] tsc clean, full suite green

## Approval log

- 2026-08-15T01:30:26+0200 — APPROVED by ASSISTANT-MANAGER (min-approval-requirement:
  manager — the card's declared floor, which manager satisfies), §D4
  APPROVAL-UNAPPROVED-IN-WORK-ZONE drain. Column stays as-is per the ruling.
