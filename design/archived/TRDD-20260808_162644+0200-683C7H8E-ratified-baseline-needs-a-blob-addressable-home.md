---
trdd-id: 683C7H8E
title: The ratified GitHub-ruleset baseline has no blob-addressable home in the governance corpus
column: completed
created: 2026-08-08T16:26:44+0200
updated: 2026-08-15T00:44:31+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: manager
approved: true
approval-judge: manager (emasoft-assistant-manager)
approval-datetime: 2026-08-15T00:32:23+0200
priority: 2
severity: medium
effort: small
release-via: none
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
labels: [governance, baseline, rulesets, ai-maestro-140]
npt: []
eht: []
blocked-by: []
relevant-rules: []
external-refs: [ai-maestro#140]
---

# The ratified baseline needs a blob-addressable home

## Problem

The INTEGRATOR measured (2026-08-08, relayed after the USER's linear-history ruling): the
ratified baseline ruleset trio appears **0 times** in `governance-spec.md` and **0 times** in
`docs/GOVERNANCE-RULES.md`. Its only textual definitions are per-host rule PROSE copies
(`aimaestro-manager-approval-defaults.md` §F and its user-global mirrors), and §F makes
"apply the baseline as-is" Tier-0 EXEMPT — so when the USER changed the baseline (struck
`required_linear_history`, 2026-08-08), there was **no artifact to change**: every agent's
local copy was the authority, stale prose became the propagation vector, and a compliant
agent re-introduced the forbidden rule in good faith (ai-maestro#140).

## Proposed fix

Give the baseline ONE blob-addressable home in this repo's governance corpus: a section (or
spec file under `design/specs/`) carrying the full JSON payloads of the ratified trio —
`baseline-history-protect` (deletion, non_fast_forward; bypass nobody),
`baseline-pr-and-checks` (pull_request 1-approval + required_status_checks; admin bypass),
`baseline-tag-protect` (deletion, update; bypass nobody) — with the USER rulings dated
inline, and a note that the EXECUTABLE SSOT remains the janitor's
`branch_protection_lib.baseline_ruleset_payloads` (code beats prose; the doc must cite the
code symbol, not restate it as a second executable source). Add a conformance guard in the
falsified-guard pattern INTEGRATOR shipped in v1.6.3: a test that fails if the doc re-lists
`required_linear_history` in any baseline definition.

## Why manager-tier

It edits the governance corpus (a §F-adjacent definition), which the tier table puts at
`manager`. It documents already-ratified state — no rule is changed — but the location IS
the authority question this card exists to settle.

## Verification

- `grep -n required_linear_history <the new home>` → only inside the dated
  "REMOVED by USER ruling" annotation, never in a live rule list.
- The new guard test reds when a linear-history rule is re-added to the doc.

## Acceptance

- [x] MANAGER approves the location — design/specs file (APPROVED 2026-08-15, see log)
- [x] The trio's payloads live at `design/specs/baseline-github-rulesets-spec.md`, citing
      `branch_protection_lib.baseline_ruleset_payloads` as the executable SSOT — and the
      authoring pass surfaced TWO newer USER Tier-3 rulings (2026-08-13: admin bypass on
      history-protect; approval count 0 + conditional pull_request/checks rules) that the
      hub §F prose lacked; spec records them dated, §F synced in the same batch. The
      drift this card exists to end was live at authoring time.
- [x] Falsified-guard test lands — `tests/governance/baseline-spec-ratchet.test.ts`, 4/4:
      positive control proves a live rule-list mention is flagged; trio-membership pin
      (INTEGRATOR's fail-OPEN lesson, their 69b8173); linear-history only in the dated
      REMOVED annotation; SSOT citation asserted.

## Approval log

- 2026-08-08T16:26:44+0200 — Authored as a proposal (manager-tier: governance-corpus edit),
  from the INTEGRATOR's ask relayed with the USER's linear-history ruling.
- 2026-08-15T00:32:23+0200 — APPROVED by ASSISTANT-MANAGER (min-approval-requirement:
  manager). Location decided: a spec file under design/specs/ (blob-addressable by path,
  diffable in isolation, one file for the falsified-guard test to target). Constraint kept
  verbatim: cite branch_protection_lib.baseline_ruleset_payloads as the executable SSOT,
  never restate payloads as a second executable source; required_linear_history only inside
  the dated REMOVED-by-USER annotation.
- 2026-08-15T00:44:31+0200 — COMPLETED by ai-maestro. Spec + guard landed (this batch's
  implementation commit recorded in a follow-up edit); §F prose synced to the two
  2026-08-13 rulings the code SSOT carried and the prose lacked.
