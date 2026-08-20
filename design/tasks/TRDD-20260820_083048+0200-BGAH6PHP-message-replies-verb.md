---
trdd-id: BGAH6PHP
title: aimaestro-message.sh replies — ack-poll on a message-id for the approval timeout loop
column: todo
created: 2026-08-20T08:30:48+0200
updated: 2026-08-20T08:30:48+0200
current-owner: ai-maestro-hub
task-type: feature
scope: project
project-id: ai-maestro
priority: 2
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-20T08:30:48+0200
---

# aimaestro-message.sh replies <message-id>

## Problem

AUTONOMOUS ask (2026-08-20): after `send` returns a message-id for an approval request,
the timeout→escalate loop needs a mechanical "has a reply arrived?" check. Today it drains
amp-inbox each heartbeat and greps the subject — O(inbox) and race-prone on threading.

## Proposed fix (specs-first)

`aimaestro-message.sh replies <message-id>` → TSV rows (sender, message-id, epoch, subject)
for messages whose replyTo == the id; empty stdout + exit 4 = none yet; 3 transport;
7 auth. Read-only over GET /api/messages (caller's own mailbox — R28/R38 scoping applies:
an agent sees only replies addressed to itself, which is exactly the ask). Spec section in
the script header first (gen-specs is header-driven), then the verb.

## Acceptance

- [ ] verify GET /api/messages can filter or return replyTo (measure the route/service first)
- [ ] header spec + verb; specs:check green
- [ ] live-verified: a real reply row, and exit 4 on an id with none
- [ ] AUTONOMOUS notified with the invocation

## Approval log

- 2026-08-20T08:30:48+0200 — MANDATE issued by the hub (min-approval-requirement: none). No request sent.
