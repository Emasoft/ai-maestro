---
trdd-id: LXF16IXG
title: Twenty-one of twenty-two fleet repos cannot merge a PR because the 2026-08-13 ruling never reached them
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T22:38:12+0200
updated: 2026-08-16T22:38:12+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: manager
mandate: false
mandated-by: self
approved: false
derived: true
derived-kind: eht
parent-trdd: BRRJK57P
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: M
labels: [github, rulesets, baseline, governance, fleet, hub-self-audit]
external-refs: []
---

# The ruling landed in code, shipped in eleven releases, and reached one repo

## Problem

The USER's Tier-3 ruling of **2026-08-13** set two fields on the ratified baseline: the owner/admin
(`actor_id 5`) bypasses `baseline-history-protect`, and `required_approving_review_count` drops to
**0** on `baseline-pr-and-checks`. Measured first-hand against GitHub on 2026-08-16:

| field | ratified | stale | share |
|---|---|---|---|
| `baseline-history-protect` → `bypass_actors` | `[5]` | `[]` | **19 of 22** |
| `baseline-pr-and-checks` → `required_approving_review_count` | `0` | `1` | **21 of 22** |

**Exactly one repo carries the complete current payload: `Emasoft/perfect-skill-suggester`.**

**The consequence is not cosmetic.** GitHub forbids self-approval, so on a solo-owner repo
`approvals=1` is **unsatisfiable** — a PR can never reach one approval. **21 of 22 fleet repos
currently cannot merge a pull request.** That is the exact deadlock the ruling abolished, still
standing on all but one repo three days later.

Nothing is broken in the code. The applier was simply never re-run. That is the whole mechanism, and
it is why *a closed ruling, a merged commit, an applier's own success line and a green suite are all
silent about the deployed surface.*

## How the population was established — discovered, not assumed

47 repos found by reading `origin` from every git remote under `~/Code` at depth 4. Of those,
**21 carry both baseline branch rulesets** (this repo is the 22nd), 12 carry no rulesets at all, and
**3 return 404**.

- **The 21 is corroborated independently**: `publish.py` resolves in **22** repos — 21 + this one.
- **A 404 is *"could not read"*, not *"no rulesets"*.** The first pass conflated them (the error body
  landed in the name column); the three states were split before any number was read. The three
  unreadable repos are named below rather than absorbed into a clean total.

## Why a per-field check was mandatory, and a per-repo verdict is not derivable from one field

Three repos carry the ratified `bypass=[5]`. On that field alone each reads as "already current".
Checking the second field:

| repo | bypass | approvals | verdict |
|---|---|---|---|
| `Emasoft/AgentlensPro` | `[5]` ✓ | `1` ✗ | **partially drifted** |
| `Emasoft/llm-externalizer-plugin` | `[5]` ✓ | `1` ✗ | **partially drifted** |
| `Emasoft/perfect-skill-suggester` | `[5]` ✓ | absent ✓ | **fully current** |

**The two rulesets drifted independently**, so no single field identifies a compliant repo, and the
odd-repo-out is not a positive control until its second field is read.

`perfect-skill-suggester`'s absent approval count is **genuine, not a query artifact**: its
`baseline-pr-and-checks` carries only `required_status_checks` and no `pull_request` rule, while a
control repo under the identical query returns both types. That matches the code SSOT
(`branch_protection_lib.baseline_ruleset_payloads`), where the `pull_request` rule is emitted
**conditionally** — so this repo was written by a newer applier, which is why it is the one current
repo. It is the shape the others should converge on, not an anomaly to normalize away.

## The trap any fix must avoid, and it is already live on this machine

**The machine-global IND rule `~/.claude/rules/manager-approval-defaults.md` still states the
PRE-ruling shape.** An agent "restoring the ratified baseline as-is" from that prose would
**re-impose the very lock the ruling removed** — and applying the ratified baseline as-is is
**Tier-0 EXEMPT**, so nothing would stop it. The SSOT's own module docstring is stale in the same
way, in the same file as the correct payload (`branch_protection_lib.py:24` vs `:226`).

**Build every payload from the code, never from prose**, and diff each ruleset against **its own**
pre-change backup rather than against the intent — a post-condition read from the same idea that
produced the write cannot see a write aimed at the wrong target.

**`baseline-tag-protect` must NOT be swept along.** Its ratified `bypass_actors` is **nobody** (`[]`),
so a fix shaped for the PR/history rulesets applied there **silently weakens it** while printing a
clean result. This is not hypothetical: a `jq 'select(…)'` used as a shell predicate exits 0 on an
*empty* selection, which is exactly how a filter meant for PR rulesets reaches tag rulesets.

## Proposed fix

Per repo, per ruleset object, with a backup taken first:

1. `baseline-history-protect` → set `bypass_actors` to `[{actor_id: 5, actor_type: RepositoryRole,
   bypass_mode: always}]`. Rules stay exactly `deletion` + `non_fast_forward`; **`required_linear_history`
   is absent everywhere and stays absent** (the 2026-08-08 ruling).
2. `baseline-pr-and-checks` → set `required_approving_review_count` to `0`. Bypass unchanged.
3. `baseline-tag-protect` → **untouched.**

Two further gaps, in scope for the same pass because they are the same baseline:
`Emasoft/ai-maestro-plugins` and `Emasoft/talk-to-claude` carry **no `baseline-tag-protect` at all**.

## Verification

- Per object: fetch after, and **diff against its own pre-change backup**, not against the intent.
- Flag any `0 → non-zero` move on a field whose correct value may be empty — an empty-selection
  filter exits 0 and looks like success.
- Re-run the fleet census and assert **22 of 22** carry both ratified fields; report the count from
  the re-run, never by quoting this card's numbers (a census is a snapshot).
- `baseline-tag-protect` bypass is still `[]` on every repo that had one.
- The three 404 repos (`Emasoft/emasoft-chief-of-staff`, `Emasoft/mesh-vectorizer`,
  `Emasoft/xls-cross-platform`) are **resolved as a separate question** — renamed, deleted, or
  access-scoped — and are not silently counted as compliant.

## Estimated risk

MEDIUM-HIGH, and concentrated entirely in the applier rather than the change — the change restores a
ratified shape the USER already ruled on.

The hazards are (a) a payload built from the stale prose, which re-imposes the abolished lock while
being Tier-0 EXEMPT, and (b) a `jq`-selected apply reaching `baseline-tag-protect`, which weakens it
silently. Both have a named, measured precedent.

## Why this is a proposal and not a mandate

Applying the ratified baseline as-is is Tier-0 EXEMPT, so the exemption is not what stops it. Two
things do: the D3 floor puts **cross-repo** work at **`manager`**, and this is an outward-facing
mutation of repository protection settings on 21 repositories, made unattended. The measurement is
complete and costs nothing to re-run; the write is one reviewed command per field per object.

## Approval log

_(empty — awaiting the required approver)_
