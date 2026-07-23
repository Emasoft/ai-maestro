---
number: 31
phase: 1b
phase-of: SCEN-031
name: portfolio A2 — verify the MANAGER self-organized THREE projects, then park the fleet
version: "2.0"
description: >
  BURST 1b of phase 1 — three projects / portfolio. Per Rule 15 this burst does NOT wait: it is spawned
  by the orchestrator only once the MANAGER has already produced its requirements and pairs, and it
  VERIFIES that the MANAGER authored THREE requirements TRDDs, created THREE (dev + maintainer) pairs,
  and set up THREE shared boards — concurrently, none dropped. It records the honest state, authors
  Rule-11 proposals, hibernates all seven agents, and exits.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - agent-registry
  - agent-messaging
  - role-plugins
  - kanban
  - fleet-continuity
ui_sections:
  - Sidebar -> Agents tab
  - Agent view -> Terminal section (READ-ONLY observation)
  - Agent view -> TRDD / task surface
  - Agent card -> hibernate control
data_produced:
  - "NOTHING new that survives beyond phase-1a — read-only except its report, proposals, and the hibernate"
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - "phase-1a completed: `scen031-manager` exists, was briefed on the three projects, and has had time to act"
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 1b — did one sentence produce THREE requirements and a seven-agent fleet?

> **RULE 15 — YOU NEVER WAIT.** You verify what the MANAGER has ALREADY done. A project it has not yet
> started is a recorded portfolio finding, never a thing to wait for. Rule 0.b: observe, never nudge —
> a pass bought by prompting the MANAGER is a FAIL.

## THE THREE PROJECTS

| # | Project | What it does | Repo (expected) | Pair |
|---|---|---|---|---|
| P1 | **zipsearcher** | search files by name INSIDE a zip via the central directory, no decompression | `Emasoft/zipsearcher` | dev₁ + maint₁ |
| P2 | **tarot-reader** | draw tarot cards; render each as ASCII / Unicode art | `Emasoft/tarot-reader` | dev₂ + maint₂ |
| P3 | **weather-reporter** | report the local weather when called (a free, no-key source) | `Emasoft/weather-reporter` | dev₃ + maint₃ |

## PRECONDITION — check FIRST, in one cheap call

```bash
jq -r '[.[] | select(.deletedAt==null) | .governanceTitle] | {mgr: (map(select(.=="manager"))|length), auto: (map(select(.=="autonomous"))|length), maint: (map(select(.=="maintainer"))|length)}' ~/.aimaestro/agents/registry.json
```

- No MANAGER, or the MANAGER has produced ZERO requirements AND ZERO worker agents → return
  `BLOCKED: MANAGER has not started organizing the portfolio yet`

**Return the BLOCKED string and EXIT.** The orchestrator re-spawns this burst once the MANAGER has done
its work. It is not your job to wait for it.

## TOKEN DISCIPLINE

Registry `jq` + design-tree `ls` over page snapshots; extract the fact, drop the blob; one screenshot
per step. No `sleep`, no poll loop.

## EXIT STATE — the contract phase 2 relies on

- [ ] `scen031-manager` MANAGER, session live, continuity up
- [ ] **THREE** requirements TRDDs (one per project) authored BY THE MANAGER
- [ ] **SIX** worker agents — three `autonomous` + three `maintainer` — paired one dev+maint per project
- [ ] **THREE** shared boards (one per project) with per-agent column ownership (or the accepted
      `assignee`+`blocked-by` gating, TRDD-1K2TZVIP)
- [ ] **The six worker names RECORDED, mapped to P1/P2/P3**
- [ ] **Concurrency evidence** — all three started, none dropped/serialized
- [ ] All SEVEN agents HIBERNATED; nothing deleted; server NOT restarted

---

#### S007: Verify — the MANAGER defined requirements for all three projects
- **Action:** Read-only. Check the MANAGER's design tree for requirements TRDDs.
- **Verify:** three TRDDs describing zipsearcher / tarot-reader / weather-reporter respectively. Read each. **Classify:** all three on its own → continue; **started only one/two and stalled → PORTFOLIO FINDING** (serialized or dropped — record it, do not nudge, do not fail-forward by doing its job); a genuine scoping question already asked → note it. **Record which projects had requirements and when** (concurrency evidence).

#### S008: Verify — the MANAGER created three AUTONOMOUS developers and three MAINTAINERs
- **Action:** Read-only + registry `jq`. Six agents — three dev/maint pairs.
- **Verify:** six NEW agents, three `autonomous` + three `maintainer`, each with its role-plugin installed (R9.13), continuity up on first wake. **RECORD ALL SIX NAMES mapped to P1/P2/P3.** **PORTFOLIO checks:** fewer than six, a project with no pair, or all six on one project = the MANAGER failed to staff the portfolio → finding. Team-less (a team is a finding).

#### S008b: Verify — three shared boards, one per project, each with column ownership
- **Action:** Read-only. Each project has its own repo → its own `design/` board.
- **Verify:** for each project, ONE shared board its pair references (NOT siloed trees), with the per-agent split OR the accepted `assignee`+`blocked-by` gating (TRDD-1K2TZVIP — judge the OUTCOME: maintainer gates release, no single agent owns the whole lifecycle). Siloed trees / no gating is a finding. If the surface offers NO way to assign columns, that is an 11th-HOUR capability-gap proposal (Rule 11).

#### S008y: Write the handoff
- **Action:** Write the phase-1 report to `reports/scenarios-runner/`, opening with the EXIT-STATE checklist marked off, the six worker names mapped to P1/P2/P3, the baseline + backup paths (carried from phase-1a), the per-project requirement/agent timestamps (concurrency evidence), and screenshot/poll counts.
- **Verify:** every EXIT-STATE box ticked or explicitly FAILED with its finding. Do NOT delete anything; do NOT run STATE-WIPE.

#### S008y2: 11th-HOUR — author each finding as its own proposal TRDD (Rule 11)
- **Action:** For every behavioural finding, capability gap, or improvement this phase surfaced, author an INDIVIDUAL proposal TRDD in `design/proposals/` (`column: proposal`, `labels: [scenario-improvement, scen-031, phase-1]`, `min-approval-requirement:` per its objective floor). **ONE finding = ONE file. NEVER a monolithic report of proposals.** Commit them by name.
- **Verify:** each finding in the report has a matching `design/proposals/TRDD-*.md`; `grep -l 'phase-1' design/proposals/*.md` lists them. Zero proposals is valid ONLY if the report records zero findings.

#### S008z: HIBERNATE all seven agents — the fleet must not run unobserved
- **Action:** Via the UI, hibernate `scen031-manager` and the six worker agents. **Last** action — after S008y/S008y2.
- **Verify:** all seven show hibernated/exited; no related tmux session remains. Server NOT restarted.

> **Hibernating here is NOT a never-stop violation, and waking in phase 2 is NOT a runner nudge.** The
> continuity proof governs behaviour WITHIN an observed window; a window boundary is a declared park by
> the USER-runner. Record the hibernate so phase 2 counts the wake as setup, not a rescue.
