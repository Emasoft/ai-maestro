---
trdd-id: VGTXJTZ3
title: Add a --name flag to the amp CLI scripts resolving through the agents index
column: planned
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T15:00:52+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-015, batch-backlog-20260707]
task-type: feature
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_015_2026-06-23T12-19-36Z.md"]
---

# TRDD-VGTXJTZ3 — amp CLI --name flag (UUIDs are non-memorizable)

## Problem

In steady state the AMP CLI requires `--id <UUID>` because per-agent homes are UUID-keyed
(`~/.agent-messaging/agents/<UUID>/`). A human operator or scenario author cannot
reasonably type `--id 2f3637da-bdd8-4288-...` — yet the name→UUID map already exists at
`~/.agent-messaging/agents/.index.json`. Verified 2026-07-07: `scripts/amp-send.sh` has no
`--name` handling (and note the 5KKO25RO fix-1 already added an index-consulting Path 1b to
`resolve_sender_public_key` — the same lookup the CLI flag needs).

## Root cause

`amp-send.sh` (and inbox/read/reply/download) resolve the operating identity from
`--id`/`CLAUDE_AGENT_ID`/`AMP_DIR` only; no name-based resolution was ever exposed.

## Proposed fix

Add `--name <agentName>` to `scripts/amp-send.sh`, `amp-inbox.sh`, `amp-read.sh`,
`amp-reply.sh`, `amp-download.sh` (the `--id` pre-source block): look the name up in
`.index.json`, resolve to the UUID, then proceed exactly as `--id`. Ambiguous/missing name
→ error listing candidates. Reinstall via `install-messaging.sh` updates the
`~/.local/bin/` copies.

## Verification

`amp-send.sh --name alice bob "subject" "body"` delivers identically to the `--id` form;
`amp-inbox.sh --name bob` lists it; a bogus name errors with candidates.

## Estimated risk

LOW — additive flag; resolution data already exists and is already consulted by the
signature-verification path.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Implementer must first verify the gap still exists (recent .index.json resolver work may cover it); downgrade to no-change-needed if moot.
- 2026-07-07T15:00:52+0200 — IMPLEMENTED (wave W6): verified the gap was still real — grepped scripts/amp-send.sh and found no `--name` handling; the only existing `.index.json` name resolution (`_index_lookup` / the TRDD-5KKO25RO `CLAUDE_AGENT_NAME` env-var path) lives inside amp-helper.sh and requires an env var, not a CLI flag, and silently falls back to picking the first case-insensitive match rather than erroring with candidates on ambiguity — not sufficient for the requested `--name` flag semantics. Added `scripts/amp-name-resolve.sh` (new shared resolver, `_amp_resolve_name_to_id`) sourced on-demand from the pre-source phase of `amp-send.sh`, `amp-inbox.sh`, `amp-read.sh`, `amp-reply.sh`, `amp-download.sh`; `--name <agentName>` now resolves via `~/.agent-messaging/agents/.index.json` (exact match, then case-insensitive with explicit ambiguity detection) and sets `CLAUDE_AGENT_ID` before `amp-helper.sh` is sourced, exactly like `--id`. Bogus/ambiguous names exit 1 with a candidates list on stderr. `install-messaging.sh`'s `amp-*.sh` glob (line 567) already picks up the new file for `~/.local/bin/` reinstall — no installer change needed. `bash -n` clean on all 6 files.
