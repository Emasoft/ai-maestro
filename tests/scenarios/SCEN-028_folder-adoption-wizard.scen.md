---
number: 28
name: Folder Adoption Wizard (maintainer + autonomous paths)
version: "1.0"
description: >
  The user adopts an EXISTING git plugin repo as an agent working directory
  through the Agent Creation Wizard's "Browse existing project folder" flow —
  first as MAINTAINER (with the github-repo step prefilled from the folder's
  git origin), then verifies the workdir is NOT polluted (managed ignore block
  in .git/info/exclude, clean `git status`), soft-deletes the agent, and
  re-adopts the SAME folder as AUTONOMOUS to prove the folders-route tombstone
  fix. Regression scenario for TRDD-57EBNB72 (the adoption flow silently broke
  at the API boundary because no scenario covered it).
client: claude
interhosts: false
device: desktop
subsystems:
  - agent-registry
  - element-management-service
  - governance
  - role-plugins
ui_sections:
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (client, avatar, team, title, folder, github-repo, summary)
  - Agent Creation Wizard -> Folder step -> Browse existing project folder
  - Agent Profile -> Advanced tab -> Danger Zone -> Delete Agent
  - Settings -> Cemetery tab -> Purge
  - Sudo password modal (Rule 12)
data_produced:
  - 1 test agent "scen028-maintainer-01" (temporary, created and deleted)
  - 1 test agent "scen028-auto-01" (temporary, created and deleted)
  - Seeded artifacts inside the dir fixture — .claude/rules/aimaestro-*.md,
    .claude/settings.local.json, .claude/ plugin config, managed block in
    .git/info/exclude (temporary, scrubbed by cleanup-SCEN-028.sh)
  - Agent registry entries (temporary, deleted)
  - Cemetery archive entries (temporary, purged)
browser_stack: dev-browser
prerequisites:
  - AI Maestro server running at http://localhost:23000 (dev-browser handles browser launch)
  - Governance password set
  - "dir fixture ~/agents/scen028-import-fixture exists: a git repo with a scenario-start tag, at least one tracked file, and origin set to https://github.com/Emasoft/scen028-import-fixture.git (the URL is never fetched — the github-repo prefill is a pure filesystem read of .git/config)"
  - 'No pre-existing agents matching "scen028-*"'
governance_password: "$AIM_GOVERNANCE_PASSWORD"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures:
  - ~/agents/scen028-import-fixture
commit: TBD
---

# SCEN-028 — Folder Adoption Wizard (maintainer + autonomous paths)

> **Note:** This scenario exercises the `allowExternalFolder` adoption path end-to-end
> (TRDD-57EBNB72): API schema flag → G03-CLAMP → G05c managed git-exclude seeding →
> folders-route tombstone filter + `githubRepo` enrichment → maintainer wizard step order
> `title → folder → github-repo → summary`. The fixture folder is PERMANENT (a fixture,
> not a per-run artifact): no step may ever check "Also delete agent folder" on it.

## Phase 0: SAFE-SETUP

#### S001: Commit, build, start server
- **Action:** `git status` must be clean (commit by name if not). `yarn build`, then `pm2 restart ai-maestro`. Verify `GET /api/sessions` returns 200.
- **Goal:** Server healthy on current code
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:23000/api/sessions` returns 200 (401 also proves liveness when logged out)

#### S002: Run the per-scenario setup script
- **Action:** `tests/scenarios/scripts/setup-SCEN-028.sh` — backs up the rewipe-list with SHA256 manifest and resets the dir fixture to its `scenario-start` tag. If it exits non-zero, fix the fixture (do not bypass).
- **Goal:** CHECKPOINT-SAVE complete; fixture pristine
- **Creates:** `tests/scenarios/state-backups/SCEN-028_<timestamp>/`
- **Modifies:** nothing
- **Verify:** Backup dir exists with MANIFEST; `git -C ~/agents/scen028-import-fixture status --porcelain` is empty

#### S003: Kill orphan test sessions
- **Action:** `tmux list-sessions | grep '^scen028-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}` (no-op when none)
- **Goal:** No stale scen028 tmux sessions
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `tmux list-sessions` shows no `scen028-*`

#### S004: Login + baseline screenshot
- **Action:** Via dev-browser (`--browser ai-maestro-scenarios --headless --timeout 60`): navigate to `http://localhost:23000`, log in with governance password `$AIM_GOVERNANCE_PASSWORD` if prompted, wait for the sidebar to render.
- **Goal:** Authenticated dashboard visible
- **Creates:** baseline screenshot
- **Modifies:** nothing
- **Verify:** Screenshot `S004_<RUN_ID>_baseline.jpg` saved; sidebar Agents tab visible

---

## Phase 1: MAINTAINER adoption of the fixture repo

#### S005: Open the Agent Creation Wizard
- **Action:** Sidebar → Agents tab → "Create new agent" button
- **Goal:** Wizard opens at the client step
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the wizard dialog with client options

#### S006: Select client, avatar, no team
- **Action:** Pick client `claude` → next; pick any avatar → next; skip/none on the team step → next
- **Goal:** Wizard at the title step
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the governance-title cards

#### S007: Select MAINTAINER title
- **Action:** Click the MAINTAINER title card, proceed
- **Goal:** Wizard advances to the FOLDER step (maintainer order is title → folder → github-repo → summary)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the folder step (name input + "Browse existing project folder"); screenshot `S007_<RUN_ID>_maintainer-folder-step.jpg`

#### S008: Set the agent name and browse the fixture folder
- **Action:** Type name `scen028-maintainer-01`. Use "Browse existing project folder" and select `FOLDFIX[0]` (`~/agents/scen028-import-fixture`). Proceed.
- **Goal:** Folder accepted (selectable — not marked taken), wizard advances to the github-repo step
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the github-repo step

#### S009: Verify the github-repo prefill
- **Action:** Read the github-repo input's current value from the snapshot — no typing.
- **Goal:** The field is PREFILLED with `https://github.com/Emasoft/scen028-import-fixture` (from the fixture's `.git/config` origin, enriched by `GET /api/agents/folders`)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot text match on the prefilled URL; screenshot `S009_<RUN_ID>_github-prefill.jpg`. An empty field is a BUG (Rule 4).

#### S010: Create the agent
- **Action:** Proceed to summary; confirm the summary shows workdir = `FOLDFIX[0]`; click Create. Handle the sudo password modal if it appears (enter `$AIM_GOVERNANCE_PASSWORD`, Confirm).
- **Goal:** Agent created — adoption IN PLACE (no `~/agents/scen028-maintainer-01/` folder is created)
- **Creates:** registry entry `scen028-maintainer-01`; seeded artifacts inside the fixture
- **Modifies:** fixture's `.claude/` + `.git/info/exclude`
- **Verify:** Wizard closes; sidebar lists `scen028-maintainer-01`; screenshot `S010_<RUN_ID>_created.jpg`

#### S011: API + filesystem verification (read-only)
- **Action:** `GET /api/agents` → find `scen028-maintainer-01`; then read-only fs checks on `FOLDFIX[0]`.
- **Goal:** All of: `agent.workingDirectory == FOLDFIX[0]`; `agent.governanceTitle == "maintainer"`; `~/agents/scen028-maintainer-01/` does NOT exist; `.claude/rules/aimaestro-*.md` seeded (4 files); `.claude/settings.local.json` present; `.git/info/exclude` contains both `ai-maestro:managed-gitignore` marker lines; **`git -C FOLDFIX[0] status --porcelain` is EMPTY** (the whole point: adoption must not dirty the repo)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Every check above passes; any non-empty git status is a BUG (Rule 4)

---

## Phase 2: Tombstone regression — soft delete, then re-adopt the SAME folder

#### S012: Soft-delete the maintainer agent (folder MUST survive)
- **Action:** Select `scen028-maintainer-01` → Profile → Advanced → Danger Zone → Delete Agent. When the sudo modal appears enter `$AIM_GOVERNANCE_PASSWORD` and Confirm. In the delete dialog do **NOT** check "Also delete agent folder" (the folder is a permanent fixture). Type the agent name, click Delete Forever.
- **Goal:** Agent removed from the sidebar; fixture folder intact
- **Creates:** cemetery archive entry
- **Modifies:** registry (tombstone)
- **Verify:** Sidebar no longer lists it; `~/agents/scen028-import-fixture` still exists; screenshot `S012_<RUN_ID>_deleted.jpg`

#### S013: Re-adopt the SAME folder as AUTONOMOUS
- **Action:** Open the wizard again: client `claude` → avatar → no team → title AUTONOMOUS → name `scen028-auto-01` → "Browse existing project folder" → select `FOLDFIX[0]` again → summary → Create (sudo modal per Rule 12 if prompted).
- **Goal:** The folder is SELECTABLE despite the soft-deleted prior owner (folders-route tombstone filter) and creation succeeds; no github-repo step for AUTONOMOUS
- **Creates:** registry entry `scen028-auto-01`
- **Modifies:** nothing new in the fixture (seeding is idempotent)
- **Verify:** Sidebar lists `scen028-auto-01`; `GET /api/agents` shows `workingDirectory == FOLDFIX[0]`; a "folder already in use" rejection is a BUG (Rule 4); screenshot `S013_<RUN_ID>_readopted.jpg`

#### S014: Re-verify the fixture is still clean
- **Action:** Read-only: `git -C FOLDFIX[0] status --porcelain`
- **Goal:** Still EMPTY after the second adoption (idempotent seeding, no duplicate block)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Empty output; exactly ONE managed block (2 marker lines) in `.git/info/exclude`

---

## Phase CLEANUP: Restore Original State

#### S015: Delete the autonomous agent (folder preserved)
- **Action:** Same UI delete flow as S012 for `scen028-auto-01` — sudo modal with `$AIM_GOVERNANCE_PASSWORD`, do **NOT** check "Also delete agent folder", type name, Delete Forever.
- **Goal:** Agent removed; fixture intact
- **Removes:** `scen028-auto-01` from sidebar/registry (tombstone)
- **Verify:** Sidebar clean of `scen028-*`; fixture folder exists

#### S016: Purge cemetery entries
- **Action:** Settings → Cemetery tab → Purge each `scen028-*` archive (one sudo modal per purge — tokens are one-shot, Rule 12).
- **Goal:** No scen028 archives remain
- **Removes:** cemetery zips for both test agents
- **Verify:** Cemetery list shows no `scen028-*`; screenshot `S016_<RUN_ID>_cemetery-clean.jpg`

#### S017: Verify registry is clean via API
- **Action:** `GET /api/agents` (and the registry file read-only) — no `scen028-*` entries should remain visible in the UI list.
- **Goal:** Zero scen028 agents in the live list
- **Removes:** nothing
- **Verify:** API response contains no `scen028-` names

#### S018: STATE-WIPE — restore configuration files + scrub fixture artifacts
- **Action:** Run `tests/scenarios/scripts/cleanup-SCEN-028.sh` — restores the rewipe-list backups with SHA256 verification and scrubs the per-run artifacts the adoption seeded INTO the fixture (`.claude/rules/aimaestro-*.md`, `.claude/settings.local.json`, the managed block in `.git/info/exclude`), returning the fixture to pristine `scenario-start` state.
- **Goal:** All config files match pre-test state; fixture pristine
- **Removes:** seeded fixture artifacts
- **Verify:** Script exits 0; SHA256 matches for every manifest file; `git -C FOLDFIX[0] status --porcelain` empty AND `.git/info/exclude` has no `ai-maestro:managed-gitignore` marker

#### S019: Post-test screenshot
- **Action:** Navigate to the dashboard, take a full-page screenshot.
- **Goal:** UI identical to the S004 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot `S019_<RUN_ID>_post-test.jpg` saved; visual comparison with S004 baseline shows no scen028 remnants
