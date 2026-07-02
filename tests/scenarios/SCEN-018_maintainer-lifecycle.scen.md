---
number: 18
name: MAINTAINER PR review lifecycle — dual-path (R19)
version: "2.0"
description: >
  End-to-end test for the MAINTAINER governance title with two parallel
  code paths. The user creates a MANAGER, two MAINTAINER agents (one per
  fake GitHub repo), and one AUTONOMOUS contributor agent. The contributor
  opens a BUG issue on repo-alpha (triggering maintainer-fix direct path)
  and a CONTRIBUTION PROPOSAL issue on repo-beta (triggering the welcome +
  PR review path). MAINTAINER alpha fixes the bug directly; MAINTAINER
  beta welcomes the contributor, waits for the PR, reviews it (requesting
  changes on round 1 due to a deliberately seeded flaw), re-reviews after
  the contributor iterates, approves, merges, and cuts a release. MANAGER
  monitors both MAINTAINERs via AMP, acknowledges updates, steers if any
  agent slacks, and sends a final aggregated report to the user. The
  scenario also verifies R19.3 uniqueness, R19.8 + R19.9 governance rule
  enforcement, and the full MANAGER-MAINTAINER-AUTONOMOUS communication
  graph (9 edges). Cleanup deletes all 3 test agents, purges cemetery,
  closes remaining GitHub issues, deletes test branches, and restores
  config files.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - agent-registry
  - element-management-service
  - role-plugins
  - agent-messaging
  - sessions-service
ui_sections:
  - Login page
  - Sidebar -> Agents tab
  - Sidebar -> Create Agent (wizard)
  - Agent Profile -> Overview tab -> Governance Title badge
  - Agent Profile -> Overview tab -> GitHub Repo field
  - Agent Profile -> Terminal
  - Agent Profile -> Prompt Builder
  - Settings -> Cemetery
  - Human user card -> AMP inbox
data_produced:
  - 3 test agents (temporary, created and deleted)
  - 2 GitHub issues on scen018-test-repo-alpha (temporary, closed during run or cleanup)
  - 2 GitHub issues on scen018-test-repo-beta (temporary, closed during run or cleanup)
  - 1 PR on scen018-test-repo-beta (temporary, merged then branch deleted)
  - 1 GitHub release on scen018-test-repo-beta (temporary, deleted at cleanup)
  - AMP messages between agents (temporary, deleted at cleanup)
  - Plugin settings modifications (temporary, restored via STATE-WIPE)
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
  - ai-maestro-maintainer-agent plugin v2.0.0+ cached locally
  - ai-maestro-autonomous-agent plugin v1.0.1+ cached locally
  - gh CLI installed and authenticated as Emasoft
  - Emasoft/scen018-test-repo-alpha exists with src/buggy.py (known divide bug), tests/test_buggy.py (failing test), scripts/publish.py, pyproject.toml with bumpable version, v0.1.0 git tag, branch ruleset (require PR, no force-push, no branch delete)
  - Emasoft/scen018-test-repo-beta exists with src/other.py (known multiply bug), tests/test_other.py (failing test), scripts/publish.py, pyproject.toml with bumpable version, v0.1.0 git tag, branch ruleset (require PR, no force-push, no branch delete)
  - Codex CLI NOT required (claude-only scenario)
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures:
  - https://github.com/Emasoft/scen018-test-repo-alpha.git
  - https://github.com/Emasoft/scen018-test-repo-beta.git
dir-fixtures: []
commit: TBD
---

## Phase 0: SAFE-SETUP

#### S001: Commit uncommitted changes
- **Action:** Run `git status` in the ai-maestro project root. If any uncommitted changes exist, commit them with message `pre-scenario: SCEN-018 v2`.
- **Goal:** Clean working tree before scenario start.
- **Creates:** nothing
- **Modifies:** nothing (or 1 commit if dirty)
- **Verify:** `git status` shows clean working tree.

#### S002: Backup configuration files (CHECKPOINT-SAVE)
- **Action:** Create backup directory `tests/scenarios/state-backups/SCEN-018_<timestamp>/`. Copy the following files into it:
  `~/.claude/settings.json`,
  `~/.claude/settings.local.json`,
  `~/.aimaestro/governance.json`,
  `~/.aimaestro/agents/registry.json`,
  `~/.aimaestro/teams/teams.json`,
  `~/.aimaestro/teams/groups.json`.
  Record SHA256 hash of each file.
- **Goal:** Full config snapshot captured for STATE-WIPE restore.
- **Creates:** Backup directory with 6 files
- **Modifies:** nothing
- **Verify:** All 6 files copied; hashes recorded in report.

#### S003: Build and verify server health
- **Action:** Run `yarn build`. Run `pm2 restart ai-maestro` (or verify dev server is running). Check `GET /api/sessions` returns HTTP 200.
- **Goal:** Server is healthy and serving requests.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** HTTP 200 from /api/sessions.

#### S004: Verify test repo fixtures
- **Action:** Run `gh repo view Emasoft/scen018-test-repo-alpha --json name` and `gh repo view Emasoft/scen018-test-repo-beta --json name`. Verify `gh auth status` shows user `Emasoft`.
- **Goal:** Both test repos exist and gh is authenticated.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Both repos return valid JSON; auth shows Emasoft.

#### S005: Kill orphan test sessions
- **Action:** Kill any leftover tmux sessions from previous SCEN-018 runs:
  `tmux list-sessions | grep '^scen018-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}`
- **Goal:** No stale test sessions interfere with this run.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `tmux list-sessions` shows no scen018-* sessions.

#### S006: Login to dashboard and take baseline screenshot
- **Action:** Navigate to `http://localhost:23000`. Enter governance password `mYkri1-xoxrap-gogtan` if login required. Take a full-page screenshot as baseline.
- **Goal:** Dashboard loaded, baseline captured for post-test comparison.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as `S006_<RUN_ID>_baseline.jpg`.

---

## Phase 1: Create the 3 agents

#### S007: Open Agent Creation Wizard for MANAGER
- **Action:** Click the + button in the sidebar to open the Create Agent wizard.
- **Goal:** Wizard step 1 is visible.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot shows wizard step 1.

#### S008: Create scen018-manager (MANAGER)
- **Action:** Fill wizard fields: name `scen018-manager`, client `claude`, title `MANAGER`, role-plugin `ai-maestro-assistant-manager-agent`. No team, no githubRepo. Complete all wizard steps.
- **Goal:** MANAGER agent created and online.
- **Creates:** 1 agent (scen018-manager), tmux session, agent folder at ~/agents/scen018-manager/
- **Modifies:** registry.json, governance.json
- **Verify:** Sidebar shows scen018-manager with red MANAGER badge. Agent terminal is active.

#### S009: Create scen018-maint-alpha (MAINTAINER bound to repo-alpha)
- **Action:** Open wizard again. Fill: name `scen018-maint-alpha`, client `claude`, title `MAINTAINER`, role-plugin `ai-maestro-maintainer-agent`, githubRepo `Emasoft/scen018-test-repo-alpha`. Complete wizard.
- **Goal:** MAINTAINER agent created and bound to repo-alpha. Gate 9a validated the repo.
- **Creates:** 1 agent (scen018-maint-alpha), tmux session, agent folder, maintainer ledger at ~/.aimaestro/maintainer/
- **Modifies:** registry.json
- **Verify:** Sidebar shows scen018-maint-alpha with MAINTAINER badge. Profile Overview shows githubRepo = `Emasoft/scen018-test-repo-alpha`.

#### S010: Create scen018-contrib-alpha (AUTONOMOUS contributor)
- **Action:** Open wizard again. Fill: name `scen018-contrib-alpha`, client `claude`, title `AUTONOMOUS`, role-plugin `ai-maestro-autonomous-agent`. No team, no githubRepo. Complete wizard.
- **Goal:** AUTONOMOUS contributor agent created and online.
- **Creates:** 1 agent (scen018-contrib-alpha), tmux session, agent folder
- **Modifies:** registry.json
- **Verify:** Sidebar shows scen018-contrib-alpha with AUTONOMOUS badge.

#### S011: R19.3 uniqueness test -- attempt duplicate MAINTAINER on repo-alpha
- **Action:** Open wizard. Fill: name `scen018-maint-duplicate`, client `claude`, title `MAINTAINER`, role-plugin `ai-maestro-maintainer-agent`, githubRepo `Emasoft/scen018-test-repo-alpha`. Attempt to complete.
- **Goal:** Gate 9a rejects with error message indicating repo is already bound to scen018-maint-alpha.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard shows error. No `scen018-maint-duplicate` appears in sidebar. Screenshot of error message.

---

## Phase 2: Contributor opens bug issue on repo-alpha

#### S012: Switch to scen018-contrib-alpha terminal
- **Action:** Click scen018-contrib-alpha in the sidebar. Wait for terminal to be active and ready.
- **Goal:** Contributor agent terminal is focused and ready for input.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Terminal shows idle prompt for scen018-contrib-alpha.

#### S013: Instruct contributor to open BUG issue on repo-alpha
- **Action:** Type into the contributor terminal (or use Prompt Builder):
  `Open a GitHub issue on Emasoft/scen018-test-repo-alpha with title "[BUG] divide(-10, 2) returns wrong result" and body "src/buggy.py divide(-10, 2) returns 5 instead of -5. The test tests/test_buggy.py::test_divide_negatives fails. This is a pure bug report -- please fix." Use gh issue create.`
  Wait for the contributor to complete the command.
- **Goal:** Bug issue created on repo-alpha.
- **Creates:** 1 GitHub issue on scen018-test-repo-alpha
- **Modifies:** nothing
- **Verify:** Run `gh issue list --repo Emasoft/scen018-test-repo-alpha --state open` and confirm the new issue appears.

---

## Phase 3: MAINTAINER alpha detects issue and runs maintainer-fix (direct-fix path)

#### S014: Switch to scen018-maint-alpha terminal and prime the maintainer
- **Action:** Click scen018-maint-alpha in the sidebar. Type into the terminal:
  `Check your assigned repo Emasoft/scen018-test-repo-alpha for new issues. If you find a bug report, triage it and run maintainer-fix to fix it. Report your progress to scen018-manager via AMP at each step: detection, triage, fix started, fix completed.`
- **Goal:** MAINTAINER alpha is primed to patrol and fix.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** MAINTAINER acknowledges the instruction in terminal output.

#### S015: Wait for MAINTAINER alpha to detect and triage the issue
- **Action:** Monitor scen018-maint-alpha terminal output. Wait up to 3 minutes for the maintainer to detect the issue and classify it as a bug.
- **Goal:** MAINTAINER alpha detects the issue and triage classifies it as `bug`.
- **Creates:** nothing
- **Modifies:** Maintainer ledger (processed-issues.json)
- **Verify:** Terminal output shows issue detection and bug classification. Read agent conversation log (`~/.claude/projects/.../*.jsonl`) to confirm triage output.

#### S016: Wait for MAINTAINER alpha to complete the fix
- **Action:** Monitor terminal. Wait up to 10 minutes for maintainer-fix to complete: clone repo, create fix branch, edit src/buggy.py, run tests, commit, push, publish via scripts/publish.py.
- **Goal:** Bug is fixed on the repo. Fix branch merged or committed to main.
- **Creates:** Commits on scen018-test-repo-alpha, possibly a new version tag
- **Modifies:** scen018-test-repo-alpha main branch
- **Verify:** Run `gh issue view 1 --repo Emasoft/scen018-test-repo-alpha --json state` and confirm state is `CLOSED`. Verify the failing test now passes by checking the latest commit message or publish.py output.

#### S017: Verify no destructive git ops on alpha (R19.7)
- **Action:** Check commit history on scen018-test-repo-alpha via `gh api repos/Emasoft/scen018-test-repo-alpha/commits --jq '.[].commit.message' | head -5`.
- **Goal:** Only clean append-only commits. No force-pushes, no history rewrites.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Commit history shows only forward-moving commits (fix branch, merge, or direct commits).

#### S018: Verify MAINTAINER alpha sent AMP updates to MANAGER
- **Action:** Switch to scen018-manager terminal. Check inbox via `amp-inbox.sh` or by reading the terminal output for received messages.
- **Goal:** MANAGER received AMP messages from scen018-maint-alpha covering: issue detected, triaged as bug, fix started, fix completed.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** At least 3 AMP messages from scen018-maint-alpha visible in MANAGER inbox.

---

## Phase 4: Contributor opens contribution-proposal issue on repo-beta

#### S019: Switch to scen018-contrib-alpha terminal
- **Action:** Click scen018-contrib-alpha in the sidebar.
- **Goal:** Contributor terminal is active.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Terminal shows idle prompt.

#### S020: Instruct contributor to open CONTRIBUTION PROPOSAL issue on repo-beta
- **Action:** Type into the contributor terminal:
  `Open a GitHub issue on Emasoft/scen018-test-repo-beta with title "[PR PROPOSAL] fix test_multiply_negatives" and body "I noticed tests/test_other.py::test_multiply_negatives fails because src/other.py multiply() returns wrong results for negative numbers. I would like to submit a PR fixing it. May I proceed?" Use gh issue create.`
  Wait for the contributor to complete.
- **Goal:** Contribution proposal issue created on repo-beta.
- **Creates:** 1 GitHub issue on scen018-test-repo-beta
- **Modifies:** nothing
- **Verify:** Run `gh issue list --repo Emasoft/scen018-test-repo-beta --state open` and confirm the new issue.

---

## Phase 5: MAINTAINER alpha detects proposal, welcomes contributor, contributor opens PR

> **Note:** Since scen018-maint-alpha is the only MAINTAINER in this scenario (per the task prompt specifying 3 agents), it handles both repos. However, per the TRDD, the direct-fix path runs on repo-alpha and the PR-review path runs on repo-beta. Since only one MAINTAINER is created, the same maintainer handles the beta proposal after completing the alpha fix.

#### S021: Prime MAINTAINER alpha to check repo-beta
- **Action:** Switch to scen018-maint-alpha terminal. Type:
  `Now check Emasoft/scen018-test-repo-beta for new issues. If you find a contribution proposal (someone offering to submit a PR), welcome the contribution. Comment on the issue saying "Yes please, go ahead -- please reference this issue in your PR. I will review your PR when it is open." Do NOT fix it yourself -- wait for the contributor's PR. Report to scen018-manager via AMP.`
- **Goal:** MAINTAINER alpha detects the proposal and welcomes the contribution.
- **Creates:** 1 GitHub comment on the beta issue
- **Modifies:** nothing
- **Verify:** Run `gh issue view 1 --repo Emasoft/scen018-test-repo-beta --json comments --jq '.comments[-1].body'` and confirm the welcome message is present.

#### S022: Verify MAINTAINER did NOT run maintainer-fix on beta
- **Action:** Read scen018-maint-alpha terminal output and conversation log.
- **Goal:** MAINTAINER waited for the contributor's PR instead of fixing it directly.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No clone/fix/commit operations on repo-beta in MAINTAINER's log. Terminal shows "waiting for PR" or equivalent.

#### S023: Switch to contributor and instruct to create the PR (with seeded flaw)
- **Action:** Click scen018-contrib-alpha in sidebar. Type into terminal:
  `MAINTAINER welcomed your contribution on Emasoft/scen018-test-repo-beta. Please:
  1. Clone Emasoft/scen018-test-repo-beta locally into your working directory
  2. Create a fix branch named fix/test-multiply-negatives
  3. Fix the bug in src/other.py (the multiply function returns wrong results for negative numbers)
  4. Do NOT write a regression test yet -- just fix the function
  5. Push the branch and open a PR referencing the proposal issue
  Follow GitHub PR best practices. Use gh pr create.`
  Wait for the contributor to complete all steps.
- **Goal:** PR created on repo-beta with the fix but deliberately missing a regression test (seeded flaw for review).
- **Creates:** 1 branch on scen018-test-repo-beta, 1 PR
- **Modifies:** scen018-test-repo-beta (new branch pushed)
- **Verify:** Run `gh pr list --repo Emasoft/scen018-test-repo-beta --state open` and confirm the PR exists. Verify PR body references the issue.

---

## Phase 6: MAINTAINER reviews PR, requests changes

#### S024: Switch to MAINTAINER and instruct to review the PR
- **Action:** Click scen018-maint-alpha in sidebar. Type:
  `A PR has been opened on Emasoft/scen018-test-repo-beta. Please review it now:
  1. Fetch the PR metadata and diff using gh pr view and gh pr diff
  2. Check if the fix is correct
  3. Check if a regression test was added (it should have been)
  4. Post a review with your findings -- if something is missing, request changes with specific comments
  5. Report to scen018-manager via AMP about the review result`
- **Goal:** MAINTAINER reviews the PR and requests changes (because the regression test is missing).
- **Creates:** 1 PR review on GitHub (CHANGES_REQUESTED state)
- **Modifies:** nothing
- **Verify:** Run `gh pr view 1 --repo Emasoft/scen018-test-repo-beta --json reviews --jq '.reviews[-1].state'` and confirm `CHANGES_REQUESTED`. Verify review comments mention the missing regression test.

#### S025: Verify review comments are substantive
- **Action:** Run `gh pr view 1 --repo Emasoft/scen018-test-repo-beta --json reviews --jq '.reviews[-1].body'`.
- **Goal:** Review comment specifically mentions the missing regression test and requests the contributor to add one.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Review body contains text about missing test. Screenshot of the GitHub PR review page.

---

## Phase 7: Contributor iterates, pushes fix

#### S026: Instruct contributor to address review feedback
- **Action:** Click scen018-contrib-alpha in sidebar. Type:
  `The MAINTAINER has requested changes on your PR on Emasoft/scen018-test-repo-beta. The review says you are missing a regression test. Please:
  1. Read the review comments using gh pr view
  2. Add a regression test in tests/test_other.py that covers the multiply function with negative numbers
  3. Commit the changes and push to update the PR
  Address each review comment.`
  Wait for the contributor to push.
- **Goal:** Contributor adds the missing regression test and pushes a new commit.
- **Creates:** 1 commit on the PR branch
- **Modifies:** scen018-test-repo-beta PR branch
- **Verify:** Run `gh pr view 1 --repo Emasoft/scen018-test-repo-beta --json commits --jq '.commits | length'` and confirm at least 2 commits (original + fix). Verify the new commit adds a test file change.

---

## Phase 8: MAINTAINER re-reviews, approves, merges

#### S027: Instruct MAINTAINER to re-review
- **Action:** Click scen018-maint-alpha in sidebar. Type:
  `The contributor has pushed updates to the PR on Emasoft/scen018-test-repo-beta. Please:
  1. Re-review the PR -- check if the regression test was added
  2. Verify the fix is correct and complete
  3. If everything looks good, approve the PR with a comment like "LGTM -- merging"
  4. Merge the PR using gh pr merge with --squash --delete-branch
  5. After merge, create a GitHub release using gh release create with auto-generated notes
  6. Close the original issue with a comment linking to the release
  7. Report each step to scen018-manager via AMP`
  Wait for MAINTAINER to complete the full cycle.
- **Goal:** PR approved, merged, release created, issue closed.
- **Creates:** 1 APPROVED review, 1 merge commit, 1 GitHub release, 1 issue-closing comment
- **Modifies:** scen018-test-repo-beta main branch (merged PR), tags (new release)
- **Verify:** Multiple checks -- see S028 through S033.

#### S028: Verify PR approved
- **Action:** Run `gh pr view 1 --repo Emasoft/scen018-test-repo-beta --json reviews --jq '[.reviews[] | select(.state == "APPROVED")] | length'`.
- **Goal:** At least 1 APPROVED review exists after the CHANGES_REQUESTED review.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Count >= 1. The APPROVED review timestamp is AFTER the CHANGES_REQUESTED review.

#### S029: Verify PR merged
- **Action:** Run `gh pr view 1 --repo Emasoft/scen018-test-repo-beta --json state`.
- **Goal:** PR state is MERGED (not just closed).
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** State == "MERGED".

#### S030: Verify release created
- **Action:** Run `gh release list --repo Emasoft/scen018-test-repo-beta --limit 1`.
- **Goal:** A new release exists with a version tag higher than v0.1.0.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Release list shows a tag (e.g. v0.1.1 or v0.2.0). Release notes reference the merged PR.

#### S031: Verify beta issue closed with release link
- **Action:** Run `gh issue view 1 --repo Emasoft/scen018-test-repo-beta --json state,comments`.
- **Goal:** Issue state is CLOSED. Last comment links to the release tag.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** State == "CLOSED". Comment body contains the release version or tag.

#### S032: Verify no destructive git ops on beta (R19.7)
- **Action:** Run `gh api repos/Emasoft/scen018-test-repo-beta/commits --jq '.[].commit.message' | head -5`.
- **Goal:** Only clean forward-moving commits. No force-pushes, no history rewrites.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Commit history is append-only.

#### S033: Verify review-before-merge order
- **Action:** Run `gh pr view 1 --repo Emasoft/scen018-test-repo-beta --json reviews,mergedAt`. Parse to confirm every review's `submittedAt` is before `mergedAt`.
- **Goal:** Layer 2 enforcement verified -- MAINTAINER reviewed before merging.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All review timestamps precede mergedAt. At least one CHANGES_REQUESTED review exists before the APPROVED review.

---

## Phase 9: Verify R19.8 + R19.9 governance rules enforcement

#### S034: Verify contributor did NOT merge (R19.8 governance)
- **Action:** Read scen018-contrib-alpha conversation log (`~/.claude/projects/.../*.jsonl`). Search for any `gh pr merge` invocation.
- **Goal:** Contributor never ran `gh pr merge`. The merge was performed by MAINTAINER only.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No `gh pr merge` command found in contributor's conversation log. AMP traffic from contributor contains no "merging" messages.

#### S035: Verify branch ruleset was respected (R19.9 governance)
- **Action:** Verify repo-beta's branch ruleset is still in force: run `gh api repos/Emasoft/scen018-test-repo-beta/rulesets` or check rules via the API. Confirm no direct pushes to main occurred during the scenario.
- **Goal:** Branch protection (require PR, no force-push, no branch delete) was not bypassed.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Ruleset active. All commits to main came through the merged PR (not direct pushes).

#### S036: R19.6 authorized-user gate test -- unauthorized feature request
- **Action:** Switch to scen018-contrib-alpha terminal. Type:
  `Open a GitHub issue on Emasoft/scen018-test-repo-alpha with title "[FEATURE] add logging support" and body "I would like to add logging to all functions in src/buggy.py. This is a feature request." Use gh issue create.`
  Then switch to scen018-maint-alpha and instruct:
  `Check Emasoft/scen018-test-repo-alpha for new issues. If you find a feature request from a non-authorized user, politely decline it per R19.6 -- feature requests are only accepted from the repo owner.`
  Wait for the MAINTAINER to respond.
- **Goal:** MAINTAINER recognizes this as a feature request and politely declines since the contributor is not the repo owner (all agents share the Emasoft gh identity, but the MAINTAINER's plugin-level persona should recognize the distinction based on agent identity, not GitHub identity).
- **Creates:** 1 GitHub issue, 1 comment declining the feature request
- **Modifies:** nothing
- **Verify:** The feature request issue has a comment from MAINTAINER declining it. MAINTAINER did NOT attempt to implement the feature.

> **Note:** Since all agents share the same `gh` identity (Emasoft), the R19.6 test relies on Layer 2 enforcement (plugin persona instructions) rather than GitHub-level user distinction. The MAINTAINER's persona should recognize that AUTONOMOUS agents are not the authorized user for feature requests.

---

## Phase CLEANUP: Restore Original State

#### S037: MANAGER aggregated report verification
- **Action:** Switch to scen018-manager terminal. Type:
  `Please send me a final aggregated report summarizing everything that happened: the alpha direct-fix path (bug detected, triaged, fixed, released) and the beta PR-review path (proposal detected, contributor welcomed, PR reviewed, changes requested, re-reviewed, approved, merged, released). Send this report to the user via AMP.`
  Then check the human user card inbox.
- **Goal:** MANAGER sends one aggregated message to the user summarizing both paths.
- **Creates:** 1 AMP message from MANAGER to user
- **Modifies:** nothing
- **Verify:** User inbox shows a message from scen018-manager covering both alpha and beta paths.

#### S038: Close remaining GitHub issues on both repos
- **Action:** Run `gh issue list --repo Emasoft/scen018-test-repo-alpha --state open` and `gh issue list --repo Emasoft/scen018-test-repo-beta --state open`. For any open issues (e.g., the feature request from S036), close them:
  `gh issue close <number> --repo Emasoft/scen018-test-repo-alpha --comment "Closed by SCEN-018 cleanup"`
  `gh issue close <number> --repo Emasoft/scen018-test-repo-beta --comment "Closed by SCEN-018 cleanup"`
- **Goal:** No open issues remain from the scenario.
- **Removes:** Open issue state on both repos
- **Verify:** `gh issue list --state open` returns 0 for both repos.

#### S039: Delete test PR branches on beta
- **Action:** Run `gh pr list --repo Emasoft/scen018-test-repo-beta --state merged` to find any branches. If the --delete-branch flag was used during merge (S027), the branch should already be gone. If not:
  `git push origin --delete fix/test-multiply-negatives` (from a clone of repo-beta).
- **Goal:** No leftover test branches on repo-beta.
- **Removes:** Remote branch (if still exists)
- **Verify:** `gh api repos/Emasoft/scen018-test-repo-beta/branches --jq '.[].name'` shows only `main`.

#### S040: Delete test release on beta
- **Action:** Run `gh release list --repo Emasoft/scen018-test-repo-beta --limit 5` to find the release created during the scenario. Delete it:
  `gh release delete <tag> --repo Emasoft/scen018-test-repo-beta --yes --cleanup-tag`
- **Goal:** Test release and tag removed from repo-beta.
- **Removes:** GitHub release + associated tag
- **Verify:** `gh release list --repo Emasoft/scen018-test-repo-beta` no longer shows the test release.

#### S041: Delete scen018-maint-alpha (Rule 12 sudo)
- **Action:** Click scen018-maint-alpha in sidebar. Navigate to Profile -> Advanced -> Danger Zone. Click "Delete Agent". When the sudo password modal appears, enter governance password `mYkri1-xoxrap-gogtan` and click Confirm. Check "Also delete agent folder". Type agent name `scen018-maint-alpha` in the confirmation field. Click Delete Forever.
- **Goal:** Agent deleted with all associated resources.
- **Removes:** Agent registry entry, tmux session, agent folder, maintainer ledger
- **Verify:** scen018-maint-alpha not in sidebar. Sudo modal appeared and was handled.

#### S042: Delete scen018-contrib-alpha (Rule 12 sudo)
- **Action:** Same flow as S041 for scen018-contrib-alpha. Enter sudo password `mYkri1-xoxrap-gogtan` when prompted. Check "Also delete agent folder". Type name, click Delete Forever.
- **Goal:** Contributor agent deleted.
- **Removes:** Agent registry entry, tmux session, agent folder
- **Verify:** scen018-contrib-alpha not in sidebar.

#### S043: Delete scen018-manager (Rule 12 sudo)
- **Action:** Same flow as S041 for scen018-manager. Enter sudo password `mYkri1-xoxrap-gogtan` when prompted. Check "Also delete agent folder". Type name, click Delete Forever.
- **Goal:** MANAGER agent deleted.
- **Removes:** Agent registry entry, tmux session, agent folder
- **Verify:** scen018-manager not in sidebar.

#### S044: Purge cemetery entries
- **Action:** Navigate to Settings -> Cemetery tab. Purge entries for scen018-maint-alpha, scen018-contrib-alpha, and scen018-manager. Enter sudo password `mYkri1-xoxrap-gogtan` when prompted for each purge operation.
- **Goal:** Cemetery is clean of test agents.
- **Removes:** Cemetery records for all 3 test agents
- **Verify:** Cemetery shows no scen018-* entries.

#### S045: Verify no test artifacts remain
- **Action:** Check via API: `GET /api/agents` should not contain any scen018-* agents. Read `~/.aimaestro/agents/registry.json` to confirm. Read `~/.aimaestro/teams/teams.json` to confirm no test teams. Run `tmux list-sessions | grep scen018` to confirm no orphan sessions.
- **Goal:** System is clean of all test artifacts.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No scen018-* entries in registry, teams, or tmux.

#### S046: STATE-WIPE -- Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore any that differ:
  `~/.claude/settings.json`,
  `~/.claude/settings.local.json`,
  `~/.aimaestro/governance.json`.
  Do NOT restore registry.json or teams.json (UI deletions already cleaned those).
- **Goal:** All config files match pre-test state.
- **Removes:** nothing
- **Verify:** SHA256 hashes of all 6 config files match the S002 backup hashes.

#### S047: Post-test screenshot
- **Action:** Navigate to dashboard. Take a full-page screenshot.
- **Goal:** UI identical to Phase 0 baseline (S006).
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Visual comparison with S006 baseline screenshot shows identical UI state.

---

## Success Criteria

- MAINTAINER alpha fixed the bug directly via maintainer-fix: clone, branch, fix, test, commit, publish, close issue.
- MAINTAINER alpha welcomed the contributor's proposal on beta instead of fixing it directly.
- Contributor opened a PR on beta and iterated based on review feedback.
- MAINTAINER alpha posted at least one CHANGES_REQUESTED review before the final APPROVED review on beta.
- PR was merged by MAINTAINER, NOT by the contributor (R19.8).
- Branch ruleset was not bypassed during the merge (R19.9).
- A GitHub release was published on beta after the merge.
- R19.3 rejected the duplicate MAINTAINER attempt on repo-alpha.
- R19.6 feature-request gate was exercised (MAINTAINER declined non-owner feature request).
- No destructive git operations occurred on either repo (R19.7).
- MANAGER received AMP status updates from MAINTAINER for every major step on both repos.
- MANAGER sent a final aggregated report to the user covering both paths.
- Cleanup leaves the host indistinguishable from the pre-test state.

## Failure Modes (any triggers scenario FAIL)

- MAINTAINER fixes the beta repo directly instead of waiting for the contributor's PR.
- MAINTAINER refuses the contributor's proposal ("no, I will take care of it").
- MAINTAINER merges the PR without posting any review.
- Contributor runs `gh pr merge` (self-merge violates R19.8).
- MAINTAINER merges bypassing the branch ruleset (force-push, direct push to main).
- No CHANGES_REQUESTED review before the APPROVED review (unless first submission is genuinely clean, which contradicts the seeded flaw).
- No GitHub release published after merge.
- MANAGER fails to receive AMP updates from MAINTAINER.
- Alpha direct-fix path takes more than 15 minutes.
- Beta PR-review path takes more than 45 minutes.
- Cleanup fails to remove all test artifacts.
