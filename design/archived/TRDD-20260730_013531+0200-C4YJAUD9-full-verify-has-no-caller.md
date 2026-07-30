---
trdd-id: C4YJAUD9
title: The index's expensive verify has an entry point and no caller, so corruption is detectable and undetected
column: completed
scope: project
project-id: ai-maestro
created: 2026-07-30T01:35:31+0200
updated: 2026-07-30T07:14:38+0200
implementation-commits: [5113591d]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T01:35:31+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 2
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# The index's expensive verify has an entry point and no caller, so corruption is detectable and undetected

## The hole this handles

`TRDD-4VCXRHAY` split `validate` by depth because running the full pass on every open made the
SAFETY MECHANISM the scaling wall: a graph query over 10 000 cards cost 11 ms behind a 666 ms open,
of which 671 ms were two whole-index scans. The split was correct and is measured — warm `board` went
**1.03 s → 0.37 s**. Its own body then stated the condition the split depends on:

> the expensive half must have a real scheduled caller rather than only an opt-in flag — **a check
> nobody runs is a check that does not exist.**

**That caller was never built.** Measured 2026-07-30 while closing 4VCXRHAY, by grepping every
non-test caller of the full pass across `lib/ scripts/ app/ services/ server.mjs`:

| caller | what it is |
|---|---|
| `scripts/bench-cold-index.mjs:66` | a BENCHMARK. Not scheduled, not on-demand, not run in normal use |

That is the entire list. `validate()` and `openIndex(file, { verify: 'full' })` exist and are
exercised only by tests. So 4VCXRHAY's box 3 ("an explicit full-verify entry point exists") is met
exactly as worded, and the principle the same card argued is not.

**What is actually unchecked.** The full pass adds SQLite's `integrity_check`, which walks every
b-tree page — the one check that detects a genuinely damaged file rather than a wrong shape. It now
runs ONLY at create, at each migration step, and after a heal. An index that is created once and
never migrates again therefore never gets a full check for the rest of its life. `TRDD-YN8EQWYP`
narrowed this further: the read path is `structural` by design, and `busy` is now (correctly) never
healed, so contention no longer triggers the heal path that would have incidentally full-checked.

Corruption is not silent forever — SQLite raises on damaged pages at query time and `openIndex`
treats a throw as a heal trigger — but that is detection by ACCIDENT, at the moment a user is asking
a question, rather than by a verifier whose job it is.

## What has to be decided

The work is small; the decision is where it lives. Three candidates, none obviously right:

1. **A `greptrdd` subcommand** (`greptrdd index-verify`, or a `--verify` flag on an existing one) —
   on-demand only, zero scheduling machinery, and it gives a human something to run. Cheapest. But
   on-demand means nobody runs it, which is the failure this card is about.
2. **A server timer**, alongside the absorbed janitor chores (`TRDD-KCRMSNL7`'s per-chore unref'd
   timers). Real scheduling. But the server is not the index's only writer — every agent's
   `greptrdd` is — so a server-scheduled verify covers a path the server does not own, and it must
   iterate `statePath('pillar-index')/*.sqlite`, i.e. N corpora it may know nothing about.
3. **Sampled on the read path** — full-verify with probability 1/N per open, so cost amortizes and
   every index gets checked eventually. Needs no scheduler and covers exactly the writers that
   exist. But it reintroduces a rare multi-second open, which is the thing 4VCXRHAY removed.

Whatever is chosen must NOT reintroduce the wall 4VCXRHAY measured, and must record a heal event
when it finds something (`recordHeal`) so a recurring corruption is visible rather than repaired in
silence.

## DECISION 2026-07-30 — a server timer DETECTS, a `greptrdd` verb REPAIRS; sampling is rejected

**Adopt 2 AND 1, in different roles. Reject 3.** The box below asked for one home and two
rejections; the measured shape is a split, because one structural fact divides the work:

**`corpusKeyFor` is a ONE-WAY hash.** It is `<slug>-sha256(realpath).slice(0,12)`
(`lib/pillar/index-db.ts:275`). Given an index FILE you cannot recover its corpus, and nothing in
`lib/`, `scripts/` or `server.mjs` enumerates the index dir today (2 references, both computing ONE
path from a known `designDir`). So a host-wide sweep can **detect** (an `integrity_check` is a
property of the file alone) and can **nuke** (the index is derived), but it can NEVER **rebuild** —
rebuilding needs the corpus path only the caller has. That is not a defect: it forces exactly the
non-healing-observer shape the plan's contract point 9 requires — *an observer must not repair what
it measures.*

| candidate | verdict |
|---|---|
| **2 · server timer** | **ADOPTED as the scheduled DETECTOR.** It is the only option that satisfies the acceptance box literally — runs in normal operation, not a benchmark, not a flag a human must remember. The pattern is proven: `server.mjs` already starts five (`startAgentInvariantsWatchdog`, `startOauthRotatorTick`, `startServerLiveness`, `startFleetLivenessWatchdog`, `startClaudeSettingsEnforcerWatchdog`). Its stated objection — "the server is not the index's only writer" — is **weaker than the card assumed**: the verifier does not need to know who wrote the file or what corpus it indexes. |
| **1 · `greptrdd` subcommand** | **ADOPTED as the manual REPAIRER and the serverless fallback.** Its only flaw was being the *sole* caller; that dissolves once it is not. It is also the only path that HOLDS the `designDir`, hence the only one that can rebuild — and the only verification a standalone repo user with no ai-maestro server running will ever get. Cheap enough that omitting it buys nothing. |
| **3 · sampled 1/N on read** | **REJECTED.** At the epic's stated 10⁵ target a full pass is ~3.7 s (measured 367 ms at 10⁴), so a 1-in-N open becomes a multi-second unpredictable hang on an interactive command — reintroducing the wall 4VCXRHAY removed, and doing it *at the moment a user is waiting*, which is precisely the "detection by ACCIDENT, while someone asks a question" failure this card was opened to fix. It would replace a silent gap with a visible stall. |

**`YN8EQWYP` is what makes the sweep SAFE, and the two cards are coupled.** A background verifier
that meets a live writer must not touch the file — and until `busy` became a NEVER_HEALED fault, the
generic heal branch would have `nuke()`d an index another process was mid-build on (POSIX `unlink`
succeeds against an open file, so the writer keeps writing into an unlinked inode and reports
success). So the sweep must take `BEGIN IMMEDIATE` and **skip on `busy`**, never wait it out and
never delete on contention. Written before that fix, this candidate would have been the bug.

## BUILT 2026-07-30 — `lib/pillar/index-verify.ts`, the watchdog, and `greptrdd index-verify`

**The split as decided, in three pieces.** `lib/pillar/index-verify.ts` holds the core
(`verifyIndexFile` · `listIndexFiles` · `runIndexVerifySweep` · `runIndexVerifyTick` ·
`startPillarIndexVerifyWatchdog`); `server.mjs` starts the watchdog beside the five existing ones
(6-hourly, `AIM_PILLAR_INDEX_VERIFY_INTERVAL_MS`, 0 disables); `greptrdd index-verify [--repair|--all]`
is the repairer and the serverless fallback.

**Two design facts settled while building, neither of which was in the decision:**

- **The observer sets ONE pragma, and it is not `applyPragmas`.** That helper also sets
  `journal_mode = WAL`, which is a PERSISTENT write — on a rollback-journal index the "observer"
  would silently convert it, violating `3P-IDX-07` by a route nobody would call healing. Only
  `busy_timeout` is set, and a test pins that a `journal_mode = delete` index is still `delete`
  afterwards.
- **`fileMustExist: true`, or the observer becomes a writer.** `new Database(p)` MATERIALIZES an
  empty database at any path, so a sweep with one bad path would leave litter shaped exactly like the
  thing it audits. Neuter-proven.

**The repair adds NO deletion code.** `--repair` asks `openIndex` for `verify: 'full'` and lets the
already-tested self-heal do it. A second "is this healable?" decision is precisely what drifted apart
once before and cost a healthy index (NEVER_HEALED), so there is still exactly one.

**THE LEDGER RECORDS A TRANSITION, NOT A POLL — and this is load-bearing, not tidy.** The ledger
holds 50 entries. A 6-hourly sweep over one unrepaired damaged index would re-append the same event
~4x/day, so within two weeks all 50 slots are copies of it and every genuine heal has been evicted:
the ledger would look full of history and contain none, destroying the exact signal `3P-IDX-09`
exists to preserve. So damage is appended only when it is not already the newest entry, and a heal
in between separates the records — which is how a RECURRENCE stays legible. `busy` and `behind`
record NOTHING at all (a false alarm discredits the true ones).

**MEASURED — the warm read path, and what the number actually is.** 10 000-card fixture, `HOME`
redirected to a temp state dir (so nothing touched the real one). Same method throughout:

| measurement | real |
|---|---|
| process startup only (`help` — reads nothing) | 0.49 / 0.53 s |
| warm `board` **with** index | 0.57 / 0.58 / 0.62 s |
| warm `board` at **HEAD, this change stashed away** | 0.60 / 0.57 / 0.57 s |
| warm `board --no-index` (pure walk, for scale) | 1.32 s |

**The A/B is the answer to the box, and it says UNCHANGED** — identical within noise, because the
verifier is imported only by `server.mjs` and the new subcommand, so `board` never loads it. The
absolute figure ALSO corrects how the 0.37 s should be quoted: ~0.5 s of this is `bash with-node.sh`
+ `npx tsx` startup, so the index-backed query does **~0.08 s of real work** at 10⁴ and the walk does
~0.8 s. Do NOT quote my 0.57 s against 4VCXRHAY's 0.37 s as a regression — they are different
harnesses, and the only sound comparison (same method, before vs after) shows no change.

**6 NEUTER RUNS, each failing ONLY its named tests, each restored byte-clean:**

| neuter | tests reddened |
|---|---|
| the ledger WRITE removed | the 3 ledger tests, and nothing else |
| the de-dup disabled (always record) | 1 — "does NOT append the same damage twice" |
| `fileMustExist` removed | 1 — "NEVER CREATES the file it was asked about" |
| `behind` collapsed into `damaged` (the janitor#123 class) | 2 — the classifier AND its ledger consequence |
| `BEGIN IMMEDIATE` contention probe removed | 2 — both `busy` guards |
| a `nuke` ADDED to the observer (`3P-IDX-07` violated) | 2 — "LEAVES A DAMAGED INDEX EXACTLY AS IT FOUND IT" + the recurrence test |

**Live end-to-end, on a contained `HOME`:** `--all` on one healthy index → `ok`, exit 0; with a
seeded damaged one → both listed, the damaged one NAMED with its repair command, `1 newly recorded in
the heal ledger`, exit 1; then damage this corpus's own index → `--repair` rebuilt it (10 000 records,
389 edges), recorded the heal, re-verified `ok`, exit 0.

Suite: 275 files / 4097 passed / 2 skipped; `tsc --noEmit` clean. New tests: 25.

## Acceptance

- [x] A caller of the FULL pass exists that runs in normal operation — not a benchmark, not a test,
      not an opt-in flag a human must remember — **`startPillarIndexVerifyWatchdog()`, started from
      `server.mjs`** beside the five existing watchdogs. Its FIRST sweep is DELAYED 60 s rather than
      run at boot: the sweep is synchronous, so an inline boot pass would add N x the full pass to
      the one moment a client is most likely waiting — and that delay is what makes starting it
      unconditionally safe
- [x] The chosen home is recorded here with the reason the other two were rejected — **recorded, with
      the box's own premise corrected**: it presumed one home and two rejections, and the measured
      answer is a SPLIT (server timer DETECTS, `greptrdd` verb REPAIRS) because `corpusKeyFor` is a
      one-way hash, so only ONE candidate was rejected (sampling). Reasons above
- [x] MEASURED: the warm read path is unchanged — **A/B on the same 10⁴ fixture and the same method,
      my change vs HEAD-with-it-stashed: 0.57/0.58/0.62 s vs 0.60/0.57/0.57 s, identical within
      noise.** The box's phrasing ("unchanged from 0.37 s") could not be satisfied literally and the
      attempt is what produced the useful number: ~0.5 s of any such reading is `npx tsx` startup, so
      the index query is ~0.08 s of real work and the two harnesses' totals must not be quoted
      against each other. The A/B controls for exactly that
- [x] A fault it finds is recorded in the heal ledger, so a corruption that recurs is visible
      (`3P-IDX-09`); NEUTER-proven — removing the ledger write reddens the 3 ledger tests and nothing
      else, and a SECOND neuter proves the de-dup, without which a 6-hourly sweep fills all 50 slots
      with copies of one event and evicts the real history
- [x] `3P-IDX` gains the clause that the expensive pass must have a real caller, batched with the
      next spec bump rather than triggering one of its own (see the note on YN8EQWYP) — **DONE
      2026-07-30 as `3P-IDX-15` expensive-pass-needs-a-caller, batched into `spec-version: 1.3.0`.**
      The batching worked, and only just: 1.3.0 was committed hours earlier for the
      `status:`-is-not-`column:` ruling but had **not yet been communicated to the janitor**
      (verified — no issue or comment on Emasoft/ai-maestro-janitor mentions any 3P clause), so this
      clause rode the SAME bump and the cost is paid once: one MINOR version, one janitor
      notification, one census update (`pillar-store.test.ts` 58 → 59, re-derived with my own grep,
      never copied out of the failure output). Had the notification already gone out, this clause
      would have forced 1.4.0 — the window was open only because a deliverable was still owed, which
      is luck, not design

## Approval log

- 2026-07-30T01:35:31+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT inside the parent's own scope, reversible, no baseline deviation.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-07-30T07:14:38+0200 — COMPLETED by ai-maestro. All 5 boxes checked: the last one
  (`3P-IDX-15`) landed batched into the already-committed-but-not-yet-notified 1.3.0, so the
  MINOR-bump cost is paid once as the box required.
