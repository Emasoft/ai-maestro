---
trdd-id: 2XV78BND
title: R6's rule text and its enforcing code disagree in two places
scope: project
project-id: ai-maestro
column: todo
created: 2026-07-26T09:45:32+0200
updated: 2026-07-26T09:45:32+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: manager
mandate: false
approved: false
relevant-rules: [R6, R38]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-26

Two independent text↔code disagreements in R6, both found by TRDD-H4Y9F25J batch 3 while pinning the
communication graph. **In both cases the CODE is right and the TEXT is stale or misleading** — which
is the dangerous direction, because the next reader "corrects" working code to match a wrong rule.

Editing rule text is a governance edit, so this is a proposal rather than a self-mandate.

NEXT ACTION: MANAGER rules on the two text edits below; neither changes behaviour.

## Finding 1 — R6.6 says "unconditional"; the code fails closed (and should)

R6.6's text: the human user has *"unconditional outbound `Y` to every other node"*.

The code does not, since R38.2. `lib/communication-graph.ts:396-408` **denies** a `human` sender that
arrives with neither `isUserMessage` nor a resolved `userSender` block:

```
reason: 'user sender context unresolved — cannot route (R38.2)'
```

That fail-closed branch is correct — it closed a blanket-allow hole — and it is now pinned by a test
(neutering it back to `allowed: true` fails exactly one test, verified). The static full-Y row at
`:112` still exists, but it is consulted only AFTER the sender context resolves, so R6.6's live
decision is split across two places and the word "unconditional" describes neither.

**Risk of leaving it:** a reader reconciling code to rule deletes the fail-closed branch and restores
the blanket allow. The rule text would be their justification.

**Proposed text:** R6.6 keeps the full-Y adjacency claim but states the precondition — the human
sender's context must resolve (legacy `isUserMessage`, or an R38.2 `userSender` block); an
unresolved human sender is DENIED, not defaulted.

## Finding 2 — R6.9's dedicated guard has no production caller

R6.9: *"Sub-agents have no AMP identity and cannot authenticate."*

There IS a dedicated guard — `lib/communication-graph.ts:322-327`, `if (options.isSubagent) return
{ allowed: false, … }` — and batch 3 pinned it (deleting it fails 10 tests). But a repo-wide search
for `isSubagent` outside `tests/` returns only its own declaration and doc comment
(`communication-graph.ts:279, 312, 322`). **No caller anywhere ever passes `isSubagent: true`**, so
the branch cannot fire in production as the code stands.

What actually enforces R6.9 today is the generic authentication gate (`services/amp-service.ts`
`if (!auth.authenticated) → 401`): a subagent holds no API key, so it never gets past it. That is why
the enforcement map cited the 401 — accidentally right about the MECHANISM while naming the wrong
GUARD. Both are now mapped, direct guard first.

This is not "delete the dead branch": it is correct defence-in-depth for the day a caller can
distinguish a subagent. It is a record problem — a guard that looks live and is not.

**Proposed:** note in R6.9 that enforcement today is the auth gate, and that the `isSubagent` flag is
a latent second layer awaiting a caller that can detect a subagent. Either wire a caller or say
plainly that none exists; what must not persist is the impression that the flag is doing the work.

## Verification

- The two text edits land in `docs/GOVERNANCE-RULES.md` with a version bump.
- `tests/governance/enforcement-coverage.test.ts` stays green (row count and citations unchanged).
- No behaviour change and no test change: both findings are about the RECORD matching the code.
- `grep -rn "isSubagent" --include=*.ts . | grep -v tests/` re-run after any wiring decision.

## Estimated risk

LOW. Documentation only. The risk of NOT doing it is a future reader deleting the R38.2 fail-closed
guard on the authority of a stale sentence.

## Acceptance

- [ ] R6.6's text states the resolve-or-deny precondition
- [ ] R6.9's text names the auth gate as today's enforcement and the `isSubagent` flag as latent
- [ ] GOVERNANCE-RULES version bumped; enforcement-map rows unchanged
- [ ] No test or behaviour change

## Approval log

_(empty — awaiting MANAGER)_
