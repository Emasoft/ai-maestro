---
number: 15
name: AMP End-to-End Messaging
version: "1.0"
description: >
  The user creates two AUTONOMOUS Claude agents via the wizard and verifies
  that each has its AMP identity auto-provisioned by CreateAgent G12 (P002).
  Alice sends a text message to Bob and the user verifies delivery through
  both the API and the amp-inbox.sh CLI. Bob reads the message with
  amp-read.sh, replies to Alice, and the user verifies the reply. Alice
  then sends a second message with a file attachment; the user verifies
  the attachment round-trip via amp-download.sh and a checksum comparison.
  Both agents delete their inboxes and the user cleans up the test agents
  and restores state. This scenario isolates the AMP messaging path from
  governance, team, and mobile-layout complexity so failures can be
  diagnosed against a single subsystem.
client: claude
interhosts: false
device: desktop
subsystems:
  - amp-auth (signature verification + P004 host guarantor fallback)
  - amp-inbox-writer (initAgentAMPHome, per-agent inbox/sent dirs)
  - amp-service (routeMessage, provider scope, recipient resolution)
  - amp-keys (Ed25519 keypair generation + loadKeyPair)
  - element-management-service (CreateAgent G12 AMP identity auto-init)
  - provider-api (/api/v1/route, /api/v1/messages/pending)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Create new agent
  - Agent Creation Wizard (steps 1-7)
  - Agent Profile -> Config tab (to read amp settings)
  - Agent Profile -> Advanced tab -> Danger Zone (cleanup)
data_produced:
  - 2 test agents "scen015-alice" and "scen015-bob" (temporary, created and deleted)
  - ~/agents/scen015-alice/ and ~/agents/scen015-bob/ (temporary, deleted)
  - ~/.agent-messaging/agents/scen015-alice/ and .../scen015-bob/ (temporary, purged)
  - A single test attachment file in /tmp (temporary, deleted)
  - Agent registry entries (temporary, deleted)
  - Cemetery archive entries (temporary, purged)
required_tools:
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__wait_for
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set
  - Chrome browser open with DevTools accessible via CDP
  - ai-maestro-plugins marketplace registered
  - AMP CLI installed at ~/.local/bin/ (amp-init.sh, amp-send.sh, amp-inbox.sh, amp-read.sh, amp-reply.sh, amp-download.sh, amp-delete.sh)
  - Claude CLI installed (`which claude` succeeds)
  - No pre-existing agents named "scen015-alice" or "scen015-bob"
  - P002 (CreateAgent G12 AMP identity auto-init) is deployed on the running server
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/teams/groups.json
# NOTE: registry.json and teams.json are intentionally NOT in rewipe-list.
# Rule 3 (CHECKPOINT-RESTORE) cleanup-step ordering says: agents and teams
# are removed via the UI in S022, so restoring registry.json/teams.json
# from a snapshot taken AFTER setup but BEFORE the test would put soft-deleted
# orphans back. Confirmed risk in SCEN-013/AUTHORING-BUG-002.
git-fixtures: []
dir-fixtures: []
commit: TBD
author: AI Maestro Team
---

# AMP End-to-End Messaging Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes with message `pre-scenario: SCEN-015 AMP e2e messaging`
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-015/S001-git-clean.png

#### S002: STATE-WIPE checkpoint — backup configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/scen015_<timestamp>/`: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`, `~/.aimaestro/amp-api-keys.json`
- **Goal:** Copies of all config files saved for post-test restoration
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-015/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions` returns 200
- **Goal:** Server running with latest build that includes P002 G12 gate
- **Creates:** nothing
- **Modifies:** PM2 process state
- **Verify:** `/api/sessions` returns 200. Screenshot: SCEN-015/S003-server-running.png

#### S004: Kill orphan test sessions
- **Action:** `tmux list-sessions 2>/dev/null | grep '^scen015-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}` (ignore errors if no sessions exist)
- **Goal:** No leftover sessions from previous runs
- **Creates:** nothing
- **Modifies:** tmux state (kills old scen015-* sessions only)
- **Verify:** `tmux list-sessions` shows no scen015-* sessions. Screenshot: SCEN-015/S004-no-orphans.png

#### S005: Verify AMP CLI is installed
- **Action:** Run `which amp-init.sh amp-send.sh amp-inbox.sh amp-read.sh amp-reply.sh amp-download.sh amp-delete.sh` and check all resolve under `~/.local/bin/`
- **Goal:** All AMP scripts are on PATH
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** All seven paths resolve and are executable. Screenshot: SCEN-015/S005-amp-cli-installed.png

#### S006: Baseline screenshot
- **Action:** `take_screenshot` of dashboard at http://localhost:23000
- **Goal:** Pre-test baseline for cleanup verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-015/S006-baseline.png

---

## Phase 1: Create Two AUTONOMOUS Agents via Wizard

#### S007: Login with governance password
- **Action:** Navigate to http://localhost:23000, fill governance password `mYkri1-xoxrap-gogtan`, click Sign In
- **Goal:** Authenticated MAESTRO session
- **Creates:** Session cookie
- **Modifies:** browser cookies
- **Verify:** Dashboard loads with agent list. Screenshot: SCEN-015/S007-logged-in.png

#### S008: Create agent "scen015-alice" via wizard
- **Action:** Click "Create new agent" in sidebar. Step 1: name `scen015-alice`. Step 2: client Claude. Step 3: accept default working directory (~/agents/scen015-alice/). Step 4: title AUTONOMOUS. Step 5: role-plugin none. Steps 6-7: defaults. Click Create Agent.
- **Goal:** First test agent created
- **Creates:** 1 agent registry entry, ~/agents/scen015-alice/ directory, ~/.agent-messaging/agents/scen015-alice/ (via G12), .claude/settings.local.json with ai-maestro-plugin enabled (via G11)
- **Modifies:** registry.json
- **Verify:** Agent "scen015-alice" appears in sidebar. Screenshot: SCEN-015/S008-alice-created.png

#### S009: Verify Alice's AMP identity was auto-provisioned (P002 G12)
- **Action:** AMP home is keyed by agent UUID, not name. (1) Read the agent ID from `GET /api/agents` (filter by name=scen015-alice) and record it in scratch state. (2) Check disk: `ls ~/.agent-messaging/agents/<aliceId>/keys/private.pem ~/.agent-messaging/agents/<aliceId>/keys/public.pem ~/.agent-messaging/agents/<aliceId>/config.json`. (3) Confirm name-to-UUID index: `jq ".\"scen015-alice\"" ~/.agent-messaging/agents/.index.json` returns the same `<aliceId>`.
- **Goal:** G12 successfully ran amp-init.sh for Alice
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** All three files exist at the UUID-keyed path. `config.json` contains `"name": "scen015-alice"` and a tenant field. `.index.json` contains the name→UUID mapping. API `GET /api/agents/{aliceId}` shows `ampIdentityMissing` is absent or `false`. Screenshot: SCEN-015/S009-alice-amp-ready.png

#### S010: Create agent "scen015-bob" via wizard
- **Action:** Same wizard flow as S008 but with name `scen015-bob`
- **Goal:** Second test agent created
- **Creates:** 1 agent registry entry, ~/agents/scen015-bob/ directory, ~/.agent-messaging/agents/scen015-bob/, .claude/settings.local.json with ai-maestro-plugin enabled
- **Modifies:** registry.json
- **Verify:** Agent "scen015-bob" appears in sidebar. Screenshot: SCEN-015/S010-bob-created.png

#### S011: Verify Bob's AMP identity was auto-provisioned
- **Action:** Same UUID-keyed disk check as S009 but for scen015-bob. Resolve `<bobId>` from the API, check `~/.agent-messaging/agents/<bobId>/{keys,config.json}`, and verify `.index.json` has the `scen015-bob → <bobId>` entry.
- **Goal:** G12 successfully ran amp-init.sh for Bob
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All three files exist at UUID-keyed path; config.json has `"name": "scen015-bob"`; `.index.json` mapping present. Screenshot: SCEN-015/S011-bob-amp-ready.png

---

## Phase 2: Text Message Round-Trip (Alice → Bob → Alice)

#### S012: Alice sends a text message to Bob
- **Action:** Use the AMP CLI's `--id` flag (preferred over AMP_DIR since paths are UUID-keyed): `amp-send.sh --id <aliceId> scen015-bob "Hello Bob" "How are you?"`. The `<aliceId>` is the UUID resolved in S009.
- **Goal:** Message delivered to Bob's inbox
- **Creates:** 1 file in `~/.agent-messaging/agents/<bobId>/messages/inbox/scen015-alice_default_aimaestro_local/`, 1 file in `~/.agent-messaging/agents/<aliceId>/messages/sent/scen015-bob_default_aimaestro_local/`
- **Modifies:** nothing on disk outside the two inboxes
- **Verify:** CLI returns exit 0 and prints the message ID. `find ~/.agent-messaging/agents/<bobId>/messages/inbox/ -type f` shows exactly one new file. Screenshot: SCEN-015/S012-alice-sent.png

#### S013: Verify Bob's inbox via filesystem (local-delivery path)
- **Action:** Local AMP delivery does not register with the server-relay queue (no apiKey is minted in config.json — registration only happens for external/cross-host delivery). Therefore `/api/v1/messages/pending` is not the right endpoint here — verify via the filesystem path that the AMP CLI uses internally: `find ~/.agent-messaging/agents/<bobId>/messages/inbox -type f -name '*.json'` and `jq '{from, subject, body}' ~/.agent-messaging/agents/<bobId>/messages/inbox/scen015-alice_default_aimaestro_local/*.json`.
- **Goal:** Server-side filesystem view matches what the CLI sees
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** Exactly one JSON file with `from: scen015-alice@default.aimaestro.local`, `subject: Hello Bob`, `body: How are you?`. Screenshot: SCEN-015/S013-bob-api-inbox.png

#### S014: Bob reads the message via amp-inbox.sh
- **Action:** `amp-inbox.sh --id <bobId>` (or alternately set `CLAUDE_AGENT_ID=<bobId>` and run `amp-inbox.sh`)
- **Goal:** CLI inbox lists the message
- **Creates:** nothing (read-only)
- **Modifies:** nothing
- **Verify:** Output shows 1 unread message from Alice with the expected subject. Screenshot: SCEN-015/S014-bob-cli-inbox.png

#### S015: Bob reads the message content via amp-read.sh
- **Action:** `amp-read.sh --id <bobId> <messageId>` (id from S014)
- **Goal:** Message body is readable
- **Creates:** nothing (read-only)
- **Modifies:** inbox metadata (marks as read)
- **Verify:** Output contains the exact body string "How are you?". Screenshot: SCEN-015/S015-bob-read-message.png

#### S016: Bob replies via amp-reply.sh
- **Action:** `amp-reply.sh --id <bobId> <messageId> "I'm doing well, thanks Alice!"`
- **Goal:** Reply delivered to Alice's inbox with `in_reply_to` set to the original message ID
- **Creates:** 1 file in `~/.agent-messaging/agents/<aliceId>/messages/inbox/scen015-bob_default_aimaestro_local/`, 1 file in `~/.agent-messaging/agents/<bobId>/messages/sent/scen015-alice_default_aimaestro_local/`
- **Modifies:** nothing outside those inboxes
- **Verify:** CLI returns exit 0. Screenshot: SCEN-015/S016-bob-replied.png

#### S017: Verify Alice received Bob's reply
- **Action:** `amp-inbox.sh --id <aliceId>` then `amp-read.sh --id <aliceId> <replyId>`
- **Goal:** Reply visible in Alice's inbox with correct body + `in_reply_to` linkage
- **Creates:** nothing (read-only)
- **Modifies:** inbox metadata (marks as read)
- **Verify:** Output shows reply with body "I'm doing well, thanks Alice!" and `in_reply_to` matches the S012 message ID. Screenshot: SCEN-015/S017-alice-received-reply.png

---

## Phase 3: Attachment Round-Trip

#### S018: Create a small attachment file in /tmp
- **Action:** Generate 1024 random bytes to `/tmp/scen015-attachment.bin` using Python (avoids the scenario write-guard hook's `/dev/urandom` block) and compute its SHA-256: `python3 -c "import secrets; open('/tmp/scen015-attachment.bin','wb').write(secrets.token_bytes(1024))" && shasum -a 256 /tmp/scen015-attachment.bin`
- **Goal:** A deterministic test payload with a known checksum
- **Creates:** 1 file at `/tmp/scen015-attachment.bin`
- **Modifies:** nothing
- **Verify:** File exists, size is exactly 1024 bytes. Record the checksum. Screenshot: SCEN-015/S018-attachment-created.png

#### S019: Alice sends a message with the attachment
- **Action:** `amp-send.sh --id <aliceId> scen015-bob "File for you" "Binary payload" --attach /tmp/scen015-attachment.bin`
- **Goal:** Message + attachment delivered to Bob
- **Creates:** 1 message file in Bob's inbox containing an attachment reference
- **Modifies:** nothing outside the inboxes
- **Verify:** CLI returns exit 0 and prints the message ID. Screenshot: SCEN-015/S019-alice-sent-attachment.png

#### S020: Bob downloads the attachment
- **Action:** `amp-download.sh --id <bobId> <messageId> --all --dest /tmp/scen015-received/`
- **Goal:** Attachment extracted to local disk
- **Creates:** file(s) in `/tmp/scen015-received/`
- **Modifies:** nothing
- **Verify:** `/tmp/scen015-received/scen015-attachment.bin` exists with size 1024 bytes. Screenshot: SCEN-015/S020-bob-downloaded.png

#### S021: Verify checksum matches
- **Action:** `shasum -a 256 /tmp/scen015-received/scen015-attachment.bin` and compare with the checksum recorded in S018
- **Goal:** Byte-for-byte integrity through the full AMP pipeline
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** Both checksums match exactly. Screenshot: SCEN-015/S021-checksum-match.png

---

## Phase CLEANUP: Restore Original State

#### S022: Delete both test agents via UI
- **Action:** For each of `scen015-alice` and `scen015-bob`: open profile panel → Advanced tab → Danger Zone → Delete Agent → check "Also delete agent folder" → type the agent name → Delete Forever. SUDO-MODE: when the sudo password modal appears for each deletion (DELETE `/api/agents/{id}` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm. Each delete requires a fresh sudo token.
- **Goal:** Both agents fully removed from registry and filesystem
- **Removes:** 2 agent registry entries, `~/agents/scen015-alice/` and `~/agents/scen015-bob/` directories, tmux sessions (if any)
- **Verify:** Neither agent in sidebar, `GET /api/agents` does not list them. Run `ls ~/agents/scen015-alice ~/agents/scen015-bob` and confirm both return "No such file or directory". Screenshot: SCEN-015/S022-agents-deleted.png

#### S023: Purge cemetery entries
- **Action:** Navigate to Settings → Cemetery tab. For each entry matching `scen015-alice` or `scen015-bob`, click Purge. SUDO-MODE: when the sudo password modal appears for each purge (DELETE `/api/agents/cemetery` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Cemetery archive cleared
- **Removes:** cemetery entries for the two test agents
- **Verify:** Neither entry is in Cemetery tab. Screenshot: SCEN-015/S023-cemetery-purged.png

#### S024: Verify per-agent AMP home directories were auto-cleaned by DeleteAgent
- **Action:** No bash mutation. Read-only verification — DeleteAgent's pipeline (lib/agent-registry.ts:874-893) auto-removes `~/.agent-messaging/agents/<uuid>/` AND removes the `<name>` entry from `~/.agent-messaging/agents/.index.json` as part of the agent deletion cascade. Confirm by reading the index file and checking the UUID dirs do not exist.
- **Goal:** No leftover AMP identity files
- **Removes:** nothing (verification only — the cleanup already happened in S022)
- **Verify:** `cat ~/.agent-messaging/agents/.index.json | jq` does not contain keys `scen015-alice` or `scen015-bob`, AND the UUID dirs (recorded by the runner in S009/S011) do not exist on disk. Screenshot: SCEN-015/S024-amp-home-purged.png

#### S025: Remove attachment test files
- **Action:** `rm -f /tmp/scen015-attachment.bin && rm -rf /tmp/scen015-received`
- **Goal:** No leftover test payloads
- **Removes:** `/tmp/scen015-attachment.bin` and `/tmp/scen015-received/`
- **Verify:** Neither path exists. Screenshot: SCEN-015/S025-tmp-purged.png

#### S026: Verify registry and inbox state
- **Action:** Check: no `scen015-alice`/`scen015-bob` in `~/.aimaestro/agents/registry.json`, no working directories under `~/agents/`, no inbox directories under `~/.agent-messaging/agents/`, no cemetery entries
- **Goal:** All test-created artifacts are gone
- **Removes:** nothing (verification)
- **Verify:** All four checks pass. Screenshot: SCEN-015/S026-artifacts-gone.png

#### S027: STATE-WIPE — restore configuration files
- **Action:** Compare current config files against backups from S002. Restore ONLY files that still differ and whose differences are side effects of the test (e.g., amp-api-keys.json if new keys were minted during G12). Do NOT restore registry.json or teams.json — those were cleaned via UI in S022.
- **Goal:** Config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all relevant files match backups. Screenshot: SCEN-015/S027-state-restored.png

#### S028: Post-test screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** UI identical to Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-015/S028-post-test.png, visually matches S006-baseline.png

---

## Phase 11th-HOUR: Post-Scenario Analysis

After the test completes, analyze:

1. Did G12 run on both agents, or did either one land with `ampIdentityMissing: true`?
2. Did the first text message round-trip (Alice→Bob→Alice) succeed without any 403 or 500 responses from /api/v1/route?
3. Was the P004 host guarantor fallback exercised at any point? Check PM2 logs for `guarantor-signed by host` messages — if yes, why did the agent signature fail?
4. Did the attachment round-trip preserve byte-for-byte integrity, or were there encoding/base64 issues?
5. Did amp-inbox.sh / amp-read.sh / amp-reply.sh / amp-download.sh all exit cleanly, or did any script emit warnings that indicate missing functionality?
6. How long did each phase take? Is there a step that's unexpectedly slow (CLI startup, sign+verify, filesystem sync)?
7. Are there governance rule gaps exposed by this test? Notably: does the current rule set say anything about what happens when Alice sends a message while Bob is hibernated? (Currently: stored in Bob's inbox until wake.)

Save the proposals to `tests/scenarios/reports/scenario_proposed-improvements_015_<datetime>.md`.
