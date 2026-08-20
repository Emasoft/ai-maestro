---
name: agent-title-role-persona
description: "TITLE vs ROLE vs PERSONA in ai-maestro / what is governanceTitle vs rolePlugin / can one role-plugin serve multiple titles / why does ChangeTitle reject this plugin / difference between ChangePlugin and ChangeTitle / what determines who an agent can message"
ocd: 2026-08-02
lmd: 2026-08-20
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: agents
publish-globally: false
---

# agent-title-role-persona

## Agent Terminology (TITLE / ROLE / PERSONA) — READ FIRST

Every AI Maestro agent has exactly **three orthogonal layers**. Do NOT collapse or conflate them — they map to different pipelines, different UI tabs, and different governance rules.

| Layer | Answers | Example |
|---|---|---|
| **TITLE** | *What is it allowed to do?* (governance class — permissions) | `MEMBER` |
| **ROLE** | *What does it know how to do?* (behaviour — role-plugin main agent) | `ai-maestro-programmer-agent:programmer-main-agent@Emasoft/ai-maestro-plugins` |
| **PERSONA** | *Which specific running instance?* (identity — name + AID + avatar + workdir) | `peter-bot, <aid>, ~/avatars/peter.jpg, ~/agents/peter-bot/` |

**TITLE** is the access-control role — it determines who the agent can message (comm graph), whether it can wake/hibernate others, whether it can `gh pr merge`, whether it can create teams. Eight valid titles: `MANAGER`, `CHIEF-OF-STAFF`, `ARCHITECT`, `ORCHESTRATOR`, `INTEGRATOR`, `MEMBER`, `MAINTAINER`, `AUTONOMOUS`. Stored as `agent.governanceTitle` (lowercase kebab). Changing it runs the `ChangeTitle` pipeline.

**ROLE** is the role-plugin *main-agent* the PERSONA currently runs. Fully qualified as `<plugin>:<main-agent>@<marketplace>` — the `@marketplace` mirrors Claude Code's plugin syntax and the `:main-agent` segment selects which main-agent `.md` file inside the plugin is loaded via `claude --agent <name>`. Installed exactly like any normal plugin (`claude plugin install <name> <marketplace> --scope local` after `claude plugin marketplace add <path-or-owner/repo>`). A role-plugin is any plugin that additionally contains (a) a `<name>.agent.toml` with the two extra fields `compatible-titles` and `compatible-clients`, and (b) a main-agent `.md` whose persona carries the governance rules (inline, via `skills:` references, or via rule-file links). The two AI Maestro default role-plugin marketplaces are the remote `Emasoft/ai-maestro-plugins` and the local `ai-maestro-local-roles-marketplace`.

**PERSONA** is the concrete running instance — four attributes (name, AID key pair, avatar, workdir) that together identify a specific Claude Code tmux session. Only PERSONA has 1:1 cardinality with a session; TITLE and ROLE are swappable on a live PERSONA without losing identity. The workdir defaults to `~/agents/<name>/`, but a MANAGER / MAINTAINER / AUTONOMOUS persona may instead **adopt an existing project folder in place** (e.g. `~/Code/<plugin>`) via `allowExternalFolder` — see the `agent-workdir-invariants-and-policy` page for the one authority that decides which directories are permitted, and for why this is authorization rather than containment. The workdir (wherever it resolves) plus `/tmp` is where the PERSONA is expected to write.

**Key relationships and rules**
- TITLE and ROLE are **orthogonal but constrained** by `compatible-titles`. ChangeTitle rejects assigning a ROLE whose `.agent.toml` does not include the new TITLE.
- **N:1 model:** multiple ROLEs can satisfy one TITLE (UI shows a dropdown when ≥2 are compatible, a locked label when exactly 1 is). One ROLE can also be compatible with multiple TITLEs.
- **R9.13:** Every persisted agent MUST carry exactly one ROLE. The `CreateAgent` / `ChangeTitle` pipelines HARD REJECT any desired-state that would leave an agent with zero role-plugins. AUTONOMOUS resolves to the mandatory `ai-maestro-autonomous-agent` role-plugin.
- **Storage is NOT definitional** for a role-plugin. Folders may live anywhere as long as they are listed in a marketplace manifest's `source` field. `TITLE_PLUGIN_MAP` is an internal default-picker and is not a requirement of the role-plugin definition.
- **Haephestos is one path** to creating a role-plugin, not the definition. Any plugin matching the two conditions above is a valid role-plugin regardless of how it was authored.

**When writing code or docs**
- Use **TITLE** when talking about permissions, governance, comm graph, approvals.
- Use **ROLE** when talking about behaviour, skills, main-agent persona, available tools.
- Use **PERSONA** when talking about which specific agent (the one in the sidebar card, at that workdir, with that AID).
- Do not use "role" to mean "title" — the 2026-03-20 rename made `TitleBadge` / `TitleAssignmentDialog` authoritative. `agent.governanceTitle` is the TITLE; `agent.rolePlugin` (config) is the ROLE; `agent.name` + `agent.label` + `agent.aid` + `agent.workingDirectory` are the PERSONA.
- When the user says "change the agent's role", clarify whether they mean swap the role-plugin (ROLE) or re-assign the governance level (TITLE) — these are different pipelines (`ChangePlugin` with `rolePluginSwap` vs `ChangeTitle`).


^ATOM-PNJX-P7AY [desc:"USER ruling 2026-08-06: no role field exists — taxonomy is TITLE + role-plugin; registry role key removed and migration-stripped", keywords: role_field_removed role_is_not_part_of_the_taxonomy agent.role messaging_role role_autonomous_contradiction role_vs_governanceTitle registry_role_key_stripped, type: reference, ocd: 2026-08-05, lmd: 2026-08-05]

There is NO persisted `role` field on an agent record — and there never should have
been. USER ruling 2026-08-06, verbatim: "there is no such thing as a `role`. There is
the `title`, and there is the `role-plugin`. role is not part of the taxonomy." The
registry used to persist `role: request.role || 'autonomous'` (a "messaging role"
sharing the AgentRole vocabulary), and on a manager-titled agent the pair
`role: "autonomous"` + `governanceTitle: "manager"` was misread as a title
contradiction — a live agent refused a legitimate MANAGER mandate over it
(ai-maestro#122, TRDD-4Z62YRDG). Removed in `4b039716` (types, writers, UI); the
`loadAgents` migration strips a legacy `role` key WHATEVER its value. If code ever
used `role` in a DECISION (validity, plugin compatibility), the fix is REPLACEMENT
with the title, never bare deletion — the one such site (composition-check's
`governanceTitle || role` fallback) was replaced with the title in `b9f7e401`.
Messaging authority derives from the TITLE at message time
(`isManager()`/`isChiefOfStaffAnywhere()`).

^ATOM-XER0-P82F [desc:"title == governanceTitle, ONE concept: TITLE is the taxonomy term, governanceTitle the code/API spelling, governance_title the signed-token wire — bound, not renamed (TRDD-MCKBB117)", keywords: title_vs_governanceTitle why_two_names_for_title rename_governanceTitle governance_title_wire title_naming_binding, type: reference, ocd: 2026-08-05, lmd: 2026-08-05]

`title` and `governanceTitle` are ONE concept (USER, 2026-08-06: "governanceTitle and
title are the same thing"). Ruled under delegation in TRDD-MCKBB117: the names are BOUND,
not renamed — TITLE is the taxonomy term on every human-facing surface; `governanceTitle`
is the single code/API/storage spelling (bare `title` is overloaded — TRDD frontmatter,
UI titles); `governance_title` is the signed AID-token wire spelling. No fourth spelling.
The rename was REJECTED on measured facts: 216 production sites + 1819 test refs, deployed
fleet CLIs parse `.governanceTitle`, and signed `aim_tk_*` tokens embed `governance_title`
— unrewritable, so a rename forces dual-spelling acceptance through rotation (forbidden
backward-compat). Normative home: governance-spec.md TERM-02 (2.4.2). Re-open only as a
coordinated flag-day.

## See also

## Notes and lessons learned
