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

---

## 11. User feedback 2026-04-15 — refined design (supersedes §3, §6, §9.1-2)

> "the second maintainer is only to verify the ability of multiple
> maintainers to handle simultaneous events in different github repos.
> So in the first part of the scenario two issues must be opened by the
> AUTONOMOUS agent, one in each repo, but one will report a bug and the
> maintainer will fix it by itself, while the other is announce of a PR
> to solve a shortcoming, so we can evaluate if the agent correctly let
> the AUTONOMOUS agent contribute to the project instead of saying 'no,
> I will take care of it'. The things of course must be approved by the
> MANAGER, but both role-plugin main agents should be instructed to
> welcome contributions instead of refusing them."

This re-frames the scenario to exercise **two code paths in parallel**
instead of one sequential path. Both MAINTAINERs are active throughout
the run. The test has TWO independent success criteria (one per repo)
and one shared criterion (MANAGER oversight).

### 11.1 Revised agent roster

| Agent | Title | Plugin | Repo | Role |
|---|---|---|---|---|
| `scen018-manager` | MANAGER | `ai-maestro-assistant-manager-agent` | — | Supervises both MAINTAINERs concurrently; receives AMP status from both; aggregates final report to user |
| `scen018-maint-alpha` | MAINTAINER | `ai-maestro-maintainer-agent` | `Emasoft/scen018-test-repo-alpha` | **Direct-fix path** — handles a bug via `maintainer-fix` (clone → branch → fix → test → publish → close) |
| `scen018-maint-beta` | MAINTAINER | `ai-maestro-maintainer-agent` | `Emasoft/scen018-test-repo-beta` | **PR-review path** — welcomes the contributor's proposal, waits for the PR, reviews it, requests changes, re-reviews, approves, merges, publishes release |
| `scen018-contrib` | AUTONOMOUS | **base `ai-maestro-plugin` only** (no role-plugin) | — | Opens issue on BOTH repos (one bug report, one PR proposal), then makes an actual PR against beta in response to MAINTAINER beta's welcome. **NOT `ai-maestro-programmer-agent`** — that is a team role-plugin whose `compatible-titles` is restricted to MEMBER, and whose persona + skills are designed for team work under ORCHESTRATOR direction (programmers fork the repo and never manage the original; only the orchestrator and exceptionally the chief-of-staff manage the original repo in a team). An AUTONOMOUS contributor obeys completely different rules: it is driven by direct user prompts, pushes branches to the original repo via write access (no fork needed — same `gh` identity as Emasoft), and opens same-repo PRs. It has no persistent persona — behaviors are driven step-by-step by the scenario's user prompts, relying on Claude Code's native git+gh knowledge. |

Four agents total (vs. three in §3). Both MAINTAINERs stay online for
the full lifecycle, not just for the R19.3 uniqueness test. R19.3 is
still verified in a separate step (attempting to create a third
MAINTAINER on alpha), but the beta MAINTAINER is no longer
decoration — it's the PR-review path.

### 11.2 Two parallel issues

Phase 4 is now parallel:

- **Alpha issue — BUG**: Contributor opens an issue on
  `scen018-test-repo-alpha` describing a real bug in `src/buggy.py`
  (e.g. `divide(-10, 2) returns 5 instead of -5`). The issue is a pure
  bug report — no mention of the contributor wanting to fix it. This
  is the signal for MAINTAINER alpha to run `maintainer-fix` and handle
  it directly.

- **Beta issue — PR PROPOSAL**: Contributor opens an issue on
  `scen018-test-repo-beta` announcing: "I noticed
  tests/test_other.py::test_multiply_negatives fails. I'd like to
  submit a PR fixing it — may I proceed?" This is the signal for
  MAINTAINER beta to WELCOME the contribution (not to handle it
  itself), and to wait for the contributor's PR.

Both issues are opened in the same phase (the contributor runs both
`gh issue create` calls back-to-back). From that point, the two
MAINTAINERs run independently on their own polling cycles.

### 11.3 Two independent paths

**Alpha (direct-fix path)**:
1. Patrol detects issue → triage classifies as bug
2. `maintainer-fix` runs: clone → fix branch → edit → test → commit → push → close
3. MAINTAINER alpha reports completion to MANAGER via AMP
4. MANAGER acknowledges via AMP

This is the CURRENT MAINTAINER behavior (v1.0.2). No plugin changes
required for this path beyond the persona's "welcome contributions"
language (see §11.4).

**Beta (PR-review path)**:
1. Patrol detects issue → triage reads the PR proposal
2. Triage classifies as "contribution proposal" — a NEW classification
   between "bug" and "feature request"
3. MAINTAINER beta comments on the issue: "Yes, please go ahead —
   please reference this issue in your PR and follow our contribution
   guide. I'll review your PR when it's open."
4. Contributor (prompted by user/MANAGER) creates a fix branch, pushes,
   opens the PR
5. Patrol detects the new PR → dispatches `maintainer-review`
6. MAINTAINER beta reviews the diff, enforces the branch ruleset,
   posts inline comments, requests changes OR approves
7. If CHANGES_REQUESTED: contributor iterates, pushes a new version,
   MAINTAINER beta re-reviews
8. When clean: MAINTAINER beta approves + merges + publishes release
9. MAINTAINER beta reports completion to MANAGER via AMP
10. MANAGER acknowledges via AMP

The PR-review path is the NEW behavior (v2.0.0) and requires the new
`maintainer-review` skill + updated `maintainer-patrol` with PR
tracking.

### 11.4 "Welcome contributions" persona language

The MAINTAINER plugin's main agent persona currently frames the agent
as a solo fixer ("keep your assigned repository healthy by triaging
and fixing issues"). The user explicitly requires the opposite stance:

> "both role-plugin main agents should be instructed to welcome
> contributions instead of refusing them"

Updated persona language (to be added under "Core Mission"):

```
## Working with contributors

You are NOT alone. Other agents — MEMBERs on teams, AUTONOMOUS helpers,
or human contributors — may offer to fix bugs in your repo. When
someone offers help:

  - ALWAYS accept genuine contribution offers. Respond on the issue
    with "Yes please, go ahead — please reference this issue in your
    PR and follow the contribution guide."
  - NEVER say "no, I will take care of it" when a contributor offers
    to submit a PR. Accept the contribution, then review it carefully
    when the PR lands.
  - Your job is to be a GATEKEEPER, not a lone wolf. A PR from a
    contributor is a GIFT — review it honestly, but welcome it.
  - If the contributor's PR is flawed, request changes politely with
    specific inline comments. If the contributor fixes the issues,
    re-review and approve. If they abandon the PR or cannot fix the
    issues after 2-3 review rounds, escalate to MANAGER via AMP before
    closing the PR.

The only exception: if no contributor has offered help AND the issue
is a verified bug, you may run `maintainer-fix` yourself to handle it
directly. This is the fallback, not the default.
```

This language update needs to be part of the plugin v2.0.0 commit.

### 11.5 "Contribution proposal" triage classification

`maintainer-triage` currently has 2 pass-through classifications
(bug, feature-request) and 2 reject classifications (invalid,
duplicate). Add a THIRD pass-through:

```
## Contribution proposal

Signal: the issue body says "I'd like to submit a PR", "I can fix this",
"Would you accept a PR for …", or similar contributor-offering language.

Action:
  1. Check R19.6 — is the author authorized? Bug fixes from ANY user
     are welcome (same as regular bug reports). Feature-adding PRs are
     still gated to the authorized user.
  2. If authorized OR the proposal is for a bug fix:
     - Comment on the issue: "Yes please, go ahead — please reference
       this issue in your PR and follow our contribution guide. I'll
       review your PR when it's open."
     - Label the issue with `contribution-accepted`
     - Record in the ledger: "waiting for PR from <author>"
     - Return control to patrol — do NOT dispatch maintainer-fix
  3. If NOT authorized AND the proposal adds a feature:
     - Comment on the issue: "Thank you for offering! Unfortunately
       feature additions are reserved for the repo owner. Feel free
       to submit a bug-fix PR instead."
     - Return control to patrol
```

### 11.6 MANAGER oversight (refined)

MANAGER is NOT in a team with the MAINTAINERs (they're AUTONOMOUS), so
oversight is via AMP messaging. Flow:

- At scenario start, MANAGER is prompted by the user: "Monitor
  scen018-maint-alpha and scen018-maint-beta. Acknowledge their AMP
  status updates. If either agent stops making progress for >10
  minutes, send them a steering message."
- Both MAINTAINERs send AMP updates to MANAGER at each major step:
  - "detected new issue #N"
  - "triage classified as [bug|contribution-proposal]"
  - "starting [fix|review]"
  - "completed [fix|review] — [merged|pushed commit]"
  - "released vX.Y.Z"
- MANAGER acknowledges each update via AMP reply
- At the end of the run, MANAGER sends ONE aggregated message to the
  USER's inbox summarizing both paths

The scenario verifies:
- At least 5 AMP messages from MAINTAINER alpha to MANAGER (issue
  detected, triaged, fix started, fix completed, release published)
- At least 7 AMP messages from MAINTAINER beta to MANAGER (issue
  detected, triaged, proposal welcomed, PR detected, review posted,
  PR merged, release published)
- At least 2 acknowledgement messages from MANAGER to each MAINTAINER
- 1 final aggregated report MANAGER → user

### 11.7 Phase structure (revised for parallelism)

```
Phase 0: SAFE-SETUP (unchanged)

Phase 1: Create the agents (all 4 in sequence)
  - scen018-manager (if not already present)
  - scen018-maint-alpha (MAINTAINER + repo alpha)
  - scen018-maint-beta (MAINTAINER + repo beta)
  - scen018-contrib (AUTONOMOUS + programmer plugin)

Phase 2: R19.3 uniqueness test
  - Attempt third MAINTAINER on alpha → rejected (unchanged)

Phase 3: User primes MANAGER
  - User sends AMP to scen018-manager: "Monitor scen018-maint-alpha
    and scen018-maint-beta. Both are processing real contributions
    concurrently. Acknowledge their status updates and intervene if
    either one refuses a contribution, skips the review, or stops
    making progress."
  - Verify MANAGER acknowledged

Phase 4: Contributor opens TWO parallel issues
  - User switches to scen018-contrib terminal
  - User sends prompt: "Open two GitHub issues:
      1. On Emasoft/scen018-test-repo-alpha: title '[BUG] divide(-10, 2)
         returns wrong result'. Body: 'src/buggy.py divide returns 5
         for negatives instead of -5. Please fix.' (pure bug report)
      2. On Emasoft/scen018-test-repo-beta: title '[PR PROPOSAL] fix
         test_multiply_negatives'. Body: 'I noticed the failing test
         in tests/test_other.py and I would like to submit a PR
         fixing it. May I proceed?' (contribution proposal)
      Open both back-to-back."
  - Verify both issues visible via `gh issue list`

Phase 5: Alpha direct-fix path
  - Wait for patrol (60s tick) to detect alpha issue
  - Wait for triage → bug classification
  - Wait for maintainer-fix to complete (clone → fix → test → publish)
  - Verify the failing test now passes on main
  - Verify the issue is closed with a commit link
  - Verify MAINTAINER alpha sent AMP updates to MANAGER
  - Screenshot: GitHub issue view showing closed + commit

Phase 6: Beta welcome path (runs IN PARALLEL with Phase 5)
  - Wait for patrol to detect beta issue
  - Wait for triage → contribution-proposal classification
  - Verify MAINTAINER beta commented on the issue WELCOMING the
    contribution (not refusing)
  - Verify the issue has label `contribution-accepted`
  - Verify the ledger records "waiting for PR from scen018-contrib"
  - Verify MAINTAINER beta sent AMP updates to MANAGER
  - Screenshot: the beta issue view with the welcome comment

Phase 7: Contributor makes the actual PR
  - Switch to scen018-contrib terminal
  - User sends prompt: "MAINTAINER beta welcomed your contribution.
    Please:
      1. Clone Emasoft/scen018-test-repo-beta locally into the working
         directory
      2. Create a fix branch: fix/test-multiply-negatives
      3. Fix the bug in src/other.py (find the multiply function
         that breaks on negatives)
      4. Add a regression test that covers negatives
      5. Push the branch and open a PR referencing the proposal issue
      Follow GitHub PR best practices."
  - Wait for contributor to push
  - Verify `gh pr list --repo beta` shows the PR

Phase 8: MAINTAINER beta review cycle
  - Wait for patrol to detect the new PR
  - Wait for maintainer-review to run
  - Verify a CHANGES_REQUESTED review is posted (if the first pass is
    flawed — see decision 4 in §9, which is still open)
  - OR verify an APPROVED review is posted (if clean first pass)
  - If CHANGES_REQUESTED: loop to iterate up to 3 rounds max
  - Verify each review posts inline comments + overall body

Phase 9: Merge + release + close
  - Wait for MAINTAINER beta to merge (only after APPROVED)
  - Verify `gh pr view --json state` == MERGED
  - Verify branch ruleset was enforced (no force, no bypass)
  - Wait for release creation
  - Verify `gh release list` has the new vX.Y.Z
  - Verify beta issue is closed with a link to the release tag
  - Verify MAINTAINER beta sent AMP updates to MANAGER for each step

Phase 10: MANAGER aggregated report
  - Open USER's inbox on the dashboard
  - Verify MANAGER sent ONE aggregated message summarizing:
    - Alpha: bug X detected → fix committed → released as vA.B.C
    - Beta: contribution offer → welcomed → PR created → reviewed (N
      rounds) → merged → released as vX.Y.Z
    - MANAGER's overall verdict: "both MAINTAINERs handled their paths
      correctly, no intervention needed" (or intervention details)

Phase 11: CLEANUP (unchanged — delete all 4 agents, close issues,
          delete branches, restore backups, post-test screenshot)

Success criteria (revised):
  - Alpha: bug fixed via maintainer-fix, issue closed, release published
  - Beta: contribution proposal WELCOMED (not refused), PR merged by
    MAINTAINER, release published, branch ruleset enforced
  - Both MAINTAINERs sent the full AMP update sequence to MANAGER
  - MANAGER acknowledged and sent a final aggregated user report
  - No destructive git ops on either repo (R19.7)
  - R19.3 rejected the duplicate MAINTAINER attempt
  - R19.6 still enforced for unauthorized FEATURE proposals (bug
    proposals welcome from anyone)
  - Cleanup leaves host indistinguishable from pre-test state

FAILURE MODES (any → scenario FAIL):
  - MAINTAINER beta refuses the contribution ("no, I will take care
    of it") — this is the primary thing being tested
  - MAINTAINER beta runs maintainer-fix instead of waiting for the
    contributor's PR
  - MAINTAINER alpha waits for a contributor PR that never comes
    (alpha's issue was a pure bug report, no contribution offer)
  - MAINTAINER alpha forwards the issue to MAINTAINER beta or
    vice-versa (wrong repo handling)
  - Either MAINTAINER merges without enforcing the branch ruleset
  - MANAGER fails to detect a slacking agent
  - Alpha path takes >15 min, beta path takes >45 min
```

### 11.8 Decision updates (§9 items revised or answered)

**Decision 1 — agent roster**: **RESOLVED** by §11.1. Four agents:
MANAGER + 2 MAINTAINERs (both active) + 1 contributor.

**Decision 2 — maintainer-fix disposition**: **RESOLVED as Option A**.
Alpha's direct-fix path exercises `maintainer-fix`. Beta's PR-review
path exercises `maintainer-review`. Both skills coexist.

**Decision 5 — SCEN-018 v2 vs new SCEN-023**: **RESOLVED** — rewrite
SCEN-018 v2. The refined design tests both paths, so v1's single-path
test is now a strict subset.

**Decision 3 — branch ruleset**: still pending. Recommend: PR required,
1 approving review, dismiss stale on push, linear history, conversation
resolution, no force-push, no delete. Skip "require signatures".

**Decision 4 — seeded PR flaw**: still pending. With the refined
design, only the BETA path runs through review. Should the contributor's
first PR on beta be intentionally flawed (to exercise the review-loop),
or should we trust the contributor agent's realistic variance and
accept either outcome (clean first pass OR request-changes loop)?
Recommend: seed a deliberate flaw (e.g., "skip writing the regression
test initially") so the review loop is guaranteed to run at least once.

**Decision 6 — overnight batch inclusion**: still pending. With parallel
paths, the run time might actually be slightly LESS than 45-75 min
(since alpha and beta run concurrently), maybe 35-60 min. Still large
but more tractable. Recommend: include in batch ONLY after a
standalone run passes.

**Decision 7 — timeline**: still pending. Slightly more work than
the §9 version because the plugin needs to handle TWO classification
paths and the scenario has ~50 steps instead of ~40. Estimate 1.5-2
days of focused work.

### 11.9 Remaining questions

1. **Decision 3 — branch ruleset contents** (see §5 for the full list)
2. **Decision 4 — seeded flaw** on beta's first PR (recommend yes)
3. **Decision 6 — overnight batch inclusion** (recommend standalone only)
4. **Decision 7 — timeline** (estimated 1.5-2 days)
5. **NEW: "welcome contributions" language scope** — the user wrote
   "both role-plugin main agents should be instructed to welcome
   contributions". I'm interpreting this as "update the MAINTAINER
   plugin's main agent" (since both alpha and beta share the same
   plugin). Should the `ai-maestro-programmer-agent` plugin ALSO get
   language nudging the contributor to offer PRs when working on
   external repos? Or is that overkill since the contributor is driven
   by explicit user prompts in the scenario?
6. **NEW: contribution-proposal triage class** — add it as a formal
   classification in `maintainer-triage` (see §11.5), OR keep it
   informal and rely on the main agent persona to recognize the
   pattern? Recommend formal classification for robustness.

---

## 12. Governance / comm-graph verification (user feedback 2026-04-15)

> "Also the governance rules must be verified. The MANAGER, the
> MAINTAINERS and the AUTONOMOUS agents, being outside of any team, can
> freely message each others. no restrictions."

### 12.1 Current graph state — no code change required

`lib/communication-graph.ts` already models MANAGER, MAINTAINER, and
AUTONOMOUS as a fully-connected clique with self-loops:

```typescript
'manager':        new Set([..., 'autonomous', 'maintainer']),
'autonomous':     new Set(['manager', ..., 'autonomous', 'maintainer']),
'maintainer':     new Set(['manager', ..., 'autonomous', 'maintainer']),
```

All 9 required edges are present:

| Sender → Recipient | Allowed? |
|---|---|
| MANAGER → MANAGER | ✅ |
| MANAGER → MAINTAINER | ✅ |
| MANAGER → AUTONOMOUS | ✅ |
| MAINTAINER → MANAGER | ✅ |
| MAINTAINER → MAINTAINER | ✅ |
| MAINTAINER → AUTONOMOUS | ✅ |
| AUTONOMOUS → MANAGER | ✅ |
| AUTONOMOUS → MAINTAINER | ✅ |
| AUTONOMOUS → AUTONOMOUS | ✅ |

The API enforcement layer (`validateMessageRoute` called from
AMP routing) already gates all inbound messages against this graph
per CLAUDE.md's three-layer enforcement doc.

### 12.2 SCEN-018 v2 AMP verification — new Phase 2.5 and assertions

Add a dedicated phase between "R19.3 uniqueness" and "Prime MANAGER"
to verify every edge in the clique works end-to-end:

```
Phase 2.5: Governance comm-graph smoke checks (9 sends)

Using the user's authenticated terminal, drive each agent's terminal
to send ONE test AMP message per edge — 9 messages total — before the
real work starts. For each message, verify it lands in the recipient's
inbox (not rejected with 403).

  - S0xx: scen018-manager → scen018-manager (self)
  - S0xx: scen018-manager → scen018-maint-alpha
  - S0xx: scen018-manager → scen018-contrib
  - S0xx: scen018-maint-alpha → scen018-manager
  - S0xx: scen018-maint-alpha → scen018-maint-beta
  - S0xx: scen018-maint-alpha → scen018-contrib
  - S0xx: scen018-contrib → scen018-manager
  - S0xx: scen018-contrib → scen018-maint-alpha
  - S0xx: scen018-contrib → scen018-contrib (self — if allowed)

Each send uses amp-send.sh with a unique subject containing the edge
name (e.g. "governance-smoke: manager->maintainer-alpha") so it's
trivially verifiable in the recipient's inbox via amp-inbox.sh.

After all 9, read each agent's inbox and verify the expected messages
arrived. A missing message or a 403 rejection is a FAIL (the comm
graph code is broken or the AMP routing is mis-wired).

Cleanup: each recipient marks the smoke-check messages as read and
deletes them before Phase 4 starts (so the real work's AMP traffic
is easy to distinguish in the report).
```

### 12.3 Assertions during the real work phases

Beyond Phase 2.5, the real-work phases (4-10) also implicitly
verify the comm graph by having both MAINTAINERs send AMP status
updates to MANAGER and AMP coordination messages to the contributor.
These are already in the phase list from §11.7; just noting that
each of those AMP sends is also a governance-graph assertion and
should be recorded as such in the report.

Specifically:

  - Phase 6 detection → MAINTAINER sends "detected issue" to MANAGER
    = MAINTAINER→MANAGER edge
  - Phase 6 welcome → MAINTAINER beta sends "proceed with PR" to
    contributor = MAINTAINER→AUTONOMOUS edge
  - Phase 7 contributor work → contributor sends "PR ready for review"
    to MAINTAINER beta = AUTONOMOUS→MAINTAINER edge
  - Phase 7-9 MANAGER steering → MANAGER sends steering messages to
    either agent = MANAGER→MAINTAINER or MANAGER→AUTONOMOUS edge
  - Phase 11 aggregated report → MANAGER → user (out-of-graph, always
    allowed)

### 12.4 FAIL modes added

  - Any of the 9 Phase 2.5 sends returns 403 from the API
  - Any MAINTAINER → AUTONOMOUS message during the real work is
    rejected by the server
  - Any AUTONOMOUS → MAINTAINER message during the real work is
    rejected by the server

---

---

## 13. Team-role vs no-team-role plugin distinction (user feedback 2026-04-15)

> "remember to not mixup role-plugins for team titles, with role-plugins
> for no-team titles. The programmer role-plugin is a team role-agent,
> so it obeys to completely different rules. He can fork the repo, but
> in a team only the orchestrator (and the chief of staff, exceptionally)
> can manage the original repo. So the AUTONOMOUS agent is a very
> different thing. But in both cases they appear to github only as the
> same gh user authenticated (Emasoft in my case, but can be any github
> user)."

### 13.1 Two classes of role-plugins

| Class | Titles | Plugins | GitHub workflow |
|---|---|---|---|
| **Team role-plugins** | MANAGER, CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER | `ai-maestro-assistant-manager-agent`, `ai-maestro-chief-of-staff`, `ai-maestro-orchestrator-agent`, `ai-maestro-architect-agent`, `ai-maestro-integrator-agent`, `ai-maestro-programmer-agent` | MEMBERs fork the repo. Only ORCHESTRATOR (and exceptionally COS) manages the original repo. Commits go through orchestrator-gated workflow. |
| **No-team role-plugins** | MAINTAINER, AUTONOMOUS | `ai-maestro-maintainer-agent`, (AUTONOMOUS has no dedicated plugin — uses base `ai-maestro-plugin` only) | MAINTAINER: bound to a repo, directly manages it (with the gatekeeper role in v2.0.0). AUTONOMOUS: driven by direct user prompts, pushes branches to any repo the host `gh` user has write access to, opens same-repo PRs. No fork required. No ORCHESTRATOR in the loop. |

### 13.2 Why `scen018-contrib` MUST NOT use `ai-maestro-programmer-agent`

- `ai-maestro-programmer-agent` has `compatible-titles = ["MEMBER"]` in
  its `.agent.toml`. ChangeTitle Gate 9/16 would reject assigning it
  to an AUTONOMOUS agent.
- Even if the compatibility was relaxed, the programmer persona
  contains team-workflow language ("wait for ORCHESTRATOR to assign
  you a task", "always fork the target repo", "push to your fork, not
  the original") which contradicts the AUTONOMOUS contributor's
  actual behavior in this scenario.
- The programmer plugin bundles skills designed for in-team
  coordination, not for direct external-repo contribution.

### 13.3 What `scen018-contrib` DOES use

- Title: AUTONOMOUS
- Role-plugin: **none**
- Base plugin: `ai-maestro-plugin` (R17 core, required for every agent)
- Behavior: driven entirely by user prompts during the scenario — the
  scenario's Phase 4 and Phase 7 prompts tell the contributor exactly
  what to do (open issue, clone repo, create branch, fix file, push,
  open PR, respond to review, iterate).
- GitHub workflow: uses the host's `gh` auth (same identity as every
  other agent — Emasoft), pushes a branch directly to the ORIGINAL
  target repo (no fork — same-repo PR), opens a PR back to main.

### 13.4 Identity model (clarified)

Per the user: "in both cases they appear to github only as the same gh
user authenticated". Confirmed:

- Every agent on the host authenticates via a single shared `gh` CLI
  identity (in this test: Emasoft).
- From GitHub's point of view, there is ONE user performing every
  action on both test repos: the contributor's PR author, the
  MAINTAINER's review comments, MAINTAINER's merge commit, every
  `git push`, every `gh` API call.
- The role distinction (AUTONOMOUS contributor vs MAINTAINER reviewer)
  exists only INSIDE AI Maestro — not inside GitHub.
- This is why option B (workflow-enforced approval, §11.9/chat history)
  is the right choice: GitHub can't distinguish the agents; only the
  agent plugin code can.

### 13.5 Contributor tool-allowlist (confirms Option B)

Since the contributor shares the Emasoft identity, the ONLY thing
preventing it from self-merging its own PR is its tool allowlist.
The contributor runs inside a bare Claude Code session with
`ai-maestro-plugin` as the only plugin (no role-plugin). That plugin
does NOT expose `gh pr merge` as a permitted command — the user's
prompts in Phase 4 and Phase 7 explicitly instruct the contributor to
"open the PR and wait for MAINTAINER review; never merge". Any
attempt by the contributor to invoke `gh pr merge` without explicit
user permission would be a Rule 4 FIX-AS-YOU-GO bug in the plugin.

The scenario's assertions (§11.7 Phase 9) verify the merge commit's
git metadata matches the MAINTAINER agent's terminal session, not the
contributor's.

---

**END OF TRDD — awaiting user answers on the 4 still-open decisions
from §11.9 (branch ruleset details confirmed minimal per §13.5,
seeded flaw, overnight batch inclusion, timeline). Comm-graph (§12)
and contributor-plugin correction (§13) are resolved; no further
blockers for Step 2 plugin implementation.**
