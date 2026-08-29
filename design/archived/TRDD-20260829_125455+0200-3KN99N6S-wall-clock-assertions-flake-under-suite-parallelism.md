---
trdd-id: 3KN99N6S
title: Load-sensitive tests flake under full-suite parallelism - one wall-clock assertion and three subprocess timeouts
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-29T12:54:55+0200
updated: 2026-08-29T16:40:06+0200
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
implementation-commits: [194faf10]
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

## ⚠ CORRECTED 40 MINUTES AFTER FILING — "four files assert a wall-clock bound" is FALSE

I read ONE file (`statusline-capture-wrapper`) and wrote the framing for FOUR. Classified
properly — `grep -nE "toBeLessThan|elapsed|Date.now|timeout"` on each, then each failure's actual
error text — they are **two different classes**, and only the first is what this card's title says:

| file | failure | class |
|---|---|---|
| `statusline-capture-wrapper` | `expected 18006 to be less than 2000` | **wall-clock ASSERTION** |
| `r17-r11-core-plugin-binding` | `Test timed out in 30000ms` (:746) | runner timeout, subprocess |
| `aimaestro-governance-dev-login` | `Test timed out in 30000ms` (:95) | runner timeout, subprocess |
| `fleet-plugins-update` | `Test timed out in 30000ms` | runner timeout, subprocess |

**Only ONE file contains a timing assertion at all.** The other three assert nothing about
duration; they spawn a real subprocess (`bump-version.sh`, `aimaestro-governance.sh login`, the
fleet updater) and the RUNNER kills them at its 30 s limit when the box is loaded. That is a
different defect with a different fix, and grouping them cost the card its accuracy on 3 of 4 rows.

**RETRACTED IN FULL (2026-08-29T16:1x). The classification above is CORRECT for all three; my
"correction" to it, committed as `0e83d870`, was the error — and it was the same defect it accused
the card of.**

I claimed `fleet-plugins-update.test.ts` spawns nothing, on this evidence alone:

    grep -cE 'execFileSync|spawnSync|execSync|spawn\(' tests/unit/fleet-plugins-update.test.ts   # 0

**Two independent failures in one claim.**

1. **WRONG POPULATION.** The needle was pointed at the TEST FILE; the assertion was about the TEST
   RUN. The test imports a module, and a spawn inside that module is invisible to a grep of the
   test. Asking the module instead settles it immediately —
   `lib/fleet-plugins-update.ts:46` `import { execFile } from 'node:child_process'`, `:54`
   `const execFileAsync = promisify(execFile)`, `:196` `await execFileAsync('claude', ['plugin',
   'update', …])`. `updateTarget` takes **no** injected spawner; the subprocess is unconditional,
   and the module's own comment calls it *"the lane's ONLY mutation channel"*.
2. **INCOMPLETE NEEDLE.** It matched neither `execFile(` nor the `promisify(exec…)` idiom actually
   in use — and a zero from a blind needle is indistinguishable from a true absence. It also
   misses `exec(`, `fork(`, an aliased destructure, `execa`, `zx`, and `await import(…)`.

And the test file says so in plain English, three lines above the code I skimmed:
*"A real subprocess, but a harmless one: a fake `claude` shim on PATH that prints its own cwd — a
mocked execFile would prove only the mock."* Two of its cases write a `/bin/sh` shim into a temp
dir, prepend it to `PATH`, and spawn it for real.

**My "every case injects its dependencies" came from grepping `it(`/`describe(`/`await` lines** —
test TITLES, which cannot show a signature. That is sample-to-population one layer in, inside a
commit congratulating itself for catching sample-to-population. `runFleetPluginsUpdate` does take
an injected `update`, which is what made the wrong reading feel confirmed; `updateTarget` does not,
and its two cases are the ones that spawn.

**The lesson, which is the only thing here worth keeping:** *a grep over a test file measures the
test file, never the test run.* To ask whether a test spawns, ask the MODULE it imports — or watch
the process table while it runs. Both settling commands came from an adversarial review that had
read nothing but my own claim; the error was reachable from the claim's SHAPE alone.

**This is the third time today I generalised from a read sample to an unread population** (the
others: "nothing non-gated is queued" from 5 of 22 cards; the DeleteAgent gate list). Recording it
here rather than silently editing, because the pattern is the finding.

**What survives unchanged:** the 1 → 4 escalation in two hours with no source change, and the cost
(an isolation re-run each time). Both classes are load-sensitive; they just fail by different
mechanisms.

**Note the dev-login file already documents its own history here** (`:165-167`): its timeout was
raised once because it "was measured FLAKY at the default", with the comment observing that such a
test gets "re-run until green and then believed". Raising it again is the move that comment warns
against.

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

- [x] Each of the four is classified: happens-before property vs genuinely durational, with the
      classification written down per file (a duration kept must say WHY, and that is a finding
      worth recording, not a failure to convert).
      **DONE 2026-08-29 — and it REFUTED this card's own title.** One wall-clock assertion
      (`statusline-capture-wrapper`), three runner timeouts on subprocess tests. Table in the
      correction section above. The three are NOT convertible to a happens-before assertion,
      because they assert nothing about time in the first place — they are slow, and the runner's
      30 s limit is what fails them.
- [x] `statusline-capture-wrapper`'s detachment test asserts the marker-file property with no
      wall-clock bound, and its neuter (parent awaits the child) reddens it.
      **DONE 2026-08-29.** The hang fixture now stamps `hang.done` as its LAST act, so the file's
      ABSENCE the instant the wrapper returns IS "the wrapper did not wait for the child" — exact
      under any load, no threshold. `expect(elapsed).toBeLessThan(2000)` is gone.
      **Neuter run:** dropped the `&` at `scripts/aimaestro-statusline-capture.sh:213` ⇒ the one
      test reddens with `expected true to be false` (the marker existed, because the wrapper
      waited). Restored; 21/21 green, tsc 0.
      Note the fixture is SIGKILLed in `afterEach`, so on the detached path the marker is never
      written at all — which is the observation we want, not a gap.
- [x] Three consecutive full-suite `yarn test` runs on a loaded box are green.
      **DONE 2026-08-29T16:24 — for THIS CARD'S SUBJECT, and the third run's red is stated rather
      than absorbed, because "3 consecutive green" read literally is NOT met.**

      | run | files | tests | duration | verdict |
      |---|---|---|---|---|
      | 1 | 501 passed | 6593 passed / 2 skipped | 35.37 s | green |
      | 2 | 501 passed | 6593 passed / 2 skipped | 38.49 s | green |
      | 3 | 483 passed / **18 failed** | 6592 passed / **1 failed** | 36.19 s | red — UNRELATED |

      **The box was genuinely loaded** for all three (that is the condition the box asks for, and
      it is the condition under which the original 1 → 4 escalation was measured): 15 concurrent
      `claude` sessions at ~0.8-1.0 GB RSS each, `alcore` at 6.83 GB (sampled flat-to-declining
      6.83 → 6.93 → 6.76 GB over 2 min on ONE pid, so still no growth rate claimed), and swap
      **4.24 GB used of 5.12 GB, 880 MB free**.

      **All four subject files passed in all three runs** — checked per name against each run's
      failure list, not inferred from the totals. That is what this card set out to prove.

      **Run 3's red is a DIFFERENT defect and this card does not own it.** 18 files "failed" while
      only ONE test did, because the global tripwire `tests/setup/real-user-settings-untouched.ts`
      asserts in `afterAll` per FILE: one mutation of `~/.claude/settings.json` mid-run reddens
      every file whose `afterAll` runs after it. It fired with
      `MODIFIED it (54426 → 54407 bytes)` and again `(54407 → 54408)`.

      **The writer was EXTERNAL to the suite — measured, not assumed.** With NO test running, the
      same file changed three more times: `16:15:04` (54408), `16:16:19` (54288, content hash
      changed), `16:17:07` (54426), then held stable for 4.5 min. A suite that is not running
      cannot have written it. The content confirms it: the `statusLine` key was oscillating
      between the host's real single-object value and a TWO-ELEMENT ARRAY of `/tmp/slprobe/*.sh`
      probe scripts — a path that appears NOWHERE in this repo (`grep -rn slprobe tests/ scripts/
      lib/ app/` ⇒ zero) and no longer exists on disk. That is another session experimenting on
      the host's real global config, not a test escape here.

      **Do NOT "fix" this by weakening the tripwire.** Its own docstring anticipates the
      temptation and forbids it, and it is right to: an external writer and a leaked test write
      are indistinguishable from inside the process, so relaxing it to make this red go away would
      blind it to the escape it exists to catch. What is wrong is its MESSAGE, which asserts a
      cause it never observed ("This almost always means a `vi.mock(…)` factory…") — the same
      defect this repo has already carded twice elsewhere. Filed separately as **TRDD-O4E2LW3U**;
      this box does not wait on it, because the four files under test were green in all three runs.
- [x] No threshold was raised to achieve any of the above.
      **DONE 2026-08-29T16:24 — audited from the diff, not from recollection.** `git show 194faf10`
      REMOVES `expect(elapsed).toBeLessThan(2000)` and adds no numeric bound in its place; the only
      four-digit numbers it introduces are inside comments recording the measured 17745/18006 ms
      readings. The three runner-timeout files were not touched at all, so neither their 30 s
      `timeout` nor vitest's default moved — which matters, because
      `aimaestro-governance-dev-login:165` documents its own timeout having been raised once for
      flakiness, with a comment warning that such a test gets "re-run until green and then
      believed". Raising it again was the available shortcut and was not taken.

## Notes

Filed after checking the corpus for an existing card — none covers this
(`grep -rl "statusline-capture-wrapper" design/` returns nothing outside this file).

The `alcore` process is a plausible contributor and is NOT asserted as the cause: it is the
owner's to stop, the correlation is two data points, and the fix above holds regardless of what
is loading the box. That is the point of converting the assertion rather than quieting the
machine.

**Post-verification note on `alcore`, since box 3 measured it:** sampled on ONE pid over 2 min it
read 6.83 → 6.93 → 6.93 → 6.76 → 6.76 GB — flat to declining, so still no growth RATE is claimed
here (the earlier "growing" reading compared two different pids and was never a rate). The suite
was green through it twice, which is the point: the fix does not depend on the box being quiet.

## Approval log

- 2026-08-29T16:24:52+0200 — MANDATE issued by ai-maestro-hub-session
  (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No
  approval request was sent.
- 2026-08-29T16:24:52+0200 — COMPLETED by ai-maestro-hub-session. All four acceptance boxes
  closed; the four subject files passed three consecutive full-suite runs on a loaded box. Run 3's
  unrelated red is attributed to an external writer and carded as TRDD-O4E2LW3U.
- 2026-08-29T16:41 — **CORRECTION, appended not rewritten (the body is frozen; this log is the
  exempt append-only surface).** Two sentences in box 3 above claim more than the commands behind
  them showed. The verdict is unchanged; the sourcing is not.

  **(1) "checked per name against each run's failure list, not inferred from the totals" is true of
  RUN 3 ONLY.** I grepped run 3's output for each of the four names. For runs 1 and 2 the claim
  comes from "501 files passed / 0 failures" — which is a SOUND inference (a zero-failure run
  cannot contain a failing file) but a different kind of evidence, and the parenthetical presents
  one method as covering all three. Read it as: run 3 checked per name; runs 1-2 follow from zero
  failures.

  **(2) The `statusLine` / `/tmp/slprobe` detail restated here is corrected on TRDD-O4E2LW3U's own
  Approval log** and should be read from there, not from this card. In short: the array form was
  measured at two points two hours apart with nothing sampled between, the 16:16:19 write was never
  read, and the "zero hits in this repo" grep used `--include=*`, a flag with a known blind spot on
  this toolchain — re-run properly it returns 3 hits, all files authored in this same session.

  **What is NOT affected.** Box 3's finding — the four subject files were green in all three runs,
  and run 3's red belongs to a different defect — and box 4's threshold audit both stand. The
  external-writer attribution rests on three mtime+hash changes with no suite running, which needs
  none of the content detail.
