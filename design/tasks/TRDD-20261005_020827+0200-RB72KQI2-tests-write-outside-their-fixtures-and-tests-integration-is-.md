---
trdd-id: RB72KQI2
title: Tests write outside their fixtures and tests integration is red at baseline
column: todo
status: tasked
created: 2026-10-05T02:08:27+0200
updated: 2026-10-05T04:38:55+0200
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
- [ ] REGRESSION FOUND 2026-10-05 by running tests/integration at 1878fd0b6 (10 failed in 4 files) and at 05f2d4bf0 (12 failed in 5 files): two tests in tests/integration/createagent-g06-g07-ordering.test.ts pass before this session and fail after it ('no title + no team → G06 defaults to AUTONOMOUS', 'G07 undo: a gate that aborts AFTER a successful team join'). One of the session's commits between those shas caused it; a bisect worker is finding which and whether the test's mock or production is wrong. The other reds (createagent-g05c, -g08, -g11, pillar-cli-e2e) pre-date the session. package.json and the lockfile did not change in that range

## Approval log
- 2026-10-05 — FOURTH INSTANCE: the suite-wide leak guard (tests/helpers/real-state-roots.ts) made a fully green run exit 1 (503 files / 6413 tests passed) over one new entry, statusline-state/<session id>.json, written by a live Claude Code session during the run. Same defect as item 2: the guard cannot tell a live process from a test.

## Approval log

- 2026-10-05T02:08:27+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
