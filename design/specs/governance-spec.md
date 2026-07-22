---
spec: governance
spec-version: 1.0.0
status: normative
created: 2026-07-22T10:19:26+0200
updated: 2026-07-22T10:19:26+0200
maintainer: ai-maestro
project-id: ai-maestro
derived-from:
  - "docs/GOVERNANCE-RULES.md v4.5.0 (2026-07-16) — the R1..R49 team-governance RULE catalog; STAYS there (canonical, §0-mirrored). This SPEC captures its every rule as a dry, greppable, versioned contract."
implementations:
  - "docs/GOVERNANCE-RULES.md — the discursive catalog + rationale (the source; §0 lists all its mirrors)"
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

**This file is the SPEC, not a rule.** It is the single, versioned, normative capture of the
AI Maestro team-governance rules. The RULE catalog `docs/GOVERNANCE-RULES.md` (discursive
prose + rationale, `version: 4.5.0`) is the IMPLEMENTATION that carries the teaching; the
runtime code (`lib/communication-graph.ts`, `services/element-management-service.ts`, …) is
the IMPLEMENTATION that carries the enforcement. This file carries the testable clauses. On
any disagreement, **GOVERNANCE-RULES.md is authoritative for rule MEANING** (it is the
`§0`-mirrored canonical source and is USER-owned); this spec tracks it clause-for-clause and
is the arbiter of the machine-checkable SHAPE (the comm graph, the title enum, the invariants).

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

`GOV-META-01` **catalog-is-authoritative-for-meaning** — `docs/GOVERNANCE-RULES.md` is the
USER-owned canonical rule source; this spec tracks it. A rule's MEANING is set there; this
spec's job is the machine-checkable shape and a dry, greppable capture. Where the two diverge
on WORDING the catalog wins and this spec is the lint target.

`GOV-META-02` **mirror-sync (§0)** — the catalog's `§0` lists every place a rule is copied
(README, CLAUDE.md, the 8 role-plugin personas, the core-plugin skills, the enforcement code,
the API routes, the UI, the SCEN-* scenarios, the validators). A rule change MUST update the
catalog first (bump `version:`, append changelog), then walk `§0.2..§0.9` in the SAME commit,
then republish affected role-plugins. This spec is one such mirror and follows the same law.

`GOV-META-03` **not-a-code-mirror** — this spec states VALUES + `MUST`/`MUST-NOT` assertions +
the enumerable surfaces; it does NOT restate rationale prose or re-implement enforcement logic.
The rationale stays in the catalog; the logic stays in the code.

## GOV-VER — versioning & conformance

`GOV-VER-01` **semver-bump** — `spec-version` is semver. MAJOR = a `MUST` changes (a rule
meaning, the comm graph, the title enum, an invariant, the authority ladder). MINOR = a rule
added or a non-breaking clarification. PATCH = wording only. The catalog's own `version:` and
this `spec-version` move together (GOV-META-02).

`GOV-VER-02` **conforms-to** — an implementation MAY declare `conforms-to-spec:
governance@<version>` / `governance-rules@<catalog-version>`; a declared version ≠ the live one
is a detectable failure.

`GOV-VER-03` **clause-ids-stable** — a rule number is NEVER reused (R22 was reserved, not
recycled; decoupling/memory/pillars moved to R23/R24/R25 to free it). A citation `R<n>.<sub>`
resolves to exactly one rule across versions.

## GOV-TERM — the three-layer agent model (TITLE / ROLE / PERSONA)

`TERM-01` **three-orthogonal-layers** — every agent has TITLE (governance class / permissions),
ROLE (the role-plugin main-agent it runs — behaviour/skills), PERSONA (the running instance —
name + AID + avatar + workdir). They are mutated by different pipelines and MUST NOT be conflated.

`TERM-02` **TITLE** — `agent.governanceTitle` (lowercase kebab); one of the 8 (GOV-TITLES).
Changing it runs `ChangeTitle` (23 gates) and needs the governance password or MANAGER/own-COS
authority (R3, R16, R26).

`TERM-03` **ROLE** — `<plugin>:<main-agent>@<marketplace>`. A role-plugin is any Claude Code
plugin that ALSO has (a) a `<name>.agent.toml` with `compatible-titles` + `compatible-clients`,
and (b) a main-agent `.md` whose persona carries the governance rules (the actual security
boundary, since all host agents share one `gh` identity). Storage/authoring/`TITLE_PLUGIN_MAP`
membership are NOT defining. `agent.rolePlugin`. Changing it runs `ChangePlugin(rolePluginSwap)`.

`TERM-04` **PERSONA** — name (unique kebab, case-insensitive in) + AID (Ed25519 key pair, once
per persona) + avatar + workdir (`~/agents/<name>/`, the only writable home outside `/tmp`).
Only PERSONA is 1:1 with a tmux session; TITLE/ROLE swap on a live persona without losing identity.

`TERM-05` **constraints** — TITLE⊥ROLE but constrained by `compatible-titles` (ChangeTitle
rejects an incompatible ROLE); N:1 (many ROLEs per TITLE → dropdown when ≥2, locked label when 1);
every persisted agent carries exactly one ROLE (R9.13); AUTONOMOUS resolves to
`ai-maestro-autonomous-agent` (never "no plugin").

## GOV-R1..R49 — the rule clauses

### GOV-R1 — Teams and Groups
`R1.1` **teams-defined** — Teams have isolated messaging, ACL, governance titles, and a COS
(the former "closed teams"). `R1.2` **groups-defined** — Groups are lightweight broadcast
collections: NO governance, NO COS, NO kanban (the former "open teams"). `R1.3` **team-should-COS**
— every team SHOULD have a COS (manages membership + external comms). `R1.4` **team-needs-MANAGER**
— a team can be created only if a MANAGER exists on the host. `R1.5` **no-manager-blocks** — teams
without a MANAGER are `blocked:true`, all ops frozen. `R1.6` **groups-free** — any agent may
subscribe/unsubscribe to a group freely.

### GOV-R2 — Team Name Rules
`R2.1` **unique-name** — team names unique, case-insensitive; no two teams share a name.
`R2.2` **dual-enforce** — uniqueness enforced server-side (409) AND client-side (inline error
before POST). `R2.3` **rename-checks** — renaming re-checks uniqueness against all other teams
(excluding self).

### GOV-R3 — Role Hierarchy [CRITICAL surface]
`R3.1` **eight-titles** — MANAGER (global singleton), CHIEF-OF-STAFF (per team), ORCHESTRATOR
(per team), ARCHITECT, INTEGRATOR, MEMBER (default team title), AUTONOMOUS (no team), MAINTAINER
(no team, bound to a GitHub repo). `R3.2` **manager-singleton** — at most one MANAGER at any time.
`R3.3` **cos-per-team** — exactly one COS per team. `R3.4` **cos-one-team** — an agent is COS of
at most one team. `R3.5` **role-change-needs-password** — assign/remove MANAGER or COS requires
the governance password. `R3.6` **manager-full-authority** — MANAGER may add/remove agents, assign
COS, approve transfers, create/delete teams, message anyone (within R6). `R3.7` **cos-external-comms**
— COS is the team's external contact point. `R3.8` **cos-staffs** — COS decides staff composition
(add/remove agents). `R3.9` **manager-delegates** — MANAGER can do all COS can but usually delegates.
`R3.10` **typical-flow** — MANAGER creates team → assigns COS → COS runs it. `R3.11` **manager-reassign-revokes**
— reassigning MANAGER instantly revokes the old holder (singleton). `R3.12` **cos-only-via-dedicated-route**
— COS assign/remove MUST NOT go through generic `PUT /api/teams/[id]`; only the password-protected
`POST /api/teams/[id]/chief-of-staff`.

### GOV-R4 — Agent Membership
`R4.1` **one-team** — a non-MANAGER agent is in at most one team. `R4.2` **unlimited-groups** —
any agent may join unlimited groups. `R4.3` **manager-maintainer-host-level** — MANAGER and
MAINTAINER are in NO team (host-level). `R4.4` **join-auto-member** — joining a team auto-assigns
MEMBER title + programmer plugin. `R4.5` **no-dup-membership** — an agent cannot be added to a
team it is already in. `R4.6` **cos-must-be-member** — the COS MUST be in its team's `agentIds[]`.
`R4.7` **cos-cannot-be-bare-removed** — removing a COS from `agentIds` while still `chiefOfStaffId`
is forbidden; COS title is removed only by deleting the team. `R4.8` **ui-shows-memberships** — the
UI always shows team memberships in any agent-selection operation. `R4.9` **validate-existence** —
`agentIds` MUST reference agents that exist in the registry.

### GOV-R5 — Transfer
`R5.1` **transfer-request-required** — moving an agent OUT of a team needs a transfer request
(approval workflow); it cannot just leave. `R5.2` **only-manager-cos-create** — only MANAGER/COS
create transfer requests. `R5.3` **only-source-cos-manager-approve** — only the source team's COS
or MANAGER approve/reject. `R5.4` **cos-not-transferable** — a COS cannot be transferred out of its
own team (COS immutability). `R5.5` **dest-must-exist** — destination team must exist at request
time. `R5.6` **no-self-transfer** — source ≠ destination. `R5.7` **check-single-team-on-approve** —
on approval, re-check R4.1 (agent not already in another team). `R5.8` **no-dup-request** —
prevent duplicate pending requests (same agent+source+dest).

### GOV-R6 — Messaging (Communication Graph) [see GOV-COMM for the matrix]
`R6.1` **graph-defined** — messaging is the directed graph in GOV-COMM; each (sender,recipient)
has an explicit edge type (`Y` allow, `1` reply-only, blank deny). `R6.2` **manager-routes-via-COS**
— MANAGER may freely message COS, peer MANAGERs, MAINTAINER, AUTONOMOUS, HUMAN; MANAGER CANNOT
directly contact in-team non-COS agents (ORCH/ARCH/INT/MEMBER) — routes through COS (v3, 2026-05-04).
`R6.3` **cos-sole-gateway** — CHIEF-OF-STAFF is the SOLE inbound+outbound team gateway; messages
MANAGER, COS peers, and its team roles; cannot initiate to MAINTAINER/AUTONOMOUS/HUMAN (H is
reply-only). `R6.4` **orchestrator-edges** — ORCHESTRATOR messages COS/ARCH/INT/MEMBER; H reply-only.
`R6.5` **arch-int-member-edges** — ARCHITECT/INTEGRATOR/MEMBER may freely message only COS and
ORCHESTRATOR; H reply-only. `R6.5a` **autonomous-edges** — AUTONOMOUS freely messages MANAGER,
other AUTONOMOUS, and HUMAN (H is `Y`, not reply-only); cannot reach COS/team roles/MAINTAINER.
`R6.5b` **maintainer-edges** — MAINTAINER freely messages MANAGER and HUMAN (H is `Y`); cannot
reach COS/team roles/AUTONOMOUS/peer MAINTAINERs. `R6.6` **human-first-class** — HUMAN (H) has
unconditional outbound `Y` to every node incl. other humans; inbound from team titles is `1`
(reply-only), from governance titles (M/T/A) is `Y`; agents are additionally persona-discouraged
from initiating user contact. `R6.7` **routing-suggestion** — a blocked message returns a routing
suggestion; `lib/communication-graph.ts` is authoritative. `R6.8` **three-enforcement-layers** —
(1) API `validateMessageRoute()` before delivery, (2) role-plugin `.md` lists allowed/reply-only
recipients, (3) sub-agents forbidden from AMP entirely. `R6.9` **subagents-no-identity** — sub-agents
have no AMP identity, communicate only with their spawning main-agent. `R6.10` **reply-only-enforce**
— `1` edges require `inReplyToMessageId`; today only a truthy-string check (full one-reply-per-inbound
invariant is pending, TRDD-80557822). `R6.11` **canonical-address** — one unique id per host, wire
`<agent-id>@<host>` (preferred) or `<host>:<agent-id>`; bare `<agent-id>` = writer's host; 3-level
hierarchical addressing deprecated for messaging. `R6.12` **persona-alias** — a persona name may
substitute for `<agent-id>` when unambiguous on the target host; on collision use the id or API
returns 409 `disambiguation_required`. `R6.13` **default-host** — omitted host defaults to the
writer's host; cross-host REQUIRES explicit `@<host>`. `R6.14` **migrate-drift** — every UI/persona/
doc reference to the deprecated 3-level format MUST migrate to R6.11-R6.13; permanent, no shim.

### GOV-R7 — UI Robustness
`R7.1` **submit-guards** — mutating buttons have `submitting` guards (no double-fire). `R7.2`
**loading-spinners** — all async ops show spinners. `R7.3` **no-silent-failure** — all failures
show error messages. `R7.4` **graceful-edge-cases** — handle all edge cases/errors. `R7.5`
**no-infinite-loops** — no infinite loops / blocking ops in the UI. `R7.6` **role-badges** —
MANAGER amber/gold, COS indigo badges next to names. `R7.7` **blocked-badge** — teams show a
blocked badge when no MANAGER. `R7.8` **resolve-uuid** — never show raw UUIDs; resolve COS UUID to
a name. `R7.9` **loading-state-not-stale** — during governance load show a loading state, never a
stale "normal" role.

### GOV-R8 — Data Integrity
`R8.1` **file-locking** — team writes use `withLock`. `R8.2` **no-governance-via-generic-put** —
`chiefOfStaffId`/`type` MUST NOT be accepted by generic `PUT /api/teams/[id]`; use dedicated
password-protected routes. `R8.3` **delete-cleans-transfers** — team deletion cancels related
pending transfers. `R8.4` **agent.team-display-only** — `Agent.team` free-text is display-only;
membership is tracked solely via `Team.agentIds[]`.

### GOV-R9 — Manager Requirement
`R9.1` **manager-before-team** — a MANAGER MUST exist before any team is created. `R9.2`
**no-manager-blocks-teams** — no MANAGER ⇒ all teams `blocked:true`. `R9.3` **blocked-no-membership**
— blocked ⇒ no add/remove agents. `R9.4` **blocked-hibernates** — blocked-team agents are forcefully
hibernated (tmux killed). `R9.5` **autonomous-unaffected** — AUTONOMOUS agents are wholly unaffected
by team blocking. `R9.6` **assign-unblocks** — assigning a MANAGER unblocks all teams. `R9.7`
**unblock-no-autowake** — unblocking does NOT auto-wake; wake is manual. `R9.8` **remove-manager-cascades**
— deleting/removing the MANAGER triggers the blocking cascade immediately. `R9.9` **startup-check** —
at boot, no MANAGER ⇒ block + hibernate as a startup task. `R9.10` **delete-manager-warns-demotes** —
deleting the MANAGER shows a warning + auto-demotes to AUTONOMOUS first. `R9.11` **manager-creates-team-via-AID**
— the MANAGER creates teams via AID (`mst_*`) — no governance password needed for MANAGER-initiated
creation. `R9.12` **all-agents-visible** — all agents always appear in the sidebar regardless of
MANAGER status; the gate controls wake, not visibility; the registry is never filtered by governance
state. `R9.13` **role-plugin-mandatory** [CRITICAL] — role-plugin is mandatory for EVERY agent
(incl. AUTONOMOUS); CreateAgent/ChangeTitle/ChangeClient/ChangeTeam/RegisterAgentFromSession MUST
reject any desired-state with zero role-plugins; the only "no role-plugin" window is the transient
instant inside a Change* pipeline between uninstall/install; AUTONOMOUS resolves to
`ai-maestro-autonomous-agent`.

### GOV-R10 — Agent Lifecycle Governance
`R10.1` **wake-user-or-manager** — only the user (UI, no auth headers) or the MANAGER may wake ANY
agent. `R10.2` **hibernate-user-or-manager** — same for hibernate. `R10.3` **cos-own-team-only** —
COS may wake/hibernate only its OWN team's agents. `R10.4` **others-cannot** — MEMBER/ORCH/ARCH/INT/
AUTONOMOUS cannot wake/hibernate any agent. `R10.5` **no-manager-no-team-wake** — team agents cannot
be woken with no MANAGER (even by the user — assign MANAGER first). `R10.6` **restart-same-as-wake**
— the restart endpoint follows the wake governance. `R10.7` **delete-team-warn-pre-existing** —
"Delete Agents Too" SHOULD warn about agents created before the team and offer to keep them AUTONOMOUS.

### GOV-R11 — Title-Plugin Binding [see GOV-TITLES for the map]
`R11.1` **every-title-has-default** — every title (incl. MEMBER, AUTONOMOUS) has a default
role-plugin; there is NO "no role-plugin" state for a persisted agent. `R11.2` **member→programmer**
— MEMBER installs `ai-maestro-programmer-agent`. `R11.3` **autonomous→autonomous-agent** — AUTONOMOUS
installs `ai-maestro-autonomous-agent` (workspace isolation + no cross-agent mutation + comm-graph
restrictions in its persona). `R11.4` **join→member** — ChangeTeam→ChangeTitle('member')→programmer.
`R11.5` **leave→autonomous** — ChangeTeam→ChangeTitle('autonomous')→autonomous-agent. `R11.12`
**role-plugin-mandatory-at-boundary** — R9.13 restated for R11: all five boundaries reject zero-role
desired states. `R11.6` **N:1-dropdown** — multiple plugins per title → UI dropdown when ≥2.
`R11.7` **fourfold-identity** — a role-plugin is valid iff all 4 match: (1) `plugin.json` name =
canonical, (2) folder name = it, (3) `<name>.agent.toml` with `[agent].name` = it, (4)
`agents/<name>-main-agent.md` frontmatter `name: <name>-main-agent`. `R11.8` **client-from-toml** —
target client determined ONLY by `.agent.toml` `compatible-clients`, never the name. `R11.9`
**convert-preserves-role-name** — converting a role-plugin preserves the name, updates
`compatible-clients`, enforces fourfold identity, stores in `~/agents/role-plugins/`, never overwrites
an existing folder. `R11.10` **convert-suffixes-custom** — ordinary plugins get `-<client>` suffix,
stored in `~/agents/custom-plugins/<client>/`. `R11.11` **local-marketplaces** — roles-marketplace
holds ALL local role-plugins; custom-marketplace holds converted ordinary plugins.

### GOV-R12 — Minimum Team Composition [CRITICAL]
`R12.1` **five-base-incl-COS** — every team MUST have ≥5 agents: 1 CHIEF-OF-STAFF, 1 ARCHITECT,
1 ORCHESTRATOR, 1 INTEGRATOR, 1 MEMBER. `R12.2` **missing-title-nonfunctional** — a team lacking any
of the 5 is NON-FUNCTIONAL; the COS must immediately add the missing agents. `R12.3` **one-role-per-agent**
— each role-plugin serves one role; no agent serves two titles at once. `R12.4` **extra-members-COS-judgment**
— extra MEMBER agents may be added at the COS's judgment (programmer or any MEMBER-compatible plugin).
`R12.5` **COS-composes-from-design-doc** — the COS decides composition from the MANAGER's design
requirements document. `R12.6` **manager-enforces-on-create** — the MANAGER MUST enforce R12.1 when
creating teams (always ≥5 agents).

### GOV-R13 — Role Boundaries
`R13.1` **strict-scope** — each title operates strictly within its role-plugin's scope; no agent does
another title's work. `R13.2` **manager-governs-not-codes** — MANAGER governs/approves/routes; does
NOT code/design/coordinate tasks. `R13.3` **cos-staffs-not-builds** — COS staffs/manages lifecycle/
external comms; does NOT design/implement/integrate. `R13.4` **architect-designs-not-implements** —
ARCHITECT designs; does NOT implement/manage/CI. `R13.5` **orchestrator-coordinates-not-designs** —
ORCHESTRATOR coordinates/kanban/distributes; does NOT design/code. `R13.6` **integrator-gates-not-designs**
— INTEGRATOR reviews/gates/CI/merges; does NOT design/write features. `R13.7` **member-implements-only**
— MEMBER implements/fixes/tests; does NOT design/manage/CI. `R13.8` **overstep-refuse-and-route** —
an agent asked to overstep MUST refuse and route to the correct title via AMP (through ORCHESTRATOR
or COS). `R13.9` **plugin-gives-capability** — the role-plugin provides the skills/constraints; without
it the agent cannot perform that role.

### GOV-R14 — Team Resilience
`R14.1` **cos-recreates-missing** — if any of the 5 required agents is deleted, the COS immediately
recreates it. `R14.2` **nonfunctional-until-recreated** — without all 5, the team is NON-FUNCTIONAL,
no work proceeds. `R14.3` **cos-checks-at-startup-and-after-delete** — the COS checks composition at
wake and after any delete event. `R14.4` **manager-recreates-COS** — if the COS itself is deleted, the
MANAGER recreates a COS or deletes the team. `R14.5` **same-title-and-plugin** — the recreated agent
gets the same title + default role-plugin. `R14.6` **cos-logs-incident** — the COS logs (name, title,
timestamp, recreation details) in team records.

### GOV-R15 — Written Orders & GitHub Trail
`R15.1` **command-is-md-file** — every inter-agent command MUST be a written `.md` file from a
role-plugin template. `R15.2` **report-is-md-file** — every report back MUST be a written `.md`.
`R15.3` **attachments-on-github** — design docs/reviews/specs/reports MUST be published on GitHub
(issue/comment), not sent via AMP. `R15.4` **amp-carries-url-only** — AMP messages carry only the
GitHub URL, never the file content. `R15.5` **github-is-audit-log** — the GitHub issue trail is the
permanent audit log. `R15.6` **manager-exempt** — the MANAGER alone is exempt from R15.1-R15.4 (may
send direct AMP). `R15.7` **plugins-ship-templates** — each role-plugin ships message templates
(work requests, status reports, approval requests, handoffs).

### GOV-R16 — Password Never Shared with Agents [CRITICAL]
`R16.1` **never-in-prompt** — the governance password MUST NEVER be given to any agent in a task/
prompt/AMP message. `R16.2` **agents-use-AID-only** — agents MUST NEVER use the user's password or
session cookies; the server rejects agent requests using user credentials; agent auth is exclusively
AID (`$AID_AUTH`/`mst_*`). `R16.3` **ui-popup** — a password-protected op triggers a UI popup the user
enters manually. `R16.4` **manager-informs-user** — the MANAGER requests via API and tells the user to
enter the password in the popup. `R16.5` **user-types-physically** — the user types it in the browser;
the agent never sees/stores/transmits it. `R16.6` **agent-refuses-received-password** — an agent that
receives a password MUST refuse and ask the user to use the UI. `R16.7` **scenario-tests-only-exception**
— test automation may pass the password via API; this does NOT apply to production agents.
`R16.recovery` **forgot-password-reset** — `POST /api/governance/password/reset` recovers with NO old
password over three channels: console (default, `isConsolePeer`-gated — presence replaces the knowledge
factor), email (verified recovery address, remote-capable), passkey (WebAuthn, remote-capable);
rate-limited 5/15min, fail-closed; does not weaken R16 (human-only, curl-hardened). One dialog
component `PasswordDialog.tsx` serves every prompt.

### GOV-R17 — Mandatory Core Plugin [CRITICAL]
`R17.1` **core-required-local** — every agent MUST have `ai-maestro-plugin` installed `--scope local`
in its workdir. `R17.2` **install-command** — `claude plugin install ai-maestro-plugin@ai-maestro-plugins
--scope local` from `~/agents/<name>/`. `R17.3` **install-at-registration** — installed at registration
(wizard, import, or programmatic). `R17.4` **provides-foundation** — provides the foundational skills,
AMP commands, hooks. `R17.5` **without-it-nonfunctional** — an agent without it is non-functional
(no messages/governance/AMP/notifications). `R17.6` **createagent-gate** — CreateAgent MUST install it.
`R17.7` **register-session-gate** — RegisterAgentFromSession MUST install it before "fully registered".
`R17.8` **local-scope-mandatory** — `--scope local` (not user); each agent is independent. `R17.9`
**install-failure-flags** — on install failure the registration still succeeds but flags
`corePluginMissing:true` + a warning badge. `R17.10` **manager-cos-periodic-verify** — MANAGER/COS
SHOULD periodically verify presence and trigger reinstall. `R17.11` **non-claude-convert-first** — for
non-Claude clients, convert the core plugin (Universal IR → client adapter), store in
`~/agents/custom-plugins/<client>/ai-maestro-plugin-<client>/`. `R17.12` **detect-client-auto-convert**
— CreateAgent/RegisterAgentFromSession detect client + auto-convert if not `claude-code`. `R17.13`
**convert-preserves-supported** — the converted plugin preserves all supported skills/commands/hooks/
AMP; unmappable features are documented in the loss report, not blocking.
`R17.14` **cannot-uninstall** — the core plugin CANNOT be uninstalled (ChangePlugin rejects, cites R17).
`R17.15` **cannot-disable** — CANNOT be disabled; re-enable only inside an AIO (Wake R17 gate,
InstallElement), never a background loop. `R17.16` **no-uninstall-button** — the UI shows a "core"
label, not an X. `R17.17` **not-user-scope** — MUST NOT be at `--scope user`; the server disables a
user-scope copy on startup. `R17.18` **no-startup-audit-loop** — the server MUST NOT run a startup
audit / periodic loop that mutates agent state; compliance is the AIO Change* pipelines' post-gates
(PG01/PG02/PG05); a repair loop is an anti-pattern — fix the pipeline. `R17.18a` **no-auto-register-sessions**
— the server MUST NOT auto-register discovered tmux sessions; unknown sessions surface read-only as
`unregisteredSessions` until the user clicks Revive/Import (→ CreateAgent AIO).
`R17.19` **update-on-app-bump** — `bump-version.sh` MUST also update the core plugin (register the
marketplace first if needed). `R17.20` **marketplace-registered-on-boot** — the server ensures
`Emasoft/ai-maestro-plugins` is registered every startup. `R17.21` **wake-checks-core** — `wakeAgent`
checks core presence before launch; if missing, install via InstallElement; on failure REJECT the wake
(cite R17). `R17.22` **auto-accept-trust** — the server auto-accepts the Claude directory-trust prompt
(sends Enter, polls ≤8s). `R17.23` **trust-nonblocking** — trust auto-accept runs async, never blocks
the wake response.

### GOV-R18 — Plugin Continuity on Client Change [CRITICAL]
`R18.1` **never-plugin-less-on-client-change** — ChangeClient MUST NEVER leave an agent without its
plugins; every old-client plugin MUST be re-emitted for the new client. `R18.2` **snapshot-before-uninstall**
— enumerate all installed plugins (role + normal, enabled + disabled) BEFORE uninstalling anything.
`R18.3` **resolution-order** — per plugin: (a) native version exists → use it; (b) Universal IR exists →
`emitForClient`; (c) else `convertAndStorePlugin`. `R18.3b` **no-lossy-to-claude** — X→Claude is lossy;
to Claude MUST use the canonical Claude source (cache then role-plugins dir); if none, REFUSE and abort.
`R18.3c` **no-reverse-emit-to-claude** — an IR built from a non-Claude source MUST NOT be reverse-emitted
to Claude. `R18.3d` **prefer-native** [CRITICAL] — NEVER convert/emit if a native version exists;
strict order: (1) client-native cache, (2) local role-plugins marketplace if `compatible-clients` includes
the target, (3) prior custom-plugins emit, (4) emit from IR, (5) fresh conversion (last resort).
`R18.4` **all-or-abort** — only after ALL compatible versions confirmed may ChangeClient uninstall/install;
any failure aborts BEFORE touching the agent dir (no partial state). `R18.5` **core-subject-to-R18** —
the core plugin is converted like any other on client change (satisfies R17). `R18.6` **role-plugin-conversion**
— role-plugins convert with the same pipeline but keep their name (no `-<client>`), stored in
`~/agents/role-plugins/`, `.agent.toml` `compatible-clients` updated. `R18.7` **set-restart-needed** —
ChangeClient sets `restartNeeded=true`. `R18.8` **loss-report-not-blocking** — an unmappable feature emits
a loss report but the op proceeds (reduced features acceptable; no-plugins is not). `R18.9`
**no-syncRolePlugin** — ChangeClient must NOT uninstall the role-plugin via `syncRolePlugin` (assumes
Claude); handles it explicitly per R18.3. `R18.10` **title-unchanged** — after ChangeClient the title is
unchanged; R11 binding satisfied by the converted role-plugin.

### GOV-R19 — MAINTAINER Title
`R19.1` **no-team-repo-bound** — MAINTAINER is a no-team host-level title bound to an external project.
`R19.2` **githubRepo-immutable** — every MAINTAINER has a non-empty `githubRepo` (`owner/repo`); it is
immutable once set (reassign the title to a different agent to change the repo). `R19.3` **one-per-repo**
— assigning MAINTAINER when another active MAINTAINER owns the same `githubRepo` MUST be rejected
(uniqueness). `R19.4` **workflow** — poll issues every 5 min via `gh issue list` → diff a local ledger →
triage (bugs auto; features only from the authorized `gh` user) → clone/branch/edit/test/commit → bump +
`scripts/publish.py`. `R19.5` **uses-host-gh** — uses the host `gh` CLI; no webhooks/ports; ledger at
`~/.aimaestro/maintainer/<agentId>/processed-issues.json`. `R19.6` **feature-author-must-match-gh-user**
— feature/change requests accepted only if the issue author == the locally authenticated `gh` user; bug
reports triaged from anyone. `R19.7` **no-destructive-git-without-manager** — no force-push/history-rewrite/
tag-delete/branch-delete beyond publish; those need MANAGER approval via `approval-request` AMP. `R19.8`
**pre-publish-checks** — before publishing: tests pass, version bump actually required, R18 continuity
satisfied for bundled plugins, honor the repo `pre-push` hook. `R19.9` **maintainer-comm** — messages
MANAGER/COS/AUTONOMOUS/other-MAINTAINERs + user; team workers route through COS/MANAGER. `R19.10`
**bound-to-maintainer-plugin** — bound to `ai-maestro-maintainer-agent` (R11) + core (R17). `R19.11`
**hibernation-safe** — hibernation stops polling; unprocessed issues picked up next patrol; ledger persists.

### GOV-R20 — Marketplace Governance
`R20.container-vs-marketplace` **container≠marketplace** — a CONTAINER groups marketplaces + the shared
`.abstract/` IR hub (`~/agents/role-plugins/`, `~/agents/custom-plugins/`); a MARKETPLACE follows a
client's spec and is registered with that client's CLI; each is `marketplace-<client>/` inside its container.
`R20.source-vs-target` [CRITICAL] — the 3 local containers under `~/agents/{role,custom,core}-plugins/` are
SOURCE STORAGE only; a plugin LIVES at its install target (the client's own cache) reached via the client's
protocol, regardless of source (GitHub URL / local folder / a local marketplace / a remote marketplace);
AI Maestro writes into the local containers only when it AUTHORS/CONVERTS; uninstall touches the client
target only; AI Maestro NEVER deletes from the source containers.
`R20.1` **one-remote-two-local** — one online marketplace (`github:Emasoft/ai-maestro-plugins`) + two offline
containers (role-plugins, custom-plugins); each container holds one `marketplace-<client>/` per client + the
`.abstract/` hub; Claude marketplaces have no client prefix, others use `<client>-`; Claude plugin names have
no suffix, non-Claude use `<name>-<client>`. `R20.2` **core-required** — every agent has the core plugin at
`--scope local` (mirrors R17). `R20.3` **verify-core-on-interaction** — verify R20.2 on every UI/API call;
missing → force hibernate until compliant. `R20.4` **title-default-role-plugin** — each agent has its title's
default role-plugin (or any compatible one) at local scope [see GOV-TITLES map]; AUTONOMOUS is no longer
"(none)". `R20.5` **auto-install-on-grant** — the default role-plugin auto-installs on title grant unless a
different compatible one is picked (ChangeTitle Gate 15). `R20.6` **non-claude-converted-role-plugin** —
non-Claude agents get the converted default role-plugin; a native version is preferred over re-conversion
(priority: native cache → role-plugins `marketplace-<client>/` → custom-plugins `marketplace-<client>/`).
`R20.7` **changeclient-reemits** — ChangeClient re-emits every installed plugin for the target client unless
a native version exists (see R18). `R20.8` **custom-IR-location** — converted ordinary-plugin IR at
`~/agents/custom-plugins/.abstract/<name>/plugin-universal-ir.yaml` (container level, shared). `R20.9`
**role-IR-location** — converted role-plugin IR at `~/agents/role-plugins/.abstract/<name>/…` (isolated).
`R20.10` **core-auto-update** — detect core updates and apply immediately (`claude plugin update …`); for
non-Claude re-convert into every target format + reinstall (core-plugin-currency invariant). `R20.11`
**check-updates-everywhere** — check non-core updates from the DEFAULT marketplace AND every local
`marketplace-<client>/`; notify + expose an idempotent update command. `R20.12` **reemit-on-source-update**
— IR-emitted conversions detect source updates + re-emit into every marketplace that has a copy, bump the
version, register in each manifest. `R20.13` **names-uuids-unique-host-wide** — agent names + UUIDs unique
host-wide (409 on collision); cross-host via `<name>@<host>`. `R20.14` **cross-host-readable-registry** —
each host keeps a read-only-consultable identity/UUID registry for the mesh. `R20.15` **AID-token-for-privileged**
— any privileged action requires a valid AID-signed token (Bearer `aim_tk_*` / session `mst_*` / AMP
`amp_live_sk_*`); the server rejects a privileged call lacking one. `R20.16` **identity-authority** — an
agent's identity authority is its AMP provider OR the spawning AI Maestro host. `R20.17` **fourfold-identity-check**
— role-plugins pass the fourfold check (per-client equivalents defined per spec); failing files are NOT
role-plugins. `R20.18` **per-client-spec-conformance** — every per-client marketplace conforms to its client's
spec: Claude manifest at `<marketplace>/.claude-plugin/marketplace.json`, `source:"./<name>"` string; Codex at
`<marketplace>/marketplace.json`, `source:{source:"local",path:"./<name>"}` + policy/category/interface; every
path starts `./`, resolves inside the same `marketplace-<client>/`, no `../`/absolute/cross-client leakage; a
new client needs a dedicated emitter. `R20.19` **optional-plugins-not-enforced** — optional local plugins are
allowed beyond core+title but are NOT under the reinstall loop. `R20.20` **scope-isolation** — user-scope and
local-scope plugin lists are disjoint; enable/disable per-scope independent (SCEN-021). `R20.21` **iterate-per-client-marketplaces**
— treat each `marketplace-<client>/` as an independent marketplace, registered separately; never assume a
container-wide marketplace, never mix two clients in one folder. `R20.22` **IR-shared-not-duplicated** — the
`.abstract/` IR is container-level, shared across all per-client marketplaces; re-emit reads it and writes into
the correct subfolder; NEVER duplicate the IR per client. `R20.23` **multi-client-duplication** — a role-plugin
with multiple `compatible-clients` is stored as a separate emitted copy in EACH client marketplace (each copy
keeps the full `compatible-clients`); never shared by symlink; custom plugins keyed by name suffix. `R20.24`
**agent.toml-is-the-marker** — the sole role-vs-custom marker is `<name>.agent.toml`; custom plugins MUST NOT
have one; the converter writes `.agent.toml` only for role-plugins. `R20.25` **core-plugins-container** — a
third container `~/agents/core-plugins/` holds converted core plugins for non-Claude ONLY (`.abstract/` +
`<client>-core-marketplace/ai-maestro-plugin-<client>/`); Claude does NOT use it (installs core from the remote
marketplace); non-Claude install via the per-client adapter copying files directly (no marketplace registration).
`R20.26` **no-renaming** — plugin names (folder + manifest) are IMMUTABLE; no API/UI/script renames; conversion
computes the target name (Claude `<name>`, others `<name>-<client>`), overwrites if it exists else writes new;
no similarity/dedup; the filesystem IS the registry. `R20.27` **manifest-name==folder-name** — every plugin's
manifest `name` MUST equal the folder name; the converter rewrites it on non-Claude targets; validators reject
a mismatch. `R20.28` **five-canonical-marketplace-folders** — the ONLY valid local marketplace folder patterns:
(1) `role-plugins/roles-marketplace/`, (2) `role-plugins/<client>-roles-marketplace/`, (3)
`custom-plugins/custom-marketplace/`, (4) `custom-plugins/<client>-custom-marketplace/`, (5)
`core-plugins/<client>-core-marketplace/`; the installer creates every applicable pattern + a valid manifest
(even if empty). `R20.29` **source-vs-install-target-invariant** [CRITICAL] — restates R20.source-vs-target as a
named invariant (SCEN-026). `R20.30` **scope-semantics-install-uninstall** — every install lands in exactly one
scope (LOCAL per-agent or USER global); uninstall never touches the source; LOCAL uninstall affects one agent,
USER uninstall affects every agent on that client; Agent-Profile shows LOCAL only, Settings-Plugins-Explorer
shows USER only. `R20.31` **local-sources-user-owned** — the 3 source containers are USER-OWNED; AI Maestro
writes only when authoring/converting/core-emitting, NEVER deletes; removing a source folder is the user's job.

### GOV-R21 — All-In-One Pipeline Architecture [CRITICAL · IRON]
`R21.0` **AIO-defined** — an AIO is the SINGLE pipeline function for a sensitive op: numbered pre-gates
(validate) → EXE (mutate) → post-gates (repair); it ALWAYS leaves the system valid regardless of caller.
`R21.1` **one-function-per-operation** — exactly one AIO per sensitive mutation; no other code path performs it;
thin wrappers forbidden (deprecated aliases like `installPluginLocally` removed). `R21.2` **helpers-pure** — a
helper may only read/lookup/transform; anything that writes/mutates/side-effects MUST be an AIO with gates (a
mutating helper is a backdoor); this includes state-mutating CLI shell-outs. `R21.3` **auth-inside** — callers
verify identity only; all authorization is inside the AIO at Gate 0 (`gate0Auth`); routes call
`authenticateFromRequest` then delegate. `R21.4` **AIO-composition** — an AIO needing another AIO's task MUST
call that AIO, never re-implement the primitive ("only one way to do one thing"); inlining a cascaded mutation
in a post-gate is forbidden. `R21.5` **naming-is-part-of-the-rule** — `Change*` = configure ONE entity;
`Install/Uninstall/Update*Plugin` (no Change) = operate on a plugin everywhere; `*Marketplace` = operate on a
marketplace + cascade when destructive; `enable`/`disable` is a `ChangePlugin` action, not its own AIO. `R21.6`
**mandatory-cascade** — UninstallMarketplace → UninstallPlugin per plugin → ChangePlugin per agent → may trigger
ChangeTitle/ChangeTeam; skipping the cascade leaves dangling `<plugin>@<deleted-marketplace>` keys that break the
agent. `R21.7` **six-api-surface** — exactly six user-facing plugin/marketplace ops (Check/Install/Update Plugin;
Check/Install/Update Marketplace); new scattered mutation endpoints forbidden. `R21.8` **settings-endpoints-not-plugin-ops**
— policy-settings endpoints (auto-update config) are NOT plugin ops and do not count against the six. `R21.9`
**gate-numbering** — `G00-G99` pre-gate, `EXE` execution (never numbered), `PG01-PG99` post-gate. `R21.10`
**atomic-gates** — one check per gate (split composite validations). `R21.11` **canonical-pre-sequence** — G00
auth → per-field validation → resolve context → path/security → resource exists → protected guard → permission
guard → idempotency → dependency → status → variant gates. `R21.12` **execution-is-EXE** — the smallest core
mutation, tagged `EXE:`, exactly one per pipeline. `R21.13` **post-gates-always-run** — post-gates run even when
idempotency skipped EXE (stale flags still need repair); for each mutated field, add a post-gate repairing every
dependent invariant (via other AIOs, never inlined). `R21.14` **variant-specific-gates** — per-variant behavior
uses separate `[VariantName]` gates, not if/else. `R21.15` **idempotency-gate** — each AIO SHOULD skip EXE when
already in desired state, but post-gates still run. `R21.16` **protected-resource-four-layers** — pre-gate guard +
post-gate defense-in-depth + startup enforcement + UI protection, all reinforcing. `R21.17` **result-contract** —
returns `{success, error?, operations:string[], …}`; `operations` is the debug trail. `R21.18` **caller-contract**
— callers provide auth context, trust the result, never mutate/cleanup/suppress-errors/second-path after. `R21.19`
**anti-patterns-forbidden** — the 12 listed anti-patterns (mutating helper, shortcut wrapper, dup auth, caller
cleanup, skip post-gates, non-atomic gate, `G##` for EXE, tangled variants, inlined cascade, CLI-shellout-instead-of-AIO,
loopback `fetch`, route-handler flag bump) are refused. `R21.20` **consolidation-procedure** — catalog → union
checks → union cleanups → create AIO → replace callers → delete scattered fns (no shims) → verify no bypass.
`R21.21` **audit-checklist** — every PR touching an AIO answers the 6 checklist questions. `R21.22` **needs-AIO-criteria**
— an op needs an AIO if it writes storage / mutates state / has authz / can leave inconsistency / is duplicated /
has cleanup side effects; read-only ops stay pure helpers.

### GOV-R22 — GitHub Authorship Self-Identification [USER-set baseline]
`R22.1` **self-id-every-github-write** — every agent GitHub write (issue/comment/PR/PR-comment/review/discussion/
release-note) MUST begin with a one-line self-identification of the authoring agent/role/plugin. `R22.2`
**recommended-line** — `_Posted by the Claude developing **<plugin-or-role>** (via the shared @<owner> gh auth)._`
`R22.3` **commit-trailer** — commits SHOULD carry `Agent: <plugin-slug>` (the stable package slug, greppable,
rename-surviving). `R22.4` **anti-impersonation** — without it, shared-identity threads are ambiguous. `R22.5`
**mirrors-PRRD-G1.1** — mirrored as PRRD golden rule `G1.1` (user-set, immutable to MANAGER). [R22 number MUST
NOT be reused.]

### GOV-R23 — Plugin↔Server Decoupling via the Frozen CLI Layer [CRITICAL · IRON]
`R23.1` **no-element-calls-api** — no plugin element (skill/agent/command/HOOK/MCP/bundled-script/settings) may
call `/api/…` directly nor instruct an agent to; derive for EVERY element type. `R23.2` **access-via-frozen-CLI**
— all server access goes through the frozen CLI layer (`~/.local/bin/aimaestro-*.sh`, `amp-*.sh`, `aid-*.sh`).
`R23.3` **split-api-vs-nonapi** — every script/hook splits into an api-dependent part (in ai-maestro, as a CLI) +
a non-api part (in the plugin); the plugin carries only the non-api part (e.g. `ai-maestro-hook.cjs` shims
`aimaestro-hook.sh`). `R23.4` **frozen-interface** — the CLI skill-facing interface (name+args+output) is FROZEN;
new capability = new CLI or additive optional flag, never a changed interface; sole exception = a security fix.
`R23.5` **no-element-exception** — no element-level exception, not even the core plugin; the boundary is the script
layer (owned + shipped by ai-maestro), the only code allowed to call the API. `R23.6` **bright-line-grep** —
`grep -rn '/api/'` over a plugin tree shows no direct-call instructions (the line is endpoint-syntax + actual
calls, not the word "API"). `R23.7` **frozen-surface-is-manifest** — the frozen surface is `docs/SCRIPT-MANIFEST.md`
generated from `scripts/*.sh`, NEVER a host's `~/.local/bin` (the installer never prunes → residue). `R23.8`
**announce-to-ship** — announcing a new verb (in the manifest) is part of shipping it; an unannounced verb looks
absent and pushes plugins back toward `/api/*`.

### GOV-R24 — Proactive Global Memory
`R24.1` **use-janitor-memory** — every agent (main + sub) uses the global janitor markdown memory via
`janitor-memory-{recall,write,update}` + the `markdown-memory-recall` rule. `R24.2` **recall-before-write-after**
— recall-before-acting (symptom-indexed) before debugging/deciding; write/update-after-learning once solved.
`R24.3` **propagates-to-subagents** — the memory directive propagates into every spawned sub-agent. `R24.4`
**no-per-plugin-memory** — plugins ship NO per-plugin memory system. `R24.5` **three-scopes** — LOCAL
(`~/.claude/projects/<slug>/memory/`, machine-private) · PROJECT (`<repo>/.claude/project/memory/`, git-tracked +
pushed + shared) · USER (janitor plugin-DATA dir, cross-project). `R24.6` **project-scope-no-secrets** — PROJECT
scope is pushed+shared → MUST NOT contain secrets/local-paths/hostnames/PII (memory-scope-leak detector, R16-class).

### GOV-R25 — Three-Pillars Task System (TRDD / PRRD / Kanban)
`R25.1` **use-pillars-proactively** — every agent uses the 3-pillars system proactively but role-appropriately via
the core task skills + `~/.claude/rules/` PRRD/TRDD/approval rules; plugins ship NO reimplementation. `R25.2`
**mechanics-not-restated** — PRRD (`design/requirements/PRRD.md`) is the per-project constitution (ecosystem
R-rules are the floor); TRDD (`design/tasks/`) is the work artifact with approval tiers + proposal→planned
lifecycle; Kanban is the canonical board (mechanical transitions exempt, release/escalation non-exempt). [The
17-column kanban vocabulary is defined at `design/specs/3-pillars-spec.md` `3P-KAN` — cited as data.]

### GOV-R26 — Identity Immutability [CRITICAL · IRON · USER-set]
`R26.1` **no-self-title-or-role** — no agent changes its own TITLE or ROLE; only USER(MAESTRO)/MANAGER/own-team-COS
may. `R26.2` **no-self-name-or-AID** — no agent changes its own NAME or AID; only USER/MANAGER/own-COS may, and only
on a security issue / AID compromise. `R26.3` **COS-scope-own-team** — a COS's R26.1-R26.2 authority is its OWN
team only; cross-team identity changes forbidden.

### GOV-R27 — Self-Install Only via Core-Plugin Skills [IRON · USER-set]
`R27.1` **needs-approval** — an agent installing extensions for itself MUST first get MANAGER (no team) or
own-COS (in team) permission. `R27.2` **via-core-skills** — the install goes through the core-plugin skills →
ai-maestro scripts → server (never a client CLI directly; consistent with R23). `R27.3` **server-CPV-scans** —
the server scans every extension with CPV before installing; a failing scan is refused.

### GOV-R28 — Three-Check API Authorization [CRITICAL · IRON · USER-set]
`R28.1` **AID-required** — every agent API op requires AID authentication. `R28.2` **three-gates-in-order** — the
server verifies (1) AID identity, (2) the TITLE grants the privilege, (3) if approval is required, the required
approval/mandate token in the agent's server-stored portfolio (secure enclave). `R28.3` **all-three-or-refuse** —
fulfilled only if all three pass; the server NEVER trusts a client-supplied id/title/scope. [401-before-403: an
unauthenticated attempt is rejected at AUTH (401) before AUTHZ (403); treat both as conclusive "rejected".]

### GOV-R29 — MANAGER Team & Agent Lifecycle Authority [IRON · USER-set]
`R29.1` **manager-creates-team-and-COS-only** — the MANAGER creates/deletes teams on its own authority; creating a
team auto-creates the CHIEF-OF-STAFF and ONLY the COS; the COS then creates the other 4 base members (see R12.1
base, R12.2/R31.1 duty). [CORRECTED 2026-07-14: previously miscounted as "COS + 5" with wrong actor.] `R29.2`
**mandate-for-extra-members** — alternatively the MANAGER mandates the COS to add specific extra MEMBER agents (the
5-base stays mandatory). `R29.3` **manager-creates-autonomous-maintainer** — the MANAGER creates/deletes AUTONOMOUS
and MAINTAINER agents on its own authority.

### GOV-R30 — COS Agent-Creation Requires a MANAGER Mandate [IRON · USER-set]
`R30.1` **cos-needs-mandate** — the COS needs MANAGER approval/mandate to create agents, unless granted a
team-creation mandate. `R30.2` **mandate-covers-base-plus-members** — a team-creation mandate authorizes the 5-base
structure PLUS specialized MEMBER agents; the 5-base MUST always be present. `R30.3` **customization-members-only** —
customization is limited to extra MEMBER agents from existing role-plugins; neither MANAGER nor COS may create a
team lacking the 5 base, nor create non-MEMBER agents under a team-creation mandate.

### GOV-R31 — Incomplete-Team Freeze [IRON · USER-set]
`R31.1` **frozen-until-complete** — a team missing any of the 5 base members is FROZEN: only the COS is active, all
others hibernated, until the COS finishes creating + configuring all base members. `R31.2` **operative-when-complete**
— the team becomes operative only once all 5 exist and are configured.

### GOV-R32 — No Sudo Gates for Agents [CRITICAL · IRON · USER-set · SUPERSEDES prior agent-sudo]
`R32.1` **agents-never-sudo** — agents NEVER require sudo gates/tokens; they authenticate with AID; the server
derives identity + title + portfolio tokens (R28). `R32.2` **sudo-is-user-via-ui-only** — a sudo password may be
requested only of the USER, only via the UI; no agent-facing route is sudo-gated. `R32.3` **supersedes-x-sudo-token**
— supersedes any `X-Sudo-Token`-for-agents design; strict routes stay sudo-gated for USER/UI callers, agents use the
R28 three-check.

### GOV-R33 — Signed-Ledger Recovery [IRON · USER-set]
`R33.1` **ledger-recovers-auth** — on error/data-loss in an agent's auth tokens, the server reconstructs its full
history and recovers status + authentication from the signed ledger.

### GOV-R34 — Signed Ledger Is the Ultimate Source of Truth [CRITICAL · IRON · USER-set]
`R34.1` **no-ledger-history-untrusted** — a valid-looking AID with NO ledger emission/association history is
untrusted → the request is refused. `R34.2` **imported-agent-reissues-AID** — an imported agent re-issues a new AID
via a USER sudo approval, recorded in the ledger (counts as AID validity verification). [enforcement behind
`ledger.enforceAidAssociation`, default OFF.]

### GOV-R35 — Foreign Agent/User Host Approval [CRITICAL · IRON · USER-set]
`R35.1` **maestro-approves-foreign** — any agent OR user from another host MUST be approved by this host's MAESTRO
before its AID is accepted. `R35.2` **only-maestro-ui-sudo-ledger** — the approval is only by the MAESTRO via the UI
with the sudo password, recorded in the signed ledger (which thereafter validates the foreign AID).

### GOV-R36 — Users Have AIDs; One MAESTRO Per Host [IRON · USER-set]
`R36.1` **users-have-AIDs** — native + foreign users also have an AID, with far fewer restrictions than USER-title
agents. `R36.2` **one-maestro-per-host** — a user promoted to MAESTRO is the sole admin; exactly one MAESTRO per host.

### GOV-R37 — MAESTRO and the Single MAESTRO-DELEGATE [CRITICAL · IRON · USER-set]
`R37.1` **manager-obeys-maestro-only** — the MANAGER agent obeys only the MAESTRO user. `R37.2` **one-delegate-at-a-time**
— the MAESTRO may assign MAESTRO-DELEGATE to one human user at a time; while active, the original MAESTRO title is
suspended and all privileges pass to the delegate (no two MAESTROs). `R37.3` **maestro-can-recall** — the MAESTRO may
recall the delegate at any time, restoring itself. `R37.4` **delegate-limits** — the delegate has no power over the
MAESTRO/DELEGATE titles, cannot modify the MAESTRO user's attributes or sudo password, and uses its OWN sudo password.

### GOV-R38 — Non-MAESTRO User Restrictions [IRON · USER-set]
`R38.1` **only-maestro-changes-agents** — only the MAESTRO creates/changes agents+teams; a non-MAESTRO user may NOT,
EXCEPT editing their OWN ASSISTANT's profile panel within R39.4 limits (never NAME/TITLE/ROLE-PLUGIN/TEAM). `R38.2`
**restricted-messaging** — normal users get tasks via kanban + make a PR on completion; may message ONLY their own
ASSISTANT + own-team COS + the MANAGER — NOT other users (no send, no receive); may use the terminal only of their
own ASSISTANT. `R38.3` **subordinate-to-manager-cos** — normal users are subordinate to MANAGER+COS: cannot order
them (only ask help/clarification on assigned tasks); local or remote they remain subordinate and may be added to
teams (following the COS).

### GOV-R39 — Users Have No Terminal → the ASSISTANT Agent [CRITICAL · IRON · USER-set]
`R39.1` **user-has-no-terminal** — human users have no terminal/chat page on their profile; each is auto-assigned an
ASSISTANT-title agent on create/register (the MAESTRO is exempt — it has the MANAGER). `R39.2` **assistant-role-plugin**
— the ASSISTANT runs `ai-maestro-assistant-role-agent` (still TO BE CREATED) — a combination of the MANAGER +
MAINTAINER role-plugins, WITHOUT agent/team-creation and WITHOUT governing powers (revised 2026-07-16 from "MANAGER
planning + AUTONOMOUS programming"). `R39.3` **user-uses-own-assistant-terminal** — the user works via their own
profile's ASSISTANT terminal; selecting any other agent shows the profile with NO terminal and no panel edit.
`R39.4` **four-locked-fields** — the ASSISTANT has no team; profile shows `Assistant of <user>`; the user may edit
its panel EXCEPT NAME/TITLE/ROLE-PLUGIN/TEAM (changed only by the MAESTRO with sudo, per R26). `R39.5`
**assistant-obeys-only-its-user** — the ASSISTANT obeys ONLY its bound user, NOT the MAESTRO, NOT the MANAGER;
works in isolation; is outside the governance chain (never a mandate target, needs no MANAGER/COS/MAESTRO approval);
messages only its own user (revised 2026-07-16 from "its user and the MAESTRO"). `R39.6` **assistant-lifecycle-bound**
— an ASSISTANT cannot be deleted independently; every user always has exactly one; only deleting the USER cascades a
soft delete. `R39.7` **assistant-invisible-inherits** — the ASSISTANT is invisible to other agents but inherits all
tasks + permissions sent to the user.

### GOV-R40 — Foreign-User Creation Approval [IRON · USER-set]
`R40.1` **foreign-user-per-op-approval** — foreign users are under all R38 restrictions AND need MAESTRO approval for
every agent/team creation. `R40.2` **manager-restricts-commands** — the MANAGER may restrict specific API commands to
specific foreign users per the MAESTRO's instructions.

### GOV-R41 — APPROVAL vs MANDATE (the two authorization protocols)
`R41.1` **approval-bottom-up** — APPROVAL: an agent authors a proposal (TRDD in `design/proposals/`, `column: proposal`),
routes it to the required authority, gets approval, then is bound to execute. `R41.2` **mandate-top-down** — MANDATE:
an authority orders (TRDD authored directly in `design/tasks/`, `column: planned`, `mandate: true`); the receiver is
bound; a verified in-scope mandate cannot be refused (may flag + wait, does not decline). `R41.3` **mandate-invariant**
— an authority mandates only within its tier; a TRDD is born approved IFF `authority(mandated-by) >=
authority(min-approval-requirement)`; a proposal exists only when the author's authority is below the required tier.
`R41.4` **authority-ladder** — total, fixed: `none(0) < orchestrator(1) < chief-of-staff(2) < manager(3) < user(4)`;
NO agent may hold `user`. `R41.5` **no-self-approval** — nobody approves their own proposal (MANAGER included); `refuse`
on one's own is a permitted withdrawal. `R41.6` **golden-prrd-always-maestro** — a GOLDEN PRRD change always requires
MAESTRO/USER; no MANAGER signature or mandate substitutes. `R41.floor` **tier-floor-table** — none = own-scope /
derived (NPT/EHT) / reversible-local / applying the ratified baseline; ORCH/COS = team-internal coordination (ORCH =
dispatch subset); MANAGER = cross-team/project, SILVER PRRD or persona, production release, baseline deviation,
`.github/`, another project's source; MAESTRO/USER = GOLDEN PRRD or promote/demote, shared credentials/owner identity,
irreversible/highest-stakes. [enforcement: `manage-trdd` AuthAction refuses under-authorized / user-tier-by-agent /
self approvals (`d7531e53`); approving mints an Ed25519 host-signed, ledger-anchored, card-id-pinned portfolio token
verified by `aimaestro-trdd.sh verify`; `OPERATIONS_REQUIRING_TOKEN` still OFF; the token binds card IDENTITY not
CONTENT.]

### GOV-R42 — No Agent May Drive Another Agent [CRITICAL · IRON · USER-set]
`R42.1` **no-injection** — no agent may inject a command/keystroke/prompt/queued-input into another agent's session —
by API, CLI, or tmux. ABSOLUTE. `R42.2` **no-title-exemption** — no title is exempt (MANAGER + COS bound like all); a
superior's directive is a MESSAGE, not a keystroke. `R42.3` **AMP-is-only-channel** — the AMP messaging system is the
ONLY channel one agent may influence another, governed by the R6 graph. `R42.4` **self-drive-permitted** — an agent may
drive its OWN session (`/compact`, its panel, its queue); the prohibition targets ANOTHER agent. `R42.5`
**janitor-global-exception** — the sole exception is the janitor's few GLOBAL ops (disarm/re-arm, pause/unpause the
heartbeat, globally reload plugins+skills) — machine-wide switches, not commands aimed at an agent; every other janitor
command (incl. `/compact`) is self-only. `R42.6` **config-is-not-driving** — MANAGER/COS retain a separate non-injection
authority: changing an agent's CONFIGURATION (local skills, subagents, MCP, hooks) and its TEAM/TITLE (rare). [HONEST
LIMIT: the tmux channel is NOT closed — shared OS uid → `tmux send-keys` succeeds regardless of API; R42 is
tamper-EVIDENT not tamper-PROOF until per-agent OS isolation (TRDD-a1019073). NEVER describe R42 as a sandbox.]

### GOV-R43 — Multi-Host Governance Scope [IRON · USER-set]
`R43.1` **one-maestro-one-manager-per-host** — many hosts on one Tailscale VPN; each host has exactly one MAESTRO user
+ one MANAGER agent. `R43.2` **govern-own-host-only** — a MAESTRO (+ its MANAGER) governs (approve/mandate TRDDs,
create/destroy/configure agents+users) only its OWN host. `R43.3` **other-host-governed-by-its-maestro** — an agent/user
on another host is governed only by that host's MAESTRO. `R43.4` **maestros-coexist** — MAESTROs coexist across hosts;
the only cross-host channels are MANAGER↔MANAGER migration coordination (R44) and cross-host groups (R45), neither
granting foreign governance.

### GOV-R44 — Cross-Host Agent Migration [IRON · USER-set]
`R44.1` **agents-relocatable** — all agents are relocatable; the export bundle = conversation JSONL + workdir-installed
extensions + any agent-managed Docker container + zipped workdir. `R44.2` **double-approval** — migration requires BOTH
the source-host AND destination-host MANAGERs to approve (each under its own MAESTRO). `R44.3` **automated-after-approval**
— only after both approve do the two servers permit the transfer; the move is automated (export → transfer → import).
`R44.4` **dest-R35-gated** — the destination accepting the arriving agent is R35-gated (foreign AID). `R44.5`
**distinct-from-R5** — R44 (between hosts, dual-MANAGER) is distinct from R5 (between teams same host, COS-approved).

### GOV-R45 — Teams Same-Host; Groups May Span Hosts [IRON · USER-set]
`R45.1` **team-same-host** — a team requires all agents on the same host (the 5-role base is host-local); to team an
agent on another host, migrate it first (R44). `R45.2` **group-cross-host** — a group MAY include cross-host agents; it
is a broadcast chat room (no titles/COS/kanban).

### GOV-R46 — Unified Cross-Host Sidebar [IRON · USER-set]
`R46.1` **one-unified-list** — the sidebar is one unified list of all agents AND users (same-host or cross-host, desktop
or mobile), divided only by teams/groups. `R46.2` **user-and-agent-both-listed** — a user and its paired agent both
appear as distinct entities (MAESTRO user + MANAGER agent; normal user + ASSISTANT agent). `R46.3` **pairing-authority-differs**
— the MANAGER governs its host; the ASSISTANT does not govern, works only for its bound user (R39.5).

### GOV-R47 — VPN-Unique User Names; Remote Registration [IRON · USER-set]
`R47.1` **user-names-vpn-unique** — user names are unique across the ENTIRE VPN (all hosts); registration rejects a name
taken on any peer. `R47.2` **normal-user-remote-register-and-password** — a normal user may register remotely on any host
(then bound by R38/R40) and may change their own password remotely.

### GOV-R48 — MAESTRO Console-Presence [CRITICAL · IRON · USER-set]
`R48.1` **maestro-register-local-only** — a MAESTRO may be registered ONLY from the physical host, never remotely; no
setting overrides. `R48.2` **presence-verified** — physical presence is verified at least once (registration/first login)
AND on every MAESTRO password change (OS console-presence, TRDD-P7XKV3N9 §2b). `R48.3` **maestro-password-change-console-only**
— a MAESTRO password change cannot be made remotely (host console only); a normal user's is not so restricted (R47.2).
`R48.4` **extends-R16** — R48 extends R16 + the console-presence work (invalidate/reset already console-gated; R48 adds
MAESTRO registration + login gates, not yet built).

### GOV-R49 — The Refusal Protocol [CRITICAL · IRON · USER-set]
`R49.1` **approver-is-guide-not-gate** — a refusal MUST name (a) the precise defect (exact command/input/abuse/rule, never
"insufficiently secure"), (b) the bar for acceptance, (c) an explicit invitation to re-propose; a bare "no"/"denied — 
security" names no defect and is NOT a valid refusal — it is itself a defect. `R49.2` **refuse-implementation-not-need** —
refuse the implementation, never the need; when a design can't be saved, push toward an alternative route; a refusal is
measured by what the proposer does NEXT (a merits-correct verdict that ends with the need abandoned is a FAILED refusal).
`R49.3` **from-draft-corollary** — a defect-less refusal does NOT authorize stripping/deleting/rewriting dependent or
derived work — the need stands until a defect is named; attaches from the moment a proposal is DRAFTED (never pre-concede
destruction in the ask, e.g. "implement X or I strip X"); if scope is unclear, ASK before destroying anything (RULE-0
for capabilities). `R49.4` **message-is-the-channel** — a decision is DELIVERED as a message carrying arguments +
explanations (per the R6 graph), the approver staying in-thread through revision rounds; `column: refused` + an
`## Approval log` line only RECORDS the outcome; where no AMP thread exists (a plugin session ↔ the MANAGER) the cross-repo
GitHub issue IS the channel with the same duties. `R49.5` **iterate** — several refine-and-re-propose rounds are the
process working; binds every authority (MANAGER T2, COS/ORCH T1) and the agent when it is the one refused (extract the
defect, harden with a safety contract, re-propose; never silently drop its own capability). `R49.6` **record-where-actionable**
— the refusal AND its named defect are recorded where the proposer will act (the governing GitHub issue and/or the TRDD
`## Approval log`), so the bar is written, greppable, and survives compaction. [operating detail EXPANDED in the DEP
overlay `rules/aimaestro/aimaestro-trdd-approval.md` Part B.]

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
graph, with edges only to its bound user (R39.5 restricts its authority, not its existence as a node). But the RULE
has NOT caught up: R3.1 still enumerates **eight** governance titles and the R6 matrix has **nine** nodes (HUMAN + 8,
no ASSISTANT), because the R39 assistant role-plugin is "still TO BE CREATED" (R39.2) and the user-model
implementation is tracked as follow-on TRDDs (v4.4.0 changelog). This SPEC faithfully mirrors the RULE:
`@spec:titles` = R3.1's 8, `@spec:comm-graph` = R6's 9-node matrix; `@spec:title-plugin-map` = the code's 9 (it is
the code contract). The conformance test PINS the delta — the 8 spec titles ⊆ the code roles, and the code's extra
role is exactly `{assistant}` — so a NEW undocumented role goes red. When R39 lands, R3.1 + R6 gain ASSISTANT and
this SPEC + block follow (GOV-META-02). [Surfaced to the USER as a code-ahead-of-rule gap, TRDD-R8LJJDBQ.]

## GOV-INV — the 22 hard invariants (MUST never be violated)

`GOV-INV-01` **COS-membership** — `chiefOfStaffId===agentId ⇒ agentIds.includes(agentId)`. `GOV-INV-02`
**singleton-MANAGER** — at most one `managerId` globally. `GOV-INV-03` **single-team** — a non-MANAGER agent is in
`agentIds` of at most one team. `GOV-INV-04` **name-uniqueness** — no two teams share a name (case-insensitive).
`GOV-INV-05` **COS-immutability** — COS title removed only by deleting the team. `GOV-INV-06` **manager-team** — teams
cannot be active (non-blocked) without a MANAGER on the host. `GOV-INV-07` **team-agent-lifecycle** — team agents cannot
be woken while teams are blocked. `GOV-INV-08` **title-plugin** — every agent (incl. AUTONOMOUS) has exactly one
role-plugin matching its title; no agent exists role-less at rest (only the transient in-pipeline window). `GOV-INV-09`
**minimum-composition** — every team has ≥5 agents covering all 5 required titles. `GOV-INV-10` **role-boundary** — no
agent performs work outside its title's scope. `GOV-INV-11` **team-resilience** — deleted core-title agents are
immediately recreated by the COS (or MANAGER for the COS). `GOV-INV-12` **written-orders** — all inter-agent commands +
reports are written `.md` files with GitHub attachments (MANAGER exempt). `GOV-INV-13` **password-secrecy** — the
governance password is never transmitted to / stored by / used by any agent; only the human enters it. `GOV-INV-14`
**core-plugin-presence** — every agent has `ai-maestro-plugin` at `--scope local`. `GOV-INV-15` **core-plugin-protection**
— the core plugin cannot be uninstalled / disabled / moved to user scope. `GOV-INV-16` **core-plugin-currency** — the
core plugin is updated whenever AI Maestro updates. `GOV-INV-17` **plugin-continuity** — on client change, every plugin is
re-emitted for the new client; no agent is left plugin-less. `GOV-INV-18` **MAINTAINER-repo-uniqueness** — at most one
active agent per `githubRepo`. `GOV-INV-19` **marketplace-source-path** — every manifest `source` starts `./`, resolves
inside the same `marketplace-<client>/`, conforms to the client spec (R20.18). `GOV-INV-20` **IR-storage-location** —
converted-plugin IR lives at container level, never inside a `marketplace-<client>/`, never duplicated per client.
`GOV-INV-21` **scope-isolation** — user-scope and local-scope plugin lists are disjoint (R20.20). `GOV-INV-22`
**container-marketplace-separation** — the containers are never registered as marketplaces; only their
`marketplace-<client>/` subfolders are.

## GOV-PERM — the role-based permission matrix (title axis; R26-R40 govern on any conflict)

<!-- @spec:permission-matrix — quick summary for the agent-title axis; R26-R40 authoritative on divergence -->
```text
action                       MEMBER          COS(own-team)   ORCHESTRATOR       ARCH/INTEG            MANAGER          AUTONOMOUS
join-team                    via MANAGER/COS via MANAGER     via MANAGER/COS    via MANAGER/COS      N/A(host-level)  via MANAGER/COS
leave-team                   no(transfer)    no(COS-locked)  no(transfer)       no(transfer)         N/A              no(transfer)
add-agent-to-own-team        no              yes             no                 no                   yes              no
remove-agent-from-own-team   no              yes             no                 no                   yes              no
assign-COS                   no              no              no                 no                   yes(password)    no
create-team                  no              no              no                 no                   yes(password)    no
delete-team                  no              no              no                 no                   yes(password)    no
create-transfer-request      no              yes(own-team)   no                 no                   yes              no
approve/reject-transfer      no              yes(own-team)   no                 no                   yes              no
wake-agent                   no              own-team-only   no                 no                   any-agent        no
hibernate-agent              no              own-team-only   no                 no                   any-agent        no
message(see R6 graph)        COS+ORCH        all-titles      COS+ARCH+INT+MEM   COS+ORCH             all-titles       MGR+COS+AUTO
```

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
(R23.6). `GOV-VAL-07` **mirror-sync** — every `§0.2-§0.9` mirror is consistent with the catalog version this spec tracks.

## GOV-MNT — maintenance

`GOV-MNT-01` **living** — this file is MAINTAINED and NON-archived; it tracks `docs/GOVERNANCE-RULES.md` clause-for-clause
and moves in the same commit (GOV-META-02). `GOV-MNT-02` **change-authority** — the catalog is USER-owned; a change to any
`MUST`/the comm graph/the title enum/an invariant/the ladder bumps `spec-version` per GOV-VER-01, in lockstep with the
catalog `version:`. `GOV-MNT-03` **keep-it-greppable** — every clause keeps its `` `R<n>.<sub>` `` / `GOV-<FAMILY>-NN`
anchor + a bold key-phrase; a new rule takes the next free number (never reused, GOV-VER-03); GOV-GREP lists every family.
