# TRDD-80557822 — R6 Communication Graph Downstream Sync

**TRDD ID:** `80557822-b6f1-4b47-8770-7505947d8378`
**Filename:** `design/tasks/TRDD-80557822-comm-graph-downstream-sync.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)

**Status:** In progress — v1 tightening covered; v2 expansion (HUMAN node + reply-only edges) added 2026-04-22.
**Priority:** P1 (drift exists — agents still carry the OLD graph in their personas until these repos are re-published).
**Blocked by:** nothing. In-repo changes shipped in `b411352a` (v1) and the next commit (v2 — HUMAN node + reply-only `1>` edges). This TRDD covers the downstream propagation.

## v2 expansion (2026-04-22 afternoon)

The graph was further revised to:
- Add **HUMAN (H)** as a first-class graph node (previously "exempt from graph").
- Introduce the **`1>` reply-only edge type**: sender may send exactly ONE reply to recipient only if the recipient previously messaged the sender.
- Set all team-agent → H edges (`C`, `O`, `R`, `I`, `E`) to reply-only. Team agents may only reply to inbound user messages; cannot initiate.
- Set M/T/A → H edges to full `Y` (they may initiate user contact).
- Set H → * edges to full `Y` (user can message everyone, including other humans).

Downstream sync consumers must mirror:
1. The expanded 9-node matrix (M, C, O, R, I, E, T, A, H).
2. The `1>` notation — agents' personas and skill docs must clarify that team titles must not proactively message the user.
3. The R6.10 rule — reply-only enforcement requires `inReplyToMessageId`.

---

## 1. Context

Commit `b411352a` (2026-04-22) tightened the R6 communication graph in `ai-maestro`:

- `lib/communication-graph.ts` — server enforcement (authoritative).
- `docs/GOVERNANCE-RULES.md` §R6 — canonical rules.
- `CLAUDE.md` — project-instructions mirror.
- `reports/governance/*.md` — editable reference files.

The tightening:

- COS edges to MAINTAINER / AUTONOMOUS **REMOVED** (COS is now strictly the team gateway).
- MAINTAINER edges to COS / team roles / AUTONOMOUS / peer MAINTAINER **REMOVED** (MAINTAINER speaks to MANAGER only).
- AUTONOMOUS edges to COS / team roles / MAINTAINER **REMOVED** (AUTONOMOUS speaks to MANAGER + peer AUTONOMOUS only).
- MANAGER unchanged — full graph access, sole cross-layer bridge.

The server enforcement will now REJECT the removed edges (HTTP 403 with routing suggestion through MANAGER). But every place downstream that carries a HARDCODED copy of the graph still says the old edges are allowed — so agent personas will instruct agents to send messages that the API then refuses.

This TRDD lists every external file that needs updating, per repo, with exact instructions.

## 2. Files to update

Per-repo list. All repos are under the `Emasoft` GitHub org.

### A. `Emasoft/ai-maestro-plugin` (marketplace: `Emasoft/ai-maestro-plugins`)

Two skills embed the graph and the allow/deny decisions:

| File | What to change |
|------|---------------|
| `skills/agent-messaging/SKILL.md` | Replace the adjacency matrix (if present) + any prose-stated allow/deny with the new graph. Add the 2026-04-22 banner. |
| `skills/team-governance/SKILL.md` | Same — this is the skill agents load to understand R6. Match `docs/GOVERNANCE-RULES.md` verbatim for R6.1 – R6.5b. |

Publish with `uv run python scripts/publish.py --patch` in the plugin repo. Agents pick up the new graph on next `claude plugin update ai-maestro-plugin@ai-maestro-plugins`.

### B. Role-plugin repos — 8 repos

Each role-plugin main-agent carries a "Communication Permissions" section with a per-title allowed-recipients table. Every one must be aligned with the tightened graph.

| Repo | Main-agent file | Old claim | New claim |
|------|----------------|-----------|-----------|
| `Emasoft/ai-maestro-assistant-manager-agent` | `agents/ai-maestro-assistant-manager-agent-main-agent.md` | MANAGER has full access | Unchanged. MANAGER still has full graph access; text confirms MANAGER is the sole cross-layer bridge. |
| `Emasoft/ai-maestro-chief-of-staff` | `agents/ai-maestro-chief-of-staff-main-agent.md` | COS has "unrestricted messaging access to ALL titles" including MAINTAINER and AUTONOMOUS | REWRITE. COS is strictly the team gateway. Reaches MANAGER + team roles (ORCH/ARCH/INT/MEM) only. **Cannot** reach MAINTAINER or AUTONOMOUS — route through MANAGER. |
| `Emasoft/ai-maestro-orchestrator-agent` | `agents/ai-maestro-orchestrator-agent-main-agent.md` | ORCH reaches COS + team roles | Unchanged. ORCH still reaches COS + ARCH + INT + MEM. Add explicit "cannot reach MAINTAINER / AUTONOMOUS — request routing through COS → MANAGER" line. |
| `Emasoft/ai-maestro-architect-agent` | `agents/ai-maestro-architect-agent-main-agent.md` | ARCH reaches COS + ORCH only | Unchanged for the allowed edges. Add explicit "forbidden to reach team peers directly — ORCH routes" line, plus the new "forbidden to reach governance layer — MANAGER routes" line. |
| `Emasoft/ai-maestro-integrator-agent` | `agents/ai-maestro-integrator-agent-main-agent.md` | INT reaches COS + ORCH only | Same pattern as ARCH. |
| `Emasoft/ai-maestro-programmer-agent` | `agents/ai-maestro-programmer-agent-main-agent.md` | MEMBER reaches COS + ORCH only | Same pattern as ARCH. |
| `Emasoft/ai-maestro-maintainer-agent` | `agents/ai-maestro-maintainer-agent-main-agent.md` | MAINTAINER reaches MANAGER + COS | REWRITE. MAINTAINER reaches **only MANAGER**. Cross-MAINTAINER coordination: request MANAGER relay. No peer-MAINTAINER direct edge. |
| `Emasoft/ai-maestro-autonomous-agent` | `agents/ai-maestro-autonomous-agent-main-agent.md` | AUTO reaches MANAGER + COS + peer AUTO + MAINTAINER | REWRITE. AUTO reaches **MANAGER + peer AUTONOMOUS only**. Cannot reach COS, team roles, or MAINTAINER — route via MANAGER. |

Each repo is published independently with `uv run python scripts/publish.py --patch` from that repo's root. The marketplace (`Emasoft/ai-maestro-plugins`) auto-updates its metadata via a GitHub Action after each plugin repo push.

## 3. Draft persona prose (paste into each main-agent.md)

Use the identical wording in every role-plugin so there is no drift.

```markdown
## Communication Permissions (R6)

The R6 communication graph is ENFORCED at the API — violations return
HTTP 403 with a routing suggestion. This list mirrors the server
graph (`lib/communication-graph.ts::COMMUNICATION_GRAPH`) as of the
2026-04-22 tightening. If the API rejects a message you believe
should be allowed, re-read the server's routing suggestion before
retrying — it is authoritative.

Your title: <TITLE>
Your allowed recipients (direct edges):
  - <list of allowed titles, with a one-line note per title>

Your forbidden recipients (route via <routing target>):
  - <list of forbidden titles, each with the routing target MANAGER / COS / ORCHESTRATOR>

**Governance-layer vs team-layer**: MAINTAINER and AUTONOMOUS sit on
the governance layer; COS + ORCH + ARCH + INT + MEM sit on the team
layer. MANAGER is the SOLE cross-layer bridge — any message between
the two layers must transit MANAGER. COS is strictly the team
gateway — it no longer reaches governance-layer titles.

Sub-agents you spawn via the Agent tool CANNOT send AMP messages at
all. They have no AMP identity. Any message sent on their behalf
must be relayed by you (the main agent).
```

Each role-plugin fills in `<TITLE>`, the allowed-recipients list, and the forbidden-recipients routing table using the graph from commit `b411352a`.

## 4. Order of operations (recommended)

1. **`Emasoft/ai-maestro-plugin`** first — this ships the skills that agents discover R6 from at runtime. Even if a role-plugin still has an outdated personal copy, the team-governance skill is reloaded on every plugin update and the agent will see the new graph.
2. **`Emasoft/ai-maestro-chief-of-staff`** — biggest behavioral change (COS narrowed). Most-impacted agent persona.
3. **`Emasoft/ai-maestro-autonomous-agent`** and **`Emasoft/ai-maestro-maintainer-agent`** — also significantly narrowed.
4. Remaining 5 role-plugins in any order — their allowed-recipients lists didn't change, but the forbidden-recipients routing targets did (many "route through COS" → "route through MANAGER").

## 5. Verification

For each repo, after `publish.py`:

1. `claude plugin update <plugin>@ai-maestro-plugins` on a test agent.
2. Open the agent's main-agent file from the cache (`~/.claude/plugins/cache/...`) and confirm the new Communication Permissions section matches.
3. Trigger a scenario that includes an inter-title message on the affected edge (e.g. SCEN-006 / SCEN-009) and confirm the API accepts/rejects per the new graph.

## 6. Rollback

Each repo has its own git history. To revert, `git revert` the R6-sync commit in the affected repo and re-run `publish.py`.

## 7. Non-goals

- NOT updating role-plugin caches directly (`~/.claude/plugins/cache/...`). Per CLAUDE.md, cached copies are ephemeral — updates must go through the plugin's own GitHub repo + `publish.py`.
- NOT touching the `docs_dev/2026-04-03-communication-graph.md` spec (stale, dev-private, superseded by `docs/GOVERNANCE-RULES.md` §R6).
- NOT writing new unit tests for the comm graph — the existing scenario batch exercises it, and a dedicated unit-test module is a separate TRDD.
