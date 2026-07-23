---
number: 31
phase: 2c
phase-of: SCEN-031
name: portfolio B3 — verify the PR review loop, on the PRs that already exist, ACROSS ALL THREE repos
version: "2.0"
description: >
  BURST 2c of phase 2 — three projects / portfolio. Per Rule 15 this file contains NO waiting. Spawned
  once at least one fleet-authored PR exists on ANY of the three repos; it inspects the PRs and reviews
  already there, per repo, and judges each review loop on that evidence, then exits. It is RE-SPAWNABLE —
  the orchestrator runs it again as more PRs land on any project, and each run judges only what exists at
  spawn time. Parallel progress across all three review loops is the pass criterion.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - kanban
ui_sections:
  - Agent view -> Terminal section (READ-ONLY observation)
  - Kanban / design board (one per project)
data_produced:
  - "NOTHING — read-only except its report and screenshots"
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - "At least one PR authored by a dev (not dependabot) exists on ANY of `Emasoft/zipsearcher`, `Emasoft/tarot-reader`, `Emasoft/weather-reporter`"
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2c — is the review loop genuine, on the PRs that exist right now, FOR EACH PROJECT?

> **RULE 15 — YOU NEVER WAIT.** Judge the PRs present at spawn time, per repo. If more land later
> the orchestrator re-spawns you; that is its job, not yours.

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
  n=$(gh pr list --repo Emasoft/$repo --state all \
    --json number,author,headRefName --jq '[.[] | select(.headRefName | startswith("dependabot") | not)] | length' 2>/dev/null || echo 0)
  echo "$repo: $n fleet-authored PRs"
done
```

- ALL three show `0` (or the repo doesn't exist) → return `BLOCKED: no fleet-authored PR exists yet`

**Return the BLOCKED string and EXIT.** Dependabot PRs do not count on any repo — they are the
template's automation, not the fleet's work, and mistaking them for progress is the easiest false
PASS here.

## TOKEN DISCIPLINE

Read **one** diff per repo to judge the implementation; never dump whole diffs. `gh pr view
--comments` over screenshots for content; screenshot once per step (not per repo — Rule 10).

---

#### S013: For EACH repo with fleet PRs — verify they carry real product code
- **Action:** List the fleet-authored PRs per repo. Read **ONE** diff in full per repo that has any.
- **Goal:** Real implementation is landing, not scaffolding or docs — independently, per project.
- **Verify (per repo):** the diff genuinely does the project's job — zipsearcher searches the zip **central directory** without decompressing; tarot-reader renders a drawn card as ASCII/Unicode art; weather-reporter fetches and prints local weather from a free, no-key source. Tests accompany it; each PR body opens with the R22 self-identification line (all agents share the @Emasoft identity).
- **The trap to avoid:** template stubs and dependency bumps look like activity. A key source file at its template size with only `docs:`/`deps:` commits on `main` means **zero product code for that project**, however busy the repo looks. State each repo's key source-file size and the commit kinds in the report.

#### S014: For EACH repo — verify the review loop is genuine, not a rubber stamp
- **Action:** For each fleet-authored PR (per repo) read the reviews and comments.
- **Goal:** A real request-changes → fix → re-review → merge cycle, merged by that project's maintainer and never self-merged by the author.
- **Verify (per repo):** review comments name **concrete** defects; at least one PR was sent back and improved before merging; the merger is not the author; CI was green at merge. **Board:** the maintainer moves cards through its own columns (`ai_review`/`human_review`→`publish`); a dev self-advancing into a maintainer column is a finding — per project.
- **Hard FAIL conditions (per repo):** a PR merged with a known failing test; an approval with no substantive review; the author merging their own PR.
- **PORTFOLIO check:** record which of the three projects have an active, advancing review loop versus none — a MANAGER that lets one project's PRs pile up unreviewed while another races ahead is a concurrency finding.

#### S014z: Write the burst report + Rule-11 individual proposals, then EXIT
- **Action:** Write to `reports/scenarios-runner/`: per-repo PR count (fleet-authored vs dependabot), whether a genuine send-back occurred, who merged what, each key source-file size, and the screenshot count. Then, for every finding, author it as its OWN `design/proposals/TRDD-*.md` file (`column: proposal`, `labels: [scenario-improvement, scen-031, phase-2c]`). **ONE finding = ONE file. NEVER a monolithic report of proposals.**
- **Verify:** the report distinguishes **product code** from **scaffolding/maintenance** explicitly, per project — that distinction is the single most important judgement in this burst. `grep -l 'phase-2c' design/proposals/*.md` lists a matching TRDD per finding. **Do NOT hibernate; do NOT clean up; do NOT wait.** Return your 3-line summary and exit.
