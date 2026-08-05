---
trdd-id: 7JRFBEQ2
title: R39.2 and RP-ASSISTANT-01 still say the ASSISTANT plugin is unpublished
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
severity: medium
effort: small
relevant-rules: [39]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [governance, r39, role-plugins, iron-rule]
external-refs: [Emasoft/ai-maestro#86, Emasoft/ai-maestro#39]
---

# R39.2 and RP-ASSISTANT-01 still say the ASSISTANT plugin is unpublished

## Problem

`docs/GOVERNANCE-RULES.md` R39.2 and the role-plugins spec clause RP-ASSISTANT-01 both describe the
ASSISTANT role-plugin as unpublished. `Emasoft/ai-maestro-assistant-role-agent` **is** published and
is in the marketplace manifest.

The rule text is therefore false in the direction that matters: a reader deciding whether the plugin
can be installed gets "no" from the governance corpus and "yes" from the marketplace.

## Why I have not fixed it

**R39 is IRON / USER-set.** I may not edit it, and the exact patch is already proposed on
ai-maestro#39. This card exists so the correction is tracked on the board rather than living only in
an issue comment — the whole reason the kanban is the TRDD corpus.

## Adjacent fact that must NOT be "fixed" along with it

`ai-maestro-assistant-role-agent` is deliberately **not** in `PREDEFINED_ROLE_PLUGIN_NAMES`. Consumers
assume a set of exactly **8**, and the ninth is intentionally outside it (open on ai-maestro#86).
Correcting R39.2's publication status **MUST NOT** be taken as licence to bump that count to 9 —
CLAUDE.md says so explicitly, and the two facts look related while being independent.

## Proposed fix

USER edits R39.2 and RP-ASSISTANT-01 to describe the plugin as published, leaving
`PREDEFINED_ROLE_PLUGIN_NAMES` at 8 and leaving the reason for the exclusion documented.

## ⏵ MEASURED 2026-08-05T22:10 — the patch is ready, and R39.2 is wrong TWICE

Re-verified first-hand rather than inherited from this card's own prose:

| claim in R39.2 | measured | verdict |
|---|---|---|
| *"intentionally NOT a published GitHub repo"* | `gh repo view` → **PUBLIC**, latest release **v0.3.2** (2026-07-23T13:21:46Z); appears **3×** in the `Emasoft/ai-maestro-plugins` marketplace manifest | **FALSE** |
| *"already built at `~/agents/role-plugins/roles-marketplace/`"* | that directory **does not exist**; the source is at `~/Code/ai-maestro-assistant-role-agent` | **FALSE** — a second error nobody had noticed |

**The second one is new to this card** and matters independently: a reader following R39.2's
path finds nothing, which reads as "the plugin does not exist" — a different wrong conclusion
from "it exists but is unpublished".

**RP-ASSISTANT-01 is only PARTLY stale, contrary to this card's title.** Its path
(`~/Code/ai-maestro-assistant-role-agent`) is **correct**; what is stale is only its
**LOCAL/D4** source classification, which asserts local-not-published. So the spec needs a
narrower edit than the docs rule does.

**The 4.5.1 changelog entry is NOT to be corrected.** It says *"the Emasoft GitHub 404 is by
design"*, which was TRUE when written (2026-07-22); the repo was published the NEXT DAY. A
changelog is an append-only record of what was believed then — rewriting it would falsify
history. The correction belongs in a NEW changelog entry, not in that one.

**Still blocked, and correctly so.** R39 is **IRON / USER-set**. The same standard was applied
to R42.8 earlier today: I refused to amend it on a MANAGER's relayed quote and acted only after
the USER granted it in the first person. A general "fix all issues" is not that grant.

### The exact patch, ready to apply on one word

1. `docs/GOVERNANCE-RULES.md` R39.2 — replace
   *"a LOCAL/D4 source — already built at `~/agents/role-plugins/roles-marketplace/`,
   intentionally NOT a published GitHub repo and absent from `PREDEFINED_ROLE_PLUGIN_NAMES`"*
   with: **published at `Emasoft/ai-maestro-assistant-role-agent` (v0.3.2, in the marketplace
   manifest), source at `~/Code/ai-maestro-assistant-role-agent`, and STILL deliberately absent
   from `PREDEFINED_ROLE_PLUGIN_NAMES` — consumers assume a set of exactly 8 and the ninth is
   intentionally outside it (ai-maestro#86).**
2. `design/specs/role-plugins-spec.md` RP-ASSISTANT-01 — drop only the **LOCAL/D4**
   classification; keep the path and every conformance bullet.
3. A new `docs/GOVERNANCE-RULES.md` changelog entry recording the correction. Version PATCH.

**The one thing this patch must NOT do**, restated because the two facts look related and are
independent: `PREDEFINED_ROLE_PLUGIN_NAMES` stays at **8**. CLAUDE.md says so explicitly —
*"do not 'fix' the count to 9"* — and publication status is not a reason to.

## Verification

After the edit: the two clauses no longer assert "unpublished"; `PREDEFINED_ROLE_PLUGIN_NAMES` still
has 8 entries; and the enforcement-map rows for R39 still resolve. That third assertion is the one
that catches a well-meant over-correction.

## Estimated risk

LOW technically. The risk is scope creep into the count, which is why the invariant above is stated
before the patch rather than after.

## Approval log
