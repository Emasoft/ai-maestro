---
trdd-id: 3KN99N6S
title: Wall-clock assertions flake under full-suite parallelism and cost an isolation run each time
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-29T12:54:55+0200
updated: 2026-08-29T12:54:55+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-29T12:54:55+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: minor
effort: S
labels: [tests, flake, ci]
external-refs: []
implementation-commits: []
---

# Wall-clock assertions flake under full-suite parallelism

## Problem

Four test files assert a **wall-clock bound** and fail under `yarn test` while passing in
isolation. Measured twice today on the same tree, two hours apart:

| time | full-suite failures | in isolation |
|---|---|---|
| ~11:00 | **1** file (`statusline-capture-wrapper`) | 21/21 green |
| ~12:40 | **4** files | 56/56 green |

The four: `tests/unit/statusline-capture-wrapper.test.ts`,
`tests/governance/r17-r11-core-plugin-binding.test.ts`,
`tests/unit/aimaestro-governance-dev-login.test.ts`,
`tests/unit/fleet-plugins-update.test.ts`.

The sharpest instance, because its own comment shows the threshold was chosen with margin and
the margin was not enough: `statusline-capture-wrapper` asserts a **detached** spawn returns
within **2000 ms** and measured **17745 ms** — 8.9× the bound, against a comment reasoning that
2000 ms gives "2.5× margin" over the 5000 ms the child sleeps.

**The count rising 1 → 4 within two hours, with no test or source change between the runs,** is
the finding: this is not four independent flaky tests, it is one property (elapsed wall time)
being measured on a box whose load the suite does not control. Both runs happened alongside a
5.2 GB `alcore` process (AgentLens Pro's server, pid 14665).

**The cost is real and recurring:** every occurrence requires an isolation re-run to decide
whether a failure is genuine, and it happened **three times in one session**. A suite that
cannot be trusted on a red is a suite whose reds get ignored.

## Root cause

A wall-clock bound is a **proxy** for the property under test. What
`statusline-capture-wrapper` actually wants to know is *"did the parent return BEFORE the child
finished?"* — a happens-before question. Elapsed time answers it only while the machine is
quiet, so the assertion is sound in the developer's terminal and unsound in the runner that
executes it alongside 499 other files.

## Proposed fix

**Assert the property, not the proxy.** For the detachment case: have the child write a marker
file after its sleep, and assert the parent returned **while the marker is still absent**. That
is exact under any load, needs no threshold, and cannot be "tuned" into vacuity later.

Raising the thresholds is explicitly REJECTED: it weakens every one of these tests by exactly
the amount the machine happens to be loaded on the day someone picks the number, and it leaves
the next reader a magic constant with no derivation.

For the other three, first establish whether each is the same shape — a genuine happens-before
or ordering property expressed as a duration — before touching it. One of them may legitimately
need a duration, in which case say so on this card rather than converting it.

## Verification

- The four files pass in a **full parallel** `yarn test`, repeated 3× on a loaded box.
- Each converted assertion is neutered and reddens: break the detachment (make the parent
  `await` the child) and the marker-file assertion must fail.
- No test in the four gains a threshold constant it did not have.

## Acceptance

- [ ] Each of the four is classified: happens-before property vs genuinely durational, with the
      classification written down per file (a duration kept must say WHY, and that is a finding
      worth recording, not a failure to convert).
- [ ] `statusline-capture-wrapper`'s detachment test asserts the marker-file property with no
      wall-clock bound, and its neuter (parent awaits the child) reddens it.
- [ ] Three consecutive full-suite `yarn test` runs on a loaded box are green.
- [ ] No threshold was raised to achieve any of the above.

## Notes

Filed after checking the corpus for an existing card — none covers this
(`grep -rl "statusline-capture-wrapper" design/` returns nothing outside this file).

The `alcore` process is a plausible contributor and is NOT asserted as the cause: it is the
owner's to stop, the correlation is two data points, and the fix above holds regardless of what
is loading the box. That is the point of converting the assertion rather than quieting the
machine.
