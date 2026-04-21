---
number: 27
name: JSONL Session Browser — Sessions tab end-to-end
version: "1.0"
description: >
  The user logs into the AI Maestro dashboard, creates a test agent so a
  JSONL conversation file reliably exists on disk for it, opens the agent's
  Profile, clicks the new "Sessions" tab, and drives every user-facing
  surface of the JSONL session browser end-to-end: the session list, the
  virtualized chat transcript with per-message token badges, the 7-bucket
  context-breakdown panel, and the incremental search bar. They switch
  between two sessions (if the agent has more than one on disk) to confirm
  the transcript clears and reloads, then clean up by deleting the test
  agent through the UI and running STATE-WIPE.

  The scenario exercises all four Phase-2 API routes
  (`/api/sessions-browser/agents/:id/sessions`, `.../sessions/:sid/range`,
  `.../sessions/:sid/search`, `.../sessions/:sid/context-breakdown`) through
  the React UI only — no direct `curl` mutation of server state — and
  confirms that the streaming Rust reader (Phase 1) + Node wrapper (Phase 2)
  + Sessions tab UI (Phase 3) compose correctly.

  If the test agent has no JSONL file yet by the time the Sessions tab is
  opened (because Claude Code has not been launched inside its workdir),
  the scenario records the empty-state UI under Phase 2 and SKIPs the
  transcript / search / context-breakdown phases. The empty-state branch
  is still a PASS — that's the documented behavior for an agent with zero
  sessions per TRDD §6.3-#9.
client: claude
interhosts: false
device: desktop
browser_stack: dev-browser
subsystems:
  - sessions-service (Phase 2 wrapper + 4 API routes)
  - agent-registry (agent workingDirectory → Claude project-dir slug mapping)
  - aim-jsonl-reader (Rust streaming reader, sparse .aimidx sidecar, NDJSON over stdio)
  - element-management-service (CreateAgent / DeleteAgent pipelines used for setup + cleanup)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7, client=claude)
  - Agent Profile -> Sessions tab -> Session list
  - Agent Profile -> Sessions tab -> Chat transcript (virtualized)
  - Agent Profile -> Sessions tab -> Context breakdown panel
  - Agent Profile -> Sessions tab -> Search bar
  - Agent Profile -> Advanced tab -> Danger Zone
  - Sudo password modal (Rule 12)
data_produced:
  - 1 test agent "scen027-jsonl-session-browser" (temporary, created and deleted via UI)
  - 0-N .jsonl session files for that agent under ~/.claude/projects/<slug>/ (temporary; removed when the agent folder is deleted)
  - 0-N .aimidx sparse index sidecars next to each .jsonl (temporary; removed with the parent .jsonl)
  - Backup directory under tests/scenarios/state-backups/SCEN-027_<ts>/
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set
  - Chrome available to dev-browser (the `ai-maestro-scenarios` named instance)
  - "`scripts/aim-jsonl-reader` binary built (run `yarn build` if missing — build:jsonl-reader triggers cargo build --release)"
  - ai-maestro-plugins marketplace registered (`claude plugin marketplace list` shows it)
  - No pre-existing agent named "scen027-jsonl-session-browser"
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# JSONL Session Browser Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state and backup config
- **Action:** Run `tests/scenarios/scripts/setup-SCEN-027.sh`. The shared script reads this file's `rewipe-list` and writes backups to `tests/scenarios/state-backups/SCEN-027_<ts>/` with `MANIFEST.sha256` integrity.
- **Goal:** Backup directory exists with at least 1 SHA256 entry covering each present file in `rewipe-list`
- **Creates:** `state-backups/SCEN-027_<ts>/` and `MANIFEST.sha256`
- **Modifies:** nothing on disk outside the backup dir
- **Verify:** `ls state-backups/SCEN-027_*/MANIFEST.sha256` exits 0; every listed path has a matching SHA. Screenshot: S001_<RUN_ID>_backup-created.jpg

#### S002: Build and verify the server (with Rust reader binary)
- **Action:** `yarn build` (this runs `build:jsonl-reader` which invokes `cargo build --release -p aim-jsonl-reader` and copies the binary to `scripts/aim-jsonl-reader`), then `pm2 restart ai-maestro`, wait 4s, check `/api/sessions`.
- **Goal:** Server returns HTTP 200 on `/api/sessions`; `scripts/aim-jsonl-reader` is present and executable
- **Creates:** nothing new
- **Modifies:** `scripts/aim-jsonl-reader` may be refreshed
- **Verify:** `test -x scripts/aim-jsonl-reader` exits 0. Screenshot: S002_<RUN_ID>_server-healthy.jpg

#### S003: Navigate to dashboard and log in
- **Action:** Via dev-browser, `page.goto('http://localhost:23000')`. Use the `aim_login` helper to type governance password `mYkri1-xoxrap-gogtan` and submit.
- **Goal:** Dashboard loads; sidebar is visible
- **Creates:** `aim_session` cookie in the `ai-maestro-scenarios` named browser instance
- **Modifies:** nothing server-side
- **Verify:** Snapshot shows sidebar with Agents / Teams / Groups tabs. Screenshot: S003_<RUN_ID>_dashboard-logged-in.jpg

---

## Phase 1: Create the test agent

#### S004: Open the Agent Creation Wizard
- **Action:** In the sidebar, click "Create new agent" (the green button at the top of the Agents tab).
- **Goal:** Wizard step 1 is visible
- **Creates:** nothing persisted yet
- **Modifies:** nothing
- **Verify:** Snapshot shows "Agent Creation Wizard" heading and "Step 1 / 7". Screenshot: S004_<RUN_ID>_wizard-open.jpg

#### S005: Fill the wizard and create the agent
- **Action:** Step 1 — Persona Name `scen027-jsonl-session-browser`, client `claude`. Step 2 — accept default avatar. Step 3 — default title (MEMBER). Step 4 — default role-plugin (the wizard picks the first compatible). Step 5 — skip subagents. Step 6 — review. Step 7 — click "Create Agent". When the sudo modal appears, enter `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent appears in the sidebar; its `workingDirectory` is `~/agents/scen027-jsonl-session-browser/`
- **Creates:** 1 registry entry + 1 workdir `~/agents/scen027-jsonl-session-browser/` + 1 tmux session
- **Modifies:** `~/.aimaestro/agents/registry.json`
- **Verify:** `GET /api/agents?includeDeleted=false` returns the new agent with the expected workdir. Screenshot: S005_<RUN_ID>_agent-created.jpg

#### S006: Wait for the agent to emit at least one JSONL line
- **Action:** Click the agent in the sidebar; wait 10-20 s for Claude Code to print its startup banner into its JSONL. Alternatively, type `hello` in the agent's chat section (NOT the terminal section, per Rule 0) and wait for Claude to respond.
- **Goal:** At least one file matching `~/.claude/projects/-Users-*-agents-scen027-jsonl-session-browser/*.jsonl` exists with size > 0
- **Creates:** 1 JSONL conversation file (Claude Code writes this automatically as the agent talks)
- **Modifies:** nothing user-tracked
- **Verify:** `ls ~/.claude/projects/-Users-*-agents-scen027-jsonl-session-browser/*.jsonl | head -1` prints a path. Screenshot: S006_<RUN_ID>_agent-active.jpg

---

## Phase 2: Open the Sessions tab

#### S007: Navigate to the agent's Profile
- **Action:** With the agent selected in the sidebar, click "Profile" (or the avatar) to expose the Agent Profile panel.
- **Goal:** Agent Profile panel is visible with tab bar (Overview / Config / Plugins / Sessions / Advanced / …)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the tab bar containing a "Sessions" tab. Screenshot: S007_<RUN_ID>_profile-open.jpg

#### S008: Click the Sessions tab
- **Action:** Click the "Sessions" tab in the Agent Profile tab bar.
- **Goal:** Sessions tab becomes active; the three-pane layout (session list on the left, transcript in the center, context panel on the right) renders within 2 s. If the agent has zero `.jsonl` files the empty-state message is visible instead.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows either (a) ≥1 session row in the left pane with a non-zero session-count badge on the tab label, or (b) the empty-state text `No sessions yet.`. Screenshot: S008_<RUN_ID>_sessions-tab.jpg

> **Note:** if S008 shows the empty state, **jump to Phase CLEANUP**. The empty state is a valid PASS for an agent with zero sessions on disk (TRDD §6.3-#9). Record `branch_taken: empty-state` in the report and SKIP Phases 3-5.

---

## Phase 3: Open a session and verify the transcript

#### S009: Open the newest session
- **Action:** In the session list, click the top row (newest session).
- **Goal:** Center pane loads the chat transcript within 2 s; ≥1 message bubble is visible
- **Creates:** nothing persisted; the Rust reader may write `<session>.aimidx` next to the JSONL as a side effect
- **Modifies:** possibly a new `.aimidx` sidecar under `~/.claude/projects/<slug>/`
- **Verify:** Snapshot shows at least one message bubble with a visible role label (`user` or `assistant`). Screenshot: S009_<RUN_ID>_transcript-loaded.jpg

#### S010: Verify per-message token badge on an assistant bubble
- **Action:** Scroll to the first assistant bubble (if any). Inspect the token badge at its top-right.
- **Goal:** The badge shows at least `out: <N>` for that bubble; the sticky transcript header shows total `in / out / cache / total` for the whole session
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows a badge matching `/\bin:\s*\d+|\bout:\s*\d+/` on the bubble AND a matching aggregate on the header. Screenshot: S010_<RUN_ID>_token-badge.jpg

#### S011: Verify the context-breakdown panel renders all 7 buckets
- **Action:** Look at the right-hand Context Breakdown panel.
- **Goal:** 7 horizontal bars are present, one per category: `systemPrompt`, `systemTools`, `mcpTools`, `customAgents`, `memory`, `messages`, `freeSpace`. Each bar shows an absolute token count and a percentage. `modelContextLimit` is shown at the top or bottom of the panel.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows all 7 labels rendered (some may be zero/grey — that's fine; only their presence is required). Screenshot: S011_<RUN_ID>_context-breakdown.jpg

#### S012: Scroll to the bottom of the transcript
- **Action:** Scroll the transcript to its end (send `End` key or scroll with the mouse wheel until `Last message` text/sentinel is visible).
- **Goal:** Virtualization does NOT blow up memory; the last message is visible within 2 s; no blank frames
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the last message rendered. Screenshot: S012_<RUN_ID>_transcript-end.jpg

---

## Phase 4: Search within the session

#### S013: Search for a known-present keyword
- **Action:** In the search bar at the top of the transcript, type the string `user` (every Claude conversation has at least one `"role":"user"` line, so this is a safe probe). Wait 400 ms for the 250 ms debounce to fire.
- **Goal:** A non-zero match count appears (`<M> / <N>` or similar), and at least one highlighted match is visible in the transcript
- **Creates:** nothing
- **Modifies:** nothing — the search endpoint is read-only
- **Verify:** Snapshot shows a match count ≥ 1. Screenshot: S013_<RUN_ID>_search-match.jpg

#### S014: Navigate to the next match
- **Action:** Click the `Next` button in the search bar (or press the configured keybinding).
- **Goal:** Transcript scrolls to the next highlighted match; match position indicator advances
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the match position indicator at `2 / N` (or equivalent). Screenshot: S014_<RUN_ID>_search-next.jpg

#### S015: Clear the search
- **Action:** Clear the search bar (select-all + Delete, or click the X button if provided).
- **Goal:** All highlighted spans disappear; the transcript returns to normal rendering
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows no highlighted spans and no match count. Screenshot: S015_<RUN_ID>_search-cleared.jpg

---

## Phase 5: Switch between sessions (if >1 exists)

#### S016: Switch to a different session (or document single-session branch)
- **Action:** If the session list contains ≥2 rows, click the second row. Otherwise record "single-session branch" in the scenario report and treat S016-S017 as PASS-by-SKIP.
- **Goal:** If switched: transcript clears and loads the new one within 2 s; context panel re-fetches; URL query param `sid=<uuid>` updates
- **Creates:** possibly a new `.aimidx` sidecar for the newly-opened session
- **Modifies:** URL query params only
- **Verify:** Snapshot shows the new session is active (different topmost timestamp / message count). Screenshot: S016_<RUN_ID>_session-switched.jpg

#### S017: Navigate back via the browser back-button
- **Action:** Call `page.goBack()` via dev-browser (only meaningful if S016 actually switched).
- **Goal:** URL restores to the first session's `sid`; transcript re-loads that session
- **Creates:** nothing
- **Modifies:** URL query params only
- **Verify:** Snapshot shows the first session's transcript is active again. Screenshot: S017_<RUN_ID>_session-back.jpg

---

## Phase CLEANUP: Delete the test agent and restore config

#### S018: Delete the test agent via the Danger Zone
- **Action:** Click the agent in the sidebar → Profile → Advanced tab → Danger Zone → "Delete Agent". In the confirmation dialog, check "Also delete agent folder", type `scen027-jsonl-session-browser` in the confirmation field, click "Delete Forever". When the sudo modal appears, enter `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent is removed from the registry, its workdir is deleted, its tmux session is killed, all `.jsonl` files under `~/.claude/projects/-Users-*-agents-scen027-jsonl-session-browser/` are gone (along with any `.aimidx` sidecars)
- **Removes:** 1 registry entry + 1 workdir + 1 tmux session + 0-N JSONL files + 0-N .aimidx sidecars
- **Verify:** `GET /api/agents?includeDeleted=false` no longer lists the test agent; `ls ~/agents/scen027-jsonl-session-browser/ 2>&1` returns "No such file or directory". Screenshot: S018_<RUN_ID>_agent-deleted.jpg

#### S019: Purge the cemetery entry
- **Action:** Settings → Cemetery → find `scen027-jsonl-session-browser` → click "Purge".
- **Goal:** No residual cemetery entry remains; `GET /api/agents/cemetery` response does not contain the test agent
- **Removes:** 1 cemetery entry
- **Verify:** Cemetery list no longer shows the test agent. Screenshot: S019_<RUN_ID>_cemetery-purged.jpg

#### S020: STATE-WIPE — Restore configuration files
- **Action:** Run `tests/scenarios/scripts/cleanup-SCEN-027.sh`. The shared script verifies SHA256 for every path in `MANIFEST.sha256` and restores any file that drifted.
- **Goal:** All 4 files in the `rewipe-list` match their Phase-0 SHA256 byte-for-byte
- **Removes:** nothing
- **Verify:** Script exits 0; `MANIFEST.sha256` verification prints OK for every listed file. Screenshot: S020_<RUN_ID>_state-wipe-verified.jpg

#### S021: Post-test screenshot
- **Action:** Navigate back to the dashboard root and take a full-page screenshot.
- **Goal:** UI is indistinguishable from the Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S003's screenshot shows no residual test artifacts (no test agent in the sidebar, no orphan terminals, no unexpected banners). Screenshot: S021_<RUN_ID>_post-test.jpg
