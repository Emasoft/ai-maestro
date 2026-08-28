---
trdd-id: Q4GTD9C4
title: Commit gate — a verified-in-code claim must cite a range that resolves
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-28T21:45:42+0200
updated: 2026-08-28T21:45:42+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: user
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: S
labels: [governance, verification, pre-commit, owner-decision]
external-refs: [TRDD-AGHPMRVI]
---

## Problem

On 2026-08-28 one card (TRDD-AGHPMRVI) collected **six** adversarial-fork corrections, and four of
them were the same error in different clothes: a claim was labelled *verified in code* when the
only instrument used was a **grep** — a symbol index, which cannot establish reachability, order,
or effect. Two of those corrections were themselves made with a grep (`-A6`) inside the commit
that documented the previous one. None was caught by the author; every one was caught by a fork,
after the commit.

The owner asked to be consulted before any line lands in `.claude/rules/lessons-verification.md`
(91,185 bytes of a 96 KB cap @21:40 — it rides every turn), and named a stronger option: **a
gate**, not a lesson. This proposal is that option, sized so the owner can accept, refuse, or
pick the lesson line instead. It is a proposal because it changes a governance surface and
because the owner explicitly reserved this decision.

## What a gate CAN and CANNOT check — stated up front

A commit hook does not see which tools a session ran. It **cannot** know that the evidence behind
a claim was a grep. So the gate below does not try to. What it can do is refuse the claim's
**form** when it is unfalsifiable: a message that asserts verification without naming WHERE. A
`file:L1-L2` citation is the one thing a grep-only verification tends not to produce (a grep
gives a line, not a span, and never the caller's site) and the one thing a reviewer can check in
ten seconds.

## Proposed fix — `.githooks/commit-msg` (or the existing pre-commit PII gate's sibling)

1. Trigger phrase set, case-insensitive, in the commit **message**: `verified in code`,
   `verified against the code`, `traced the (call|flow)`, `confirmed in (the )?source`.
2. If triggered, require **at least one** citation of the form `<path>:<L1>(-<L2>)?` where
   `<path>` exists in the commit's tree (`git cat-file -e HEAD:<path>` against the index) and
   `L1 ≤ line count`. Missing ⇒ refuse with the reason and the exact form to add.
3. **No allowlist, no bypass flag.** `--no-verify` remains the platform's own escape and is
   already visible in the reflog; adding a second one would be the shape that makes the gate
   decorative.
4. Ship with a test in `tests/governance/` that drives the hook on three messages: no trigger
   (pass), trigger + resolvable range (pass), trigger + no range / dangling range (refuse).

Cost: one shell script ≤40 lines, one test file. It adds nothing to the per-turn prompt.

## The alternative the owner may prefer instead

One lesson line (≤500 chars) in `lessons-verification.md` under `## Claims about the codebase`:
*"a grep is a symbol index, not control flow — never credit it with establishing reachability;
verifying a CALL is not verifying its EFFECT, which may live in the caller."* Zero tooling,
+~300 bytes on every turn, and it is exactly the kind of lesson that was already in that file
in three other forms when the six errors happened — which is the argument for the gate.

## Verification

- The three-message test above; plus a neuter (`trigger set → empty`) that reddens exactly the
  refuse case.
- Positive control on the live repo: the AGHPMRVI correction commits `ce2acea5` and `99a0c085`
  must be REFUSED by the hook when replayed through it — they are the incident.

## Estimated risk

LOW. False refusals cost one reworded message with a citation; no code path changes.

## Acceptance

- [ ] Owner decision recorded here: gate / lesson line / neither
- [ ] If gate: hook + governance test landed, neuter observed, `ce2acea5` and `99a0c085` refused on replay
- [ ] If lesson: one line ≤500 chars added, `wc -c` under 96 KB recorded, budget test green

## Approval log
