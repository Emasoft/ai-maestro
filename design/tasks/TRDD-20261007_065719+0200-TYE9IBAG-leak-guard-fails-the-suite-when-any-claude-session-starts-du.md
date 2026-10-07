---
trdd-id: TYE9IBAG
title: Leak guard fails the suite when any Claude session starts during a test run
column: backburner
status: tasked
created: 2026-10-07T06:57:19+0200
updated: 2026-10-07T08:53:51+0200
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
approval-datetime: 2026-10-07T06:57:19+0200
---

# Leak guard fails the suite when any Claude session starts during a test run

tests/helpers/real-state-roots.ts flags every NEW entry in the real ~/.aimaestro after the suite. Its exemption (line 61, `rel.startsWith('statusline-state/') && !e.name.endsWith('.json')`) covers only non-.json names under statusline-state/, so a Claude session that starts anywhere on the machine during a run can get a statusline-state/<session-id>.json (once its status line has reported, by a writer not measured; see below), and the suite fails with exit 1 although every test passed. Which process wrote that file (the server's lib/statusline-store.ts or a writer inside the other session) is NOT measured. Observed 2026-10-07: a session in an unrelated project started 38 s into a full run and its file was flagged; a re-run on a tree differing only by comments exited 0 (that shows the entry did not recur; it does not by itself prove the attribution, which rests on the session starting 38 s into the run and the file name being its real session id). Fix must keep the guard able to catch a real test leak into statusline-state/ — never delete the guard.

## Approval log

- 2026-10-07T06:57:19+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Acceptance

- [ ] The guard ignores a statusline-state/*.json created by a Claude session that started during the run (seeded: a real-looking transcript created after suite start) — and that seeded transcript lives under a HOME jail with injectable roots, never in the real ~/.claude/projects, or the guard's own test is a leak.
- [ ] The guard still FAILS on a seeded test-written statusline-state/*.json whose name is not a live session (positive control).
- [ ] The ordering race is handled: the session's transcript may appear after its statusline file, or in a project dir created after teardown's scan.
- [ ] A test that names a fixture after a REAL session id is not silently exempted (e.g. exempt only transcripts created after suite start, and only when the suite itself wrote none).
- [ ] Neuter run recorded: removing the new exemption reddens the mid-run-session case, and loosening it reddens the positive control.

## Notes

- 2026-10-07T08:53:45+0200 — OWNER RULING (verbatim) on the project name and session id left in 21ab73ea9's history: "fork history : no need for me. but if github makes trouble, you have to do it." No history rewrite unless GitHub raises it.
