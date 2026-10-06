---
trdd-id: SZZTVPJF
title: trddgrep set title keeps the old slug in the card file name
column: backburner
status: tasked
created: 2026-10-06T17:01:45+0200
updated: 2026-10-06T17:01:45+0200
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
approval-datetime: 2026-10-06T17:01:45+0200
---

# trddgrep set title keeps the old slug in the card file name

Source: Emasoft/ai-maestro issue #171.

Symptom: `trddgrep set <id> title <new title>` rewrites the title field but leaves the old slug in the card file name, so file name and card disagree after a retitle. Lookup by id still works.

Reproducer: on a scratch corpus, 2026-10-06 (full repro in the issue body).

Expected: rename the file to the new slug (git mv when tracked, sharing the path the `move` verb already uses), or state plainly that the slug is kept and offer a flag.

Suggested location: the `set` verb handler for the title field.

Filed by the ai-maestro-janitor project Claude; one real-use record in janitor (local id NDV15X5G, 2026-10-05). Nothing blocked.

external-refs: Emasoft/ai-maestro issue #171 (https://github.com/Emasoft/ai-maestro/issues/171)

## Approval log

- 2026-10-06T17:01:45+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
