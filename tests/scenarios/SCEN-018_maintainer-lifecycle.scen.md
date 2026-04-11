---
number: 18
name: MAINTAINER governance title — full lifecycle (R19)
version: "1.0"
description: >
  End-to-end test for the new MAINTAINER governance title (R19). The user
  creates a MANAGER agent (prereq), then creates two MAINTAINER agents —
  each assigned to a different fake GitHub test repo via the new
  `githubRepo` field. Each repo already contains a buggy file and a test
  file that fails. The user opens GitHub issues on each repo describing
  the bug. Within 5 minutes the MAINTAINER polling cycle picks up the new
  issues, runs maintainer-triage to classify them, and for valid bugs runs
  maintainer-fix (clone → branch → fix → test → commit → publish via
  publish.py). On success, the MAINTAINER closes the issue on GitHub and
  sends an AMP report to the MANAGER. The MANAGER then reports the status
  to the user via another AMP message. The scenario verifies: (a) R19.1
  MAINTAINER can only be assigned to an agent with a valid githubRepo;
  (b) R19.3 MAINTAINER-repo-uniqueness — two MAINTAINERs cannot be assigned
  the same repo; (c) R19.6 authorized-user gate — feature requests are
  only accepted from the locally-authenticated gh user; (d) the polling
  cycle does NOT open a listening port (Tailscale VPN safety); (e) no
  destructive git operations are performed (R19.7).
client: claude
interhosts: false
device: desktop
subsystems:
  - types/agent.ts (MAINTAINER title + githubRepo field)
  - lib/communication-graph.ts (maintainer row/column)
  - element-management-service ChangeTitle Gate 9a (MAINTAINER validation)
  - ai-maestro-maintainer-agent plugin (patrol + triage + fix skills)
  - gh CLI (issue list, issue comment, issue close)
  - publish.py strict pipeline in each test repo
  - AMP messaging (MAINTAINER → MANAGER → user)
ui_sections:
  - Login page
  - Sidebar → Create Agent (wizard with MAINTAINER title + repo field)
  - Agent Profile → Overview → governance title badge
  - Agent Profile → Overview → GitHub Repo field (new for MAINTAINER)
  - MANAGER terminal → prompt builder (for sending instructions)
  - Human user card → inbox (final MANAGER report)
  - GitHub.com → issue view (clone target repos, open issues, watch for comments)
data_produced:
  - 2 fake GitHub test repos under Emasoft/
    (`scen018-test-repo-alpha`, `scen018-test-repo-beta`) — CREATED BY
    the scenario setup step. Kept after test as permanent fixtures OR
    deleted depending on user preference recorded in the report.
  - 1 MANAGER agent (prereq, may already exist — not counted as scenario
    data_produced if pre-existing)
  - 2 MAINTAINER test agents, one per repo (temporary, deleted at cleanup)
  - 2 bug issues opened on GitHub (closed by MAINTAINER during the run)
  - 1 completion AMP message MANAGER → user
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
  - MANAGER agent exists
  - `ai-maestro-maintainer-agent` plugin published to
    Emasoft/ai-maestro-plugins marketplace (v1.0.0) and cached locally
  - `gh` CLI installed and authenticated as Emasoft
  - `gh auth status` shows logged-in user = `Emasoft`
  - Fake test repos created manually BEFORE scenario run:
      gh repo create Emasoft/scen018-test-repo-alpha --public
      gh repo create Emasoft/scen018-test-repo-beta --public
    Each repo contains:
      - `src/buggy.py` — a short function with a KNOWN bug
      - `tests/test_buggy.py` — a failing test that exercises the bug
      - `scripts/publish.py` — the strict publish pipeline
      - `.githooks/pre-push` — the process-ancestry enforcement hook
      - `LICENSE`, `README.md`, `pyproject.toml`
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
---

## Phase 0: SAFE-SETUP

### S001: Health + fixture check + backup
- **Action:** `curl /api/v1/health`;
  `gh repo view Emasoft/scen018-test-repo-alpha --json name`;
  `gh repo view Emasoft/scen018-test-repo-beta --json name`;
  backup `~/.aimaestro/agents/registry.json`,
  `~/.aimaestro/governance.json` to
  `tests/scenarios/state-backups/SCEN-018_<timestamp>/`.
- **Goal:** Server healthy, test repos exist, backup captured.
- **Verify:** All checks pass.

### S002: Login
- **Action:** Navigate to `/`, enter password, login.
- **Verify:** Dashboard loads.

### S003: Verify MANAGER exists
- **Action:** Find MANAGER in sidebar.
- **Goal:** MANAGER available to receive the completion report.
- **Verify:** Red MANAGER badge visible.

---

## Phase 1: Create the two MAINTAINER agents

### S004: Open Agent Creation Wizard
- **Action:** Click + in sidebar → Create Agent.
- **Goal:** Wizard step 1 visible.
- **Verify:** Screenshot.

### S005: Create scen018-maint-alpha with repo alpha
- **Action:** Fill wizard: name `scen018-maint-alpha`, client `claude`,
  title `MAINTAINER`, role-plugin `ai-maestro-maintainer-agent`,
  githubRepo `Emasoft/scen018-test-repo-alpha`. Complete wizard.
- **Goal:** MAINTAINER agent created bound to repo alpha.
- **Creates:** 1 MAINTAINER agent
- **Verify:** Sidebar shows the agent with a MAINTAINER badge; Profile →
  Overview shows the githubRepo field.

### S006: Create scen018-maint-beta with repo beta
- **Action:** Same flow, name `scen018-maint-beta`, repo
  `Emasoft/scen018-test-repo-beta`.
- **Goal:** Second MAINTAINER created.
- **Verify:** Sidebar shows both agents.

### S007: R19.3 uniqueness — attempt third MAINTAINER with ALPHA repo
- **Action:** Open wizard again, try to create
  `scen018-maint-duplicate` with repo `Emasoft/scen018-test-repo-alpha`.
- **Goal:** Gate 9a rejects with "repo already bound to scen018-maint-alpha".
- **Verify:** Wizard shows error; no duplicate agent created.

---

## Phase 2: Open bug issues on both repos

### S008: Open issue on repo alpha
- **Action:** In a separate terminal (or via `gh` CLI from the test
  runner):
  ```bash
  gh issue create --repo Emasoft/scen018-test-repo-alpha \
    --title "[BUG] division returns wrong result for negative numbers" \
    --body "src/buggy.py divide(-10, 2) returns 5 instead of -5. tests/test_buggy.py::test_divide_negatives fails."
  ```
- **Goal:** Issue #1 exists on repo alpha.
- **Verify:** `gh issue list --repo Emasoft/scen018-test-repo-alpha`
  shows the new issue.

### S009: Open issue on repo beta
- **Action:** Same flow on repo beta with a different bug description
  matching its known failing test.
- **Goal:** Issue #1 on repo beta.
- **Verify:** `gh issue list` confirms.

---

## Phase 3: Wait for polling cycle

### S010: Wait 5+ minutes for first polling tick
- **Action:** Use `wait_for` with a 6-minute timeout, watching for either
  a comment on the issues OR a notification in the MANAGER's inbox.
- **Goal:** Each MAINTAINER's 5-min poll fires and picks up the new issue.
- **Verify:** `gh issue view <n>` shows a comment from the MAINTAINER
  (something like "picked up by MAINTAINER, triaging…").

### S011: Verify triage classification
- **Action:** Check the MAINTAINER terminal logs for the classification
  output (via the agent's conversation log in
  `~/.claude/projects/.../*.jsonl`).
- **Goal:** Triage classified the issue as `bug` (not feature-request).
- **Verify:** Classification captured in the report.

---

## Phase 4: Verify fix + commit + publish

### S012: Wait for the fix cycle
- **Action:** `wait_for` on the issue being closed OR the GitHub repo
  having a new commit on main.
- **Goal:** MAINTAINER ran maintainer-fix: clone → branch → edit → test
  → commit → publish via `scripts/publish.py --patch`.
- **Verify:** `gh run list --repo <repo>` shows the publish.py pipeline
  succeeded; the failing test now passes.

### S013: Verify no destructive git ops (R19.7)
- **Action:** Check the commit history on both repos.
- **Goal:** No force-pushes, no branch deletions, no amends of shared
  commits. Only new commits on the fix branch.
- **Verify:** `git reflog` (or GitHub commit history) confirms clean
  append-only history.

### S014: Verify issue closed with comment
- **Action:** `gh issue view 1 --repo <repo>`.
- **Goal:** Issue is closed with a MAINTAINER comment linking to the
  fix commit.
- **Verify:** State=closed, last comment from Emasoft bot/MAINTAINER.

---

## Phase 5: Verify AMP reporting chain

### S015: MAINTAINER → MANAGER message
- **Action:** Open MANAGER profile → inbox.
- **Goal:** Each MAINTAINER sent a completion report to MANAGER.
- **Verify:** Two messages visible, one per MAINTAINER.

### S016: MANAGER → user report
- **Action:** Open the human user card → inbox.
- **Goal:** MANAGER aggregated both MAINTAINER reports and sent the user
  a summary.
- **Verify:** Single message present with both repo names + issue links.

---

## Phase 6: R19.6 authorized-user gate for feature requests

### S017: Open a feature request AS ANOTHER USER
- **Action:** From a separate gh account (or using a GitHub user other
  than Emasoft), open an issue titled "[FEATURE] add logging" on repo
  alpha. If a second account is not available, document the test as
  requiring a second gh identity and skip with 🐌.
- **Goal:** Non-authorized feature requests are IGNORED by MAINTAINER.
- **Verify:** After the next polling tick, MAINTAINER leaves a comment
  like "feature requests are only accepted from the repo owner — please
  have the owner re-file" and does NOT act on the issue.

### S018: Open a feature request AS Emasoft
- **Action:** `gh issue create --repo <alpha>` authored by Emasoft with
  title `[FEATURE] add docstring`.
- **Goal:** Authorized feature requests are accepted.
- **Verify:** MAINTAINER attempts to implement the feature or asks
  clarifying questions via issue comment.

---

## Phase 7: CLEANUP

### S019: Delete scen018-maint-alpha
- **Action:** Profile → Advanced → Danger Zone → Delete Agent with
  folder cleanup.
- **Removes:** Agent + folder + session
- **Verify:** Not in sidebar.

### S020: Delete scen018-maint-beta
- **Action:** Same flow.
- **Removes:** Agent
- **Verify:** Not in sidebar.

### S021: Purge cemetery entries
- **Action:** Settings → Cemetery → purge both.
- **Removes:** Cemetery records
- **Verify:** Empty for test agents.

### S022: Close remaining GitHub issues
- **Action:** `gh issue close --repo <each repo> --all` for any issues
  left open by the feature-request phase.
- **Removes:** Nothing locally
- **Verify:** `gh issue list` shows 0 open.

### S023: Optional — delete test repos
- **Action:** IF the user wants the test repos removed, run
  `gh repo delete Emasoft/scen018-test-repo-alpha --confirm`. Otherwise,
  leave them as permanent fixtures for re-runs.
- **Removes:** Repos (optional)
- **Verify:** Documented in report.

### S024: STATE-WIPE restore
- **Action:** Compare config files with S001 backups; restore if needed.
- **Verify:** File hashes match.

### S025: Post-test screenshot
- **Action:** Dashboard screenshot.
- **Verify:** UI matches pre-test baseline.

---

## Success Criteria

- ✅ Both MAINTAINERs created with `githubRepo` bound via Gate 9a.
- ✅ Duplicate-repo rejection fires on the third attempt (R19.3).
- ✅ Polling cycle picks up new issues within 5 minutes without opening
  any listening port.
- ✅ Bugs are triaged, fixed, tested, committed, and published via
  publish.py strict.
- ✅ Feature requests from unauthorized users are IGNORED (R19.6).
- ✅ Feature requests from Emasoft are accepted.
- ✅ AMP reporting chain MAINTAINER → MANAGER → user delivers the full
  status summary.
- ✅ No destructive git operations occur on any repo (R19.7).
