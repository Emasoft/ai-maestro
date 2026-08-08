---
trdd-id: ZUAFN6PB
title: Central fleet re-sweep for postable-body handles with the context-scoped classifier
column: backburner
created: 2026-08-08T16:39:23+0200
updated: 2026-08-08T16:39:23+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
priority: 2
severity: medium
effort: small
release-via: none
scope: project
project-id: ai-maestro
labels: [security, mentions, postable-bodies, fleet]
npt: []
eht: []
blocked-by: []
relevant-rules: []
---

# Central fleet re-sweep for postable-body handles

## Why

The ASSISTANT's 2026-08-08 re-scan found 22 postable-body handle sites in 2 repos — but
AMOA then found **4 more in their own tree** that the ±3-line context window and the
fence-skipping classification missed (including `--add-assignee "@old-agent"`, which
ASSIGNS a stranger rather than merely mentioning one). So the other role-plugin repos
likely hide more, and per the cross-project rule AMOA correctly fixed only its own 7.
AMOA's explicit recommendation: do the sweep centrally, with the context-scoped rule
baked in, because a mechanical sweep WITHOUT it either misses real hits or breaks
correct code (`@me`/`@copilot` are gh's documented assignee literals — allowed by
POSITION as an assignee/reviewer flag value, never by NAME; `me` is a real account).

## What

Work-order the ASSISTANT (holds the raw scan JSON warm) or run centrally: re-classify
every fleet repo's fenced content by "does this string reach a request body or an
assignee flag", ignoring fences entirely (a ```bash fence makes a handle MORE live —
it executes). Verify each hit with `gh api users/<name>`. Relay per-repo findings as
issues/messages — never edit other trees. Reference implementation: the hub's
`tests/governance/no-handles-in-postable-bodies.test.ts` @ 3e5f46ff (context-scoped
literal exemption, both directions pinned); AMOA's Python twin in v1.13.4.

## Acceptance

- [ ] Every fleet role-plugin repo swept with the context-scoped classifier
- [ ] Each finding verified against the GitHub API before relaying
- [ ] Per-repo relays sent (issue or live-session message); zero cross-tree edits
