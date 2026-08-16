---
trdd-id: 9FBNRW29
title: This repo's baseline rulesets carry the pre-ruling shape on both 2026-08-13 fields
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T20:32:44+0200
updated: 2026-08-16T20:32:44+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-16T20:32:44+0200
derived: true
derived-kind: eht
parent-trdd: BRRJK57P
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: S
labels: [github, rulesets, baseline, governance, hub-self-audit]
external-refs: []
---

# The baseline is present by name and stale in two fields

## Problem

Measured first-hand against `Emasoft/ai-maestro` (payloads, not names — name presence is not
compliance):

| ruleset | target | bypass | rules | verdict |
|---|---|---|---|---|
| `baseline-history-protect` | branch | **`[]`** | deletion, non_fast_forward | **STALE** |
| `baseline-pr-and-checks` | branch | `[5]` ✓ | pull_request, required_status_checks, **`approvals=1`** | **STALE** |
| `baseline-tag-protect` | tag | `[]` ✓ | deletion, update | correct |

`required_linear_history` is absent everywhere, so the **2026-08-08** ruling did land. The
**2026-08-13** ruling did not: it grants the owner/admin (`actor_id 5`) bypass on
`baseline-history-protect` (an empty list being *"a lock with no key"* on a solo-owner repo) and
sets `required_approving_review_count` to **0**.

## Root cause

Nothing is broken. The applier was simply never re-run here after the ruling. That is the whole
mechanism, and it is why *"a closed ruling, a merged commit, an applier's own success line and a
green suite are all silent about the deployed surface."*

## Why `approvals=1` is the one that bites

**GitHub forbids self-approval.** On a solo-owner repo a PR can therefore never reach 1 approval,
so branches pile up **unmergeable** — which is precisely the reason the USER set it to 0. This is
not theoretical here: there are ~74 unpushed commits on `governance-rules` that will eventually
want a PR.

`bypass_actors: []` on history-protect is the same class of defect one step less urgent: it locks
history operations against everyone including the owner.

## Proposed fix

Re-apply the ratified baseline to this repo — **building the payload from the code SSOT
`branch_protection_lib.baseline_ruleset_payloads`, never from prose.**

**This is the load-bearing constraint and the reason the card exists rather than a two-minute
`gh api` call.** The machine-global IND rule (`~/.claude/rules/manager-approval-defaults.md`) still
states the **pre-ruling** shape, so an agent "restoring the ratified baseline as-is" from that text
would *re-impose* the very lock this card removes — and would be Tier-0 EXEMPT while doing it, so
nothing would stop it. Read the code, diff the current payload against it per object, and apply only
the fields that differ.

Applying the ratified baseline as-is is Tier-0 EXEMPT. **Any deviation from it is Tier 2** and does
not belong in this card.

## Verification

Per object, before and after:

```
gh api repos/Emasoft/ai-maestro/rulesets/<id>
```

- `baseline-history-protect` → `bypass_actors` contains `actor_id: 5`, rules still exactly
  `deletion` + `non_fast_forward`, **no `required_linear_history` reintroduced**.
- `baseline-pr-and-checks` → `required_approving_review_count: 0`, bypass unchanged `[5]`.
- `baseline-tag-protect` → **unchanged**, `bypass_actors: []`.

**Diff each ruleset against its own pre-change backup, not against the intent.** A post-condition
read from the same idea that produced the write cannot see a write aimed at the wrong target — and
a `0 → non-zero` move on a field whose correct value may be empty must be flagged, because an
empty-selection filter exits 0 and looks like success.

## Estimated risk

MEDIUM, entirely on the applier rather than the change. The change itself restores a ratified
shape.

The real hazard is a payload built from stale prose (above) or a `jq`-selected apply hitting the
wrong ruleset — `baseline-tag-protect`'s ratified bypass is **nobody**, so a fix shaped for the PR
ruleset would silently *weaken* it while printing a clean result.

## Open, and NOT assumed

Whether the other 21 fleet repos carry the same two stale fields. ~66 API calls, hub-only work, and
one stale prose source feeding every applier is how a fleet drifts together. Not part of this card;
named on the parent so it is not lost.

## Approval log

- 2026-08-16T20:32:44+0200 — MANDATE issued by the hub session (min-approval-requirement: none).
  Pre-approved: restoring the ratified baseline as-is is Tier-0 EXEMPT per the approval-defaults
  rule §F. Derived (EHT) from TRDD-BRRJK57P's axis-2 pass. No approval request was sent.
