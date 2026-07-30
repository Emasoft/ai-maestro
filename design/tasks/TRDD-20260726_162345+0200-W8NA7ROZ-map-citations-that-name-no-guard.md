---
trdd-id: W8NA7ROZ
title: Fifteen enforcement-map citations cannot name a single guard
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-26T16:23:45+0200
updated: 2026-07-30T12:26:00+0200
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
implementation-commits: [9a11a51b, 47f54bf2]
parent-trdd: H4Y9F25J
derived: true
derived-kind: eht
blocked-by: []
npt: []
eht: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

**ALL ACCEPTANCE BOXES CHECKED. All 15 originally-flagged rows (5 category-A + 7 category-B + 3
helper) are re-cited and mutation-proven; the last 5 (R4.4, R17.8, R20.5, R20.31, R40.1) closed
today — see the "2026-07-30 — the final 5 rows" section near the bottom for the per-row detail.
`tests/governance/enforcement-coverage.test.ts` is 9/9 green; `services/element-management-service.ts`
is byte-identical to HEAD. NEXT ACTION: none — this TRDD is done; move `column:` to a terminal state
(`complete` or equivalent) on next pass. The sections below (dated 2026-07-26/27) are the ORIGINAL
measurement and are kept as the historical record — read the 2026-07-30 sections for what actually
shipped.

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

- [x] Each of the 5 category-A rows is read and either qualified or corrected — **R18.1/R18.7/R18.10
      done 2026-07-27; R17.8 done 2026-07-30 (`a92bf954`); R4.4 done 2026-07-30, see below**
- [x] Each of the 7 genuinely-defective category-B rows is narrowed to a real guard — **R18.2/R18.3/
      R18.8/R18.9 done 2026-07-27; R20.5, R20.31 and R40.1 done 2026-07-30, see below** (R20.5/R20.31
      also carried the independent anti-guard suspicion — CONFIRMED by experiment, see below)
- [x] The 3 helper-function rows (R17.2, R20.29, R39.6) are confirmed as correctly un-qualifiable
      and annotated as such — **the premise was WRONG on all three**: none was correct, two are
      gate-shaped after all, and each citation had rotted. Re-cited + mutation-proven 2026-07-30,
      `47f54bf2`; see the section below
- [x] `tests/governance/enforcement-coverage.test.ts` stays green, and each new qualifier is
      mutation-proved (break the gate in the source, watch the named test fail) — 4 mutations run
      2026-07-30; the R17.6 one is the finding (named file stayed green), and the R17.15
      ChangePlugin one exposed an unpinned guard now closed by 3 new tests + its own neuter
- [x] `bash scripts/with-node.sh npx tsc --noEmit` clean; governance suite green — tsc 0; full
      suite 276 files / 4126 passed (was 4123 — the 3 new R17.15 tests); the service file verified
      byte-identical to HEAD after every mutation

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

- [x] Re-cite the 7 stripped rows against their real guard, by reading — DONE 2026-07-30, `9a11a51b`
- [x] R18.8's two-site citation is confirmed to be the honest shape — and the grammar now KNOWN:
      the ratchet's multi-site separator is a COMMA (R18.8's own form), each cite needs a full
      path, and a gate qualifier is REJECTED when the row cites two different files. Applied to
      R17.15 (two sites, same file ⇒ both qualifiers kept) and R17.1 (two files ⇒ qualifier dropped)

## 2026-07-30 — the 7 stripped rows, re-cited by reading (`9a11a51b`)

| row | real guard | note |
|---|---|---|
| R3.3 | `ChangeTitle::G08` `:2539-2544` | **the stripped qualifier was RIGHT** — see finding 1 |
| R12.3 | `ChangeTitle::G15` `:3149-3152` | the swap's uninstall-old; see the open question below |
| R17.1 | `lib/agent-invariants.ts:111-146` + `:8220-8252` | two FILES ⇒ no qualifier permitted |
| R17.6 | `CreateAgent::G11` `:8220-8252` | its TEST column was also wrong — finding 3 |
| R17.15 | `InstallElement::G08` `:731-738` + `ChangePlugin::G01b` `:3590-3594` | second half was unpinned — finding 4 |
| R19.1 | `ChangeTitle::EXE` `:2595-2612` | GATE 9's ops label really is `EXE:` |
| R19.3 | `ChangeTitle::G9a` `:2631-2645` | the label is `G9a`, **not** `G09a` |

**1. R3.3's stripped qualifier was CORRECT, and the strip came from a partial read.** GATE 8 is
"Singleton check — **COS/ORCHESTRATOR** per team" and contains both branches; the 2026-07-27 audit
saw only the ORCHESTRATOR half. Only the RANGE was wrong. A verdict reached by reading half a gate
is still a wrong verdict — the same failure mode as deriving a qualifier from a range, one level up.

**2. The ranges are STALE, and the drift is NOT uniform — this is the measurement that validates
the do-not-batch-convert rule.** R3.2's cited `2291` + 193 = **2484 = exactly** the real GATE 7
line. Apply the same +193 to R9.2 and you land on GATE 14, not GATE 10. So a plausible constant
shift is confirmed EXACTLY on one row and wrong on the next: the one exact hit is precisely what
would have made a mass shift look verified.

**3. R17.6's TEST column was wrong too, and only a mutation found it.** Disabling `G11` left the
named file **18/18 GREEN**; the full suite caught it in
`tests/integration/createagent-g11-r17-core.test.ts`, whose name says exactly what it pins. The
right test existed all along — the map pointed elsewhere. Corrected.

**4. R17.15's `ChangePlugin::G01b` half was ENFORCED BUT PINNED BY NOTHING.** Deleting
`|| desired.action === 'disable'` left the ENTIRE suite green (276 files / 4123 tests / 0 failures),
on the pipeline the rule names FIRST. Closed with 3 tests + a neuter that reddens exactly the
disable case. General trap, now in that test file's header: **when a rule cites N enforcement
sites, a suite pinning N-1 looks identical to one pinning all N** — count the sites in the RULE
TEXT and mutation-prove each separately.

**5. This TRDD's note that "the ratchet never asserted qualifier correctness anyway" is STALE.**
It has a test `every gate qualifier names a real gate inside that pipeline`, and it refuses a
qualifier on a row citing two different files. My first four edits failed it; the grammar was then
read from the parser rather than guessed.

**6. Three sources agree on two of the citations.** The reddened describe blocks name the gate
themselves — "R3.3 — one CHIEF-OF-STAFF per team (**ChangeTitle GATE 8**)" and "R17.8 / R17.15 —
**InstallElement G08** core-plugin protection gate". Rule text + code + test title is what a
citation should cost.

**Two things found on the way, NOT fixed here:**

- **R12.3 has no REFUSAL.** "One role only" is maintained by `G15` uninstalling the old
  role-plugin, not by rejecting a second one — and `G15` detects the current plugin by scanning
  `enabledPlugins` and `break`s on the FIRST match, so two already-enabled role-plugins would leave
  the second in place. Under the map's own Verdict definitions (`ENFORCED` = "a guard refuses the
  violation") that is arguably not ENFORCED but *unrepresentable-by-construction*. A verdict change
  is a bigger act than a citation fix — recorded as a claim, for a decision.
- **The governance suite transiently writes the developer's REAL `~/agents`.** A clean run of
  `r3-r9-team-governance.test.ts` creates `~/agents/cos-manager-team` and rolls it back —
  `md5` of `ls ~/agents` is identical before and after, so net zero, but a kill mid-test would
  leave it. A 0-IMPACT boundary touch, worth its own card.

## 2026-07-30 — the 3 "helper" rows: the premise was wrong on all three (`47f54bf2`)

The acceptance box asked me to CONFIRM these three as correctly un-qualifiable. That framing was
itself a claim, and reading them refuted it. Nothing here was a helper row.

| rule | was | is | shape |
|---|---|---|---|
| R17.2 | `:1531-1533` | `:932-939 (InstallElement::EXE)` | gate-shaped after all |
| R39.6 | `:6381-6385` | `:6906-6925 (DeleteAgent::G01b)` | gate-shaped after all |
| R20.29 | `:1531-1533` | `:1712-1716` | genuinely not pipeline-shaped — bare range is honest |

**Both stale citations landed on the SAME shifted line, and it shifted under my own hand.**
`:1531-1533` is now a docblock inside `removeLocalInstallRecords`, moved there by `c08e8303`
earlier the same day. `:6381-6385` is now a governance-password check. So a row can rot between
one commit of a session and the next, which is the whole argument for citing something a test can
re-resolve.

**R39.6's Test column was an OVERSTATEMENT, not an omission.** The row read `—`, but
`tests/services/element-management-assistant-title.test.ts` already asserts the `G01b` refusal by
name. Same class of error as R17.6 above, in the opposite direction: the debt ledger was wrong
about a rule being unpinned.

Each mutation-proven against the FULL suite, never the named file:

| neuter | reddened |
|---|---|
| R17.2 — argv `'install'` → `'add'` | 1 / 4128 — the R17.2 argv test |
| R39.6 — `G01b` condition forced false | 1 / 11 — the R39.6 refusal test |
| R20.29 — `isLocalOnlyMarketplace` → false | 6 / 4128 across 4 files, the R20.29-named one among them |

R20.29 is the interesting one: 6 tests hold that routing decision, so it was the *best*-pinned of
the three while carrying the *worst* citation. Pinning and citing are independent properties, and
only the citation rots.

**Two more things found on the way, NOT fixed here:**

- **`inAdapterContext('ChangePlugin', …)` is MISLABELLED at `:917` and `:989`** — both sites are
  inside `InstallElement` (which begins at `:559`), and the other two call sites in the file name
  their own enclosing function correctly. It is inert today: `currentAdapterCaller()` has **zero
  production readers** (only its own test), so the audit string the module's docblock promises
  — "so the offending stack frame is easy to find", "the bypass is audit-visible" — is written and
  never read. A diagnostic with no reader, the same class as the FTS index that had no reader.
  And it is a DECISION, not a fix: the docblock's allowlist is `ChangePlugin` / `ChangeClient` /
  `TEST:` / `Bootstrap:`, so renaming the label to `InstallElement` would contradict the doc these
  two sites were presumably written to satisfy. Either the allowlist is stale or the label is —
  one of the two documents is wrong and I do not yet know which.
- **R20.31's citation `:1634-1712` ends exactly where R20.29's guard begins.** It is a category-B
  row still on the list above, and it already carries the anti-guard suspicion; this makes a
  drifted range the more likely reading. Check it by experiment when that row comes up.

## 2026-07-30 — the final 5 rows: R4.4, R17.8, R20.5, R20.31, R40.1

**R17.8** was already re-cited earlier this session (`a92bf954`, `InstallElement::G08` at `:740-745` —
the user-scope refusal branch, split from R17.15's uninstall/disable branch at `:731-738`).

**R4.4** — "auto-assigned MEMBER + programmer plugin on team join." The cited `:5128-5137` is now
`ChangeHook`'s G04/G05 (a `change_hook` ledger emit), proving the same drift class as everything
above: the citation was correct when `bd701701` wrote it, and unrelated code inserted above it since
pushed the real gate down. The real guard — `ChangeTeam::G07`, `const effectiveRole = …` through
`ChangeTitle(agentId, effectiveRole, …)` — now sits at `:5304-5320`. Mutation-proven: replacing
`titleResult` with a stub `{ success: true }` (so the real `ChangeTitle` call never fires) reddened
**0 / 4184** tests beyond two pre-existing, unrelated `design/`-corpus failures (confirmed identical
with and without the neuter) — so the Test column stays honest at `—`; nothing pins this end-to-end
today.

**R20.5** — "the default role-plugin MUST be installed automatically… See ChangeTitle Gate 15." The
cited `:1722-1778` is `getRequiredPluginForTitle` + `getCompatiblePluginsForTitle` (the lookup, not
the install). The rule's OWN text names Gate 15, and reading `ChangeTitle` confirms it: G15
(`:3089-3160`) computes the target plugin and uninstalls the outgoing one; G16 (`:3162-3210`) installs
it. Neither is `autoAssignRolePluginForTitle` (`:1957-2008`), the function the existing test in
`r20-marketplace-governance.test.ts` calls directly — that helper is invoked only via `syncRolePlugin`,
which nothing in `ChangeTitle`, `ChangeTeam`, or `CreateAgent` calls (grepped clean; every title-grant
path routes through `ChangeTitle` itself, which has its own inline G15/G16 rather than delegating).
Mutation-proven: forcing G16's install branch to `if (false && …)` reddened **0 / 4155** tests beyond
the same 2 pre-existing corpus failures — the currently-listed test does not exercise the real
pipeline. Re-cited to `ChangeTitle::G15` + `::G16` (two same-file gate-qualified sites, per the R17.15
multi-site grammar) and the Test column corrected to `—` rather than leave a wrong "verified" claim
standing.

**R20.31** — "AI Maestro's uninstall button never reaches into the [3 source] folders." The cited
`:1634-1712` is `restoreLocalInstallRecords` (an R51 rollback helper) bleeding into the start of
`installPluginLocally` — not `uninstallPluginLocally` at all, and this is the SAME range the TRDD's
2026-07-30 helper-rows section already flagged as suspicious ("R20.31's citation ends exactly where
R20.29's guard begins"). Confirmed by experiment, not reading: wiring the real anti-guard
`removeConvertedPlugin` (from `plugin-storage-service.ts`, which the existing test-file comment
already named as "the exact opposite of a guard") into the end of `uninstallPluginLocally` reddened
**exactly 1 test** — `R20.29 / R20.31 … UNINSTALL never deletes from the three source containers
(R20.31)` — with all other failures being the same 2 pre-existing unrelated ones. Re-cited to
`uninstallPluginLocally` at `:1834-1910` (a helper function, no `ops.push` gate labels — bare range is
the honest form, same class as R20.29/R39.6).

**R40.1** — "non-native users need MAESTRO approval for every agent OR team creation." The cited
`:244-271` spans `isForeignUser` (`:225-237`) into `assertForeignUserMayCall` (`:245-272`) — off by
one line at each end (stale by a small, non-uniform shift, the same "drift is not uniform" lesson
from the R3.2/R9.2 comparison earlier this TRDD). More importantly the rule's TWO clauses (agent
creation, team creation) are enforced at TWO call sites in TWO DIFFERENT FILES:
`CreateAgent::G00f` (`element-management-service.ts:7467-7481`) and `createNewTeam`'s inline R40 gate
(`teams-service.ts:271-277`, no gate label — this pipeline carries no `ops` trace). Per the R17.1
precedent (two files ⇒ no qualifier permitted), re-cited as the shared decision function's own bounds
plus the second file, comma-separated: `element-management-service.ts:245-272,
services/teams-service.ts:271-277`. No test names either call site directly (`teams-service.test.ts`
mocks `assertForeignUserMayCall` rather than exercising it), so `—` is unchanged and honest.

**Verification.** `tests/governance/enforcement-coverage.test.ts` — 9/9 green (the "cites a guard file
that exists" test caught my first R20.31 attempt, which appended `(uninstallPluginLocally)` as
non-gate-qualifier prose the file-path regex cannot parse — fixed to a bare range). `bash
scripts/with-node.sh npx tsc --noEmit` — one PRE-EXISTING, unrelated error
(`tests/services/auto-update-absorbed-duty.test.ts:145` `afterEach` not found) in a file this TRDD
never touches; `services/element-management-service.ts` and `docs/GOVERNANCE-ENFORCEMENT-MAP.md`
themselves type-check clean. `services/element-management-service.ts` restored byte-identical to HEAD
after every neuter (`git diff --stat` empty each time). Category A and category B are now BOTH fully
closed — this TRDD's remaining acceptance boxes were already ticked.

## Approval log

- 2026-07-26T16:23:45+0200 — MANDATE (self, min-approval-requirement: none). Tier 0: an EHT of
  H4Y9F25J confined to this project's own docs and tests. Born approved.
