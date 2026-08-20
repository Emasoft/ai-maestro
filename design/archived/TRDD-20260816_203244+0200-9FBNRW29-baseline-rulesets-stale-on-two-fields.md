---
trdd-id: 9FBNRW29
title: This repo's baseline rulesets carry the pre-ruling shape on both 2026-08-13 fields
column: completed
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T20:32:44+0200
updated: 2026-08-20T01:57:00+0200
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20 01:56

- **APPLIED + VERIFIED, and not just here (2026-08-20 01:50-01:56, hub, Phase-2 delegation).**
  This repo's two stale fields fixed in the 88LDC7E0 nine-repo apply; the card's own fleet
  census then drove the remainder: population RE-DERIVED live (86 Emasoft repos → 24 baseline
  carriers, not the 08-16 census's 22), 21 more objects patched across 12 repos, 47 objects
  verified per-object against their own before-snapshots (only the two ruled fields + the
  derived current_user_can_bypass echo moved; tag-protect never touched anywhere).
  **FINAL CENSUS: 24/24 carriers current on BOTH 2026-08-13 fields — 0 stale.** Snapshots
  (rollback data): reports/baseline-rulesets/20260820_*-{before,after}-full.json +
  *-rest15-{before,after}.json. The "NOT APPLIED, deliberately" note below is SUPERSEDED —
  authored 08-16, before the USER's 08-18 Phase-2 delegation; the apply is surfaced in the
  session summary for USER override. Upstream applier freeze filed as janitor#282.

## Acceptance

- [x] `baseline-history-protect` carries the admin bypass on every fleet carrier (24/24, live API, per-object)
- [x] `required_approving_review_count` is 0 wherever a pull_request rule exists (24/24)
- [x] `baseline-tag-protect` untouched everywhere (byte-compare vs before-snapshots; ratified bypass stays NOBODY)
- [x] `required_linear_history` reintroduced NOWHERE (rules arrays proven unchanged)
- [x] payloads built from the code SSOT, never prose; the stale IND rule that would have re-imposed the lock is corrected (manager-approval-defaults.md, 2026-08-20)

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

## PREPARED 2026-08-16 — payload read from the code SSOT, backups taken, diff computed. NOT applied.

**The SSOT's own prose is stale, exactly as this card predicted — and it is stale IN THE SAME FILE
as the code.** `branch_protection_lib.py:24` (module docstring) states
*"`baseline-history-protect` — `bypass_actors: []` (nobody bypasses…)"*, while the payload at
**`:226`** grants `{actor_id: _ADMIN_REPOSITORY_ROLE_ID, RepositoryRole, always}`. The spec's rule —
**code beats prose on any disagreement** — is what makes this resolvable. An agent that read only
the docstring would have "restored the ratified baseline" by re-imposing the very lock the ruling
abolished, and would have been Tier-0 EXEMPT doing it.

The code also anticipates the other half, at `:299-303`:
> *"Do NOT 'restore' this to 1 on the theory that review is being skipped. It is the same class of
> error as `required_linear_history` (janitor#14) — a rule that reads as rigour and functions as a
> deadlock."*

**Backups taken first** (verification diffs each object against ITS OWN backup, never against the
intent): `17863667` 633 B · `17863669` 1145 B · `17947120` 670 B.

**The complete diff is TWO fields. Nothing else changes:**

| ruleset | id | field | now → SSOT |
|---|---|---|---|
| `baseline-history-protect` | 17863667 | `bypass_actors` | `[]` → `[{actor_id 5, RepositoryRole, always}]` |
| `baseline-pr-and-checks` | 17863669 | `required_approving_review_count` | `1` → **`0`** |
| `baseline-tag-protect` | 17947120 | — | **LEAVE UNTOUCHED** (`bypass_actors: []` is its *ratified* value) |

`required_linear_history` is absent everywhere and stays absent. `deletion` + `non_fast_forward`
continue to bind **every non-admin actor** — CI, agents, outside contributors — so the change
exempts the owner and no one else.

**NOT APPLIED, deliberately.** Applying the ratified baseline as-is is Tier-0 EXEMPT, so the freeze
is not what stops it: this is an **outward-facing mutation of repository protection settings**, made
unattended, and the standing rule is to confirm those rather than assume standing authorization
covers the moment. Everything that does not require the write is done — so the remaining act is one
reviewed command per field, against a known-good backup, with `baseline-tag-protect` explicitly out
of scope (a fix shaped for the PR ruleset applied there would silently *weaken* it, which is the
hazard this card names).

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

## MEASURED 2026-08-16 — it is not one repo. It is the fleet, and ONE repo of 22 is current.

The question below is answered. **The population was DISCOVERED, not assumed**: 47 repos found from
git remotes under `~/Code`, of which **21 carry both baseline branch rulesets** — corroborated
independently by the 22 `publish.py` hits (21 + this repo). 12 carry no rulesets at all; **3 are
404** (`emasoft-chief-of-staff`, `mesh-vectorizer`, `xls-cross-platform`) and a 404 is *"could not
read"*, **not** *"no rulesets"* — my first pass conflated the two states and the classification was
split before any number was read.

| field | ratified | stale across the 21 | with this repo |
|---|---|---|---|
| `baseline-history-protect` → `bypass_actors` | `[5]` | **18** carry `[]` | **19 of 22** |
| `baseline-pr-and-checks` → `required_approving_review_count` | `0` | **20** carry `1` | **21 of 22** |

**Exactly ONE repo of 22 carries the complete current payload: `Emasoft/perfect-skill-suggester`.**

**The odd-repo-out trap fired, and checking the second field is what caught it.** Three repos carry
the ratified `bypass=[5]` and would each have read as "already current" on that field alone —
`AgentlensPro` and `llm-externalizer-plugin` are both still `approvals=1`. The two rulesets drifted
**independently**, so no single field identifies a compliant repo.

**`perfect-skill-suggester`'s `approvals=ABSENT` is genuine, not a query artifact.** Its
`baseline-pr-and-checks` carries only `required_status_checks` — no `pull_request` rule — while a
control repo under the identical query returns both types. That matches the code SSOT, where the PR
rule is emitted **conditionally**. So it was applied by a newer applier, which is why it is the one
current repo.

**The consequence is the severe part.** GitHub forbids self-approval, so `approvals=1` is
**unsatisfiable** on a solo-owner repo: **21 of 22 fleet repos currently cannot merge a PR.** That
is precisely the deadlock the USER's 2026-08-13 ruling abolished, still standing on all but one.

**Two further gaps, named rather than folded in:** `Emasoft/ai-maestro-plugins` and
`Emasoft/talk-to-claude` carry **no `baseline-tag-protect`** at all.

**Still not applied, and the reasoning is unchanged and stronger at 21 repos than at one:** this is
an outward-facing mutation of repository protection settings across the fleet, made unattended.
Recorded as its own card rather than executed here — one card, one repo.

## Open, and NOT assumed

~~Whether the other 21 fleet repos carry the same two stale fields.~~ **ANSWERED above.** The
fleet-wide remediation is cross-repo, so the D3 floor puts it at **`manager`**, not `none` — it is a
separate card, not an extension of this one.

## Approval log

- 2026-08-16T20:32:44+0200 — MANDATE issued by the hub session (min-approval-requirement: none).
  Pre-approved: restoring the ratified baseline as-is is Tier-0 EXEMPT per the approval-defaults
  rule §F. Derived (EHT) from TRDD-BRRJK57P's axis-2 pass. No approval request was sent.
