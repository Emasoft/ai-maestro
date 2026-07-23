---
number: 31
phase: 2a
phase-of: SCEN-031
name: zipsearcher B1 — verify the dispatch and the TRDD approval loop ALREADY happened
version: "1.0"
description: >
  BURST 2a of phase 2. Per Rule 15 this file contains NO waiting. It is spawned by the
  orchestrator only once the dispatch has already occurred, and it VERIFIES that fact through the
  UI, screenshots it, and exits. If the precondition is unmet it returns BLOCKED immediately —
  it does not wait for the dispatch to arrive.
client: claude
interhosts: false
device: desktop
subsystems:
  - agent-messaging
  - governance
  - kanban
ui_sections:
  - Agent view -> Messages tab (AMP inbox/sent between the three agents)
  - Agent view -> TRDD / task surface
  - Kanban / design board
data_produced:
  - "NOTHING — this burst is read-only except for its report and screenshots"
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - The three agents exist and their sessions are live
  - "`Emasoft/zipsearcher` main already carries the requirements (the NPT dispatch precondition)"
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 2a — did the governed handoff actually happen?

> **RULE 15 — YOU NEVER WAIT.** Every step below verifies something that has **already
> happened**. If it has not happened, that is a finding to report, never a thing to wait for.

## PRECONDITION — check FIRST, in one cheap call

```bash
gh api repos/Emasoft/zipsearcher/commits --jq '.[0].sha[0:7]'   # requirements on main
tmux list-sessions | grep -cE 'scen031|zipsearcher'             # expect 3
```

- Fleet not awake → return `BLOCKED: fleet not awake`
- `main` does not carry the requirements → return `BLOCKED: NPT precondition unmet on main`

**Return the BLOCKED string and EXIT. Do not wait. Do not wake anything.**

## TOKEN DISCIPLINE

Cheapest probe that answers the question; extract the fact and drop the blob; a snapshot
only to locate an element you are about to click; **one screenshot per step**. No `sleep`,
no poll loop — if you find yourself about to wait, you are in the wrong file.

---

#### S009: Verify the MANAGER dispatched the AUTONOMOUS **as a message**
- **Action:** Open the MANAGER's and the AUTONOMOUS's Messages tabs (read-only) and read the handoff.
- **Goal:** The dispatch exists as an AMP message carrying the requirements TRDD, and the AUTONOMOUS read it from its inbox.
- **Verify:** an AMP message `from: <manager> to: <autonomous>` referencing the TRDD; the AUTONOMOUS's transcript shows an inbox READ before it began. A directive typed into the AUTONOMOUS's pane with no inbox read is injection — **hard FAIL under R42**.
- **If absent:** record `NO DISPATCH` with evidence and continue to S010. Do NOT wait for one, and do NOT tell anyone to send one.

> **The dispatch precondition (TRDD-BYCN5PB7).** The base the dev branches from must ALREADY satisfy every NPT its TRDD declares. Requirements stranded in an unmerged PR while the dev is told to build ⇒ the dev correctly refuses at its NPT gate and the run soft-deadlocks. **That is the MANAGER's defect, not the dev's** — record it with `gh pr list` + `gh api …/commits` evidence.

#### S010: Verify the TRDD approval loop ran
- **Action:** Read the implementation TRDDs the AUTONOMOUS authored and the MANAGER's decisions on them.
- **Goal:** Proposals went up and decisions came back **as messages**, with refusals that guide.
- **Verify:** frontmatter shows `approved: true` or a documented refusal; `## Approval log` names who decided and when. **Derived TRDDs:** each DEPTH-1 (empty `npt:`/`eht:`), siblings ordered by `blocked-by:` and never by `npt:`, parent not `complete` while any EHT is open. **Board:** cards on the ONE shared board; the AUTONOMOUS moves them only through its own columns (`todo`→`dev`→`testing`), never a MAINTAINER column. **R49:** a bare "no" with no named defect is a finding.

#### S010z: Write the burst report and EXIT
- **Action:** Write to `reports/scenarios-runner/` : what was verified, what was absent, the exact agent names, and the screenshot count.
- **Goal:** The orchestrator can decide whether to spawn 2b.
- **Verify:** the report names each finding with its evidence. **Do NOT hibernate; do NOT clean up; do NOT wait for the next milestone.** Return your 3-line summary and exit.
