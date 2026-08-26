---
trdd-id: 7EOEIA4M
title: An agent-declared MCP server is a process whose sandbox and identity are unspecified
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-08-26T18:18:32+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, sandbox, mcp]
external-refs: [TRDD-EVO7T245, TRDD-O0RHX7K6]
---

## Problem

An agent can declare MCP servers. An MCP server is a PROCESS. Three questions decide whether
that is an impersonation vector, and none of them is currently answered in writing.

- Whose uid and whose sandbox profile does it run under?
- Whose identity does it present when it calls back into ai-maestro?
- Can agent A declare a server whose command reaches agent B's tree?

If an agent-declared process runs OUTSIDE the per-agent profile, it is a general-purpose
escape from the confinement layer — the agent writes its own escape hatch legitimately,
through a supported feature.

## Task

1. INVESTIGATE — where MCP server configs live, who may write them, and how the process is
   spawned.
2. ASSESS — measure whether a spawned MCP process inherits the agent's sandbox (seatbelt is
   inherited across fork/exec, so the answer depends entirely on WHO spawns it — the
   confined agent, or the unconfined server).
3. SAFEGUARD — spawn agent-declared processes from the agent's own confined context, never
   from the server, and give them the declaring agent's identity, never the server's.

## Acceptance

- [ ] MCP config location, writer and spawn path recorded.
- [ ] A measured answer to whether the spawned process is inside the agent's sandbox.
- [ ] A measured answer to what identity it presents on a callback.
- [ ] Safeguard applied, with a probe proving an MCP process cannot reach another agent.
