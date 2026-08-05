---
trdd-id: 44YTVZ63
title: The two ai-maestro#113 residuals — core-plugin skills live in another repo, and the since field
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-05T17:42:50+0200
updated: 2026-08-05T17:42:50+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: user
mandate: false
approved: false
severity: low
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [cross-repo, hibernation, core-plugin]
external-refs: [Emasoft/ai-maestro#113]
---

# The two ai-maestro#113 residuals — core-plugin skills live in another repo, and the since field

## Problem

ai-maestro#113's first two asks shipped (TRDD-14HI8ZPR). Two residuals remain, and **neither is
blocked on effort** — each needs a decision only the USER can make.

**Residual A — the core-plugin skill half is not editable from here.** Those skills live in
`ai-maestro-plugin`, a **different repository**. Per `how-to-fix-issues-of-other-projects.md` the
only two routes are (1) file an issue on that repo, or (2) fork → clone to `/tmp` → PR — and both
need explicit direction before I touch another project in any way. I previously told the janitor
this half was "on us", which is true *organizationally* and false *mechanically*; that needs
correcting when the route is chosen.

**Residual B — `since` has no stored source.** There is no persisted hibernation timestamp
(`hibernatedAt` returns zero hits). It **is** derivable today from the daemon transition archive, so
the question is whether to promote it to a first-class stored field or leave it derived. Offered to
the janitor; unanswered.

## Proposed fix

**A:** the USER picks route 1 or route 2. If route 1, I draft the issue body here and post it; if
route 2, the fork/PR flow runs against `ai-maestro-plugin` and nothing in this repo changes.

**B:** either
- **derive it** — no schema change, correct by construction, costs an archive read per query; or
- **store it** — a `hibernatedAt` written on the hibernate transition, cheap to read, and one more
  field that can drift from the transition it describes.

Recommendation: **derive**, unless the janitor needs it in a hot path. A stored timestamp that
disagrees with the archive is worse than a slower read, and a derived value cannot drift.

## Verification

**A:** the residual is closed when the change is visible in `ai-maestro-plugin`'s published plugin,
not when a PR is opened — a merged PR that has not shipped is not a delivered capability (this
session measured the general form of that: work complete in a repo and absent from `PATH`).

**B:** whichever is chosen, `since` must return the same value as the transition archive for a
hibernated agent. If they can disagree, the field is the bug.

## Estimated risk

LOW both. The only real risk is A being left ambiguous a second time — an "on us" that is
mechanically impossible from this repo will simply not happen, and will look like neglect rather
than a boundary.

## Approval log
