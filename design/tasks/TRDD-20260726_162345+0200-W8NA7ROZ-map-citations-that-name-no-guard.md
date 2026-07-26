---
trdd-id: W8NA7ROZ
title: Fifteen enforcement-map citations cannot name a single guard
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-26T16:23:45+0200
updated: 2026-07-26T16:23:45+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-26T16:23:45+0200
relevant-rules: [R51.9]
parent-trdd: H4Y9F25J
derived: true
derived-kind: eht
blocked-by: []
npt: []
eht: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-26

Surfaced while adding gate qualifiers to `docs/GOVERNANCE-ENFORCEMENT-MAP.md` (commit
`c5173e59`, TRDD-H4Y9F25J Phase 1a). **32 ENFORCED rows cite
`services/element-management-service.ts` with a line range. 17 resolved to exactly one gate and
were qualified. These 15 did not, and were deliberately left alone.**

**NEXT ACTION: resolve each row below by HUMAN READ of the cited code, then either add a
`(Pipeline::Gnn)` qualifier or correct the citation.** Do not batch-convert them — see WHY.

**WHY they were not converted mechanically.** A citation that already fails to name one guard
would be laundered into a more authoritative-looking form while staying just as wrong. This
session produced exactly one false positive (the retracted `TITLE_PLUGIN_MAP` claim) by
concluding from a read instead of an experiment; the standing rule since is that a claim about
a guard is proven by breaking it and watching a named test fail, never by inference.

## The measurement (re-runnable, not remembered)

Resolve every gate label to its enclosing `export function`, then ask which labels fall inside
each row's cited range. The categories are structural facts, not judgements:

### A. No gate label in the range — nearest-preceding is a GUESS (5 rows)

| Row | Citation | Enclosing fn | Nearest preceding label |
|---|---|---|---|
| R4.4 | `:4956` | ChangeTeam | PG01 |
| R17.8 | `:724-729` | InstallElement | G07 |
| R18.1 | `:5638-5684` | ChangeClient | G05 |
| R18.7 | `:5847-5849` | ChangeClient | G07 |
| R18.10 | `:5840` | ChangeClient | G07 |

`ops.push` usually fires *after* a gate's check, so code following a `G07` push may well belong
to G08. The preceding label is a plausible reading, not a determination.

### B. The citation cannot name any single guard (10 rows)

| Row | Citation | What is actually there |
|---|---|---|
| R18.8 | `:5475-5866` | **391 lines spanning `ChangeCLIArgs` into `ChangeClient`, 8 distinct gates inside** |
| R18.9 | `:5475-5866` | same range as R18.8 |
| R18.2 | `:5530-5565` | 3 gates in range (G01, G02, G03) |
| R18.3 | `:5603-5636` | 2 gates in range (G05, G05b) |
| R20.5 | `:1722-1778` | spans `uninstallPluginLocally` → `autoAssignRolePluginForTitle` |
| R20.31 | `:1634-1712` | spans `installPluginLocally` → `uninstallPluginLocally` |
| R40.1 | `:244-271` | spans `isForeignUser` → `assertForeignUserMayCall` |
| R17.2 | `:1531-1533` | inside helper `installPluginLocally` — not a pipeline, no gate |
| R20.29 | `:1531-1533` | same lines as R17.2 |
| R39.6 | `:6381-6385` | `DeleteAgent` preamble, before any gate |

**A guard does not span two functions.** Rows citing a range that crosses a function boundary
are citing a chapter, not a check — the most extreme being R18.8/R18.9's 391-line range, which
the existing existence+bounds test passes without complaint.

The helper-function rows (R17.2, R20.29, R39.6) are a different and legitimate case: the guard
genuinely is not gate-shaped, so a qualifier is inapplicable and the line citation is the right
form. They are listed for completeness, not as defects.

## Note on R20.5 and R20.31

Both already carry independent suspicion from earlier batches — R20.31 was reported as citing an
*anti-guard* (a function doing what the rule forbids, harmless only because nothing calls it),
and R20.5's range is the one that made the retracted `TITLE_PLUGIN_MAP` claim look plausible.
Their spanning ranges are now a second, independent signal. **Still a claim, not a finding**:
confirm by experiment before acting.

## Acceptance

- [ ] Each of the 5 category-A rows is read and either qualified or corrected
- [ ] Each of the 7 genuinely-defective category-B rows is narrowed to a real guard
- [ ] The 3 helper-function rows are confirmed as correctly un-qualifiable and annotated as such
- [ ] `tests/governance/enforcement-coverage.test.ts` stays green, and each new qualifier is
      mutation-proved (break the gate in the source, watch the named test fail)
- [ ] `bash scripts/with-node.sh npx tsc --noEmit` clean; governance suite green

## Approval log

- 2026-07-26T16:23:45+0200 — MANDATE (self, min-approval-requirement: none). Tier 0: an EHT of
  H4Y9F25J confined to this project's own docs and tests. Born approved.
