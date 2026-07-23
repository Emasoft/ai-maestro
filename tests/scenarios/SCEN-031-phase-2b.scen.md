---
number: 31
phase: 2b
phase-of: SCEN-031
name: portfolio B2 — verify the THREE repos, their protection, their CI, the forks and the clones
version: "2.0"
description: >
  BURST 2b of phase 2 — three projects / portfolio. Per Rule 15 this file contains NO waiting. Spawned
  only once at least one of the three repos already exists; it verifies, for EACH repo that exists, that
  it was created from the template with the ratified rulesets and a working CI, that its dev forked and
  cloned it, and that its maintainer cloned it — then exits. Unmet precondition (no repo yet) ⇒ BLOCKED,
  immediately. Parallel setup across all three repos is the pass criterion.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - sessions-service
ui_sections:
  - Agent view -> Terminal section (READ-ONLY observation)
  - Agent view -> Messages tab
data_produced:
  - "NOTHING — read-only except its report and screenshots. The repos are created by the FLEET, not here."
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - "At least one of `Emasoft/zipsearcher`, `Emasoft/tarot-reader`, `Emasoft/weather-reporter` already exists (its maintainer created it)"
  - The seven agents exist and their sessions are live
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2b — are the repos real, protected, and CI-gated — FOR EACH PROJECT?

> **RULE 15 — YOU NEVER WAIT.** Verify what exists now, per project. Never wait for a repo to appear.

## THE THREE PROJECTS

| # | Project | What it does | Repo (expected) | Pair |
|---|---|---|---|---|
| P1 | **zipsearcher** | search files by name INSIDE a zip via the central directory, no decompression | `Emasoft/zipsearcher` | dev₁ + maint₁ |
| P2 | **tarot-reader** | draw tarot cards; render each as ASCII / Unicode art | `Emasoft/tarot-reader` | dev₂ + maint₂ |
| P3 | **weather-reporter** | report the local weather when called (a free, no-key source) | `Emasoft/weather-reporter` | dev₃ + maint₃ |

Read the MANAGER-chosen agent names from phase-1's report, mapped to P1/P2/P3. Never hardcode names.

## PRECONDITION — check FIRST, in one cheap call

```bash
for repo in zipsearcher tarot-reader weather-reporter; do
  gh repo view Emasoft/$repo --json name,isTemplate,createdAt 2>/dev/null && echo "^ $repo EXISTS" || echo "$repo: ABSENT"
done
```

- NONE of the three exists → return `BLOCKED: no project repo exists yet`

**Return the BLOCKED string and EXIT.** The orchestrator will re-spawn this burst as repos appear.
It is not your job to wait for any maintainer.

## TOKEN DISCIPLINE

`gh` probes over snapshots; extract the fact, drop the blob; one screenshot per step (not per
project — Rule 10). Never pipe a raw CI log into context — a count plus one line per failure.

---

#### S011: For EACH repo that exists — verify it, its rulesets, and a CI that actually gates PRs
- **Action:** For every one of the three repos that exists, confirm through `gh` (and screenshot the UI surface that shows it) that it was generated **from the template**, carries the ratified baseline rulesets, and has a workflow that runs on PRs.
- **Goal:** Each existing repo is real, branch-protected, and its CI is wired into the required checks — not a bare repo.
- **Verify (per repo):**
  - `gh api repos/Emasoft/<repo>/rulesets` shows the baseline pair (`deletion`, `non_fast_forward`, `required_linear_history`; `pull_request` + `required_status_checks`);
  - a workflow exists under `.github/workflows/` and triggers on `pull_request`;
  - the ruleset's required check names that workflow's job.
- **Record which of the three repos are set up and when — this is the concurrency evidence.**
- **Findings to record (not to fix), per repo:** no branch protection, or CI present but NOT referenced by the required checks — both are floor violations, and the second is the sneaky one (a green tick that gates nothing).

#### S012: For EACH project — verify its dev forked+cloned, and its maintainer cloned
- **Action:** For every repo that exists, confirm the fork exists and both local clones are present in the respective workdirs.
- **Goal:** Each dev develops in its own fork and PRs from it; each maintainer has a clone to review from.
- **Verify:** `gh repo list` / `gh api repos/Emasoft/<repo>/forks` shows the fork; each workdir holds a clone.
- **RECORD ALL THREE FORK FULL NAMES IN THE REPORT (as they become known) — phase 3 must delete every one.** A missing fork name is how a real GitHub artifact gets orphaned after the test.

#### S012z: Write the burst report + Rule-11 individual proposals, then EXIT
- **Action:** Write to `reports/scenarios-runner/`: ruleset status per repo, CI wiring status per repo, **the fork full names collected so far**, clone locations, and the screenshot count. Then, for every finding this burst surfaced, author it as its OWN `design/proposals/TRDD-*.md` file (`column: proposal`, `labels: [scenario-improvement, scen-031, phase-2b]`). **ONE finding = ONE file. NEVER a monolithic report of proposals.**
- **Verify:** every fork name found is present and unambiguous; `grep -l 'phase-2b' design/proposals/*.md` lists a matching TRDD per finding. **Do NOT hibernate; do NOT clean up; do NOT wait.** Return your 3-line summary and exit.
