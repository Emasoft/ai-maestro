---
trdd-id: 7S27HJCS
title: The TRDD store truncates in place while holding a lock borrowed from an atomic writer
column: todo
created: 2026-08-04T22:18:06+0200
updated: 2026-08-04T22:18:06+0200
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

## Acceptance

- [ ] the three sites write through `atomicWrite`, not a fourth spelling of tmp+rename
- [ ] the original's MODE survives the write (the `0444` → `0644` regression stays fixed)
- [ ] the read-only-directory test exists, with a FAILING (not skipping) non-vacuity guard, a
      positive control, and a recorded neuter
- [ ] no temp file survives a successful run — asserted, but NOT as the atomicity proof
