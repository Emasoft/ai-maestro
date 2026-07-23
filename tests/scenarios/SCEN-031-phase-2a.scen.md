---
number: 31
phase: 2a
phase-of: SCEN-031
name: portfolio B1 — verify the THREE dispatches and the THREE TRDD approval loops ALREADY happened
version: "2.0"
description: >
  BURST 2a of phase 2 — three projects / portfolio. Per Rule 15 this file contains NO waiting. It is
  spawned by the orchestrator only once at least one project's dispatch has already occurred, and it
  VERIFIES that fact through the UI for EACH of the three projects, screenshots it, and exits. If NO
  project's precondition is met it returns BLOCKED immediately — it does not wait for any dispatch to
  arrive. Parallelism (all three advancing, none starved) is the pass criterion, not just correctness.
client: claude
interhosts: false
device: desktop
subsystems:
  - agent-messaging
  - governance
  - kanban
ui_sections:
  - Agent view -> Messages tab (AMP inbox/sent between each project's dev/maint pair)
  - Agent view -> TRDD / task surface
  - Kanban / design board (one per project)
data_produced:
  - "NOTHING — this burst is read-only except for its report and screenshots"
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - The seven agents (MANAGER + three dev/maint pairs) exist and their sessions are live
  - "At least one of the three repos' `main` already carries its requirements (the NPT dispatch precondition)"
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2a — did the governed handoff actually happen, FOR EACH PROJECT?

> **RULE 15 — YOU NEVER WAIT.** Every step below verifies something that has **already
> happened**. If it has not happened for a given project, that is a finding to report, never a
> thing to wait for.

## THE THREE PROJECTS

| # | Project | What it does | Repo (expected) | Pair |
|---|---|---|---|---|
| P1 | **zipsearcher** | search files by name INSIDE a zip via the central directory, no decompression | `Emasoft/zipsearcher` | dev₁ + maint₁ |
| P2 | **tarot-reader** | draw tarot cards; render each as ASCII / Unicode art | `Emasoft/tarot-reader` | dev₂ + maint₂ |
| P3 | **weather-reporter** | report the local weather when called (a free, no-key source) | `Emasoft/weather-reporter` | dev₃ + maint₃ |

The MANAGER chose the actual agent names; read them from phase-1's report (mapped to P1/P2/P3).
**Never hardcode agent names in this file** — resolve them from the phase-1 report each run.

## PRECONDITION — check FIRST, in one cheap call

```bash
for repo in zipsearcher tarot-reader weather-reporter; do
  echo "$repo: $(gh api repos/Emasoft/$repo/commits --jq '.[0].sha[0:7]' 2>/dev/null || echo ABSENT)"
done
tmux list-sessions | grep -cE 'scen031|zipsearcher|tarot|weather'   # expect up to 7
```

- Fleet not awake → return `BLOCKED: fleet not awake`
- NONE of the three repos' `main` carries requirements → return `BLOCKED: no project has its NPT precondition satisfied on main`

**Return the BLOCKED string and EXIT. Do not wait. Do not wake anything.**

## TOKEN DISCIPLINE

Cheapest probe that answers the question; extract the fact and drop the blob; a snapshot
only to locate an element you are about to click; **one screenshot per step** (not per project —
Rule 10). No `sleep`, no poll loop — if you find yourself about to wait, you are in the wrong file.

---

#### S009: Verify the MANAGER dispatched EACH dev **as a message**
- **Action:** For EACH of the three projects whose precondition is met, open that project's MANAGER↔dev Messages tabs (read-only) and read the handoff.
- **Goal:** Each dispatch exists as an AMP message carrying that project's requirements TRDD, and that dev read it from its inbox.
- **Verify:** for each project, an AMP message `from: <manager> to: <that project's dev>` referencing its TRDD; the dev's transcript shows an inbox READ before it began. A directive typed into a dev's pane with no inbox read is injection — **hard FAIL under R42**, per project.
- **Record which of the three dispatches exist and their timestamps — this is the concurrency evidence.** A dev told to build while its own repo's requirements sit in an unmerged PR is that project's NPT deadlock (TRDD-BYCN5PB7) — record it per project; it is the MANAGER's defect, never the dev's.
- **If a project's dispatch is absent:** record `NO DISPATCH (P<n>)` with evidence and continue to S010. Do NOT wait for one, and do NOT tell anyone to send one.

#### S010: Verify the TRDD approval loop ran for EACH project
- **Action:** For each project with a dispatch, read the implementation TRDDs its dev authored and the MANAGER's decisions on them.
- **Goal:** Proposals went up and decisions came back **as messages**, with refusals that guide — independently, per project.
- **Verify (per project):** frontmatter shows `approved: true` or a documented refusal; `## Approval log` names who decided and when. **Derived TRDDs:** each DEPTH-1 (empty `npt:`/`eht:`), siblings ordered by `blocked-by:` and never by `npt:`, parent not `complete` while any EHT is open. **Board:** cards on that project's ONE shared board; its dev moves them only through its own columns (`todo`→`dev`→`testing`), never a maintainer column. **R49:** a bare "no" with no named defect is a finding.
- **PORTFOLIO check:** if only one or two projects show a running approval loop while others show none despite a dispatch existing, that is a serialization finding — record it, do not intervene.

#### S010z: Write the burst report + Rule-11 individual proposals, then EXIT
- **Action:** Write to `reports/scenarios-runner/`: per-project dispatch/approval-loop status, the exact seven agent names mapped to P1/P2/P3, the concurrency timestamps, and the screenshot count. Then, for every behavioural finding or capability gap this burst surfaced, author it as its OWN `design/proposals/TRDD-*.md` file (`column: proposal`, `labels: [scenario-improvement, scen-031, phase-2a]`). **ONE finding = ONE file. NEVER a monolithic report of proposals.**
- **Goal:** The orchestrator can decide whether to spawn 2b; the burst's real product — its improvement proposals — exists as individually screenable TRDDs.
- **Verify:** the report names each finding with its evidence; `grep -l 'phase-2a' design/proposals/*.md` lists a matching TRDD per finding. **Do NOT hibernate; do NOT clean up; do NOT wait for the next milestone.** Return your 3-line summary and exit.
