---
trdd-id: LJL6YUZ4
title: User rulings on deferred Claude Code alignment items from TRDD-2PFVKO7P
column: todo
status: tasked
created: 2026-10-03T01:07:21+0200
updated: 2026-10-03T01:07:56+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: infra
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-03T01:07:21+0200
parent-trdd: 2PFVKO7P
derived: true
derived-kind: eht
npt: []
eht: []
---

# User rulings on deferred Claude Code alignment items from TRDD-2PFVKO7P

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-10-03
NEXT ACTION: the user rules on each item; each adopted item then gets its own card.

## Acceptance
- [ ] A1 file issues on ai-maestro-janitor, ai-maestro-assistant-manager-agent and ai-maestro-integrator-agent for unquoted ${CLAUDE_PLUGIN_ROOT} hook commands (check repo HEAD first)
- [ ] A7 update Claude Code to >=2.1.286 and capture a real Bash permission prompt for services/agents-chat-service.ts detectTuiMenu
- [ ] D3 (v2.1.277-69 TaskOutput removed): repo has no references; the user's global rules turn-protocol-and-review.md and delegation-and-orchestration.md mention TaskOutput, outside this repo
- [ ] D4 (v2.1.285-3 plugin configure, with 285-51 and mcp 285-4 --config for .mcpb): needs a plugin-options UI/API and a secret-handling choice (values via stdin, never argv); no known role-plugin ships a .mcpb
- [ ] D5 (v2.1.287-1, 287-2 Claude Mods): a mod could change REPL frame text and confuse idle detection and /reload-plugins injection (agent-commands.ts:51); opt-in so inert by default; needs one live run with a mod enabled
- [ ] D6 (v2.1.287-79 1M by default on Bedrock/Vertex/Foundry/gateway): the model id cannot tell the provider; threading the agent provider env through is a design change
- [ ] D7 (v2.1.259-2 --permission-prompts none): agents launch with --dangerously-skip-permissions (lib/agent-registry.ts:622-623) and the creation helper with acceptEdits; policy choice
- [ ] D8 (v2.1.285-54, 269-40, 274-25 CLAUDE_CODE_RESUME_INTERRUPTED_TURN): recovery relaunches with --continue and nudges (lib/fleet-recovery.ts); adopting the variable is a recovery-design change
- [ ] D9 (v2.1.280-38, 265-6, 281-15 resume behaviour): may change what the fleet-recovery nudge ladder sees after --continue; needs a live resume test, no code edit
- [ ] D10 (v2.1.281-137 dangerous rm 2-minute wait): unattended bypass-mode tmux agents see a prompt that auto-denies after 2 min; CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT is not set in lib/client-capabilities.ts envVars
- [ ] D11 (v2.1.275-4 syncClaudeAiSkills/syncClaudeAiPlugins): agents signed in with the owner account may load account skills and plugins ai-maestro did not install; writing false into agent settings is a policy choice
- [ ] D12 (v2.1.283-22 plus latent defect): scanPluginMcpServers (services/agent-local-config-service.ts:741-760) reads only <plugin>/.mcp.json, never mcpServers in plugin.json; separately app/api/settings/marketplaces/route.ts:369-372 iterates the whole file so a wrapped mcpServers file is checked wrongly (plain bug, can be its own card)
- [ ] D13 (v2.1.275-2, 286-40, 286-56 send-now key): interruptSession (services/sessions-service.ts:1440-1485) could use C-x C-s; Escape semantics are relied on by server.mjs AutoContinue and lib/oauth-rotator/model-fallback-deps.ts:52, so not a drop-in; needs a live test
- [ ] D14 (v2.1.251-1 PreModelSwitch/PostModelSwitch hooks): a possible governance hook to block model switches by title; no code today
- [ ] Confirm or reject widening the scope to 2.1.222-2.1.287 (the user asked for the last 30 days, 2.1.259 onward)

## Approval log

- 2026-10-03T01:07:21+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
