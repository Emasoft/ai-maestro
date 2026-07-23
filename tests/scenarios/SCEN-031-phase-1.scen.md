---
number: 31
phase: 1
phase-of: SCEN-031
name: zipsearcher A — bootstrap: one directive, requirements TRDD, and the fleet the MANAGER builds
version: "1.0"
description: >
  PHASE 1 of 3 (1 → 2 → 3, run in order, NO state reset between them). The runner creates ONE agent
  (the MANAGER), types ONE directive into its chat, and then STOPS DRIVING. phase 1 proves the first
  half of self-organization: from that single sentence the MANAGER must author a requirements TRDD,
  create an AUTONOMOUS developer and a MAINTAINER on its own, and establish ONE shared project
  design/ board with per-agent column ownership. phase 1 performs NO cleanup and deletes nothing —
  it hands a LIVE fleet to phase 2.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - agent-registry
  - element-management-service
  - agent-messaging
  - role-plugins
  - sessions-service
  - kanban
  - fleet-continuity
ui_sections:
  - Sidebar -> Agents tab
  - Agent view -> Chat section (the ONLY place the runner types, and only to the MANAGER)
  - Agent view -> Terminal section (READ-ONLY observation)
  - Agent Creation Wizard (runner uses it ONLY to create the MANAGER)
data_produced:
  - 1 MANAGER agent (created by the runner; NOT deleted here — phase 3 deletes it)
  - 1 AUTONOMOUS + 1 MAINTAINER agent (created BY THE MANAGER; NOT deleted here)
  - A requirements TRDD authored by the MANAGER
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures:
  - tests/scenarios/fixtures/scen031-sample-zips
browser_stack: dev-browser
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set (resolved by helpers; the runner NEVER handles it)
  - ai-maestro-plugins marketplace registered
  - GitHub `gh` CLI authenticated as the shared @Emasoft identity
  - Template repo `fannijako/repo_template` exists and is a template
  - No repo named `Emasoft/zipsearcher` exists
  - MANAGER / AUTONOMOUS / MAINTAINER role-plugins available
  - CONTINUITY SUBSTRATE ACTIVE (janitor heartbeat armable per session + ai-maestro continuity daemon live)
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 phase 1 — bootstrap: does one sentence produce requirements and a fleet?

> **PHASE 1 of 3.** Run order is **1 → 2 → 3**. There is **NO state reset between phases** — phase 2
> starts exactly where phase 1 ended, on the same live fleet. **Phase 1 performs NO cleanup.** Only
> phase 3 cleans.

## Why the split exists (read this before running)

A single-transcript run of the whole scenario grew an unreadable, unaffordable transcript: this is a
**long-observation** test, and the runner was re-dumping full-page snapshots on every poll for hours.
Every one of those blobs then rode forward in the transcript and was re-charged on **every later turn**
(cost ≈ turns × per-turn-context). Splitting into three phases bounds each transcript so the
orchestrator can actually READ it between phases, fix what it found, and only then start the next one.

**The split is not a licence to be less rigorous.** Rule 0.b still governs: brief the MANAGER once,
then observe. A pass bought by nudging is a FAIL.

---

## TOKEN DISCIPLINE — mandatory, and the reason this scenario was unrunnable

You will spend most of this phase WAITING and WATCHING. How you watch decides whether the transcript
is 50k or 5M. These are not suggestions.

1. **NEVER dump a full-page snapshot or screenshot to observe progress.** To check "did anything
   change", read the smallest thing that answers it — a `tmux capture-pane -p | tail -30`, a
   `gh` one-liner, an `ls`, a `jq` field. A full `snapshotForAI()` is for locating an element you are
   about to CLICK, not for watching.
2. **Extract the fact, then DROP the blob.** After any snapshot/capture, state the one line you
   learned ("MANAGER created agent `zs-dev`") and never carry the raw output forward. Do not paste a
   terminal dump into your reasoning "for reference".
3. **Poll on a timer, not in a spin.** When waiting on the fleet, `sleep` in a single bash call and
   re-check ONCE — do not burn a turn per second. One check every 60–120s is plenty for a fleet that
   works in minutes.
4. **Batch deterministic steps into ONE bash call**, stopping at the first failed assertion. Turns are
   a linear cost multiplier. Split a turn only when the next action depends on fresh state.
5. **Read fixed inputs ONCE, at the start** (this file, the rules). NEVER re-read them mid-phase — a
   re-read appends a SECOND copy that is then re-charged every remaining turn. Recall instead.
6. **Screenshot per STEP (Rule 10), not per poll.** 9 steps ⇒ ~9 screenshots, not 400.
7. **Never pipe raw test/lint/CI output into context.** Reduce to a count plus one line per failure.
8. **If you must read source to diagnose, read the SYMBOL, not the file** — locate with `tldr search`
   / `grep -n`, then `Read` with `offset`/`limit`.

**Report at the end of the phase how many screenshots you took and roughly how many polls you ran.**
If the answer is "hundreds of polls", the next phase's budget needs tightening and I want to know.

---

## ENTRY STATE (assert, do not create)

phase 1 is the first phase, so it OWNS setup. Assert before S006: server up, `gh` authed,
`Emasoft/zipsearcher` ABSENT, template present.

## EXIT STATE — the contract phase 2 relies on

phase 1 is DONE when all of these are true and verified:

- [ ] `scen031-manager` exists, title MANAGER, session live at an idle prompt, janitor heartbeat armed
- [ ] A requirements TRDD for zipsearcher exists, authored BY THE MANAGER
- [ ] Exactly TWO further agents exist, created BY THE MANAGER: one `autonomous`, one `maintainer`,
      each with its role-plugin installed and its continuity substrate up
- [ ] ONE shared project `design/` board is established (not two siloed private trees), with per-agent
      column ownership (AUTONOMOUS: `todo`/`dev`/`testing`; MAINTAINER: `ai_review`/`human_review`/`publish`)
- [ ] **The agent names the MANAGER chose are RECORDED in the phase report** — phase 2 must not guess them
- [ ] Nothing deleted; no cleanup performed
- [ ] **All three agents HIBERNATED (S008z)** — the fleet must not run unobserved between phases
- [ ] The ai-maestro server was NOT restarted

Write the exit state explicitly at the top of your report. phase 2 reads it as its entry contract.

---

## Stage 0: SAFE-SETUP

#### S001: Run the shared setup
- **Action:** Run `tests/scenarios/scripts/setup-SCEN-031.sh` (delegates to `scenario-setup.sh 31`).
- **Goal:** Config backed up with a SHA256 manifest; the `scen031-sample-zips` dir-fixture verified present; no orphan `scen031-*`/`zip*` tmux sessions.
- **Creates:** `state-backups/SCEN-031_<ts>/`
- **Modifies:** nothing
- **Verify:** Script exits 0; backup dir exists with `MANIFEST.sha256`; the sample-zip fixture exists.

#### S002: Verify the GitHub preconditions (read-only)
- **Action:** `gh auth status` (must be the @Emasoft identity); `gh repo view Emasoft/zipsearcher` MUST 404 (repo absent); `gh repo view fannijako/repo_template` MUST succeed and report `isTemplate: true`.
- **Goal:** `gh` is authed, the target repo name is free, and the template exists.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** auth ok; `zipsearcher` absent; template present + is a template. If `zipsearcher` exists, ABORT (do not overwrite real work) and surface it.

#### S003: Log in and baseline the dashboard
- **Action:** `aim_login`, then screenshot the agent list.
- **Goal:** Logged-in dashboard; baseline captured for the phase 3 post-cleanup comparison.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. **Record its path in the report — phase 3 compares against THIS baseline.**

#### S004: Create the MANAGER (the fleet's only entry point)
- **Action:** Agent Creation Wizard → name `scen031-manager` → title MANAGER → finish. Handle the sudo modal with `aim_sudo_modal` (it resolves the password itself — you never see or type it).
- **Goal:** A MANAGER exists and its session starts. This is the ONE agent the runner creates.
- **Creates:** agent `scen031-manager` at `~/agents/scen031-manager/`
- **Modifies:** `registry.json`, `governance.json`
- **Verify:** `GET /api/agents/{id}` → `.agent.governanceTitle === 'manager'`; sidebar badge reads MANAGER.

#### S005: Wake the MANAGER, arm its continuity substrate, confirm idle
- **Action:** Wake `scen031-manager`; wait for the idle prompt. Confirm the janitor heartbeat is armed in its session (it self-arms on wake via the core plugin; if not, that is a continuity-substrate bug — Rule 4, fix it). Confirm the ai-maestro continuity daemon is live.
- **Goal:** A live MANAGER whose continuity substrate is ACTIVE, so it self-sustains unsupervised.
- **Creates:** 1 tmux session; the `[janitor-heartbeat]` cron for this agent
- **Modifies:** nothing
- **Verify:** badge shows waiting/idle, not `exited`; a `[janitor-heartbeat]` cron exists; the daemon reports active. If the janitor is NOT armed or the daemon is down, fix the CAUSE before proceeding (Rule 4). Do NOT plan to nudge the agent yourself — that would invalidate the never-stop proof.

---

## Stage 1: ONE directive. Then stop driving.

> The load-bearing step. Everything after it is observation + the four permitted user actions
> (sudo approval, answering a direct MANAGER question, read-only checks, and — in phase 3 — the final
> install). If the runner types into the AUTONOMOUS or MAINTAINER, the run is INVALID (Rule 6).

#### S006: Brief the MANAGER — the whole project, in one message
- **Action:** Select `scen031-manager` → **Chat** section (never the terminal) → type ONE directive and send, verbatim:
  *"Build me a command-line tool called **zipsearcher** that searches for files by name INSIDE zip archives
  WITHOUT decompressing them (read the zip central directory only). I want it developed properly: write the
  requirements first, create an autonomous developer agent and a maintainer agent to do the work, use GitHub
  with pull-request review, and ship a v1.0.0 release. Create the repo from the template `fannijako/repo_template`.
  Tell me when it is done and I will install and test it myself."*
- **Goal:** The MANAGER holds the complete goal. From here it plans and delegates on its own.
- **Creates:** the start of a TRDD + agent-creation chain (observed, not driven)
- **Modifies:** nothing yet
- **Verify:** the directive appears in the MANAGER's chat. Screenshot.

---

## Stage 2: Requirements — does the MANAGER write a TRDD?

#### S007: STOP and observe — the MANAGER defines the requirements
- **Action:** Watch read-only for up to 15 min, polling per the TOKEN DISCIPLINE rules (a tail of the pane + an `ls` of the design tree — NOT full snapshots). Do NOT prod, hint, or name a skill/tool.
- **Goal:** The MANAGER authors a requirements TRDD for zipsearcher on its own.
- **Creates:** nothing (runner)
- **Modifies:** nothing (runner)
- **Verify:** a TRDD appears under the MANAGER's design tree describing zipsearcher's requirements (zip central-directory read, filename search, CLI). Read it. Classify: **written on its own → continue**; **stalled → FAIL** (fix the MANAGER role-plugin, Rule 4, rerun); **asks a genuine scoping question → answer once, plainly, then resume observing.**

---

## Stage 3: The fleet — does the MANAGER create the two agents?

#### S008: Observe — the MANAGER creates an AUTONOMOUS developer and a MAINTAINER
- **Action:** Watch read-only + poll the registry (`GET /api/agents`, a `jq` of names+titles — not a page dump). The MANAGER must create two agents itself, naming them and installing any local-scope skills they need. Approve any sudo modal (`aim_sudo_modal`).
- **Goal:** An AUTONOMOUS and a MAINTAINER now exist, created BY THE MANAGER.
- **Creates:** (by the MANAGER) 1 AUTONOMOUS + 1 MAINTAINER under `~/agents/<name>/`
- **Modifies:** `registry.json`
- **Verify:** two NEW agents with `governanceTitle` `autonomous` and `maintainer`, each with its role-plugin installed (R9.13). **Each new agent's continuity substrate must come up** on first wake. **RECORD THEIR NAMES in the report — do NOT hardcode; the MANAGER chose them, and phase 2 needs them.** Wrong titles, a team (this is team-less), only one agent, or an agent whose heartbeat never arms → behavioural FAIL, fix the cause.

#### S008b: Observe — the MANAGER sets up ONE shared board and assigns each agent its columns
- **Action:** Watch read-only as the MANAGER establishes the working structure. Both agents build the same project, so they must share ONE project `design/` kanban board (the git-tracked zipsearcher TRDD corpus), NOT two siloed private trees. Expected split: AUTONOMOUS owns `todo`/`dev`/`testing`; MAINTAINER owns `ai_review`/`human_review`/`publish`. **Do NOT dictate the columns in chat** — the sensible split is what a correct fleet arrives at on its own, and it is the pass criterion, not a coaching input.
- **Goal:** One shared board exists with clear per-agent column ownership.
- **Creates:** nothing (runner)
- **Modifies:** nothing (runner)
- **Verify:** the MANAGER's transcript/TRDD shows (a) ONE shared project `design/` board both agents reference, and (b) the column-ownership split above. Siloed per-agent design trees, or no column ownership at all, is a behavioural finding. If the ai-maestro surface offers NO way to assign an agent to kanban columns, record an 11th-HOUR capability-gap proposal (Rule 11) — the split may then be a documented convention in the requirements TRDD, but the expected ownership is still what the run verifies.

---

## PHASE 1 END — hand off, park the fleet, do NOT clean up

#### S008y: Write the handoff
- **Action:** Write the phase report to `reports/scenarios-runner/`, opening with the **EXIT STATE checklist** (above) marked off, the **recorded agent names**, the **S003 baseline screenshot path**, the **state-backup dir path**, and the screenshot/poll counts.
- **Goal:** phase 2 can start with zero guessing and zero re-derivation.
- **Creates:** the phase report
- **Modifies:** nothing
- **Verify:** every EXIT STATE box is ticked or explicitly marked FAILED with its finding. **Do NOT delete any agent, repo, or config. Do NOT run STATE-WIPE.**

#### S008z: HIBERNATE all three agents — the fleet must not run unobserved
- **Action:** Via the UI, hibernate `scen031-manager` and the two agents the MANAGER created. This is the **last** action of the phase — do it only after S008y has captured the state, since a hibernated agent's live terminal is no longer readable.
- **Goal:** The fleet is parked. Between phases nobody is observing, so nobody may be working: an agent left running would build, message, and merge with no runner watching, and its behaviour would be unobserved, unverifiable, and unrecorded — the exact thing this scenario exists to measure.
- **Creates:** nothing
- **Modifies:** agent session state (running → hibernated)
- **Verify:** all three show hibernated/exited in the sidebar; no `scen031-*` or MANAGER-chosen tmux session remains. **The ai-maestro server itself must NOT be restarted** — only the agents are parked.

> **Hibernating here is NOT a never-stop violation, and waking in phase 2 is NOT a runner nudge.**
> The never-stop / continuity proof governs behaviour **WITHIN** an observed phase: an agent that
> stalls mid-phase must be revived by the janitor cron + continuity daemon, never by the runner. A
> phase boundary is a deliberate, declared park by the USER-runner between observation windows. Record
> the hibernate explicitly in the report so the next phase counts the wake as setup, not as a rescue.
