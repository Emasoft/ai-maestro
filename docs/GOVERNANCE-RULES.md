---
version: "3.7.0"
date: 2026-04-15
branch: feature/team-governance
changelog:
  - "3.7.0: Added R9.13 (role-plugin mandatory for every agent, including AUTONOMOUS), R11.12 (role-plugin mandatory at every boundary), Invariant 8 rewritten. Added new §0 'Canonical source + copies' index and new §TERMINOLOGY (TITLE / ROLE / PERSONA three-layer model). AUTONOMOUS now resolves to the mandatory ai-maestro-autonomous-agent role-plugin."
  - "3.6.0: R20 revised — custom-plugins/ and role-plugins/ are CONTAINERS, not marketplaces. Each container holds one marketplace-<client>/ subfolder per client format (marketplace-claude/, marketplace-codex/, marketplace-openrouter/, ...). Each client-marketplace has its own schema per that client's spec. The .abstract/ IR hub lives at the container level and feeds all per-client marketplaces."
  - "3.5.0: Added R20 (Marketplace Governance) — three default marketplaces, source path format (./<plugin>), .abstract IR storage, core-plugin auto-update, converted-plugin re-emission on source update"
  - "3.4.0: R17 expanded with protection (R17.B), auto-update (R17.C), trust auto-accept (R17.D); R9 clarified AUTONOMOUS vs team agent behavior"
  - "3.3.0: Added R17 (Mandatory Core Plugin Installation)"
  - "3.2.0: Added R16 (Password Never Shared with Agents)"
  - "3.1.0: Added R13 (Role Boundaries), R14 (Team Resilience), R15 (Written Orders & GitHub Trail)"
  - "3.0.0: Added R12 (Minimum Team Composition), PHOTOSTORY scenario rule, moved to docs/ for git tracking"
  - "2.0.0: Added R9 (Manager Requirement), R10 (Agent Lifecycle), R11 (Title-Plugin Binding), communication graph, groups"
  - "1.0.0: Initial governance rules (R1-R8, invariants, permission matrix)"
---

# Team Governance — Design Rules & Requirements

**Source:** Extracted from user instructions, audit reports, and logical inference

---

## §0. Canonical source + copies (READ THIS BEFORE EDITING)

**`docs/GOVERNANCE-RULES.md` is the canonical source of truth for every governance rule in the AI Maestro ecosystem.** Every time a rule is added, renamed, renumbered, rewritten, or deleted, **every file listed below** must be updated in the same commit. Leaving any entry stale produces drift — agents that still obey an old rule because their plugin persona was never refreshed, validation scripts that block legitimate operations because they still check an old gate, etc.

The list is maintained here (not in a separate `GOVERNANCE-COPIES.md`) so it is impossible to read the rules without seeing the index. Update this list whenever a new copy is added.

### 0.1 — Canonical source

| Path | Role | Update strategy |
|---|---|---|
| `docs/GOVERNANCE-RULES.md` | **CANONICAL** — single source of truth | Edit first. Bump the `version:` field in YAML frontmatter. Append a changelog entry. |

### 0.2 — Documentation mirrors (in this repo)

These files paraphrase or link to the rules. Keep them in sync with the canonical file. Never let them contradict §1-§20 below.

| Path | What it contains | Update strategy |
|---|---|---|
| `README.md` → "Understanding AI Maestro Terms" | TITLE / ROLE / PERSONA terminology + 8-title list | Edit whenever §TERMINOLOGY or §R3 changes |
| `CLAUDE.md` → "Agent Terminology (TITLE / ROLE / PERSONA) — READ FIRST" | Same as README but for assistant sessions | Edit whenever §TERMINOLOGY changes |
| `CLAUDE.md` → various rule mentions (R9, R17, R18, R19, R20) | Scattered cross-references | Search for rule IDs and update text |
| `design/tasks/TRDD-*.md` | Task design docs that quote rules | Only edit the specific TRDD; rule IDs must match |
| `tests/scenarios/SCENARIOS_TESTS_RULES.md` | Scenario test rules (separate from governance, but adjacent) | Edit only if a new scenario rule is added — do NOT copy governance rule text here |

### 0.3 — Role-plugin main-agent personas (shipped as plugins in the marketplace)

Every role-plugin's `agents/<name>-main-agent.md` embeds the subset of governance rules the agent in question must obey. **When a rule changes, every relevant plugin must be republished** (bumped version, new commit, marketplace manifest updated) so agents running the old version get the update via `claude plugin update`. Never edit the cache at `~/.claude/plugins/cache/` — always edit the plugin's own GitHub repo and republish via `scripts/publish.py`.

| Role-plugin | Repo | Rules the persona embeds | Update trigger |
|---|---|---|---|
| `ai-maestro-assistant-manager-agent` | `Emasoft/ai-maestro-assistant-manager-agent` | R3 (MANAGER singleton), R9, R10, R15, R16, R20.2, comm graph | Any change to MANAGER privileges |
| `ai-maestro-chief-of-staff` | `Emasoft/ai-maestro-chief-of-staff` | R3, R5 (COS per team), R9, R10, R12, R13, R15, comm graph | Any change to COS privileges or team-lifecycle rules |
| `ai-maestro-architect-agent` | `Emasoft/ai-maestro-architect-agent` | R3, R6, R13 role-boundaries, comm graph | Any change to ARCHITECT boundaries |
| `ai-maestro-orchestrator-agent` | `Emasoft/ai-maestro-orchestrator-agent` | R3, R6, R13, R15 written orders, comm graph | Any change to ORCHESTRATOR routing or kanban rules |
| `ai-maestro-integrator-agent` | `Emasoft/ai-maestro-integrator-agent` | R3, R6, R13, comm graph | Any change to INTEGRATOR boundaries |
| `ai-maestro-programmer-agent` | `Emasoft/ai-maestro-programmer-agent` | R3, R6, R13, R15, comm graph (MEMBER subset) | Any change to MEMBER boundaries |
| `ai-maestro-maintainer-agent` | `Emasoft/ai-maestro-maintainer-agent` | R3, R9, R19 (MAINTAINER), R20.2, comm graph | Any change to MAINTAINER rules |
| `ai-maestro-autonomous-agent` | `Emasoft/ai-maestro-autonomous-agent` | R3, R9.13, R11.3, R11.12, comm graph (AUTONOMOUS subset), workspace isolation | Any change to AUTONOMOUS boundaries |

### 0.4 — Skills in `ai-maestro-plugin` (the core plugin — shipped to every agent)

The core plugin embeds cross-cutting rules that every agent must know — not just the ones for its own title.

| Skill path (inside `Emasoft/ai-maestro-plugin`) | Rules it teaches | Update trigger |
|---|---|---|
| `skills/team-governance/SKILL.md` | R1-R15 summary, title permissions matrix, COS lifecycle | Any change to R1-R15 |
| `skills/agent-messaging/SKILL.md` | R6 (communication graph), AMP routing rules | Any change to R6 or the comm graph |
| `skills/agent-identity/SKILL.md` | R14 (identity), R16 (password secrecy) | Any change to AID / password rules |
| `skills/team-kanban/SKILL.md` | R15 (written orders), kanban workflow | Any change to R15 or kanban rules |

### 0.5 — Enforcement code (TypeScript services)

These files enforce the rules at runtime. When a rule changes, **update the gate logic here in the same commit** — not in a follow-up PR, otherwise the server and the docs disagree for however long the follow-up takes.

| Path | What it enforces | Must be updated when |
|---|---|---|
| `services/element-management-service.ts` | `ChangeTitle` (23 gates), `ChangeTeam`, `ChangeClient`, `ChangePlugin`, `CreateAgent` | Any rule changes the conditions for title assignment, plugin install, or team membership |
| `services/governance-service.ts` | Team governance, MANAGER/COS checks, password validation, governance-request lifecycle | R3, R4, R5, R9, R10, R16 changes |
| `lib/communication-graph.ts` | R6 comm graph (directed adjacency matrix) | Any change to R6 |
| `lib/ecosystem-constants.ts` | `TITLE_PLUGIN_MAP`, `ROLE_PLUGIN_*`, `PREDEFINED_ROLE_PLUGIN_NAMES`, `PLUGIN_COMPATIBLE_TITLES` | R11 / R20.4 default changes, new predefined role-plugin |
| `lib/team-registry.ts` | `blockAllTeams`, `unblockAllTeams`, `isAgentInAnyTeam` | R9 cascade changes |
| `lib/agent-auth.ts` | Auth bridge, MANAGER/COS gate checks | R9, R10 auth changes |
| `lib/sudo-fetch.ts` + `security-registry.json` | Strict-route list, sudo-mode gate | Any new strict operation |
| `server.mjs` (startup tasks) | MANAGER detection, team blocking on boot | R9 cascade |

### 0.6 — API routes that re-implement rule checks

| Path | What it checks | Must be updated when |
|---|---|---|
| `app/api/agents/route.ts` (POST/GET) | CreateAgent delegation; auth + title validation | R3, R9, R11 |
| `app/api/agents/[id]/route.ts` (PATCH/DELETE) | Title change dispatcher, auth gate | R3, R9, R10, R11 |
| `app/api/agents/[id]/wake/route.ts` | R10 wake permission matrix | R10 |
| `app/api/agents/[id]/hibernate/route.ts` | R10 hibernate permission matrix | R10 |
| `app/api/agents/[id]/title/route.ts` | Title change pipeline + governance password | R3, R9, R11 |
| `app/api/teams/route.ts` + `app/api/teams/[id]/route.ts` | R1, R2, R3 team CRUD + block/unblock | R1, R2, R3, R9 |
| `app/api/governance/password/route.ts` | R16 password handling | R16 |
| `app/api/governance/requests/*` | R4 governance request lifecycle | R4 |

### 0.7 — UI components that display or enforce rules

| Path | What it shows/enforces | Update trigger |
|---|---|---|
| `components/agent-profile/RoleTab.tsx` | N:1 compatibility UI (locked label vs dropdown), R11 title-plugin binding | Any R11 change |
| `components/AgentCreationWizard.tsx` | Title picker, role-plugin picker, R9/R11/R19 requirements | Any R9, R11, R19 change |
| `components/TitleAssignmentDialog.tsx` | Governance password gate, title change flow | R3, R16 changes |
| `components/sidebar/TeamListView.tsx` | Team delete dialog, R1/R9 blocking behavior | R1, R9 changes |

### 0.8 — Scenario test specs (`tests/scenarios/SCEN-*.scen.md`)

When a rule changes, any scenario that exercises the old behavior must be rewritten. Scenarios that test governance:

| Scenario | Rules tested | Update trigger |
|---|---|---|
| `SCEN-001_title-change-lifecycle.scen.md` | R3, R9, R11 | R3, R9, R11 |
| `SCEN-002_team-create-delete.scen.md` | R1, R2, R9 | R1, R2, R9 |
| `SCEN-005_manager-gate-team-lifecycle.scen.md` | R3, R9 MANAGER gate cascade | R3, R9 |
| `SCEN-010_cos-lifecycle.scen.md` | R5 COS immutability | R5 |
| `SCEN-011_agent-session-control.scen.md` | R10 lifecycle governance | R10 |
| `SCEN-018_maintainer-lifecycle.scen.md` | R19 MAINTAINER | R19 |
| `SCEN-019_marketplace-install-uninstall.scen.md` | R20 marketplace | R20 |
| `SCEN-020_core-plugins-unchangeable.scen.md` | R17 core plugin | R17 |
| `SCEN-021_user-vs-local-scope.scen.md` | R20.20 scope isolation | R20.20 |
| `SCEN-022_manager-autonomous-config-ops.scen.md` | R9, R9.13, R11 (MANAGER creates AUTONOMOUS) | R9, R11 |

### 0.9 — Validation scripts and linters

| Path | What it validates | Update trigger |
|---|---|---|
| `scripts/publish.py` (in each role-plugin repo) | Quad-match identity, `.agent.toml` schema, CPV strict | Role-plugin TOML schema changes |
| `scripts/validate-governance.sh` (if present) | Runtime governance check | Any rule change affecting runtime enforcement |
| `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` | UI helper functions used by scenarios | UI governance flow changes |

### 0.10 — Update protocol

When you change a rule:

1. **Edit `docs/GOVERNANCE-RULES.md` first.** Bump the `version:` field. Append a changelog entry with the rule ID that changed.
2. **Walk through §0.2 - §0.9 above.** For every entry that applies, read the referenced file and update the text/code/test so it matches the new rule.
3. **Update this §0 index** if you added a new copy location.
4. **Commit all affected files together** — not a separate PR per category. The canonical file and every mirror must be atomic.
5. **Republish affected role-plugins** via `scripts/publish.py` in each plugin's own GitHub repo. The publish pipeline bumps the plugin version, updates the marketplace manifest, and triggers `claude plugin update` on running agents.
6. **Run the affected SCEN-NNN scenarios** to verify the rule change is coherent end-to-end before claiming it works.

If you catch yourself thinking "I'll fix the other copies later", STOP — that is how drift starts. Fix them now, or revert the canonical change and come back when you have the time to do it properly.

---

## §TERMINOLOGY. Three-layer agent model (TITLE / ROLE / PERSONA)

Every AI Maestro agent has **three orthogonal layers**. Keeping them distinct is essential — they are mutated by different pipelines, displayed in different UI tabs, and governed by different rules.

| Layer | Answers | Example |
|---|---|---|
| **TITLE** | *What is it allowed to do?* — the governance class (permissions) | `MEMBER` |
| **ROLE** | *What does it know how to do?* — the role-plugin main agent loaded from a marketplace | `ai-maestro-programmer-agent:programmer-main-agent@Emasoft/ai-maestro-plugins` |
| **PERSONA** | *Which specific running instance?* — identity (name, AID, avatar, workdir) | `peter-bot, <aid>, ~/avatars/peter.jpg, ~/agents/peter-bot/` |

### §TERMINOLOGY.1 — TITLE (governance class)

The TITLE determines what an agent is authorized to do within the governance system. The eight valid titles are listed in R3. TITLE is the access-control role, not the behaviour. Changing a TITLE runs the `ChangeTitle` pipeline (23 gates) and requires the governance password or MANAGER/COS authorization per R3 and R16. In the code: `agent.governanceTitle` (lowercase kebab).

### §TERMINOLOGY.2 — ROLE (role-plugin main agent)

The ROLE is the **role-plugin main agent** the PERSONA is currently running. It is referenced in fully-qualified form:

```
<plugin-name>:<main-agent-name>@<marketplace>
```

The `@<marketplace>` suffix mirrors Claude Code's standard plugin syntax (`plugin@marketplace`); the `:<main-agent>` segment selects which main-agent `.md` file inside the plugin is loaded by `claude --agent <main-agent>`. A role-plugin is **any normal Claude Code plugin** that additionally contains:

1. A `<name>.agent.toml` file at the plugin root with two mandatory extra fields: `compatible-titles` (array of governance titles the plugin is designed for) and `compatible-clients` (array of CLI clients like `claude-code`, `codex`).
2. A main-agent `.md` file whose persona text carries the governance rules that agent must follow — inline, via `skills:` references, or via rule-file links. This persona is the actual security boundary: every agent on a host shares a single `gh` CLI identity, so only the persona text restrains destructive actions.

Storage location, install pipeline, `TITLE_PLUGIN_MAP` membership, and the Haephestos authoring tool are **NOT** defining properties of a role-plugin. Any plugin matching the two conditions above is a valid role-plugin regardless of where it lives or how it was authored. AI Maestro ships two default role-plugin marketplaces (`Emasoft/ai-maestro-plugins` remote, `ai-maestro-local-roles-marketplace` local at `~/agents/role-plugins/marketplace/`), but role-plugin folders can live anywhere as long as a registered marketplace manifest's `source` field points at them.

Changing a ROLE runs `ChangePlugin` with the `rolePluginSwap` flag, or is triggered automatically by `ChangeTitle` Gates 15/16 when the new TITLE requires a different plugin. In the code: `agent.rolePlugin` + `config.rolePlugin.name`.

### §TERMINOLOGY.3 — PERSONA (running instance)

The PERSONA is the concrete running agent. Four attributes together identify a specific Claude Code tmux session:

1. **Name** — a unique kebab identifier (e.g. `peter-bot`, `sammy`). Case-insensitive on input; lowercase internally; capitalized for display.
2. **AID** — the Agent Identity Ed25519 key pair used for AMP signing and cross-host authentication. Provisioned once per PERSONA; stored at `~/.agent-messaging/agents/<name>/keys/`.
3. **Avatar** — image file displayed on the sidebar card.
4. **Workdir** — project folder at `~/agents/<name>/` where Claude Code runs. All `--scope local` plugins live here, and this is the only location outside `/tmp` where the PERSONA may write.

PERSONA is the only layer with 1:1 cardinality to a running tmux session. TITLE and ROLE are swappable on a live PERSONA without destroying identity, AID, avatar, or workdir.

In the code: `agent.name` + `agent.label` + `agent.aid` + `agent.workingDirectory` + `agent.avatarPath` together form the PERSONA.

### §TERMINOLOGY.4 — Relationships and invariants

- **TITLE and ROLE are orthogonal but constrained by `compatible-titles`.** `ChangeTitle` rejects assigning a ROLE whose `.agent.toml` does not include the new TITLE — the plugin was designed (skills, instructions, governance text) for those specific titles, and installing it in an incompatible title breaks that design contract.
- **N:1 compatibility** — multiple ROLEs can satisfy one TITLE. The Agent Profile → Role tab shows a dropdown when ≥2 role-plugins declare the same title in their `compatible-titles`, and a locked label when exactly one does. One ROLE may also be compatible with multiple TITLEs.
- **R9.13 mandatoriness** — every persisted agent MUST carry exactly one ROLE. CreateAgent / ChangeTitle HARD REJECT any desired state that would leave an agent with zero role-plugins.
- **AUTONOMOUS resolves to `ai-maestro-autonomous-agent`** — no title is ever "no plugin". See R11.3 and R11.12.

### §TERMINOLOGY.5 — Writing conventions

- Use **TITLE** when discussing permissions, governance, the communication graph, or approval flows.
- Use **ROLE** when discussing behaviour, skills, main-agent persona text, or available tools.
- Use **PERSONA** when identifying a specific agent (the one in the sidebar card, at that workdir, with that AID).
- Do not use "role" as a synonym for "title". The 2026-03-20 rename made `TitleBadge` / `TitleAssignmentDialog` authoritative in the codebase.
- When the user says "change the agent's role", clarify whether they mean swap the role-plugin (ROLE) or re-assign the governance level (TITLE) — these are different pipelines.

### §TERMINOLOGY.6 — OOP analogy

If it helps communicating the model to a new contributor:

- **TITLE** = access-control role (permission level)
- **ROLE** = class definition (behaviour + skills + instructions)
- **PERSONA** = instance (state + identity)

---

## Overview

AI Maestro implements a team governance model with eight governance titles
(MANAGER, CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER,
AUTONOMOUS, MAINTAINER), teams (isolated messaging + ACL), groups
(lightweight broadcast collections), three default plugin marketplaces
(R20), and an identity layer where every privileged action is backed by
a cryptographically-signed AID token. Teams require a MANAGER to
function. Groups are unstructured collections with no governance.
MAINTAINERs live at the host level bound to a GitHub repo and never
join a team.

---

## R1. Teams and Groups

| ID | Rule | Source |
|----|------|--------|
| R1.1 | **Teams** have isolated messaging, ACL, governance titles, and a COS. Former "closed teams" | Explicit |
| R1.2 | **Groups** are lightweight agent collections for broadcast messaging. No governance, no COS, no kanban. Former "open teams" | Explicit |
| R1.3 | Every team **SHOULD** have a COS assigned — the COS manages membership and external communication | Explicit |
| R1.4 | Teams require a **MANAGER** to exist on the host before they can be created | Explicit |
| R1.5 | Teams without a MANAGER are **blocked** (`team.blocked = true`) — all operations frozen | Explicit |
| R1.6 | Groups have no governance constraints — any agent can subscribe/unsubscribe freely | Explicit |

**Rationale:** The COS is the team's operational leader. The MANAGER is the host-wide governance authority. Without either, the team cannot function safely. Groups exist for lightweight coordination without governance overhead.

---

## R2. Team Name Rules

| ID | Rule | Source |
|----|------|--------|
| R2.1 | Team names must be unique (case-insensitive comparison) — no two teams can share the same name | Explicit |
| R2.2 | Duplicate name check must be enforced both server-side (API rejects with 409) and client-side (UI shows inline error before POST) | Implicit (both creation surfaces exist) |
| R2.3 | Renaming a team via update must also check uniqueness against all other teams (excluding the team being renamed) | Implicit (rename is an update operation) |

---

## R3. Role Hierarchy Rules

| ID | Rule | Source |
|----|------|--------|
| R3.1 | Eight governance titles exist: **MANAGER** (global singleton), **CHIEF-OF-STAFF** (per team), **ORCHESTRATOR** (per team), **ARCHITECT**, **INTEGRATOR**, **MEMBER** (default team title), **AUTONOMOUS** (no team), **MAINTAINER** (no team, bound to a GitHub repo) | Explicit |
| R3.2 | Only ONE agent can be MANAGER at any given time (singleton constraint) | Explicit |
| R3.3 | COS is a per-team title — each team has exactly one COS | Explicit |
| R3.4 | An agent can be COS of only **ONE** team at any time | Explicit |
| R3.5 | All role changes (assign/remove MANAGER, assign/remove COS) require the governance password | Explicit |
| R3.6 | MANAGER has full authority over all teams: can add/remove agents, assign COS, approve transfers, create/delete teams, message anyone | Explicit |
| R3.7 | COS is responsible for **external communication** of their team — they are the contact point for outside agents | Explicit |
| R3.8 | COS decides the **staff composition** (add/remove agents) of their team — this is why they are called "chief-of-staff" | Explicit |
| R3.9 | MANAGER can do everything COS can, but **usually delegates** to the COS | Explicit |
| R3.10 | Typical workflow: MANAGER creates a team, assigns a COS, and lets the COS manage the team from there | Explicit |
| R3.11 | Reassigning MANAGER to a new agent immediately revokes the role from the old agent (only one MANAGER exists) | Implicit (singleton) |
| R3.12 | COS changes (assign/remove) on a team must **NOT** be possible via the generic `PUT /api/teams/[id]` endpoint — only via the dedicated `POST /api/teams/[id]/chief-of-staff` endpoint which requires the governance password | Implicit (prevents bypass of password protection) |

---

## R4. Agent Membership Rules

| ID | Rule | Source |
|----|------|--------|
| R4.1 | Non-MANAGER agents can be in at most **ONE team** at any given time (single-team membership) | Explicit |
| R4.2 | Any agent can subscribe to **unlimited groups** simultaneously (groups have no governance) | Explicit |
| R4.3 | **MANAGER** and **MAINTAINER** are not in any team — both operate at the host level | Explicit |
| R4.4 | When an agent joins a team, it is auto-assigned the **MEMBER** title and the programmer plugin | Explicit |
| R4.5 | An agent cannot be added to a team they are already a member of (no duplicate membership in `agentIds`) | Explicit |
| R4.6 | COS **must** be a member of the team they lead (present in `agentIds[]`) — they manage the team staff and the message filter relies on `agentIds` for same-team communication | Implicit (logical necessity) |
| R4.7 | Removing a COS from a team's `agentIds` while they remain `chiefOfStaffId` is **forbidden** — COS title can only be removed by deleting the team | Implicit (COS immutability invariant) |
| R4.8 | The UI must **always show team memberships** when selecting agents for any operation (add to team, remove from team, transfer, team creation agent selection) | Explicit |
| R4.9 | Agent existence must be validated when adding to a team — `agentIds` must reference agents that actually exist in the registry | Implicit (referential integrity) |

---

## R5. Transfer Rules

| ID | Rule | Source |
|----|------|--------|
| R5.1 | Moving a normal agent **FROM** a team requires a transfer request (approval workflow) — the agent cannot simply leave | Explicit (implemented) |
| R5.2 | Only MANAGER or COS can **create** transfer requests | Explicit (enforced) |
| R5.3 | Only the source team's COS or MANAGER can **approve/reject** transfers | Explicit (enforced) |
| R5.4 | COS **cannot be transferred out** of their own team — COS title is immutable to team lifecycle | Implicit (COS immutability invariant) |
| R5.5 | **Destination team must exist** at the time the transfer request is created | Implicit (referential integrity) |
| R5.6 | Source and destination teams must be **different** (no self-transfer) | Implicit (nonsensical operation) |
| R5.7 | On transfer approval, the **single-team constraint** (R4.1) must be checked: verify the agent is not already in another team | Implicit (logical consequence) |
| R5.8 | Duplicate pending transfer requests (same agent + same source + same destination) must be prevented | Explicit (enforced) |

---

## R6. Messaging Rules (Communication Graph)

All teams are closed. Messaging between agents is governed by a title-based directed communication graph. Missing connections are forbidden.

**Adjacency matrix** (Y = allowed, empty = forbidden):

| Sender \ Recipient | MANAGER | COS | ORCHESTRATOR | ARCHITECT | INTEGRATOR | MEMBER | AUTONOMOUS |
|---------------------|:-------:|:---:|:------------:|:---------:|:----------:|:------:|:----------:|
| **MANAGER**         |    Y    |  Y  |      Y       |     Y     |     Y      |   Y    |     Y      |
| **CHIEF-OF-STAFF**  |    Y    |  Y  |      Y       |     Y     |     Y      |   Y    |     Y      |
| **ORCHESTRATOR**    |         |  Y  |              |     Y     |     Y      |   Y    |            |
| **ARCHITECT**       |         |  Y  |      Y       |           |            |        |            |
| **INTEGRATOR**      |         |  Y  |      Y       |           |            |        |            |
| **MEMBER**          |         |  Y  |      Y       |           |            |        |            |
| **AUTONOMOUS**      |    Y    |  Y  |              |           |            |        |     Y      |

| ID | Rule | Source |
|----|------|--------|
| R6.1 | Communication rules are defined by the directed graph above — each (sender, recipient) pair must be explicitly listed | Explicit |
| R6.2 | **MANAGER** and **COS** can message all titles (full graph access) | Explicit |
| R6.3 | **ORCHESTRATOR** can message COS, ARCHITECT, INTEGRATOR, MEMBER (not MANAGER or AUTONOMOUS) | Explicit |
| R6.4 | **ARCHITECT**, **INTEGRATOR**, **MEMBER** can only message COS and ORCHESTRATOR | Explicit |
| R6.5 | **AUTONOMOUS** can message MANAGER, COS, and other AUTONOMOUS agents | Explicit |
| R6.6 | The **user** is exempt from the graph — can message any agent and receive responses from all | Explicit |
| R6.7 | When a message is blocked, the error must include a **routing suggestion** (e.g., "INTEGRATOR cannot message MANAGER. Route through CHIEF-OF-STAFF instead.") | Explicit |
| R6.8 | **Three layers of enforcement**: (1) API server validates sender/recipient titles before delivery, (2) Role-plugin main-agent .md files list allowed recipients, (3) Sub-agents are forbidden from using AMP messaging entirely | Explicit |
| R6.9 | Sub-agents have no AMP identity and cannot authenticate — they communicate only with their spawning main-agent | Explicit |

Full spec: `docs_dev/2026-04-03-communication-graph.md`

---

## R7. UI Robustness Rules

| ID | Rule | Source |
|----|------|--------|
| R7.1 | **Prevent accidental multiple operations** from fast repeated clicks — all mutating buttons must have `submitting` guards | Explicit |
| R7.2 | Show **loading spinners** for all async operations (API calls, data fetching) | Explicit |
| R7.3 | Show **error messages** for all failures — no silent failures allowed | Explicit |
| R7.4 | Handle all **edge cases** and possible errors gracefully | Explicit |
| R7.5 | No **infinite loops** or **blocking operations** in the UI | Explicit |
| R7.6 | Show **role badges** (MANAGER: amber/gold, COS: indigo) next to agent names throughout the UI | Implicit |
| R7.7 | Show **blocked badge** on teams when no MANAGER exists | Implicit |
| R7.8 | **Resolve COS UUID** to human-readable agent name everywhere it is displayed — never show raw UUIDs to users | Implicit (UX requirement) |
| R7.9 | When governance data is loading, show **loading state** — do not show stale/default "normal" role which would be misleading | Implicit |

---

## R8. Data Integrity Rules

| ID | Rule | Source |
|----|------|--------|
| R8.1 | All write operations on teams use **file locking** (`withLock`) to prevent corruption from concurrent writes | Implemented |
| R8.2 | `chiefOfStaffId` and `type` changes must **NOT** be accepted in the generic team update (`PUT /api/teams/[id]`) — must use dedicated password-protected endpoints | Implicit (prevents governance bypass) |
| R8.3 | Team deletion should **clean up related transfers** (cancel pending transfer requests involving the deleted team) | Implicit (referential integrity) |
| R8.4 | `Agent.team` free-text field is **display-only** — it is NOT connected to `Team.id` in the governance system, membership is tracked solely via `Team.agentIds[]` | Documented |

---

## R9. Manager Requirement

The MANAGER is the host-wide governance authority. Without a MANAGER, teams cannot function — but AUTONOMOUS agents operate normally. The key distinction:

- **AUTONOMOUS agents**: Always fully operational. Can be created, woken, hibernated, and used regardless of whether a MANAGER exists. They appear in the dashboard at all times.
- **Team agents** (any agent in a team's `agentIds[]`): Require a MANAGER on the host. When no MANAGER exists, team agents are forcefully hibernated and cannot be woken until a MANAGER is assigned.

**All agents always appear in the dashboard sidebar** (ACTIVE/ALL/HIBER tabs) regardless of MANAGER status. The MANAGER gate only controls whether team agents can be **woken** — it never hides agents from the UI or removes them from the registry.

### Manager Blocking Protocol

When no MANAGER exists (at startup or after MANAGER removal), this cascade executes:

1. All teams are marked `blocked: true` in `teams.json`
2. All agents belonging to blocked teams have their tmux sessions killed (forcefully hibernated)
3. The wake API rejects wake requests for team agents with HTTP 403: "Cannot wake team agent: no MANAGER exists"
4. AUTONOMOUS agents are **completely unaffected** — they keep running, can be woken, hibernated, created, and deleted normally
5. Team CRUD operations (add/remove agents, create/delete teams) are rejected with HTTP 400

When a MANAGER is assigned (via title change), the reverse cascade runs:

1. All teams are marked `blocked: false`
2. Agents remain hibernated — the MANAGER or user must wake them manually
3. All team operations are re-enabled

| ID | Rule | Source |
|----|------|--------|
| R9.1 | A MANAGER agent **MUST** exist on the host before any team can be created | Explicit |
| R9.2 | If no MANAGER exists, all existing teams are **blocked** (`team.blocked = true`) | Explicit |
| R9.3 | When teams are blocked, no agents can be added to or removed from them | Explicit |
| R9.4 | When teams are blocked, all agents belonging to those teams are **forcefully hibernated** (tmux sessions killed) | Explicit |
| R9.5 | **AUTONOMOUS agents are completely unaffected by team blocking** — they can be created, woken, hibernated, deleted, and used normally even when no MANAGER exists. The MANAGER gate applies exclusively to team agents | Explicit |
| R9.6 | When a MANAGER is assigned (title change), all teams are **unblocked** (`team.blocked = false`) | Explicit |
| R9.7 | Unblocking does **NOT** auto-wake agents — agents remain hibernated until manually woken by the user or the MANAGER | Explicit |
| R9.8 | If a MANAGER is deleted or their title is removed, the blocking cascade triggers immediately (same as startup without MANAGER) | Explicit |
| R9.9 | At server startup, if no MANAGER is detected, team blocking + agent hibernation runs as a startup task | Explicit |
| R9.10 | When attempting to delete the MANAGER agent, the Delete Agent dialog MUST show a clear warning: "This agent holds the MANAGER title. Removing it will block all team operations." The system auto-demotes the MANAGER to AUTONOMOUS before proceeding with deletion | Explicit |
| R9.11 | The MANAGER agent may create teams via the API using AID authentication. The governance password is NOT required for MANAGER-initiated team creation — the server validates the MANAGER's AID session secret (mst_* token) and grants team-creation privileges based on the MANAGER governance title | Explicit |
| R9.12 | **All agents always appear in the dashboard** (sidebar ACTIVE/ALL/HIBER tabs) regardless of MANAGER status. The MANAGER gate controls wake permissions, not visibility. The registry is the source of truth for the agent list — it is never filtered by governance state | Explicit |
| R9.13 | **Role-plugin is mandatory for every agent** (including AUTONOMOUS). CreateAgent, ChangeTitle, ChangeClient, ChangeTeam, and RegisterAgentFromSession MUST reject any desired state that would leave an agent with zero role-plugins. The only valid "no role-plugin" window is the transient instant inside a Change\* pipeline between uninstall and install — the agent is never persisted in that state. AUTONOMOUS resolves to `ai-maestro-autonomous-agent` which encodes workspace isolation, forbidden cross-agent mutation, and comm-graph restrictions in its persona. This closes the security gap where a persona-less AUTONOMOUS agent could destroy other agents' working directories, force-merge PRs, or mutate shared registry state — since all agents share one `gh` CLI identity, the persona instructions are the only effective governance boundary. See R11.12, R20.4, Invariant 8 | Explicit |

**Rationale:** Without a MANAGER, no governance authority exists to oversee teams. Blocking prevents unsupervised team operations and ensures the system is in a safe state until governance is restored. AUTONOMOUS agents are independent by definition — they have no team, no COS, and no governance chain that requires a MANAGER. Restricting them would break the fundamental principle that AUTONOMOUS agents operate outside the team governance model.

---

## R10. Agent Lifecycle Governance

| ID | Rule | Source |
|----|------|--------|
| R10.1 | Only the **user** (web UI, no auth headers) or the **MANAGER** agent can wake ANY agent | Explicit |
| R10.2 | Only the **user** or the **MANAGER** agent can hibernate ANY agent | Explicit |
| R10.3 | The **CHIEF-OF-STAFF** can wake or hibernate agents that belong to **their own team only** | Explicit |
| R10.4 | All other agents (MEMBER, ORCHESTRATOR, ARCHITECT, INTEGRATOR, AUTONOMOUS) **cannot** wake or hibernate any agent | Explicit |
| R10.5 | Team agents cannot be woken if no MANAGER exists on the host (even by the user — assign MANAGER first) | Explicit |
| R10.6 | The restart endpoint follows the same governance rules as the wake endpoint | Explicit |
| R10.7 | When deleting a team with "Delete Agents Too", the system SHOULD warn if any agents were created before the team and offer to keep them as AUTONOMOUS instead of deleting them | Recommended |

**Enforcement points:**
- `POST /api/agents/[id]/wake` — checks auth headers, validates caller is user/MANAGER/COS-of-team
- `POST /api/agents/[id]/hibernate` — same checks
- `POST /api/sessions/[id]/restart` — checks if target agent is in a team without MANAGER

---

## R11. Title-Plugin Binding

| ID | Rule | Source |
|----|------|--------|
| R11.1 | Every governance title (including MEMBER and AUTONOMOUS) has a corresponding default role-plugin. **There is NO "no role-plugin" state for a persisted agent** — every agent MUST carry exactly one role-plugin at rest | Explicit |
| R11.2 | MEMBER title installs `ai-maestro-programmer-agent` via ChangeTitle pipeline | Explicit |
| R11.3 | AUTONOMOUS title installs `ai-maestro-autonomous-agent` — the mandatory role-plugin for no-team agents. Its persona enforces workspace isolation, forbids cross-agent mutation, and encodes the AMP communication-graph restrictions. ChangeTitle('autonomous') swaps whatever role-plugin the agent currently has for `ai-maestro-autonomous-agent` | Explicit |
| R11.4 | When an agent joins a team, ChangeTeam calls ChangeTitle('member') which auto-installs the programmer plugin | Explicit |
| R11.5 | When an agent leaves a team, ChangeTeam calls ChangeTitle('autonomous') which uninstalls the team role-plugin and installs `ai-maestro-autonomous-agent` in its place | Explicit |
| R11.12 | **Role-plugin is mandatory at every boundary.** CreateAgent, ChangeTitle, ChangeClient, ChangeTeam, and RegisterAgentFromSession **MUST** reject any desired-state that would leave an agent with zero role-plugins. The only legitimate "no role-plugin" window is the transient instant inside an AIO pipeline between uninstall and install — the agent is never persisted in that state. This is R9.13 as reflected in R11. | Explicit |
| R11.6 | The N:1 compatibility model allows multiple plugins to serve one title — the UI shows a dropdown when 2+ plugins are compatible | Explicit |
| R11.7 | Role-plugins are identified by the **fourfold identity rule**: (1) `plugin.json` `name` is the canonical identity, (2) folder name must equal it, (3) `<name>.agent.toml` must exist with `[agent].name` matching, (4) `agents/<name>-main-agent.md` must exist with frontmatter `name: <name>-main-agent`. All 4 must match or the plugin is rejected | Explicit |
| R11.8 | The target client of a role-plugin is determined ONLY by the `compatible-clients` field in `.agent.toml`, never by the plugin name | Explicit |
| R11.9 | When converting a role-plugin to another client format, the converter preserves the original name, updates `compatible-clients` in `.agent.toml` to the target client, enforces fourfold identity, and stores in `~/agents/role-plugins/`. The converter NEVER overwrites an existing role-plugin folder | Explicit |
| R11.10 | Ordinary (non-role) plugins get a `-<client>` suffix when converted (e.g., `my-plugin-codex`) and are stored in `~/agents/custom-plugins/<client>/` with the `ai-maestro-local-custom-marketplace` | Explicit |
| R11.11 | The `ai-maestro-local-roles-marketplace` contains ALL local role-plugins regardless of their target client. The `ai-maestro-local-custom-marketplace` contains converted ordinary plugins | Explicit |

**Title → Default Plugin mapping:**

| Title | Default Role-Plugin |
|-------|-------------------|
| MANAGER | ai-maestro-assistant-manager-agent |
| CHIEF-OF-STAFF | ai-maestro-chief-of-staff |
| ORCHESTRATOR | ai-maestro-orchestrator-agent |
| ARCHITECT | ai-maestro-architect-agent |
| INTEGRATOR | ai-maestro-integrator-agent |
| MEMBER | ai-maestro-programmer-agent |
| MAINTAINER | ai-maestro-maintainer-agent |
| AUTONOMOUS | ai-maestro-autonomous-agent |

---

## R12. Minimum Team Composition (CRITICAL)

| ID | Rule | Source |
|----|------|--------|
| R12.1 | Every team **MUST** contain a minimum of 5 agents with these titles: **1 CHIEF-OF-STAFF**, **1 ARCHITECT**, **1 ORCHESTRATOR**, **1 INTEGRATOR**, **1 MEMBER** (programmer role-plugin) | Explicit |
| R12.2 | A team lacking any of the 5 required titles is a **NON-FUNCTIONAL TEAM** — the CHIEF-OF-STAFF must immediately add the missing agents | Explicit |
| R12.3 | Each role-plugin is designed for **one role only** — an agent cannot simultaneously serve as COS and ARCHITECT, or any other title combination | Explicit |
| R12.4 | Additional agents with the **MEMBER** title can be added at the judgment of the CHIEF-OF-STAFF, using the programmer role-plugin or any role-plugin compatible with the MEMBER title | Explicit |
| R12.5 | The CHIEF-OF-STAFF decides team composition based on the **design requirements document** received from the MANAGER | Explicit |
| R12.6 | The **MANAGER** must enforce R12.1 when creating teams — a team creation task must always produce at least 5 agents | Explicit |

**Example of a well-composed team (10 agents):**

| # | Title | Role-Plugin | Purpose |
|---|-------|-------------|---------|
| 1 | CHIEF-OF-STAFF | ai-maestro-chief-of-staff | Team operations, staffing, external comms |
| 2 | ARCHITECT | ai-maestro-architect-agent | System design, data models, architecture |
| 3 | ORCHESTRATOR | ai-maestro-orchestrator-agent | Task coordination, workflow management |
| 4 | INTEGRATOR | ai-maestro-integrator-agent | Integration, CI/CD, deployment |
| 5 | MEMBER | ai-maestro-programmer-agent | Core implementation |
| 6 | MEMBER | database-expert (custom) | Database design and optimization |
| 7 | MEMBER | react-native-programmer (custom) | Mobile frontend |
| 8 | MEMBER | figma-designer (custom) | UI/UX design |
| 9 | MEMBER | ai-ocr-expert (custom) | OCR/ML features |
| 10 | MEMBER | ios-debug-expert (custom) | Platform-specific debugging |

**Rationale:** Each title has a unique role-plugin providing specialized skills, guidance, and constraints. A team missing any core title cannot function because no other agent has the skills to fill that gap. The MEMBER title is the only one that supports multiple agents with different specializations, allowing teams to scale horizontally for implementation capacity.

---

## R13. Role Boundaries (No Overstepping)

| ID | Rule | Source |
|----|------|--------|
| R13.1 | Each title agent **MUST operate strictly within its role-plugin's scope**. No agent may perform tasks assigned to another title's role-plugin | Explicit |
| R13.2 | **MANAGER** manages governance, approves operations, routes work. Does NOT write code, design architecture, or coordinate tasks | Explicit |
| R13.3 | **CHIEF-OF-STAFF** manages team staffing, agent lifecycle, external comms. Does NOT design, implement, or integrate | Explicit |
| R13.4 | **ARCHITECT** designs system architecture, data models, APIs. Does NOT implement code, manage agents, or run CI/CD | Explicit |
| R13.5 | **ORCHESTRATOR** coordinates tasks, manages kanban, distributes work. Does NOT design architecture or write code | Explicit |
| R13.6 | **INTEGRATOR** handles code review, quality gates, CI/CD, merging. Does NOT design architecture or write features | Explicit |
| R13.7 | **MEMBER** (programmer) implements features, fixes bugs, writes tests. Does NOT design architecture, manage agents, or run CI/CD pipelines | Explicit |
| R13.8 | An agent that **detects it is being asked to overstep** its role MUST refuse and route the request to the correct title via AMP messaging through the ORCHESTRATOR or COS | Explicit |
| R13.9 | The role-plugin provides the **skills, guidance, and constraints** for its title. An agent without its role-plugin installed CANNOT perform that role's functions | Explicit |

**Rationale:** Role separation ensures quality — each title agent has specialized skills and constraints. Overstepping produces inferior work because the agent lacks the specialized guidance, and creates confusion in the governance chain.

---

## R14. Team Resilience (Auto-Recovery)

| ID | Rule | Source |
|----|------|--------|
| R14.1 | If any of the 5 required title agents (COS, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER) is **accidentally deleted**, the CHIEF-OF-STAFF must **immediately recreate** the missing agent | Explicit |
| R14.2 | Without all 5 basic title agents, the team is **NON-FUNCTIONAL** — no work can proceed until the missing agent is recreated | Explicit |
| R14.3 | The COS must check team composition **at startup** (when woken) and after any agent deletion event | Explicit |
| R14.4 | If the **COS itself is deleted**, the MANAGER must recreate a COS for the team or delete the team | Explicit |
| R14.5 | The recreated agent must be assigned the **same title and default role-plugin** as the deleted one | Explicit |
| R14.6 | The COS **logs the incident** (deleted agent name, title, timestamp, recreation details) in the team's record-keeping files | Explicit |

**Rationale:** Agent deletion can happen by accident (UI misclick, cleanup scripts, bugs). The team must self-heal to remain functional.

---

## R15. Written Orders & GitHub Trail

| ID | Rule | Source |
|----|------|--------|
| R15.1 | Every command from one agent to another **MUST be accompanied by a written .md file** using a template from the sender's role-plugin | Explicit |
| R15.2 | Every report back from an agent **MUST be a written .md file** using a template from the reporter's role-plugin | Explicit |
| R15.3 | Attachments (design docs, code reviews, task specs, reports) **MUST be published on GitHub** as issue comments or new issues — not sent via AMP messaging | Explicit |
| R15.4 | AMP messages carry **only the GitHub issue/comment URL** pointing to the attachment — never the file content itself | Explicit |
| R15.5 | The GitHub issue trail serves as the **permanent audit log** of all orders, decisions, and deliverables | Explicit |
| R15.6 | The **MANAGER is the only agent exempt** from R15.1-R15.4 — the MANAGER may send direct instructions via AMP without GitHub issues | Explicit |
| R15.7 | Each role-plugin **MUST include message templates** in its `shared/` or `references/` directory for: work requests, status reports, approval requests, handoff documents | Explicit |

**Rationale:** AMP messaging has size limits and no persistent storage. GitHub issues provide permanent, searchable, linkable records. This creates a complete paper trail of all governance actions and prevents information loss when agent conversations are compacted or sessions end.

---

## R16. Password Never Shared with Agents (CRITICAL)

| ID | Rule | Source |
|----|------|--------|
| R16.1 | The governance password **MUST NEVER be given to any agent** in a task instruction, prompt, or AMP message | Explicit |
| R16.2 | Agents MUST NEVER use the user's governance password or session cookies. The server MUST reject any API request where an agent process attempts to authenticate using user credentials. Agent authentication is exclusively via AID session secrets (`$AID_AUTH` / `mst_*` tokens) | Explicit |
| R16.3 | When an agent needs to perform a password-protected operation (team creation, title change), the API call triggers a **UI popup** that the **user enters manually** | Explicit |
| R16.4 | The MANAGER agent requests the operation via API. If the API requires a password, the MANAGER must inform the user: "This operation requires your governance password. Please enter it in the UI popup." | Explicit |
| R16.5 | The user **physically types** the password in the browser dialog — the agent never sees, stores, or transmits the password | Explicit |
| R16.6 | Any agent that receives a governance password in its prompt MUST refuse to use it and ask the user to enter it via the UI instead | Explicit |
| R16.7 | Scenario tests are the **only exception** — test automation may pass the password via API for testing purposes. This exception does not apply to production agent workflows. | Explicit |

**Rationale:** The governance password exists specifically to prevent agents from performing dangerous operations without user approval. If agents can receive and use the password, the security boundary is meaningless — any compromised or misbehaving agent could create teams, change titles, or delete agents without user knowledge. The password must always require a human in the loop.

**Implementation:** When an agent's API call returns HTTP 403 with `"Governance password required"`, the AI Maestro dashboard should intercept this and show a password entry popup to the user. The user enters the password, which is sent to complete the operation. The agent never sees the password.

---

## R17. Mandatory Core Plugin Installation (CRITICAL)

| ID | Rule | Source |
|----|------|--------|
| R17.1 | Every agent registered in an AI Maestro host **MUST** have the `ai-maestro-plugin` installed with `--scope local` in its working directory. This is a non-negotiable prerequisite for the agent to participate in the AI Maestro ecosystem | Explicit |
| R17.2 | The installation command is: `claude plugin install ai-maestro-plugin@ai-maestro-plugins --scope local` executed from inside the agent's working directory (`~/agents/<name>/`) | Explicit |
| R17.3 | This installation **MUST** happen at agent registration time — whether the agent is created via the Agent Creation Wizard, imported from an existing tmux session, or created programmatically by the MANAGER or any other agent | Explicit |
| R17.4 | The `ai-maestro-plugin` provides the foundational skills (agent-messaging, agent-identity, team-governance, team-kanban, etc.), AMP slash commands, and hooks (session tracking, message notifications) that every agent needs to operate within AI Maestro | Explicit |
| R17.5 | An agent **without** the `ai-maestro-plugin` installed locally is **non-functional** within the AI Maestro ecosystem — it cannot receive messages, participate in governance, use AMP commands, or receive session notifications | Explicit |
| R17.6 | The `CreateAgent` pipeline (element-management-service) **MUST** include a gate that installs `ai-maestro-plugin@ai-maestro-plugins --scope local` in the agent's working directory as part of agent provisioning | Explicit |
| R17.7 | The `RegisterAgentFromSession` flow (importing existing tmux sessions) **MUST** install the plugin with local scope before the agent is considered fully registered | Explicit |
| R17.8 | The `--scope local` flag is mandatory because the plugin must be installed in the agent's own project directory (`settings.local.json`), not in the user's global settings. Each agent is an independent Claude Code instance with its own local configuration | Explicit |
| R17.9 | If the plugin installation fails (marketplace not registered, network error, plugin not found), the agent registration **MUST** still succeed but the agent **MUST** be flagged with `corePluginMissing: true` in the registry. The dashboard MUST show a warning badge on such agents | Explicit |
| R17.10 | The MANAGER and CHIEF-OF-STAFF **SHOULD** periodically verify that all agents in their scope have the core plugin installed. If an agent is missing it, the COS or MANAGER should trigger a reinstallation | Explicit |
| R17.11 | For **non-Claude clients** (Codex, OpenCode, Gemini, Kiro, etc.), the `ai-maestro-plugin` **MUST** be converted to the target client's native format before installation. The conversion uses AI Maestro's cross-client conversion pipeline: (1) generate the Universal Plugin IR from the Claude source plugin, (2) emit the client-specific plugin via the appropriate client adapter. The converted plugin is stored in `~/agents/custom-plugins/<client>/ai-maestro-plugin-<client>/` and registered in the `ai-maestro-local-custom-marketplace` | Explicit |
| R17.12 | The `CreateAgent` and `RegisterAgentFromSession` pipelines **MUST** detect the agent's client type (from `compatible-clients` in `.agent.toml` or the agent registry) and automatically perform the conversion if the client is not `claude-code`. The agent receives the converted plugin, not the Claude original | Explicit |
| R17.13 | The converted plugin **MUST** preserve all skills, commands, hooks, and AMP functionality that the target client supports. Features that cannot be mapped (e.g., Claude-specific hook events with no Codex equivalent) are documented in the conversion loss report but do not block the installation | Explicit |

### R17.B — Core Plugin Protection (Cannot Be Removed or Disabled)

| ID | Rule | Source |
|----|------|--------|
| R17.14 | The `ai-maestro-plugin` **CANNOT be uninstalled** from any agent, neither via the AI Maestro UI nor via the AI Maestro API. The `ChangePlugin` pipeline MUST reject uninstall requests for this plugin with an error citing R17 | Explicit |
| R17.15 | The `ai-maestro-plugin` **CANNOT be disabled** from any agent, neither via the AI Maestro UI nor via the AI Maestro API. The `ChangePlugin` / `InstallElement` pipeline MUST reject disable requests for this plugin. Re-enablement happens only inside an AIO pipeline (Wake R17 gate, InstallElement) — never from a background loop | Explicit |
| R17.16 | The dashboard UI **MUST NOT show an uninstall button** (X icon) on the `ai-maestro-plugin` in the Config tab's Plugins section. Instead, it MUST show a **"core"** label indicating the plugin is a protected system component | Explicit |
| R17.17 | The `ai-maestro-plugin` **MUST NOT be installed at user scope** (`--scope user`). It MUST only exist at local scope in each agent's working directory. If the AI Maestro server detects the plugin enabled at user scope (`~/.claude/settings.local.json`), it MUST disable it at user scope on startup. User-scope installation would make the plugin load in ALL Claude Code projects on the host, not just AI Maestro agents | Explicit |
| R17.18 | **The AI Maestro server MUST NOT run a startup audit or a periodic enforcement loop that mutates agent state.** Core-plugin compliance is the sole responsibility of the **AIO Change\* pipelines** — `InstallElement`, `CreateAgent`, `wakeAgent`, `createSession`, `ChangeTitle`, `ChangeClient`, etc. Every such pipeline ends with post-gates (PG01/PG02/PG05) that guarantee the agent is left in a valid state: `ai-maestro-plugin` installed with `--scope local`, role-plugin matching the agent's title (or none if AUTONOMOUS). A background loop is an anti-pattern: it operates on stale data and fights the AIO contract. If an agent is ever found in an invalid state, the defect is in the pipeline that mutated it last — fix the pipeline, never add a repair loop | Explicit |
| R17.18a | **The AI Maestro server MUST NOT auto-register tmux sessions** it discovers during `/api/sessions` or `/api/agents` polling. Unknown sessions (tmux session names not matching any entry in `~/.aimaestro/agents/registry.json`) are surfaced ONLY as read-only `unregisteredSessions` in the sidebar's "Dead Sessions" list, enriched via `lib/session-history.ts` for display. No agent record is created, no plugin is installed, no AMP identity is provisioned, no tmux environment is mutated — until the user **explicitly** clicks "Revive" or "Import", which then invokes the normal `CreateAgent` AIO pipeline. This applies to both standard tmux sockets and OpenClaw sockets | Explicit |

### R17.C — Core Plugin Auto-Update

| ID | Rule | Source |
|----|------|--------|
| R17.19 | When AI Maestro is updated (version bump via `bump-version.sh`), the update script **MUST** also update the `ai-maestro-plugin` from the `Emasoft/ai-maestro-plugins` marketplace. If the marketplace is not registered, the script MUST register it first | Explicit |
| R17.20 | The AI Maestro server **MUST ensure** that the `Emasoft/ai-maestro-plugins` marketplace is registered on every startup. If it was removed or never installed, the server re-registers it automatically | Explicit |
| R17.21 | The `wakeAgent` function **MUST check** for core plugin presence before launching the program. If missing, it attempts installation via `InstallElement` AIO. If the installation fails, `wakeAgent` **MUST reject the wake** with an error citing R17 — a titled agent without its core plugin is non-functional (no hooks, no state detection, no messaging, cannot be stopped/hibernated safely) and must never be launched. The legacy `corePluginMissing: true` flag remains only as a diagnostic marker, cleared by the next successful `InstallElement` | Explicit |

### R17.D — Directory Trust Auto-Accept

| ID | Rule | Source |
|----|------|--------|
| R17.22 | When Claude Code starts in a new agent directory for the first time, it shows a directory trust prompt ("Do you trust the files in this folder?"). The AI Maestro server **MUST automatically accept** this prompt by sending `Enter` to the tmux session (the "Yes, I trust this folder" option is pre-selected). This runs in the background after program launch, polling the pane for up to 8 seconds | Explicit |
| R17.23 | The trust auto-accept **MUST NOT block** the wake API response. It runs asynchronously after the tmux session and program are launched | Explicit |

**Rationale — Why This Is a Governance Rule, Not Just a Requirement:**

The `ai-maestro-plugin` is the **load-bearing infrastructure** of the entire AI Maestro system. Its hooks are the ONLY mechanism through which the server detects agent state transitions (active, idle, waiting for input, permission prompt, exited). Without these hooks, the following **cascading failure** occurs:

1. **Agent state detection fails** — the server cannot tell if an agent is active, idle, waiting for user input, or has exited the client. The 5-state activity model (Exited, Permission, Waiting, Active, Idle) goes completely dark.
2. **Session control commands fail** — without knowing agent state, the server cannot determine when it is safe to send `/exit`, restart commands, or approve permission prompts. The Stop, Restart, and Approve buttons become non-functional.
3. **Plugin and title changes fail** — changing a governance title or role-plugin requires restarting Claude Code (exit + relaunch) so the new plugin is loaded. If the restart command fails (because state detection is broken), the ChangeTitle and ChangePlugin pipelines stall permanently.
4. **Team operations fail** — since ChangeTitle is broken, agents cannot be assigned to teams, COS cannot be appointed, and the minimum team composition (R12) cannot be enforced.
5. **AMP messaging fails** — the plugin provides the session tracking hook that enables push notifications and the message notification banner. Without it, agents cannot receive messages, and the entire inter-agent communication system is down.
6. **Auto-continue fails** — the keep-alive mechanism that prevents idle agents from timing out depends on detecting the idle state via hooks.
7. **Governance becomes unenforceable** — the governance skills (team-governance, agent-messaging, agent-identity) that agents use to understand and follow governance rules are bundled in this plugin. Without them, agents have no knowledge of R1–R16.

In short: removing the `ai-maestro-plugin` from a single agent doesn't just break that agent — it breaks every operation that touches that agent, and since governance operations (title changes, team membership, transfers) are transitive, a single broken agent can stall operations across the entire host.

This is why R17 is a **governance rule with system-wide enforcement**, not a soft recommendation. The server MUST proactively detect and repair violations (re-enable disabled plugins, reinstall missing plugins, flag non-compliant agents) rather than waiting for the user to notice and fix them manually.

**Implementation:**

```bash
# Claude Code agents — direct install:
cd ~/agents/<agent-name>/
claude plugin install ai-maestro-plugin@ai-maestro-plugins --scope local

# Non-Claude agents (e.g., Codex) — convert first, then install:
# 1. The CreateAgent pipeline calls convertAndStorePlugin() with source=ai-maestro-plugin
# 2. This generates ~/agents/custom-plugins/codex/ai-maestro-plugin-codex/
# 3. The converted plugin is installed in the agent's working directory
```

This writes the plugin reference to `~/agents/<agent-name>/.claude/settings.local.json` (or the equivalent config file for the target client) under `enabledPlugins`, ensuring the agent loads it on every session start.

---

## R18. Plugin Continuity on Client Change (CRITICAL)

| ID | Rule | Source |
|----|------|--------|
| R18.1 | When an agent's AI client changes (via `ChangeClient`), the agent **MUST NEVER** be left without its previously installed plugins. Every plugin that was installed for the old client **MUST** be re-emitted in a format compatible with the new client | Explicit |
| R18.2 | The `ChangeClient` pipeline **MUST** enumerate all plugins currently installed in the agent's working directory (role-plugin + normal plugins, enabled and disabled) BEFORE uninstalling anything. This snapshot is the set of plugins that MUST be preserved | Explicit |
| R18.3 | For each plugin in the snapshot, `ChangeClient` **MUST** ensure a version compatible with the new client exists, using the following resolution order: **(a)** if a native version already exists in `~/agents/custom-plugins/<new-client>/<name>/` or the client's cache, use it; **(b)** else if a Universal Plugin IR exists in `~/agents/custom-plugins/.abstract/<name>/`, call `emitForClient(name, newClient)` to generate the new-client version from the IR; **(c)** else call `convertAndStorePlugin(name, oldClient, [newClient])` which parses the existing plugin, builds the Universal IR automatically, and then emits for the new client | Explicit |
| R18.3b | **Asymmetric conversion rule (CRITICAL):** Claude is the richest plugin format. Any conversion X→Claude is lossy (features not expressible in the reduced source format cannot be invented). When the target client is `claude`, `ChangeClient` **MUST** use the canonical Claude source (checked first in `~/.claude/plugins/cache/<marketplace>/<name>/<version>/`, then in `~/agents/role-plugins/<name>/` for role-plugins). If no canonical Claude source exists, `ChangeClient` **MUST refuse to perform a lossy X→Claude conversion** and abort with a clear error instructing the user to restore the Claude plugin cache | Explicit |
| R18.3c | **R18.3b implies:** a Universal IR built from a non-Claude source (e.g., from a prior Claude→Codex conversion) **MUST NOT** be reverse-emitted to Claude — doing so would silently lose features that the original Claude plugin had. The only legitimate path back to Claude is the canonical cache or a fresh install from the marketplace | Explicit |
| R18.3d | **General "prefer native" rule (CRITICAL):** `ChangeClient` **MUST NEVER** convert or emit a plugin if a native version already exists for the target client. The resolution order is strict: **(1)** client-native plugin cache (`~/.claude/plugins/cache/`, `~/.codex/plugins/cache/`, `~/.gemini/plugins/`, `~/.opencode/plugins/`, `~/.kiro/plugins/`), **(2)** local role-plugins marketplace (`~/agents/role-plugins/<name>/`) if the plugin's `.agent.toml` `compatible-clients` field includes the target client, **(3)** previously emitted custom-plugins (`~/agents/custom-plugins/<client>/<name>/` or `<name>-<client>/`), **(4)** emit from existing Universal IR only if no native version was found, **(5)** fresh conversion as absolute last resort. Skipping a native source in favor of conversion would silently degrade the plugin (conversion is lossy in every direction except claude→claude). Native sources — from GitHub marketplaces, from Haephestos-generated role-plugins, or from user installs — are always authoritative and must be used as-is | Explicit |
| R18.4 | Only AFTER all compatible versions are confirmed to exist may `ChangeClient` uninstall the old-client versions and install the new-client versions. If ANY plugin fails to convert, the entire `ChangeClient` operation **MUST abort** before touching the agent directory — no partial state is allowed | Explicit |
| R18.5 | The `ai-maestro-plugin` core plugin is subject to R18 in addition to R17: when the client changes, its converted version for the new client **MUST** be installed using the same conversion pipeline. R17's core plugin requirement is satisfied by the converted version | Explicit |
| R18.6 | Role-plugins (plugins with a quad-match `.agent.toml`) follow the same conversion pipeline as normal plugins, but the converted output preserves the original plugin name (no `-<client>` suffix) and is stored in `~/agents/role-plugins/<name>/`. The `.agent.toml`'s `compatible-clients` field is updated to include the new client | Explicit |
| R18.7 | The `ChangeClient` pipeline **MUST** set `restartNeeded = true` on success, because the client binary (claude / codex / gemini / etc.) must be relaunched for the new-client plugins to be loaded | Explicit |
| R18.8 | If a feature of the old plugin cannot be mapped to the new client (e.g., a Claude-specific hook event with no Codex equivalent), the conversion emits a loss report but the operation **MUST** still proceed. A plugin with reduced features is acceptable — an agent with no plugins is not | Explicit |
| R18.9 | The `ChangeClient` pipeline **MUST NOT** uninstall the role-plugin by calling `syncRolePlugin`, because `syncRolePlugin` uses the title-to-plugin map which assumes Claude. Instead, `ChangeClient` handles the role-plugin conversion explicitly as part of R18.3 | Explicit |
| R18.10 | After `ChangeClient` completes successfully, the agent's governance title (if any) **MUST NOT** change. The title → role-plugin binding (R11) remains satisfied by the converted role-plugin | Explicit |

**Rationale — Why This Is a Governance Rule:**

An agent's identity and capabilities are inseparable from its installed plugins. The governance title binding (R11), the mandatory core plugin (R17), and every skill or hook the agent relies on are all expressed through plugins. If `ChangeClient` removed plugins without re-installing them in the new client's format, the agent would lose its role (ARCHITECT becomes a plain shell), its governance capabilities (no team messaging, no title badge), and the core infrastructure (R17.5: "non-functional within the AI Maestro ecosystem"). This would violate the Title-plugin invariant, the Core-plugin-presence invariant, and — for titled agents — leave the team with a broken slot that the COS would have to recreate from scratch via R14.

The conversion infrastructure already exists (`convertAndStorePlugin`, `emitForClient`, the Universal Plugin IR pipeline, per-client adapters). R18 makes its use on client change **mandatory**, not optional.

---

## R19. MAINTAINER Title

| ID | Rule | Source |
|----|------|--------|
| R19.1 | MAINTAINER is a no-team governance title assigned to agents responsible for maintaining an external software project (typically a GitHub repository). Like AUTONOMOUS, a MAINTAINER is NOT a member of any team — it operates independently at the host level | Explicit |
| R19.2 | Every MAINTAINER agent MUST have a non-empty `githubRepo` attribute in the form `owner/repo`. The attribute is **immutable** once set — to change the repo, assign the MAINTAINER title to a different agent | Explicit |
| R19.3 | One MAINTAINER per repository on a given host. Assigning MAINTAINER to an agent when another active (non-deleted) MAINTAINER already owns the same `githubRepo` MUST be rejected with a uniqueness error | Explicit |
| R19.4 | A MAINTAINER's core workflow is: (a) poll GitHub issues every 5 minutes via `gh issue list`, (b) detect new unprocessed issues by diffing against a local ledger, (c) triage each new issue (bugs auto-triage; feature requests accepted only from the authorized `gh` user), (d) if valid, clone the repo, create a branch, edit files, run tests, commit, (e) bump the version and push to origin via `scripts/publish.py` | Explicit |
| R19.5 | The MAINTAINER uses the host's `gh` CLI authentication. No separate webhook secrets or listener ports are needed. The agent polls `gh issue list --repo <owner/repo> --state open --json number,title,author,labels,createdAt` and compares against `~/.aimaestro/maintainer/<agentId>/processed-issues.json` to detect new issues | Explicit |
| R19.6 | Feature requests and change proposals MUST only be accepted if the GitHub issue author matches the locally authenticated `gh` user (determined at runtime via `gh api user --jq .login`). Bug reports from any user are triaged normally. This prevents unauthorized users from directing the MAINTAINER to make arbitrary changes | Explicit |
| R19.7 | A MAINTAINER must NOT run destructive git operations on the repository beyond what the publish pipeline authorizes: force-push, history rewrite, tag deletion, branch deletion. All destructive operations require explicit MANAGER approval via an `approval-request` AMP message | Explicit |
| R19.8 | Before publishing any fix, a MAINTAINER MUST: (1) confirm the test suite passes, (2) confirm a version bump is actually required (not a doc-only change), (3) confirm R18 plugin continuity is satisfied for any bundled plugins in the target repo, (4) honor the repo's `pre-push` git hook if one exists | Explicit |
| R19.9 | MAINTAINERs can message: MANAGER, COS, AUTONOMOUS, other MAINTAINERs. They can be messaged by: MANAGER, COS, AUTONOMOUS, other MAINTAINERs, and the user. Team workers (architect/integrator/member/orchestrator) cannot contact MAINTAINERs directly — route through COS or MANAGER | Explicit |
| R19.10 | The MAINTAINER title is bound to the `ai-maestro-maintainer-agent` role-plugin (R11 binding). Per R17, the `ai-maestro-plugin` core plugin is also required | Explicit |
| R19.11 | A MAINTAINER agent can be hibernated safely — polling stops while hibernated, and unprocessed issues will be picked up on the next patrol cycle when woken. The processed-issues ledger persists across hibernation cycles | Explicit |

---

## R20. Marketplace Governance

These rules describe how AI Maestro organizes plugin marketplaces and their
contents. The key architectural distinction is between **containers** and
**marketplaces**:

- A **container** is a folder grouping multiple related marketplaces plus the
  shared universal IR hub (`.abstract/`). The two default containers are
  `~/agents/role-plugins/` and `~/agents/custom-plugins/`.
- A **marketplace** is a folder that follows a specific client's marketplace
  spec (manifest schema, source-path format, etc.) and is registered with
  that client's CLI. One container MAY hold many marketplaces — one per
  client format (Claude, Codex, OpenRouter, Gemini, …). Each is named
  `marketplace-<client>/` inside its container.

Each client's marketplace has its OWN manifest schema per that client's spec:

- **Claude Code** — manifest at `<marketplace>/.claude-plugin/marketplace.json`;
  `source` is a string like `"./my-plugin"`; registered via
  `claude plugin marketplace add <dir>`.
- **Codex** — manifest at `<marketplace>/marketplace.json` (root, no
  `.claude-plugin/` wrapper); `source` is an object
  `{ "source": "local", "path": "./my-plugin" }` plus required
  `policy.installation` + `policy.authentication` + `category` + `interface`
  fields. Registered via the Codex equivalent of Claude's `marketplace add`.

AI Maestro shells out to each client's CLI for install/uninstall/enable/disable
rather than re-implementing these operations.

| ID | Rule | Source |
|----|------|--------|
| R20.1 | AI Maestro ships with one online marketplace (**DEFAULT PLUGINS**: `github:Emasoft/ai-maestro-plugins`) and two offline **containers** for converted and custom plugins: (a) **ROLE PLUGINS CONTAINER** at `~/agents/role-plugins/`; (b) **CUSTOM PLUGINS CONTAINER** at `~/agents/custom-plugins/`. Each container holds one marketplace subfolder per client format AND the shared `.abstract/` universal IR hub (R20.8-R20.9). **Naming convention (R20.3 v3.7.0):** Claude marketplaces have no client prefix: `custom-marketplace/`, `roles-marketplace/`. All other clients use `<client>-custom-marketplace/`, `<client>-roles-marketplace/`. Claude plugin names have no suffix; non-Claude plugins are suffixed: `<name>-<client>`. Each per-client marketplace is registered separately with its own client CLI. | Explicit |
| R20.2 | Every agent MUST have the **CORE PLUGIN** — `ai-maestro-plugin@ai-maestro-plugins` — installed at `--scope local` (or the per-client equivalent) in its working directory. This mirrors R17 and is the core-plugin-presence invariant. | Explicit |
| R20.3 | On every UI interaction and every agent-initiated API call, the server MUST verify R20.2 is respected. Agents missing the core plugin MUST be forced to hibernate until they comply. This mirrors the enforcement loop described in R17 / core-plugin-presence invariant. | Explicit |
| R20.4 | Each agent MUST have installed at `--scope local` the default role-plugin for its governance title, OR any role-plugin whose `compatible-titles` (in its `.agent.toml`) includes that title. Defaults: **AUTONOMOUS** → `ai-maestro-autonomous-agent@ai-maestro-plugins` (or any other plugin declaring `compatible-titles=["AUTONOMOUS"]`); **MANAGER** → `ai-maestro-assistant-manager-agent@ai-maestro-plugins`; **MAINTAINER** → `ai-maestro-maintainer-agent@ai-maestro-plugins`; **CHIEF-OF-STAFF** → `ai-maestro-chief-of-staff@ai-maestro-plugins`; **ORCHESTRATOR** → `ai-maestro-orchestrator-agent@ai-maestro-plugins`; **ARCHITECT** → `ai-maestro-architect-agent@ai-maestro-plugins`; **INTEGRATOR** → `ai-maestro-integrator-agent@ai-maestro-plugins`; **MEMBER** → `ai-maestro-programmer-agent@ai-maestro-plugins`. **AUTONOMOUS is no longer "(none)"** — per R9.13 and R11.12 every agent MUST carry a role-plugin, and `ai-maestro-autonomous-agent` is the mandatory default that encodes workspace-isolation and cross-agent-mutation restrictions in its persona. | Explicit |
| R20.5 | The default role-plugin for a title MUST be installed automatically when the title is granted to an agent, unless the user (or a privileged caller) explicitly picks a different compatible role-plugin at assignment time. See ChangeTitle Gate 15. | Explicit |
| R20.6 | Agents whose client differs from Claude MUST have the converted version of the default role-plugin for their title installed automatically from the `marketplace-<client>/` folder of the appropriate container. If a native version exists in any registered marketplace (priority: client-native plugin cache → `marketplace-<client>/` inside the role-plugins container → `marketplace-<client>/` inside the custom-plugins container), it MUST be preferred over re-conversion. | Explicit |
| R20.7 | Agents changing their client (`ChangeClient`) MUST have every currently-installed plugin re-emitted into the target client's format and installed from the target container's `marketplace-<client>/` folder — unless a compatible native version for the new client already exists in any registered marketplace, in which case the native version MUST be used. See R18 for the full plugin-continuity pipeline. | Explicit |
| R20.8 | The **universal intermediate representation** of a converted *ordinary* plugin MUST be stored at `~/agents/custom-plugins/.abstract/<plugin-name>/plugin-universal-ir.yaml`. This is the IR hub used by `emitForClient` to re-emit the plugin for any target client without going back to the original source. `.abstract/` lives at the CONTAINER level, shared across every `marketplace-<client>/` folder inside that container. | Explicit |
| R20.9 | The **universal intermediate representation** of a converted *role-plugin* MUST be stored at `~/agents/role-plugins/.abstract/<plugin-name>/plugin-universal-ir.yaml`, paralleling R20.8 but isolated so role-plugin IR never bleeds into the ordinary-plugin namespace. Same container-level shared-hub semantics. | Explicit |
| R20.10 | AI Maestro MUST detect any update to the CORE plugin and apply it immediately with the exact command `claude plugin update ai-maestro-plugin@ai-maestro-plugins` (for Claude clients). For agents on other clients, the server MUST re-convert the new Claude version into every target client format and re-install it at `--scope local` in each affected agent's working directory, updating the corresponding `marketplace-<client>/` entry in the custom-plugins container. This enforces the **core-plugin-currency invariant**. | Explicit |
| R20.11 | AI Maestro MUST check for updates on every non-core plugin from the DEFAULT marketplace AND from every `marketplace-<client>/` inside the role-plugins and custom-plugins containers. When any marketplace reports a newer version, the server MUST notify the affected agents (via AMP or UI badge) and expose an idempotent API command that the agent (or user) can invoke to update the plugin. | Explicit |
| R20.12 | Plugins emitted from the universal IR as conversions of an original plugin MUST detect when the original plugin is updated and re-emit the converted version into every `marketplace-<client>/` that currently contains an emitted copy, bumping the version number. The re-emitted plugin MUST be registered in each target marketplace manifest (using that client's schema) so that R20.11 picks up the update and propagates it to the agents that have it installed. | Explicit |
| R20.13 | Agent names and agent UUIDs MUST be unique host-wide. Name collisions MUST be resolved at creation time (wizard rejects; API returns 409). Cross-host uniqueness is handled by agent-host address format (`<name>@<host>`). | Explicit |
| R20.14 | Each AI Maestro host MUST maintain a registry of agent identities and UUIDs that any other AI Maestro host on the Tailscale mesh can consult freely (read-only). This supports cross-host AMP routing and mesh-level identity lookups without any secret exposure. | Explicit |
| R20.15 | To exercise any privileged action that its title allows, an agent MUST prove its identity with an AID-signed token (see R14, AID identity rules) and present it to the AI Maestro API it wants to call. The server rejects any privileged call lacking a valid AID token — the token type (Bearer `aim_tk_*`, session secret `mst_*`, or AMP key `amp_live_sk_*`) determines the auth path but identity verification is non-negotiable. | Explicit |
| R20.16 | The identity authority for a given agent is either an AMP third-party provider OR the AI Maestro server that spawned the agent session. Agents registered against a local AI Maestro host get their identity certified by that host; agents federated from external providers get their identity certified by the remote provider. See the AMP messaging rules for the full delegation chain. | Explicit |
| R20.17 | Role-plugins MUST be identified by their profile file `<plugin-name>.agent.toml` at the plugin root AND by passing the **fourfold-identity validation check**: (1) `plugin.json` (or the per-client equivalent) `name` equals the plugin folder name; (2) the folder contains `<name>.agent.toml`; (3) `[agent].name` inside the TOML equals `<name>`; (4) `agents/<name>-main-agent.md` (or the per-client equivalent) exists with frontmatter `name: <name>-main-agent`. The per-client "equivalent files" are defined in each client's marketplace spec (e.g. Codex uses `.codex-plugin/plugin.toml` instead of `.claude-plugin/plugin.json`, and agents/main-agent markdown is normalized by the converter). Files failing any of these four checks are NOT role-plugins and MUST NOT be treated as such by any Change* pipeline. | Explicit |
| R20.18 | Every per-client marketplace MUST conform to its client's published marketplace spec — the AI Maestro converter is forbidden from inventing fields or bending a schema. Concretely: (a) **Claude** marketplaces MUST put the manifest at `<marketplace>/.claude-plugin/marketplace.json` and use `source: "./<name>"` as a plain string; (b) **Codex** marketplaces MUST put the manifest at `<marketplace>/marketplace.json` (root, no subfolder) and use `source: { "source": "local", "path": "./<name>" }` as an object plus the mandatory `policy`, `category`, and top-level `interface` fields from the Codex spec; (c) Every relative `source.path` or `source` string MUST start with `./` and MUST resolve to a plugin folder located inside the same `marketplace-<client>/` root — no `../` traversal, no absolute paths, no cross-client path leakage. When a new client (OpenRouter, Gemini, Kiro, …) publishes its marketplace spec, the generator MUST be extended with a dedicated emitter for that schema rather than reusing an existing client's code. | Explicit |
| R20.19 | An agent MAY have additional optional plugins installed at `--scope local` beyond the required CORE (R20.2) and TITLE role-plugin (R20.4), selected from any registered marketplace via the Agent Profile → Config → Marketplaces view. Optional plugins are NOT subject to the auto-reinstall enforcement loop of R20.3 — only CORE and TITLE role-plugin are mandatory. | Explicit |
| R20.20 | Scope isolation: plugins installed at `--scope user` via Settings → Plugins Explorer MUST NOT appear in any agent's local plugin list, and plugins installed at `--scope local` via Agent Profile → Config MUST NOT appear in the user-scope listing. Enable/disable state is per-scope and completely independent. SCEN-021 verifies this invariant end-to-end. | Explicit |
| R20.21 | The converter + validator pipeline MUST treat per-client marketplace folders (Claude: `custom-marketplace/` / `roles-marketplace/`; others: `<client>-custom-marketplace/` / `<client>-roles-marketplace/`) as independent marketplaces, each registered separately with its target client's CLI. When the server registers or refreshes marketplaces at startup, it MUST iterate over every per-client marketplace folder inside both containers and call the matching client's `<cli> plugin marketplace add|update` — never assume a single container-wide marketplace, and never mix two clients' plugins inside the same marketplace folder. | Explicit |
| R20.22 | The universal IR hubs (`.abstract/` at container level, R20.8 + R20.9) are shared across ALL per-client marketplaces within their container. Re-emitting a plugin for a new client MUST read the IR from the container's `.abstract/<name>/plugin-universal-ir.yaml` and write the emitted plugin into the correct per-client marketplace subfolder of the same container. The IR MUST NOT be duplicated into per-client subdirectories. | Explicit |
| R20.23 | **Multi-client plugin duplication (v3.7.0):** If a role-plugin's `.agent.toml` declares `compatible-clients` with multiple clients, the plugin MUST be stored as a **separate emitted copy** inside EACH compatible client's marketplace directory. Each copy's `.agent.toml` retains the FULL `compatible-clients` list (so any consumer can see what other clients the plugin supports); only the emitted code, manifest format, and folder name differ per client. The shared `.abstract/` IR is the single source of truth; each marketplace copy is an independently emitted artifact. A plugin is NEVER shared by symlink or reference across marketplace directories — each client's CLI must be able to install from its own marketplace without cross-client path resolution. For **custom plugins** (which do NOT have `.agent.toml`), the target client is determined by the name suffix: `<name>-codex` → codex, `<name>-gemini` → gemini, `<name>` (no suffix) → claude. Custom plugins converted for multiple clients are likewise duplicated, one per marketplace. | Explicit |
| R20.24 | **Role-plugin vs custom-plugin distinction (v3.7.0):** The presence of a `<name>.agent.toml` file at the plugin root is the SOLE marker that distinguishes a role-plugin from a custom (ordinary) plugin. Custom plugins MUST NOT contain `.agent.toml` files. The converter MUST only write `.agent.toml` (via `writeConvertedAgentProfile`) for role-plugins, never for custom plugins. Client detection for custom plugins relies on the name suffix convention, not on any TOML field. | Explicit |
| R20.25 | **Core-plugins container (v3.7.0):** A third container at `~/agents/core-plugins/` holds the converted versions of the `ai-maestro-plugin` (the CORE plugin) for non-Claude clients. Structure: `.abstract/ai-maestro-plugin/` (shared IR), `<client>-core-marketplace/ai-maestro-plugin-<client>/` (per-client emitted copy). Claude does NOT have a local core marketplace — it installs the core plugin from the remote `Emasoft/ai-maestro-plugins` marketplace. When the remote core plugin updates, the server MUST re-emit into every `<client>-core-marketplace/` that exists (R20.10 + R20.12). The core-plugins container is registered as `ai-maestro-local-core-marketplace` with Claude CLI. | Explicit |
| R20.26 | **NO-RENAMING-RULE-FOR-PLUGINS (v3.7.0):** Plugin names (both folder name and manifest name) are **immutable** once created. No AI Maestro API, UI action, or script/skill may rename an existing plugin. Names MUST be treated as permanent identifiers. Implications: (a) Name collision checks at creation/import time are mandatory — two plugins with the same name CANNOT exist in the same marketplace. (b) When a converter emits a plugin but a same-named plugin already exists in the target marketplace, it MUST suffix to avoid collision (e.g., append `-2` or the source hash) and emit as a new plugin — never overwrite. (c) Even if a re-conversion produces a duplicate of an already-emitted plugin, this is acceptable: plugins update constantly, and the re-emitted version will likely differ. (d) There is no plugin registry beyond the filesystem itself — "the DB is the filesystem". Plugin dirs and their manifests ARE the registry. No external database, no rename tracking, no deduplication index. Possible duplication is a conscious trade-off for the simplicity and robustness of the file-based architecture. | Explicit |

---

## Invariants (Must Never Be Violated)

These are hard invariants that the system must maintain at all times:

1. **COS-membership invariant**: `team.chiefOfStaffId === agentId` implies `team.agentIds.includes(agentId)`
2. **Singleton-MANAGER invariant**: At most one agent has `managerId === agentId` globally
3. **Single-team invariant**: A non-MANAGER agent appears in `agentIds` of at most one team
4. **Name-uniqueness invariant**: No two teams have the same name (case-insensitive)
5. **COS-immutability invariant**: COS title can only be removed by deleting the team (not by title reassignment)
6. **Manager-team invariant**: Teams cannot exist in an active (non-blocked) state without a MANAGER on the host
7. **Team-agent-lifecycle invariant**: Team agents cannot be woken while teams are blocked (no MANAGER)
8. **Title-plugin invariant**: Every agent (INCLUDING AUTONOMOUS) has exactly one role-plugin installed matching their title. Agents without a role-plugin cannot exist at rest — the only transient "no role-plugin" window is the instant inside a Change* pipeline between uninstall and install, and the agent is never persisted in that state (see R9.13, R11.12)
9. **Minimum-composition invariant**: Every team must have at least 5 agents covering all 5 required titles (COS, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER)
10. **Role-boundary invariant**: No agent may perform tasks outside its title's role-plugin scope
11. **Team-resilience invariant**: Deleted core title agents must be immediately recreated by COS (or MANAGER for COS)
12. **Written-orders invariant**: All inter-agent commands and reports must be written .md files with GitHub issue attachments (MANAGER exempt)
13. **Password-secrecy invariant**: The governance password must never be transmitted to, stored by, or used by any agent — only the human user may enter it
14. **Core-plugin-presence invariant**: Every agent registered in the AI Maestro host must have `ai-maestro-plugin@ai-maestro-plugins` installed with `--scope local` in its working directory
15. **Core-plugin-protection invariant**: The `ai-maestro-plugin` cannot be uninstalled, disabled, or moved to user scope on any agent — it is a permanent, enabled, local-scope fixture
16. **Core-plugin-currency invariant**: The `ai-maestro-plugin` must be updated from the marketplace whenever AI Maestro itself is updated
17. **Plugin-continuity invariant**: When an agent's client changes, every plugin that was installed for the old client must be re-emitted and re-installed in a format compatible with the new client — no agent may ever be left without its plugins as a side effect of `ChangeClient`
18. **MAINTAINER-repo-uniqueness invariant**: At any time, at most one active (non-deleted) agent has a given `githubRepo` value. Two MAINTAINERs cannot maintain the same repository on the same host
19. **Marketplace-source-path invariant** (R20.18): every `source` field in a per-client marketplace manifest starts with `./`, resolves to an existing folder inside the same `marketplace-<client>/` root, and conforms to that client's marketplace spec (Claude string `"./x"` vs Codex object `{source:"local", path:"./x"}`)
20. **IR-storage-location invariant** (R20.8 + R20.9 + R20.22): converted-plugin universal IR lives at the CONTAINER level — `~/agents/custom-plugins/.abstract/<name>/` for ordinary plugins and `~/agents/role-plugins/.abstract/<name>/` for role-plugins — NEVER inside any `marketplace-<client>/` subfolder and NEVER duplicated per client
21. **Scope-isolation invariant** (R20.20): user-scope and local-scope plugin lists are disjoint — no plugin install at one scope ever appears in the listing or affects the enable-state of the other scope
22. **Container-marketplace separation invariant** (R20.1 + R20.21): `~/agents/role-plugins/` and `~/agents/custom-plugins/` are CONTAINERS, not marketplaces. A container holds zero or more `marketplace-<client>/` subfolders plus the shared `.abstract/` IR hub. The container folder itself is NEVER registered with any client CLI as a marketplace — only the individual `marketplace-<client>/` subfolders are

---

## Role-Based Permission Matrix

| Action | MEMBER | COS (own team) | ORCHESTRATOR | ARCHITECT / INTEGRATOR | MANAGER | AUTONOMOUS |
|--------|--------|----------------|--------------|----------------------|---------|------------|
| Join team | Via MANAGER/COS | Via MANAGER | Via MANAGER/COS | Via MANAGER/COS | N/A (host-level) | Via MANAGER/COS |
| Leave team | No (transfer) | No (COS locked) | No (transfer) | No (transfer) | N/A | No (transfer) |
| Add agent to own team | No | Yes | No | No | Yes | No |
| Remove agent from own team | No | Yes | No | No | Yes | No |
| Assign COS | No | No | No | No | Yes (password) | No |
| Create team | No | No | No | No | Yes (password) | No |
| Delete team | No | No | No | No | Yes (password) | No |
| Create transfer request | No | Yes (own team) | No | No | Yes | No |
| Approve/reject transfer | No | Yes (own team) | No | No | Yes | No |
| Wake agent | No | Own team only | No | No | Any agent | No |
| Hibernate agent | No | Own team only | No | No | Any agent | No |
| Message (see R6 graph) | COS + ORCH | All titles | COS+ARCH+INTEG+MEM | COS + ORCH | All titles | MGR+COS+AUTO |
