---
trdd-id: CJSNJJP1
title: Evaluate claude --restricted for agent launch against the R17.24 whitelist
column: complete
created: 2026-08-28T02:21:59+0200
updated: 2026-08-28T22:57:26+0200
current-owner: hub-claude
created-by: hub-claude
task-type: spike
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-28T02:21:59+0200
---

# Evaluate claude --restricted for agent launch against the R17.24 whitelist

## Problem
Claude Code 2.1.248 added `--restricted` (`CLAUDE_CODE_RESTRICTED=1`): it removes the built-in tools that run commands or code plus `WebFetch` unless named in `--tools`, keeps file tools inside the working directory, REFUSES `bypassPermissions`, and IGNORES user, project and local settings files.

That last clause is the interesting one and the dangerous one. R17.24 enforces the agent plugin whitelist by writing `"<plugin>@<marketplace>": false` into each AGENT's own `.claude/settings.local.json` at wake — a mechanism that depends entirely on settings files being READ. Under `--restricted` they are ignored, so the whitelist would be neither enforced nor needed by that route: the restriction would come from the flag instead.

## Questions this spike must answer
1. Does `--restricted` ignoring local settings mean the R17.24 whitelist becomes redundant for restricted agents, or does it mean plugins load UNFILTERED because the disable list is ignored too? These have opposite implications and only measurement settles it.
2. `--restricted` refuses `bypassPermissions`. Which of this repo's launch paths pass `--dangerously-skip-permissions` — those two are mutually exclusive, so adoption is gated on each one.
3. Which built-in tools do our agents actually need? `--tools` is an allowlist, so the answer has to be enumerated per governance title, not guessed.

## Scope
A SPIKE — measure and write down the answer. No production launch path changes without a follow-up card, because getting this wrong either brick every agent or silently removes a guardrail.

## Acceptance
- [x] measured 2026-08-28 (Claude Code 2.1.251, haiku, `-p` in a scratch workdir whose `settings.local.json` disabled 2 plugins, `--debug-file` per run): **`--restricted` loads ZERO plugins.** Normal: `Found 77 plugins (38 enabled, 39 disabled)`, `Registered 20 hooks from 38 plugins`, 214 plugin skills, the 2 locally-disabled plugins logged `enabled=false; will NOT register`. Restricted: `Found 0 plugins (0 enabled, 0 disabled)`, `Registered 0 hooks from 0 plugins`, `0 plugin skills, 42 bundled skills`, `0 skill dir commands`. Q1's dichotomy was false: neither redundant nor unfiltered — `enabledPlugins` lives in the IGNORED user settings, so the whole plugin layer vanishes, INCLUDING the R17 core plugin and the role plugin (AMP messaging, governance skills, every hook). See `## Findings`
- [x] launch paths that pass `--dangerously-skip-permissions` (grep, non-test): `lib/agent-registry.ts:591` (default programArgs for claude), `services/element-management-service.ts:10287` and `:10679` (same default on create/import), `services/agents-docker-service.ts:132` (docker launch), `lib/client-capabilities.ts:141` (the flag's SSOT). And one CONSUMER that REQUIRES it: `server.mjs:453` AutoContinue skips any agent whose args lack it — so dropping the flag also disables auto-continue, not just permission prompts
- [x] recommendation: **DECLINE**, for every title. See `## Findings`

## Findings (2026-08-28)

**Q1.** `--restricted` ignores user/project/local settings, and `enabledPlugins` IS user settings —
so no plugin is enabled at all. Measured: 77 → 0 plugins, 20 → 0 hooks, 214 → 0 plugin skills,
493 → 0 user skill-dir commands. The R17.24 whitelist is not made redundant; the thing it
whitelists ceases to exist. A restricted agent has no `ai-maestro-plugin` (R17 core invariant
violated at launch), no role plugin (R11/R19 title binding void), no AMP hooks, no janitor.

**Q2.** Five emitting sites plus one hard consumer (`server.mjs:453`); `--restricted` refuses
`bypassPermissions`, so adoption means dropping the flag everywhere AND losing AutoContinue.

**Q3.** Every governance title runs the script layer (`amp-*.sh`, `aimaestro-agent.sh`) through
**Bash** — the first tool `--restricted` removes. Re-adding it via `--tools Bash` re-opens the
command surface the flag exists to close, leaving only the settings-ignore and workdir-confine
behaviours — the first of which is precisely the one that deletes our governance layer.

**Recommendation: DECLINE.** `--restricted` is built for a host that supplies tools and policy
via `--tools`/`--settings`/managed settings; ai-maestro supplies them via plugins in settings
files. Revisit only if a per-title agent can be defined with ZERO plugins and ZERO Bash — no
current title qualifies. Workdir confinement, the one attractive property, is already the
server's job (TRDD-9SEQ4QI9 ruling: containment is server-provisioned).

## Approval log

- 2026-08-28T02:21:59+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-28T22:57:26+0200 — COMPLETED by hub-claude. Spike measured; recommendation DECLINE; 3/3 boxes.
- 2026-08-28T22:57:26+0200 — COMPLETE by emanuelesabetta. archived → complete.
- 2026-08-28T22:59:48+0200 — review-fork settle: the "0 plugins" debug counter was corroborated BEHAVIOURALLY. Rollout line `tengu_plugin_hooks_modules` present in BOTH logs (hook axis not confounded). Probe: "is `git:commit` in your skills list?" — normal → HAS-SKILL, `--restricted` → NO-SKILL (positive control passes; a first probe using the janitor skill returned NO-SKILL in both runs because the scratch settings.local.json disabled it — instrument error, replaced).
