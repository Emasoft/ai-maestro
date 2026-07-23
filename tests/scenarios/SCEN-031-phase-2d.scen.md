---
number: 31
phase: 2d
phase-of: SCEN-031
name: zipsearcher B4 — close the observation window, write the handoff, park the fleet
version: "1.0"
description: >
  BURST 2d of phase 2 — the CLOSER. Per Rule 15 it contains NO waiting. The orchestrator spawns it
  when it decides the observation window is over, whether or not the fleet reached feature-complete.
  It records the true state (including "not feature-complete"), writes the EXIT STATE contract phase
  3 consumes, and HIBERNATES all three agents. It is the only burst that always runs.
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
  - "Agent session state change: running -> hibernated (x3)"
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - The three agents exist (awake or already hibernated)
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2d — close the window honestly, then park the fleet

> **RULE 15 — YOU NEVER WAIT.** You are the closer. You record what IS, not what you hoped for.
> **Never wait for the build to finish** — if it has not finished, that is the report's content.

## PRECONDITION

None. This burst ALWAYS runs to completion, because leaving a fleet running unobserved is never
acceptable and phase 3 needs an EXIT STATE contract regardless of the verdict.

## TOKEN DISCIPLINE

One cheap state sweep, then write. A snapshot only to locate the hibernate control.

---

#### S015: Record the TRUE completion state — including "not complete"
- **Action:** One consolidated read of: `main`'s commit kinds, `src/entrypoint.py` size, fleet-authored vs dependabot PRs, CI status, and whether an AMP completion message reached the MANAGER.
- **Goal:** An honest verdict on whether the governed loop shipped **working software**.
- **Verify — state each explicitly, PASS or FAIL:**
  - `main` holds a working zipsearcher (name search via the central directory, no decompression), suite green in CI;
  - an AMP message `from: <autonomous> to: <manager>` reports completion;
  - **never-stop:** every agent that went quiet was revived by the janitor cron / continuity daemon, **NOT** by any runner or by the orchestrator.
- **The judgement that matters most:** a repo busy with governance docs, dependency bumps and template scaffolding while `entrypoint.py` sits at its template size has **NOT** shipped. Say so plainly. A generous reading here is the single easiest way to produce a false PASS for this whole scenario.
- **If an agent was nudged by anyone at any point, the verdict is FAIL** — record who nudged, when, and why, because that is a harness finding worth more than a green tick.

#### S015y: Write the phase-2 handoff (the EXIT STATE contract)
- **Action:** Write the consolidated phase-2 report to `reports/scenarios-runner/`, folding in the 2a/2b/2c burst reports.
- **Goal:** Phase 3 can release, verify and clean up without guessing what exists.
- **Verify the report carries:** the three agent names · **the AUTONOMOUS's fork full name (phase 3 deletes it)** · the repo name · phase 1's baseline-screenshot and state-backup paths · the honest feature-complete verdict · screenshot and burst counts.
- **Do NOT delete anything. Do NOT run STATE-WIPE.** Only phase 3 cleans.

#### S015z: HIBERNATE all three agents — LAST action, after the report is written
- **Action:** Via the UI, hibernate all three agents.
- **Goal:** The fleet cannot keep working unobserved between windows. This matters most here: phase 2 ends mid-project, so a live fleet would go on merging PRs, cutting releases and moving cards with nobody watching — possibly completing the project outside any recorded phase.
- **Verify:** all three show hibernated/exited and no related tmux session remains. **The server must NOT be restarted** — only the agents are parked.

> **Not a never-stop violation.** The continuity proof governs behaviour **within** an observed
> window. A window boundary is a declared park by the USER-runner, and phase 3 counts the
> corresponding wake as setup, not as a rescue. Record the hibernate so it is read that way.
