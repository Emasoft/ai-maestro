# AI Maestro — Communication Graph (S->R notation)

> **This file is the user-maintained source of truth for inter-agent communication rules.**
>
> **Purpose:** a persistent bridge between the user (Emanuele) and the assistant (Claude).
> When the user asks "show me the communication rules", the assistant MUST open this file.
> When the user EDITS this file, the assistant MUST propagate the changes to the rest of
> the codebase and docs — every surface listed in [§ Sync targets](#sync-targets) below.
>
> This file is git-tracked so edits survive across sessions and are reviewable as commits.

---

## Notation

- `S -> R` = sender S can send to recipient R.
- `S -x R` = sender S is forbidden from sending to recipient R.
- `S 1> R` = sender S can only send 1 reply to recipient R if S previously received a message from R. Otherwise forbidden.

## Nodes

```
TITLES (titles are bestowed by MANAGER or HUMAN)

# Agent Titles outside of teams:
H : HUMAN (human user)
M : MANAGER
T : MAINTAINER
A : AUTONOMOUS

# Agent Titles inside a team:
C : CHIEF-OF-STAFF (mandatory 1 per team)
O : ORCHESTRATOR
R : ARCHITECT
I : INTEGRATOR
E : MEMBER (default for new agents assigned to a team)
```

## Edges

Grouped by sender. Every sender lists all 9 possible recipients so the graph is complete (no implicit allow/deny — every pair is stated).

### M — MANAGER (full graph access)

```
M -> H
M -> M
M -> C
M -> O
M -> R
M -> I
M -> E
M -> T
M -> A
```

### C — CHIEF-OF-STAFF (team messaging gateway)

```
C 1> H
C -> M
C -> C
C -> O
C -> R
C -> I
C -> E
C -x T
C -x A
```

### O — ORCHESTRATOR (team-internal router)

```
O 1> H
O -x M
O -> C
O -x O
O -> R
O -> I
O -> E
O -x T
O -x A
```

### R — ARCHITECT (team-internal role)

```
R 1> H
R -x M
R -> C
R -> O
R -x R
R -x I
R -x E
R -x T
R -x A
```

### I — INTEGRATOR (team-internal role)

```
I 1> H
I -x M
I -> C
I -> O
I -x R
I -x I
I -x E
I -x T
I -x A
```

### E — MEMBER (team-internal role)

```
E 1> H
E -x M
E -> C
E -> O
E -x R
E -x I
E -x E
E -x T
E -x A
```

### T — MAINTAINER (repo-scope, governance upward only)

```
T -> H
T -> M
T -x C
T -x O
T -x R
T -x I
T -x E
T -x T
T -x A
```

### A — AUTONOMOUS (governance upward + peer AUTONOMOUS)

```
A -> H
A -> M
A -x C
A -x O
A -x R
A -x I
A -x E
A -x T
A -> A
```

### H — HUMAN USER

H has a special privilege: if H sends a message to an agent, even if the agent cannot freely initiate messages to H, the agent is bestowed with the permission to write exactly ONE reply to answer H. The reply must be to the same user that sent the inbound message.

```
H -> H    (user can send/receive messages to any other human user)
H -> *    (user can send to any agent)
* 1> H    (any agent can write 1 reply to a user message, but he can only reply to the same user that wrote to him)
```

Full outbound enumeration:

```
H -> H
H -> M
H -> C
H -> O
H -> R
H -> I
H -> E
H -> T
H -> A
```

Agents should not PROACTIVELY initiate messages to the user — they respond when contacted. This is persona-enforced; the `1>` edge type is the server-enforced floor.

---

## Enforcement

Three layers (R6.8, R6.10):

1. **Server-side** — `lib/communication-graph.ts::validateMessageRoute(senderTitle, recipientTitle, options)` runs in `services/send-message-service.ts` and `services/amp-service.ts` before every delivery. `1>` edges require `options.inReplyToMessageId` referencing an inbound H→agent message; the AMP inbox layer additionally marks that original message `replied=true` on successful delivery, so the second reply to the same id is refused (one-reply-per-inbound invariant).
2. **Agent-side persona** — every role-plugin's main-agent `.md` file lists its allowed recipients. Skills `agent-messaging` and `team-governance` (shipped in `ai-maestro-plugin`) carry the full graph.
3. **Sub-agents** — no AMP identity, cannot authenticate. Any attempt returns 401 (R6.9).

---

## Sync targets

When this file is edited, the following surfaces MUST be updated to match, in order:

1. **`lib/communication-graph.ts`** — the `ALLOW_EDGES` and `REPLY_ONLY_EDGES` tables + routing suggestions.
2. **`docs/GOVERNANCE-RULES.md` §R6** — the adjacency matrix + rule text.
3. **`CLAUDE.md`** — the matrix mirror in the AMP Messaging section.
4. **`services/send-message-service.ts`** + **`services/amp-service.ts`** — validateMessageRoute callers if semantics change.
5. **`reports/governance/20260422_170708+0200-communication-graph.md`** — narrative/mermaid companion.
6. **External plugin repos** (tracked in `design/tasks/TRDD-80557822-comm-graph-downstream-sync.md`):
   - `Emasoft/ai-maestro-plugin` → `skills/agent-messaging/SKILL.md` + `skills/team-governance/SKILL.md`.
   - 8 role-plugin repos → each one's `agents/<name>-main-agent.md` "Communication Permissions" section.
7. **Type declarations** — `types/agent.ts::AgentRole` if a new title is added. `lib/communication-graph.ts::GraphNode` if a new non-title node is added (H is already there).

For each sync pass the assistant MUST:

- Run `npx tsc --noEmit` to confirm the type-check stays green.
- Commit the sync in a single commit referencing this file's path.

---

## Source-of-truth hierarchy

```
docs/COMMUNICATION-GRAPH.md     ← THIS FILE: user-maintained bridge (authoritative for the GRAPH SHAPE)
    |
    ▼
lib/communication-graph.ts      ← server enforcement (authoritative for RUNTIME BEHAVIOR)
    |
    ▼
docs/GOVERNANCE-RULES.md §R6    ← canonical rule text (matrix + R6.1–R6.10 prose)
    |
    ▼
CLAUDE.md                       ← project-instructions mirror
    |
    ▼
(external) ai-maestro-plugin    ← skill files the agents load at runtime
    |
    ▼
(external) 8 role-plugin repos  ← main-agent persona files
```

If the graph SHAPE disagrees between this file and `lib/communication-graph.ts`, THIS FILE WINS and the .ts must be updated. If the RUNTIME BEHAVIOR disagrees because enforcement has not yet been added for a notation in this file, file an issue — the server must catch up.
