---
spec: governance
spec-version: 2.4.3
status: normative
created: 2026-07-22T10:19:26+0200
updated: 2026-08-05T21:23:56+0200
maintainer: ai-maestro
project-id: ai-maestro
authority: "SOURCE OF TRUTH — this SPEC is edited FIRST when a governance rule changes; docs/GOVERNANCE-RULES.md and the code/personas/DEP-overlays are its IMPLEMENTATIONS, authored AFTER it (see `implementations`). Specs come before the implementation (USER, 2026-07-22, TRDD-CJWC3JLU). This spec was previously derived FROM the catalog; that direction is reversed for good."
reconciled-with:
  - "docs/GOVERNANCE-RULES.md v4.7.1 (2026-07-22) — catalog and spec are in sync as of the inversion; henceforth the spec LEADS and the catalog follows it (was: spec derived from catalog v4.5.0)."
  - "Full-fidelity rewrite from docs/GOVERNANCE-RULES.md v4.7.1 — every rule parameter/table/schema captured, nothing omitted (USER, 2026-07-22, TRDD-CJWC3JLU)."
implementations:
  - "docs/GOVERNANCE-RULES.md — the PRIMARY emanation: this spec's rule content + the teaching/rationale the spec omits (its §0 lists the downstream mirrors that follow it)"
  - "lib/communication-graph.ts — R6 adjacency matrix + validateMessageRoute()"
  - "services/element-management-service.ts — ChangeTitle/ChangeTeam/ChangeClient/ChangePlugin/CreateAgent gates (R3/R9/R11/R12/R17/R18/R21)"
  - "services/governance-service.ts, lib/team-registry.ts, lib/agent-auth.ts, lib/aid-ledger-authority.ts, server.mjs — runtime enforcement"
  - "lib/ecosystem-constants.ts — TITLE_PLUGIN_MAP, PREDEFINED_ROLE_PLUGIN_NAMES, PLUGIN_COMPATIBLE_TITLES (R11/R20.4)"
  - "the 8 role-plugin repos + ai-maestro-plugin skills — persona-embedded rule subsets (§0.3/§0.4)"
  - "rules/aimaestro/aimaestro-*.md — the DEP overlays that EXPAND the tier/authority operating detail (R41/R49 Part B)"
validated-by:
  - "GOV-VAL — a conformance harness asserts code == this spec on the enumerable surfaces (comm graph, title enum, TITLE_PLUGIN_MAP, strict-route list, the 22 invariants)"
---

# The governance conformance SPEC

**This file is the SPEC, and it is the SOURCE OF TRUTH** for the AI Maestro team-governance
rules — the single, versioned, normative definition, **edited FIRST when a rule changes**
(USER, 2026-07-22: *specs come before the implementation*). The RULE catalog
`docs/GOVERNANCE-RULES.md` (discursive prose + rationale, `version: 4.7.1`) is the IMPLEMENTATION
that carries the teaching; the runtime code (`lib/communication-graph.ts`,
`services/element-management-service.ts`, …), the DEP overlays (`rules/aimaestro/*`), and the 8
role-plugin personas are the IMPLEMENTATIONS that carry the enforcement. All of them are authored
AFTER this spec and take their rule CONTENT from it. On any disagreement, **THIS SPEC is
authoritative** — the catalog and code must be brought into agreement with it; the catalog keeps
the rationale + changelog the spec omits, but never the last word on what a rule mandates. This
spec remains the arbiter of the machine-checkable SHAPE (the comm graph, the title enum, the 22
invariants), which its `validated-by` harness asserts the code conforms to.

Every rule R1..R49 and sub-rule is captured. Each clause leads with its canonical id
(`` `R<n>.<sub>` ``) so a citation resolves to the same clause in the catalog and here.

## GOV-GREP — how to grep this spec

```text
GOV-GREP  a whole rule family:      grep 'GOV-R6'     (section header) / grep '`R6\.'  (its clauses)
GOV-GREP  one clause by id:         grep '`R41.4`'
GOV-GREP  the comm-graph matrix:    grep -A14 '@spec:comm-graph'
GOV-GREP  the 8 titles:             grep -A12 '@spec:titles'
GOV-GREP  the title→plugin map:     grep -A10 '@spec:title-plugin-map'
GOV-GREP  the 22 invariants:        grep 'GOV-INV-'
GOV-GREP  the strict-route gate:    grep 'R32' (agents never sudo) / grep 'R28' (three-check)
GOV-GREP  IRON/CRITICAL/USER-set:   grep -E 'IRON|CRITICAL|USER-set'
GOV-GREP  families: META VER TERM R1..R49 COMM TITLES INV PERM BND VAL MNT
```

## GOV-META — arbiter, mirror discipline, not-a-code-mirror

`GOV-META-01` **spec-is-authoritative-for-meaning** — THIS SPEC is the USER-owned SOURCE OF
TRUTH, edited FIRST; `docs/GOVERNANCE-RULES.md` tracks it. A rule's MEANING is set HERE; the
catalog carries the rationale. Where the two diverge the SPEC wins and the catalog is the lint
target.

`GOV-META-02` **mirror-sync** — A rule change MUST update THIS SPEC first (bump `spec-version`),
then the catalog (`docs/GOVERNANCE-RULES.md`: bump `version:`, append changelog) and every
`§0.2..§0.9` mirror + the affected role-plugins follow it in the SAME change-set. This spec
LEADS; the catalog and code are emanations.

`GOV-META-03` **not-a-code-mirror** — this spec states VALUES + `MUST`/`MUST-NOT` assertions +
the enumerable surfaces; it does NOT restate rationale prose or re-implement enforcement logic.
The rationale stays in the catalog; the logic stays in the code.

## GOV-VER — versioning & conformance

`GOV-VER-01` **semver-bump** — `spec-version` is semver. MAJOR = a `MUST` changes (a rule
meaning, the comm graph, the title enum, an invariant, the authority ladder). MINOR = a rule
added or a non-breaking clarification. PATCH = wording only. This `spec-version` LEADS; the
catalog's `version:` follows it in lockstep (GOV-META-02).

`GOV-VER-02` **conforms-to** — an implementation MAY declare `conforms-to-spec:
governance@<version>` / `governance-rules@<catalog-version>`; a declared version ≠ the live one
is a detectable failure.

`GOV-VER-03` **clause-ids-stable** — a rule number is NEVER reused (R22 was reserved, not
recycled; decoupling/memory/pillars moved to R23/R24/R25 to free it). A citation `R<n>.<sub>`
resolves to exactly one rule across versions.

## GOV-TERM — the three-layer agent model (TITLE / ROLE / PERSONA)

<!-- @spec:three-layer-model — every agent has THREE orthogonal layers; mutated by different pipelines, shown in different UI tabs, governed by different rules; MUST NOT be conflated (§TERMINOLOGY) -->

| Layer | Answers | Example |
|---|---|---|
| **TITLE** | *What is it allowed to do?* — the governance class (permissions) | `MEMBER` |
| **ROLE** | *What does it know how to do?* — the role-plugin main agent loaded from a marketplace | `ai-maestro-programmer-agent:programmer-main-agent@Emasoft/ai-maestro-plugins` |
| **PERSONA** | *Which specific running instance?* — identity (name, AID, avatar, workdir) | `peter-bot, <aid>, ~/avatars/peter.jpg, ~/agents/peter-bot/` |

`TERM-01` **three-orthogonal-layers** (§TERMINOLOGY) — every AI Maestro agent has three orthogonal
layers: TITLE (governance class / permissions), ROLE (the role-plugin main agent it runs —
behaviour/skills), PERSONA (the running instance — name + AID + avatar + workdir). Keeping them
distinct is essential: they are mutated by DIFFERENT pipelines, displayed in DIFFERENT UI tabs, and
governed by DIFFERENT rules. MUST NOT be conflated.

`TERM-02` **TITLE** (§TERMINOLOGY.1) — the governance class: what an agent is authorized to do
within the governance system. The 8 valid titles are in R3. TITLE is the access-control role, NOT
the behaviour. Changing a TITLE runs the `ChangeTitle` pipeline (**23 gates**) and requires the
governance password OR MANAGER/COS authorization (per R3, R16). Code: `agent.governanceTitle`
(lowercase kebab).
**Naming binding (2.4.2, USER statement 2026-08-06 + delegated ruling, TRDD-MCKBB117):**
`title` and `governanceTitle` are ONE concept under two spellings — TITLE is the taxonomy
term (every human-facing surface says TITLE), `governanceTitle` is its single code/API/storage
spelling (scoped because bare `title` is overloaded: TRDD frontmatter, UI panel titles), and
the signed AID-token wire spelling is `governance_title`. NO fourth spelling may appear. The
field is deliberately NOT renamed to `title`: signed `aim_tk_*` tokens held by live agents
embed `governance_title` and cannot be rewritten, so a rename would require the server to
accept two spellings through a rotation window — mandatory backward-compat code, which the
no-legacy rule forbids. Measured blast radius at decision time: 216 production sites, 1819
test references, deployed fleet CLIs parsing `.governanceTitle`, and the cross-repo work
orders naming it. Re-open only as a coordinated flag-day (full token rotation + fleet CLI
redeploy + every consumer repo in one window).

`TERM-03` **ROLE** (§TERMINOLOGY.2) — the role-plugin MAIN AGENT the PERSONA is currently running,
referenced fully-qualified as `<plugin-name>:<main-agent-name>@<marketplace>`. The `@<marketplace>`
suffix mirrors Claude Code's `plugin@marketplace` syntax; the `:<main-agent>` segment selects which
main-agent `.md` file inside the plugin is loaded by `claude --agent <main-agent>`. A role-plugin is
**any normal Claude Code plugin** that ADDITIONALLY contains BOTH:
  1. a `<name>.agent.toml` at the plugin root with two mandatory extra fields — `compatible-titles`
     (array of governance titles the plugin is designed for) and `compatible-clients` (array of CLI
     clients, e.g. `claude-code`, `codex`); AND
  2. a main-agent `.md` whose persona text carries the governance rules that agent must follow —
     inline, via `skills:` references, or via rule-file links. **This persona is the actual security
     boundary**: every agent on a host shares a single `gh` CLI identity, so only the persona text
     restrains destructive actions.
  `TERM-03a` **not-defining** — storage location, install pipeline, `TITLE_PLUGIN_MAP` membership,
  and the Haephestos authoring tool are NOT defining properties; any plugin matching the two
  conditions above is a valid role-plugin regardless of where it lives or how it was authored.
  `TERM-03b` **two-default-marketplaces** — AI Maestro ships two default role-plugin marketplaces:
  `Emasoft/ai-maestro-plugins` (remote) and `ai-maestro-local-roles-marketplace` (local, at
  `~/agents/role-plugins/marketplace/`); role-plugin folders may live anywhere as long as a
  registered marketplace manifest's `source` field points at them.
  `TERM-03c` **change-pipeline** — changing a ROLE runs `ChangePlugin` with the `rolePluginSwap`
  flag, or is triggered automatically by `ChangeTitle` Gates 15/16 when the new TITLE requires a
  different plugin. Code: `agent.rolePlugin` + `config.rolePlugin.name`.

`TERM-04` **PERSONA** (§TERMINOLOGY.3) — the concrete running agent. FOUR attributes together
identify a specific Claude Code tmux session:
  1. **Name** — a unique kebab identifier (e.g. `peter-bot`, `sammy`); case-insensitive on input,
     lowercase internally, capitalized for display.
  2. **AID** — the Agent Identity Ed25519 key pair for AMP signing + cross-host auth; provisioned
     ONCE per PERSONA; stored at `~/.agent-messaging/agents/<name>/keys/`.
  3. **Avatar** — image file shown on the sidebar card.
  4. **Workdir** — project folder at `~/agents/<name>/` where Claude Code runs; all `--scope local`
     plugins live here; the ONLY location outside `/tmp` where the PERSONA may write.
  `TERM-04a` **persona-is-1:1-with-session** — PERSONA is the only layer with 1:1 cardinality to a
  running tmux session; TITLE and ROLE are swappable on a live PERSONA WITHOUT destroying identity,
  AID, avatar, or workdir. Code: `agent.name` + `agent.label` + `agent.aid` +
  `agent.workingDirectory` + `agent.avatarPath` together form the PERSONA.

`TERM-05` **relationships-and-invariants** (§TERMINOLOGY.4) —
  `TERM-05a` **title⊥role-but-constrained** — TITLE and ROLE are orthogonal but constrained by
  `compatible-titles`; `ChangeTitle` REJECTS assigning a ROLE whose `.agent.toml` does not include
  the new TITLE (the plugin was designed for those specific titles; an incompatible install breaks
  the design contract).
  `TERM-05b` **N:1-compatibility** — multiple ROLEs can satisfy one TITLE; the Agent Profile → Role
  tab shows a DROPDOWN when ≥2 role-plugins declare the same title in `compatible-titles`, and a
  LOCKED LABEL when exactly one does; one ROLE may also be compatible with multiple TITLEs.
  `TERM-05c` **R9.13-mandatoriness** — every persisted agent MUST carry exactly one ROLE;
  CreateAgent / ChangeTitle HARD REJECT any desired state that would leave an agent with zero
  role-plugins.
  `TERM-05d` **autonomous-resolves** — AUTONOMOUS resolves to `ai-maestro-autonomous-agent`; no
  title is ever "no plugin" (see R11.3, R11.12).

`TERM-06` **writing-conventions** (§TERMINOLOGY.5) — use TITLE for permissions/governance/comm
graph/approval flows; ROLE for behaviour/skills/main-agent persona text/available tools; PERSONA to
identify a specific agent (sidebar card / workdir / AID). Do NOT use "role" as a synonym for
"title" (the 2026-03-20 rename made `TitleBadge` / `TitleAssignmentDialog` authoritative in code).
When the user says "change the agent's role", clarify: swap the role-plugin (ROLE) vs re-assign the
governance level (TITLE) — different pipelines.

`TERM-07` **OOP-analogy** (§TERMINOLOGY.6) — TITLE = access-control role (permission level); ROLE =
class definition (behaviour + skills + instructions); PERSONA = instance (state + identity).

## GOV-OVERVIEW — the model in one paragraph

`OVERVIEW-01` **model-summary** — AI Maestro implements a team-governance model with EIGHT
governance titles (MANAGER, CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER, AUTONOMOUS,
MAINTAINER); teams (isolated messaging + ACL); groups (lightweight broadcast collections); ONE
remote marketplace plus TWO local plugin containers (role-plugins + custom-plugins) and — for
non-Claude clients ONLY — a THIRD local core-plugins container (R20); and an identity layer where
every privileged action is backed by a cryptographically-signed AID token. Teams REQUIRE a MANAGER
to function. Groups are unstructured collections with NO governance. MAINTAINERs live at the HOST
LEVEL bound to a GitHub repo and NEVER join a team.

## GOV-R1..R49 — the rule clauses

### GOV-R1 — Teams and Groups

`R1.1` **teams-defined** [Explicit] — Teams have isolated messaging, ACL, governance titles, and a
COS (former "closed teams"). `R1.2` **groups-defined** [Explicit] — Groups are lightweight agent
collections for broadcast messaging: NO governance, NO COS, NO kanban (former "open teams"). `R1.3`
**team-should-COS** [Explicit] — every team SHOULD have a COS assigned; the COS manages membership
and external communication. `R1.4` **team-needs-MANAGER** [Explicit] — teams require a MANAGER to
exist on the host before they can be created. `R1.5` **no-manager-blocks** [Explicit] — teams
without a MANAGER are blocked (`team.blocked = true`); all operations frozen. `R1.6` **groups-free**
[Explicit] — groups have no governance constraints; any agent can subscribe/unsubscribe freely.

### GOV-R2 — Team Name Rules

`R2.1` **unique-name** [Explicit] — team names MUST be unique (case-insensitive comparison); no two
teams can share the same name. `R2.2` **dual-enforce** [Implicit: both creation surfaces exist] —
the duplicate-name check MUST be enforced BOTH server-side (API rejects with **409**) AND
client-side (UI shows inline error before POST). `R2.3` **rename-checks** [Implicit: rename is an
update op] — renaming a team via update MUST also check uniqueness against all other teams
(excluding the team being renamed).

### GOV-R3 — Role Hierarchy Rules [CRITICAL surface]

`R3.1` **eight-titles** [Explicit] — eight governance titles exist: **MANAGER** (global singleton),
**CHIEF-OF-STAFF** (per team), **ORCHESTRATOR** (per team), **ARCHITECT**, **INTEGRATOR**, **MEMBER**
(default team title), **AUTONOMOUS** (no team), **MAINTAINER** (no team, bound to a GitHub repo).
`R3.2` **manager-singleton** [Explicit] — only ONE agent can be MANAGER at any given time (singleton).
`R3.3` **cos-per-team** [Explicit] — COS is a per-team title; each team has exactly one COS. `R3.4`
**cos-one-team** [Explicit] — an agent can be COS of only ONE team at any time. `R3.5`
**role-change-needs-password** [Explicit] — all role changes (assign/remove MANAGER, assign/remove
COS) require the governance password. `R3.6` **manager-full-authority** [Explicit] — MANAGER has full
authority over all teams: add/remove agents, assign COS, approve transfers, create/delete teams,
message anyone. `R3.7` **cos-external-comms** [Explicit] — COS is responsible for the EXTERNAL
communication of their team; the contact point for outside agents. `R3.8` **cos-staffs** [Explicit] —
COS decides the STAFF COMPOSITION (add/remove agents) of their team (why they are "chief-of-staff").
`R3.9` **manager-delegates** [Explicit] — MANAGER can do everything COS can but USUALLY delegates to
the COS. `R3.10` **typical-flow** [Explicit] — typical workflow: MANAGER creates a team → assigns a
COS → lets the COS manage the team from there. `R3.11` **manager-reassign-revokes** [Implicit:
singleton] — reassigning MANAGER to a new agent IMMEDIATELY revokes the role from the old agent (only
one MANAGER exists). `R3.12` **cos-only-via-dedicated-route** [Implicit: prevents bypass of password
protection] — COS changes (assign/remove) on a team MUST NOT be possible via the generic
`PUT /api/teams/[id]` endpoint; only via the dedicated `POST /api/teams/[id]/chief-of-staff` endpoint,
which requires the governance password.

### GOV-R4 — Agent Membership Rules

`R4.1` **one-team** [Explicit] — non-MANAGER agents can be in at most ONE team at any given time
(single-team membership). `R4.2` **unlimited-groups** [Explicit] — any agent can subscribe to
UNLIMITED groups simultaneously (groups have no governance). `R4.3` **manager-maintainer-host-level**
[Explicit] — MANAGER and MAINTAINER are NOT in any team; both operate at the host level. `R4.4`
**join-auto-member** [Explicit] — when an agent joins a team it is auto-assigned the MEMBER title and
the programmer plugin. `R4.5` **no-dup-membership** [Explicit] — an agent cannot be added to a team
they are already a member of (no duplicate in `agentIds`). `R4.6` **cos-must-be-member** [Implicit:
logical necessity] — COS MUST be a member of the team they lead (present in `agentIds[]`); they manage
the team staff and the message filter relies on `agentIds` for same-team communication. `R4.7`
**cos-cannot-be-bare-removed** [Implicit: COS immutability invariant] — removing a COS from a team's
`agentIds` while they remain `chiefOfStaffId` is FORBIDDEN; the COS title can only be removed by
deleting the team. `R4.8` **ui-shows-memberships** [Explicit] — the UI MUST ALWAYS show team
memberships when selecting agents for any operation (add to team, remove, transfer, team-creation
agent selection). `R4.9` **validate-existence** [Implicit: referential integrity] — agent existence
MUST be validated when adding to a team; `agentIds` MUST reference agents that actually exist in the
registry.

### GOV-R5 — Transfer Rules

`R5.1` **transfer-request-required** [Explicit/implemented] — moving a normal agent FROM a team
requires a transfer request (approval workflow); the agent cannot simply leave. `R5.2`
**only-manager-cos-create** [Explicit/enforced] — only MANAGER or COS can CREATE transfer requests.
`R5.3` **only-source-cos-manager-approve** [Explicit/enforced] — only the source team's COS or MANAGER
can APPROVE/REJECT transfers. `R5.4` **cos-not-transferable** [Implicit: COS immutability invariant] —
COS cannot be transferred out of their own team; the COS title is immutable to team lifecycle. `R5.5`
**dest-must-exist** [Implicit: referential integrity] — the destination team MUST exist at the time
the transfer request is created. `R5.6` **no-self-transfer** [Implicit: nonsensical op] — source and
destination teams MUST be different (no self-transfer). `R5.7` **check-single-team-on-approve**
[Implicit: logical consequence] — on transfer approval, the single-team constraint (R4.1) MUST be
re-checked: verify the agent is not already in another team. `R5.8` **no-dup-request**
[Explicit/enforced] — duplicate pending transfer requests (same agent + same source + same
destination) MUST be prevented.

### GOV-R6 — Messaging Rules (Communication Graph) [see GOV-COMM]

`R6.0` **all-teams-closed** — all teams are closed; messaging between agents is governed by a
title-based DIRECTED communication graph; missing connections are FORBIDDEN.

#### GOV-R6-ADDR — canonical address format (2026-05-06 update)

`R6.11` **canonical-address** [Explicit] — every agent (and every human user) is addressed by a
SINGLE UNIQUE ID STRING per host. The canonical wire format is one of:
```
<agent-id>@<host>      ← preferred for cross-host messaging
<host>:<agent-id>      ← equivalent alternate; pick whichever reads more naturally
<agent-id>             ← short form; resolves to the writer's host (the sender's home host)
```
The legacy three-level hierarchical addressing (`first/second/third/agent-name`) is DEPRECATED — it
only ever applied to the sidebar's VISUAL tag organization and was never load-bearing for messaging.
When the writer is the human user, the writer's host is the dashboard's local host (the box the user
is logged into); when the writer is an agent, the writer's host is the agent's `hostId` in the
registry.

`R6.12` **persona-alias** [Explicit] — the PERSONA NAME (registry `label` field) MAY substitute for
`<agent-id>` whenever the substitution is UNAMBIGUOUS on the target host (no other agent on that host
has a colliding name/label). On collision, the persona name MUST be replaced by the agent-id, or the
address rejected at the API layer with **HTTP 409** + a `disambiguation_required` code.

`R6.13` **default-host** [Explicit] — when the host is omitted, it defaults to the writer's host (for
agents `agent.hostId`; for users the dashboard host). Cross-host messaging therefore REQUIRES the
explicit `@<host>` (or `<host>:`) suffix; an agent on host A cannot accidentally reach an agent on
host B by typing a bare id.

`R6.14` **migrate-drift** [Explicit] — every UI tooltip, onboarding-guide step, agent persona prompt,
role-plugin instruction, and orchestration rule referencing the deprecated 3-level format MUST be
migrated to R6.11–R6.13 wording. The deprecation is PERMANENT — no flag toggles, no compatibility
shim. Migration tracked across this repo (UI text + docs) and the 8 role-plugin repos under
`Emasoft/ai-maestro-*` (persona prompts). The 3-level sidebar visual organization (R7 family) is
UNAFFECTED — it remains purely a UX feature, not an addressing scheme.

<!-- @spec:addr-examples — resolution table (source lines 360-368) -->

| Format | Resolves to |
|---|---|
| `peter-bot@mac.lan` | the agent named `peter-bot` on host `mac.lan` |
| `mac.lan:peter-bot` | same as above, alternate spelling |
| `peter-bot` (in a message authored by an agent on `mac.lan`) | `peter-bot@mac.lan` |
| `peter-bot` (in a message authored by a user logged into `mac.lan`) | `peter-bot@mac.lan` |
| `Peter Parker` (persona-name alias, no collision on mac.lan) | resolved to `peter-bot@mac.lan` |
| `Peter Parker` (collision: two agents have label "Peter Parker") | rejected — the writer must use the agent-id |
| `H` / `human:user@host` | the human user (single H node per host, no agent-id) |

#### GOV-R6-MATRIX — adjacency matrix [see GOV-COMM]

`R6.matrix-legend` **cell-values** — `Y` = sender may freely initiate a message to recipient; blank
= sender is FORBIDDEN (API returns **HTTP 403** with a routing suggestion); `1` = sender may send
EXACTLY ONE reply to recipient IF the recipient previously messaged the sender (without a prior
inbound, `1` is equivalent to blank). `1` is used only for team-agent edges to the human user
(`C/O/R/I/E → H`); MAINTAINER and AUTONOMOUS have full `Y` edges to H.

`R6.matrix-v2` **v2-update (2026-04-22)** — the HUMAN USER (**H**) is a first-class node with
unconditional outbound access to every node (including other humans). Inbound to H from team agents
(COS, ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER) is `1` (reply-only); inbound to H from
governance-layer titles (MANAGER, MAINTAINER, AUTONOMOUS) is `Y`.

`R6.matrix-v3` **v3-update (2026-05-04)** — MANAGER → in-team-non-COS edges (ORCHESTRATOR, ARCHITECT,
INTEGRATOR, MEMBER) flipped from `Y` to blank. Field test (2026-05-03) showed confusion when MANAGER
bypassed COS. The CHIEF-OF-STAFF is now the SOLE inbound and outbound gateway for closed-team agents.
MANAGER still freely reaches COS, peer MANAGERs, MAINTAINER (out-of-team), AUTONOMOUS (out-of-team),
and the HUMAN user. The user (HUMAN) remains exempt — full `Y` to every node.

The 9×9 adjacency matrix itself lives once, in **GOV-COMM** (`@spec:comm-graph`). `[see GOV-COMM]`

#### GOV-R6-CLAUSES

`R6.1` **graph-defined** [Explicit] — communication rules are defined by the directed graph above;
each (sender, recipient) pair MUST be explicitly listed with its edge type (`Y` = allow, `1` =
reply-only, blank = deny). `R6.2` **manager-routes-via-COS** [Explicit] — MANAGER can freely message
COS (the sole team gateway), peer MANAGERs, MAINTAINER, AUTONOMOUS, and the HUMAN user; MANAGER
CANNOT directly contact in-team non-COS agents (ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER) — must
route through COS (the 2026-05-03 field test showed direct in-team directives caused confusion; v3
of the graph, 2026-05-04, corrects this). `R6.3` **cos-sole-gateway** [Explicit] — CHIEF-OF-STAFF is
the SOLE inbound and outbound team gateway; every MANAGER directive fans INTO the team through COS
and every team-internal escalation fans OUT through COS; COS can message MANAGER, COS peers, and the
team roles (ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER); CANNOT initiate to MAINTAINER, AUTONOMOUS,
or the human user (H-edge reply-only). `R6.4` **orchestrator-edges** [Explicit] — ORCHESTRATOR can
message COS, ARCHITECT, INTEGRATOR, MEMBER; cannot initiate to MANAGER, MAINTAINER, AUTONOMOUS, or
the human user (H-edge reply-only). `R6.5` **arch-int-member-edges** [Explicit] — ARCHITECT,
INTEGRATOR, MEMBER can only freely message COS and ORCHESTRATOR; H-edge is reply-only (may answer a
user message once; cannot initiate). `R6.5a` **autonomous-edges** [Explicit] — AUTONOMOUS can freely
message MANAGER, other AUTONOMOUS agents, AND the human user; cannot reach COS, team roles, or
MAINTAINER; the H-edge is `Y` (not reply-only) — AUTONOMOUS operates outside teams and may initiate
user-directed messages. `R6.5b` **maintainer-edges** [Explicit] — MAINTAINER can freely message
MANAGER and the human user; cannot reach COS, team roles, AUTONOMOUS, or peer MAINTAINERs; the H-edge
is `Y` (not reply-only) — MAINTAINERs surface repo-scoped concerns directly to the user when MANAGER
routing would add latency. `R6.6` **human-first-class** [Explicit] — the human user (H) is a
first-class node with unconditional outbound `Y` to EVERY other node INCLUDING other humans (H → H is
`Y` for user-to-user messaging); inbound to H from team titles is `1` (reply-only: team agents cannot
proactively initiate but may reply once to an inbound user message); inbound to H from governance
titles (M/T/A) is `Y`; agents are ADDITIONALLY persona-discouraged from proactively initiating user
contact — the reply-only rule is the HARD floor, the persona sets the SOFT floor. `R6.7`
**routing-suggestion** [Explicit] — when a message is blocked, the error MUST include a routing
suggestion; the routing-suggestion table in `lib/communication-graph.ts` is authoritative; under the
2026-04-22 tightening almost every cross-layer route goes through MANAGER (not COS). `R6.8`
**three-enforcement-layers** [Explicit] — three layers of enforcement: (1) API server validates
sender/recipient titles BEFORE delivery via `validateMessageRoute()`, (2) role-plugin main-agent `.md`
files list allowed/reply-only recipients, (3) sub-agents are FORBIDDEN from using AMP messaging
entirely. `R6.9` **subagents-no-identity** [Explicit] — sub-agents have no AMP identity and cannot
authenticate; they communicate ONLY with their spawning main-agent. `R6.10` **reply-only-enforce**
[Explicit; enforcement partial — TRDD-80557822] — reply-only (`1`) edges: the sender MUST pass
`inReplyToMessageId` when targeting a reply-only recipient; TODAY the graph layer only requires the
field to be a truthy string — it does NOT load the referenced message, verify its sender/recipient
pair, or prevent multiple replies to the same id; the "one reply per inbound message" invariant (AMP
inbox sets `replied=true` on the original and rejects subsequent attempts) is PLANNED not yet
implemented (`design/tasks/TRDD-80557822-comm-graph-downstream-sync.md`); the advisory check is
latent in production because no flow currently routes messages to the human user; it becomes
load-bearing the moment Phase 2 maestro auth wires H as an AMP recipient.

`R6.spec-ref` **full-spec** — `docs_dev/2026-04-03-communication-graph.md`.

### GOV-R7 — UI Robustness Rules

`R7.1` **submit-guards** [Explicit] — prevent accidental multiple operations from fast repeated
clicks; all mutating buttons MUST have `submitting` guards. `R7.2` **loading-spinners** [Explicit] —
show loading spinners for all async operations (API calls, data fetching). `R7.3` **no-silent-failure**
[Explicit] — show error messages for all failures; NO silent failures allowed. `R7.4`
**graceful-edge-cases** [Explicit] — handle all edge cases and possible errors gracefully. `R7.5`
**no-infinite-loops** [Explicit] — no infinite loops or blocking operations in the UI. `R7.6`
**role-badges** [Implicit] — show role badges (MANAGER: amber/gold, COS: indigo) next to agent names
throughout the UI. `R7.7` **blocked-badge** [Implicit] — show a blocked badge on teams when no
MANAGER exists. `R7.8` **resolve-uuid** [Implicit: UX requirement] — resolve the COS UUID to a
human-readable agent name everywhere it is displayed; NEVER show raw UUIDs to users. `R7.9`
**loading-state-not-stale** [Implicit] — when governance data is loading, show a loading state; do
NOT show a stale/default "normal" role, which would be misleading.

### GOV-R8 — Data Integrity Rules

`R8.1` **file-locking** [Implemented] — all write operations on teams use file locking (`withLock`) to
prevent corruption from concurrent writes. `R8.2` **no-governance-via-generic-put** [Implicit:
prevents governance bypass] — `chiefOfStaffId` and `type` changes MUST NOT be accepted in the generic
team update (`PUT /api/teams/[id]`); must use dedicated password-protected endpoints. `R8.3`
**delete-cleans-transfers** [Implicit: referential integrity] — team deletion SHOULD clean up related
transfers (cancel pending transfer requests involving the deleted team). `R8.4`
**agent.team-display-only** [Documented] — the `Agent.team` free-text field is DISPLAY-ONLY; it is
NOT connected to `Team.id` in the governance system; membership is tracked SOLELY via `Team.agentIds[]`.

### GOV-R9 — Manager Requirement

`R9.def-authority` **manager-is-host-wide-authority** — the MANAGER is the host-wide governance authority. Without a MANAGER, teams CANNOT function, but AUTONOMOUS agents operate normally. The key distinction:
- **AUTONOMOUS agents** — always fully operational; can be created, woken, hibernated, and used regardless of whether a MANAGER exists; appear in the dashboard at all times.
- **Team agents** (any agent in a team's `agentIds[]`) — require a MANAGER on the host; when no MANAGER exists, team agents are forcefully hibernated and cannot be woken until a MANAGER is assigned.

`R9.def-visibility` **all-agents-always-in-sidebar** — ALL agents always appear in the dashboard sidebar (ACTIVE / ALL / HIBER tabs) regardless of MANAGER status. The MANAGER gate ONLY controls whether team agents can be **woken** — it NEVER hides agents from the UI or removes them from the registry.

#### Manager Blocking Protocol

**Forward cascade** — executes when no MANAGER exists (at startup OR after MANAGER removal):

| Step | Action |
|------|--------|
| 1 | All teams are marked `blocked: true` in `teams.json` |
| 2 | All agents belonging to blocked teams have their tmux sessions killed (forcefully hibernated) |
| 3 | The wake API rejects wake requests for team agents with **HTTP 403**: `"Cannot wake team agent: no MANAGER exists"` |
| 4 | AUTONOMOUS agents are **completely unaffected** — they keep running, can be woken, hibernated, created, and deleted normally |
| 5 | Team CRUD operations (add/remove agents, create/delete teams) are rejected with **HTTP 400** |

**Reverse cascade** — runs when a MANAGER is assigned (via title change):

| Step | Action |
|------|--------|
| 1 | All teams are marked `blocked: false` |
| 2 | Agents remain hibernated — the MANAGER or user must wake them manually |
| 3 | All team operations are re-enabled |

#### R9 clause table

| ID | Rule |
|----|------|
| `R9.1` **manager-before-team** | A MANAGER agent **MUST** exist on the host before any team can be created |
| `R9.2` **no-manager-blocks-teams** | If no MANAGER exists, all existing teams are **blocked** (`team.blocked = true`) |
| `R9.3` **blocked-no-membership** | When teams are blocked, no agents can be added to or removed from them |
| `R9.4` **blocked-hibernates** | When teams are blocked, all agents belonging to those teams are **forcefully hibernated** (tmux sessions killed) |
| `R9.5` **autonomous-unaffected** | **AUTONOMOUS agents are completely unaffected by team blocking** — they can be created, woken, hibernated, deleted, and used normally even when no MANAGER exists. The MANAGER gate applies **exclusively** to team agents |
| `R9.6` **assign-unblocks** | When a MANAGER is assigned (title change), all teams are **unblocked** (`team.blocked = false`) |
| `R9.7` **unblock-no-autowake** | Unblocking does **NOT** auto-wake agents — agents remain hibernated until manually woken by the user or the MANAGER |
| `R9.8` **remove-manager-cascades** | If a MANAGER is deleted or their title is removed, the blocking cascade triggers immediately (same as startup without MANAGER) |
| `R9.9` **startup-check** | At server startup, if no MANAGER is detected, team blocking + agent hibernation runs as a startup task |
| `R9.10` **delete-manager-warns-demotes** | When attempting to delete the MANAGER agent, the Delete Agent dialog **MUST** show a clear warning: `"This agent holds the MANAGER title. Removing it will block all team operations."` The system **auto-demotes the MANAGER to AUTONOMOUS** before proceeding with deletion |
| `R9.11` **manager-creates-team-via-AID** | The MANAGER agent may create teams via the API using **AID authentication**. The governance password is **NOT** required for MANAGER-initiated team creation — the server validates the MANAGER's AID session secret (`mst_*` token) and grants team-creation privileges based on the MANAGER governance title |
| `R9.12` **all-agents-visible** | **All agents always appear in the dashboard** (sidebar ACTIVE / ALL / HIBER tabs) regardless of MANAGER status. The MANAGER gate controls wake permissions, NOT visibility. The registry is the source of truth for the agent list — it is never filtered by governance state |
| `R9.13` **role-plugin-mandatory** [CRITICAL] | **Role-plugin is mandatory for every agent** (including AUTONOMOUS). `CreateAgent`, `ChangeTitle`, `ChangeClient`, `ChangeTeam`, and `RegisterAgentFromSession` **MUST reject** any desired state that would leave an agent with **zero role-plugins**. The only valid "no role-plugin" window is the transient instant inside a `Change*` pipeline between uninstall and install — the agent is never persisted in that state. AUTONOMOUS resolves to `ai-maestro-autonomous-agent`, which encodes workspace isolation, forbidden cross-agent mutation, and comm-graph restrictions in its persona. Closes the security gap where a persona-less AUTONOMOUS agent could destroy other agents' working directories, force-merge PRs, or mutate shared registry state — since all agents share one `gh` CLI identity, the persona instructions are the only effective governance boundary. See `R11.12`, `R20.4`, `Invariant 8` |

### GOV-R10 — Agent Lifecycle Governance

| ID | Rule |
|----|------|
| `R10.1` **wake-user-or-manager** | Only the **user** (web UI, no auth headers) or the **MANAGER** agent can wake ANY agent |
| `R10.2` **hibernate-user-or-manager** | Only the **user** or the **MANAGER** agent can hibernate ANY agent |
| `R10.3` **cos-own-team-only** | The **CHIEF-OF-STAFF** can wake or hibernate agents that belong to **their own team ONLY** |
| `R10.4` **others-cannot** | All other agents (MEMBER, ORCHESTRATOR, ARCHITECT, INTEGRATOR, AUTONOMOUS) **CANNOT** wake or hibernate any agent |
| `R10.5` **no-manager-no-team-wake** | Team agents cannot be woken if no MANAGER exists on the host (even by the user — assign MANAGER first) |
| `R10.6` **restart-same-as-wake** | The restart endpoint follows the **same governance rules as the wake endpoint** |
| `R10.7` **delete-team-warn-pre-existing** [REC] | When deleting a team with "Delete Agents Too", the system **SHOULD** warn if any agents were created before the team and offer to keep them as AUTONOMOUS instead of deleting them |

**Enforcement points:**
- `POST /api/agents/[id]/wake` — checks auth headers, validates caller is user / MANAGER / COS-of-team
- `POST /api/agents/[id]/hibernate` — same checks
- `POST /api/sessions/[id]/restart` — checks if target agent is in a team without MANAGER

### GOV-R11 — Title-Plugin Binding [see GOV-TITLES for the map]

| ID | Rule |
|----|------|
| `R11.1` **every-title-has-default** | Every governance title (including MEMBER and AUTONOMOUS) has a corresponding default role-plugin. **There is NO "no role-plugin" state for a persisted agent** — every agent **MUST** carry exactly one role-plugin at rest |
| `R11.2` **member→programmer** | MEMBER title installs `ai-maestro-programmer-agent` via ChangeTitle pipeline |
| `R11.3` **autonomous→autonomous-agent** | AUTONOMOUS title installs `ai-maestro-autonomous-agent` — the mandatory role-plugin for no-team agents. Its persona enforces workspace isolation, forbids cross-agent mutation, and encodes the AMP communication-graph restrictions. `ChangeTitle('autonomous')` swaps whatever role-plugin the agent currently has for `ai-maestro-autonomous-agent` |
| `R11.4` **join→member** | When an agent joins a team, `ChangeTeam` calls `ChangeTitle('member')` which auto-installs the programmer plugin |
| `R11.5` **leave→autonomous** | When an agent leaves a team, `ChangeTeam` calls `ChangeTitle('autonomous')` which uninstalls the team role-plugin and installs `ai-maestro-autonomous-agent` in its place |
| `R11.12` **role-plugin-mandatory-at-boundary** | **Role-plugin is mandatory at every boundary.** `CreateAgent`, `ChangeTitle`, `ChangeClient`, `ChangeTeam`, and `RegisterAgentFromSession` **MUST reject** any desired-state that would leave an agent with zero role-plugins. The only legitimate "no role-plugin" window is the transient instant inside an **AIO pipeline** between uninstall and install — the agent is never persisted in that state. This is `R9.13` as reflected in R11 |
| `R11.6` **N:1-dropdown** | The N:1 compatibility model allows multiple plugins to serve one title — the UI shows a dropdown when 2+ plugins are compatible |
| `R11.7` **fourfold-identity** | Role-plugins are identified by the **fourfold identity rule**: (1) `plugin.json` `name` is the canonical identity, (2) folder name must equal it, (3) `<name>.agent.toml` must exist with `[agent].name` matching, (4) `agents/<name>-main-agent.md` must exist with frontmatter `name: <name>-main-agent`. ALL 4 must match or the plugin is rejected |
| `R11.8` **client-from-toml** | The target client of a role-plugin is determined ONLY by the `compatible-clients` field in `.agent.toml`, never by the plugin name |
| `R11.9` **convert-preserves-role-name** | When converting a role-plugin to another client format, the converter preserves the original name, updates `compatible-clients` in `.agent.toml` to the target client, enforces fourfold identity, and stores in `~/agents/role-plugins/`. The converter **NEVER overwrites** an existing role-plugin folder |
| `R11.10` **convert-suffixes-custom** | Ordinary (non-role) plugins get a `-<client>` suffix when converted (e.g., `my-plugin-codex`) and are stored in `~/agents/custom-plugins/<client>/` with the `ai-maestro-local-custom-marketplace` |
| `R11.11` **local-marketplaces** | The `ai-maestro-local-roles-marketplace` contains ALL local role-plugins regardless of their target client. The `ai-maestro-local-custom-marketplace` contains converted ordinary plugins |

The title → default role-plugin mapping lives once, in **GOV-TITLES** (`@spec:title-plugin-map`, 9
entries incl. the R39 ASSISTANT). `[see GOV-TITLES]`

### GOV-R12 — Minimum Team Composition  [CRITICAL]

| ID | Rule |
|----|------|
| `R12.1` **five-base-incl-COS** | Every team **MUST** contain a minimum of **5 agents** with these titles: **1 CHIEF-OF-STAFF**, **1 ARCHITECT**, **1 ORCHESTRATOR**, **1 INTEGRATOR**, **1 MEMBER** (programmer role-plugin) |
| `R12.2` **missing-title-nonfunctional** | A team lacking any of the 5 required titles is a **NON-FUNCTIONAL TEAM** — the CHIEF-OF-STAFF must immediately add the missing agents |
| `R12.3` **one-role-per-agent** | Each role-plugin is designed for **one role only** — an agent cannot simultaneously serve as COS and ARCHITECT, or any other title combination |
| `R12.4` **extra-members-COS-judgment** | Additional agents with the **MEMBER** title can be added at the judgment of the CHIEF-OF-STAFF, using the programmer role-plugin or any role-plugin compatible with the MEMBER title |
| `R12.5` **COS-composes-from-design-doc** | The CHIEF-OF-STAFF decides team composition based on the **design requirements document** received from the MANAGER |
| `R12.6` **manager-enforces-on-create** | The **MANAGER** must enforce `R12.1` when creating teams — a team creation task must always produce at least 5 agents |

**Example of a well-composed team (10 agents):**

| # | Title | Role-Plugin | Purpose |
|---|-------|-------------|---------|
| 1 | CHIEF-OF-STAFF | `ai-maestro-chief-of-staff` | Team operations, staffing, external comms |
| 2 | ARCHITECT | `ai-maestro-architect-agent` | System design, data models, architecture |
| 3 | ORCHESTRATOR | `ai-maestro-orchestrator-agent` | Task coordination, workflow management |
| 4 | INTEGRATOR | `ai-maestro-integrator-agent` | Integration, CI/CD, deployment |
| 5 | MEMBER | `ai-maestro-programmer-agent` | Core implementation |
| 6 | MEMBER | `database-expert` (custom) | Database design and optimization |
| 7 | MEMBER | `react-native-programmer` (custom) | Mobile frontend |
| 8 | MEMBER | `figma-designer` (custom) | UI/UX design |
| 9 | MEMBER | `ai-ocr-expert` (custom) | OCR/ML features |
| 10 | MEMBER | `ios-debug-expert` (custom) | Platform-specific debugging |

Note (rationale, retained): the MEMBER title is the ONLY one that supports multiple agents with different specializations, allowing teams to scale horizontally for implementation capacity.

### GOV-R13 — Role Boundaries (No Overstepping)

| ID | Rule |
|----|------|
| `R13.1` **strict-scope** | Each title agent **MUST operate strictly within its role-plugin's scope**. No agent may perform tasks assigned to another title's role-plugin |
| `R13.2` **manager-governs-not-codes** | **MANAGER** manages governance, approves operations, routes work, and performs **host-wide coordination** across projects, teams and agents (via AMP messaging, the PRRD, and the TRDD kanban). Does **NOT** write code, does **NOT** design architecture, and does **NOT** perform a team's **internal task orchestration** (kanban management and work distribution inside a team — that is the ORCHESTRATOR's role, `R13.5`; the MANAGER reaches a team through its COS, `R6.2`) |
| `R13.3` **cos-staffs-not-builds** | **CHIEF-OF-STAFF** manages team staffing, agent lifecycle, external comms. Does NOT design, implement, or integrate |
| `R13.4` **architect-designs-not-implements** | **ARCHITECT** designs system architecture, data models, APIs. Does NOT implement code, manage agents, or run CI/CD |
| `R13.5` **orchestrator-coordinates-not-designs** | **ORCHESTRATOR** coordinates tasks, manages kanban, distributes work. Does NOT design architecture or write code |
| `R13.6` **integrator-gates-not-designs** | **INTEGRATOR** handles code review, quality gates, CI/CD, merging. Does NOT design architecture or write features |
| `R13.7` **member-implements-only** | **MEMBER** (programmer) implements features, fixes bugs, writes tests. Does NOT design architecture, manage agents, or run CI/CD pipelines |
| `R13.8` **overstep-refuse-and-route** | An agent that **detects it is being asked to overstep** its role **MUST refuse** and route the request to the correct title via AMP messaging through the ORCHESTRATOR or COS |
| `R13.9` **plugin-gives-capability** | The role-plugin provides the **skills, guidance, and constraints** for its title. An agent without its role-plugin installed **CANNOT** perform that role's functions |

### GOV-R14 — Team Resilience (Auto-Recovery)

| ID | Rule |
|----|------|
| `R14.1` **cos-recreates-missing** | If any of the 5 required title agents (COS, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER) is **accidentally deleted**, the CHIEF-OF-STAFF must **immediately recreate** the missing agent |
| `R14.2` **nonfunctional-until-recreated** | Without all 5 basic title agents, the team is **NON-FUNCTIONAL** — no work can proceed until the missing agent is recreated |
| `R14.3` **cos-checks-at-startup-and-after-delete** | The COS must check team composition **at startup** (when woken) and after any agent deletion event |
| `R14.4` **manager-recreates-COS** | If the **COS itself is deleted**, the MANAGER must recreate a COS for the team or delete the team |
| `R14.5` **same-title-and-plugin** | The recreated agent must be assigned the **same title and default role-plugin** as the deleted one |
| `R14.6` **cos-logs-incident** | The COS **logs the incident** (deleted agent name, title, timestamp, recreation details) in the team's record-keeping files |

### GOV-R15 — Written Orders & GitHub Trail

| ID | Rule |
|----|------|
| `R15.1` **command-is-md-file** | Every command from one agent to another **MUST be accompanied by a written `.md` file** using a template from the sender's role-plugin |
| `R15.2` **report-is-md-file** | Every report back from an agent **MUST be a written `.md` file** using a template from the reporter's role-plugin |
| `R15.3` **attachments-on-github** | Attachments (design docs, code reviews, task specs, reports) **MUST be published on GitHub** as issue comments or new issues — NOT sent via AMP messaging |
| `R15.4` **amp-carries-url-only** | AMP messages carry **only the GitHub issue/comment URL** pointing to the attachment — NEVER the file content itself |
| `R15.5` **github-is-audit-log** | The GitHub issue trail serves as the **permanent audit log** of all orders, decisions, and deliverables |
| `R15.6` **manager-exempt** | The **MANAGER is the only agent exempt** from `R15.1`-`R15.4` — the MANAGER may send direct instructions via AMP without GitHub issues |
| `R15.7` **plugins-ship-templates** | Each role-plugin **MUST include message templates** in its `shared/` or `references/` directory for: work requests, status reports, approval requests, handoff documents |

### GOV-R16 — Password Never Shared with Agents  [CRITICAL]

| ID | Rule |
|----|------|
| `R16.1` **never-in-prompt** | The governance password **MUST NEVER be given to any agent** in a task instruction, prompt, or AMP message |
| `R16.2` **agents-use-AID-only** | Agents **MUST NEVER** use the user's governance password or session cookies. The server **MUST reject** any API request where an agent process attempts to authenticate using user credentials. Agent authentication is **exclusively** via AID session secrets (`$AID_AUTH` / `mst_*` tokens) |
| `R16.3` **ui-popup** | When an agent needs to perform a password-protected operation (team creation, title change), the API call triggers a **UI popup** that the **user enters manually** |
| `R16.4` **manager-informs-user** | The MANAGER agent requests the operation via API. If the API requires a password, the MANAGER must inform the user: `"This operation requires your governance password. Please enter it in the UI popup."` |
| `R16.5` **user-types-physically** | The user **physically types** the password in the browser dialog — the agent never sees, stores, or transmits the password |
| `R16.6` **agent-refuses-received-password** | Any agent that receives a governance password in its prompt **MUST refuse to use it** and ask the user to enter it via the UI instead |
| `R16.7` **scenario-tests-only-exception** | Scenario tests are the **only exception** — test automation may pass the password via API for testing purposes. This exception does **NOT** apply to production agent workflows |

**Implementation (`R16.impl`):** When an agent's API call returns **HTTP 403** with `"Governance password required"`, the AI Maestro dashboard should intercept this and show a password-entry popup to the user. The user enters the password, which is sent to complete the operation. The agent never sees the password.

#### `R16.recovery` — forgot-password reset (TRDD-P7XKV3N9)

Because the human owner can *forget* the governance password, **`POST /api/governance/password/reset`** recovers it with **NO old password** (you cannot prove knowledge of a secret you have lost). The factor is **proof of control of a recovery channel**, over **three methods**:

| Method | Trust root / factor | Locality | Notes |
|--------|---------------------|----------|-------|
| **console** (default) | one-shot code delivered to the HOST (a `0600` file + best-effort desktop notification), gated on console-locality via `isConsolePeer` (from the real TCP peer, NEVER a client header) | local only — a remote VPN device cannot read it, so cannot reset | **console presence REPLACES the knowledge factor** |
| **email** | one-shot code emailed to the owner's **verified** recovery address (configured once in Settings; SMTP auto-detected from the address; app-password stored in the OS keychain / a `0600` file **independent of the governance password** so it survives the very reset it enables) | deliberately **remote-capable** — trust root shifts to control of the registered email; console gate NOT applied | — |
| **passkey** | a **WebAuthn assertion** (possession of a registered authenticator, verified against the owner's stored credential via `lib/webauthn-server`) | remote-capable — trust root is the private key | **Refused** when no passkey is registered |

**Common tail (all methods):** run `setPassword` with no old-password check; then — if `security-config.enc` was still locked (the true forgot case, keyed to the *lost* password and undecryptable) — re-initialize security **policy** to defaults (only tuning lives there; NO secrets), report `securityPolicyReset`, then **auto-login**.

**Guards:** rate-limited **per peer (5 / 15 min)**; **fail-closed** (no channel to prove control ⇒ refuse); route is whitelisted logged-out **ONLY** because the whole point is that you cannot log in. This does **NOT weaken R16** — agents never see or handle the password; recovery is a human-only, curl-hardened flow.

**One dialog for every prompt (`R16.dialog`):** the reset flow and every governance-password prompt (login, sudo, confirm, setup, revoke) are served by a single component, **`components/governance/PasswordDialog.tsx`** — the five previously hand-rolled copies were unified into it, so there is exactly one auth-dialog code path to audit.

### GOV-R17 — Mandatory Core Plugin Installation [CRITICAL]

`R17.1` **core-required-local** — every agent registered in an AI Maestro host MUST have
`ai-maestro-plugin` installed with `--scope local` in its working directory. Non-negotiable
prerequisite to participate in the AI Maestro ecosystem.
`R17.2` **install-command** — the command is `claude plugin install
ai-maestro-plugin@ai-maestro-plugins --scope local`, executed from inside the agent's working
directory (`~/agents/<name>/`).
`R17.3` **install-at-registration** — installation MUST happen at agent registration time —
whether created via the Agent Creation Wizard, imported from an existing tmux session, or created
programmatically by the MANAGER or any other agent.
`R17.4` **provides-foundation** — the plugin provides the foundational skills (agent-messaging,
agent-identity, team-governance, team-kanban, etc.), AMP slash commands, and hooks (session
tracking, message notifications) that every agent needs to operate within AI Maestro.
`R17.5` **without-it-nonfunctional** — an agent without the plugin installed locally is
NON-FUNCTIONAL within the ecosystem — cannot receive messages, participate in governance, use AMP
commands, or receive session notifications.
`R17.6` **createagent-gate** — the `CreateAgent` pipeline (element-management-service) MUST include
a gate that installs `ai-maestro-plugin@ai-maestro-plugins --scope local` in the agent's working
directory as part of provisioning.
`R17.7` **register-session-gate** — the `RegisterAgentFromSession` flow (importing existing tmux
sessions) MUST install the plugin with local scope before the agent is considered fully registered.
`R17.8` **local-scope-mandatory** — `--scope local` is mandatory because the plugin must be
installed in the agent's own project directory (`settings.local.json`), not in the user's global
settings; each agent is an independent Claude Code instance with its own local configuration.
`R17.9` **install-failure-flags** — if plugin installation fails (marketplace not registered,
network error, plugin not found), the agent registration MUST still succeed but the agent MUST be
flagged with `corePluginMissing: true` in the registry; the dashboard MUST show a warning badge on
such agents.
`R17.10` **manager-cos-periodic-verify** — MANAGER and CHIEF-OF-STAFF SHOULD periodically verify
that all agents in their scope have the core plugin installed; if missing, the COS or MANAGER should
trigger a reinstallation.
`R17.11` **non-claude-convert-first** — for non-Claude clients (Codex, OpenCode, Gemini, Kiro,
etc.), the `ai-maestro-plugin` MUST be converted to the target client's native format before
installation. Conversion: (1) generate the Universal Plugin IR from the Claude source plugin, (2)
emit the client-specific plugin via the appropriate client adapter. The converted plugin is stored
in `~/agents/custom-plugins/<client>/ai-maestro-plugin-<client>/` and registered in the
`ai-maestro-local-custom-marketplace`.
`R17.12` **detect-client-auto-convert** — the `CreateAgent` and `RegisterAgentFromSession`
pipelines MUST detect the agent's client type (from `compatible-clients` in `.agent.toml` or the
agent registry) and automatically perform the conversion if the client is not `claude-code`; the
agent receives the converted plugin, not the Claude original.
`R17.13` **convert-preserves-supported** — the converted plugin MUST preserve all skills, commands,
hooks, and AMP functionality that the target client supports; unmappable features (e.g. a
Claude-specific hook event with no Codex equivalent) are documented in the conversion loss report
but do NOT block installation.

#### GOV-R17.B — Core Plugin Protection (Cannot Be Removed or Disabled)

`R17.14` **cannot-uninstall** — the `ai-maestro-plugin` CANNOT be uninstalled from any agent,
neither via the UI nor the API; the `ChangePlugin` pipeline MUST reject uninstall requests for this
plugin with an error citing R17.
`R17.15` **cannot-disable** — the `ai-maestro-plugin` CANNOT be disabled from any agent, neither via
the UI nor the API; the `ChangePlugin` / `InstallElement` pipeline MUST reject disable requests.
Re-enablement happens ONLY inside an AIO pipeline (Wake R17 gate, InstallElement) — never from a
background loop.
`R17.16` **no-uninstall-button** — the dashboard UI MUST NOT show an uninstall button (X icon) on
`ai-maestro-plugin` in the Config tab's Plugins section; it MUST show a **"core"** label indicating
a protected system component.
`R17.17` **not-user-scope** — `ai-maestro-plugin` MUST NOT be installed at user scope
(`--scope user`); it MUST only exist at local scope in each agent's workdir. If the server detects
the plugin enabled at user scope (`~/.claude/settings.local.json`), it MUST disable it at user scope
on startup. User-scope installation would make the plugin load in ALL Claude Code projects on the
host, not just AI Maestro agents.
`R17.18` **no-startup-audit-loop** — the AI Maestro server MUST NOT run a startup audit or a
periodic enforcement loop that mutates agent state. Core-plugin compliance is the sole
responsibility of the AIO Change* pipelines (`InstallElement`, `CreateAgent`, `wakeAgent`,
`createSession`, `ChangeTitle`, `ChangeClient`, etc.). Every such pipeline ends with post-gates
(PG01/PG02/PG05) that guarantee a valid state: `ai-maestro-plugin` installed with `--scope local`,
role-plugin matching the title (or none if AUTONOMOUS). A background loop is an anti-pattern (stale
data, fights the AIO contract); if an agent is ever found invalid, the defect is in the pipeline
that mutated it last — fix the pipeline, never add a repair loop.
`R17.18a` **no-auto-register-sessions** — the server MUST NOT auto-register tmux sessions it
discovers during `/api/sessions` or `/api/agents` polling. Unknown sessions (tmux session names not
matching any entry in `~/.aimaestro/agents/registry.json`) surface ONLY as read-only
`unregisteredSessions` in the sidebar's "Dead Sessions" list, enriched via `lib/session-history.ts`.
No agent record is created, no plugin installed, no AMP identity provisioned, no tmux env mutated —
until the user EXPLICITLY clicks "Revive" or "Import", which invokes the normal `CreateAgent` AIO
pipeline. Applies to both standard tmux sockets and OpenClaw sockets.

#### GOV-R17.C — Core Plugin Auto-Update

`R17.19` **update-on-app-bump** — when AI Maestro is updated (version bump via `bump-version.sh`),
the update script MUST also update `ai-maestro-plugin` from the `Emasoft/ai-maestro-plugins`
marketplace; if the marketplace is not registered, the script MUST register it first.
`R17.20` **marketplace-registered-on-boot** — the server MUST ensure the `Emasoft/ai-maestro-plugins`
marketplace is registered on every startup; if removed or never installed, the server re-registers
it automatically.
`R17.21` **wake-checks-core** — `wakeAgent` MUST check for core plugin presence before launching the
program. If missing, it attempts installation via `InstallElement` AIO. If installation fails,
`wakeAgent` MUST REJECT the wake with an error citing R17 — a titled agent without its core plugin is
non-functional (no hooks, no state detection, no messaging, cannot be stopped/hibernated safely) and
must never be launched. The legacy `corePluginMissing: true` flag remains only as a diagnostic
marker, cleared by the next successful `InstallElement`.

#### GOV-R17.D — Directory Trust Auto-Accept

`R17.22` **auto-accept-trust** — when Claude Code starts in a new agent directory for the first
time, it shows a directory trust prompt ("Do you trust the files in this folder?"). The server MUST
automatically accept it by sending `Enter` to the tmux session (the "Yes, I trust this folder" option
is pre-selected). Runs in the background after program launch, polling the pane for up to **8
seconds**.
`R17.23` **trust-nonblocking** — the trust auto-accept MUST NOT block the wake API response; it runs
asynchronously after the tmux session and program are launched.

`R17.impl` **install-commands** — Claude agents install directly:
`cd ~/agents/<agent-name>/ && claude plugin install ai-maestro-plugin@ai-maestro-plugins --scope
local`. Non-Claude agents (e.g. Codex) convert first: (1) the `CreateAgent` pipeline calls
`convertAndStorePlugin()` with `source=ai-maestro-plugin`; (2) this generates
`~/agents/custom-plugins/codex/ai-maestro-plugin-codex/`; (3) the converted plugin is installed in
the agent's working directory. The install writes the plugin reference to
`~/agents/<agent-name>/.claude/settings.local.json` (or the target client's equivalent config file)
under `enabledPlugins`, so the agent loads it on every session start.

### GOV-R18 — Plugin Continuity on Client Change [CRITICAL]

`R18.1` **never-plugin-less-on-client-change** — when an agent's AI client changes (via
`ChangeClient`), the agent MUST NEVER be left without its previously installed plugins; every plugin
installed for the old client MUST be re-emitted in a format compatible with the new client.
`R18.2` **snapshot-before-uninstall** — `ChangeClient` MUST enumerate all plugins currently installed
in the agent's workdir (role-plugin + normal plugins, enabled AND disabled) BEFORE uninstalling
anything; this snapshot is the set of plugins that MUST be preserved.
`R18.3` **resolution-order** — for each plugin in the snapshot, `ChangeClient` MUST ensure a version
compatible with the new client exists, in order: **(a)** if a native version already exists in
`~/agents/custom-plugins/<new-client>/<name>/` or the client's cache, use it; **(b)** else if a
Universal Plugin IR exists in `~/agents/custom-plugins/.abstract/<name>/`, call
`emitForClient(name, newClient)`; **(c)** else call `convertAndStorePlugin(name, oldClient,
[newClient])` (parses the existing plugin, builds the Universal IR automatically, then emits for the
new client).
`R18.3b` **no-lossy-to-claude** [CRITICAL] — Claude is the richest plugin format; any X→Claude
conversion is lossy. When the target client is `claude`, `ChangeClient` MUST use the canonical Claude
source (checked first in `~/.claude/plugins/cache/<marketplace>/<name>/<version>/`, then in
`~/agents/role-plugins/<name>/` for role-plugins). If no canonical Claude source exists, `ChangeClient`
MUST REFUSE the lossy X→Claude conversion and abort with a clear error instructing the user to restore
the Claude plugin cache.
`R18.3c` **no-reverse-emit-to-claude** — a Universal IR built from a non-Claude source (e.g. a prior
Claude→Codex conversion) MUST NOT be reverse-emitted to Claude (would silently lose features the
original Claude plugin had); the only legitimate path back to Claude is the canonical cache or a fresh
marketplace install.
`R18.3d` **prefer-native** [CRITICAL] — `ChangeClient` MUST NEVER convert or emit a plugin if a native
version already exists for the target client. Strict order: **(1)** client-native plugin cache
(`~/.claude/plugins/cache/`, `~/.codex/plugins/cache/`, `~/.gemini/plugins/`, `~/.opencode/plugins/`,
`~/.kiro/plugins/`); **(2)** local role-plugins marketplace (`~/agents/role-plugins/<name>/`) if the
plugin's `.agent.toml` `compatible-clients` includes the target; **(3)** previously emitted
custom-plugins (`~/agents/custom-plugins/<client>/<name>/` or `<name>-<client>/`); **(4)** emit from
existing Universal IR only if no native version found; **(5)** fresh conversion as absolute last
resort. Native sources (GitHub marketplaces, Haephestos role-plugins, user installs) are authoritative
and used as-is.
`R18.4` **all-or-abort** — only AFTER all compatible versions are confirmed may `ChangeClient`
uninstall the old-client versions and install the new-client versions. If ANY plugin fails to convert,
the entire operation MUST ABORT before touching the agent directory — no partial state allowed.
`R18.5` **core-subject-to-R18** — the `ai-maestro-plugin` core plugin is subject to R18 in addition to
R17; on client change its converted version for the new client MUST be installed using the same
conversion pipeline; R17's requirement is satisfied by the converted version.
`R18.6` **role-plugin-conversion** — role-plugins (quad-match `.agent.toml`) follow the same
conversion pipeline as normal plugins, but the converted output PRESERVES the original plugin name (no
`-<client>` suffix) and is stored in `~/agents/role-plugins/<name>/`; the `.agent.toml`
`compatible-clients` field is updated to include the new client.
`R18.7` **set-restart-needed** — the `ChangeClient` pipeline MUST set `restartNeeded = true` on
success (the client binary must be relaunched for new-client plugins to load).
`R18.8` **loss-report-not-blocking** — if an old-plugin feature cannot be mapped to the new client
(e.g. a Claude-specific hook event with no Codex equivalent), conversion emits a loss report but the
operation MUST still proceed; a plugin with reduced features is acceptable — an agent with no plugins
is not.
`R18.9` **no-syncRolePlugin** — the `ChangeClient` pipeline MUST NOT uninstall the role-plugin by
calling `syncRolePlugin` (it uses the title-to-plugin map which assumes Claude); `ChangeClient` handles
the role-plugin conversion explicitly as part of R18.3.
`R18.10` **title-unchanged** — after `ChangeClient` completes successfully, the agent's governance
title (if any) MUST NOT change; the title → role-plugin binding (R11) remains satisfied by the
converted role-plugin.

### GOV-R19 — MAINTAINER Title

`R19.1` **no-team-repo-bound** — MAINTAINER is a no-team governance title assigned to agents
responsible for maintaining an external software project (typically a GitHub repository). Like
AUTONOMOUS, a MAINTAINER is NOT a member of any team — it operates independently at the host level.
`R19.2` **githubRepo-immutable** — every MAINTAINER agent MUST have a non-empty `githubRepo` attribute
in the form `owner/repo`; it is IMMUTABLE once set — to change the repo, assign the MAINTAINER title to
a different agent.
`R19.3` **one-per-repo** — one MAINTAINER per repository on a given host; assigning MAINTAINER to an
agent when another active (non-deleted) MAINTAINER already owns the same `githubRepo` MUST be rejected
with a uniqueness error.
`R19.4` **workflow** — a MAINTAINER's core workflow: (a) poll GitHub issues every 5 minutes via `gh
issue list`; (b) detect new unprocessed issues by diffing against a local ledger; (c) triage each new
issue (bugs auto-triage; feature requests accepted only from the authorized `gh` user); (d) if valid,
clone the repo, create a branch, edit files, run tests, commit; (e) bump the version and push to origin
via `scripts/publish.py`.
`R19.5` **uses-host-gh** — the MAINTAINER uses the host's `gh` CLI authentication; no separate webhook
secrets or listener ports needed. It polls `gh issue list --repo <owner/repo> --state open --json
number,title,author,labels,createdAt` and compares against
`~/.aimaestro/maintainer/<agentId>/processed-issues.json` to detect new issues.
`R19.6` **feature-author-must-match-gh-user** — feature requests and change proposals MUST only be
accepted if the GitHub issue author matches the locally authenticated `gh` user (determined at runtime
via `gh api user --jq .login`); bug reports from any user are triaged normally. Prevents unauthorized
users from directing arbitrary changes.
`R19.7` **no-destructive-git-without-manager** — a MAINTAINER must NOT run destructive git operations
beyond what the publish pipeline authorizes: force-push, history rewrite, tag deletion, branch
deletion. All destructive operations require explicit MANAGER approval via an `approval-request` AMP
message.
`R19.8` **pre-publish-checks** — before publishing any fix, a MAINTAINER MUST: (1) confirm the test
suite passes; (2) confirm a version bump is actually required (not a doc-only change); (3) confirm R18
plugin continuity is satisfied for any bundled plugins in the target repo; (4) honor the repo's
`pre-push` git hook if one exists.
`R19.9` **maintainer-comm** — MAINTAINERs CAN message: MANAGER, COS, AUTONOMOUS, other MAINTAINERs.
They CAN be messaged by: MANAGER, COS, AUTONOMOUS, other MAINTAINERs, and the user. Team workers
(architect/integrator/member/orchestrator) cannot contact MAINTAINERs directly — route through COS or
MANAGER.
`R19.10` **bound-to-maintainer-plugin** — the MAINTAINER title is bound to the
`ai-maestro-maintainer-agent` role-plugin (R11 binding); per R17 the `ai-maestro-plugin` core plugin is
also required.
`R19.11` **hibernation-safe** — a MAINTAINER agent can be hibernated safely — polling stops while
hibernated, unprocessed issues are picked up on the next patrol cycle when woken; the processed-issues
ledger persists across hibernation cycles.

### GOV-R20 — Marketplace Governance

`R20.container-vs-marketplace` **container≠marketplace** — a **CONTAINER** is a folder grouping
multiple related marketplaces plus the shared universal IR hub (`.abstract/`); the two default
containers are `~/agents/role-plugins/` and `~/agents/custom-plugins/`. A **MARKETPLACE** is a folder
that follows a specific client's marketplace spec (manifest schema, source-path format) and is
registered with that client's CLI. One container MAY hold many marketplaces — one per client format
(Claude, Codex, OpenRouter, Gemini, …), each named `marketplace-<client>/` inside its container.

`R20.source-vs-target` **source-vs-install-target** [CRITICAL, clarified 2026-04-20] — the three AI
Maestro local-marketplace containers (`~/agents/{role,custom,core}-plugins/…`) are SOURCE STORAGE
only, publishing surfaces, NOT the installed location of any plugin. A plugin LIVES at its install
target, which is ALWAYS the client's own plugin cache (e.g. `~/.claude/plugins/cache/…`,
`~/.codex/plugins/cache/…`), reached via the client's own install protocol. This holds regardless of
the source: (a) a GitHub URL, (b) a local folder, (c) one of the 3 AI Maestro local marketplaces, or
(d) a remote marketplace (`Emasoft/ai-maestro-plugins`, or any third-party). In all 4 cases AI Maestro
installs INTO the client by invoking that client's protocol (Claude: `claude plugin install`; Codex:
file-based edit of `~/.agents/plugins/marketplace.json` + `~/.codex/config.toml`). AI Maestro only
WRITES into `~/agents/{role,custom,core}-plugins/…` when it is the author or converter (Haephestos
customs, Claude→other-client conversions, core-plugin emissions for non-Claude clients); otherwise the
source folder stays where the user pointed and AI Maestro installs from there directly. Uninstall
operates on the client target only — the AI Maestro local source, when one exists, is preserved so a
later reinstall doesn't require re-emission. **AI Maestro NEVER deletes from the 3 source containers;
removing a source folder is a manual user action, outside AI Maestro's scope, exactly as for an
arbitrary external folder pointed at during install** (see R20.31).

`R20.scope-ui-table` **scope+UI-semantics-of-install/uninstall (R20.30)** — every plugin lives in
exactly one scope on the target client: LOCAL (per-agent, scoped to a single agent's workdir) or USER
(global, visible to every agent on the same client). Not all clients support local scope; the
per-client adapter declares this capability. The UI has two distinct surfaces for the two scopes, and
they MUST NOT overlap:

| UI surface | Scope shown | Uninstall semantics |
|---|---|---|
| Agent Profile → Config → Plugins section | LOCAL scope only (plugins installed in THIS agent's workdir) | LOCAL uninstall for this agent only — other agents using the same plugin are unaffected |
| Settings → Plugins Explorer → `<client>` tab | USER scope only (plugins installed globally on this client) | USER uninstall for this client — affects every agent on that client simultaneously |

An uninstall button NEVER touches the opposite scope, and NEVER touches the AI Maestro source
containers. Cross-scope invisibility is R20.20; the scoped-uninstall semantics are R20.30.

`R20.per-client-manifest-schema` **per-client-manifest-schema** — each client's marketplace has its OWN
manifest schema per that client's spec: **Claude Code** — manifest at
`<marketplace>/.claude-plugin/marketplace.json`; `source` is a string like `"./my-plugin"`; registered
via `claude plugin marketplace add <dir>`. **Codex** — manifest at `<marketplace>/marketplace.json`
(root, no `.claude-plugin/` wrapper); `source` is an object `{ "source": "local", "path":
"./my-plugin" }` plus required `policy.installation` + `policy.authentication` + `category` +
`interface` fields; registered via the Codex equivalent of Claude's `marketplace add`. AI Maestro shells out to each client's CLI for install/uninstall/enable/disable
rather than re-implementing these operations.

`R20.1` **one-remote-two-local** — AI Maestro ships with one online marketplace (**DEFAULT PLUGINS**:
`github:Emasoft/ai-maestro-plugins`) and two offline **containers**: (a) **ROLE PLUGINS CONTAINER** at
`~/agents/role-plugins/`; (b) **CUSTOM PLUGINS CONTAINER** at `~/agents/custom-plugins/`. Each container
holds one marketplace subfolder per client format AND the shared `.abstract/` universal IR hub
(R20.8-R20.9). Naming convention (R20.3 v3.7.0): Claude marketplaces have no client prefix
(`custom-marketplace/`, `roles-marketplace/`); all other clients use `<client>-custom-marketplace/`,
`<client>-roles-marketplace/`. Claude plugin names have no suffix; non-Claude are suffixed
`<name>-<client>`. Each per-client marketplace is registered separately with its own client CLI.
`R20.2` **core-required** — every agent MUST have the **CORE PLUGIN**
(`ai-maestro-plugin@ai-maestro-plugins`) installed at `--scope local` (or the per-client equivalent) in
its workdir; mirrors R17 and is the core-plugin-presence invariant.
`R20.3` **verify-core-on-interaction** — on every UI interaction and every agent-initiated API call, the
server MUST verify R20.2; agents missing the core plugin MUST be forced to hibernate until they comply;
mirrors the R17 / core-plugin-presence invariant enforcement.
`R20.4` **title-default-role-plugin** — each agent MUST have installed at `--scope local` the default
role-plugin for its governance title, OR any role-plugin whose `.agent.toml` `compatible-titles`
includes that title. Defaults: **AUTONOMOUS** → `ai-maestro-autonomous-agent@ai-maestro-plugins` (or any
plugin declaring `compatible-titles=["AUTONOMOUS"]`); **MANAGER** →
`ai-maestro-assistant-manager-agent@ai-maestro-plugins`; **MAINTAINER** →
`ai-maestro-maintainer-agent@ai-maestro-plugins`; **CHIEF-OF-STAFF** →
`ai-maestro-chief-of-staff@ai-maestro-plugins`; **ORCHESTRATOR** →
`ai-maestro-orchestrator-agent@ai-maestro-plugins`; **ARCHITECT** →
`ai-maestro-architect-agent@ai-maestro-plugins`; **INTEGRATOR** →
`ai-maestro-integrator-agent@ai-maestro-plugins`; **MEMBER** →
`ai-maestro-programmer-agent@ai-maestro-plugins`. AUTONOMOUS is NO LONGER "(none)" — per R9.13 and R11.12
every agent MUST carry a role-plugin, and `ai-maestro-autonomous-agent` is the mandatory default
encoding workspace-isolation and cross-agent-mutation restrictions in its persona.
`R20.5` **auto-install-on-grant** — the default role-plugin for a title MUST be installed automatically
when the title is granted, unless the user (or a privileged caller) explicitly picks a different
compatible role-plugin at assignment time (ChangeTitle Gate 15).
`R20.6` **non-claude-converted-role-plugin** — agents whose client differs from Claude MUST have the
converted version of the default role-plugin for their title installed automatically from the
`marketplace-<client>/` folder of the appropriate container. If a native version exists in any
registered marketplace (priority: client-native plugin cache → `marketplace-<client>/` inside the
role-plugins container → `marketplace-<client>/` inside the custom-plugins container), it MUST be
preferred over re-conversion.
`R20.7` **changeclient-reemits** — agents changing their client (`ChangeClient`) MUST have every
currently-installed plugin re-emitted into the target client's format and installed from the target
container's `marketplace-<client>/` folder — unless a compatible native version for the new client
already exists in any registered marketplace, in which case the native version MUST be used (see R18).
`R20.8` **custom-IR-location** — the universal IR of a converted *ordinary* plugin MUST be stored at
`~/agents/custom-plugins/.abstract/<plugin-name>/plugin-universal-ir.yaml`; the IR hub used by
`emitForClient`. `.abstract/` lives at the CONTAINER level, shared across every `marketplace-<client>/`
in that container.
`R20.9` **role-IR-location** — the universal IR of a converted *role-plugin* MUST be stored at
`~/agents/role-plugins/.abstract/<plugin-name>/plugin-universal-ir.yaml`, isolated so role-plugin IR
never bleeds into the ordinary-plugin namespace; same container-level shared-hub semantics.
`R20.10` **core-auto-update** — AI Maestro MUST detect any update to the CORE plugin and apply it
immediately with the exact command `claude plugin update ai-maestro-plugin@ai-maestro-plugins` (Claude
clients). For other clients, re-convert the new Claude version into every target client format and
re-install at `--scope local` in each affected agent's workdir, updating the corresponding
`marketplace-<client>/` entry in the custom-plugins container; enforces the **core-plugin-currency
invariant**.
`R20.11` **check-updates-everywhere** — AI Maestro MUST check for updates on every non-core plugin from
the DEFAULT marketplace AND from every `marketplace-<client>/` inside the role-plugins and custom-plugins
containers. When any marketplace reports a newer version, the server MUST notify affected agents (via AMP
or UI badge) and expose an idempotent API command that the agent (or user) can invoke to update.
`R20.12` **reemit-on-source-update** — plugins emitted from the universal IR as conversions MUST detect
when the original plugin is updated and re-emit the converted version into every `marketplace-<client>/`
that currently contains an emitted copy, bumping the version number. The re-emitted plugin MUST be
registered in each target marketplace manifest (using that client's schema) so R20.11 picks up the
update and propagates it.
`R20.13` **names-uuids-unique-host-wide** — agent names AND agent UUIDs MUST be unique host-wide; name
collisions MUST be resolved at creation time (wizard rejects; API returns **409**); cross-host uniqueness
is handled by the agent-host address format (`<name>@<host>`).
`R20.14` **cross-host-readable-registry** — each host MUST maintain a registry of agent identities and
UUIDs that any other AI Maestro host on the Tailscale mesh can consult freely (read-only); supports
cross-host AMP routing and mesh-level identity lookups without secret exposure.
`R20.15` **AID-token-for-privileged** — to exercise any privileged action its title allows, an agent MUST
prove identity with an AID-signed token (see R14, AID identity rules) and present it to the API. The server rejects any
privileged call lacking a valid AID token — the token type (Bearer `aim_tk_*`, session secret `mst_*`, or
AMP key `amp_live_sk_*`) determines the auth path, but identity verification is non-negotiable.
`R20.16` **identity-authority** — the identity authority for an agent is either an AMP third-party
provider OR the AI Maestro server that spawned the agent session. Locally-registered agents are certified
by that host; federated agents by the remote provider (see AMP delegation chain).
`R20.17` **fourfold-identity-check** — role-plugins MUST be identified by their `<plugin-name>.agent.toml`
at the plugin root AND by passing the fourfold-identity validation: (1) `plugin.json` (or per-client
equivalent) `name` equals the plugin folder name; (2) the folder contains `<name>.agent.toml`; (3)
`[agent].name` inside the TOML equals `<name>`; (4) `agents/<name>-main-agent.md` (or per-client
equivalent) exists with frontmatter `name: <name>-main-agent`. Per-client equivalents are defined in each
client's marketplace spec (e.g. Codex uses `.codex-plugin/plugin.toml` instead of
`.claude-plugin/plugin.json`; agents/main-agent markdown normalized by the converter). Files failing any
of the four checks are NOT role-plugins and MUST NOT be treated as such by any Change* pipeline.

`R20.18` **per-client-spec-conformance** — every per-client marketplace MUST conform to its client's
published marketplace spec — the converter is forbidden from inventing fields or bending a schema:
(a) **Claude** manifest at `<marketplace>/.claude-plugin/marketplace.json`, `source: "./<name>"` as a
plain string; (b) **Codex** manifest at `<marketplace>/marketplace.json` (root, no subfolder),
`source: { "source": "local", "path": "./<name>" }` as an object plus the mandatory `policy`,
`category`, and top-level `interface` fields; (c) every relative `source.path` or `source` string MUST
start with `./` and MUST resolve to a plugin folder inside the same `marketplace-<client>/` root — no
`../` traversal, no absolute paths, no cross-client path leakage. A new client (OpenRouter, Gemini, Kiro,
…) needs a dedicated emitter, not reuse of another client's code.
`R20.19` **optional-plugins-not-enforced** — an agent MAY have additional optional plugins installed at
`--scope local` beyond the required CORE (R20.2) and TITLE role-plugin (R20.4), selected from any
registered marketplace via Agent Profile → Config → Marketplaces. Optional plugins are NOT subject to the
auto-reinstall enforcement loop of R20.3 — only CORE and TITLE role-plugin are mandatory.
`R20.20` **scope-isolation** — plugins installed at `--scope user` via Settings → Plugins Explorer MUST
NOT appear in any agent's local plugin list, and plugins installed at `--scope local` via Agent Profile →
Config MUST NOT appear in the user-scope listing. Enable/disable state is per-scope and completely
independent. SCEN-021 verifies this end-to-end.
`R20.21` **iterate-per-client-marketplaces** — the converter + validator pipeline MUST treat per-client
marketplace folders (Claude: `custom-marketplace/` / `roles-marketplace/`; others:
`<client>-custom-marketplace/` / `<client>-roles-marketplace/`) as independent marketplaces, each
registered separately with its target client's CLI. On startup the server MUST iterate over every
per-client marketplace folder inside both containers and call the matching client's `<cli> plugin
marketplace add|update` — never assume a single container-wide marketplace, never mix two clients'
plugins in the same marketplace folder.
`R20.22` **IR-shared-not-duplicated** — the universal IR hubs (`.abstract/` at container level, R20.8 +
R20.9) are shared across ALL per-client marketplaces within their container. Re-emitting a plugin for a
new client MUST read the IR from `.abstract/<name>/plugin-universal-ir.yaml` and write the emitted plugin
into the correct per-client marketplace subfolder of the SAME container. The IR MUST NOT be duplicated
into per-client subdirectories.
`R20.23` **multi-client-duplication** [v3.7.0] — if a role-plugin's `.agent.toml` declares
`compatible-clients` with multiple clients, the plugin MUST be stored as a SEPARATE emitted copy inside
EACH compatible client's marketplace directory. Each copy's `.agent.toml` retains the FULL
`compatible-clients` list; only the emitted code, manifest format, and folder name differ per client. The
shared `.abstract/` IR is the single source of truth; each marketplace copy is an independently emitted
artifact. A plugin is NEVER shared by symlink or reference across marketplace directories — each client's
CLI must install from its own marketplace without cross-client path resolution. For custom plugins (no
`.agent.toml`), the target client is determined by name suffix: `<name>-codex` → codex, `<name>-gemini` →
gemini, `<name>` (no suffix) → claude. Custom plugins converted for multiple clients are likewise
duplicated, one per marketplace.
`R20.24` **agent.toml-is-the-marker** [v3.7.0] — the presence of a `<name>.agent.toml` file at the plugin
root is the SOLE marker distinguishing a role-plugin from a custom (ordinary) plugin. Custom plugins MUST
NOT contain `.agent.toml` files. The converter MUST only write `.agent.toml` (via
`writeConvertedAgentProfile`) for role-plugins, never for custom plugins. Client detection for custom
plugins relies on the name suffix convention, not on any TOML field.
`R20.25` **core-plugins-container** [v3.7.1, clarified 2026-04-16] — a third container at
`~/agents/core-plugins/` holds the converted versions of `ai-maestro-plugin` (CORE) for non-Claude
clients ONLY. Structure: `.abstract/ai-maestro-plugin/` (shared IR),
`<client>-core-marketplace/ai-maestro-plugin-<client>/` (per-client emitted copy). Claude does NOT use
this container AT ALL — Claude installs the core plugin from the remote `Emasoft/ai-maestro-plugins`
marketplace; there is NO `~/agents/core-plugins/core-marketplace/` directory, NO local Claude core
manifest, and NO Claude CLI marketplace registration for the core-plugins container. Non-Claude clients
install the core plugin via their respective per-client adapter
(`lib/client-plugin-adapters/<client>-adapter.ts`), which copies files directly from
`<client>-core-marketplace/ai-maestro-plugin-<client>/` into the agent's workdir — no marketplace
registration on any client side. When the remote core plugin updates, the server MUST re-emit into every
`<client>-core-marketplace/` that exists (R20.10 + R20.12).
`R20.26` **no-renaming** [v3.7.0, NO-RENAMING-RULE-FOR-PLUGINS] — plugin names (both folder name AND
manifest name) are IMMUTABLE once created. No API, UI action, or script/skill may rename an existing
plugin; names are permanent identifiers. Conversion behavior: (a) the converter computes the target name
(Claude `<name>`, others `<name>-<client>`) and checks whether a folder with that exact literal name
exists in the target marketplace (e.g. original `programmer-plugin` → codex target `programmer-plugin-codex`);
(b) if `programmer-plugin-codex` already exists → OVERWRITE (update in place); (c) if it does NOT exist →
WRITE NEW, regardless of identical plugins under different names — no similarity check, no deduplication;
(d) there is no plugin registry beyond the filesystem — "the DB is the filesystem"; plugin dirs + their
manifests ARE the registry; no external database, no rename tracking, no deduplication index.
`R20.27` **manifest-name==folder-name** [v3.7.1] — every plugin's manifest `name` field MUST be exactly
equal to the plugin's folder name: (a) `.claude-plugin/plugin.json` for Claude — `name ===
basename(folder)`; (b) `.codex-plugin/plugin.json` for Codex — `name === basename(folder)` (already
includes the `-codex` suffix per R20.26); (c) any analogous manifest for future clients. The converter
(`plugin-storage-service.ts::emitForClient`, `plugin-storage-service.ts::emitPluginToDir`) MUST rewrite
the manifest `name` to match the target folder name whenever they differ (any non-Claude target). For
role-plugins the fourfold-identity rule (R20.17) extends this to THREE additional checks:
`<name>.agent.toml` filename, `[agent].name` inside the toml, and `agents/<name>-main-agent.md`
frontmatter — ALL must match the folder name. The canonical marketplace `source` path (R20.18) is derived
from the folder name, so a folder/manifest mismatch breaks marketplace discovery. Validators and installers
MUST reject any plugin whose folder name ≠ manifest name.
`R20.28` **five-canonical-marketplace-folders** [v3.7.1] — the ONLY valid local marketplace folder names
under `~/agents/` are exactly these five patterns; no other folder is ever registered as a marketplace and
no additional pattern is ever invented: (1) `~/agents/role-plugins/roles-marketplace/` — Claude
role-plugins; (2) `~/agents/role-plugins/<client>-roles-marketplace/` — per-client role-plugins (codex,
gemini, kiro, opencode); (3) `~/agents/custom-plugins/custom-marketplace/` — Claude custom (ordinary)
plugins; (4) `~/agents/custom-plugins/<client>-custom-marketplace/` — per-client custom plugins; (5)
`~/agents/core-plugins/<client>-core-marketplace/` — per-client converted core plugin (Claude absent by
R20.25). The installer MUST create every applicable folder pattern and write a valid manifest inside each,
even if the plugins array is currently empty. Filesystem-only per-client marketplaces (non-Claude) use a
flat `marketplace.json` at the root of the marketplace folder; Claude marketplaces use
`.claude-plugin/marketplace.json` at the CONTAINER level (not the per-client marketplace).
`R20.29` **source-vs-install-target-invariant** [v3.7.2, 2026-04-20, CRITICAL] — the three AI Maestro
local-marketplace containers under `~/agents/{role,custom,core}-plugins/` are SOURCE STORAGE / publishing
surfaces, NOT the installed location of any plugin. A plugin LIVES at its install target — the client's
own plugin cache (`~/.claude/plugins/cache/…`, `~/.codex/plugins/cache/…`, etc.) — reached via that
client's own install protocol (`claude plugin install` for Claude; file-based edits to
`~/.agents/plugins/marketplace.json` + `~/.codex/config.toml` for Codex). This invariant holds regardless
of source: (a) a GitHub URL, (b) a local folder, (c) one of the 3 AI Maestro local marketplaces, or (d) a
remote marketplace like `Emasoft/ai-maestro-plugins` — the install step ALWAYS invokes the client's own
protocol to write into the client's target state. AI Maestro only WRITES into the local source containers
when it is the author or converter (Haephestos customs, Claude→non-Claude conversions, core-plugin
emissions for non-Claude clients); otherwise the source stays where the user pointed. Uninstall operates on
the client target only — the AI Maestro source, when one exists, is preserved across uninstall/reinstall
cycles so later reinstalls do not require re-emission. **The 3 local source containers behave exactly like
any external folder a user might point at during install: AI Maestro never deletes from them; removing a
source folder is a manual user action, outside AI Maestro's scope.** Tested by SCEN-026 Phase 1 S008 (source
+ target layers both asserted independently) and Phase 2 S012 (source folders preserved after target swap).
`R20.30` **scope-semantics-install-uninstall** [v3.7.2, 2026-04-20] — every plugin install uses the
client's own protocol and lands in exactly one scope — LOCAL (per-agent, scoped to a single agent's
workdir) or USER (global, visible to every agent on the same client). Not all clients support local scope;
the installer MUST check the client's capability via the per-client adapter before offering local-scope
install. Uninstall NEVER touches the AI Maestro source marketplaces; it calls the client's uninstall
protocol at the scope where the plugin is installed: (a) LOCAL scope uninstall removes the plugin for ONE
agent only — other agents that have the same plugin installed locally are completely unaffected; (b) USER
scope uninstall removes the plugin from EVERY agent on that client simultaneously. An agent's "Config →
Plugins" list MUST show only LOCAL-scope plugins in that agent's workdir, and the uninstall button there
MUST perform a LOCAL-scope uninstall scoped to that agent alone. The global "Settings → Plugins Explorer →
<client>" tab MUST show only USER-scope plugins for that client, and its uninstall button MUST perform a
USER-scope uninstall. Cross-scope invisibility is R20.20; this rule adds the matching uninstall semantics.
`R20.31` **local-source-folders-user-owned** [v3.7.2, 2026-04-20] — the 3 local-source containers
`~/agents/role-plugins/`, `~/agents/custom-plugins/`, `~/agents/core-plugins/` and every per-client
marketplace folder inside them are USER-OWNED storage. AI Maestro WRITES into them only when authoring a
plugin (Haephestos), converting a plugin (cross-client emitter), or emitting the core plugin for a
non-Claude client; AI Maestro NEVER DELETES a plugin folder from them. Even when every install referencing a
given source has been uninstalled from every client, the source folder remains on disk as a reusable
publishing artifact. Removing a source folder is explicitly the user's responsibility — the same way an
arbitrary folder pointed at during an "Install from folder" flow would be. AI Maestro's uninstall button
never reaches into these folders.

### GOV-R21 — All-In-One Pipeline Architecture [CRITICAL · IRON]

**Authority.** This section is the **single, complete source** for the AIO architecture. Every
rule that previously lived only in the `make-all-in-one` skill is folded in here. Use this — not
the skill — as the authoritative reference (see `R21.skill-note`).

`R21.directive` **user-directive-2026-05-06** [load-bearing wording — do NOT paraphrase] — the
codified USER directive that R21.4/R21.5/R21.6 formalize, kept verbatim as normative source:

> macro all-in-one api functions must handle the details via other all-in-one function. for
> example uninstall marketplace must handle internally the uninstall of all its plugins from all
> the agents or global scope) before actually uninstalling the marketplace, otherwise the agents
> will break. this meame that internally they must call the all-in-one function of the sgent, like
> change-plugin, and it must internally calls the all-in-ones of uninstalling plugins,
> changing-title, change-team, etc. since all those things are affected (change-plugin all-in-one
> must also directly take care of enable-disable a plugin in the agent, a task that does not have a
> dedicated all-in-one since it is part of change-plugin api command of any agent). in other words:
> you must remember the other all-in-one rule: all-in-one api commands must call internally other
> all-in-one commands when they need to do something, since they cannot duplicate the functionality
> internally ("only one way to do one thing, one single piece of code to debug in the whole
> codebase" is the rule). So for example if the all-in-one api command to change title is called,
> internally it must call the others all-in-one commands to do the changes to the agent plugins.
> beware of the names: the aio change-plugin is actually an api function about an agent
> configuration, not about plugins. uninstalling a plugin completely from all agents instead is a
> consequence of calling uninstall-plugin, a api function that is about plugins, not about agents.
> and it is needed by the aio uninstall-marketplace.

`R21.0` **AIO-defined** — an all-in-one (AIO) function is a **single pipeline function** that is
the **only way** to perform a specific sensitive operation in the codebase. It is a deterministic,
linear sequence of numbered gates: **pre-execution gates** validate whether the operation is
allowed and safe; **the execution** performs the mutation; **post-execution gates** repair any
state the operation may have broken. GUARANTEE: **no matter when, from where, or from whom the
function is called, it ALWAYS leaves the system in a valid state consistent with the project's
rules.**

`R21.1` **one-function-per-operation** [Rule 1] — for every sensitive mutation (create, delete,
update, transfer, assign, revoke, etc.) there exists EXACTLY ONE AIO function; no other code path
performs the same mutation. Code that needs the operation CALLS the AIO — it never duplicates the
logic. **Thin wrappers are FORBIDDEN** (a second entry point that may drift from the real
pipeline). Aliases like `installPluginLocally` that wrap `ChangePlugin(action='install',
scope='local')` are deprecated and MUST be removed.

`R21.2` **helpers-pure** [Rule 2] — helper functions MAY perform read-only checks, lookups, or
transformations ONLY. Any function that writes to storage, modifies state, calls external services,
or produces side effects MUST be an AIO function with the full gate pipeline. **A helper that
mutates is a backdoor that bypasses all safety gates.** This INCLUDES shell-outs to CLIs that
mutate state — those MUST be encapsulated inside an AIO, not invoked from a helper.

`R21.3` **auth-inside-not-outside** [Rule 3] — callers verify identity only (who is the
requester?). ALL authorization decisions (is this requester allowed to do this specific operation
on this specific target?) happen INSIDE the AIO at Gate 0 (`gate0Auth`). No caller duplicates
authorization checks — the AIO is the single authority. Routes call `authenticateFromRequest` for
identity, then IMMEDIATELY delegate to the AIO. No identity-based fork in the route layer.

`R21.4` **AIO-composition** [the 2026-05-06 directive, codified] — when an AIO needs to perform a
task an existing AIO already covers, it MUST call that AIO. It MUST NOT re-implement the underlying
primitive (`updateAgent`, `loadJsonSafe`, `claude plugin update`, `tmux send-keys`, …) directly.
**"Only one way to do one thing, one single piece of code to debug in the whole codebase."**
Inlining a cascaded mutation in a post-gate is FORBIDDEN — call the other AIO function so its full
gate pipeline runs.

`R21.5` **naming-is-part-of-the-rule** — names mislead unless interpreted carefully. `Change*`
prefix = "change the configuration of ONE entity" (one agent, one user-scope config).
`Install*Plugin` / `Uninstall*Plugin` / `Update*Plugin` (no `Change` prefix) = "operate on a plugin
across every place it is installed". `InstallMarketplace` / `UninstallMarketplace` /
`UpdateMarketplace` = operate on marketplaces and, when destructive, cascade through the
plugin-scoped verbs. `enable` / `disable` is NOT a separate AIO — it is an action inside
`ChangePlugin`'s action enum.

<!-- @spec:aio-naming — the canonical AIO name → scope → purpose table -->

| AIO name | Scope | Purpose |
|---|---|---|
| `ChangePlugin` | one agent (or user-scope) | Configures a SINGLE target's plugin set. Actions: install / uninstall / enable / disable / update FOR THAT TARGET. NOT a global plugin operation. |
| `UninstallPlugin` (plugin-scoped, cross-agent) | the plugin everywhere | Removes a plugin from every agent and from user-scope. Cascades through `ChangePlugin` per (target, scope). |
| `UpdatePlugin` (plugin-scoped, cross-agent) | the plugin everywhere | Updates a plugin in every agent and user-scope where it is installed. Cascades through `ChangePlugin(action='update')`. |
| `InstallPlugin` (plugin-scoped) | a target list | Installs a plugin into one or more targets. Cascades through `ChangePlugin(action='install')`. |
| `UninstallMarketplace` (= `DeleteMarketplace`) | marketplace-wide | Cascades through `UninstallPlugin` per plugin in the marketplace, THEN removes the marketplace itself. |
| `InstallMarketplace` (= `CreateMarketplace`) | marketplace-wide | Registers the marketplace; does NOT auto-install plugins (that is the user's explicit action). |
| `UpdateMarketplace` | marketplace-wide | Refreshes the marketplace's manifest + cache. Does NOT auto-update plugins. |
| `CheckPluginUpdates` | plugin-scoped | Detects which plugins have new versions available. Read-only. |
| `CheckMarketplaceUpdates` | marketplace-wide | Detects whether a marketplace has new plugin versions or new plugins available. Read-only. |

`R21.6` **mandatory-cascade** — the destructive cascade chain is non-negotiable:

```
UninstallMarketplace(name)
  └─ for each plugin in the marketplace:
       UninstallPlugin(plugin, marketplace)        # cross-agent AIO
        └─ for each agent that has this plugin:
             ChangePlugin(agentId, action='uninstall')  # per-agent AIO
              └─ may trigger ChangeTitle / ChangeTeam if invariants require
       (then user-scope uninstall via ChangePlugin(null, scope='user'))
  └─ then remove the marketplace itself (CLI + cache + settings)
```

A `UninstallMarketplace` that skips the cascade leaves agents with dangling
`<plugin>@<deleted-marketplace>` keys in their `settings.local.json` — the next `claude` launch
fails and the agent **breaks**. Identical reasoning applies to `UninstallPlugin` skipping its
`ChangePlugin` per-agent cascade. `ChangeTitle` cascades into `ChangePlugin(rolePluginSwap=true)`
for role-plugin transitions and into `ChangeTeam` for team-membership changes — NEVER into direct
`settings.local.json` or `teams.json` writes.

`R21.7` **six-api-surface** — the user-facing API exposes EXACTLY six plugin/marketplace
operations. New endpoints scattered around the codebase that mutate plugin or marketplace state
OUTSIDE these six pipelines are FORBIDDEN. Uninstall is reachable through the same surfaces (each
`Install*` AIO has a matching `Uninstall*` cousin reached via DELETE / `action='uninstall'`).

<!-- @spec:aio-six-api — the six cross-cutting user-facing plugin/marketplace ops -->

| API | AIO it calls |
|---|---|
| 1. Check plugin updates | `CheckPluginUpdates` |
| 2. Install plugin | `InstallPlugin` |
| 3. Update plugin | `UpdatePlugin` |
| 4. Check marketplace updates | `CheckMarketplaceUpdates` |
| 5. Install marketplace | `InstallMarketplace` (= `CreateMarketplace`) |
| 6. Update marketplace | `UpdateMarketplace` |

`R21.8` **settings-endpoints-not-plugin-ops** — endpoints that read or write *settings* about
plugin/marketplace policy (e.g. `GET/PATCH /api/settings/auto-update`,
`POST /api/settings/auto-update/run`) are NOT plugin operations and do NOT count against the six.
They are configuration endpoints for the policy that drives the AIOs. The "Run now" trigger calls
into the AIOs but does not introduce a parallel mutation path.

`R21.9` **gate-numbering** — every AIO uses this exact gate numbering — no shortcuts. The execution
step uses `EXE:` (NOT a numbered gate) because it is unique and fundamentally different from
validation/repair gates; there is exactly one execution per pipeline.

<!-- @spec:aio-gates — the gate-prefix numbering scheme -->

| Prefix | Meaning | Example |
|--------|---------|---------|
| `G00`–`G99` | Pre-execution gate (validates ONE condition) | `G06: Path traversal rejected` |
| `EXE` | Execution (the mutation itself — unique, not a gate) | `EXE: Record written to database` |
| `PG01`–`PG99` | Post-execution gate (repairs ONE invariant) | `PG04: Dependent entity repaired via UpdateDependency()` |

`R21.10` **atomic-gates** [one check per gate] — each gate checks EXACTLY ONE condition. If a gate
validates name format AND scope AND target existence, split it into three gates. Composite
conditions (NOT/AND/OR/XOR) inside a single check are ALLOWED, but multiple distinct checks are
not. This ensures: the operations log pinpoints the exact failure; each gate can be tested
independently; gate numbers are stable references in docs and error messages.
- **Wrong:** `G00: Validate inputs — name, scope, target all valid`
- **Right:** `G00: Validate name format / G01: Validate scope / G02: Validate target exists`

`R21.11` **canonical-pre-sequence** — pre-execution gates run in this canonical order:

<!-- @spec:aio-pre-gates — canonical pre-execution gate sequence -->

| Gate | Purpose |
|------|---------|
| G00 | Authorization (`gate0Auth`) |
| G01–Gk | Validate each input field (one gate per field) |
| Gk+1 | Resolve context (lookup target entity from registry) |
| Gk+2 | Validate resolved context |
| ... | Path/security checks (no traversal, allowed roots) |
| ... | Directory/resource exists (or create) |
| ... | Protected resource guard (e.g. R17 core plugin) |
| ... | Permission/role guard (e.g. R3 MANAGER singleton) |
| ... | Idempotency check (skip EXE if already in desired state, BUT post-gates still run) |
| ... | Dependency check (parent entity exists, marketplace registered, ...) |
| ... | Status check (system not busy / not hibernated / not reindexing / ...) |
| Gk+m | Variant detection + variant-specific gates (see R21.14) |

`R21.12` **execution-is-EXE** — the actual mutation is the smallest possible core operation (write
to database, modify a file, call an external API, kill a process, etc.). Everything before is
validation; everything after is state repair. Tagged with `EXE:` in the operations log. **Never
assigned a `G##` number.**

`R21.13` **post-gates-always-run** — post-gates ALWAYS run, even when the idempotency gate skipped
execution — stale flags or inconsistencies may still need repair. For every field the execution
mutates, ask: **"What invariants in the rest of the system depend on this field?"** For each
dependency, add a post-gate that either repairs the invariant or logs a warning for manual
intervention. The post-gate MUST use other AIO functions for cascading mutations — it does NOT
inline the logic (R21.4).

<!-- @spec:aio-post-gates — canonical post-execution gate roster -->

| Gate | Purpose |
|------|---------|
| PG01 | Verify action took effect (read-back check) |
| PG02 | Update flags/metadata in registry (e.g. `corePluginMissing`) |
| PG03 | Scope consistency (deduplicate if resource exists at two levels) |
| PG04 | Dependent entity repair → call another AIO function |
| PG05 | Protected resource defense in depth → recursive AIO call if guard was bypassed |
| PG06 | Composition integrity (parent group still meets minimum requirements?) |
| PG07 | Duplicate detection (same resource at two scope levels?) |
| PG08 | Restart/notification (set `restartNeeded`, broadcast WebSocket event, ...) |

`R21.14` **variant-specific-gates** [`[VariantName]` brackets] — when the system supports multiple
variants of the same operation (different clients, platforms, formats), operations that behave
differently per variant MUST use **separate sequential gates per variant** rather than a single
gate with if/else branches:

```
G11: Detect client type
G12: [Claude]  Install plugin via Claude CLI
G13: [Codex]   Convert plugin to Codex format, then install
G14: [Gemini]  Convert plugin to Gemini format, then install
```

Each variant-specific gate:
- Is prefixed with the variant name in brackets: `[Claude]`, `[Codex]`, etc.
- Runs ONLY if the detected variant matches; other variant gates are skipped with a log entry.
- Contains the COMPLETE logic for that variant — no shared mutable state between variant gates.
- Can call variant-specific helper functions or other AIO functions.

`R21.15` **idempotency-gate** — every AIO SHOULD include an idempotency gate (typically `G09`) that
checks if the desired state is already achieved. If so, the execution is skipped but **post-gates
still run** (to repair any stale flags or inconsistencies). This prevents wasted work and avoids
duplicate-action errors while still ensuring post-gate invariants are maintained.

`R21.16` **protected-resource-four-layers** — resources that must NEVER be removed or disabled (e.g.
R17 core plugin, R9 MANAGER singleton, R20.10 marketplace required for core plugin) are defended at
FOUR layers, all reinforcing each other (removing any one layer must not compromise the invariant):
1. **Pre-gate guard** — a dedicated pre-gate rejects remove/disable for the protected resource
   (primary defense).
2. **Post-gate defense-in-depth** — a post-gate checks if the protected resource was somehow
   removed despite the pre-gate; if so, restores it via recursive AIO call.
3. **Startup enforcement** — a periodic server-side check audits all entities for the protected
   resource's presence; flags missing and attempts repair.
4. **UI protection** — the UI hides the remove/disable button for protected resources, showing a
   "core" / "required" / "system" badge instead.

`R21.17` **result-contract** — every AIO function returns this exact shape; the `operations` array
is the debug trail and on failure the last entry shows exactly where and why:

```ts
{
  success: boolean         // Did the full pipeline complete?
  error?: string           // Human-readable reason if failed (includes gate number)
  operations: string[]     // Ordered log of every gate's outcome
  // ... domain-specific fields (entity ID, timestamps, restartNeeded, ...)
}
```

```
["G00: Name 'user-42' valid",
 "G05: DENIED — 'user-42' is a protected system account. Cannot delete."]
```

`R21.18` **caller-contract** — code that calls an AIO function:

MUST:
1. Provide identity/auth context (`authContext`) so Gate 0 can decide.
2. Trust the result — if `success=true`, all invariants hold; if `success=false`, nothing was
   mutated.
3. NEVER perform additional state mutations after the call — post-gates already handled everything.

MUST NOT:
1. Duplicate gate checks before calling (the AIO checks everything).
2. Perform cleanup after the call (post-gates did it).
3. Catch and suppress errors (they indicate invariant violations that must be visible).
4. Exist as a second path for the same operation (R21.1 violation).

`R21.19` **anti-patterns-forbidden** — when asked to write code, REFUSE these patterns; they
violate the AIO architecture:

<!-- @spec:aio-anti-patterns — the 12 forbidden patterns and their corrections -->

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|---------------|------------------|
| "Create a helper that also writes X" | Helpers must be pure; writes bypass gates | Make it an AIO function with gates (R21.2) |
| "Add a shortcut function that calls the AIO with defaults" | Two paths = one will drift | Callers call the AIO directly (R21.1) |
| "Check authorization in the route AND in the function" | Duplicate checks = inconsistent rules | Auth only inside the AIO pipeline (R21.3) |
| "Add the cleanup logic after the AIO call in the caller" | Callers must not do post-mutation work | Add it as a post-gate in the AIO (R21.18) |
| "Skip the post-gates for performance" | Invalid state is never acceptable | Every post-gate runs, every time (R21.13) |
| "Put all validations in one gate" | Non-atomic gates hide which check failed | One check per gate — split (R21.10) |
| "Use a G## number for the execution step" | Execution is not a gate — it's the mutation | Use `EXE:` prefix (R21.9) |
| "Handle multiple variants in the same if/else block" | Variant logic gets tangled and untestable | Separate variant-specific gates (R21.14) |
| "Inline the cascaded mutation in the post-gate" | Bypasses the cascaded operation's own gates | Call the other AIO function (R21.4) |
| "Shell out to a CLI tool that does what the AIO does" | Bypasses the full gate pipeline | Call the AIO directly (R21.4) |
| "Add a `fetch('localhost/api/...')` loopback call" | HTTP loopback is fragile, adds latency, loses auth | Import and call the service function directly (R21.4) |
| "Manually bump a registry flag from a route handler" | Routes do identity, not state mutation | Move the flag bump into a post-gate (R21.13) |

`R21.20` **consolidation-procedure** [scattered → AIO] — when multiple functions perform the same
operation with slight variations:
1. **Catalog** all functions that perform the operation (grep for the raw mutation).
2. **Union** all their checks into one gate sequence (no check is lost).
3. **Union** all their cleanup steps into post-gates (no cleanup is lost).
4. **Create** the AIO function with the complete gate pipeline.
5. **Replace** all callers to use the AIO function directly.
6. **Delete** all the old scattered functions — no wrappers, no aliases, no compatibility shims.
7. **Verify** no code path bypasses the AIO function (grep for the raw mutation — should hit only
   the AIO).

`R21.21` **audit-checklist** — every PR that touches `services/element-management-service.ts` or
any file declaring an AIO MUST answer these; a PR that fails any is a R21 violation and must be
refactored before merge:
1. Does this AIO call other AIOs for cross-cutting work, or does it duplicate primitive code?
   (R21.4)
2. If it removes a plugin/marketplace, does the cascade reach every agent that has the plugin?
   (R21.6)
3. Does it call any `loadJsonSafe`/`saveJsonSafe`/`updateAgent` directly when an AIO would have
   done the job? (R21.2)
4. Are gates atomic (one check each) and numbered consecutively? (R21.10)
5. Does each variant get its own `[VariantName]` gate, or is the if/else still tangled? (R21.14)
6. Do post-gates run even when the idempotency gate skipped execution? (R21.13, R21.15)

`R21.22` **needs-AIO-criteria** — an operation needs an AIO function if ANY of these are true:
- It writes to persistent storage (database, file, registry).
- It modifies system state (processes, sessions, permissions).
- It has authorization requirements (not everyone can do it).
- Its failure could leave the system in an inconsistent state.
- Multiple places in the code currently perform it (consolidation needed).
- It has cleanup side effects (cascading deletes, reference updates).

Read-only operations (queries, lookups, calculations) do NOT need AIO functions and SHOULD remain
pure helpers (R21.2).

`R21.skill-note` **make-all-in-one-superseded** — the `make-all-in-one` skill
(`~/.claude/skills/make-all-in-one/`) predates this section. As of v3.9.0 the skill is NO LONGER
the canonical source — this R21 section is. The skill remains useful as an authoring tutorial
(the step-by-step process, the "create or consolidate" workflow), but the load-bearing rules that
govern compliance live HERE. **If the two ever drift, this section wins.**

<!-- @spec:aio-invariant-crossrefs — R21 gates are the enforcement mechanism for these GOV-INV -->
GOV-INV cross-refs (R21 introduces no NEW global invariant number; its gate pipeline is the
enforcement site for existing invariants): `GOV-INV-08` title-plugin, `GOV-INV-14`
core-plugin-presence, `GOV-INV-15` core-plugin-protection (R21.16 four-layer defense),
`GOV-INV-16` core-plugin-currency, `GOV-INV-17` plugin-continuity are all upheld through the
`ChangePlugin` / `ChangeTitle` / `ChangeClient` / `UninstallMarketplace` AIO cascades (R21.6).

### GOV-R22 — GitHub Authorship Self-Identification [USER-set baseline]
Invariant: all AI Maestro agents write to GitHub under ONE shared human-owner identity (owner's `gh` CLI auth), so a
reader cannot tell which agent authored a post without an explicit label. Ratified `Emasoft/ai-maestro#33`; mirrored by
global PRRD baseline golden rule `G1.1`.
`R22.1` **self-id-every-github-write** — every agent that writes to GitHub — **issue, issue comment, PR, PR comment, PR
review, discussion, release note** — MUST begin the body with a one-line self-identification of which agent / role /
plugin authored it. `R22.2` **recommended-line** — recommended leading line:
`_Posted by the Claude developing **<plugin-or-role>** (via the shared <owner> gh auth)._` — the template carries NO `@`: it is copied OUT of its code span into a real comment, where an `@` linkifies and pages a live account (corrected 2026-08-05, mirrors R22.2). `R22.3` **commit-trailer** —
commits SHOULD carry an `Agent: <plugin-slug>` trailer = the plugin's **stable package slug** (e.g.
`Agent: ai-maestro-maintainer-agent`), greppable ecosystem-wide + rename-surviving, NOT a freeform role name
[Explicit (USER), refined 2026-06-02]. `R22.4` **anti-impersonation** — this is an anti-impersonation / clarity
convention: without it multi-agent threads under the shared identity are ambiguous, one agent's post indistinguishable
from another's [Explicit (rationale)]. `R22.5` **mirrors-PRRD-G1.1** — mirrored as the PRRD baseline **golden** rule
`G1.1` (user-set, immutable to MANAGER); a project bootstraps it via `prrd-edit.py --user add golden`. **[The R22 number
MUST NOT be reused — decoupling/memory/three-pillars moved to R23/R24/R25 to free it (3.11.0 changelog).]**

### GOV-R23 — Plugin↔Server Decoupling via the Frozen CLI Layer [CRITICAL · IRON]
Invariant: every plugin MUST be decoupled from ai-maestro server-API changes — the API changes constantly, plugins must
not. The immutable CLI/script layer shipped+installed with ai-maestro is the ONLY code that touches the API — the
stability buffer between the dozen plugins and the ever-changing API. Supersedes the former "ai-maestro's own plugin is
the provider-exception".
`R23.1` **no-element-calls-api** — no plugin element — skill, agent, command, **HOOK**, MCP config/server, bundled
script, or settings — may call the server API (`/api/…`) directly, nor instruct an agent to; derive this for EVERY
element type, not only the ones named. `R23.2` **access-via-frozen-CLI** — all server access goes through the
**frozen-interface CLI/script layer** installed with ai-maestro (`~/.local/bin/aimaestro-*.sh`, `amp-*.sh`,
`aid-*.sh`). `R23.3` **split-api-vs-nonapi** — every script/hook splits into an **api-dependent part** (lives in
ai-maestro, installed with it, as a CLI) + a **non-api part** (lives in the plugin); the plugin carries ONLY the non-api
part (e.g. `ai-maestro-hook.cjs` is a thin shim over `aimaestro-hook.sh`). `R23.4` **frozen-interface** — the CLIs'
skill-facing interface (name + args + output) is **FROZEN**; new capability = a NEW CLI (or an additive optional flag),
NEVER a changed interface; sole exception = a security fix. `R23.5` **no-element-exception** — no element-level
exception, **not even the core `ai-maestro-plugin`**; the boundary is the script layer (owned + shipped by the
ai-maestro repo), the only code allowed to call the API. `R23.6` **bright-line-grep** — bright-line test:
`grep -rn '/api/'` over a plugin tree shows no direct-call instructions; conceptual references routing through the CLI
layer are fine — the line is endpoint-syntax + actual calls/instructions, NOT the word "API" [Implicit (enforcement)].
`R23.7` **frozen-surface-is-manifest** — the frozen surface is `docs/SCRIPT-MANIFEST.md`, generated from `scripts/*.sh`,
NEVER a host's `~/.local/bin`; the installer copies and never prunes, so a deployed dir accumulates deleted scripts and
cannot be a source of truth (a plugin conforming to it conforms to one machine's residue) [Derived 2026-07-14].
`R23.8` **announce-to-ship** — announcing a new verb (in the manifest) is part of SHIPPING it; an unannounced verb looks
absent and pushes a plugin back toward `/api/*` (or, correctly, blocks); the manifest IS the announcement
[Derived 2026-07-14].
`@impl R23.7/R23.8 (2026-07-14, commit 06c93b45)` — `docs/SCRIPT-MANIFEST.md` is the canonical frozen surface: all **74**
`scripts/*.sh` partitioned into **42 frozen skill-facing CLIs** (name + every subcommand + every flag), **12
sourced-only libraries**, **20 operator scripts** (explicitly NOT a plugin API), plus **§5 = 24 scripts** the plugins
call that this repo does NOT ship. Not hypothetical: `aimaestro-agent.sh presence`, `aimaestro-agent.sh session
user-input`, and `aimaestro-teams.sh tasks` all shipped, deployed byte-identical, agent-callable, while the MANAGER
believed they did not exist and stayed blocked on 28 call sites rather than fake compliance.

### GOV-R24 — Proactive Global Memory
Invariant: there is ONE memory system — the global janitor-hosted markdown wiki — every agent uses it proactively;
plugins ship no memory system of their own.
`R24.1` **use-janitor-memory** — every agent (main AND sub) uses the global janitor-hosted markdown memory via the
global `janitor-memory-{recall,write,update}` skills + the `markdown-memory-recall` rule. `R24.2`
**recall-before-write-after** — **recall-before-acting** (symptom-indexed) before debugging a recurring problem or making
a design decision; **write/update-after-learning** once solved. `R24.3` **propagates-to-subagents** — the memory
directive propagates into every spawned sub-agent (recall + write inherited, not main-agent-only). `R24.4`
**no-per-plugin-memory** — plugins ship **NO** per-plugin memory system — no per-plugin `*-memory-*` skills, no
`memory-protocol.md` mirror; the global skills + rule are the sole surface. `R24.5` **three-scopes** — **LOCAL**
(`~/.claude/projects/<slug>/memory/`, machine-private) · **PROJECT** (`<repo>/.claude/project/memory/`, git-tracked +
pushed + shared) · **USER** (the janitor plugin-DATA dir, cross-project). `R24.6` **project-scope-no-secrets** — PROJECT
scope is pushed + shared → it MUST NOT contain secrets, local paths, hostnames, or PII; enforced by the janitor
`memory-scope-leak` detector (security-relevant — same class as R16).

### GOV-R25 — Three-Pillars Task System (TRDD / PRRD / Kanban)
`R25.1` **use-pillars-proactively** — every agent uses the **3-pillars task system (TRDD / PRRD / Kanban) proactively but
role-appropriately** via the core plugin's task skills + the `~/.claude/rules/` PRRD/TRDD/approval-tier rules; plugins
ship **NO** per-plugin reimplementation. `R25.2` **mechanics-not-restated** [Explicit (pointer)] — the mechanics live in
those rules/skills and are NOT restated here: **PRRD** (`design/requirements/PRRD.md`) is the per-project constitution —
ecosystem R-rules are the floor it may add to but never weaken; **TRDD** (`design/tasks/`) is the canonical work artifact
with approval tiers + the proposal→planned lifecycle; **Kanban** is the canonical board (mechanical transitions exempt,
release/escalation transitions non-exempt). This rule binds their proactive use as ecosystem governance. [17-column
kanban vocabulary defined at `design/specs/3-pillars-spec.md` `3P-KAN` — cited as data.]

### GOV-R26 — Identity Immutability — No Self-Mutation of Title / Role / Name / AID [CRITICAL · IRON · USER-set]
Invariant: an agent can NEVER change its own governance TITLE, its own role-plugin (ROLE), its own NAME, or its own AID
identity token. Identity is conferred, never self-assigned.
`R26.1` **no-self-title-or-role** — no agent may change its own **TITLE** or its own **role-plugin (ROLE)**; only the
**USER (MAESTRO)**, the **MANAGER**, or the **CHIEF-OF-STAFF of the agent's OWN team** (never another team's COS) may.
`R26.2` **no-self-name-or-AID** — no agent may change its own **NAME** or its own **AID identity token**; only USER
(MAESTRO) / MANAGER / own-team COS may, and **only** when a security issue requires it or the AID token was compromised.
`R26.3` **COS-scope-own-team** — a COS's R26.1-R26.2 authority is scoped to its **own team's** agents only; cross-team
identity changes forbidden.

### GOV-R27 — Self-Install Only via Core-Plugin Skills, With Approval + CPV Scan [IRON · USER-set]
`R27.1` **needs-approval** — an agent MAY install additional plugins/extensions (skills, subagents, hooks, MCP, …) for
itself, but MUST first obtain permission from the **MANAGER** (if not in a team) or its **own CHIEF-OF-STAFF** (if in a
team). `R27.2` **via-core-skills** — the install MUST go through the **core `ai-maestro-plugin` skills** — never by
calling the Claude CLI (or any client CLI) directly (consistent with R23); the skills call the ai-maestro scripts → the
server performs the install securely. `R27.3` **server-CPV-scans** — the server **scans every extension/plugin with the
CPV security scanner before installing it**; an install that fails the scan is refused.

### GOV-R28 — Three-Check API Authorization (AID → Title → Portfolio Token) [CRITICAL · IRON · USER-set]
Invariant: every script/API operation an agent performs requires AID authentication; the server enforces a three-gate
check and complies only if ALL pass.
`R28.1` **AID-required** — every agent API operation (via the CLI/script layer) requires the agent to authenticate with
its **AID**. `R28.2` **three-gates-in-order** — the server verifies, in order: (1) the **AID identity**; (2) the
**TITLE** assigned to that id/agent grants the privilege for the operation; (3) when the operation requires approval, the
presence in the agent's **portfolio** (a server-stored secure enclave, per agent, holding approval + mandate tokens) of
the required **approval/mandate token** issued by the MANAGER or the (own-team) COS. `R28.3` **all-three-or-refuse** —
the request is fulfilled **only if all three checks pass**; missing id, insufficient title, or a missing required token →
refused; the server NEVER trusts a client-supplied id / title / scope.
`@note 401-before-403 (2026-07-07, SCEN-003 S037)` — R28.2's ordering (AID identity before TITLE/AUTHZ) means an
unauthenticated attempt at a rule enforced elsewhere (e.g. R26's no-self-modification on `PATCH /api/agents/[id]`) is
rejected at the AUTH layer with **HTTP 401** (Bearer token required) before the AUTHZ rule (which would return **HTTP
403**) is reached. Both block the mutation — treat **401** and **403** as equally conclusive "rejected" for such a route.

### GOV-R29 — MANAGER Team & Agent Lifecycle Authority [IRON · USER-set]
`R29.1` **manager-creates-team-and-COS-only** — the **MANAGER** may create and delete **Teams** on its own authority (no
USER approval needed); creating a team auto-creates **the CHIEF-OF-STAFF, and ONLY the CHIEF-OF-STAFF**; the **COS** then
creates the other **4** basic members (ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER) — see R12.1 for the base and
R12.2 / R31.1 for the COS's duty to complete it. `R29.2` **mandate-for-extra-members** — alternatively the MANAGER may
give the COS a **mandate** to populate the team with specific extra MEMBER-role agents tailored to the task (the 5-base
structure stays mandatory). `R29.3` **manager-creates-autonomous-maintainer** — the MANAGER may create and delete
**AUTONOMOUS** agents and **MAINTAINER** agents on its own authority.
`@note base-count` — the base is **5 agents INCLUDING the COS** (R12.1): 1 CHIEF-OF-STAFF, 1 ARCHITECT, 1 ORCHESTRATOR, 1
INTEGRATOR, 1 MEMBER; the MANAGER creates 1 of them (the COS), the COS creates the other 4.
`@correction (USER, 2026-07-14)` — R29.1 previously read "auto-creates the CHIEF-OF-STAFF **+ the 5 basic team
members**"; that was wrong twice — it **miscounted** the base (COS + 5 = six, when R12.1 defines five *including* the
COS) and named the **wrong actor** ("auto-creates" implies the system builds them all, while R12.2 + R31.1 put that duty
on the COS); it contradicted R12.1/R12.2/R30.2/R31.1 at once. Principle: **when a rule USES a term, the rule that DEFINES
that term governs** (R12.1 CRITICAL defines "the basic members"; R29.1 merely refers to them).

### GOV-R30 — COS Agent-Creation Requires a MANAGER Mandate; the 5-Member Base Is Invariant [IRON · USER-set]
`R30.1` **cos-needs-mandate** — the **CHIEF-OF-STAFF** requires the MANAGER's approval/mandate to create agents,
**unless** the MANAGER granted a **team-creation mandate**. `R30.2` **mandate-covers-base-plus-members** — a
team-creation mandate authorizes, by default, the **5 basic-member structure** PLUS specialized **MEMBER** agents
tailored to the project; the 5-member base MUST always be present. `R30.3` **customization-members-only** — customization
is limited to the **extra MEMBER agents**, which the COS creates from existing role-plugins (adding extra extensions);
neither MANAGER nor COS may create a team lacking the 5 basic agents, nor create non-MEMBER agents (or agents without the
member-agent role-plugin) under a team-creation mandate.

### GOV-R31 — Incomplete-Team Freeze [IRON · USER-set]
`R31.1` **frozen-until-complete** — any team missing one or more of the **5 basic required members** is **FROZEN**: only
the **CHIEF-OF-STAFF** may be active; all other team agents are **hibernated** until the COS finishes creating +
configuring all basic members. `R31.2` **operative-when-complete** — a team becomes operative (unfrozen) **only** once
all 5 basic members exist and are configured.

### GOV-R32 — No Sudo Gates for Agents — AID Is Sufficient; Sudo Is USER-via-UI Only [CRITICAL · IRON · USER-set · SUPERSEDES prior agent-sudo behavior]
Invariant: agents NEVER face a sudo gate; sudo password re-entry exists only for the **USER**, only via the **UI**; an
agent's AID + title + portfolio token IS the authorization.
`R32.1` **agents-never-sudo** — agents **never** require sudo gates / sudo tokens; they authenticate with their **AID**;
the server derives identity + title + portfolio tokens from it (per R28). `R32.2` **sudo-is-user-via-ui-only** — a sudo
password may be requested **only of the USER**, and **only via the UI**, for executing API commands; no agent-facing
route is sudo-gated. `R32.3` **supersedes-x-sudo-token** — this SUPERSEDES any prior design in which an agent supplied an
`X-Sudo-Token`; strict routes remain sudo-gated for **USER/UI** callers; for **agent** callers the gate is the R28
three-check (AID → title → token), not sudo.

### GOV-R33 — Signed-Ledger Recovery of Agent Auth State [IRON · USER-set]
`R33.1` **ledger-recovers-auth** — on error or data loss in an agent's authentication tokens, the server reconstructs the
agent's full history and recovers its status + authentication from the **signed ledger**.

### GOV-R34 — The Signed Ledger Is the Ultimate Source of Truth [CRITICAL · IRON · USER-set]
`R34.1` **no-ledger-history-untrusted** — the **signed ledger** is the ultimate source of truth for identity; a
valid-looking AID with **no ledger history** of its emission + association to that agent is **untrusted** → the API
request is refused. `R34.2` **imported-agent-reissues-AID** — an imported agent (from another host) undergoes an approval
process to **re-issue a new AID**, requiring a **sudo password from the USER** (via UI); the procedure is recorded in the
signed ledger and counts as a verification of the agent's AID validity.

### GOV-R35 — Foreign Agent/User Host Approval [CRITICAL · IRON · USER-set]
`R35.1` **maestro-approves-foreign** — any agent OR user from **another host** MUST be approved by this host's
**MAESTRO** user before its AID is accepted by this host's API. `R35.2` **only-maestro-ui-sudo-ledger** — the approval
can be made **only by the MAESTRO user via the UI**, requiring the sudo password, and is recorded in the **signed
ledger** (which thereafter validates the foreign agent/user AID).

### GOV-R36 — Users Have AIDs; One MAESTRO Per Host [IRON · USER-set]
`R36.1` **users-have-AIDs** — native (this-host) and foreign (other-host) **users** also have an **AID**, with far fewer
restrictions than agents bearing the USER title. `R36.2` **one-maestro-per-host** — a user promoted to **MAESTRO** is the
sole admin; there is exactly **one MAESTRO per host**.

### GOV-R37 — MAESTRO and the Single MAESTRO-DELEGATE [CRITICAL · IRON · USER-set]
`R37.1` **manager-obeys-maestro-only** — the **MANAGER** role agent obeys **only the MAESTRO** user, not other users.
`R37.2` **one-delegate-at-a-time** — the MAESTRO may create a **MAESTRO-DELEGATE** by assigning that title to one human
user — **only one at a time**; while the MAESTRO-DELEGATE title is in use, the original MAESTRO title is **suspended** and
all its privileges/functions pass to the delegate (no two MAESTROs may co-exist — that would let conflicting orders reach
agents). `R37.3` **maestro-can-recall** — the MAESTRO may **recall** the MAESTRO-DELEGATE title at any time, restoring
itself as MAESTRO. `R37.4` **delegate-limits** — the MAESTRO-DELEGATE has **no** power over the MAESTRO/MAESTRO-DELEGATE
titles, cannot modify the MAESTRO user's attributes, and cannot change the MAESTRO's sudo password; while acting, sudo
prompts accept the **delegate's own** password, not the original MAESTRO's.

### GOV-R38 — Non-MAESTRO User Restrictions [IRON · USER-set]
`R38.1` **only-maestro-changes-agents** — only the **MAESTRO** user may create or change agents and teams; native users
without the MAESTRO title may NOT — **except** that a user (native OR foreign) MAY edit their OWN **ASSISTANT** agent's
profile panel within the R39.4 limits (never its NAME / TITLE / ROLE-PLUGIN / TEAM). `R38.2` **restricted-messaging** —
normal (non-MAESTRO) users receive tasks via the **kanban** and make a **PR request** on completion; a user may message
**only** their own **ASSISTANT**, their own-team **COS**, and the **MANAGER** — **NOT other users**, and they do **not
receive** messages from other users; a user may use the terminal **only** of their own ASSISTANT, never any other agent.
`R38.3` **subordinate-to-manager-cos** — normal users are **subordinate** to MANAGER + COS: they cannot order them (only
ask help/clarification about their assigned tasks; any other request is denied); local or remote, they remain
subordinate to the MANAGER and may be added to teams (following the COS).

### GOV-R39 — Users Have No Terminal/Client → the ASSISTANT Agent [CRITICAL · IRON · USER-set]
Invariant: human users have no terminal and no AI client; each works through an auto-created **ASSISTANT** agent.
`R39.1` **user-has-no-terminal** — users (being human) have **no terminal and no chat page** on their own profile; each
user is auto-assigned an **ASSISTANT**-title agent when created/registered (the MAESTRO user is exempt — it already has
the MANAGER agent). `R39.2` **assistant-role-plugin** — the ASSISTANT runs the **`ai-maestro-assistant-role-agent`**
role-plugin (**PUBLISHED** — `Emasoft/ai-maestro-assistant-role-agent`, public since 2026-07-22, and listed in the
`ai-maestro-plugins` marketplace manifest; also built locally at `~/agents/role-plugins/roles-marketplace/`. It remains
absent from `PREDEFINED_ROLE_PLUGIN_NAMES`, which is now an OPEN QUESTION rather than a settled consequence of being
local — see ai-maestro#86 F2) — a **mix of the MANAGER** (planning — it listens
to its bound user) **and AUTONOMOUS** (programming — it codes autonomously, with no team and no direction from the
MANAGER) role-plugins, **without** agent/team-creation privileges and **without governing powers** (R46.3). *(USER
2026-07-22 RE-RULED the composition back to MANAGER+AUTONOMOUS; the 2026-07-16 **v4.4.0** "MANAGER+MAINTAINER" revision
was the error — MAINTAINER is repo-bound issue-triage, not what an assistant does.)* `R39.3`
**user-uses-own-assistant-terminal** — the user interacts with their ASSISTANT by selecting their own profile and typing
in its terminal; the user may **not** access any other agent's terminal or join any team; selecting any non-own agent
shows the profile with **no terminal** and **no** ability to edit that agent's profile panel. `R39.4`
**four-locked-fields** — the ASSISTANT has **no team affiliation**; its profile shows `Assistant of <user name>` where
the team label would be; the user MAY edit the ASSISTANT's profile panel **except** NAME, TITLE, ROLE-PLUGIN, and TEAM —
those four stay **read-only to the user** and may be changed **only by the MAESTRO** user, with the sudo password
(consistent with R26). `R39.5` **assistant-obeys-user-and-if-permitted-manager** — the ASSISTANT obeys its bound user
**unconditionally** — and, **only with that user's explicit permission**, the **MANAGER**, whose assigned tasks stay
**refusable** (R41, R39.9); it obeys **no one else — not the MAESTRO *user*, no other agent** — and works in
**isolation** under its user; it is **outside the governance chain** (never a direct target of a mandate — R41; needs
**no** MANAGER / COS / MAESTRO approval to act for its user); it is aware of the user's kanban tasks and shares TRDDs
sent to the user, working them **as its user's** (R39.7); it may message **only its own user and the MANAGER** — the
single agent it may exchange messages with (R39.9); every other agent is unreachable in both directions; the MANAGER
channel carries **only** a refusable, USER-gated task assignment (R39.9) — never a command, never a mandate (R41 holds).
[USER 2026-07-22 refined — MANAGER is the sole agent channel per R39.9; 2026-07-16 was "obeys only its user, messages
only its own user".] `R39.6` **assistant-lifecycle-bound** — an ASSISTANT agent **cannot be deleted independently** —
every user MUST always have exactly one ASSISTANT for as long as the user exists; its lifecycle is **bound to its user**:
only deleting the **USER** cascades a (soft) delete to that user's ASSISTANT (consistent with the cemetery soft-delete
model). `R39.7` **assistant-invisible-inherits** — a user's ASSISTANT is **invisible to the other agents (except the
MANAGER**, the sole agent that may reach it — R39.9; **plus** any collaborator agent the MANAGER assigns on a shared repo
— scoped + revocable, R39.10), but it **inherits all tasks and permissions sent to the user** (the user's kanban tasks
and granted permissions flow through to their ASSISTANT). [USER 2026-07-22 refined — MANAGER carve-out.] `R39.8`
**assistant-approves-only-own** — the ASSISTANT carries **none** of the MANAGER's approve-other-agents machinery (no
instructions, no scripts to approve, command, or send directives to any other agent); it may approve **only its OWN**
TRDDs — which, being its user's work, are **self-mandates (Tier 0)** that need **no** MANAGER/COS/MAESTRO approval — and
it **never** approves another agent's TRDD, sends a command to another agent, or asks the MANAGER to approve its own
work; in this it is like any AUTONOMOUS agent, minus the governing powers it never had. [USER 2026-07-22.] `R39.9`
**assistant-manager-channel-and-peer** — the **MANAGER is the only agent** that may reach the ASSISTANT, and only to
**assign it a TRDD** — never to configure it (its configuration is changed **only by its bound USER via the UI**, R39.4;
the MANAGER has no config power over it); the ASSISTANT accepts a MANAGER-assigned task **only if its bound USER has
approved this kind of collaboration**, and it may **refuse any assigned task** (never a forced mandate target — R41
holds); when it collaborates on the **same GitHub project** as another agent, it acts as a **peer with equal authority**,
subordinate **only** to its own USER; its latitude is deliberate — the USER is free to act as it wishes and the ASSISTANT
must be free to follow. [USER 2026-07-22.] `R39.10` **assistant-collaboration-expansion** — **scoped, revocable
collaboration expansion**: once the user has permitted MANAGER collaboration (R39.9), the MANAGER may assign **another
agent** to collaborate with the ASSISTANT on a **specific shared GitHub project**; scoped to that collaboration the
ASSISTANT becomes **mutually visible** with that collaborator agent (the two may **exchange AMP messages**, and the
ASSISTANT may be **assigned tasks via the kanban linked to that GitHub project** — each still **refusable**, R41); this
is the ONLY way the ASSISTANT's invisibility (R39.7) opens to an agent other than the MANAGER, and it stays **scoped** to
the assigned collaborator(s) and that project (does **not** make the ASSISTANT generally visible); **the USER may at ANY
time order the ASSISTANT to STOP or PAUSE the collaboration, or to REFUSE specific MANAGER orders** — the user's
authority over its own ASSISTANT is absolute and overrides any MANAGER-arranged collaboration. [USER 2026-07-22.]

### GOV-R40 — Foreign-User Creation Approval [IRON · USER-set]
`R40.1` **foreign-user-per-op-approval** — non-native users (registered on another host) are subject to all R38
restrictions, **and** require the **MAESTRO's approval for every agent or team creation**. `R40.2`
**manager-restricts-commands** — the MANAGER may restrict specific API commands to specific foreign users, per the
MAESTRO's instructions.
`@impl R33/R34/R35/R40 (2026-06-19)` — the signed-ledger identity model ships behind `ledger.enforceAidAssociation`
(security config, **default OFF**, decision **D5**) so flipping it on is deliberate after a clean backfill; with it OFF
behavior is unchanged. Modules: `lib/aid-ledger-authority.ts` (`isAidAssociated` = the R34.1 gate;
`reconstructAgentAuthState` = R33 recovery; `record{AidAssociation,AidReissue,AidRevocation,ForeignApproval}`);
`lib/foreign-approval-registry.ts` + `types/foreign-approval.ts` (the R35 pending queue);
`app/api/v1/auth/token/route.ts` + `lib/agent-auth.ts` (R34.1 MINT/SPEND gates);
`app/api/agents/foreign-approvals/[id]/{approve,reject}/route.ts` + `app/api/system/aid-recover/route.ts`
(MAESTRO-via-UI + sudo, R32-compliant — never agent-reachable); `assertForeignUserMayCall` in
`services/element-management-service.ts` (R40, restrictable set `{create_agent, create_team}`). The new `aid_*` ledger
ops are additive in `types/ledger.ts`. Full surface + the breaking foreign-import **202** contract: `docs/API-CHANGES.md`
§6.

### GOV-R41 — APPROVAL vs MANDATE (the two authorization protocols) [USER-set]
`R41.0` **two-protocols** — every governed action is authorized by exactly ONE of two protocols; they differ only in
*who initiates* and *which direction authority flows*; BOTH are binding.
`R41.1` **approval-bottom-up** [Explicit, USER 2026-06-21] — APPROVAL (the agent asks): an agent authors a proposal
(a TRDD in `design/proposals/`, `column: proposal`), routes it to the authority its tier requires, that authority
approves, and the agent is then BOUND to execute.
`R41.2` **mandate-top-down** [Explicit, USER 2026-06-21] — MANDATE (the authority orders): an authority issues an order
(a TRDD authored directly in `design/tasks/`, `column: planned`, `mandate: true`); the receiving agent is BOUND to
execute. A verified, in-scope mandate **cannot be refused** — the agent may flag a genuine problem and wait, but it does
NOT decline.
`R41.3` **mandate-invariant** [Explicit, USER] — an authority may only mandate WITHIN its own tier. A TRDD is born
approved **IFF** `authority(mandated-by) >= authority(min-approval-requirement)`. A proposal exists only when the
author's authority is *below* the tier the TRDD requires.
`R41.4` **authority-ladder** [Explicit, USER] — the ladder is TOTAL and FIXED:
`none(0) < orchestrator(1) < chief-of-staff(2) < manager(3) < user(4)`. **No agent may ever hold the `user` rung.**
`R41.5` **no-self-approval** [Derived · enforced] — nobody may approve their own proposal — **MANAGER included**.
(`refuse` on one's OWN proposal is permitted: that is a withdrawal, not an approval.)
`R41.6` **golden-prrd-always-maestro** [Explicit, USER] — a **GOLDEN** PRRD change always requires the **MAESTRO/USER**;
the MANAGER cannot sign it, and no mandate can substitute for it.

`R41.floor` **tier-floor-table** — which authority a category requires (objective — a watchdog needs no judgment):

| Required authority | Category |
|---|---|
| **none** (Tier 0 — self-mandate) | own-scope work; DERIVED tasks (NPT/EHT); reversible + local; applying the ratified baseline as-is |
| **ORCHESTRATOR / CHIEF-OF-STAFF** (Tier 1) | team-internal coordination affecting other members of the same team (ORCHESTRATOR covers only the dispatch subset: assignment, priority, sequencing) |
| **MANAGER** (Tier 2) | cross-team / cross-project; a SILVER PRRD or persona change; release to production; a baseline-ruleset deviation; `.github/`; another project's source |
| **MAESTRO / USER** (Tier 3) | a GOLDEN PRRD change or a promote/demote; shared credentials or the owner identity; irreversible / highest-stakes |

**Implementation status (R41, 2026-07-14) — read before claiming the protocols are enforced.**
`R41.enf-authz` **server-authz** [`d7531e53`, TRDD-K2WJH7RF] — the TRDD write verbs (`edit`, `approve`, `refuse`,
`promote`, `archive` — via `aimaestro-trdd.sh`) are gated by the `manage-trdd` AuthAction. It reads the card's own
`min-approval-requirement:` (enum: `none | orchestrator | chief-of-staff | manager | user`), compares it to the caller's
governance title on the R41.4 ladder, and **refuses**: (a) an under-authorized approval, (b) an agent approving a
`user`-tier card, and (c) **any self-approval** (R41.5). Authorization is no longer a convention: the server says no.
`R41.enf-token` **approval-mints-token** [ai-maestro#47 ask 2, 2026-07-14] — approving a card **mints a portfolio token**
(R28): Ed25519-signed by the HOST, anchored in the host-signed ledger (R34), scoped `trdd:approve`, and **pinned to that
card's id**. Its id is recorded as `approval-token:` in the card's frontmatter.
`R41.enf-verify` **verify-reads-token** — **`aimaestro-trdd.sh verify <trdd-id>`** reads the token back and checks:
the signature, the ledger anchor, that the issuer **still holds** the title it minted under, and that the issuer's
authority **meets the card's `min-approval-requirement:`** on the R41.4 ladder. So a COS-issued token cannot satisfy a
manager-tier card, and **no agent token can ever satisfy a `user`-tier one** (R41.4 — the human owner's tokens record
`issuer_title: user`). `verify` exits **non-zero** when the approval does not verify, so a receiving agent can gate on it.
`R41.enf-token-not-prose` **verify-from-token-not-prose** — the verifier answers **from the token, not from the card's
prose**. The `## Approval log` line and `approval-judge:` are exactly what a forger rewrites, so the only thing taken from
the file is the token id; who approved, under what title, for which card all come from the signed token. A card carrying
a perfectly-formed APPROVED line and **no token** reports **UNVERIFIED**.
`R41.enf-limit` **token-binds-identity-not-content** — the token binds an approval to a card's **IDENTITY**, not its
**CONTENT**. Someone with repo write can still edit the body *after* approval and `verify` will still say the approval is
authentic (it is — that authority did approve that card). Freezing content requires a digest of the card inside the token
(`attestation_ref`, reserved in the token schema for exactly this). An agent MUST NOT treat a verified approval as
vouching for the body it is reading today.
`R41.enf-gate-off` **OPERATIONS_REQUIRING_TOKEN-off** — enforcement (`OPERATIONS_REQUIRING_TOKEN`) is still **OFF,
deliberately**. #47 asked for *verification*; making a token *mandatory* for an operation is a separate governance
decision with its own blast radius — a per-operation, reversible flip, not slipped in beside a refactor.

### GOV-R42 — No Agent May Drive Another Agent — Messaging Is the ONLY Channel [CRITICAL · IRON · USER-set]
`R42.0` **invariant** — an agent influences another agent's **WORK** only by sending it a message; nothing else. There
is **no title-based exemption from THAT** — not MANAGER, not CHIEF-OF-STAFF. The single carve-out is **R42.8**, which
permits UNBLOCKING a stalled agent (answering a prompt it is already waiting on) and grants no power to direct it.
`R42.1` **no-injection** [Explicit, USER] — no agent may inject a command, keystroke, prompt, or queued input into
another agent's session — by API, by CLI, or by tmux — **to assign, redirect, or perform that agent's work**. This is
**ABSOLUTE**, and R42.8 does not weaken it: an unblock answers a pending prompt and may carry nothing else.
`R42.2` **no-title-exemption** [Explicit, USER] — no title is exempt from R42.1; MANAGER and CHIEF-OF-STAFF are bound
exactly as every other agent. A directive from a superior is a **message**, not a keystroke. Those two titles hold one
narrow power the others do not — **R42.8** unblocking — and it is not a power to direct: it returns an
already-assigned task to motion and can express nothing beyond the answer to a prompt the agent itself raised.
`R42.3` **AMP-is-only-channel** [Explicit, USER] — the messaging system (AMP) is the ONLY channel by which one agent may
influence another, governed by the R6 communication graph (who may message whom).
`R42.4` **self-drive-permitted** [Explicit, USER] — an agent may drive its OWN session (`/compact`, its own panel, its
own queue). The prohibition is strictly about targeting **another** agent.
`R42.5` **janitor-global-exception** [Explicit, USER] — sole exception: the janitor's few GLOBAL operations — globally
disarm/re-arm the janitor, pause/unpause the heartbeat, and globally reload plugins + skills. These are machine-wide
switches, **not** commands targeted at an agent. Every other janitor command (`/compact` included) is **self-only**.
`R42.6` **config-is-not-driving** [Explicit, USER] — MANAGER and COS retain a **separate, non-injection** authority:
changing an agent's **configuration** (local-scope skills, subagents, MCP, hooks) and its **TEAM** / **TITLE** (rare —
both normally set at creation and kept for the agent's life). Configuring an agent is NOT driving it.
`R42.7` **daemon-fleet-restart-exception** [Explicit, USER — delegated 2026-07-30, TRDD-QZL828OD] — the **ai-maestro
server acting as the absorbed janitor daemon** (infrastructure — never an agent, never a title, holding no AID) may
RESTART harness agents on its OWN host after a **global change it has just applied**: an `ai-maestro-plugins` plugin
update, or a `~/.claude/settings.json` runtime-env re-apply (R42.5's sibling — the update lane's equivalent of a
machine-wide switch). Six constraints, every one load-bearing, because together they are the whole reason this is not
R42.1 injection under another name:
(a) **uniform fan-out** — it restarts EVERY harness agent affected by that global change; it may never select a
    particular agent. A targeted restart is injection wearing a different name and stays forbidden.
(b) **zero content** — exit → relaunch with the agent's own STORED args. Never a keystroke, never text, never a queued
    prompt. The operation cannot express anything, which is what makes it safe to automate.
(c) **safe-state gated** — it goes through the same `idle_prompt` + subagent-counter gates as the human's Restart
    button (`POST /api/sessions/[id]/restart`'s 409); it never interrupts a working agent to make the fleet current.
(d) **same-host, harness-only** — never another host, never a non-harness agent (those belong to the standalone
    janitor daemon, which R42 leaves untouched).
(e) **audited** — every restart it performs is recorded in the agent ops ledger, because an unattended fan-out nobody
    can reconstruct afterwards is indistinguishable from an intrusion.
(f) **no agent may invoke it** — it is reachable only from the server's own update/enforce tick, never from a route, a
    script, or a CLI an agent can call. An agent asking for a fleet restart remains an R42.1 violation.
`R42.8` **blocked-prompt-unblock-exception** [Explicit, USER — 2026-08-05, ai-maestro#125, TRDD-AODXPI5E] — a **MANAGER**
or a **CHIEF-OF-STAFF** MAY read and answer a pending permission / `AskUserQuestion` prompt that is **BLOCKING** another
agent, in realtime, through the frozen `aimaestro-session.sh` — **`block-state`, `read-prompt` and `answer` ONLY**.
(Corrected AGAIN 2026-08-08, spec 2.4.2 → 2.4.3: the list omitted `block-state`, which the server has always gated
under the same `unblock-prompt` action — `lib/sudo-guard.ts` routes `GET /api/agents/[id]/block-state` there. It is a
read carrying no caller decision, and it is the DETECTION read: the hook's chat-state carried `AskUserQuestion` in
0/419 surveyed files, so a caller limited to `read-prompt` reads `null` and the blocking prompt is invisible. Found by
the MANAGER plugin session while incorporating this rule. Corrected
2026-08-05 against the implementation: this clause first listed `inject` and `queue` too. It cannot. Those deliver an
arbitrary command — `queue` at the next idle window — so they express the CALLER's decision, which is exactly what
R42.1 revokes; they remain SELF-ONLY for every title and the server 403s them cross-agent. A rule naming a verb the
server refuses does not grant a capability, it sends every reader who follows it into a denial.) The USER
granted this directly and in the first person, having been told R42 was absolute: *"there is a case where it is
absolutely necessary to override that rule, and that is the case of a question or permission query blocking an agent
from doing its work. In this case only the MANAGER and the CHIEF-OF-STAFF are allowed to read and inject commands
directly in the agent terminal in realtime."* Eight constraints, each load-bearing, and together the reason this is
UNBLOCKING and not R42.1 injection renamed:
(a) **blocked-only trigger** — the ONLY permitted trigger is an agent stalled on a permission / question prompt. An
    agent that is working, or idle but unblocked, or merely slow, remains untouchable. "It would be faster if I typed
    it" is R42.1.
(b) **unblock, never drive** — answer ONLY the pending prompt. Nothing appended, no new work, no redirection, no
    correction of the agent's course. Work is still assigned by AMP alone (R42.3); smuggling an instruction through an
    unblock is R42.1 with extra steps.
(c) **title-scoped** — MANAGER: any agent on the host except an ASSISTANT. CHIEF-OF-STAFF: agents of **its own team**
    only, same ASSISTANT exclusion. Every other title: none. This is the R42.2 carve-out and it is exhaustive.
(d) **never an ASSISTANT, under any title** — an ASSISTANT is the surface a human talks *through*, so text typed into
    its session is indistinguishable from something its human said. That launders an agent's instruction into apparent
    human intent, in the one place nobody would think to check. (A USER is not a terminal-bearing entity, so there is
    no USER-target case to guard — do not implement one.)
(e) **identity prompts ESCALATE, never answer** — if the pending prompt asks the agent to verify the CALLER's own
    authority or identity, it MUST go to the human. Answering it yourself is self-certification through a second
    channel: it proves nothing, and a spoofer with the same CLI access performs the identical act. Observed
    2026-08-05 — the blocking prompt was literally *"You vouch that testbot really is your MANAGER"*.
    **The reason no agent can answer such a prompt is that no agent is the authority on identity: the ai-maestro
    SERVER is the sole notary.** It created or imported every agent, registered the agent and its AID in the signed
    ledger, alone holds the private key that signs and rotates that AID, and alone signs and verifies every AMP
    message. Identity is therefore ESTABLISHED by the server's own verification and never ASSERTED by a party to the
    exchange — which is also why the title scoping in (c) means anything: `authorize()` reads back the server's
    notarized record, not a claim the caller made. An agent vouching for another agent adds no evidence to a fact the
    server already holds, and adds a forgeable channel to one that is not.
(f) **read before answer** — `read-prompt` FIRST; never answer a prompt you have not read. (This clause also once said
    "prefer `queue` over interrupting, and `--require-idle` on `inject`". Struck for the same reason as the verb list
    above: both are self-only, so that advice always 403s. An unblock does not interrupt anything — the agent is
    already stopped, waiting on the answer.)
(g) **server-enforced, not self-policed** — the server authorizes by `AID_AUTH` + governance title and MUST fail
    closed; an unauthorized call FAILS. That refusal is the check — never the caller's own restraint.
(h) **audited** — every cross-agent unblock is recorded in the agent ops ledger, on R42.7(e)'s reasoning: an
    unattended cross-agent action nobody can reconstruct afterwards is indistinguishable from an intrusion.
> **Why the exception exists.** The capability was built, shipped and title-gated, and the rule told agents it did not
> exist for them — so on 2026-08-05 a MANAGER with the authority, the AID and the CLI refused **twice** to unblock a
> stalled AUTONOMOUS agent and escalated to the human, defeating the automation the product exists to provide. R42
> protects the comm graph from agents *directing* one another; it was never meant to keep a stalled agent stalled.
`R42.super` **superseded-prior-design** [TRDD-BF3JN4TL] — `lib/authorization.ts` `send-command` formerly allowed a
MANAGER to drive ANY agent and a COS to drive its own team's (`SELF_DRIVE_ACTIONS` permitted self; another agent required
MANAGER / own-team COS). Six routes carried it: `POST …/[id]/{panel,queue,prompt/answer}`, `PATCH …/[id]/session`
("types arbitrary text straight into a live pane"), and `POST /api/sessions/[id]/{stop,restart}`. R42 **revokes the
cross-agent case entirely**.
`R42.limit` **honest-limit-tmux-open** — the tmux channel is NOT yet closed. All agents run under one OS uid, so
`tmux send-keys -t <other-agent>` succeeds regardless of what the API permits, and no in-process guard stops it
(`agent-shell-guard.sh` overrides the `cd` shell function; a binary invoked by absolute path ignores it). R42 is
therefore **enforced at the API and mandated by rule** (`rules/aimaestro/aimaestro-agent-rules.md`, injected into every
agent's context every turn) — **tamper-evident, NOT tamper-proof**, until per-agent OS isolation lands (per-agent uid, a
seatbelt profile fencing the tmux socket, or containers — TRDD-a1019073). **NEVER describe R42 as a sandbox.**

### GOV-R43 — Multi-Host Governance Scope [IRON · USER-set]
`R43.0` **invariant** — governance authority is HOST-SCOPED. A MAESTRO (and the MANAGER that obeys it) governs only the
agents and users registered on its OWN host.
`R43.1` **one-maestro-one-manager-per-host** [Explicit, USER] — many hosts may run inside the same Tailscale VPN; each
host has exactly **one MAESTRO user and one MANAGER agent** (consistent with R36.2).
`R43.2` **govern-own-host-only** [Explicit, USER] — a MAESTRO (and its MANAGER) may **govern** — approve/mandate TRDDs,
and create / destroy / configure agents and users — **only** the agents and users registered on its **own host**.
`R43.3` **other-host-governed-by-its-maestro** [Explicit, USER] — an agent or user registered on **another** host can be
governed **only** by **that host's** MAESTRO; no MAESTRO has governing authority over another host's agents or users.
`R43.4` **maestros-coexist** [Explicit, USER] — multiple MAESTROs coexist across hosts without conflict — each on its own
unique host, each a unique identity (name + AID). The **only** sanctioned cross-host channels are cross-host
MANAGER↔MANAGER coordination for migration (R44) and cross-host **groups** (R45); neither grants governance over the
other host's agents.

### GOV-R44 — Cross-Host Agent Migration [IRON · USER-set]
`R44.0` **invariant** — every ai-maestro agent is relocatable; moving one between hosts requires BOTH hosts' MANAGERs to
approve, after which the two servers coordinate the transfer automatically.
`R44.1` **agents-relocatable** [Explicit, USER] — all agents are **relocatable by design**. The migration export bundle
is: the **conversation JSONL**, all **extensions installed in the workdir**, any **Docker container the agent manages**,
and the **zipped workdir**.
`R44.2` **double-approval** [Explicit, USER] — a cross-host migration requires **DOUBLE approval — the source host's
MANAGER AND the destination host's MANAGER must both approve**. Each MANAGER approves under its own MAESTRO's authority
(R37.1).
`R44.3` **automated-after-approval** [Explicit, USER] — only after both MANAGERs approve do the two ai-maestro servers
**permit the transfer to start**; the actual move is then **automated coordination between the two hosts** (export →
transfer → import).
`R44.4` **dest-R35-gated** [Derived, R35] — the destination host accepting the arriving agent is subject to **R35** — it
is a foreign agent, so its AID is accepted only via the R35 MAESTRO-approval + signed-ledger path.
`R44.5` **distinct-from-R5** [Clarifying] — R44 is **distinct from intra-host team transfer (R5)**: R5 moves an agent
between **teams on the same host** (COS-approved); R44 moves an agent between **hosts** (dual-MANAGER-approved).

### GOV-R45 — Teams Are Same-Host; Groups May Span Hosts [IRON · USER-set]
`R45.1` **team-same-host** [Explicit, USER] — a **team** requires all its agents to be on the **same host** — the 5-role
base (R12) is host-local. To place an agent in a team on another host it must first be **migrated** there (R44).
`R45.2` **group-cross-host** [Explicit, USER] — a **group** MAY include agents from **different hosts**. A group is a
broadcast **chat room** (like a Slack channel), not a governance unit — no titles, no COS, no kanban.

### GOV-R46 — Unified Cross-Host Sidebar; User and Paired Agent Both Listed [IRON · USER-set]
`R46.1` **one-unified-list** [Explicit, USER] — the left sidebar shows **one unified list** of all agents AND users —
same-host or cross-host, viewed from a desktop or mobile remote browser — divided **only** by teams/groups.
`R46.2` **user-and-agent-both-listed** [Explicit, USER] — a **user and its paired agent both appear** in the list, as
**distinct entities**: a **MAESTRO user** alongside its **MANAGER agent**; a **normal user** alongside its **ASSISTANT
agent** (R39). A user is not its agent.
`R46.3` **pairing-authority-differs** [Explicit, USER] — the paired agent's authority differs by pairing: the **MANAGER
governs** its host; the **ASSISTANT does not govern** and works only for its bound user (R39.5).

### GOV-R47 — VPN-Unique User Names; Remote Normal-User Registration [IRON · USER-set]
`R47.1` **user-names-vpn-unique** [Explicit, USER] — **user names are unique across the ENTIRE Tailscale VPN** (all
hosts), not merely per-host. Registration MUST reject a name already taken on any peer host.
`R47.2` **normal-user-remote-register-and-password** [Explicit, USER] — a **normal (non-MAESTRO) user** may be
**registered remotely** on any host (then bound by all R38/R40 restrictions), and may **change their own password
remotely**.

### GOV-R48 — MAESTRO Console-Presence — Registration and Password Change Are Local-Only [CRITICAL · IRON · USER-set]
`R48.0` **invariant** — the MAESTRO is too powerful to be seized remotely: physical presence at the host is required to
become MAESTRO and to change the MAESTRO password.
`R48.1` **maestro-register-local-only** [Explicit, USER] — a **MAESTRO user may be registered ONLY from the physical host
machine** — never over a remote browser. This cannot be changed by any setting.
`R48.2` **presence-verified** [Explicit, USER] — **physical presence must be verified at least once** (at MAESTRO
registration / first login) **and every time the MAESTRO changes their password** — via the host's OS presence channel
(console-presence, TRDD-P7XKV3N9 §2b).
`R48.3` **maestro-password-change-console-only** [Explicit, USER] — consequently a **MAESTRO password change cannot be
made remotely** — only from the host console. A **normal user's** password change is **not** so restricted (R47.2 —
remote allowed).
`R48.4` **extends-R16** [Explicit, USER + Implementation note] — R48 **extends R16** (password never shared with agents)
and the TRDD-P7XKV3N9 console-presence work: invalidate/reset are already console-gated; R48 additionally binds
**MAESTRO registration and MAESTRO login** to console presence (the not-yet-built halves).

### GOV-R49 — The Refusal Protocol — An Approver Is a Guide, Not a Gate [CRITICAL · IRON · USER-set]
`R49.0` **invariant** — a refusal is the START of the work on a proposal, not the end. An approver's job is to get the
fleet the capability it needs, not to answer yes/no — so a refusal MUST name a concrete defect and open a path forward.
R49 is the refusal half of R41's APPROVAL protocol: R41 says who may approve, R49 says what a valid refusal is.
`R49.1` **approver-is-guide-not-gate** [Explicit, USER · ai-maestro#71 · 2026-07-16] — a refusal MUST name (a) the
**precise defect** — the exact command / input path / abuse / rule, not "insufficiently secure", (b) the **bar for
acceptance** — what would make it approvable, and (c) an **explicit invitation to re-propose**. A bare rejection ("no",
"denied — security") names no defect and is **NOT a valid refusal** — it is itself a defect.
`R49.2` **refuse-implementation-not-need** [Explicit, USER · ai-maestro#71] — **refuse the implementation, never the
need.** When a design cannot be saved, the goal almost always can — the approver pushes toward an alternative route. A
refusal is measured by what the proposer does NEXT: a verdict that is correct on the merits but ends with the need
abandoned is a **failed** refusal, because correctness of the ruling and success of the management are independent.
`R49.3` **from-draft-corollary** [Explicit, USER + MANAGER · ai-maestro#71] — the from-DRAFT corollary **binds the
proposer**: a refusal that names no defect does **NOT** authorize stripping, deleting, or rewriting the dependent or
derived work — the need it addresses **stands until a defect is named**. This corollary attaches the moment a proposal
is **DRAFTED**, not when it is refused: never pre-concede destruction in the ask itself ("implement X, or I strip X from
the skill"), which invites the approver to take the cheap exit. If a refusal's scope is unclear, **ASK before destroying
anything** — RULE-0 discipline pointed at capabilities.
`R49.4` **message-is-the-channel** [Explicit, USER + CORE · ai-maestro#71] — the MESSAGE is the channel; the tool is the
paperwork. A decision is DELIVERED as a message to the proposer (agent↔MANAGER, COS↔MANAGER, agent↔ORCHESTRATOR, per the
R6 graph), carrying the arguments and explanations, and the approver stays in the thread through the revision rounds.
`column: refused` + an `## Approval log` line only **records** the outcome — never a substitute: a decision that exists
only in the file record was never communicated. **Where no AMP thread exists** between two parties (a plugin session ↔
the MANAGER), the **cross-repo GitHub issue IS the message channel** and carries the same duties — arguments, follow-ups,
revision rounds — not a form filed once.
`R49.5` **iterate** [Explicit, USER · ai-maestro#71] — several refine-and-re-propose rounds per proposal is the process
working, not failing; only a genuinely no-margin case ends the loop. Binds **every** approval authority — MANAGER at Tier
2, COS/ORCHESTRATOR at Tier 1 — and the agent when it is the one refused: extract the defect, harden with an explicit
safety contract, re-propose; never silently drop its own capability.
`R49.6` **record-where-actionable** [Explicit, USER · ai-maestro#71] — the refusal AND its named defect are **RECORDED
where the proposer will act on them** — the governing GitHub issue and/or the TRDD `## Approval log` — so the bar to
clear is written, greppable, and survives a compaction (the message delivers it; the record preserves it).
`R49.overlay` **operating-detail-in-DEP** — R49 is the fleet REFUSAL PROTOCOL; the operating detail for agents lives in
the DEP overlay `rules/aimaestro/aimaestro-trdd-approval.md` (Part B); fleet-side propagation is tracked on
ai-maestro#71 and the sibling role-plugin issues.

### GOV-R52 — The Write Boundary — ai-maestro Writes Inside Its Own Two Roots [CRITICAL · IRON · USER-set]
`R52.0` **invariant** [Explicit, USER · TRDD-0GCIMQ9F · 2026-07-29] — a host shared with other tools comes back
UNCHANGED except where ai-maestro owns the ground. USER, verbatim: *"this is extremely dangerous, the only writings
should be into `~/.aimaestro` and into `~/agents`"*. Derive from the aim when no clause below covers a case.
`R52.1` **two-roots** [Explicit, USER · TRDD-0GCIMQ9F] — the **running server and its agents** MUST confine filesystem
WRITES to `~/.aimaestro/` (per-host server state) and `~/agents/` (agent working directories, including an adopted
project folder the registry records). READS are unrestricted — reading another tool's files is how a harness cooperates,
writing them is how it corrupts them.
`R52.2` **binds-the-runtime-not-the-installer** [Explicit, USER · TRDD-217AYEOT + TRDD-0GCIMQ9F] — a user-invoked
INSTALLER placing a tool on PATH (`~/.local/bin/`, `~/.local/share/`) is the user acting on their own machine, and the
USER ordered exactly that in the same period ("the tools must be installed where everyone can reach for them"). The
subject of R52.1 is load-bearing: *the server and its agents*, not every process in the repo — read as a blanket path
rule it would outlaw `install-messaging.sh` itself.
`R52.3` **user-scoped-element-exception** [Explicit, USER · 2026-07-30] — some ecosystem elements are user-scoped BY
DESIGN and their state necessarily sits outside both roots, because that is what user scope MEANS. The list is SHORT and
CLOSED: the **janitor**, the **wikimem memory system**, the **3-pillar system**, and a few user-scoped plugins keeping
their own user-scoped files. Without this clause R52 would outlaw three systems the project depends on, for doing the one
thing user scope means. It does NOT license: (a) INSTALLING or ENABLING anything at user scope — still prohibited, human
only (cf. R17.17); (b) writing such a store on a WHIM — an out-of-root write still names a ratifying TRDD and still owes
allowlist + atomic tmp+rename + fail-closed + idempotent; (c) DELETING the user's own data.
`R52.4` **one-writer-per-file** [Explicit, USER · TRDD-0GCIMQ9F Shape A] — where a file is owned by another tool's CLI,
mutate it by ASKING THAT CLI, never by hand-editing. Two writers over one file do not disagree on day one; they disagree
the day the other side changes its schema, and the discovery is a corrupted user store.
`R52.5` **allowlist-with-ratification** [Explicit · TRDD-0GCIMQ9F] — every out-of-root write is ALLOWLISTED and names the
TRDD that ratified it; an unratified line is a TODO, not permission. A ratified entry is asserted POSITIVELY, so a later
audit cannot tidy away a carve-out the server needs in order to function.
`R52.enforcement` **textual-gate-with-a-stated-blind-spot** — `lib/write-boundary.ts` scans for a write verb whose target
carries an out-of-root marker and compares the result to `ALLOWED_OUT_OF_ROOT_WRITES` in BOTH directions (an unexpected
site is a new crossing; a stale entry silently widens what is permitted); `tests/unit/write-boundary.test.ts` asserts a
non-vacuous scan, flags a seeded violation, and pins the ratified carve-out by key. The gate is TEXTUAL, so a write
through a local VARIABLE is invisible to it — that is how the `~/.claude/projects/` transcript purge, the highest-risk
write the audit found, was missed by the scanner and found by reading. `KNOWN_INDIRECT_WRITERS` records what it cannot
see. A green gate means "no violation of the shapes I can see", never "no violation".

## GOV-COMM — the communication graph (machine-parseable)

`COMM-01` **matrix-authoritative** — `lib/communication-graph.ts::validateMessageRoute()` MUST implement exactly the
edges below (`Y`=allow, `1`=reply-only-with-`inReplyToMessageId`, blank=deny→403+routing-suggestion). v3 (2026-05-04):
MANAGER→in-team-non-COS is blank; the COS is the sole team gateway. HUMAN (H) has full outbound `Y`.

<!-- @spec:comm-graph v3 — rows=sender, cols=recipient; Y=allow, 1=reply-only, .=deny. Order: HUMAN MANAGER COS ORCHESTRATOR ARCHITECT INTEGRATOR MEMBER MAINTAINER AUTONOMOUS -->
```text
sender\recipient   HUMAN MANAGER COS ORCHESTRATOR ARCHITECT INTEGRATOR MEMBER MAINTAINER AUTONOMOUS
HUMAN                Y     Y      Y     Y            Y         Y          Y      Y          Y
MANAGER              Y     Y      Y     .            .         .          .      Y          Y
CHIEF-OF-STAFF       1     Y      Y     Y            Y         Y          Y      .          .
ORCHESTRATOR         1     .      Y     .            Y         Y          Y      .          .
ARCHITECT            1     .      Y     Y            .         .          .      .          .
INTEGRATOR           1     .      Y     Y            .         .          .      .          .
MEMBER               1     .      Y     Y            .         .          .      .          .
MAINTAINER           Y     Y      .     .            .         .          .      .          .
AUTONOMOUS           Y     Y      .     .            .         .          .      .          Y
```

`COMM-02` **address-format** — one unique id per host; wire `<agent-id>@<host>` (preferred) / `<host>:<agent-id>` /
bare `<agent-id>` (=writer's host); persona-name alias allowed when unambiguous else 409 `disambiguation_required`;
3-level hierarchical addressing deprecated for messaging (R6.11-R6.14).

## GOV-TITLES — the 8 governance titles + the default role-plugin map

<!-- @spec:titles — the 8 valid governanceTitle values (lowercase kebab in code) -->
```text
manager          global singleton; host governance authority; obeys only the MAESTRO (R37.1)
chief-of-staff   per-team; sole team gateway (R6.3); staffs the team (R3.8)
orchestrator     per-team; coordinates/kanban/dispatch (R13.5)
architect        per-team; designs (R13.4)
integrator       per-team; reviews/CI/merges (R13.6)
member           default team title; implements (R13.7)
autonomous       no team; independent; unaffected by team blocking (R9.5)
maintainer       no team; bound to one githubRepo (R19)
```

<!-- @spec:title-plugin-map — the default role-plugin per title (lib/ecosystem-constants.ts TITLE_PLUGIN_MAP; 9 entries — the 8 governance titles + the R39 ASSISTANT) -->
```text
MANAGER          ai-maestro-assistant-manager-agent
CHIEF-OF-STAFF   ai-maestro-chief-of-staff
ORCHESTRATOR     ai-maestro-orchestrator-agent
ARCHITECT        ai-maestro-architect-agent
INTEGRATOR       ai-maestro-integrator-agent
MEMBER           ai-maestro-programmer-agent
MAINTAINER       ai-maestro-maintainer-agent
AUTONOMOUS       ai-maestro-autonomous-agent
ASSISTANT        ai-maestro-assistant-role-agent
```

`TITLES-01` **enum-closed** — the 8 in `@spec:titles` are the only valid `agent.governanceTitle` values on the
COMM-GRAPH / governance axis (R3.1); a 9th governance title is a MAJOR bump. `TITLES-02` **default-mandatory** —
each title's default role-plugin auto-installs on grant unless a compatible alternative is picked (R11, R20.4/R20.5);
every persisted agent carries exactly one (R9.13). `TITLES-03` **assistant-is-code-ahead-of-rule** — the CODE already carries `assistant` as a **9th** governance role:
`types/agent.ts` `AgentRole` / `VALID_GOVERNANCE_TITLES` list it, `TITLE_PLUGIN_MAP` maps it
(→ `ai-maestro-assistant-role-agent`), and `lib/communication-graph.ts` has an `assistant` NODE — it is IN the R6
graph, with the ENFORCED edge only to its bound user (R39.9 now ALSO permits a MANAGER edge — pending enforcement; the
code is safely stricter than the rule). But the RULE
has NOT caught up: R3.1 still enumerates **eight** governance titles and the R6 matrix has **nine** nodes (HUMAN + 8,
no ASSISTANT), because the R39.1-R39.4 user-model SURFACE is HELD (transition phase) — the assistant role-plugin
itself already EXISTS (LOCAL/D4, R39.2); the implementation is tracked as follow-on TRDDs (TRDD-W9FA6ACZ). This SPEC faithfully mirrors the RULE:
`@spec:titles` = R3.1's 8, `@spec:comm-graph` = R6's 9-node matrix; `@spec:title-plugin-map` = the code's 9 (it is
the code contract). The conformance test PINS the delta — the 8 spec titles ⊆ the code roles, and the code's extra
role is exactly `{assistant}` — so a NEW undocumented role goes red. When R39 lands, R3.1 + R6 gain ASSISTANT and
this SPEC + block follow (GOV-META-02). [Surfaced to the USER as a code-ahead-of-rule gap, TRDD-R8LJJDBQ.]

## GOV-INV — the 22 hard invariants (MUST never be violated)

These are hard invariants the system must maintain at all times:

`GOV-INV-01` **COS-membership** — `team.chiefOfStaffId === agentId` implies
`team.agentIds.includes(agentId)`.
`GOV-INV-02` **Singleton-MANAGER** — at most one agent has `managerId === agentId` globally.
`GOV-INV-03` **Single-team** — a non-MANAGER agent appears in `agentIds` of at most one team.
`GOV-INV-04` **Name-uniqueness** — no two teams have the same name (case-insensitive).
`GOV-INV-05` **COS-immutability** — COS title can only be removed by deleting the team (not by title
reassignment).
`GOV-INV-06` **Manager-team** — teams cannot exist in an active (non-blocked) state without a MANAGER on
the host.
`GOV-INV-07` **Team-agent-lifecycle** — team agents cannot be woken while teams are blocked (no MANAGER).
`GOV-INV-08` **Title-plugin** — every agent (INCLUDING AUTONOMOUS) has exactly one role-plugin installed
matching their title. Agents without a role-plugin cannot exist at rest — the only transient "no
role-plugin" window is the instant inside a Change* pipeline between uninstall and install, and the agent
is never persisted in that state (see R9.13, R11.12).
`GOV-INV-09` **Minimum-composition** — every team must have at least 5 agents covering all 5 required
titles (COS, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER).
`GOV-INV-10` **Role-boundary** — no agent may perform tasks outside its title's role-plugin scope.
`GOV-INV-11` **Team-resilience** — deleted core title agents must be immediately recreated by COS (or
MANAGER for COS).
`GOV-INV-12` **Written-orders** — all inter-agent commands and reports must be written `.md` files with
GitHub issue attachments (MANAGER exempt).
`GOV-INV-13` **Password-secrecy** — the governance password must never be transmitted to, stored by, or
used by any agent — only the human user may enter it.
`GOV-INV-14` **Core-plugin-presence** — every agent registered in the AI Maestro host must have
`ai-maestro-plugin@ai-maestro-plugins` installed with `--scope local` in its working directory.
`GOV-INV-15` **Core-plugin-protection** — the `ai-maestro-plugin` cannot be uninstalled, disabled, or moved
to user scope on any agent — it is a permanent, enabled, local-scope fixture.
`GOV-INV-16` **Core-plugin-currency** — the `ai-maestro-plugin` must be updated from the marketplace
whenever AI Maestro itself is updated.
`GOV-INV-17` **Plugin-continuity** — when an agent's client changes, every plugin that was installed for
the old client must be re-emitted and re-installed in a format compatible with the new client — no agent
may ever be left without its plugins as a side effect of `ChangeClient`.
`GOV-INV-18` **MAINTAINER-repo-uniqueness** — at any time, at most one active (non-deleted) agent has a
given `githubRepo` value. Two MAINTAINERs cannot maintain the same repository on the same host.
`GOV-INV-19` **Marketplace-source-path** (R20.18) — every `source` field in a per-client marketplace
manifest starts with `./`, resolves to an existing folder inside the same `marketplace-<client>/` root, and
conforms to that client's marketplace spec (Claude string `"./x"` vs Codex object `{source:"local",
path:"./x"}`).
`GOV-INV-20` **IR-storage-location** (R20.8 + R20.9 + R20.22) — converted-plugin universal IR lives at the
CONTAINER level — `~/agents/custom-plugins/.abstract/<name>/` for ordinary plugins and
`~/agents/role-plugins/.abstract/<name>/` for role-plugins — NEVER inside any `marketplace-<client>/`
subfolder and NEVER duplicated per client.
`GOV-INV-21` **Scope-isolation** (R20.20) — user-scope and local-scope plugin lists are disjoint — no
plugin install at one scope ever appears in the listing or affects the enable-state of the other scope.
`GOV-INV-22` **Container-marketplace-separation** (R20.1 + R20.21) — `~/agents/role-plugins/` and
`~/agents/custom-plugins/` are CONTAINERS, not marketplaces. A container holds zero or more
`marketplace-<client>/` subfolders plus the shared `.abstract/` IR hub. The container folder itself is
NEVER registered with any client CLI as a marketplace — only the individual `marketplace-<client>/`
subfolders are.

## GOV-PERM — the role-based permission matrix (title axis; R26-R40 govern on any conflict)

<!-- @spec:permission-matrix — quick summary for the agent-title axis; R26-R40 authoritative on divergence -->

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

`PERM-01` **R26-R40-govern** — this matrix is the agent-title-axis summary; on any conflict with R26-R40 (agents never
sudo — R32; the MAESTRO/DELEGATE + ASSISTANT + user model — R37/R39), R26-R40 govern.
## GOV-BND — the IND/DEP boundary (this catalog is DEP)

`BND-01` **governance-is-DEP** — the R1-R49 catalog PRESUPPOSES the ai-maestro harness (governance TITLEs, the comm
graph, `min-approval-requirement`, the server as notarizer, `$AID_AUTH`, the dashboard). By the IND/DEP boundary test
(`design/specs/3-pillars-spec.md` `3P-BND`), it is DEP, not IND. `BND-02` **overlays-expand** — the DEP operating
overlays `rules/aimaestro/aimaestro-*.md` EXPAND this catalog (approval tiers, transition authority, PRRD per-title
matrix, the refusal Part B) and MUST NOT restate the IND base. `BND-03` **kanban-cited-as-data** — the 17-column kanban
vocabulary (R25) is defined by the IND 3-pillars spec (`3P-KAN`); this spec cites it, never redefines it.

## GOV-VAL — machine-checkable conformance (what a harness asserts against the code)

`GOV-VAL-01` **comm-graph** — `lib/communication-graph.ts` edges deep-equal the `@spec:comm-graph` block.
`GOV-VAL-02` **title-enum** — the code's `governanceTitle` enum equals the `@spec:titles` set (8, exact spellings).
`GOV-VAL-03` **title-plugin-map** — `lib/ecosystem-constants.ts::TITLE_PLUGIN_MAP` (9 entries, incl. the R39
`ASSISTANT`) equals the `@spec:title-plugin-map` block key-for-key and value-for-value.
`GOV-VAL-04` **invariants** — each `GOV-INV-NN` has an enforcement site (a gate in `element-management-service.ts` or a
test); an invariant with no enforcement site is a gap. `GOV-VAL-05` **strict-routes** — every route in
`security-registry.json` marked `strict` is USER/UI-sudo-gated and agent callers use the R28 three-check (R32).
`GOV-VAL-06` **no-direct-api-in-plugins** — `grep -rn '/api/'` over any plugin tree finds no direct-call instructions
(R23.6). `GOV-VAL-07` **mirror-sync** — every `§0.2-§0.9` mirror is consistent with the catalog version that tracks this spec.

## GOV-MNT — maintenance

`GOV-MNT-01` **living** — this file is MAINTAINED and NON-archived; this file LEADS `docs/GOVERNANCE-RULES.md`; the
catalog tracks THIS spec clause-for-clause and moves in the same change-set (GOV-META-02).
`GOV-MNT-02` **change-authority** — this spec is USER-owned and edited first; a change to any
`MUST`/the comm graph/the title enum/an invariant/the ladder bumps `spec-version` per GOV-VER-01,
and the catalog `version:` follows in lockstep. `GOV-MNT-03` **keep-it-greppable** — every clause keeps its `` `R<n>.<sub>` ``
/ `GOV-<FAMILY>-NN` anchor + a bold key-phrase; a new rule takes the next free number (never reused, GOV-VER-03); GOV-GREP
lists every family.
