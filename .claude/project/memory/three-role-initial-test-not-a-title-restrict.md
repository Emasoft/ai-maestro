---
name: three-role-initial-test-not-a-title-restrict
description: "does 'we need a version running with only 3 role plugins (MANAGER/MAINTAINER/AUTONOMOUS)' mean restrict/hide the other titles in the wizard? NO — it means the 3 NO-TEAM host-level titles for a team-less initial test; do not gate/remove the other 6"
ocd: 2026-07-22
lmd: 2026-07-22
metadata:
  node_type: memory
  type: feedback
  tier: component
  topic: teams-and-governance
---

**Why:** The USER's finalization ask — *"a version capable of running the current governance rules with only 3
role plugins: MANAGER (created anew, capable of all governance rules), MAINTAINER (imported plugins), AUTONOMOUS
(existing agents)"* — is about which role-plugins to GET READY for the **initial test**, NOT about restricting the
title surface. MANAGER, MAINTAINER, AUTONOMOUS are exactly the three **NO-TEAM, host-level** titles
(GOVERNANCE-RULES R3.1, R4.3, R9.5, R19.1): they need no team infrastructure — no COS / ARCHITECT / ORCHESTRATOR /
INTEGRATOR / MEMBER, no R12 minimum-composition, no team comm-graph. So "only these 3 for the initial test" means
the initial test simply **does not stand up teams**; the other 5 team titles are just not exercised, not removed.

**How to apply:** "get ready those 3 role-plugins" = ensure `ai-maestro-assistant-manager-agent`,
`ai-maestro-maintainer-agent`, `ai-maestro-autonomous-agent` (each its OWN Emasoft repo, §0.3 — cross-project, so
issue/PR only, never in-place edits) are current/capable for the test; MANAGER "created anew, capable of all
governance rules" = the adapt-AMAMA capability work in AMAMA's repo (in a team-less test it is the sole authority).
It is NOT a server-side change to `TITLE_PLUGIN_MAP` / the `AgentRole` union / the wizard / the title dialog.

## Notes and lessons learned
[^1]: [id:ATOM-3RIT-MRD1, status:valid, keywords:"only 3 role plugins mandate, restrict titles wizard, initial test 3 roles, MANAGER MAINTAINER AUTONOMOUS ready, hide other titles, finalization", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT read "we need a version running with only 3 role plugins" as "restrict/hide the other titles in the UI", BECAUSE the USER meant get those 3 NO-TEAM host-level role-plugins READY for a team-less initial test — the other titles stay fully available. (I built the restrict via `ACTIVE_GOVERNANCE_TITLES`; it was reverted `04108dbc` and the USER was upset.) DO ask what "ready" concretely means (verify/publish the 3 repos vs the MANAGER-anew build) and leave the title surface untouched.
