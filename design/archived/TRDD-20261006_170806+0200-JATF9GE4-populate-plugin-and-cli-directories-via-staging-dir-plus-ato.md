---
trdd-id: JATF9GE4
title: populate plugin and CLI directories via staging dir plus atomic rename
column: superseded
status: archived
created: 2026-10-06T17:08:06+0200
updated: 2026-10-06T21:07:13+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: manager
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: false
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-06T17:08:06+0200
superseded-by: [TRDD-NPAEP3QJ]
---

# populate plugin and CLI directories via staging dir plus atomic rename

Source: Emasoft/ai-maestro issue #150.

When the server populates or replaces a plugin/CLI directory it must write into a temporary staging dir then rename() into place — never populate the destination in-place.

Measured 2026-08-19 (TRDD-4OFMHOZ7 post-mortem): a partially-populated plugin-cache version directory (120 of 1758 files) was loaded by the harness WITHOUT COMPLAINT and bricked every session's tools for ~20 minutes (every PreToolUse hook failed Errno 2 while the directory looked installed). A directory filled in-place is indistinguishable from a complete one; rename() on the same filesystem is atomic, converting an unbounded window into no window. Detection (deferred reload, self-integrity check, quarantine) is after-the-fact recovery, not prevention.

Scope: only paths the SERVER owns; the Claude Code harness half is permanently out of reach (owner ruling).

Acceptance: a version directory under the server's control is never observable in a partial state.

external-refs: Emasoft/ai-maestro issue #150 (https://github.com/Emasoft/ai-maestro/issues/150)

## Approval log

- 2026-10-06T17:08:06+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-06 — CORRECTION by main-agent@ai-maestro: the mint wrote a self-issued mandate at min-approval-requirement none; the objective floor for this card is manager (adversarial review of c7555c0bb). Mandate withdrawn; the card is a proposal awaiting the owner's approval. The USER directive was to open a TRDD per issue, which authorizes filing, not execution.
- 2026-10-06T21:07:13+0200 — SUPERSEDED by main-agent@ai-maestro. minted with a self-issued mandate at the wrong approval floor; replaced by a correctly-floored proposal.
