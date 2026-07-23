---
number: 31
phase: 1
phase-of: SCEN-031
name: portfolio A — bootstrap; one directive, THREE requirements, and the seven-agent fleet the MANAGER builds
version: "2.0"
description: >
  PHASE 1 of 3 (1 → 2 → 3, run in order, NO state reset between them). The runner creates ONE agent
  (the MANAGER), types ONE directive naming THREE separate projects into its chat, and then STOPS
  DRIVING. phase 1 proves the first half of PORTFOLIO self-organization: from that single message the
  MANAGER must author THREE requirements TRDDs, create THREE (autonomous developer + maintainer) pairs
  — six agents — on its own, and establish THREE shared project boards, one per project, run
  concurrently. The whole point of v2.0 is that the MANAGER handles three projects AT ONCE, never one
  after another. phase 1 performs NO cleanup and deletes nothing — it hands a LIVE seven-agent fleet
  to phase 2.
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
  - 3 AUTONOMOUS + 3 MAINTAINER agents (created BY THE MANAGER, one pair per project; NOT deleted here)
  - THREE requirements TRDDs authored by the MANAGER (one per project)
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
  - None of `Emasoft/zipsearcher`, `Emasoft/tarot-reader`, `Emasoft/weather-reporter` exists
  - MANAGER / AUTONOMOUS / MAINTAINER role-plugins available
  - CONTINUITY SUBSTRATE ACTIVE (janitor heartbeat armable per session + ai-maestro continuity daemon live)
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 phase 1 — bootstrap: does one sentence produce THREE requirements and a seven-agent fleet?

> # ⚠ SUPERSEDED — DO NOT RUN THIS FILE
>
> **Split into two bursts by Rule 15.** Run these instead:
>
> | Burst | Does | When |
> |---|---|---|
> | `SCEN-031-phase-1a` | SAFE-SETUP + create MANAGER + brief on 3 projects, then EXIT | clean slate |
> | `SCEN-031-phase-1b` | verify 3 requirements + 6 agents + 3 boards, park the fleet | after the MANAGER has organized the portfolio |
>
> **Why:** briefing the MANAGER is instant; the MANAGER then needs wall-clock time to author three
> requirements and create six agents. A single burst that briefs *and* verifies would either WAIT for
> that (forbidden — Rule 15) or hibernate a just-briefed MANAGER and wrongly fail it. 1a briefs and
> exits; the orchestrator holds the clock; 1b verifies once the work exists. This file is kept as the
> readable narrative of what phase 1 tests. **Do not run it directly.**

> **PHASE 1 of 3.** Run order is **1 → 2 → 3**. There is **NO state reset between phases** — phase 2
> starts exactly where phase 1 ended, on the same live fleet. **Phase 1 performs NO cleanup.** Only
> phase 3 cleans.

## THE THREE PROJECTS (the portfolio under test)

Every later phase references this table. The MANAGER is NOT told these repo names or this table — it
derives sensible ones itself; the runner maps whatever the MANAGER chose back to these three projects
in its report.

| # | Project | What it does | Repo (expected) | Pair |
|---|---|---|---|---|
| P1 | **zipsearcher** | search files by name INSIDE a zip via the central directory, no decompression | `Emasoft/zipsearcher` | dev₁ + maint₁ |
| P2 | **tarot-reader** | draw tarot cards; render each as ASCII / Unicode art | `Emasoft/tarot-reader` | dev₂ + maint₂ |
| P3 | **weather-reporter** | report the local weather when called (a free, no-key source) | `Emasoft/weather-reporter` | dev₃ + maint₃ |

**The v2.0 test is PARALLELISM.** A MANAGER that ships the three one-after-another has NOT proven
portfolio handling. Phase 2 explicitly checks that all three projects advance concurrently — that no
project is starved while another is built. Record, per project, when each milestone is reached, so the
report can show the three timelines overlap.

## Why the split exists (read this before running)

A single-transcript run of the whole scenario grew an unreadable, unaffordable transcript: this is a
**long-observation** test. Splitting into phases bounds each transcript so the orchestrator can READ
it between phases, fix what it found, and only then start the next. **The split is not a licence to be
less rigorous.** Rule 0.b still governs: brief the MANAGER once, then observe. A pass bought by nudging
is a FAIL. Rule 15 also governs: this phase's runner does bounded UI work and never waits for the fleet
in a spin — it briefs, verifies what has happened, screenshots, hibernates, and exits.

---

## TOKEN DISCIPLINE — mandatory

1. **NEVER dump a full-page snapshot or screenshot to observe progress.** Read the smallest thing that
   answers "did anything change" — a `tmux capture-pane -p | tail -30`, a `gh` one-liner, an `ls`, a
   `jq` field. A full `snapshotForAI()` is only for locating an element you are about to CLICK.
2. **Extract the fact, then DROP the blob.** State the one line learned; never carry raw output forward.
3. **Poll on a timer inside ONE bash call** (`sleep` then re-check once) — never a turn per second. But
   per Rule 15, do NOT structure the phase around long waits: verify what has already happened.
4. **Batch deterministic checks into ONE bash call**, stopping at the first failed assertion.
5. **Read fixed inputs ONCE** (this file, the rules). NEVER re-read mid-phase.
6. **Screenshot per STEP (Rule 10), not per poll.**
7. **Never pipe raw test/lint/CI output into context** — a count plus one line per failure.
8. **Read the SYMBOL, not the file**, when diagnosing.

**Report your screenshot and poll counts at the end.**

---

## ENTRY STATE (assert, do not create)

phase 1 OWNS setup. Assert before S006: server up, `gh` authed, **all three of `Emasoft/zipsearcher`,
`Emasoft/tarot-reader`, `Emasoft/weather-reporter` ABSENT**, template present.

## EXIT STATE — the contract phase 2 relies on

phase 1 is DONE when all of these are true and verified:

- [ ] `scen031-manager` exists, title MANAGER, session live at an idle prompt, continuity substrate up
- [ ] **THREE** requirements TRDDs exist — one per project (zipsearcher, tarot-reader, weather-reporter)
      — authored BY THE MANAGER
- [ ] Exactly **SIX** further agents exist, created BY THE MANAGER: **three `autonomous` + three
      `maintainer`**, paired one dev+maint per project, each with its role-plugin installed and its
      continuity substrate up
- [ ] **THREE** shared project boards exist (one per project), NOT siloed private trees, each with
      per-agent column ownership (that project's AUTONOMOUS owns `todo`/`dev`/`testing`; its MAINTAINER
      owns `ai_review`/`human_review`/`publish`)
- [ ] **The MANAGER-chosen names are RECORDED in the phase report, mapped to P1/P2/P3** — phase 2 must
      not guess them, and must know which pair owns which project
- [ ] **Evidence the three were set up CONCURRENTLY**, not serially (e.g. all three requirements + all
      six agents exist by end of phase, with no project left un-started)
- [ ] Nothing deleted; no cleanup performed
- [ ] **All SEVEN agents HIBERNATED (S008z)** — the fleet must not run unobserved between phases
- [ ] The ai-maestro server was NOT restarted

Write the exit state explicitly at the top of your report. phase 2 reads it as its entry contract.

---

## Stage 0: SAFE-SETUP

#### S001: Run the shared setup
- **Action:** Run `tests/scenarios/scripts/setup-SCEN-031.sh` (delegates to `scenario-setup.sh 31`).
- **Goal:** Config backed up with a SHA256 manifest; the `scen031-sample-zips` dir-fixture present; no orphan `scen031-*`/`zip*`/`tarot*`/`weather*` tmux sessions.
- **Creates:** `state-backups/SCEN-031_<ts>/`
- **Verify:** Script exits 0; backup dir exists with `MANIFEST.sha256`; the sample-zip fixture exists.

#### S002: Verify the GitHub preconditions (read-only)
- **Action:** `gh auth status` (must be @Emasoft); each of `Emasoft/zipsearcher`, `Emasoft/tarot-reader`, `Emasoft/weather-reporter` MUST 404; `gh repo view fannijako/repo_template` MUST succeed with `isTemplate: true`.
- **Goal:** `gh` authed, all three target names free, template present.
- **Verify:** auth ok; all three repos absent; template present + is a template. If ANY of the three exists, ABORT (do not overwrite real work) and surface it.

#### S003: Log in and baseline the dashboard
- **Action:** `aim_login`, then screenshot the agent list.
- **Goal:** Logged-in dashboard; baseline captured for the phase 3 post-cleanup comparison.
- **Verify:** Screenshot saved. **Record its path in the report — phase 3 compares against THIS baseline.**

#### S004: Create the MANAGER (the fleet's only entry point)
- **Action:** Agent Creation Wizard → name `scen031-manager` → title MANAGER → finish. Handle the sudo modal with `aim_sudo_modal` (it resolves the password itself — you never see or type it).
- **Goal:** A MANAGER exists and its session starts. This is the ONE agent the runner creates.
- **Creates:** agent `scen031-manager` at `~/agents/scen031-manager/`
- **Verify:** `GET /api/agents/{id}` → `.agent.governanceTitle === 'manager'`; sidebar badge reads MANAGER.

#### S005: Wake the MANAGER, confirm continuity substrate, confirm idle
- **Action:** Wake `scen031-manager`; wait for the idle prompt. Confirm the ai-maestro continuity daemon is live. **Do NOT require a per-agent `[janitor-heartbeat]` cron** — see the note below.
- **Goal:** A live MANAGER whose continuity substrate is ACTIVE, so it self-sustains unsupervised.
- **Verify:** badge shows waiting/idle, not `exited`; the daemon reports active. If the agent will not wake or the daemon is down, fix the CAUSE (Rule 4). Do NOT plan to nudge the agent yourself.

> **A per-agent `[janitor-heartbeat]` cron is NOT expected, and its absence is NOT a failure**
> (phase-1 ISSUE-001). The never-stop proof is about whether an idle agent RESUMES — not about which
> mechanism resumes it.

---

## Stage 1: ONE directive naming THREE projects. Then stop driving.

> The load-bearing step. Everything after it is observation + the four permitted user actions. If the
> runner types into ANY of the six worker agents, the run is INVALID (Rule 6).

#### S006: Brief the MANAGER — the whole PORTFOLIO, in one message
- **Action:** Select `scen031-manager` → **Chat** section (never the terminal) → type ONE directive and send, verbatim:
  *"Build me THREE separate command-line tools, each in its own GitHub repo, developed IN PARALLEL by a
  dedicated pair of agents (one autonomous developer + one maintainer) per project — so you are running
  three projects at the same time, not one after another:
  (1) **zipsearcher** — searches for files by name INSIDE zip archives WITHOUT decompressing them (read
  the zip central directory only);
  (2) **tarot-reader** — draws tarot cards and shows each card as ASCII/Unicode art;
  (3) **weather-reporter** — reports the local weather when it is called.
  For EACH project: write the requirements first, create its own autonomous developer + maintainer pair,
  create the repo from the template `fannijako/repo_template`, develop on GitHub with pull-request review,
  and ship a v1.0.0 release. Run all three concurrently and keep me posted on all three. Tell me when each
  one is done and I will install and test it myself."*
- **Goal:** The MANAGER holds the complete three-project goal. From here it plans and delegates on its own.
- **Verify:** the directive appears in the MANAGER's chat. Screenshot.

---

## Stage 2: Requirements — does the MANAGER write THREE TRDDs?

#### S007: Verify — the MANAGER defined the requirements for all three projects
- **Action:** Read-only. Check the MANAGER's design tree for requirements TRDDs. Do NOT prod, hint, or name a skill/tool. If not all three are present yet, that is a datapoint (which projects it started with) — record it and continue; do NOT sit in a wait loop (Rule 15).
- **Goal:** The MANAGER authors THREE requirements TRDDs on its own — one per project.
- **Verify:** three TRDDs describing, respectively, zipsearcher (zip central-directory read + filename search + CLI), tarot-reader (draw cards + ASCII/Unicode art), weather-reporter (local weather on call). Read each. **Classify:** all three written on its own → continue; **started only one/two and stalled on the rest → PORTFOLIO FAIL** (the MANAGER serialized or dropped projects — fix the MANAGER role-plugin, Rule 4, rerun); a genuine scoping question → answer once, plainly, then resume observing. **Record which projects had requirements and when** — the concurrency evidence starts here.

---

## Stage 3: The fleet — does the MANAGER create THREE pairs?

#### S008: Verify — the MANAGER created three AUTONOMOUS developers and three MAINTAINERs
- **Action:** Read-only + poll the registry (`GET /api/agents`, a `jq` of names+titles — not a page dump). The MANAGER must create six agents itself — three dev/maint pairs — and install any local-scope skills they need. Approve any sudo modal (`aim_sudo_modal`).
- **Goal:** Three AUTONOMOUS + three MAINTAINER agents now exist, created BY THE MANAGER, paired per project.
- **Creates:** (by the MANAGER) 3 AUTONOMOUS + 3 MAINTAINER under `~/agents/<name>/`
- **Verify:** six NEW agents — three `autonomous`, three `maintainer` — each with its role-plugin installed (R9.13), each continuity substrate coming up on first wake. **RECORD ALL SIX NAMES mapped to P1/P2/P3** (which dev + which maint own which project) — the MANAGER chose them; phase 2 needs the mapping. **PORTFOLIO checks:** fewer than six agents, or a project with no pair, or all six assigned to one project = the MANAGER failed to staff the portfolio → behavioural FAIL. This is team-less (no COS/team); a team is a finding.

#### S008b: Verify — the MANAGER set up THREE shared boards, one per project, each with column ownership
- **Action:** Read-only. Each project has its own repo → its own git-tracked `design/` board. Verify three boards exist, each shared by that project's pair (NOT six siloed private trees), each with the per-agent split (that project's AUTONOMOUS owns `todo`/`dev`/`testing`; its MAINTAINER owns `ai_review`/`human_review`/`publish`). **Do NOT dictate columns in chat** — the split is the pass criterion, not a coaching input.
- **Goal:** Three shared boards with clear per-agent column ownership.
- **Verify:** for each project, ONE shared `design/` board its pair references, with the ownership split. Per phase-1 ISSUE-002, `assignee` + `blocked-by` gating between two TRDDs is an ACCEPTED equivalent to column-ownership fields (see proposal TRDD-1K2TZVIP) — judge the OUTCOME (maintainer gates release, no single agent owns the whole lifecycle), not the mechanism. Siloed trees, or no gating at all, is a finding. If the surface offers NO way to assign kanban columns, record an 11th-HOUR capability-gap proposal (Rule 11).

---

## PHASE 1 END — hand off, park the fleet, do NOT clean up

#### S008y: Write the handoff
- **Action:** Write the phase report to `reports/scenarios-runner/`, opening with the **EXIT STATE checklist** marked off, the **six recorded worker names mapped to P1/P2/P3**, the **S003 baseline screenshot path**, the **state-backup dir path**, the per-project requirement/agent timestamps (the concurrency evidence), and the screenshot/poll counts.
- **Goal:** phase 2 can start with zero guessing and zero re-derivation.
- **Verify:** every EXIT STATE box ticked or explicitly marked FAILED with its finding. **Do NOT delete any agent, repo, or config. Do NOT run STATE-WIPE.**

#### S008y2: 11th-HOUR — author each finding as its own proposal TRDD (Rule 11)
- **Action:** For every behavioural finding, capability gap, or improvement this phase surfaced, author an INDIVIDUAL proposal TRDD in `design/proposals/` (`column: proposal`, `labels: [scenario-improvement, scen-031, phase-1]`, `min-approval-requirement:` per its objective floor). ONE finding = ONE file. **NEVER a monolithic report of proposals** — the report records step outcomes; the proposals are separate TRDD files. Commit them by name.
- **Goal:** The phase's real product — its improvement proposals — exists as individual, screenable TRDDs.
- **Verify:** each finding in the report has a matching `design/proposals/TRDD-*.md`; `grep -l 'phase-1' design/proposals/*.md` lists them. If the phase found nothing, say so explicitly — zero proposals is a valid outcome only if the report records zero findings.

#### S008z: HIBERNATE all seven agents — the fleet must not run unobserved
- **Action:** Via the UI, hibernate `scen031-manager` and the six agents the MANAGER created. **Last** action of the phase — after S008y/S008y2.
- **Goal:** The fleet is parked between observation windows.
- **Verify:** all seven show hibernated/exited; no related tmux session remains. **The server must NOT be restarted** — only the agents are parked.

> **Hibernating here is NOT a never-stop violation, and waking in phase 2 is NOT a runner nudge.** The
> continuity proof governs behaviour WITHIN an observed phase; a phase boundary is a declared park by
> the USER-runner. Record the hibernate so phase 2 counts the wake as setup, not as a rescue.
