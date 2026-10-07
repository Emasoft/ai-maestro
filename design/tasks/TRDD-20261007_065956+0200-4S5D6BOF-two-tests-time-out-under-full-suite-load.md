---
trdd-id: 4S5D6BOF
title: Two tests time out under full-suite load
column: backburner
status: tasked
created: 2026-10-07T06:59:56+0200
updated: 2026-10-07T07:01:18+0200
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
approval-datetime: 2026-10-07T06:59:56+0200
---

# Two tests time out under full-suite load

Under full-suite load (load average up to about 83 on 14 cores) the suite goes red on timeouts and timing assertions that pass alone. Named here: tests/unit/teams-stats-verb.test.ts (red in at least 2 full runs on 2026-10-07; passes alone; per its own failure text its request to /api/teams/stats timed out at 30 s, which suggests it reaches the real running server through the real CLI — not traced) and tests/unit/statusline-cli.test.ts (red in 1 run: the no-hosts.json base-resolution case exceeded the 30 s test timeout; alone: 12/12 in 1.32 s). Also seen red under load the same day and NOT yet explained: tests/unit/server-liveness (a timing assertion) and a 60-second ratchet case (about 6 s of CPU in a Python script). assistant-fs-containment's slow case was fixed by 7a15273d8 (it ran a real claude plugin install). Each needs its own cause found and fixed; raising timeouts alone is not a fix.

## Approval log

- 2026-10-07T06:59:56+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Acceptance

- [ ] Each named test's slow step is identified, with its timing measured alone and under load.
- [ ] Each fix removes the slow or load-dependent step; a larger timeout alone does not count.
- [ ] server-liveness and the ratchet case are either fixed here or split into their own cards with a cause stated.
- [ ] A full run at load average above 40 has no timeout failures, or every remaining one is named on a card.
