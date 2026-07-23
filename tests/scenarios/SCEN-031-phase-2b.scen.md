---
number: 31
phase: 2b
phase-of: SCEN-031
name: zipsearcher B2 — verify the repo, its protection, its CI, the fork and the clones
version: "1.0"
description: >
  BURST 2b of phase 2. Per Rule 15 this file contains NO waiting. Spawned only once
  `Emasoft/zipsearcher` already exists; it verifies the repo was created from the template with the
  ratified rulesets and a working CI, that the AUTONOMOUS forked and cloned it, and that the
  MAINTAINER cloned it — then exits. Unmet precondition ⇒ BLOCKED, immediately.
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
  - "NOTHING — read-only except its report and screenshots. The repo is created by the FLEET, not here."
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - "`Emasoft/zipsearcher` already exists (the MAINTAINER created it)"
  - The three agents exist and their sessions are live
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2b — is the repo real, protected, and CI-gated?

> **RULE 15 — YOU NEVER WAIT.** Verify what exists now. Never wait for it to appear.

## PRECONDITION — check FIRST, in one cheap call

```bash
gh repo view Emasoft/zipsearcher --json name,isTemplate,createdAt 2>/dev/null
```

- Repo does not exist → return `BLOCKED: Emasoft/zipsearcher does not exist yet`

**Return the BLOCKED string and EXIT.** The orchestrator will re-spawn this burst when the
repo appears. It is not your job to wait for the MAINTAINER.

## TOKEN DISCIPLINE

`gh` probes over snapshots; extract the fact, drop the blob; one screenshot per step.
Never pipe a raw CI log into context — a count plus one line per failure.

---

#### S011: Verify the repo, the branch rulesets, and a CI that actually gates PRs
- **Action:** Confirm through `gh` (and screenshot the UI surface that shows it) that `Emasoft/zipsearcher` was generated **from the template**, carries the ratified baseline rulesets, and has a workflow that runs on PRs.
- **Goal:** A real, branch-protected repo whose CI is wired into the required checks — not a bare repo.
- **Verify:**
  - `gh api repos/Emasoft/zipsearcher/rulesets` shows the baseline pair (`deletion`, `non_fast_forward`, `required_linear_history`; `pull_request` + `required_status_checks`);
  - a workflow exists under `.github/workflows/` and triggers on `pull_request`;
  - the ruleset's required check names that workflow's job.
- **Findings to record (not to fix):** no branch protection, or CI present but NOT referenced by the required checks — both are floor violations, and the second is the sneaky one (a green tick that gates nothing).

#### S012: Verify the AUTONOMOUS forked and cloned, and the MAINTAINER cloned
- **Action:** Confirm the fork exists and both local clones are present in the respective workdirs.
- **Goal:** The dev develops in its own fork and PRs from it; the MAINTAINER has a clone to review from.
- **Verify:** `gh repo list` / `gh api repos/Emasoft/zipsearcher/forks` shows the fork; each workdir holds a clone.
- **RECORD THE FORK'S FULL NAME IN THE REPORT — phase 3 must delete it.** A missing fork name is how a real GitHub artifact gets orphaned after the test.

#### S012z: Write the burst report and EXIT
- **Action:** Write to `reports/scenarios-runner/`: ruleset status, CI wiring status, **the fork's full name**, clone locations, screenshot count.
- **Verify:** the fork name is present and unambiguous. **Do NOT hibernate; do NOT clean up; do NOT wait.** Return your 3-line summary and exit.
