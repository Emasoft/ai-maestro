---
name: amp-communication-graph
description: "which governance titles can message which / why did my agent get 403 title_communication_forbidden / can MANAGER message a team MEMBER directly / who can the CHIEF-OF-STAFF talk to / AMP adjacency matrix / why does a team agent's message to MANAGER get blocked / reply-only messaging rule"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# amp-communication-graph

AMP messaging is governed by a title-based directed communication graph. Each governance title
defines which other titles the agent can message. Missing connections are blocked with HTTP 403
and a routing suggestion.

**Adjacency matrix.** `Y` = allowed, blank = forbidden, `1` = reply-only (sender may send EXACTLY
ONE reply to recipient if the recipient previously messaged the sender; without a prior inbound,
it's equivalent to blank).

**2026-04-22 v2 update** — HUMAN USER (H) is now a first-class node. H has full outbound `Y` to
every node including self (user-to-user). Team-agent edges to H are reply-only (`1`);
governance-title edges to H (M/T/A) are `Y`.

**2026-05-04 v3 update** — MANAGER → in-team-non-COS edges (ORCHESTRATOR, ARCHITECT, INTEGRATOR,
MEMBER) flipped from `Y` to blank. Real-world test showed great confusion when MANAGER bypassed
COS to issue directives directly to team agents — COS or ORCHESTRATOR ended up uninformed or
issued contradictory instructions. **The CHIEF-OF-STAFF is now the SOLE inbound/outbound gateway
for closed-team agents.** MANAGER still freely reaches COS, peer MANAGERs, MAINTAINER
(out-of-team), AUTONOMOUS (out-of-team), and the HUMAN user. The user (HUMAN) remains exempt —
full `Y` to every node.

| Sender \ Recipient | HUMAN | MANAGER | COS | ORCHESTRATOR | ARCHITECT | INTEGRATOR | MEMBER | MAINTAINER | AUTONOMOUS |
|---------------------|:-----:|:-------:|:---:|:------------:|:---------:|:----------:|:------:|:----------:|:----------:|
| **HUMAN**           |   Y   |    Y    |  Y  |      Y       |     Y     |     Y      |   Y    |     Y      |     Y      |
| **MANAGER**         |   Y   |    Y    |  Y  |              |           |            |        |     Y      |     Y      |
| **CHIEF-OF-STAFF**  |   1   |    Y    |  Y  |      Y       |     Y     |     Y      |   Y    |            |            |
| **ORCHESTRATOR**    |   1   |         |  Y  |              |     Y     |     Y      |   Y    |            |            |
| **ARCHITECT**       |   1   |         |  Y  |      Y       |           |            |        |            |            |
| **INTEGRATOR**      |   1   |         |  Y  |      Y       |           |            |        |            |            |
| **MEMBER**          |   1   |         |  Y  |      Y       |           |            |        |            |            |
| **MAINTAINER**      |   Y   |    Y    |     |              |           |            |        |            |            |
| **AUTONOMOUS**      |   Y   |    Y    |     |              |           |            |        |            |     Y      |

**Three layers of enforcement:**
1. **API (server-side)**: `lib/communication-graph.ts` → `validateMessageRoute()` checks
   sender/recipient titles before delivery. Returns `403 title_communication_forbidden` with
   routing suggestion.
2. **Agent prompts (client-side)**: Each role-plugin's main-agent .md file lists
   allowed/forbidden recipients. Skills (`agent-messaging`, `team-governance`) include the full
   graph.
3. **Subagents**: Sub-agent .md files explicitly forbid AMP messaging. Subagents have no AMP
   identity and cannot authenticate.

**The user** is exempt from the graph — can message any agent and receive responses from all.
Agents are discouraged from initiating messages to the user (only respond when contacted). The
user must still be authenticated to prevent agents from sending messages on the user's behalf.

See `docs_dev/2026-04-03-communication-graph.md` for the full spec with graph definition, routing
suggestions, and design rationale.

## See also

- [[amp-messaging]] — the AMP protocol itself, installation, CLI commands, architecture

## Notes and lessons learned
