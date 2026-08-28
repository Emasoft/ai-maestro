---
trdd-id: 6HWKE3FJ
title: Verify the experimental cacheTtl agent-frontmatter shape before adopting a 1h prompt-cache TTL
column: todo
created: 2026-08-28T02:26:57+0200
updated: 2026-08-28T02:26:57+0200
current-owner: hub-claude
created-by: hub-claude
task-type: spike
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-28T02:26:57+0200
---

# Verify the experimental cacheTtl agent-frontmatter shape before adopting a 1h prompt-cache TTL

## Problem
Claude Code 2.1.248 added `experimental.cacheTtl` ("5m" or "1h") to AGENT FRONTMATTER — a per-agent prompt cache TTL used when no subagent TTL setting is configured. This repo has four `opus[1m]` many-turn agents (`scenario-runner`, `scenario-improvement-implementer`, `parallel-worker-agent`, `parallel-tester-agent`) whose whole cost profile is turns x re-read prefix. A 1h TTL is exactly the lever for them, and cache-thrash on spawn batches is a measured problem here, not a hypothetical.

## Why this is a spike and not a one-line edit
**The shape could not be verified on 2026-08-28.** Two attempts:
- The published subagent docs (code.claude.com/docs/en/sub-agents) enumerate the full frontmatter field set and do NOT mention `experimental.cacheTtl` or any `experimental:` block. The page has not caught up with 2.1.248.
- A `claude-code-guide` agent asked the question died on 'Prompt is too long' (it is Haiku-pinned at 200k).

A WRONG shape is SILENTLY IGNORED. Shipping it would read as a token win in the commit log while buying nothing — the exact failure this project's lessons file exists to prevent. So the key is NOT being shipped until the shape is confirmed.

## The open questions
1. Nested map (`experimental:` / `  cacheTtl: "1h"`) or literal dotted key (`experimental.cacheTtl: "1h"`)?
2. Does it apply to a PROJECT-scoped `.claude/agents/*.md`? (Note plugin-shipped agents already ignore `hooks`/`mcpServers`/`permissionMode`, so per-scope differences are real here.)
3. `subagentPromptCacheTtl` vs the per-agent value — which wins when both are set?
4. Is the effect OBSERVABLE at runtime (`/status`, `--debug`, a telemetry field)? Without an observation there is no way to tell adoption from a no-op.

## Related, verified while looking
`maxTurns` IS a documented frontmatter field and `.claude/agents/scenario-runner.md` sets none, so it inherits the default. Not a defect — but it is the cap that makes a truncated PARTIAL return possible, which commit 9400ad02 now teaches the Rule 13 cron to handle.

## Acceptance
- [ ] the correct YAML shape established from a source, not inferred
- [ ] a runtime observation showing the TTL took effect, or an explicit note that none is available
- [ ] the key applied to the four many-turn agents, or a written reason not to

## Approval log

- 2026-08-28T02:26:57+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
