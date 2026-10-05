---
trdd-id: RB72KQI2
title: Tests write outside their fixtures and tests integration is red at baseline
column: todo
status: tasked
created: 2026-10-05T02:08:27+0200
updated: 2026-10-05T05:16:51+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T02:08:27+0200
implementation-commits: [4a65e9a81, 8162ae19e]
---

# Tests write outside their fixtures and tests integration is red at baseline

## Problem

Three places where a test reaches outside its fixture, found while verifying TRDD-L6VV9Q7U /
TRDD-A50RC5G8 on 2026-10-05:

1. `tests/unit/cli-help-exit-contract.test.ts` writes a 3-byte file named `-o` (content `{}`) into
   the REPOSITORY ROOT every run (worker-confirmed by mtime when run alone; the file is present
   and untracked). A CLI is being handed `-o` and treating it as an output path with the repo root
   as cwd. One careless `git add` commits it.
2. `tests/integration/pillar-cli-e2e.test.ts` — "writes NOTHING anywhere under the developer real
   ~/.aimaestro" fails when the ai-maestro server is live on the machine (8930 entries vs 8928):
   the guard reads real state that a live process is writing, so it cannot tell a test leak from
   the server.
3. Seven tests in three CreateAgent integration files fail alone, at HEAD and at b9d97a308 alike:
   createagent-g05c-gitignore (1), createagent-g08-cross-client (4), createagent-g11-r17-core (2).
   Cause NOT established. They are pre-existing, not from the 2026-10-05 commits.

`tests/integration` is therefore red on this machine (4 files, 8 tests) and has been since at
least b9d97a308, which means it gates nothing.
MEASURED 2026-10-05: the one suite run that exited 1 on the real-state leak guard was environmental — the new entry was a status-line state file whose id matches a LIVE Claude session of another project, mtime inside the run window; no test wrote it. The guard cannot tell a concurrent live session from a leaking test: a rerun exited 0 (539 files) — on a tree that also carried one more commit, so it is not a same-tree A/B; and 'no test wrote it' is an inference from the id matching a live session, not an observation of the writer. SEEN AGAIN the same day: a worker run exited 1 on a different external writer (per worker: an observability daemon writing under the state dir) while my rerun minutes later exited 0.

## Proposed fix

(1) give that test a temp cwd and assert the repo root is untouched; remove the stray file.
(2) make the leak guard compare a fixture-scoped view, or skip with a loud reason when a live
server is detected — a guard that fails for an unrelated cause trains people to ignore it.
(3) diagnose the seven CreateAgent failures from their first real assertion, alone.

## Acceptance

- [ ] `-o` no longer appears in the repo root after the unit suite; the stray file is removed
- [ ] The pillar leak guard gives the same verdict with the server up and down
- [ ] Each of the 7 CreateAgent failures has a named cause and is fixed or filed
- [ ] `tests/integration` is green on a machine with a live server
- [x] 2026-10-05 box 1: the stray file named -o came from a fake curl in tests/unit/cli-help-exit-contract.test.ts writing to its second positional argument; fixed in 4a65e9a81 (writes to the argument after -o, spawn in a temp dir, one assertion). The old stray file was moved to reports_dev/stray/. Integration reds measured today at HEAD: 12 tests in 5 files, list in the BZW1QAZ5 card
- [x] REGRESSION FOUND 2026-10-05 by running tests/integration at 1878fd0b6 (10 failed in 4 files) and at 05f2d4bf0 (12 failed in 5 files): two tests in tests/integration/createagent-g06-g07-ordering.test.ts pass before this session and fail after it ('no title + no team → G06 defaults to AUTONOMOUS', 'G07 undo: a gate that aborts AFTER a successful team join'). One of the session's commits between those shas caused it; a bisect worker is finding which and whether the test's mock or production is wrong. The other reds (createagent-g05c, -g08, -g11, pillar-cli-e2e) pre-date the session. package.json and the lockfile did not change in that range
- [x] 2026-10-05 the regression box is closed by 8162ae19e: bisected to 49f411162 (0f0e49400 = 10/10, 49f411162 = 2 failed); cause is this file's fs mock lacking a default export, which the real lib/aid-token import needs and which the old catch swallowed. Verdict: test mock gap, production right to fail closed. File is 10/10 at ccd8c10d1. Remaining known integration reds, all present at 1878fd0b6: createagent-g05c x1, -g08 x4, -g11 x2, pillar-cli-e2e x3.
- [ ] 2026-10-05 found while wiring the team-slot detector (worker finding, confirmed by symptom only): tests of the fleet liveness tick reached this machine's LIVE teams file through a default dependency. That one default is now injected (b86907f93). Audit the tick's other default dependencies for the same reach into live state.
- [x] 2026-10-05 the aid-token mock added by 8162ae19e is removed by 0cea6c6a7; the two createagent-g06-g07 tests pass because creation no longer reaches the token store, not because the store is mocked.
- [x] 2026-10-05 WHOLE SUITE at the tree of 0cea6c6a7 (main tree, clean, no worker writing; a docs-only card commit landed during the run): governance, unit, security, services, api, lib, integration and tests/*.test.ts — 585 files, 581 passed, 4 failed; 7806 tests, 7796 passed, 8 failed, 2 skipped; tsc 0 lines. The 8 reds are all in the four files red before this session: createagent-g05c-gitignore x1, createagent-g08-cross-client x4, createagent-g11-r17-core x2, pillar-cli-e2e x1 (test 29, writes under the real state dir; it was x3 in the earlier baseline, so it varies with the live environment). None re-run alone. The boot test passed here (it needs the production build present). This is one run on a machine with a live server and janitor; it does not show the unpinned sites above work.
- [x] 2026-10-05 CORRECTION: two card commits today state 'Corpus gate: 166 passed' where I had read only the exit code that turn (the count was read on earlier runs). And the whole-suite line above supports only this: at 0cea6c6a7 the red tests sit in four files that were also red at 1878fd0b6 — the failure MESSAGES were not compared with the baseline, so a test failing for a new reason would look the same; pillar-cli-e2e moves with the live environment.
- [ ] SECOND WHOLE-SUITE RUN at 498fd000e (clean tree, no worker writing): 586 files, 573 passed, 13 failed; 7818 tests, 7808 passed, 8 failed, 2 skipped; tsc 0 lines. The 8 failed TESTS are the same eight as the first run (g05c x1, g08 x4, g11-r17-core x2, pillar-cli-e2e test 29). NINE MORE FILES failed at file level with no failed test: createagent-g06-g07-ordering, agents-core-service, assistant-fs-containment, fleet-model-fallback-leg, json-io-prelint-retry, maestro-sudo-gate-pty, pillar-grep-cli, trddgrep-archive-verb, trddgrep-new-and-move — the message I read for the last several is the guard 'The DEVELOPER'S OWN settings file changed while this test file ran' (the real Claude settings file, 83036 to 83010 bytes); I did not read the reason for each of the nine individually. Evidence on who wrote it: a backup of that file named with process id 84452 was created at 05:02 during the run, and a process snapshot shows 84452 is the running ai-maestro server (17 h uptime); current content has the same keys and value lengths as that backup. So a LIVE SERVER write, not shown to be a test escape — but WHY the server rewrote the user's Claude settings file at that moment is not known, and a test reaching the live server is not excluded. The first run (0cea6c6a7) did not hit it. Failure messages of the 8 tests could not be compared with the 1878fd0b6 baseline: that run's output file no longer exists. Also seen once in the output: listen EADDRINUSE on a high port.
- [x] 2026-10-05 the settings-file write in the second whole-suite run is ATTRIBUTED for 05:02: the running server's log has '[fleet-restart] user-scope plugin update (absorbed duty): 9 skipped-unprepared, 1 restarted' at 05:02:52, the minute of the backup carrying its process id. So the server's own periodic duty, not a test. NOT attributed: the file's later modification at 05:06 (no backup); and the nine files were not re-run alone, so their individual reasons are still unread.
- [x] THIRD WHOLE-SUITE RUN at 827b7ec91 (clean tree before and after, no worker writing; includes 5e143620d and 7ea22acca): 588 files, 584 passed, 4 failed; 7836 tests, 7826 passed, 8 failed, 2 skipped; tsc 0 lines. The 8 failed tests are the same eight names as both earlier runs, in the four files red before this session. The real Claude settings file's checksum was identical before and after this run, and no file failed on the settings guard. So across three runs today: the same 8 failed tests each time; the 9 extra file-level failures appeared only in the run during which the server's plugin-update duty wrote the settings file, and all 9 pass alone. What TRIGGERED that duty at 05:02 (and its '1 restarted' — a real agent restarted during a test run) is still not established.

## Approval log
- 2026-10-05 — FOURTH INSTANCE: the suite-wide leak guard (tests/helpers/real-state-roots.ts) made a fully green run exit 1 (503 files / 6413 tests passed) over one new entry, statusline-state/<session id>.json, written by a live Claude Code session during the run. Same defect as item 2: the guard cannot tell a live process from a test.

## Approval log

- 2026-10-05T02:08:27+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
