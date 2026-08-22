---
trdd-id: MVZTEKX4
title: Flip the statusLine command so the built ingest pipeline actually receives data
column: todo
created: 2026-08-22T18:22:45+0200
updated: 2026-08-22T18:22:45+0200
current-owner: user
created-by: user
task-type: infra
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T18:22:45+0200
---

# Flip the statusLine command so the built ingest pipeline actually receives data

## Problem

`TRDD-D8OYFG35` built the statusline ingest pipeline end to end — wrapper, routes, store, types,
tests — and left ONE step: the USER pastes one line into `~/.claude/settings.json`. Until then
**nothing calls the pipeline**, so the feature is built and dark.

That step is carved out here because it is not the parent card's to take. `~/.claude/` is the
USER's own directory, and D8OYFG35 states that boundary itself as a deliberate design choice:

> *"`~/.claude/` is the USER's directory, which this work was not to write into."*

The standing owner grant moves review verdicts; it does not move the owner's personal Claude Code
configuration, which changes what they see in their own terminal on every prompt.

## The line

Replace the `statusLine.command` value. The wrapper takes the entire existing command as its
arguments, so **nothing about the bar changes** — it only tees the payload to ai-maestro:

```json
"statusLine": {
  "type": "command",
  "command": "~/.local/bin/aimaestro-statusline-capture.sh agentlenspro statusline --inner '<the existing inner command, unchanged>'",
  "refreshInterval": 3
}
```

Read live 2026-08-22, the current value is still the un-wrapped original:

```
agentlenspro statusline --inner '…/.venv/bin/python3 …/.claude/statusline.py'
```

## Every precondition is ALREADY satisfied — measured 2026-08-22, so nothing else gates this

The parent card listed two preconditions that were open when it was written. Both are now met, and
they were checked rather than assumed:

| precondition | state |
|---|---|
| `~/.local/bin/aimaestro-statusline-capture.sh` installed | **present**, and `cmp`-IDENTICAL to `scripts/aimaestro-statusline-capture.sh` (12086 B) — not merely present-and-stale |
| routes rebuilt (`app/` is bundled, so a restart alone is not enough) | **live** — `POST /api/statusline/ingest` answers `400 invalid_payload`, not `404` |

And the pipeline itself was exercised end to end against the running server:

```
POST /api/statusline/ingest   {"session_id":"…","rate_limits":{"five_hour":{"used_percentage":23,
                               "resets_at":"2026-08-22T20:00:00Z"},
                               "seven_day":{"used_percentage":99,"resets_at":1787500000000}}}
→ 200 {"ok":true,"capturedAt":1787415698674,"pruned":0}

GET  /api/statusline/<id>
→ 200 rateLimits.fiveHour  {usedPercentage: 23, resetsAtMs: 1787428800000, source:"statusline"}
      rateLimits.sevenDay  {usedPercentage: 99, resetsAtMs: 1787500000000, source:"statusline"}
      fresh: true, ageMs: 23
```

Both `resets_at` wire formats — ISO string and epoch ms — normalised to epoch ms at the boundary,
live, as `lib/statusline-normalize.ts::toEpochMs` promises. The two probe records were removed from
`~/.aimaestro/statusline-state/` afterwards.

**So the flip is the only remaining step, and it is safe:** the wrapper is fail-soft with the server
down (a parent-card box, tested), it passes stdout/exit code through byte-identically, and the
capture is detached. If it misbehaves, reverting is the same one-line edit backwards.

## Acceptance

- [ ] the USER (or someone with their authority) edits `~/.claude/settings.json` as above
- [ ] a real session's record appears in `~/.aimaestro/statusline-state/` — today that store holds
      only `abc123.json`, an old test session, which is the proof nothing real has ever flowed
- [ ] `GET /api/statusline/<real session id>` returns non-null `rateLimits`

## Verification

`ls ~/.aimaestro/statusline-state/` shows a real session id, and its `rateLimits` are non-null.
Nothing else needs building — this card is one edit and its confirmation.

## Approval log

- 2026-08-22T18:22:45+0200 — MANDATE issued by user (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.
