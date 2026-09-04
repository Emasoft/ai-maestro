---
trdd-id: NNNR4IYL
title: The lessons file is 315 bytes from its cap and the documented relief mechanism does not cover the file-level cap
column: complete
created: 2026-09-04T19:08:46+0200
updated: 2026-09-04T19:29:06+0200
implementation-commits: [af301b98]
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-04

**RESOLVED. The chore is done, the control is replaced and neutered, and the file has 2179
bytes of headroom.** What follows is kept because the route here was wrong twice in opposite
directions, and the corrections are the transferable part.

**The framing below said "spec change". That was one notch too high.** Case 3 *mechanically*
blocked relocation — that much was right, and withdrawing this card outright would have been
wrong. But two things say it was never intended as a constraint on a second trigger:

- **The test's own header prescribes a neuter for CEILING and for ENTRY_MAX, and none for case
  3.** An assertion its author did not think worth neutering is scaffolding for the other two,
  not an independent invariant.
- **Under the strict reading the system is deadlocked by construction:** a core file at its
  ceiling with no over-length entry has no legal relief. Nobody specifies an unsatisfiable
  system. That is an oversight surfacing, not a design being defended.

So updating case 3 alongside the new trigger was ORDINARY WORK, and it took one constant and
four lines. **And the correction I drew last round — "prose describes, a test decides" — is
half right and I over-applied it: a test is authority on what the system DOES, never on what it
SHOULD do.** It can encode an accident exactly as prose can. I corrected elevating prose to
spec by elevating a test to spec.

**What shipped:**

- Five incident-specific entries relocated (selection: **lowest recurrence frequency** — an
  entry whose text is mostly one incident's own identifiers has earned the reference; a trap
  that bites weekly stays, however old). Two of my own misfiled entries re-homed inside CORE:
  both had landed in `## Shell`, including — with no irony spared — the one about content
  belonging to its proper subject.
- CORE **97989 → 96125** bytes; headroom 315 → **2179** (~4 further entries, short of the 2500
  target and recorded as such rather than rounded up).
- Each relocated short entry carries `<!-- moved-for-file-cap -->`. The lesson text is
  byte-identical; the marker is appended metadata.
- Case 3 now admits an entry that is over-length **or** marked, and it `filter`s and names
  offenders instead of asserting a bare boolean — `every(...)` reports only `false` and leaves
  the reader grepping a 196 KB file for the culprit.

**The move was verified byte-identical by me, not taken from the worker's report** — every line
added to the reference has a byte-identical twin among the lines removed from CORE (`comm -13`
empty). That check first returned a false 2-vs-5 because `grep '^-[^-]'` **excludes every
removed markdown bullet**: a deleted `- **ENTRY**` appears as `--` in a diff. The worker's
report was accurate; my instrument was not, and its own check 5 ("line count drops by exactly
5") had failed at 349→348 with an explanation I initially accepted without checking.

`tests/governance/lessons-file-budget.test.ts` third case:

```ts
it('the full reference exists and holds only long entries (positive control that the split is real)', () => {
  const es = entries(ref)
  expect(es.length).toBeGreaterThan(100)
  expect(es.every((e) => e.length > ENTRY_MAX)).toBe(true)
})
```

**The reference is MECHANICALLY SPECIFIED to hold only entries that exceeded the 500-char
per-entry cap.** Relocating a conforming entry there — which is exactly what file-cap relief
requires — turns that case red. So the second trigger is not merely undocumented; it is
**pinned against**, and adding it is a spec change, not a chore.

**A review recommended withdrawing this card**, on the reading that the header states an
invariant ("nothing is ever deleted") plus one instance of honoring it, so nothing forbade
relocating a conforming entry and only a *selection policy* was missing. That reading is
reasonable from the prose and **is refuted by the test.** Both the reviewer and I reasoned from
the header; neither of us read the spec. The lesson is the general one: **prose describes,
a test decides** — when a rule's scope is in question, the thing that mechanically enforces it
is the authority.

**Why the control was not simply deleted.** Its job is to prove *the split is real* — that the
reference is a routed destination and not a junk drawer. Weakening it to `es.length > 100`
would pin nothing, and that is suppressing a rule to pass a gate. The replacement keeps the
property under both triggers: over-length **or** explicitly marked.

**The neuter, run rather than asserted.** A short unmarked entry was seeded into the reference:
the suite went **red and named the offending entry by its text** (the `filter`+`map` rewrite
earning its keep on its first use). Removing the probe returned it to 3/3. So the control
discriminates; it does not merely pass. `tsc --noEmit` clean, 0 lines.

**I stashed rather than finished, and that was the same failure one level up.** The previous
round had just caught me deferring a chore into a 54-card `todo` column with prose attached; my
response was to defer a smaller one into the same column with more prose attached — a
replacement control I had already NAMED in the deferral. Worse, the preservation mechanism I
chose was the one with an incident in this very repo today (`stash@{1}` reads *"content an
accidental 'git stash pop' applied to a working tree it did not belong to"*). Naming a
candidate answer and filing it as future work is not rigor; the tree was green only because
the work was undone.

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

- [x] Decide the REPLACEMENT positive control: an entry may live in the reference if it is
      over `ENTRY_MAX` **or** carries `<!-- moved-for-file-cap -->`. Keeps the junk-drawer
      property under both triggers instead of dropping the length check.
- [x] Update `tests/governance/lessons-file-budget.test.ts` third case, and run the neuter.
      **Run, not asserted:** a short unmarked entry seeded into the reference turned the suite
      **red and named the offender by text**; removing it returned 3/3. The case now `filter`s
      and reports offenders rather than asserting a bare boolean — `every(...)` yields only
      `false` and leaves the reader grepping 196 KB for the culprit.
- [x] Decide and record the selection policy: **lowest recurrence frequency** — an entry whose
      text is mostly one incident's own identifiers (a named gate, a named pipeline, a
      completed survey's result) has earned the reference; a trap that bites weekly stays in
      CORE, however old. Recorded in the file's own header.
- [x] Update the header's relief rule to name BOTH triggers and correct "96 KB" to the enforced
      98304 bytes (96 KiB, not 96000).
- [x] Relocate enough entries to restore working headroom. **97989 → 96125 bytes; headroom 315
      → 2179**, i.e. ~4 further entries, not the 5 targeted. Recorded as measured rather than
      rounded up to the target.
- [x] Confirm every relocated entry is byte-identical in `-full.md` under its original heading.
      **Verified first-hand, not from the worker's report:** every line added to the reference
      has a byte-identical twin among the lines removed from CORE (`comm -13` empty). The check
      first returned a false 2-vs-5 because `grep '^-[^-]'` **excludes every removed markdown
      bullet** — a deleted `- **ENTRY**` appears as `--` in a diff.
- [x] Suite passes with the new case; the deletion neuter reddens. `tsc --noEmit`: 0 lines.

## Approval log

- 2026-09-04T19:08:46+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier 0: tooling hygiene inside this repo, reversible, no governance or public surface.
  No approval request was sent.
- 2026-09-04T19:29:06+0200 — COMPLETED by claude-opus-session. All seven boxes driven; the
  control's neuter was run, not asserted. Filed after a review told me to withdraw it, kept
  after doing the chore proved the block real, then de-escalated from "spec change" to
  "ordinary work" once a later review pointed at the missing neuter and the deadlock. Being
  wrong in both directions on one card is the record worth keeping.
