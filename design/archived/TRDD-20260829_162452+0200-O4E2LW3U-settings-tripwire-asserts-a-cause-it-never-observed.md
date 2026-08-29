---
trdd-id: O4E2LW3U
title: The global settings tripwire names a cause it never observed and cannot distinguish an external writer from a test escape
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-29T16:24:52+0200
updated: 2026-08-29T16:30:49+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-29T16:24:52+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: minor
effort: S
labels: [tests, diagnostics, false-positive]
external-refs: []
implementation-commits: [9c7821a4]
---

# The settings tripwire asserts a cause it never observed

## Problem

`tests/setup/real-user-settings-untouched.ts` runs from `vitest.config`'s `setupFiles`, so
`tests/helpers/real-home-untouched.ts` snapshots `~/.claude/settings.json` in every test file's
`beforeAll` and byte-compares in `afterAll`. On a change it fails with:

> This almost always means a `vi.mock('@/lib/json-io', …)` factory mocks a write verb the code
> under test no longer calls, so the REAL writer ran.

**That sentence states a cause the guard cannot observe.** The guard sees only "the bytes
differ". It has no evidence about WHICH process wrote them, and on a machine running many
Claude Code sessions concurrently, a write by any of them is indistinguishable from a test
escape — from inside the vitest process, by construction.

Measured 2026-08-29 during TRDD-3KN99N6S's box-3 verification runs. Full-suite run 3 reported
**18 files failed / 1 test failed** — the 17 extra are files whose `afterAll` happened to run
after the mutation, since the guard asserts per FILE. It reported
`MODIFIED it (54426 → 54407 bytes)` and `(54407 → 54408)`.

**The writer was external, proven by the suite being idle.** With no test running, the same file
changed three more times: `16:15:04` (54408 bytes), `16:16:19` (54288, content hash changed),
`16:17:07` (54426), then held for 4.5 minutes. The oscillating key was `statusLine`, flipping
between the host's real single-object value and a two-element ARRAY of `/tmp/slprobe/*.sh` probe
scripts — a path that appears **nowhere** in this repo (`grep -rn slprobe tests/ scripts/ lib/
app/` ⇒ zero hits) and did not exist on disk when checked. Another session was experimenting on
the host's global config.

## Root cause

The guard conflates DETECTION with ATTRIBUTION. Detection is sound and must stay; attribution is
asserted from a single observation that cannot support it. This is the same defect the repo has
already corrected twice in other subjects — the keychain banner that printed
"(a keychain unlock/ACL prompt)" for a cause it never saw, and `readTimedOut` renamed to
`readFailed` because its branch fired on every non-ENOENT spawn failure, not only timeouts
(both on TRDD-MFTDMSJY). A detector that names one cause stops the reader looking for the other.

## Proposed fix

**Do NOT weaken the guard, and do NOT exempt any suite.** The helper's own docstring already
forbids that and is right to: relaxing it would blind it to the silent write it exists to catch
(TRDD-RYFP030K's marketplace-route escape, and the 2026-08-06 case that rewrote 257 marketplace
entries and reported 35/35 GREEN). Keep the byte-compare and keep the failure.

Change only the MESSAGE, so it states what was observed and hands the reader the discriminator:

- report the observation (path, direction, byte delta) as now;
- name BOTH hypotheses — a test escape through a write verb no mock covers, **or** another
  process on this machine writing the shared global config while the suite ran;
- give the check that separates them, so the next reader does not have to rediscover it:
  re-sample the file's mtime/size/hash for a few minutes with no suite running — a file that
  keeps changing while nothing is running exonerates the suite;
- keep the `settings.json.aim-bak-*` recovery pointer, and note it is written only by
  `updateJson`, so its ABSENCE is itself evidence the write did not come through that path.

## Verification

- The message contains no "this almost always means" claim about a cause the guard did not
  observe, pinned by an assertion the way MFTDMSJY pinned `did NOT COMPLETE` /
  `not.toContain('TIMED OUT')`.
- `tests/unit/real-home-untouched-guard.test.ts` still reddens on a real modification (the
  guard's detection is unchanged), and its neuter still works.
- No suite gains an exemption, and the setup file is still global.

## Estimated risk

LOW. Message-only; the trigger condition and the global wiring are untouched. No dependency.

## Acceptance

- [x] The failure message states the observation and both hypotheses, and asserts no unobserved
      cause.
      **DONE 2026-08-29T16:29.** It now opens with `WHAT THIS GUARD OBSERVED is exactly that — the
      bytes differ between this file's beforeAll and its afterAll. It has NO evidence about which
      process wrote them`, then labels `(a) A TEST ESCAPE` and `(b) ANOTHER PROCESS on this
      machine`. The `almost always means` claim is gone.
- [x] The message carries the idle-resample discriminator.
      **DONE.** `THE DISCRIMINATOR, so you do not have to rediscover it: re-sample this file's
      mtime, size and content hash … with NO suite running.` It also states that the
      `settings.json.aim-bak-*` backup is written only by `updateJson`, so its ABSENCE is evidence
      the write did not come through that path — which is how the external writer was identified.
- [x] An assertion pins the wording so the unobserved-cause claim cannot drift back in, with a
      recorded neuter run.
      **DONE.** `tests/unit/real-home-untouched-guard.test.ts` gains *"states what it OBSERVED and
      names BOTH causes, asserting neither"*: `not.toContain('almost always means')` plus
      `toContain` for the observation header, both cause labels, and the discriminator. It first
      asserts the captured message is non-empty — without that, a guard that stopped failing would
      leave every `toContain` asserted against `''` and the test would certify nothing.
      **Neuter run:** re-inserted `This almost always means a \`vi.mock\` factory.` into the
      message ⇒ **exactly that one test reddens**, the other 6 stay green. Restored; 7/7 green.
- [x] The guard's detection behaviour is unchanged: it still fails on a real modification, and no
      suite is exempted.
      **DONE.** Only the message string and the docstring changed — the snapshot, the byte-compare
      trigger, the CREATED/DELETED/MODIFIED classification and the global `setupFiles` wiring are
      untouched. The four pre-existing behaviour tests (untouched / absent / CREATED / DELETED /
      MODIFIED-with-byte-counts) pass unchanged, and three other suites that consume the guard
      (`settings-gate`, `marketplaces-route-refuses-to-clobber-settings`, `settings-edit-route`)
      are 43/43 green. `tsc --noEmit` 0.

## Notes

Checked the corpus before filing: `grep -rl "real-home-untouched" design/` returns only
TRDD-RYFP030K (which CREATED the guard) and this card, so nothing already covers the message
defect.

The external write itself is not this card's subject and is not a defect in this repo — it is
another session's ad-hoc probe on the host's global config. It is recorded here only as the
evidence that the guard's asserted cause is not the only reachable one.

**Not carded, and stated so it is not mistaken for an oversight:** the host's global
`statusLine` was left pointing at `/tmp/slprobe/{first,second}.sh` — as a TWO-ELEMENT ARRAY where
the schema takes a single object — from at least 14:12 until 16:16 on 2026-08-29, i.e. the
operator's statusline was broken for roughly two hours. It has since been restored to the real
single-object value, so there is nothing to repair. Whoever ran that probe should not have run it
against the real file, but that is another session's conduct on the owner's machine, not a defect
in this repo, and filing it here would put a finding on the wrong tracker.

## Approval log

- 2026-08-29T16:24:52+0200 — MANDATE issued by ai-maestro-hub-session
  (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No
  approval request was sent.
- 2026-08-29T16:30:49+0200 — COMPLETED by ai-maestro-hub-session. Message-only fix; all four
  acceptance boxes closed with a recorded neuter run. The guard's trigger and global wiring are
  unchanged and no suite was exempted.
