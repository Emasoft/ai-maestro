---
trdd-id: 28NEFCCM
title: AMP stale agent address self-heals without destroying identity
column: complete
created: 2026-07-23T15:04:46+0200
updated: 2026-07-23T15:04:46+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-23T15:04:46+0200
derived: false
npt: []
eht: []
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
implementation-commits: [6c6b75b4, 1af95d49]
external-refs: [Emasoft/ai-maestro#46, Emasoft/ai-maestro#77, Emasoft/ai-maestro#40, Emasoft/ai-maestro#24, Emasoft/ai-maestro#26]
labels: [amp, identity, data-integrity]
---

# AMP stale agent address self-heals without destroying identity

## Problem

`#46` claimed AMP sessions cannot self-resolve identity ("~35 agents, one host
identity"), and was cited as the canonical blocker by `#40`, `#24`, `#26`, and
`#77`. The reported symptom — 32 agent configs carrying the byte-identical
address `ai-maestro@emasoft.aimaestro.local` — is real and was verified.

The **diagnosis** was wrong, and the wrong diagnosis blocked real work on four
issues.

## Root cause

Measured on the live store:

| Probe | Result |
|---|---|
| `.index.json` entries | 51, all distinct names → uuid |
| `.agent.name` per config | correct and distinct |
| `.agent.address` local-part | 32 stamped `ai-maestro` (the REGISTRAR's cwd) |
| Ladder resolution key | `AMP_HOST` → `AIM_AGENT_ID` → `AGENT_WORK_DIR`/`$PWD` → name → uuid |

**The address is never read during resolution.** Identity was never ambiguous;
the *address field* was corrupt. Two defects, both in `scripts/amp-helper.sh`:

1. **The self-heal could never fire for the affected population.** The
   address/name mismatch check existed, but `_expected_name` was sourced only
   from `CLAUDE_AGENT_NAME` or a **non-UUID** dir basename. Every modern agent
   dir *is* uuid-named, so the whole block was skipped for exactly the agents
   carrying the bug. The code comment even said "the name lives in config.json"
   — but never used it.

2. **The repair itself was destructive.** It called `save_config` with 3 args;
   `save_config` rebuilds the entire agent object, so `id` (the uuid that IS the
   agent's identity in `.index.json` and every envelope) and `createdAt` were
   silently dropped. **Fixing (1) alone would have activated that data loss
   across all 32 agents on their next `amp-*` call.**

## Fix

- `_expected_name` falls back to the config's own `.agent.name`. `save_config`
  derives `address = "${name}@${tenant}..."`, so name and address-local-part can
  only disagree when the address is stale — the name is the identity and wins.
- The heal passes `id` and `createdAt` through; `save_config` gained an optional
  5th `createdAt` arg so a repair-in-place cannot reset an agent's age.
- Separately (`1af95d49`), the Priority-4 refusal message no longer prints a list
  of agent addresses + uuids with `Example: --id <uuid-from-above>` — that
  documented impersonating a live peer as the next step. It now names the three
  legitimate identity-proving paths and emits no uuid.

**No migration.** Each agent repairs its own config on its next `load_config` —
the same path that detects the drift.

## Verification

`t9` in `tests/amp-identity-resolution.test.sh` — asserts both halves: the heal
fires for a uuid-named dir, AND `id`/`createdAt` survive the repair. 10/10 green.

That file is a **shell** suite; vitest does not run it. This is the second bug in
this area to hide behind that gap (a pinned error string in `t6` survived 227
vitest files earlier). Any change to `amp-helper.sh` must run it explicitly.

## Notes and lessons learned

[^1]: [id:ATOM-4K2M-9XQP, status:valid, keywords:"self_heal_never_fires guard_condition_excludes_affected_population uuid_named_dir", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT trust that an existing self-heal covers a defect just because the
  detection code exists, BECAUSE its guard sourced `_expected_name` only from
  inputs the affected population never has (uuid-named dirs), so it silently
  skipped exactly the agents that needed it. DO check what the guard EXCLUDES
  against the actual failing population before concluding "already handled".

[^2]: [id:ATOM-7T3W-1LDV, status:valid, keywords:"repair_path_destroys_data rebuild_drops_unpassed_fields activating_latent_data_loss", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT enable a dormant repair path without first reading what the repair
  writes, BECAUSE `save_config` REBUILDS the whole object and drops any field not
  passed back in — enabling the heal alone would have destroyed `.agent.id` for
  32 agents. DO audit the write side of a repair before fixing the condition that
  triggers it; a fix that activates latent data loss is worse than the bug.

[^3]: [id:ATOM-9B6R-2FSK, status:valid, keywords:"symptom_real_conclusion_wrong assumed_field_was_the_key blocked_four_issues", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT infer a subsystem is unusable from a true observation about one of its
  fields, BECAUSE "32 agents share one address" assumed the address was the
  resolution key — it is never read by the resolver — and that unchecked step
  blocked four issues for weeks. DO verify which field the code actually reads
  before promoting a symptom to a blocker.
