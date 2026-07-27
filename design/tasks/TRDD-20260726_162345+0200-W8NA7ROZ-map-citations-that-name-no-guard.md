---
trdd-id: W8NA7ROZ
title: Fifteen enforcement-map citations cannot name a single guard
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-26T16:23:45+0200
updated: 2026-07-27T09:44:50+0200
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

**PARTIALLY RESOLVED 2026-07-27 — read the dated section at the bottom FIRST.** All 6 R18 rows
listed below (R18.1, R18.2, R18.3, R18.7, R18.8, R18.9, R18.10) have been read and re-cited, and an
audit of all 22 gate-qualified rows found **7 more whose qualifier was wrong — which PROVES their
line range is wrong too.** The tables below are the original measurement and are kept as the record;
the bottom section supersedes them for the rows it names.

**NEXT ACTION: re-cite the 7 rows whose qualifier was stripped** (R3.3, R12.3, R17.1, R17.6,
R17.15, R19.1, R19.3), then the remaining category-A/B rows, by HUMAN READ of the cited code. Do
not batch-convert them — see WHY, and see what batch-converting cost at the bottom.

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

## 2026-07-27 — the qualifier pass was ALSO a detector, and it found 7 wrong ranges

Batch 6 began by verifying R18's citations before writing tests against them, per this TRDD. That
verification generalized into an audit of **all 22 gate-qualified rows**, and the result is worse —
and more useful — than this TRDD originally assumed.

**The unsound step, stated plainly.** Phase 1a (`c5173e59`) derived each gate name FROM the cited
line range: "if the range contains exactly one gate, name it." But the ranges were already known to
be wrong roughly a third of the time (this TRDD's own tally). So the pass propagated wrongness into
a form that READS as verified — a named gate looks like someone checked, where a bare line number
visibly does not. That is the laundering risk this TRDD warned about, committed one commit later by
the same hand that wrote the warning.

**The redeeming half.** A gate NAME is human-checkable against a rule; a line number is not. So
comparing each qualifier's label text against its rule text is a cheap, high-yield rot detector —
and it is sound in one direction: **if the rule is enforced by a gate, and the cited range contains
a DIFFERENT gate, then the range does not contain the guard.** A wrong qualifier PROVES a wrong
range. The pass therefore surfaced rot that was previously invisible; the failure was shipping the
qualifiers without running this comparison first.

**Audit result — 22 rows:**

| verdict | rows |
|---|---|
| verified correct, kept | R3.2 (`ChangeTitle::G07` = MANAGER singleton), R9.2 (`G10` = block-on-manager-removal, per CLAUDE.md), R9.6 (`G13` = unblock-on-assignment, per CLAUDE.md), R9.8 (`DeleteAgent::G02` = MANAGER auto-demote), R17.9 (`InstallElement::PG01` = verify+flag chain, matches its test), R20.13 (`CreateAgent::G01b` = name uniqueness) |
| corrected | **R8.3** `DeleteTeam::G03`→**G05** (the pipeline's own docblock says "G05: Cancel pending transfers … (R8.3)"; G03 reverts agents to AUTONOMOUS) · **R11.4** `ChangeTeam::PG01`→**G07** (PG01 at :4952 is the LEAVE branch; joining calls ChangeTitle('member') at :4996-5008) · **R11.5** `ChangeTeam::G02`→**G04d** (G02 merely finds the team; the leave-side ChangeTitle('autonomous') is :4938-4947) |
| **qualifier STRIPPED — range proven wrong** | **R3.3** (cited G08 = the ORCHESTRATOR singleton; the rule is one-COS-per-team) · **R12.3** (cited G07 = MANAGER singleton; the rule is one-role-per-agent) · **R17.1**, **R17.6** (cited `CreateAgent::G08` = ROLE-plugin install; both rules are about the CORE plugin, and batch 1's tests pin them against **InstallElement** — wrong PIPELINE, not just wrong gate) · **R17.15** (cited G07 = a client/directory check; the rule is "cannot be disabled") · **R19.1** (cited G08b = "cannot demote current COS"; the rule is MAINTAINER-is-no-team) · **R19.3** (`ChangeTitle::EXE`, unverified) |

Stripping restores those rows to honest coarseness. It is strictly better than leaving a precise,
authoritative-looking, wrong claim — and the ratchet never asserted qualifier correctness anyway
("no parser can read intent"), so nothing regressed.

**The 7 stripped rows now carry a range PROVEN wrong** and need re-citation, which is added to this
TRDD's scope below. Three of them (R17.1, R17.6, R17.15) are the sharpest instance of the general
pattern: **the TEST column was right while the GUARD column was wrong** — batch 1 pinned the real
behaviour and nobody noticed the citation pointed at another pipeline entirely.

**Rule adopted:** a gate qualifier may only be added by READING the gate and the rule together.
Never derive one from a line range, and never add one in bulk.

- [ ] Re-cite the 7 stripped rows against their real guard, by reading
- [ ] R18.8's two-site citation (converter warning collector + the ChangeClient path that proceeds
      anyway) is confirmed to be the honest shape for a "proceed despite loss" rule

## Approval log

- 2026-07-26T16:23:45+0200 — MANDATE (self, min-approval-requirement: none). Tier 0: an EHT of
  H4Y9F25J confined to this project's own docs and tests. Born approved.
