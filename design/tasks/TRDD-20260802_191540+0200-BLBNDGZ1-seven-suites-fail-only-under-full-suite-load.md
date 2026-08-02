---
trdd-id: BLBNDGZ1
title: Seven test files fail only under full-suite parallel load and pass in isolation
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T19:15:40+0200
updated: 2026-08-02T19:15:40+0200
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

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

- [ ] full suite run at base commit `0fcf7116`, failing set recorded — pre-existing or not, stated
- [ ] each of the 7 files given its OWN verdict (shared-state fixture / real ordering bug / timeout)
- [ ] no file closed as "flake" without naming the specific shared resource or the timeout measured
- [ ] `yarn test` exits 0 with no per-file exclusions added to hide a failure
- [ ] the 5 files doing `mkdtemp`/`HOME` juggling audited for cross-test leakage

## Approval log

- 2026-08-02T19:15:40+0200 — SELF-MANDATE (min-approval-requirement: none). Test-hygiene work
  inside the authoring agent's own scope: no baseline deviation, no cross-team reach, no
  governance change, reversible. No approval request was sent.
