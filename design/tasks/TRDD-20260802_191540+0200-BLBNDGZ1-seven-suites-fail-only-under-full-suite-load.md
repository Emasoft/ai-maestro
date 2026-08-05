---
trdd-id: BLBNDGZ1
title: Seven test files fail only under full-suite parallel load and pass in isolation
column: cancelled
scope: project
project-id: ai-maestro
created: 2026-08-02T19:15:40+0200
updated: 2026-08-05T04:58:45+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T19:15:40+0200
severity: medium
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [tests, concurrency, flake-suspect]
---

# Seven test files fail only under full-suite parallel load and pass in isolation

## ⏵ STATE — CLOSED 2026-08-05 as NOT REPRODUCIBLE. Zero code changed.

The card's own prescribed experiment was run, and it **refutes the card's premise at the card's own
base commit**. Numbers, all measured today:

| where | result | the 7 named files |
|---|---|---|
| **HEAD**, full suite ×5 | `5070 passed / 2 skipped`, exit 0 every run | **7/7 passed, 5/5 runs** |
| **base `0fcf7116`**, full suite in a scratch worktree | `4928 passed`, 2 failed | **7/7 passed, 0 failed** |

So "30 failed across these 7 files" does not reproduce **even at the commit where it was observed**.
Nothing was fixed in the meantime either: `git log --since=2026-08-02` over all seven paths returns
**zero commits** — the test files are byte-identical to when the failure was recorded.

**The 2 base-commit failures are artifacts of my own experiment, not findings.** Both are
workdir-policy tests asserting a specific denial REASON:

```
expected 'outside $HOME (/private/tmp/aim-base)' to match /ai-maestro installation/i
```

The worktree lives in `/private/tmp`, so an earlier guard ("outside `$HOME`") fires and the policy
denies for a different — equally correct — reason. The guard works; the assertion is
location-dependent. **That is a real, separate defect** — filed as **TRDD-ZR5WUQJZ** rather than
smuggled into this one, because it is deterministic and this card's subject is not.

**Why the experiment is sound rather than a confound:** `git diff 0fcf7116..HEAD -- package.json
yarn.lock` is EMPTY across all 104 commits, so symlinking the current `node_modules` into the base
checkout introduces no dependency drift — the one confound the card's recipe did not mention.

**What this does NOT claim.** Not "the failures were never real". The original observation was made
in the main checkout under whatever ambient load existed at 2026-08-02T19:15; today's runs are a
different machine state. The honest verdict is **transient / environment-dependent, not
reproducible on demand**, which is precisely the disposition the card's own "Why this is not filed
as 'just a flake'" section was written to avoid reaching casually — so it is reached here with five
HEAD runs and a base-commit control behind it, not with a shrug.

**Column `cancelled`, not `complete`:** the investigation finished, but no defect was found and no
code was written. Calling it `complete` would assert a fix that does not exist.

**SUPERSEDED — do NOT carry forward:** the failure counts, the NEXT ACTION, and the seven-file list
as a live defect set.

## ⏹ The original report — 2026-08-02 (premise refuted above; kept for the record)

`yarn test` → **30 failed / 4915 passed / 2 skipped across 350 files**, in these 7:

```
tests/governance/r10-restart-manager-gate-parity.test.ts
tests/integration/haephestos-pipeline.test.ts
tests/services/change-title-window.test.ts
tests/unit/aimaestro-settings-cli.test.ts
tests/unit/pillar-cli-env.test.ts
tests/unit/pillar-cli-exit-codes.test.ts
tests/unit/pillar-graph-cli.test.ts
```

Running those same 7 files together, alone: **90 passed, exit 0.**

**NEXT ACTION:** confirm the failures are pre-existing by running the full suite at the base
commit `0fcf7116` in a scratch worktree (symlink `node_modules` from the main checkout, since a
fresh worktree has none), and compare the failing set:

```bash
git worktree add /tmp/aim-base 0fcf7116
ln -s "$PWD/node_modules" /tmp/aim-base/node_modules
(cd /tmp/aim-base && bash scripts/with-node.sh yarn test > /tmp/base-suite.txt 2>&1)
grep -E "^ *Tests " /tmp/base-suite.txt
```

## What was measured, and what was NOT

Found while verifying the rotator.log work (`2eb75533..bbb985b2`). **Causation by that series is
ruled out**, on three independent facts:

- all 7 files contain **zero** references to `oauth-rotator`, `decision-log`, `alert-delivery`,
  `server-supervisor`, or `supervisor` — no dependency edge to anything the series touched;
- they **pass in isolation on HEAD**, i.e. with those changes present. A change that broke them
  would break them alone too;
- the series' own 4 suites are green (55 tests), and `tsc --noEmit` is clean.

**NOT measured: whether they also fail at the base commit.** That is the whole point of the NEXT
ACTION and the reason this card is not titled "pre-existing flake" — asserting *pre-existing*
without running the baseline is exactly the unverified claim that keeps costing time here.

## Why this is not filed as "just a flake"

Two lessons in `.claude/rules/lessons-verification.md` bear directly on it, and they point the
opposite way from the comfortable reading:

- *"passes in isolation is the SIGNATURE of a concurrency defect, not evidence that there is
  none."*
- *"NAME EVERY FAILING FILE INDIVIDUALLY BEFORE CALLING ANY OF THEM A KNOWN FLAKE — a label
  attaches to the SET and hides whatever else is in it."* The last time this was triaged here,
  three files were being carried as "pillar-graph-cli timeouts"; two were genuine 5 s timeouts and
  **the third was a real concurrency bug** whose assertion (`expected 420 to be 292`) was not a
  count at all but octal file modes, `0o644` vs `0o444`.

So each of the 7 needs its own verdict. **5 of the 7 do `mkdtemp` / `process.env.HOME` juggling**,
which is the obvious shared-resource suspect under a parallel pool, but that is a hypothesis, not
a finding.

## Verification

```bash
bash scripts/with-node.sh yarn test                       # target: 0 failed
# and per file, the discriminating run — under load, not alone:
bash scripts/with-node.sh yarn vitest run <one-file>      # must agree with the full-suite verdict
```

A fix is only real if the file passes **in the full suite**, not merely alone.

## Estimated risk

LOW to investigate, MEDIUM to fix. If the cause is shared `HOME`/tmp state, the fix is per-file
isolation; if it is a genuine ordering bug in the code under test, it is a real defect that the
parallel pool is merely exposing — and that is the outcome worth wanting, because it is currently
reaching `yarn test` and being read as noise.

## Acceptance

- [x] full suite run at base commit `0fcf7116`, failing set recorded — **done, and it refuted the
      premise**: `4928 passed`, and all 7 named files PASSED there. The only 2 failures are
      artifacts of the worktree being outside `$HOME`, filed separately.
- [~] each of the 7 files given its OWN verdict — **moot, and deliberately not manufactured.** A
      per-file verdict requires a per-file failure to diagnose; none of the 7 fails at HEAD (5 runs)
      or at base. Inventing seven verdicts for seven passing files would be fiction.
- [x] no file closed as "flake" without naming the specific shared resource or the timeout measured
      — **honoured by NOT closing them as flakes.** The verdict is "not reproducible", which names
      what was measured (5 HEAD runs + a base control) instead of guessing a mechanism.
- [x] `yarn test` exits 0 with no per-file exclusions added to hide a failure — exit 0, five times,
      with zero exclusions and zero code changed
- [~] the 5 files doing `mkdtemp`/`HOME` juggling audited for cross-test leakage — **NOT done and
      deliberately NOT carried forward as a card.** A speculative audit with no symptom to audit
      against is exactly the card that sits on a board forever, and the board is already the thing
      this project is trying to drain. What the experiment DID surface from that same class is one
      CONCRETE, reproducible instance — an assertion that depends on the checkout's location
      relative to `$HOME` — and that is filed, because it fails deterministically rather than
      hypothetically. If a leak in the other four ever fires, it arrives with a symptom and gets a
      card then.

## Approval log

- 2026-08-02T19:15:40+0200 — SELF-MANDATE (min-approval-requirement: none). Test-hygiene work
  inside the authoring agent's own scope: no baseline deviation, no cross-team reach, no
  governance change, reversible. No approval request was sent.
- 2026-08-05T04:58:45+0200 — CLOSED as `cancelled` by ai-maestro. The card's own prescribed
  base-commit control run REFUTED its premise: all 7 named files pass at `0fcf7116` and at HEAD
  (5 full-suite runs, exit 0 each), and zero commits touched any of the 7 files in between. No
  defect found, no code changed — hence `cancelled`, not `complete`. The control run's only 2
  failures were artifacts of the worktree living outside `$HOME`; that IS a real, deterministic
  defect and is split out as TRDD-ZR5WUQJZ rather than absorbed here.
