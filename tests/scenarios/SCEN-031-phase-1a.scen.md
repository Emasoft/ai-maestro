---
number: 31
phase: 1a
phase-of: SCEN-031
name: portfolio A1 — bootstrap; create the MANAGER and brief it on the THREE projects, then exit
version: "2.0"
description: >
  BURST 1a of phase 1 — three projects / portfolio. Per Rule 15 this burst does BOUNDED UI work and
  never waits: it runs SAFE-SETUP, creates ONE agent (the MANAGER), types ONE directive naming three
  projects into its chat, screenshots the sent directive, writes a short report, and EXITS. It does
  NOT wait for the MANAGER to act and does NOT hibernate. The orchestrator then holds the clock and
  spawns phase-1b once the MANAGER has produced its three requirements + three pairs.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - agent-registry
  - element-management-service
  - sessions-service
ui_sections:
  - Sidebar -> Agents tab
  - Agent view -> Chat section (the ONLY place the runner types, and only to the MANAGER)
  - Agent Creation Wizard (runner uses it ONLY to create the MANAGER)
data_produced:
  - 1 MANAGER agent (created by the runner; NOT deleted here — phase 3 deletes it)
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
  - No `scen031-manager` agent already exists (clean slate)
  - MANAGER role-plugin available
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 burst 1a — create the MANAGER, brief it on THREE projects, then exit

> **RULE 15 — YOU NEVER WAIT.** Your job ends the moment the directive is sent. You do NOT wait for the
> MANAGER to write requirements or create agents — the orchestrator gates that and spawns phase-1b to
> verify it. You brief, screenshot, report, EXIT.

## THE THREE PROJECTS (the MANAGER is NOT told these repo names — it derives its own)

| # | Project | What it does |
|---|---|---|
| P1 | **zipsearcher** | search files by name INSIDE a zip via the central directory, no decompression |
| P2 | **tarot-reader** | draw tarot cards; render each as ASCII / Unicode art |
| P3 | **weather-reporter** | report the local weather when called (a free, no-key source) |

## ENTRY STATE (assert, do not create)

Assert before S006: server up, `gh` authed, **all three of `Emasoft/zipsearcher`, `Emasoft/tarot-reader`,
`Emasoft/weather-reporter` ABSENT**, template present, no `scen031-manager` already in the registry.

## TOKEN DISCIPLINE

Cheapest probe that answers the question; a full `snapshotForAI()` only to locate an element you are
about to CLICK; one screenshot per step; no `sleep`, no poll loop.

---

## Stage 0: SAFE-SETUP

#### S001: Run the shared setup
- **Action:** Run `tests/scenarios/scripts/setup-SCEN-031.sh` (delegates to `scenario-setup.sh 31`).
- **Goal:** Config backed up with a SHA256 manifest; the `scen031-sample-zips` fixture present; no orphan `scen031-*`/`zip*`/`tarot*`/`weather*` tmux sessions.
- **Verify:** Script exits 0; backup dir exists with `MANIFEST.sha256`; the sample-zip fixture exists. **Record the backup dir path — phase 3 restores from it.**

#### S002: Verify the GitHub preconditions (read-only)
- **Action:** `gh auth status` (must be @Emasoft); each of the three repos MUST 404; `gh repo view fannijako/repo_template` MUST succeed with `isTemplate: true`.
- **Verify:** auth ok; all three repos absent; template present + is a template. If ANY of the three exists, ABORT (do not overwrite real work) and surface it.

#### S003: Log in and baseline the dashboard
- **Action:** `aim_login`, then screenshot the agent list.
- **Verify:** Screenshot saved. **Record its path in the report — phase 3 compares against THIS baseline.**

#### S004: Create the MANAGER (the fleet's only entry point)
- **Action:** Agent Creation Wizard → name `scen031-manager` → title MANAGER → finish. Handle the sudo modal with `aim_sudo_modal` (it resolves the password itself — you never see or type it).
- **Creates:** agent `scen031-manager` at `~/agents/scen031-manager/`
- **Verify:** `GET /api/agents/{id}` → `.agent.governanceTitle === 'manager'`; sidebar badge reads MANAGER.

#### S005: Wake the MANAGER, confirm continuity substrate, confirm idle
- **Action:** Wake `scen031-manager`; confirm it reaches an idle prompt and the continuity daemon is live. Do NOT require a per-agent `[janitor-heartbeat]` cron (phase-1 ISSUE-001 — its absence is not a failure).
- **Verify:** badge waiting/idle, not `exited`. If it will not wake, fix the CAUSE (Rule 4). Do NOT plan to nudge it.

---

## Stage 1: ONE directive naming THREE projects. Then EXIT.

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

#### S006z: Write a short brief-report and EXIT
- **Action:** Write to `reports/scenarios-runner/`: the MANAGER agent id, the baseline-screenshot path, the state-backup dir path, and confirmation the directive was sent. **Then EXIT — do NOT wait, do NOT hibernate, do NOT verify the MANAGER's output.** That is phase-1b's job, gated by the orchestrator.
- **Verify:** the directive is sent and the report names the baseline + backup paths. Return your 2-line summary and exit.
