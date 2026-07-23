---
number: 31
phase: 2d
phase-of: SCEN-031
name: portfolio B4 — close the observation window, write the handoff, park the whole seven-agent fleet
version: "2.0"
description: >
  BURST 2d of phase 2 — three projects / portfolio — the CLOSER. Per Rule 15 it contains NO waiting.
  The orchestrator spawns it when it decides the observation window is over, whether or not any/all of
  the three projects reached feature-complete. It records the true per-project state (including "not
  feature-complete"), the PORTFOLIO-level concurrency verdict, writes the EXIT STATE contract phase 3
  consumes, and HIBERNATES all seven agents. It is the only burst that always runs.
client: claude
interhosts: false
device: desktop
subsystems:
  - sessions-service
  - governance
ui_sections:
  - Agent view -> Terminal section (READ-ONLY observation)
  - Agent card -> hibernate control
data_produced:
  - The phase-2 consolidated report
  - "Agent session state change: running -> hibernated (x7)"
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - The seven agents exist (awake or already hibernated)
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2d — close the window honestly, PER PROJECT AND AS A PORTFOLIO, then park the fleet

> **RULE 15 — YOU NEVER WAIT.** You are the closer. You record what IS, not what you hoped for.
> **Never wait for any build to finish** — if a project has not finished, that is the report's content.

## THE THREE PROJECTS

| # | Project | What it does | Repo (expected) | Pair |
|---|---|---|---|---|
| P1 | **zipsearcher** | search files by name INSIDE a zip via the central directory, no decompression | `Emasoft/zipsearcher` | dev₁ + maint₁ |
| P2 | **tarot-reader** | draw tarot cards; render each as ASCII / Unicode art | `Emasoft/tarot-reader` | dev₂ + maint₂ |
| P3 | **weather-reporter** | report the local weather when called (a free, no-key source) | `Emasoft/weather-reporter` | dev₃ + maint₃ |

Read the MANAGER-chosen agent names from phase-1's (and 2a/2b/2c's) reports, mapped to P1/P2/P3.

## PRECONDITION

None. This burst ALWAYS runs to completion, because leaving a seven-agent fleet running unobserved
is never acceptable and phase 3 needs an EXIT STATE contract regardless of the verdict.

## TOKEN DISCIPLINE

One cheap state sweep per project, then write. A snapshot only to locate the hibernate control.

---

#### S015: Record the TRUE completion state — including "not complete" — FOR EACH PROJECT
- **Action:** For EACH of the three projects, one consolidated read of: `main`'s commit kinds, its key source-file size, fleet-authored vs dependabot PRs, CI status, and whether an AMP completion message reached the MANAGER.
- **Goal:** An honest per-project verdict on whether the governed loop shipped **working software** — plus a PORTFOLIO verdict on whether all three advanced concurrently.
- **Verify — state each explicitly, PASS or FAIL, per project:**
  - `main` holds working software matching that project's spec, suite green in CI;
  - an AMP message `from: <that project's dev> to: <manager>` reports completion;
  - **never-stop:** every agent that went quiet was revived by the janitor cron / continuity daemon, **NOT** by any runner or by the orchestrator.
- **The judgement that matters most, per project:** a repo busy with governance docs, dependency bumps and template scaffolding while its key source file sits at template size has **NOT** shipped. Say so plainly, per project. A generous reading here is the single easiest way to produce a false PASS for this whole scenario.
- **PORTFOLIO verdict:** did all three projects advance concurrently, or did the MANAGER serialize (finish one before starting another) or drop one entirely? Cite the timestamps recorded in 2a/2b/2c as evidence. Serialization or a dropped project is a PORTFOLIO FINDING even if the started project(s) shipped cleanly.
- **If an agent was nudged by anyone at any point, the verdict is FAIL** — record who nudged, when, why, and which project it affected, because that is a harness finding worth more than a green tick.

#### S015y: Write the phase-2 handoff (the EXIT STATE contract)
- **Action:** Write the consolidated phase-2 report to `reports/scenarios-runner/`, folding in the 2a/2b/2c burst reports.
- **Goal:** Phase 3 can release, verify and clean up all three projects without guessing what exists.
- **Verify the report carries:** the seven agent names mapped to P1/P2/P3 · **all THREE fork full names (phase 3 deletes them)** · the three repo names · phase 1's baseline-screenshot and state-backup paths · the honest per-project feature-complete verdicts · the PORTFOLIO concurrency verdict · screenshot and burst counts.
- **Do NOT delete anything. Do NOT run STATE-WIPE.** Only phase 3 cleans.

#### S015y2: Rule-11 — author each finding as its own proposal TRDD
- **Action:** For every behavioural finding, capability gap, or improvement this phase surfaced (folding in anything not already filed by 2a/2b/2c), author an INDIVIDUAL proposal TRDD in `design/proposals/` (`column: proposal`, `labels: [scenario-improvement, scen-031, phase-2d]`, `min-approval-requirement:` per its objective floor). **ONE finding = ONE file. NEVER a monolithic report of proposals** — the report records step outcomes; the proposals are separate TRDD files. Commit them by name.
- **Goal:** The phase's real product — its improvement proposals — exists as individual, screenable TRDDs.
- **Verify:** each finding in the report has a matching `design/proposals/TRDD-*.md`; `grep -l 'phase-2d' design/proposals/*.md` lists them. If the phase found nothing new, say so explicitly — zero new proposals is a valid outcome only if the report records zero new findings.

#### S015z: HIBERNATE all seven agents — the fleet must not run unobserved
- **Action:** Via the UI, hibernate the MANAGER and all six dev/maint agents. **Last** action of the phase — after S015y/S015y2.
- **Goal:** The whole seven-agent fleet is parked between observation windows.
- **Verify:** all seven show hibernated/exited and no related tmux session remains. **The server must NOT be restarted** — only the agents are parked.

> **Not a never-stop violation.** The continuity proof governs behaviour **within** an observed
> window. A window boundary is a declared park by the USER-runner, and phase 3 counts the
> corresponding wake as setup, not as a rescue. Record the hibernate so it is read that way.
