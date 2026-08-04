---
trdd-id: 7S27HJCS
title: The TRDD store truncates in place while holding a lock borrowed from an atomic writer
column: complete
created: 2026-08-04T22:18:06+0200
updated: 2026-08-04T22:29:14+0200
implementation-commits: [f977a7f5]
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: bugfix
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: governance-rules
approval-datetime: 2026-08-04T22:18:06+0200
derived: false
npt: []
eht: []
blocked-by: []
priority: 2
severity: medium
effort: small
release-via: none
labels: [pillar-tooling, data-integrity, atomic-writes]
---

# The TRDD store truncates in place while holding a lock borrowed from an atomic writer

## Problem

`lib/trdd-store.ts` writes cards with plain `fs.writeFileSync` at three sites — measured:
lines **359**, **471** and **641**. `writeFileSync` truncates the target and then writes, so a
crash, a power loss, or a killed process between those two steps leaves a **truncated or empty
TRDD** — a git-tracked governance artifact.

The sharp edge is where the lock comes from. These writes run under `withJsonLock`, imported from
`lib/json-io.ts` — the module whose own documented contract is that `saveJsonSafe` is
"**ATOMIC (tmp + rename)** and GUARDED". So the store borrows the serialisation from a module
built around atomic writes and then does not write atomically. The lock prevents two writers from
interleaving; it does nothing about one writer dying halfway.

`lib/pillar/edit.ts` already has `atomicWrite` (and this same review pass fixed it to preserve the
original's mode). The primitive exists; these three sites do not use it.

## Root cause

A lock and an atomic write solve different problems, and holding the first reads as having solved
the second. Serialisation answers *"can two writers collide?"*; atomicity answers *"can one writer
leave a half-file?"* — and the second question is the one a crash asks.

## Proposed fix

Route the three sites through `atomicWrite` (tmp in the same directory + `os.replace`/`renameSync`),
the primitive `lib/pillar/edit.ts` already uses, rather than adding a fourth spelling.

Two things to get right, both learned in this repo this week:

- **Preserve the original's mode.** `rename` carries the TEMP file's mode onto the target, so a
  `0444` write-protected document comes back `0644`. That exact defect was found and fixed on
  `atomicWrite` in the same review pass; reusing the primitive inherits the fix, re-implementing
  it would re-introduce the bug.
- **The temp file must be in the SAME directory** as the target, or `rename` is a cross-device
  copy and no longer atomic.

## Verification

- A failed write leaves the ORIGINAL byte-identical: make the containing directory read-only
  (POSIX needs directory write permission to create the temp entry, while an in-place
  `writeFileSync` needs it only on the file — so the two behaviours separate cleanly), assert the
  verb fails and the card is unchanged.
- That test needs a **non-vacuity guard that FAILS rather than skips**: as root a `chmod` is
  advisory, and a permissions fixture that silently did nothing makes every assertion below it
  pass over a write that simply succeeded. Write a probe file into the directory and assert that
  it could not be written.
- Positive control: a normal write still lands, and no temp file survives.
- Neuter: restore one `writeFileSync` and confirm exactly the read-only-directory case reddens.

The shape and its trap are both already worked out in
`tests/unit/migrate-r20-marketplace-sources.test.ts` (TRDD-DP2HI2MP) — including the measured
finding that a "no temp file left behind" assertion does NOT pin atomicity, because it is equally
true of a writer that never made one.

## Estimated risk

**LOW to fix** — three call sites onto an existing primitive. **LOW-to-MEDIUM to leave**: it needs
a crash at an exact instant, but the file it corrupts is a governance card, the corpus is the one
the board and every pillar tool read, and a truncated card is exactly the input that
TRDD-5XJWR473 showed the tooling handles worst.

## Provenance

Found by the second `/code-review high --fix` pass on 2026-08-04 (finding #14 of 15), skipped
there because it changes the write mechanism under the lifecycle verbs and the pass judged it
belonged with the compensation work in its finding #3 — which has since landed. Re-verified
first-hand before this card was written: the three `writeFileSync` sites and `json-io`'s atomic
contract were both measured.

## Approval log

- 2026-08-04T22:18:06+0200 — MANDATE (self). Tier 0: confined to this repo's own store, no
  baseline deviation, no cross-team or release surface.
- 2026-08-04T22:29:14+0200 — CLOSED at `complete` by governance-rules. Landed as `f977a7f5`;
  355 files / 5027 pass / 2 skip / 0 fail (+3 over the 5024 baseline — exactly the new tests),
  `tsc --noEmit` 0 lines.

## What landed

The three sites (`editTrdd`, `editAt`, `advanceColumn`) now call `atomicWriteSync`, a
**synchronous twin** of `lib/pillar/edit.ts`'s `atomicWrite`, exported from that same module.

It is a second entry point, not a fourth spelling: these three verbs are synchronous, and making
them async would change their signature for every caller — a restructuring this card deliberately
did not want bolted onto a write-atomicity fix. Two thin entry points over ONE documented recipe,
in ONE module, is what keeps the mode-preservation fix from being re-introduced by hand; a
hand-rolled tmp+rename in `trdd-store.ts` is precisely how the `0444` → `0644` regression comes
back. The WHY is written at both functions, so a reader of either meets it.

## Neuter record — a COMPLEMENTARY PAIR, because the file makes two claims

One neuter would have certified half the file. The two are independent by construction (an
in-place `writeFileSync` preserves the mode trivially, so the atomicity neuter cannot reach the
mode assertion; the chmod neuter still writes atomically, so it cannot reach the read-only-dir
assertion), and each reddened exactly one test — which is what attributes the failure.

| Mutation (line-anchored) | Reddened |
|---|---|
| `lib/trdd-store.ts:364` → back to `fs.writeFileSync` | **1** — *a FAILED write leaves the original byte-identical* (33 passed) |
| `lib/pillar/edit.ts:343` → drop the `chmodSync` on the temp | **1** — *PRESERVES the document mode* (33 passed) |

Both anchored with `perl … if $. == N` and verified `1+/1-` before running: an unanchored
substitution hits every sibling site and the failure becomes unattributable. Both restored and
proved byte-identical to `HEAD` with `git hash-object` == `git rev-parse HEAD:<path>`.

## Acceptance

- [x] the three sites write through `atomicWrite`, not a fourth spelling of tmp+rename —
      via its synchronous twin in the same module, for the signature reason above
- [x] the original's MODE survives the write (the `0444` → `0644` regression stays fixed) —
      pinned by its own test, which falls to its own neuter and to no other
- [x] the read-only-directory test exists, with a FAILING (not skipping) non-vacuity guard, a
      positive control, and a recorded neuter
- [x] no temp file survives a successful run — asserted in the positive control, and documented
      in the test as HYGIENE rather than the atomicity proof (it is equally true of a writer that
      never made one — measured under TRDD-DP2HI2MP)

## What this does NOT fix — stated so the next reader does not infer it

A crash *between* the read and the write still loses the edit; atomicity guarantees the file is
never left half-written, not that the edit survives. And the authorization that permitted the
write is still computed OUTSIDE this lock — that is **TRDD-6D6SQNI6**, deliberately separate.
