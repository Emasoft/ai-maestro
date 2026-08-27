---
trdd-id: IIXYIU7G
title: The always-loaded lessons file grows ~6KB per day with no budget or ceiling
column: complete
created: 2026-08-27T14:30:07+0200
updated: 2026-08-27T16:55:15+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-27T14:30:07+0200
priority: 2
severity: medium
effort: small
release-via: none
labels: [token-economy, tooling]
npt: []
eht: []
implementation-commits: []
---

# The always-loaded lessons file grows ~6KB per day with no budget or ceiling

## Problem

`.claude/rules/lessons-verification.md` is injected into EVERY turn of EVERY session in
this repo, so its cost is `bytes x turns x sessions`. Measured today:

| date | bytes |
|---|---|
| 2026-07-28 | 7 258 |
| 2026-07-30 | 59 589 |
| 2026-08-06 | 155 213 |
| 2026-08-18 | 226 936 |
| 2026-08-27 | 282 242 |

**~39x in 30 days across 198 commits, and still linear at ~6.1 KB/day** (+55 KB in the
last 9 days). At that rate it passes 450 KB by October. ~282 KB is roughly 70k tokens;
at the 0.1x cache-read rate that is ~7k weighted tokens on every turn, before anyone
does any work.

**The two token figures above are ESTIMATES and are marked as such deliberately** — the byte
curve is measured, they are derived. `~70k tokens` assumes ~4 chars/token (bytes/char measured
at **1.007**, so the file is effectively pure ASCII and the byte count is a fair stand-in for
chars); `~7k weighted` applies the 0.1x cache-read rate as documented in the token-economy rule,
not as measured here. Both would need a real tokenizer to become facts. The card exists so a
measurement does not rot, which is exactly why a derived number in it must not wear a
measurement's formatting.

There is no budget, no rotation, no ceiling test, and no policy for what earns a
permanent per-turn cost. That is the shape of a guard nobody maintains until someone
deletes the whole thing — and the content is genuinely valuable, which is exactly what
makes an unmanaged wholesale deletion the likely end state.

## Why this is filed and not fixed

Found while an adversarial review pass noted that a lesson about not over-building
guards had been appended to a file whose cost had never been measured. Fixing it well
means deciding a policy (budget? rotation to an on-demand reference? a size test with a
stated ceiling? per-entry length limits?), and that is a design question, not a cleanup.
Filing it with the measurement attached is the honest move; the growth curve is the part
that rots, and it is now recorded.

Note the entry that prompted this is NOT the problem: ~2 KB against ~6 KB/day.

## Proposed direction (not decided)

The sibling pattern already in this repo is the FULL REFERENCE split used by several
`~/.claude/rules/` files: a short always-loaded core plus an on-demand reference read by
path. That would keep every lesson while cutting the per-turn cost, and it needs no
deletions.

## Acceptance

- [x] A policy decided for what stays always-loaded vs moves to an on-demand reference
- [x] The file brought under a stated ceiling, with the ceiling asserted by a test
- [x] No lesson deleted in the process — relocation only
- [x] The growth curve re-measured after the change and recorded here

## Resolution — 2026-08-27T16:55:15+0200

Policy: an entry ≤ 500 chars stays in the always-loaded core; longer entries relocated VERBATIM,
same section headings, to `.claude/rules-reference/lessons-verification-full.md`. Ceiling 96 KB on
the core + the 500-char cap asserted by `tests/governance/lessons-file-budget.test.ts` (neuter:
lowering either limit reds exactly its own test).

Re-measured after the split: core **88 077 B** (was 282 242; 279 entries kept), reference
195 239 B (190 entries moved). 469 entries before, 469 after — every original entry verified
present in exactly one of the two files by the split script. Future growth: only ≤500-char
entries can land in the core, and the ceiling test reds at 96 KB, so the curve is now bounded
rather than linear.

## Approval log

- 2026-08-27T14:30:07+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Tier-0
  self-mandate: measurement and filing only, no code change. No approval request was sent.
