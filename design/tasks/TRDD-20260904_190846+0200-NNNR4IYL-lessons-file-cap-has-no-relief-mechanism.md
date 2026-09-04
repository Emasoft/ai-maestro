---
trdd-id: NNNR4IYL
title: The lessons file is 315 bytes from its cap and the documented relief mechanism does not cover the file-level cap
column: todo
created: 2026-09-04T19:08:46+0200
updated: 2026-09-04T19:08:46+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: claude-opus-session
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-04T19:08:46+0200
priority: 2
severity: medium
effort: small
release-via: none
labels: [tooling, governance, lessons]
---

# The lessons file is at its cap and the documented relief does not apply

## Problem

`.claude/rules/lessons-verification.md` is at **97989 of its 98304-byte cap — 315 bytes free**.
A useful lesson entry runs 200-500 characters, so **the next author hits the cap mid-commit**,
with a red `tests/governance/lessons-file-budget.test.ts` and no documented way forward.

Measured 2026-09-04 while adding two entries during `TRDD-LS9N71DX`. The first landed at 766
bytes free; the second (after a trim to satisfy the per-entry cap) at 315.

## Root cause — the stated mechanism relieves a DIFFERENT cap

The file's own header says:

> This file rides every turn, so it is capped at 96 KB and an entry may be at most 500
> characters. Longer lessons live, verbatim and under the same headings, in
> `.claude/rules-reference/lessons-verification-full.md` … Nothing is ever deleted: a lesson
> that outgrows 500 chars is MOVED there.

That relocation is triggered by **an entry exceeding 500 chars**, not by the **file** exceeding
its byte cap. The two are independent, and the budget test enforces both separately
(`no core entry exceeds 500 chars` is a distinct case from the file size).

So there is no over-length entry to relocate: the test passes, which *proves* every entry is
already under 500. **The documented relief is unavailable precisely when the file cap binds.**
The `-full.md` reference exists and holds 196126 bytes, so the destination is real and in use —
only the trigger condition is missing.

Note the cap arithmetic, because the header understates it: "96 KB" is enforced as **98304**
bytes (96 KiB), not 96000.

## Proposed fix — needs a policy decision, which is why this is a card and not an edit

Extend the relocation rule to fire on the FILE cap as well as the per-entry cap, moving whole
entries **verbatim, under the same headings**, into `-full.md`. Nothing is ever deleted; this is
the same operation the header already sanctions, under a second trigger.

The open question is **which** entries move, and it is a judgement the next author should not
have to make under cap pressure mid-commit:

- **Oldest-first** is mechanical and defensible, but age is not relevance — the `sed`/`tee`/
  `$?` traps are old and still bite weekly.
- **By section** keeps related lessons together in the reference, which is how a reader would
  want to find them.
- **Least-cited** is the most principled and the least measurable.

**Do NOT resolve this by hunting for entries "superseded by" newer work.** That judgement gets
made too eagerly, and the file's own policy is relocation rather than deletion for exactly that
reason.

## Verification

- A lesson entry can be added to a full file and the documented procedure resolves it without
  the author inventing a policy.
- After a relocation, the moved text is byte-identical in `-full.md`, under the same heading.
- `tests/governance/lessons-file-budget.test.ts` passes, and a test pins the new trigger
  (seed a file at the cap; assert the procedure yields a conforming file with nothing lost).
- Verify the loss case explicitly: a neuter that "relieves" the cap by DELETING an entry must
  redden.

## Estimated risk

LOW as a mechanism; the risk is in the policy. A relocation rule that moves the wrong entries
degrades the file that rides every turn — its whole value is that the highest-frequency traps
are in the always-loaded half. Getting the selection wrong is worse than the cap.

## Acceptance

- [ ] Decide and record the selection policy (oldest-first / by-section / other), with the
      reason, in the file's own header so the next author does not re-derive it.
- [ ] Update the header's relief rule to name BOTH triggers (per-entry >500 chars, and the
      file at its byte cap) and correct "96 KB" to the enforced 98304 bytes.
- [ ] Relocate enough entries to restore working headroom (target: room for at least five
      further entries, ~2500 bytes).
- [ ] Confirm every relocated entry is byte-identical in `-full.md` under its original heading.
- [ ] `tests/governance/lessons-file-budget.test.ts` passes, plus a new case pinning the
      file-cap trigger; run the deletion neuter and confirm it reddens.

## Approval log

- 2026-09-04T19:08:46+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier 0: tooling hygiene inside this repo, reversible, no governance or public surface.
  No approval request was sent.
