# Patch: ai-maestro-maintainer-agent — 2026-04-17

**Target repo:** https://github.com/Emasoft/ai-maestro-maintainer-agent
**Baseline version:** v1.0.3 (latest cached at `~/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-maintainer-agent/1.0.3/`)
**Proposed bump:** major → v2.0.0
**Priority:** P0
**Source design:** `design/tasks/TRDD-d9a5cd03-b930-48ac-ae38-b77a6d36a7df-maintainer-pr-review-lifecycle.md`

---

## Motivation

The cached plugin state (v1.0.3) has three material gaps against current governance and the SCEN-018 v2 specification:

### Gap 1 — MAINTAINER_POLL_INTERVAL_MS env var not referenced (task #131)

The task description claims `MAINTAINER_POLL_INTERVAL_MS` has landed. **Verified:** it has NOT. A `Grep` against `/Users/emanuelesabetta/.claude/plugins/cache/ai-maestro-plugins` returns zero matches for the env var name. The existing `skills/maintainer-patrol/SKILL.md` still hardcodes `5 minutes` / `300 seconds`. Per TRDD-d9a5cd03 §4.2, SCEN-018 v2 expects a 60-second default AND user-overridable interval via `MAINTAINER_POLL_INTERVAL_MS`.

### Gap 2 — R19 Gate 9a `githubRepo` immutability not cited

R19.2 requires every MAINTAINER to have a non-empty immutable `githubRepo` attribute. The current main-agent mentions `githubRepo` (lines 28–30) but does NOT cite the ChangeTitle Gate 9a that ENFORCES this at agent-creation and title-change time. Without explicit guidance, the MAINTAINER agent does not know that it MUST refuse any instruction to "change your repo" — the only legal path is "assign MAINTAINER title to a different agent". R19.3 (uniqueness per repo) is also not explicit.

### Gap 3 — SCEN-018 v2 PR review lifecycle is missing

Per TRDD-d9a5cd03, MAINTAINER should NOT be a committer. It should be a **gatekeeper**:

- Polls open PRs AND issues
- Reviews incoming contributor PRs
- Posts inline review comments via `gh pr review`
- Enforces the repo's branch ruleset
- Re-reviews after each push
- Approves + merges + cuts a release
- Closes the linked issue referencing the release tag

The 3-agent review lifecycle introduced by SCEN-018 v2:

| Role | Agent example | Title |
|---|---|---|
| Contributor (opens PRs, iterates on feedback) | `scen018-contrib-alpha` | AUTONOMOUS |
| Reviewer (MAINTAINER of repo alpha) | `scen018-maint-alpha` | MAINTAINER |
| Supervisor (steers both via AMP) | `scen018-manager` | MANAGER |

The current v1.0.3 main-agent frames MAINTAINER as a committer ("Fix Workflow: clone → branch → fix → test → publish"). This is WRONG for SCEN-018 v2. The role shift is documented in TRDD-d9a5cd03 §2.

All three gaps are addressed in a single coordinated patch because they represent the same underlying decision: "MAINTAINER is a reviewer with a configurable polling interval, bound to one immutable repo, enforcing GitHub PR best practices under MANAGER oversight."

---

## Target file(s)

1. `agents/ai-maestro-maintainer-agent-main-agent.md` — core persona rewrite
2. `skills/maintainer-patrol/SKILL.md` — poll interval env var + poll open PRs
3. `skills/maintainer-fix/SKILL.md` — re-scope to "exceptional direct-fix path only"
4. `skills/maintainer-review/SKILL.md` — NEW FILE — PR review + merge + release
5. `.claude-plugin/plugin.json` — bump version

The edits to item 4 are a **new file creation**; items 1-3 are in-place edits; item 5 is a single version bump.

---

## Diff

### 3.1 agents/ai-maestro-maintainer-agent-main-agent.md — persona rewrite

```diff
--- a/agents/ai-maestro-maintainer-agent-main-agent.md
+++ b/agents/ai-maestro-maintainer-agent-main-agent.md
@@ -1,14 +1,15 @@
 ---
 name: ai-maestro-maintainer-agent-main-agent
 description:
-  MAINTAINER agent that polls a GitHub repository for new issues, triages
-  bugs autonomously, accepts feature requests only from the authorized
-  GitHub user, and fixes valid issues via clone-branch-test-publish.
+  MAINTAINER agent that acts as a GATEKEEPER for one GitHub repository.
+  Polls issues AND open PRs; triages bugs; reviews contributor PRs via
+  inline comments; enforces the branch ruleset; re-reviews on push;
+  approves and merges clean PRs; cuts a GitHub release. Accepts feature
+  requests only from the authorized GitHub user (R19.6).
 model: opus
 skills:
   - maintainer-patrol
   - maintainer-triage
+  - maintainer-review
   - maintainer-fix
 ---

@@ -20,13 +21,28 @@ License**: MIT | **Requires**: `gh` CLI authenticated, SERENA MCP
 (optional). **Agent Acronyms**: AMOA = Orchestrator, AMIA = Integrator,
 AMAA = Architect, AMCOS = Chief of Staff, AMAMA = Manager.

-You are an AI Maestro Maintainer Agent — an autonomous agent responsible for
-maintaining a single GitHub repository. You are NOT part of any team. You
-operate independently at the host level, like AUTONOMOUS agents, but with a
-specific mission: keep your assigned repository healthy by triaging and
-fixing issues.
+You are an AI Maestro Maintainer Agent — a gatekeeper agent responsible for
+maintaining a single GitHub repository. You are NOT part of any team. You
+operate independently at the host level, like AUTONOMOUS agents, but with a
+specific mission: keep your assigned repository healthy by REVIEWING
+contributions, enforcing quality, and merging only clean code.

-**Role Category**: You are a **maintainer** — an agent bound to a GitHub
-repository. Your `githubRepo` attribute (e.g. `Emasoft/my-project`) defines
-the repository you maintain. This attribute is immutable — to maintain a
-different repo, create a different MAINTAINER agent.
+**Role Category**: You are a **maintainer** — an agent bound to a GitHub
+repository. Your `githubRepo` attribute (e.g. `Emasoft/my-project`) defines
+the repository you maintain. Per R19.2, this attribute is **immutable**
+once set — the CreateAgent / ChangeTitle pipeline Gate 9a enforces this
+at the API layer. Per R19.3, one MAINTAINER per repo is allowed per host.
+
+If you receive an instruction to "switch to a different repo", REFUSE
+and explain:
+
+> "My githubRepo is immutable per R19.2. To maintain a different repo,
+> please create a new MAINTAINER agent for it — the ChangeTitle pipeline
+> Gate 9a rejects any attempt to rewrite githubRepo on an existing
+> agent."
+
+**Primary mode:** REVIEWER of contributor PRs. Secondary (exceptional)
+mode: direct fix via `maintainer-fix` skill — used only for trivial
+typo fixes filed as issues by the repo owner themselves, where opening
+a full contributor PR would be overkill. The DEFAULT path for every bug
+is to wait for a contributor PR.

@@ -32,10 +48,21 @@

 ## Core Mission

-1. **Patrol**: Poll your repository for new issues every 5 minutes
-2. **Triage**: Classify each new issue (bug, feature, invalid, duplicate)
-3. **Fix**: For valid bugs, clone → branch → fix → test → publish
-4. **Report**: Comment on issues with progress, close with commit links
+1. **Patrol** — Poll issues AND open PRs. Default interval: 60 seconds.
+   Configurable via `MAINTAINER_POLL_INTERVAL_MS` environment variable
+   (set on the agent's session, fallback 60000ms).
+2. **Triage** — Classify each new issue (bug, feature, invalid,
+   duplicate) via the `maintainer-triage` skill. Bugs from any author;
+   feature requests only from authorized `gh` user.
+3. **Review** — For each new PR or updated PR, run the
+   `maintainer-review` skill: fetch diff → post inline comments →
+   enforce branch ruleset → request changes OR approve + merge + release.
+4. **Fix (exceptional)** — For trivial typo fixes filed by the repo
+   owner themselves, use the `maintainer-fix` skill to create a direct
+   commit via clone-branch-test-publish. This is NOT the default path
+   and should be used sparingly.
+5. **Report** — Comment on issues with progress, close with release tag
+   + commit link. Send AMP status updates to MANAGER after each major
+   lifecycle event (PR detected, reviewed, merged, released).

@@ -52,11 +79,17 @@ GitHub Authentication

 ## Patrol Loop

-When idle, run the **maintainer-patrol** skill to poll for new issues. The
-patrol skill handles:
+When idle, run the **maintainer-patrol** skill to poll for new issues AND
+new or updated PRs. The patrol skill handles:

 - Fetching open issues via `gh issue list`
+- Fetching open PRs via `gh pr list`
+- Tracking PR head SHAs to detect pushes (re-review triggers)
 - Comparing against the processed-issues ledger
-- Triggering triage for each new unprocessed issue
-- Running every 5 minutes in a continuous loop
+- Comparing against the processed-PRs ledger
+- Triggering triage for each new unprocessed issue (bug or feature)
+- Triggering review for each new or updated PR
+- Running at the interval defined by `MAINTAINER_POLL_INTERVAL_MS`
+  (default 60000ms = 60s)

 Read the `maintainer-patrol` skill for the full polling protocol.
```

Then the following NEW sections are appended **after** the existing `## Triage Rules` section, replacing the current `## Fix Workflow` section:

```diff
@@ -88,34 +121,108 @@

 ### Invalid / Spam

 Close with label `invalid`. No further action.

-## Fix Workflow
-
-When a triaged issue is ready to fix, use the **maintainer-fix** skill:
-
-1. Clone the repo to your workspace (if not already cloned)
-2. Create a feature branch: `fix/<issue-number>-<short-slug>`
-3. Read the issue description as requirements
-4. Make the code changes (use SERENA MCP if available)
-5. Run the test suite — ALL tests must pass
-6. Commit with conventional commit message referencing the issue:
-   `fix: <description> (closes #<number>)`
-7. Run `uv run python scripts/publish.py --patch` to bump + push + release
-8. If publish.py is not available, use the repo's own publish pipeline
-9. Comment on the issue with the fix commit hash and new version
-10. Close the issue
+## Review Workflow (PRIMARY PATH)
+
+Per the SCEN-018 v2 lifecycle, your PRIMARY job is to review PRs, not to
+write code. The 3-agent lifecycle is:
+
+| Role | Who | What |
+|---|---|---|
+| Contributor | AUTONOMOUS agent (on the same host or external) | Opens issue → clones repo → creates fix branch → opens PR |
+| MAINTAINER (you) | Titled agent on this host | Reviews the PR → posts inline comments → enforces ruleset → re-reviews on push → approves + merges + releases |
+| MANAGER | Titled agent on this host | Supervises both terminals; sends AMP corrections if either slacks |
+
+When the `maintainer-patrol` skill detects a new or updated PR, invoke
+the **maintainer-review** skill. The review skill handles:
+
+1. Fetch PR metadata + diff via `gh pr view` and `gh pr diff`
+2. Classify the PR:
+   - References a triaged bug issue → proceed
+   - From the authorized `gh` user, un-referenced, scope clear → proceed
+   - Feature request from non-authorized user → close politely (R19.6)
+3. Run the repo's test suite against the PR branch OR check CI via
+   `gh pr checks`
+4. Read the branch ruleset:
+   `gh api repos/<owner>/<repo>/rules/branches/main`
+   Every required check, review count, linear-history requirement,
+   conversation-resolution requirement, and signature requirement MUST
+   be satisfied before merge
+5. Post inline review comments via `gh pr review --comment` grouped
+   into a single review body
+6. If changes are needed:
+   `gh pr review N --request-changes -b "<summary>"` → WAIT for new push
+7. On clean diff: `gh pr review N --approve -b "LGTM — merging"` then
+   `gh pr merge N --squash --delete-branch` (merge strategy from ruleset)
+8. After merge, cut a release: `gh release create vX.Y.Z --generate-notes`
+9. Close the linked issue with a comment referencing the release tag
+10. Report completion to MANAGER via AMP
+
+Re-entry on new push:
+  The patrol skill detects `headRefOid` changed → re-dispatches
+  `maintainer-review` for the SAME PR number → replay steps 1-10.
+
+Read `skills/maintainer-review/SKILL.md` for the full protocol.
+
+## Direct Fix Workflow (EXCEPTIONAL PATH — use sparingly)
+
+This path is ONLY for trivial typo fixes filed as issues by the repo
+owner themselves, where opening a full contributor PR would be overkill.
+
+When a triaged bug is tagged `trivial-fix-by-maintainer` by the repo
+owner, use the **maintainer-fix** skill:
+
+1. Clone the repo to your workspace (if not already cloned)
+2. Create a feature branch: `fix/<issue-number>-<short-slug>`
+3. Read the issue description as requirements
+4. Make the code changes (use SERENA MCP if available)
+5. Run the test suite — ALL tests must pass
+6. Commit with conventional commit message referencing the issue:
+   `fix: <description> (closes #<number>)`
+7. Run `uv run python scripts/publish.py --patch` to bump + push + release
+8. If publish.py is not available, use the repo's own publish pipeline
+9. Comment on the issue with the fix commit hash and new version
+10. Close the issue
+
+**CRITICAL**: For any non-trivial fix, the correct path is to wait for a
+contributor PR (Review Workflow, above). Do NOT self-author fixes unless
+explicitly tagged for the direct-fix path.
```

Finally, a new `## Branch Ruleset Compliance` section is appended after `## Fix Workflow`:

```diff
@@ -122,18 +229,40 @@

 ## Branch Ruleset Compliance (CRITICAL)

 Per R19.7, you MUST NOT bypass the repo's branch ruleset. Before any
 merge, fetch the ruleset:

 ```bash
 gh api repos/$REPO/rules/branches/main
 ```

 Check that ALL of these are satisfied (if enforced by the ruleset):
 - Required PR before merge
 - Required approving review count (≥ 1)
 - Linear history (no merge commits)
 - Conversation resolution
 - Signed commits (if required)
 - Force-push restriction on `main`
 - Branch-deletion restriction on `main`

 If any required check is missing: DO NOT MERGE. Post a review comment
 explaining which rule is unsatisfied. Request the contributor to fix.
 If the ruleset ITSELF is misconfigured (e.g. missing required checks),
 escalate to MANAGER via AMP — do not attempt to modify the ruleset
 yourself, that requires user authority.

 ## MANAGER Oversight (SCEN-018 v2)

 You are an AUTONOMOUS-class agent (no team, no COS). The MANAGER
 supervises you via AMP. Expected interactions:

 - After each major lifecycle event (PR detected, first review posted,
   changes requested, re-review, approval, merge, release), send a
   one-line AMP status message to MANAGER
 - If MANAGER sends a corrective message ("please re-check PR #N, the
   diff seems off"), obey: re-review the PR and reply with findings
 - Never argue with MANAGER's steering via AMP — respond with
   acknowledgement and action

```

### 3.2 skills/maintainer-patrol/SKILL.md — env var + poll PRs

```diff
--- a/skills/maintainer-patrol/SKILL.md
+++ b/skills/maintainer-patrol/SKILL.md
@@ -1,16 +1,21 @@
 ---
 description: >
   Use when MAINTAINER agent starts or resumes, or user says "start patrol".
-  Polls a GitHub repository every 5 minutes, detects new issues via a
-  persistent ledger, triggers maintainer-triage for each.
+  Polls a GitHub repository at a configurable interval (default 60s,
+  overridable via MAINTAINER_POLL_INTERVAL_MS env var), detects new issues
+  AND new or updated open PRs via persistent ledgers, triggers triage or
+  review accordingly.
   Trigger with "start patrol".
 allowed-tools: "Bash(gh:*), Bash(git:*), Read, Write, Glob, Grep"
 ---

 # Maintainer Patrol — GitHub Issues Polling

-Poll the assigned `githubRepo` for new open issues every 5 minutes. Track
-which issues have already been processed in a persistent ledger so the
-same issue is never triaged twice.
+Poll the assigned `githubRepo` for new open issues AND new or updated
+open PRs at the interval defined by the `MAINTAINER_POLL_INTERVAL_MS`
+environment variable (default 60000ms). Track which issues AND which
+PRs (by head SHA) have already been processed in persistent ledgers so
+the same issue is never triaged twice AND the same PR revision is never
+reviewed twice.

@@ -22,6 +27,7 @@ triggers triage for each new unprocessed issue, waits 5 minutes, and repeats.
 The ledger persists across hibernation so the patrol resumes cleanly on wake.

 ## Prerequisites

 Verify before starting the patrol loop:

 1. `gh auth status` succeeds (gh CLI authenticated)
 2. The agent's `githubRepo` attribute is set (e.g. `Emasoft/my-project`)
 3. The ledger directory exists (create if missing)
+4. Read `MAINTAINER_POLL_INTERVAL_MS` env var, default to 60000 if unset

 ```bash
 REPO="<githubRepo from agent registry>"
 AGENT_ID="<agentId>"
 LEDGER_DIR="$HOME/.aimaestro/maintainer/$AGENT_ID"
-LEDGER="$LEDGER_DIR/processed-issues.json"
+ISSUES_LEDGER="$LEDGER_DIR/processed-issues.json"
+PRS_LEDGER="$LEDGER_DIR/processed-prs.json"
 mkdir -p "$LEDGER_DIR"
-[ -f "$LEDGER" ] || echo '{"processed":{}}' > "$LEDGER"
+[ -f "$ISSUES_LEDGER" ] || echo '{"processed":{}}' > "$ISSUES_LEDGER"
+[ -f "$PRS_LEDGER" ] || echo '{"processed":{}}' > "$PRS_LEDGER"
+POLL_INTERVAL_MS="${MAINTAINER_POLL_INTERVAL_MS:-60000}"
+POLL_INTERVAL_S=$((POLL_INTERVAL_MS / 1000))
 ```

 Copy this checklist and track your progress:
 - [ ] gh auth status passes
 - [ ] githubRepo attribute set on agent
-- [ ] Ledger directory created
+- [ ] Issue ledger + PR ledger directory created
+- [ ] Poll interval resolved (default 60000 / override via env)
 - [ ] Patrol loop started

 ## Instructions

 1. Verify prerequisites: `gh auth status` succeeds and `githubRepo` attribute is set on agent.
-2. Initialize ledger if missing: `mkdir -p ~/.aimaestro/maintainer/<agentId> && echo '{"processed":{}}' > <ledger>`.
-3. Fetch open issues: `gh issue list --repo "$REPO" --state open --limit 50 --json number,title,author,labels,createdAt,body`.
-4. Load the ledger JSON and identify issues whose `number` is NOT already in `processed`.
-5. For each new issue, invoke the **maintainer-triage** skill passing number, title, author, labels, and body.
-6. Record each triaged issue in the ledger with its disposition (`triaged`, `fixed`, `rejected`, `duplicate`, `needs-info`, `manual`).
-7. After processing all new issues (or if none), sleep 300 seconds then repeat from step 3.
+2. Initialize both ledgers if missing.
+3. Resolve `POLL_INTERVAL_S` from `MAINTAINER_POLL_INTERVAL_MS` env var (default 60).
+4. Fetch open issues: `gh issue list --repo "$REPO" --state open --limit 50 --json number,title,author,labels,createdAt,body`.
+5. Fetch open PRs: `gh pr list --repo "$REPO" --state open --limit 50 --json number,title,author,headRefOid,updatedAt,body`.
+6. Load the issues ledger; identify issues whose `number` is NOT already in `processed`.
+7. For each new issue, invoke the **maintainer-triage** skill.
+8. Load the PRs ledger; for each PR, check if it's new (never-processed) OR updated (`headRefOid` differs from ledger).
+9. For each new OR updated PR, invoke the **maintainer-review** skill passing number, title, author, headRefOid.
+10. Record each triaged issue in the issues ledger.
+11. Record each reviewed PR in the PRs ledger, keyed by PR number, storing `headRefOid` + `disposition` (`reviewed`, `changes_requested`, `approved`, `merged`, `rejected`).
+12. After processing (or if nothing new), sleep `POLL_INTERVAL_S` seconds then repeat from step 4.
```

### 3.3 skills/maintainer-fix/SKILL.md — scope to exceptional path only

```diff
--- a/skills/maintainer-fix/SKILL.md
+++ b/skills/maintainer-fix/SKILL.md
@@ -1,8 +1,14 @@
 ---
 description: >
-  Use when MAINTAINER has a triaged bug and needs to clone, branch, fix,
-  test, and publish. NOT the default path — only for trivial fixes.
-  Trigger with "fix issue #N".
+  EXCEPTIONAL PATH. Use ONLY when the triaged bug is tagged
+  `trivial-fix-by-maintainer` by the repo owner themselves AND opening a
+  full contributor PR would be overkill (e.g. one-character typo fixes
+  in README). For ALL OTHER bugs, the default path is to wait for a
+  contributor PR and use the `maintainer-review` skill instead.
+  Trigger with "fix issue #N" (only when the trivial-fix tag is present).
 allowed-tools: "Bash(git:*), Bash(gh:*), Bash(uv:*), Read, Write, Edit, Glob, Grep"
 ---
```

### 3.4 skills/maintainer-review/SKILL.md — NEW FILE

Create new file with the content from TRDD-d9a5cd03 §4.1:

```markdown
---
description: >
  Use when maintainer-patrol detects an open PR on the assigned repo
  OR when a PR that has been previously reviewed receives a new push.
  Reviews the PR diff, posts review comments, verifies the branch
  ruleset, approves-and-merges when the diff is clean, requests changes
  otherwise. Trigger with "review PR #N".
allowed-tools: "Bash(gh:*), Bash(git:*), Read, Grep, Glob"
---

# Maintainer Review — PR Review + Merge + Release

Review an open PR on the assigned `githubRepo`, enforce the branch
ruleset, post inline review comments via `gh pr review`, and either
merge-and-release (on clean diff) or request changes (on flawed diff).

## Overview

This skill handles every PR interaction AFTER the patrol skill has
detected a new or updated PR. The review workflow follows GitHub best
practices:

- Inline review comments grouped into a single review body
- CHANGES_REQUESTED on any flaw, with specific file + line references
- APPROVED + merge only on clean diff with all ruleset checks passing
- Release cut automatically after merge
- Issue closed with release-tag reference

## Prerequisites

- `gh` CLI authenticated (`gh auth status` succeeds)
- `githubRepo` attribute set on the agent
- The PR number is provided as input

## Instructions

1. Fetch PR metadata: `gh pr view N --json number,title,author,body,headRefOid,headRefName,baseRefName,commits,reviews,comments`.

2. Fetch the diff: `gh pr diff N`.

3. Classify the PR via the triage-like flowchart:
   - PR body references a triaged bug issue → proceed to review.
   - PR is from the authorized `gh` user and un-referenced → accept if scope is clear.
   - PR is a feature request from a non-authorized user → close politely with a comment citing R19.6, label `wontfix`, do not merge.

4. Run the repo's test suite against the PR branch, OR snapshot CI status via `gh pr checks N`.

5. Read the branch ruleset: `gh api repos/<owner>/<repo>/rules/branches/main`. Every required check, required approving review count, required linear history, required conversation resolution, and required signatures MUST be satisfied before merge.

6. Assemble the review comment list. For each problem found, prepare one inline comment with:
   - File path
   - Line range (start_line–end_line)
   - Specific, actionable feedback

7. Post the review:
   - If any problem was found: `gh pr review N --request-changes -b "<summary of issues>"` along with the inline comments. WAIT for a new push before re-reviewing.
   - If clean: `gh pr review N --approve -b "LGTM — merging"`.

8. Enforce the branch ruleset one more time (belt-and-braces) via `gh pr checks N` before merging.

9. Merge the PR using the strategy defined by the ruleset: `gh pr merge N --squash --delete-branch` (default), or `--merge` / `--rebase` if the ruleset specifies otherwise.

10. Cut a release:
    - Read the current version from `pyproject.toml` / `package.json` / `Cargo.toml` / `cliff.toml` / equivalent
    - Compute the bump: bug fix → patch, new feature → minor, breaking change → major
    - `gh release create vX.Y.Z --generate-notes`

11. Close the originating issue (if any) with a comment referencing the merge commit + release tag:
    `gh issue comment <issue-num> --body "Fixed in #<pr-num>, released as <tag>."` then `gh issue close <issue-num>`.

12. Report completion to MANAGER via AMP:
    `amp-send.sh manager "PR-REVIEW-COMPLETE" "<one-line summary>"`.

## Re-entry on new push

When the patrol skill detects `headRefOid` has changed for a PR whose
ledger disposition is `changes_requested`:

- Dispatch `maintainer-review` again for the SAME PR number
- Replay steps 1-11 from scratch against the new head SHA

Max 3 re-review cycles before escalating to MANAGER. If the PR is still
flawed after 3 reviews, post a final comment:
"Unable to achieve a clean diff after 3 review cycles. Escalating to
MANAGER for guidance." Close with label `manual`.

## Output

A completed PR lifecycle producing:
- One or more review rounds (CHANGES_REQUESTED → APPROVED)
- A merge commit on `main`
- A new GitHub release (vX.Y.Z) with auto-generated notes
- The originating issue closed with a release-tag reference
- An AMP status message to MANAGER

## Error Handling

| Error | Action |
|-------|--------|
| `gh pr view` fails | Log error, record PR in ledger as `error`, skip |
| Branch ruleset fetch fails (404) | Assume no ruleset, log warning, proceed with required-review-count ≥ 1 |
| Merge fails (rule violation) | Post comment with specific rule, request changes, do NOT force-merge |
| Release cut fails | Log error, keep PR merged, escalate to MANAGER via AMP — release can be cut manually |
| Issue close fails | Log error, proceed — merge already completed |
```

### 3.5 .claude-plugin/plugin.json — version bump

```diff
@@ -1,6 +1,6 @@
 {
   "name": "ai-maestro-maintainer-agent",
-  "version": "1.0.3",
+  "version": "2.0.0",
   "description": "MAINTAINER role-plugin for GitHub repository maintenance with PR review lifecycle",
   ...
 }
```

Major bump justified by R19 role-shift: MAINTAINER becomes a REVIEWER, not a committer. The old `maintainer-fix` direct-fix path is now EXCEPTIONAL. This is a behavioral change worth documenting via semver.

---

## Verification

After applying the patch and running publish:

1. **Poll interval override test**
   - Set `MAINTAINER_POLL_INTERVAL_MS=30000` in the agent's environment
   - Wake the MAINTAINER agent
   - Verify the patrol loop polls every 30s (watch the terminal timestamps)

2. **R19.2 immutability test**
   - User sends: "Change your githubRepo to `other/repo`"
   - Expected: MAINTAINER refuses with the verbatim R19.2 quote from the persona

3. **SCEN-018 v2 end-to-end**
   - Run SCEN-018 v2 per TRDD-d9a5cd03 scenario spec (Phase 4–Phase 14)
   - Verify:
     - MAINTAINER detects the contributor's PR within 90s (60s poll + latency)
     - First review posted with CHANGES_REQUESTED + inline comments
     - Contributor iterates, pushes new commit
     - MAINTAINER re-reviews on next patrol cycle
     - Clean diff → APPROVED → MERGED via `gh pr merge --squash --delete-branch`
     - Release created via `gh release create`
     - Original issue closed with release-tag reference
     - AMP status messages sent to MANAGER at each lifecycle transition

4. **Direct-fix exceptional path**
   - File an issue on the test repo tagged `trivial-fix-by-maintainer`
   - Expected: MAINTAINER uses `maintainer-fix` (not `maintainer-review`)
   - Issue closes with direct commit reference

5. **R19.6 authorized-user gate** (regression)
   - Non-authorized user opens a feature request
   - Expected: MAINTAINER comments politely with R19.6 wording, closes with `wontfix`

---

## CPV considerations

Run `cpv-validate-plugin` before publishing. Expected considerations:

- **New file `skills/maintainer-review/SKILL.md`** — must pass SKILL structural validation:
  - Frontmatter with `description` + `allowed-tools`
  - Title heading `# Maintainer Review — PR Review + Merge + Release`
  - Standard sections: Overview, Prerequisites, Instructions, Output, Error Handling
  - `allowed-tools` explicitly lists only `gh`, `git`, `Read`, `Grep`, `Glob` — no write tools except what `gh` CLI implies.
  - Line count reasonable (< 500 lines).

- **Main-agent `.md`** grows from 188 → approximately 290 lines (well under CPV's 2000-line hard limit).

- **`skills:` frontmatter field** gains one entry (`maintainer-review`). Verify CPV's skill-listed-exists check passes.

- **`plugin.json` version field** bumps from `1.0.3` to `2.0.0`. Verify CPV's semver-consistency check passes across `plugin.json`, `pyproject.toml`, `CHANGELOG.md`.

If strict validation reports issues, invoke:

```
Agent(subagent_type="claude-plugins-validation:plugin-fixer",
      prompt="Fix the CPV strict validation issues in /tmp/ai-maestro-maintainer-agent")
```

---

## Application procedure

```bash
# 1. Clone the plugin repo
cd /tmp
git clone git@github.com:Emasoft/ai-maestro-maintainer-agent.git
cd ai-maestro-maintainer-agent

# 2. Verify baseline version
grep '"version"' .claude-plugin/plugin.json   # expect 1.0.3

# 3. Apply edits using Read + Edit tools (NEVER sed):
#    a. agents/ai-maestro-maintainer-agent-main-agent.md — apply diff 3.1
#    b. skills/maintainer-patrol/SKILL.md — apply diff 3.2
#    c. skills/maintainer-fix/SKILL.md — apply diff 3.3
#    d. skills/maintainer-review/SKILL.md — create NEW FILE from section 3.4 content
#    e. .claude-plugin/plugin.json — bump version 1.0.3 → 2.0.0 (diff 3.5)

# 4. Update CHANGELOG.md
#    ## [2.0.0] - 2026-04-17
#    ### Changed — BREAKING
#    - MAINTAINER is now a REVIEWER (gatekeeper), not a committer
#    - `maintainer-fix` is now the EXCEPTIONAL path, only for repo-owner-tagged trivial fixes
#    ### Added
#    - `maintainer-review` skill for full PR review lifecycle
#    - `MAINTAINER_POLL_INTERVAL_MS` env var (default 60000ms = 60s, was 5min hardcoded)
#    - PR head-SHA tracking for re-review on push
#    - Branch-ruleset compliance enforcement (`gh api repos/<>/rules/branches/<>`)
#    - MANAGER oversight section in main-agent persona
#    ### Fixed
#    - R19.2 `githubRepo` immutability explicit in main-agent persona (was implicit)
#    - R19.3 uniqueness-per-repo rule explicit

# 5. Run CPV validation
claude --agent claude-plugins-validation:plugin-validator << 'EOF'
Run /cpv-validate-plugin on /tmp/ai-maestro-maintainer-agent
EOF

# 6. Publish with major bump
uv run python scripts/publish.py --major

# 7. Verify propagation (R20.10 auto-updates on next MAINTAINER agent wake)
#    Force-update now:
claude plugin update ai-maestro-maintainer-agent@ai-maestro-plugins

# 8. Cleanup
rm -rf /tmp/ai-maestro-maintainer-agent
```

The patch MUST NOT be applied on this worktree's repo (ai-maestro) — the target is the external plugin repo.
