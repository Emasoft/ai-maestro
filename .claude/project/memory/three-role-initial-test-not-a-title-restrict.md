---
name: three-role-initial-test-not-a-title-restrict
description: "does 'we need a version running with only 3 role plugins (MANAGER/MAINTAINER/AUTONOMOUS)' mean restrict/hide the other titles in the wizard? NO — it means the 3 NO-TEAM host-level titles for a team-less initial test; do not gate/remove the other 6"
ocd: 2026-07-22
lmd: 2026-10-02
metadata:
  node_type: memory
  type: feedback
  tier: component
  topic: teams-and-governance
publish-globally: false
---

^S8ZS60TS [desc: "The USER's ask for 'only 3 role plugins' (MANAGER/MAINTAINER/AUTONOMOUS) names the 3 NO-TEAM host-level titles for a team-less initial test, not a restriction of the title surface.", keywords: only_3_role_plugins_request restrict_hide_other_titles_wizard 3_role_plugins_mandate MANAGER_MAINTAINER_AUTONOMOUS no_team_host_level_titles team_less_initial_test GOVERNANCE_RULES_R3_1_R4_3_R9_5_R19_1 other_5_team_titles_not_removed finalization_ask R12_minimum_composition not_exercised_not_removed, ocd: 2026-07-22, lmd: 2026-10-02]
**Why:** The USER's finalization ask — *"a version capable of running the current governance rules with only 3
role plugins: MANAGER (created anew, capable of all governance rules), MAINTAINER (imported plugins), AUTONOMOUS
(existing agents)"* — is about which role-plugins to GET READY for the **initial test**, NOT about restricting the
title surface. MANAGER, MAINTAINER, AUTONOMOUS are exactly the three **NO-TEAM, host-level** titles
(GOVERNANCE-RULES R3.1, R4.3, R9.5, R19.1): they need no team infrastructure — no COS / ARCHITECT / ORCHESTRATOR /
INTEGRATOR / MEMBER, no R12 minimum-composition, no team comm-graph. So "only these 3 for the initial test" means
the initial test simply **does not stand up teams**; the other 5 team titles are just not exercised, not removed.

^JGC6M94S [desc: "'Get ready those 3 role-plugins' means making the manager/maintainer/autonomous repos current for the test (cross-project: issue/PR only); never change TITLE_PLUGIN_MAP, AgentRole or the wizard.", keywords: get_ready_3_role_plugins ai_maestro_assistant_manager_agent ai_maestro_maintainer_agent ai_maestro_autonomous_agent MANAGER_created_anew adapt_AMAMA_capability cross_project_issue_PR_only TITLE_PLUGIN_MAP_untouched AgentRole_union_untouched wizard_title_dialog_untouched initial_test_readiness, ocd: 2026-07-22, lmd: 2026-10-02]
**How to apply:** "get ready those 3 role-plugins" = ensure `ai-maestro-assistant-manager-agent`,
`ai-maestro-maintainer-agent`, `ai-maestro-autonomous-agent` (each its OWN Emasoft repo, §0.3 — cross-project, so
issue/PR only, never in-place edits) are current/capable for the test; MANAGER "created anew, capable of all
governance rules" = the adapt-AMAMA capability work in AMAMA's repo (in a team-less test it is the sole authority).
It is NOT a server-side change to `TITLE_PLUGIN_MAP` / the `AgentRole` union / the wizard / the title dialog.

## Notes and lessons learned
[^1]: [id:ATOM-3RIT-MRD1, status:valid, keywords:"only 3 role plugins mandate, restrict titles wizard, initial test 3 roles, MANAGER MAINTAINER AUTONOMOUS ready, hide other titles, finalization", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT read "we need a version running with only 3 role plugins" as "restrict/hide the other titles in the UI", BECAUSE the USER meant get those 3 NO-TEAM host-level role-plugins READY for a team-less initial test — the other titles stay fully available. (I built the restrict via `ACTIVE_GOVERNANCE_TITLES`; it was reverted `04108dbc` and the USER was upset.) DO ask what "ready" concretely means (verify/publish the 3 repos vs the MANAGER-anew build) and leave the title surface untouched.
