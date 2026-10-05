---
trdd-id: DEL16Q96
title: Session name resolves to the wrong agent when an agent name ends in an index suffix
column: complete
status: archived
created: 2026-10-05T01:57:17+0200
updated: 2026-10-05T04:47:56+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T01:57:17+0200
implementation-commits: [fbfb841df, d24147c8e]
---

# Session name resolves to the wrong agent when an agent name ends in an index suffix

## Problem

`getAgentBySession(sessionName)` (`lib/agent-registry.ts:487-491`, read 2026-10-05) parses the
session name with `parseSessionName`, which strips a trailing index ("website_1" -> "website"),
and returns the agent with that NAME. So if agents named `alpha` and `alpha_1` both exist, the
session `alpha_1` resolves to agent `alpha`.

Every authorization decision keyed on a session name inherits this: the sudo-guard route map
(`rule.session` targets), and `deleteSession` since 6626cbe60. The team and title checks then run
against the WRONG agent — a caller entitled over `alpha` is authorized to act on a session that
belongs to `alpha_1`, and the reverse is refused.

Found by the worker finishing TRDD-TCDIVXPS (report under reports/tcdivxps/, gitignored); the
lookup lines were read first-hand. NOT established: whether an agent name may legally end in
`_<digits>` (if name validation forbids it, the collision is unreachable and this is hardening),
and whether a second session of one agent is ever actually created in this deployment.

## Proposed fix

Establish the two facts above first. Then one of: forbid `_<digits>` suffixes in agent names at
creation and rename (if none exist today), or resolve a session name by exact session ownership
(the agent record's own session list) before falling back to the name parse.

## Acceptance

- [x] READ FIRST: may an agent name end in `_<digits>`? cite the validation (or its absence) and count existing agents that do
- [x] READ FIRST: where are indexed sessions created, and is the index recorded on the agent record
- [x] A session name resolves to the agent that owns that session, tested with `alpha` + `alpha_1` both present
- [x] The TRDD-TCDIVXPS indexed-session box can be ticked against this fix
- [x] LANDED fbfb841df: getAgentBySession looks up the exact session name first. Evidence and neuter in the message. Remaining ambiguity stated there (agent alpha's second session shares its name with an agent named alpha_1); reserving <name>_<digits> at creation would remove it
- [x] 2026-10-05 box 3 evidence: tests/unit/get-agent-by-session-full-name-first.test.ts case 'both exist: alpha_1 -> alpha_1 and alpha -> alpha' (plus the soft-deleted and other-host cases). Box 4 stays open: it needs a test of deleteSession target resolution itself, dispatched to a worker.
- [x] 2026-10-05 CORRECTION to box 3 and evidence for box 4 (d24147c8e): the tests prove EXACT NAME FIRST, which is narrower than the box's words 'the agent that owns that session'. When agent alpha has an indexed second session alpha_1 AND an agent named alpha_1 exists, the two are the same string and the session resolves to agent alpha_1 — not decidable from the name. Closing that needs the session index recorded on the agent record or a ban on names ending in _digits; carried as an open design question, not fixed here. deleteSession's own resolution is tested on local and cloud paths; my neuter reddened 3 of 8.

## Approval log
- 2026-10-05 — READ-FIRST answers (worker report, not re-read by main): `alpha_1` IS a legal agent name and parseSessionName would split it into `alpha` + index 1; the live registry holds 0 names matching _<digits>$; no route or UI path allocates a second session (`addSessionToAgent` has no non-test caller). So the collision is not reachable today — this is HARDENING. Cheapest fix: reject _<digits>$ agent names at creation and rename.
- 2026-10-05 — WORDING CORRECTION: "not reachable today" above overstates. Supported claim: no agent on THIS host has a name ending in _<digits>, and no route allocates a second session; but such a name is legal, so one can be created through the normal wizard tomorrow.
- 2026-10-05T04:47:56+0200 — COMPLETE by main-agent@ai-maestro. Exact-name-first landed (fbfb841df) and tested through deleteSession (d24147c8e), own neuters recorded; the same-string ambiguity is stated on the card as an open design question.

## Approval log

- 2026-10-05T01:57:17+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
