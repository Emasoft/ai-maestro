---
number: 30
phase: 3
phase-of: SCEN-030
name: R42 — cleanup, restore the original state
version: "2.0"
description: >
  BURST 3 of SCEN-030 — cleanup. Per Rule 1 this burst is owed whenever the run ends, whether burst 2
  completed, was stopped, or crashed. It deletes the team, the MANAGER and the cemetery entries through
  the UI, restores configuration, and takes the post-test screenshot. It never waits.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - agent-registry
ui_sections:
  - Sidebar -> Teams tab
  - Agent view -> Profile -> Advanced -> Danger Zone
  - Settings -> Cemetery
data_produced:
  - "NOTHING — removes every artifact burst 1 created"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - "burst 1 ran (a backup under state-backups/SCEN-030_<ts>/ exists); burst 2 optional"
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: governance-consistency-campaign
---

# SCEN-030 burst 3 — cleanup

> **RULE 15 — YOU NEVER WAIT.** Every step below acts on state that already exists.

## PRECONDITION — check FIRST, in one cheap call

```bash
find tests/scenarios/state-backups -maxdepth 1 -name 'SCEN-030_*' -type d
```

- No `SCEN-030_*` backup dir → return `BLOCKED: no SCEN-030 setup backup — burst 1 never ran, nothing to clean`

If the backup exists but no `scen030-*` agent or team remains, the UI steps are no-ops: record that and
continue to S016.

---

## Phase CLEANUP: Restore Original State

#### S013: Delete the team (cascade its agents)
- **Action:** Teams tab → `scen030-team` → Delete team → password inline → check "Also delete agents in this team" → Delete Team.
- **Goal:** Team, COS and MEMBER gone, sessions killed, folders removed.
- **Removes:** team, `cos-scen030-team`, `scen030-member`
- **Verify:** `GET /api/teams` 404s the team; neither agent is in the registry.

#### S014: Delete the MANAGER
- **Action:** MANAGER profile → Advanced → Danger Zone → Delete Agent → `aim_sudo_modal` → check "Also delete agent folder" → type the name → Delete Forever.
- **Goal:** MANAGER gone, folder gone.
- **Removes:** `scen030-manager` + `~/agents/scen030-manager/`
- **Verify:** absent from the registry; the folder does not exist.

#### S015: Purge the cemetery
- **Action:** Settings → Cemetery → Purge each `scen030-*` entry.
- **Goal:** No test residue.
- **Removes:** cemetery archives
- **Verify:** no `scen030` entry remains.

#### S016: STATE-WIPE — restore configuration files
- **Action:** Compare each `rewipe-list` file against the S001 backup; restore any that still differ after the UI deletions.
- **Goal:** All config files match the pre-test state.
- **Removes:** nothing
- **Verify:** SHA256 match for every file in the manifest.

#### S017: Post-test screenshot
- **Action:** Screenshot the dashboard.
- **Goal:** UI identical to the S002 baseline.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** visual comparison with the baseline.
