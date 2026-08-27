---
trdd-id: IIXYIU7G
title: The always-loaded lessons file grows ~6KB per day with no budget or ceiling
column: todo
created: 2026-08-27T14:30:07+0200
updated: 2026-08-27T14:30:07+0200
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

- [ ] A policy decided for what stays always-loaded vs moves to an on-demand reference
- [ ] The file brought under a stated ceiling, with the ceiling asserted by a test
- [ ] No lesson deleted in the process — relocation only
- [ ] The growth curve re-measured after the change and recorded here

## Approval log

- 2026-08-27T14:30:07+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Tier-0
  self-mandate: measurement and filing only, no code change. No approval request was sent.
