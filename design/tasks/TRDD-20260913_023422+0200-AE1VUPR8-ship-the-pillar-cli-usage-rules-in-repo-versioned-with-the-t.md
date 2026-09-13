---
trdd-id: AE1VUPR8
title: Ship the pillar-CLI usage rules in-repo versioned with the tools
column: backburner
created: 2026-09-13T02:34:22+0200
updated: 2026-09-13T02:34:22+0200
current-owner: ai-maestro-0a
created-by: ai-maestro-0a
task-type: docs
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: ai-maestro-0a
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-0a
approval-datetime: 2026-09-13T02:34:22+0200
---

# Ship the pillar-CLI usage rules in-repo versioned with the tools

GitHub issue 162. The conditional harness-only framing it asked for exists in the rule text; the location does not. Those rules live under the user home Claude rules directory, which is the arrangement the issue was explicitly corrected to argue against - a directory owned by Claude Code and shared across every project, not reversed on uninstall. Move them into this repo, versioned with the CLIs, and have the installer print the copy command rather than writing there itself.

## Approval log

- 2026-09-13T02:34:22+0200 — MANDATE issued by ai-maestro-0a (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
