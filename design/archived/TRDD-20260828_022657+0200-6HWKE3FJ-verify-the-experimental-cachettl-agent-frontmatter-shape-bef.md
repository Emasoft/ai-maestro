---
trdd-id: 6HWKE3FJ
title: Verify the experimental cacheTtl agent-frontmatter shape before adopting a 1h prompt-cache TTL
column: complete
created: 2026-08-28T02:26:57+0200
updated: 2026-08-28T23:23:01+0200
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
- [x] shape from the SOURCE — the installed CLI bundle (`~/.local/share/claude/versions/2.1.251`, string-extracted): the agent frontmatter schema declares `experimental: { cacheTtl: <'5m'|'1h'>.optional() }` as a NESTED map with `.loose().nullable().optional()` and the describe text *"Experimental per-agent options; unknown keys are ignored"* — so Q1 = nested map (a dotted `experimental.cacheTtl:` key would be an unknown top-level key, ignored). Q2: it is the shared file-agent schema (the loader spreads `...cacheTtl` for file-loaded agents; a project `.claude/agents/ttlprobe.md` with the key loaded and ran — `[API REQUEST] source=agent:custom:ttlprobe`, no parse warning). Q3 precedence, from the resolver (`aIt`): env `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` → setting `subagentPromptCacheTtl` (`promptCacheTtl` for the main thread) → agent frontmatter (**`"1h"` skipped when `isUsingOverage`**) → `ENABLE_PROMPT_CACHING_1H` env → subscriber allowlist (`tengu_prompt_cache_1h_config`, reason `subscriber`) → `5m` default
- [x] NONE AVAILABLE locally, stated explicitly: probe (agent with `cacheTtl: "1h"`) vs control, both under `--debug-file`, haiku — 0 lines mention a TTL/1h in either log; the chosen TTL surfaces only as the `cache_control.ttl` field of the API request body (not logged) and telemetry. Note also that on this host `subagentPromptCacheTtl` is unset and no cache env var is set, so the frontmatter value IS the effective rung unless the subscriber allowlist already grants 1h
- [x] applied to all four (`scenario-runner`, `scenario-improvement-implementer`, `parallel-worker-agent`, `parallel-tester-agent`) with a 4-line comment carrying the precedence — safe by construction: schema-validated shape, unknown-key-tolerant, overridden by any setting/env, and a no-op in overage

## Approval log

- 2026-08-28T02:26:57+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-28T23:23:01+0200 — COMPLETED by hub-claude. 3/3; shape from the bundle schema, precedence from the resolver, runtime unobservable (stated).
- 2026-08-28T23:23:01+0200 — COMPLETE by emanuelesabetta. archived → complete.
- 2026-08-28T23:25:32+0200 — review-fork settle (PENDING): the discriminating neuter — an out-of-enum `cacheTtl: "2h"` on the probe agent, which a validating schema refuses and a dropping loader accepts — could not be observed: agents parse lazily at Agent-tool time, and the user-scope `agentlenspro gate` burn-gate refused every spawn (`rate-limit stall ended Nmin ago … agent prefix caches past their 5-min TTL`, 3 attempts). Load-only runs (`-p OK`) log nothing about project agents in either shape. Not flipped `agentlenspro disable` for a probe. Consequence, stated: the four edits are proven SAFE (valid YAML, hooks/isolation intact, schema-tolerant) but not yet proven EFFECTIVE; retry the "2h" neuter once the gate clears — refusal ⇒ parsed, silent load ⇒ inert.
- 2026-08-28T23:28:38+0200 — neuter VERDICT (supersedes the "pending" line above): forcing the Agent-tool description build (`-p "list your subagent_type values"`, no tool call, so the burn-gate does not fire) parses project agents without a spawn. Probe offered + 0 parse errors for `cacheTtl: "2h"`, for `cacheTtl: 42`, AND for `experimental: notamap` — the file loader tolerates every shape, so parse-time refusal is NOT a discriminator between "parsed" and "dropped", and my earlier "agents parse lazily" was wrong (they parse at description-build; the loader just logs no success). What remains as evidence that the key is CONSUMED is the bundle code itself: the loader spreads `...Jt!==void 0&&{cacheTtl:Jt}` into the definition and the query path passes `agentCacheTtlOverride:e.cacheTtl` into the TTL resolver, which honours it only when exactly `"1h"`/`"5m"`. Effectiveness is unobservable from outside the API request body; the four edits stand on that code reading, not on a runtime measurement. Owner may drop them if code-level evidence is not enough.
