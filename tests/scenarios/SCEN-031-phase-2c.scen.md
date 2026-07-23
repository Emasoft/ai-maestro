---
number: 31
phase: 2c
phase-of: SCEN-031
name: zipsearcher B3 — verify the PR review loop on the PRs that already exist
version: "1.0"
description: >
  BURST 2c of phase 2. Per Rule 15 this file contains NO waiting. Spawned once at least one
  fleet-authored PR exists; it inspects the PRs and reviews that are already there and judges the
  review loop on that evidence, then exits. It is RE-SPAWNABLE — the orchestrator runs it again as
  more PRs land, and each run judges only what exists at spawn time.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - kanban
ui_sections:
  - Agent view -> Terminal section (READ-ONLY observation)
  - Kanban / design board
data_produced:
  - "NOTHING — read-only except its report and screenshots"
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - At least one PR authored by the AUTONOMOUS (not dependabot) exists on `Emasoft/zipsearcher`
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2c — is the review loop genuine, on the PRs that exist right now?

> **RULE 15 — YOU NEVER WAIT.** Judge the PRs present at spawn time. If more land later the
> orchestrator re-spawns you; that is its job, not yours.

## PRECONDITION — check FIRST, in one cheap call

```bash
gh pr list --repo Emasoft/zipsearcher --state all \
  --json number,author,headRefName --jq '[.[] | select(.headRefName | startswith("dependabot") | not)] | length'
```

- Result is `0` → return `BLOCKED: no fleet-authored PR exists yet`

**Return the BLOCKED string and EXIT.** Dependabot PRs do not count — they are the template's
automation, not the fleet's work, and mistaking them for progress is the easiest false PASS here.

## TOKEN DISCIPLINE

Read **one** diff to judge the implementation; never dump whole diffs. `gh pr view --comments`
over screenshots for content; screenshot once per step for the audit trail.

---

#### S013: Verify the PRs carry real zipsearcher code
- **Action:** List the fleet-authored PRs. Read **ONE** diff in full.
- **Goal:** Real implementation is landing, not scaffolding or docs.
- **Verify:** the diff genuinely searches the zip **central directory** without decompressing (the whole point of the tool); tests accompany it; each PR body opens with the R22 self-identification line (all agents share the @Emasoft identity).
- **The trap to avoid:** template stubs and dependency bumps look like activity. `src/entrypoint.py` at its template size with only `docs:`/`deps:` commits on `main` means **zero product code**, however busy the repo looks. State the byte size and the commit kinds in the report.

#### S014: Verify the review loop is genuine, not a rubber stamp
- **Action:** For each fleet-authored PR read the reviews and comments.
- **Goal:** A real request-changes → fix → re-review → merge cycle, merged by the MAINTAINER and never self-merged by the author.
- **Verify:** review comments name **concrete** defects; at least one PR was sent back and improved before merging; the merger is not the author; CI was green at merge. **Board:** the MAINTAINER moves cards through its own columns (`ai_review`/`human_review`→`publish`); an AUTONOMOUS self-advancing into a MAINTAINER column is a finding.
- **Hard FAIL conditions:** a PR merged with a known failing test; an approval with no substantive review; the author merging their own PR.

#### S014z: Write the burst report and EXIT
- **Action:** Write to `reports/scenarios-runner/`: PR count (fleet-authored vs dependabot), whether a genuine send-back occurred, who merged what, the `src/entrypoint.py` size, and the screenshot count.
- **Verify:** the report distinguishes **product code** from **scaffolding/maintenance** explicitly — that distinction is the single most important judgement in this burst. **Do NOT hibernate; do NOT clean up; do NOT wait.** Return your 3-line summary and exit.
