---
name: amp-communication-graph
description: "which governance titles can message which / why did my agent get 403 title_communication_forbidden / can MANAGER message a team MEMBER directly / who can the CHIEF-OF-STAFF talk to / AMP adjacency matrix / why does a team agent's message to MANAGER get blocked / reply-only messaging rule"
ocd: 2026-08-02
lmd: 2026-10-01
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: messaging
publish-globally: false
---

# amp-communication-graph

^GP69AQP4 [desc: "AMP messaging is governed by a title-based directed communication graph; a missing edge is blocked with HTTP 403 and a routing suggestion", keywords: title_communication_forbidden_403 message_between_agents_blocked why_cant_agent_message_another_agent communication_graph_directed which_titles_can_message_which agent_messaging_forbidden routing_suggestion_missing_edge, ocd: 2026-08-02, lmd: 2026-10-01]
AMP messaging is governed by a title-based directed communication graph. Each governance title
defines which other titles the agent can message. Missing connections are blocked with HTTP 403
and a routing suggestion.

^GOWUIA6C [desc: "Adjacency-matrix cell semantics: Y = allowed, blank = forbidden, 1 = reply-only (exactly one reply permitted only after a prior inbound message)", keywords: reply_only_messaging_rule adjacency_matrix_Y_blank_1 what_does_1_mean_in_communication_matrix reply_only_without_prior_inbound exactly_one_reply_allowed matrix_cell_meaning, ocd: 2026-08-02, lmd: 2026-10-01]
**Adjacency matrix.** `Y` = allowed, blank = forbidden, `1` = reply-only (sender may send EXACTLY
ONE reply to recipient if the recipient previously messaged the sender; without a prior inbound,
it's equivalent to blank).

^T86T29YO [desc: "2026-04-22 v2: HUMAN USER became a first-class graph node with full outbound Y to every node; team-agent edges to HUMAN are reply-only, governance-title edges are Y", keywords: human_user_first_class_node v2_update_2026_04_22 user_to_user_messaging team_agent_reply_only_to_human governance_title_edges_to_human_what, ocd: 2026-08-02, lmd: 2026-10-01]
**2026-04-22 v2 update** — HUMAN USER (H) is now a first-class node. H has full outbound `Y` to
every node including self (user-to-user). Team-agent edges to H are reply-only (`1`);
governance-title edges to H (M/T/A) are `Y`.

^IZOQXBSZ [desc: "2026-05-04 v3: MANAGER to in-team non-COS edges flipped Y to blank after a real-world test showed confusion; CHIEF-OF-STAFF is now the sole gateway for closed-team agents", keywords: manager_cannot_message_team_agents_directly cos_sole_gateway_for_team why_manager_bypass_cos_blocked v3_update_2026_05_04 contradictory_instructions_from_manager_directives manager_to_orchestrator_blocked, ocd: 2026-08-02, lmd: 2026-10-01]
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

^UOC6PDEX [desc: "Three enforcement layers: server-side validateMessageRoute() in lib/communication-graph.ts returns 403; role-plugin agent prompts list allowed recipients; subagent .md files forbid AMP entirely", keywords: how_is_communication_graph_enforced subagents_cannot_send_amp validateMessageRoute 403_server_side_check agent_prompt_allowed_recipients subagent_no_amp_identity three_layers_enforcement, ocd: 2026-08-02, lmd: 2026-10-01]
**Three layers of enforcement:**
1. **API (server-side)**: `lib/communication-graph.ts` → `validateMessageRoute()` checks
   sender/recipient titles before delivery. Returns `403 title_communication_forbidden` with
   routing suggestion.
2. **Agent prompts (client-side)**: Each role-plugin's main-agent .md file lists
   allowed/forbidden recipients. Skills (`agent-messaging`, `team-governance`) include the full
   graph.
3. **Subagents**: Sub-agent .md files explicitly forbid AMP messaging. Subagents have no AMP
   identity and cannot authenticate.

^Z8Z9ZA6W [desc: "The user is exempt from the graph (can message anyone, receives from all) but must still authenticate, so agents cannot message on the user's behalf; agents are discouraged from initiating to the user", keywords: user_exempt_from_communication_graph agent_messaging_on_users_behalf user_must_still_authenticate_amp agents_discouraged_from_messaging_user user_receives_from_all_agents, ocd: 2026-08-02, lmd: 2026-10-01]
**The user** is exempt from the graph — can message any agent and receive responses from all.
Agents are discouraged from initiating messages to the user (only respond when contacted). The
user must still be authenticated to prevent agents from sending messages on the user's behalf.

See `docs_dev/2026-04-03-communication-graph.md` for the full spec with graph definition, routing
suggestions, and design rationale.

## See also

- [[amp-messaging]] — the AMP protocol itself, installation, CLI commands, architecture
- [[project-long-form-docs]] — `docs/COMMUNICATION-GRAPH.md` is the full S→R notation spec
  behind this page's adjacency matrix.

## Notes and lessons learned
