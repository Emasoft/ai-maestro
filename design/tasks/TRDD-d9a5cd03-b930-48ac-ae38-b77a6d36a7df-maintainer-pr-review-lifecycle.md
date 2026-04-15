# TRDD-d9a5cd03 — MAINTAINER PR Review Lifecycle (SCEN-018 v2 + plugin expansion)

**TRDD ID:** `d9a5cd03-b930-48ac-ae38-b77a6d36a7df`
**Filename:** `design/tasks/TRDD-d9a5cd03-b930-48ac-ae38-b77a6d36a7df-maintainer-pr-review-lifecycle.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started — awaiting user approval of the design below
**Related TRDD:** TRDD-a58a02c4-…-maintainer-title (original MAINTAINER title introduction)
**Priority:** BLOCKS overnight batch — SCEN-018 is insufficient as written
**Created:** 2026-04-15

---

## 1. The gap (user's feedback, 2026-04-15)

> "the MAINTAINER scenario is insufficient.. you must use another agent to
> open an issue on the repo monitored by the MAINTAINER, and then clone
> locally the repo in its working dir, then edit the files to add or fix
> something, and make a PR. The MAINTAINER agent (if it is correctly
> polling every minute) will detect the issue, detect the PR and make a
> PR review, posting the comments on github PR comment page.. this is
> crucial to the MAINTAINER role plugin main agent.. it must verify and
> follow the branch ruleset of the github repo branch and merge the PR
> only after carefully reviewed and reported the bugs to fix to the
> author of the PR review. He will then fix the PR and update it with
> the new version fixed. The MAINTAINER must detect the new version with
> the fixes, evaluate/review it again, and finally if it is ok accept
> the PR and merge. The PR procedures must follow the best practices of
> github, so the scenario must be expanded and documented to follow and
> track those steps. And the MANAGER must monitor and approve each step,
> and if he sees the agents slacking or doing the PR wrong, it must
> intervene. Those are MAINTAINERS and AUTONOMOUS agents, so there is no
> team with a CHIEF-OF-STAFF the MANAGER can delegate to. It must
> monitor and correct/steer every operation of the agents. The MAINTAINER
> scenario must conclude with the PR successfully merged with no issues
> and a new github release published. Otherwise must be considered a
> failure."

---

## 2. Role shift: MAINTAINER is a REVIEWER, not a committer

### Current (v1.0.2)

| Who | What |
|---|---|
| MAINTAINER | Patrols issues → triages → clones repo → fixes bugs in a branch → publishes → closes issue |
| The repo | Passively receives commits from the MAINTAINER |
| The user | Opens issues, waits for fix |

MAINTAINER is the committer. No PR workflow. Suited for single-owner
repos where the maintainer is the only contributor.

### Target (v2.0.0)

| Who | What |
|---|---|
| CONTRIBUTOR (AUTONOMOUS agent) | Reads an issue → clones repo → creates a branch → edits files → opens a PR → responds to review feedback → pushes fixes |
| MAINTAINER | Polls for issues AND open PRs → reviews PRs → posts inline comments on diffs → enforces branch ruleset → re-reviews after updates → approves → merges → cuts release |
| MANAGER | Observes the MAINTAINER and CONTRIBUTOR terminals → sends AMP corrections if either slacks or misuses GitHub → approves each major step |
| The user | Delegates a bug report to the CONTRIBUTOR, then hands off supervision to MANAGER and watches from the dashboard |

MAINTAINER is a gatekeeper. Contributors own the code changes. This
matches real open-source maintenance workflows.

---

## 3. Agent roster for SCEN-018 v2

| Agent | Title | Plugin | Bound to | Role |
|---|---|---|---|---|
| `scen018-manager` | MANAGER | `ai-maestro-assistant-manager-agent` | — | Monitors + steers MAINTAINER and CONTRIBUTOR; final approval authority; aggregates status for the user |
| `scen018-maint-alpha` | MAINTAINER | `ai-maestro-maintainer-agent` | `Emasoft/scen018-test-repo-alpha` | Reviews PRs against `alpha` |
| `scen018-contrib-alpha` | AUTONOMOUS | `ai-maestro-programmer-agent` | — | Opens issues + creates fix PRs against `alpha`. Does NOT belong to any team. |
| (optional — defer) `scen018-maint-beta` | MAINTAINER | `ai-maestro-maintainer-agent` | `Emasoft/scen018-test-repo-beta` | Only kept for the R19.3 uniqueness test — does not run through the full lifecycle |

MAINTAINER + CONTRIBUTOR are both AUTONOMOUS-class (no team, no COS).
MANAGER is the supervisor but not a team leader.

---

## 4. MAINTAINER plugin changes (v1.0.2 → v2.0.0)

### 4.1 New skill: `maintainer-review`

Handles everything the old `maintainer-fix` did NOT do: reviewing an
inbound PR, posting inline + general comments on the diff, enforcing
the branch ruleset, re-reviewing on push, approving, and merging.

```
skills/maintainer-review/SKILL.md
```

Canonical structure (following the other three skills' format):

```
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

1. Fetch PR metadata (`gh pr view N --json ...`)
2. Fetch the diff (`gh pr diff N`)
3. Apply the classification flowchart:
   - PR references a triaged bug issue → proceed
   - PR is from authorized-user but un-referenced → accept if scope is clear
   - PR is feature from non-authorized-user → close with a comment
     explaining R19.6
4. Run the repo's test suite against the PR branch (clone if needed, or
   check the CI status via `gh pr checks N`).
5. Read the branch ruleset:
   `gh api repos/<owner>/<repo>/rules/branches/main` — every required
   check, required review count, required linear history, required
   conversation resolution, required signatures MUST be satisfied.
6. For each problem found, post an inline review comment via
   `gh pr review N --comment -b "..."` on the specific line range. Group
   multiple comments into a single review via `gh pr review --body` +
   `--comment-file` where possible, following GitHub PR review etiquette.
7. If any problem was found: `gh pr review N --request-changes -b "..."`
   and WAIT for a new push before re-reviewing.
8. If clean: run a final `gh pr checks N` snapshot, then
   `gh pr review N --approve -b "LGTM — merging"`, then
   `gh pr merge N --squash --delete-branch` (merge strategy is read from
   the branch ruleset).
9. After merge: cut a release with `gh release create vX.Y.Z --generate-notes`.
   Version number comes from the repo's version policy (read from
   pyproject.toml / package.json / Cargo.toml / cliff.toml).
10. Close the linked issue with a comment that references the release tag.
11. Report completion to MANAGER via AMP.

Re-entry on new push:
- Patrol detects the PR head SHA has changed → dispatch maintainer-review
  for the SAME PR number → replay steps 2-10 from scratch.
```

### 4.2 Updated `maintainer-patrol`

The current patrol only polls `gh issue list`. Add:

- `gh pr list --state open --json number,headRefOid,updatedAt` every cycle
- Track PR head SHAs in the ledger:
  `~/.aimaestro/maintainer/<agentId>/processed-prs.json`
- If a known PR's `headRefOid` changed since the last cycle → trigger
  `maintainer-review` again
- Patrol tick default should be **60 seconds** (not 300s) to match the
  user's "every minute" requirement. Configurable via
  `MAINTAINER_POLL_INTERVAL_MS` (task #131, already in progress).

### 4.3 Updated main agent persona

The main agent persona needs to LOSE the "I fix bugs directly" framing
and GAIN the "I'm a gatekeeper for external contributions" framing.
Specifically:

- "Core Mission" shifts from "clone → fix → publish" to "review → comment
  → approve → merge → release"
- Add a section: "Working with contributors" — how to post review
  comments, how to request changes, how to re-review on push
- Add a section: "Branch ruleset compliance" — how to read the repo's
  branch ruleset and enforce it
- Add a section: "Release cutting" — how to create a GitHub release
  post-merge
- Add a section: "MANAGER oversight" — the MAINTAINER is under MANAGER
  supervision for AUTONOMOUS-class work; accept steering via AMP and
  report completion
- Keep: the authorized-user gate (R19.6), the no-destructive-ops rule
  (R19.7), the single-repo binding (R19.3)

### 4.4 What `maintainer-fix` becomes

Two options:

**Option A (recommended):** Keep `maintainer-fix` for the edge case of
trivial typo fixes where no external contributor is involved (e.g., a
README typo filed as an issue by the repo owner themselves). Make it
explicit that `maintainer-fix` is the EXCEPTION, not the default — the
default is to wait for a contributor PR.

**Option B:** Delete `maintainer-fix` entirely. Every bug goes through a
contributor PR. More consistent but strips the plugin of the "autonomous
self-healing" capability.

Recommend Option A for flexibility. Decision pending user input.

---

## 5. Test-repo prerequisites

Before the scenario can run, both `Emasoft/scen018-test-repo-alpha` and
`Emasoft/scen018-test-repo-beta` need:

1. **Branch ruleset on `main`** configured via
   `gh api -X PUT repos/<owner>/<repo>/rules/branches/main` with:
   - require PR before merge
   - require 1 approving review
   - dismiss stale reviews on push
   - require linear history
   - require conversation resolution
   - restrict force pushes
   - restrict deletions
2. **Known failing test** to anchor the bug fix (`tests/test_buggy.py` —
   already present per task #81)
3. **`scripts/publish.py`** with strict pipeline (already present)
4. **`pyproject.toml`** with a bumpable version (already present per
   task #81's "create 2 fake GitHub test repos with buggy files")

New requirement for the scenario:
5. **Empty `CHANGELOG.md`** that the release step will populate from
   `git log` on the merged branch
6. **`v0.1.0` initial git tag** so the first release becomes `v0.1.1`

---

## 6. Scenario phase structure (SCEN-018 v2)

Rough outline — actual step count will land at ~40-50 steps.

```
Phase 0: SAFE-SETUP
  - health check + fixture verification + backup (unchanged)
  - login (unchanged)
  - verify MANAGER exists or create scen018-manager

Phase 1: Create AUTONOMOUS contributor agent
  - S00x: wizard → scen018-contrib-alpha, client=claude,
          title=AUTONOMOUS, role-plugin=ai-maestro-programmer-agent,
          no team, no githubRepo
  - Verify agent is online and has a terminal

Phase 2: Create MAINTAINER agent
  - S00x: wizard → scen018-maint-alpha, client=claude,
          title=MAINTAINER, role-plugin=ai-maestro-maintainer-agent,
          githubRepo=Emasoft/scen018-test-repo-alpha
  - Verify Gate 9a validated the repo
  - Verify maintainer-patrol started on wake (and ledger dir exists)

Phase 3: R19.3 uniqueness test (unchanged)
  - S00x: attempt duplicate MAINTAINER on the same repo → rejected

Phase 4: User delegates a bug report to the CONTRIBUTOR
  - S00x: switch to scen018-contrib-alpha terminal
  - S00x: user sends prompt: "A bug was reported: divide(-10, 2) returns
          the wrong result. Please:
            1. Open a GitHub issue on Emasoft/scen018-test-repo-alpha
               describing the bug
            2. Clone the repo locally
            3. Create a fix branch
            4. Fix the bug and add a regression test
            5. Push the branch and open a PR referencing the issue
          Follow GitHub PR best practices."
  - Wait for the contributor to finish all 5 sub-steps
  - Verify: issue exists on GitHub, PR exists on GitHub, branch exists

Phase 5: MANAGER oversight of contribution phase
  - S00x: switch to scen018-manager terminal
  - S00x: user sends prompt: "Monitor scen018-contrib-alpha and
          scen018-maint-alpha via their terminals. Report status via AMP."
  - Verify MANAGER reports contribution phase complete via AMP

Phase 6: MAINTAINER detection (1-minute polling)
  - S00x: wait up to 90s for maintainer-patrol to detect the new PR
  - Verify: ledger has new entry, MAINTAINER terminal shows "detected
    PR #N", optionally MAINTAINER terminal shows it picked up the linked
    issue as well
  - Screenshot: MAINTAINER's terminal at the detection moment

Phase 7: First review — MAINTAINER posts change requests
  - S00x: wait for MAINTAINER to complete its first review
  - Verify on GitHub:
    - `gh pr view N --json reviews` shows a review with state
      CHANGES_REQUESTED
    - `gh pr view N --json comments` shows inline review comments
    - Each comment references a specific file and line range
  - The MAINTAINER's review MUST find at least one real issue in the
    contributor's initial PR (we deliberately seed the PR with a flaw
    via the user's contributor prompt — e.g. "but skip writing the
    regression test the first time")
  - Screenshot: the GitHub PR review comments tab

Phase 8: Contributor iterates
  - S00x: user sends prompt to scen018-contrib-alpha: "The MAINTAINER
          has requested changes on PR #N. Read the review comments and
          address each one. Push a new version."
  - Wait for contributor to push
  - Verify `gh pr view N --json commits` shows a new commit

Phase 9: MAINTAINER re-review
  - S00x: wait for patrol to detect the new PR head SHA
  - Wait for MAINTAINER to complete the second review
  - Verify on GitHub:
    - New review with state APPROVED OR CHANGES_REQUESTED (if still flawed)
  - If still flawed: loop to Phase 8 (max 3 iterations — if after 3
    reviews the PR is still flawed, mark the scenario FAIL)

Phase 10: Branch ruleset compliance check
  - S00x: verify the MAINTAINER did NOT merge with the approval count or
    ruleset violated
  - Verify `gh api repos/<owner>/<repo>/branches/main/protection` is in
    force and the MAINTAINER's merge attempt respected it

Phase 11: Merge + release
  - S00x: wait for MAINTAINER to merge the PR
    Verify `gh pr view N --json state` == MERGED
    Verify `gh pr view N --json mergeCommit` is set
  - Wait for MAINTAINER to cut a release
    Verify `gh release list --repo <repo>` has a new release vX.Y.Z
    Verify the release notes reference the merged PR

Phase 12: Issue closure
  - Verify the original issue is CLOSED with a comment from MAINTAINER
    linking to the release tag
  - Verify contributor received an AMP notification from MAINTAINER
    thanking them for the contribution

Phase 13: R19.6 authorized-user gate test
  - S00x: user sends prompt to scen018-contrib-alpha: "Now open a
          FEATURE REQUEST issue titled 'Add logging' — you are NOT the
          repo owner, so the MAINTAINER should politely decline."
  - Verify MAINTAINER comments on the issue saying feature requests are
    only accepted from the authorized user, does NOT act

Phase 14: MANAGER aggregated report
  - S00x: open MANAGER → user inbox
  - Verify the single aggregated message with the full sequence summary
    (PR #N opened → reviewed → fixed → approved → merged → released)

Phase 15: CLEANUP
  - Delete scen018-contrib-alpha (sudo)
  - Delete scen018-maint-alpha (sudo)
  - Delete scen018-manager IF created by the scenario
  - Purge cemetery entries
  - On GitHub: close remaining issues, DELETE the test PR branches,
    DELETE the test release (kept: the merged commits and the fake repo)
  - Restore config backups
  - Post-test screenshot

Success criteria:
  - PR #N was merged by MAINTAINER, not by contributor
  - A new GitHub release was published by MAINTAINER
  - The MAINTAINER posted at least one CHANGES_REQUESTED review before
    the final APPROVED review
  - The contributor iterated at least once in response to review
    feedback
  - Branch ruleset was enforced (linear history, required review,
    conversation resolution)
  - MANAGER sent at least one AMP steering message (scripted or
    triggered by detected slacking)
  - MANAGER's final aggregated report captures the full sequence
  - R19.6 authorized-user gate rejected the non-authorized feature
    request
  - No destructive git operations on any repo (R19.7)
  - Cleanup leaves the host indistinguishable from pre-test state

FAILURE MODES (any → scenario FAIL):
  - MAINTAINER merges without CHANGES_REQUESTED first pass (unless the
    first version was genuinely clean, which contradicts our seeded flaw)
  - MAINTAINER merges bypassing the branch ruleset
  - Contributor commits to main directly (R19.7 equivalent)
  - MANAGER fails to detect a slacking agent after 3× poll cycles
  - PR is open >45 min from creation to merge (runaway loop)
  - No release published after merge
```

---

## 7. Test-expense analysis

- 1 full run of the current SCEN-018 (scenario-runner smoke test) took
  **21 minutes** end-to-end
- SCEN-018 v2 has ~3x more steps and involves **waiting** for
  polling cycles, agent responses, and multi-round review iteration
- Expected runtime: **45-75 minutes per run**
- This is at the top end of what a single scenario can justify before
  splitting into sub-scenarios
- If the overnight batch includes SCEN-018 v2, it alone consumes 12-18%
  of the total batch time

Consider: run SCEN-018 v2 as a STANDALONE validation BEFORE the
overnight batch, not inside it. If the v2 protocol works standalone,
keep it in the batch. If it's flaky, exclude it from the batch and run
it manually.

---

## 8. Implementation plan

**Step 1 — User approves this TRDD**
- Confirm the agent roster, phase structure, success criteria
- Confirm Option A (keep maintainer-fix for trivial cases) or Option B
  (delete maintainer-fix)
- Confirm the test-repo branch ruleset requirements

**Step 2 — Plugin v2.0.0 work (in separate plugin repo)**
- Clone `git@github.com:Emasoft/ai-maestro-maintainer-agent.git` into
  `/tmp/ai-maestro-maintainer-agent`
- Create `skills/maintainer-review/SKILL.md`
- Update `skills/maintainer-patrol/SKILL.md` for PR tracking + 60s tick
- Rewrite `agents/ai-maestro-maintainer-agent-main-agent.md` for the
  reviewer framing
- Update `CHANGELOG.md` + version bump to `v2.0.0`
- Run `uv run python scripts/publish.py --major`
- Force-update locally: `claude plugin update ai-maestro-maintainer-agent@ai-maestro-plugins`

**Step 3 — Test-repo prep**
- On `scen018-test-repo-alpha`: `gh api -X PUT ... branches/main/rules`
  to install the branch ruleset
- Add `v0.1.0` tag if missing
- Verify `gh api repos/.../rulesets` reflects the new rules
- Repeat for `scen018-test-repo-beta` (only R19.3 uniqueness test,
  no full lifecycle)

**Step 4 — Scenario file rewrite**
- Back up current `SCEN-018_maintainer-lifecycle.scen.md` as
  `SCEN-018_maintainer-lifecycle.scen.v1.md.bak` (temporary, cleaned in
  the same commit)
- Write the v2 scenario inline
- Bump scenario version to "2.0"
- Update frontmatter `required_tools` to use dev-browser only (not
  chrome-devtools MCP)
- Update `data_produced` and `prerequisites` for the new agents and
  branch ruleset

**Step 5 — Smoke-test SCEN-018 v2 standalone**
- Run via the `run-scenario-test` skill (NOT the autonomous cron)
- Expect PARTIAL/PASS verdict with protocol-validation items
- Fix anything blocking
- Re-run until PASS

**Step 6 — Add to overnight batch**
- Update `autonomous-batch-state.json` scenario_list
- Include SCEN-018 v2 only if standalone run passes
- Otherwise exclude it from the batch and keep running it manually

---

## 9. Decisions needed from the user (before Step 2)

1. **Agent roster confirmation**: one CONTRIBUTOR + one MAINTAINER + one
   MANAGER for the full lifecycle, plus an optional second MAINTAINER
   (scen018-maint-beta) kept ONLY to exercise the R19.3 uniqueness test
   without running the full PR cycle on beta. **Confirm: OK?**

2. **maintainer-fix disposition**: Option A (keep as fallback for trivial
   typo fixes) vs Option B (remove entirely — every fix goes through a
   contributor PR). **Recommend A, confirm?**

3. **Branch ruleset content**: the 7 requirements listed in §5. Are all
   of these necessary for the test, or should we skip any to keep the
   scenario tractable? In particular, "require signatures" would force
   every commit to be GPG-signed which complicates the contributor flow.
   **Recommend: drop "require signatures", keep the other 6.**

4. **Seeded PR flaw**: the scenario explicitly instructs the contributor
   to open an initial PR that is INTENTIONALLY flawed (e.g., "fix the
   bug but skip writing the regression test") so the MAINTAINER has
   something to review-and-reject on the first pass. **Confirm this is
   the right way to exercise the review loop, or should we trust
   realistic randomness from the contributor agent?**

5. **Scenario granularity**: does this belong as SCEN-018 v2 (replace
   the existing file), or as a new SCEN-023 (keep v1 as a minimal
   bug-triage smoke test, add v2 as the full lifecycle)? **Recommend:
   rewrite SCEN-018 v2; the v1 no longer reflects the MAINTAINER's real
   role.**

6. **Overnight-batch inclusion**: the scenario is 45-75 min, which is
   significant. Include in the overnight batch, or run standalone only?
   **Recommend: standalone until v2.0.0 of the plugin is proven stable.**

7. **Timeline**: this is ~1-2 days of focused work (plugin rewrite +
   scenario + standalone test + fixing any bugs found). The original
   overnight-batch launch is ON HOLD until SCEN-018 v2 is ready. **OK?**

---

## 10. What this TRDD does NOT address

- Other scenarios' gaps (the user's comment was specifically about
  SCEN-018; other scenarios may have similar insufficiencies but they
  are out of scope here)
- The P1-BUG-1/2/3/4 application bugs surfaced by the SCEN-020 smoke
  test — those still need fixing but are independent of this redesign
- The `scenario-improvement-implementer` agent's worktree workflow —
  still works unchanged, will be used to pick up the Phase 3 proposals
  from SCEN-018 v2 runs after user approval

---

## Appendix A: R19 rules (for reference)

- R19.1: MAINTAINER requires a valid `githubRepo`
- R19.3: MAINTAINER-repo uniqueness — one repo → at most one MAINTAINER
- R19.6: Feature requests accepted only from the authorized gh user
- R19.7: No destructive git operations (force push, branch delete,
  history rewrite)
- R19.8 (NEW, proposed): MAINTAINER MUST NOT merge PRs from unauthorized
  users without MANAGER approval via AMP
- R19.9 (NEW, proposed): MAINTAINER MUST enforce the repo's branch
  ruleset before approving any merge

---

**END OF TRDD — awaiting user approval on the 7 decisions in §9**
