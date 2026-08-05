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

## Verification

After the edit: the two clauses no longer assert "unpublished"; `PREDEFINED_ROLE_PLUGIN_NAMES` still
has 8 entries; and the enforcement-map rows for R39 still resolve. That third assertion is the one
that catches a well-meant over-correction.

## Estimated risk

LOW technically. The risk is scope creep into the count, which is why the invariant above is stated
before the patch rather than after.

## Approval log
