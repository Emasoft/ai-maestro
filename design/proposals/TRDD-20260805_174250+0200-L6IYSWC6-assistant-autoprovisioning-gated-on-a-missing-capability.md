---
trdd-id: L6IYSWC6
title: ASSISTANT auto-provisioning is gated on native-user registration, which does not exist
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-05T17:42:50+0200
updated: 2026-08-05T17:42:50+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: user
mandate: false
approved: false
severity: medium
effort: large
relevant-rules: [38, 39]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [assistant, provisioning, blocked-on-capability]
external-refs: [Emasoft/ai-maestro#39]
---

# ASSISTANT auto-provisioning is gated on native-user registration, which does not exist

## Problem

ai-maestro#39's acceptance criterion 4 requires an ASSISTANT agent to be auto-provisioned per
registered native user. **Native-user registration is not a capability this product has.**

So AC4 is not "unimplemented" in the ordinary sense — there is nothing to hang it on. Building it
would mean first inventing a user-registration model (identity, lifecycle, deletion, and what
happens to the assistant when a user is removed), which is a materially larger piece of work than
the criterion's phrasing implies.

Corroborating measurement (recorded on #39): `UserRecord.assistantAgentId` is **read** by 4
production sites — the R38 messaging edge and the R39.6 cascade-delete — and written non-null by
**zero** production code. Every non-null value in the tree is a fixture. So the enforcement suite
around it is green over a state production cannot currently enter.

## Why this is a proposal and not a task

The decision is scope, and it is the USER's:

1. **Build native-user registration** — the honest path, and a large one. Everything AC4 needs
   follows from it.
2. **Re-scope AC4** to the single-owner reality (one human owns the host, so one ASSISTANT) and say
   so in the criterion, removing the dependency on a model that does not exist.
3. **Defer AC4 explicitly**, leaving #39's other criteria to close on their own merits rather than
   holding the issue open on one blocked item.

Doing nothing has a cost worth naming: the criterion currently reads as ordinary pending work, so a
future session will pick it up, discover the missing capability, and re-derive this analysis.

## Verification

Whichever option: `assistantAgentId` must have at least one **production** writer, or the field and
its four readers must be removed. A field only fixtures can populate is a permanent trap — it makes
tests pass over an unreachable state, which is exactly how "well tested" and "never runs" become
indistinguishable.

## Estimated risk

HIGH for option 1 (a new identity model touches auth, deletion cascades and messaging), LOW for
options 2 and 3. The risk of leaving it as-is is not zero: it is the recurring cost of re-analysis
plus a green test suite asserting a state nothing can reach.

## Approval log
