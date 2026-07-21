---
name: governance-titles-active-set-restrict
description: "why does the agent-creation wizard / title-assignment dialog only OFFER 3 titles (MANAGER/MAINTAINER/AUTONOMOUS) instead of all 8-9 — where is the one switch, how to expose more or revert to the full set, why dormant-title agents still work"
ocd: 2026-07-22
lmd: 2026-07-22
metadata:
  node_type: memory
  type: project
  tier: component
---

This build EXPOSES only **3** governance titles for NEW-agent selection — `manager`, `maintainer`,
`autonomous` — via the SSOT `ACTIVE_GOVERNANCE_TITLES` in `types/agent.ts` (sits right beside the
full-set `VALID_GOVERNANCE_TITLES`). The full 9-value `AgentRole`/`GovernanceTitle` union,
`TITLE_PLUGIN_MAP`, `PLUGIN_COMPATIBLE_TITLES`, `PREDEFINED_ROLE_PLUGIN_NAMES`, the comm graph, and the
role-plugin repos are ALL intact — the other 6 (`chief-of-staff`, `architect`, `orchestrator`,
`integrator`, `member`, `assistant`) are **DORMANT, not deleted**. This is the 3-role "final form"
(TRDD-H18PO5YJ, commit `963d3cda`) built toward the `governance-rules → main` PR.

**Only TWO user-facing enumerations filter through `ACTIVE_GOVERNANCE_TITLES` (helper: `isActiveGovernanceTitle`):**
1. `components/AgentCreationWizard.tsx` — `TEAM_TITLES`/`STANDALONE_TITLES` each `.filter(t => isActiveGovernanceTitle(t.value))`. TEAM→∅ (all team titles are dormant) so `TitlePickerWidget` renders an empty-state instead of a blank picker; STANDALONE→the 3.
2. `components/governance/TitleAssignmentDialog.impl.tsx` — `visibleTitleOptions = TITLE_OPTIONS.filter(o => isActiveGovernanceTitle(o.title) || o.title === currentTitle)`. The `|| currentTitle` keeps a DORMANT-title agent's OWN current title visible so it can switch away from it. `TITLE_OPTIONS` itself stays full (disabled-reason / transition logic depends on it).

**Why restrict-keep-dormant (not collapse the union):** collapsing the union / `TITLE_PLUGIN_MAP` / comm graph would be a large breaking refactor across hundreds of sites AND would STRAND existing dormant-title agents — every per-title LOOKUP for a removed title would return `undefined`. Gating only the two OFFER enumerations leaves every LOOKUP total. Casing note: the title/`AgentRole` domain is lowercase (`'manager'`) but `TITLE_PLUGIN_MAP` keys are UPPERCASE (`'MANAGER'`); `isActiveGovernanceTitle` lowercases before matching.

**How to apply / revert:** to expose more titles (or all), edit ONLY `ACTIVE_GOVERNANCE_TITLES` in `types/agent.ts` (set it to `VALID_GOVERNANCE_TITLES` for the full set). It is the SINGLE switch — do NOT re-derive the active set anywhere else, and do NOT trim the union/maps to "hide" a title. A live DORMANT-title agent (e.g. the 1 `architect` on the fleet at the time of the restrict) still functions; reconcile it to an active title via the title dialog or a `ChangeTitle` run.

See also [[ai-maestro-fleet-hub-what-and-roster]] — the conceptual 8-role org chart (USER scope). It is still accurate: the roles exist, they are just dormant in this build.

## Notes and lessons learned
[^1]: [id:ATOM-3RL0-SST1, status:valid, keywords:"only 3 titles offered wizard dialog, ACTIVE_GOVERNANCE_TITLES, restrict keep dormant, expose more roles add a title back, wizard shows empty team roles", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT add a title back (or hide one) by editing the wizard/dialog directly or by trimming `TITLE_PLUGIN_MAP` / the `AgentRole` union, BECAUSE the offer surface is gated by ONE SSOT (`ACTIVE_GOVERNANCE_TITLES`) and the full maps are deliberately kept total so dormant-title agents keep resolving (a trimmed map ⇒ `undefined` lookups strand live agents). DO edit only `ACTIVE_GOVERNANCE_TITLES` in `types/agent.ts`.
