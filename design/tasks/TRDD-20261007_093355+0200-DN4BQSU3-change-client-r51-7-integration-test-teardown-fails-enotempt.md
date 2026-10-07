---
trdd-id: DN4BQSU3
title: change-client R51.7 integration test teardown fails ENOTEMPTY under full-suite load
column: backburner
status: tasked
created: 2026-10-07T09:33:55+0200
updated: 2026-10-07T09:35:52+0200
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
approval-datetime: 2026-10-07T09:33:55+0200
---

# change-client R51.7 integration test teardown fails ENOTEMPTY under full-suite load

Seen once, 2026-10-07 09:33, full suite on 97833b3b8: tests/integration/change-client-r51-7-invariant.test.ts, case 'CONTRADICTION: registry still names the old program after G09', failed with 'ENOTEMPTY: directory not empty, rmdir <tmp>/r51-7-changeclient-*/.claude'. The assertion did not fail; the temp-dir removal did. The file passed 3 of 3 runs alone right after. Cause not traced: something is still writing under the fixture's .claude directory when teardown removes it (a write that outlives the awaited pipeline, or a rollback step not awaited). Unrelated to the commit under test (lib/sudo-guard.ts). Task: find the late writer; do not paper over it with rm retries until the writer is named.

## Approval log

- 2026-10-07T09:33:55+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Notes

- 2026-10-07T09:35:52+0200 — correction to the body: 'Unrelated to the commit under test' was not traced. What was measured: the test file does not import lib/sudo-guard.ts; the guard change is a synchronous file read; the new guard test writes only under its own tmp dir; the teardown is rm(dir, {recursive, force}) with no retries. 'The assertion did not fail' is read from the one error line vitest printed. A second full suite on d781147e0 passed (616 files, 8161 passed, 2 skipped). The late writer is still unnamed; if it is a rollback step that is not awaited, that is a product bug, not a test bug.
