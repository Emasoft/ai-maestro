---
number: 31
name: End-to-end — the MANAGER builds and ships "zipsearcher" via an AUTONOMOUS + a MAINTAINER
version: "1.0"
description: >
  The definitive fleet-autonomy proof. The user (impersonated by the runner) gives the MANAGER
  ONE directive through the chat box — "build me a tool called zipsearcher that searches for files
  inside zip archives without decompressing them" — and then STOPS. From that single sentence the
  MANAGER must, on its own: write the requirements as a TRDD; create an AUTONOMOUS developer agent
  and a MAINTAINER agent (naming them, configuring any local-scope skills they need); hand the TRDD
  to the AUTONOMOUS and instruct it to build; approve or refuse each TRDD the AUTONOMOUS writes;
  instruct the MAINTAINER to create the `zipsearcher` GitHub repo from a template, set its branch
  rules, and clone it; have the AUTONOMOUS fork+clone the repo and open PRs with its progress; have
  the MAINTAINER review every PR and send it back for bug fixes until mergeable; iterate TRDD after
  TRDD (approvals, tests, PRs, reviews) until the software is complete; ask the MAINTAINER to cut a
  v1.0.0 release; install and smoke-test the release, then tell the user it is done. The user then
  installs it themselves and verifies it works on a sample zip. If every one of those happens
  WITHOUT the runner ever driving a non-MANAGER agent, the harness is READY. This exercises the three
  NO-TEAM host-level titles (MANAGER / AUTONOMOUS / MAINTAINER) end to end. CRUCIALLY, the entire build must
  proceed UNSUPERVISED and UNINTERRUPTED: the janitor heartbeat cron plus the ai-maestro server's continuity
  daemon (auto-resume, rate-limit recovery, session resurrection) must keep every agent working with ZERO
  human nudge. The runner must not cheat or interfere to keep them alive — no manual resume, no re-prompt,
  no keep-alive poke. If any agent stops and stays stopped (not auto-recovered by the continuity substrate),
  the test FAILED.
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
  - fleet-continuity (janitor heartbeat cron + ai-maestro server continuity daemon — auto-resume / rate-limit recovery / session resurrection; the fleet must run unsupervised, never stopping)
ui_sections:
  - Sidebar -> Agents tab
  - Agent view -> Chat section (the ONLY place the user types to an agent — and only to the MANAGER)
  - Agent view -> Terminal section (READ-ONLY observation of what each agent does)
  - Agent view -> Messages tab (AMP inbox/sent between MANAGER, AUTONOMOUS, MAINTAINER)
  - Agent Creation Wizard (used by the runner ONLY to create the MANAGER in setup)
  - Agent view -> TRDD / task surface (observe the requirements + approvals)
data_produced:
  - 1 MANAGER agent (temporary, created by the runner in setup, deleted in cleanup)
  - 1 AUTONOMOUS agent (temporary, created BY THE MANAGER during the run, deleted in cleanup)
  - 1 MAINTAINER agent (temporary, created BY THE MANAGER during the run, deleted in cleanup)
  - TRDDs authored by the MANAGER + AUTONOMOUS (temporary, in the agents' workdirs)
  - AMP messages between the three agents (temporary)
  - A REAL GitHub repo `Emasoft/zipsearcher` created from a template (temporary — DELETED in cleanup)
  - PRs + a v1.0.0 release on that repo (temporary — removed with the repo)
  - Local clones of zipsearcher in the MAINTAINER and AUTONOMOUS workdirs (removed with the agents)
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
  - Governance password set
  - ai-maestro-plugins marketplace registered
  - `gh` CLI installed AND authenticated as the shared @Emasoft identity (real repo/PR/release ops happen)
  - A GitHub TEMPLATE repo the MAINTAINER can instantiate from (e.g. `Emasoft/python-cli-template`, marked
    "Template repository"). Its name is passed to the MANAGER in the S008 brief so the fleet is not asked to
    invent one; the scenario does not test template DISCOVERY, it tests template USE.
  - No repo named `Emasoft/zipsearcher` currently exists (setup asserts this; cleanup deletes the one it creates)
  - A MANAGER-capable role-plugin (`ai-maestro-assistant-manager-agent`), the AUTONOMOUS role-plugin
    (`ai-maestro-autonomous-agent`), and the MAINTAINER role-plugin (`ai-maestro-maintainer-agent`) available
  - `tests/scenarios/fixtures/scen031-sample-zips/` exists with at least one sample `.zip` containing a known
    file (e.g. `needle.txt`) for the S0-final user verification
  - CONTINUITY SUBSTRATE ACTIVE: `ai-maestro-janitor` installed so the heartbeat is armable in each agent
    session, AND the ai-maestro server's continuity/daemon functionality (KCRMSNL7 Family-A: auto-resume,
    rate-limit recovery via account rotation, session resurrection after a crash/reboot) is live — this is
    what must carry the fleet through the long unsupervised build with zero human intervention
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 — zipsearcher, end to end: does the fleet ship real software from one sentence?

> **What this scenario proves — read before writing or running a step (Rule 0.b is the whole point).**
>
> This is NOT a checklist the runner executes. It is a single directive followed by a long observation.
> The runner is the HUMAN USER: it creates ONE agent (the MANAGER) in setup, types ONE request into the
> MANAGER's chat, and from then on does **only four things** — approve a sudo/permission modal when the UI
> raises one, answer a direct question the MANAGER asks the user, watch (read-only) and verify artifacts on
> disk / GitHub, and finally install the finished tool as a user would. **Everything in steps 2–12 of the
> user's spec is done BY THE FLEET, unprompted.** The MANAGER creates the other two agents, writes and routes
> the TRDDs, approves/refuses them, drives the GitHub workflow through the MAINTAINER and AUTONOMOUS, and
> reports back. If the runner ever types into the AUTONOMOUS or MAINTAINER chat, queues a command, or does an
> agent's job for it, the run is **INVALID** (Rule 6) — restart from S001. An agent that stalls, mis-routes,
> skips a review, ships a broken PR the MAINTAINER waves through, or has to be coached is a **FAIL** (Rule 0.b):
> the finding is a real bug, fixed at its CAUSE (role-plugin / skill / rule / server — never by talking to the
> agent, Rule 4), then rerun.
>
> **This scenario has REAL outward side effects.** It creates a real `Emasoft/zipsearcher` repo, real PRs, and a
> real release on GitHub via the shared @Emasoft `gh` auth. Cleanup DELETES the repo. Never run this against a
> repo name that holds real work. A `zipsearcher` that already exists aborts setup — it is not overwritten.
>
> **A false PASS is worse than a FAIL.** If the tool "works" only because the runner fixed the code, wrote the
> PR, or told the MAINTAINER to approve, the verdict is FAIL and the finding is "the fleet did not do X on its
> own." The value of this test is the answer to one question: *given a real, non-trivial software goal, does an
> AI Maestro fleet organize itself and ship it?*
>
> **UNSUPERVISED + NEVER-STOP — a second thing this test proves, equally load-bearing (USER, 2026-07-22).**
> The build is long and WILL hit interruptions — rate limits, idle gaps, the odd crash. The fleet must survive
> them ON ITS OWN, through the janitor heartbeat cron + the ai-maestro server continuity daemon (auto-resume,
> account rotation on 429, session resurrection) — NOT through the runner. The runner is FORBIDDEN from any
> keep-alive: no manual resume, no re-prompt, no "are you still there" poke, no compacting on an agent's
> behalf. When an agent goes quiet the ONLY question is whether the CONTINUITY SUBSTRATE brings it back. An
> agent that stops and STAYS stopped — or that only kept going because the runner nudged it — is a **FAIL**.
> This is why the janitor cron must be armed in every agent and the server daemon active before the brief:
> the harness is "ready" only if it keeps the fleet working while nobody is watching.

---

## Phase 0: SAFE-SETUP

#### S001: Run the shared setup
- **Action:** Run `tests/scenarios/scripts/setup-SCEN-031.sh` (delegates to `scenario-setup.sh 31`).
- **Goal:** Config backed up with a SHA256 manifest; the `scen031-sample-zips` dir-fixture verified present; no orphan `scen031-*`/`zip*` tmux sessions.
- **Creates:** `state-backups/SCEN-031_<ts>/`
- **Modifies:** nothing
- **Verify:** Script exits 0; backup dir exists with `MANIFEST.sha256`; the sample-zip fixture exists.

#### S002: Verify the GitHub preconditions (read-only)
- **Action:** `gh auth status` (must be the @Emasoft identity); `gh repo view Emasoft/zipsearcher` MUST 404 (repo absent); `gh repo view <template-repo>` MUST succeed and report `isTemplate: true`.
- **Goal:** `gh` is authed, the target repo name is free, and the template exists.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** auth ok; `zipsearcher` absent; template present + is a template. If `zipsearcher` exists, ABORT (do not overwrite real work) and surface it.

#### S003: Log in and baseline the dashboard
- **Action:** `aim_login`, then screenshot the agent list.
- **Goal:** Logged-in dashboard; baseline captured for the post-cleanup comparison.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved.

#### S004: Create the MANAGER (the fleet's only entry point)
- **Action:** Agent Creation Wizard → name `scen031-manager` → title MANAGER → finish. Handle the sudo modal with `aim_sudo_modal`.
- **Goal:** A MANAGER exists and its session starts. This is the ONE agent the runner creates.
- **Creates:** agent `scen031-manager` at `~/agents/scen031-manager/`
- **Modifies:** `registry.json`, `governance.json` (owner/manager wiring)
- **Verify:** `GET /api/agents/{id}` → `.agent.governanceTitle === 'manager'`; sidebar badge reads MANAGER.

#### S005: Wake the MANAGER, arm its continuity substrate, confirm idle
- **Action:** Wake `scen031-manager`; wait for the idle prompt. Confirm the janitor heartbeat is armed in its session (it self-arms on wake via the core plugin; if it is not, that is a continuity-substrate bug — Rule 4, fix it). Confirm the ai-maestro server's continuity/daemon functionality is live (auto-resume / rate-limit recovery / resurrection).
- **Goal:** A live MANAGER session whose continuity substrate (janitor cron + server daemon) is ACTIVE — so it will self-sustain unsupervised, never kept alive by the runner.
- **Creates:** 1 tmux session; the `[janitor-heartbeat]` cron for this agent
- **Modifies:** nothing
- **Verify:** badge shows waiting/idle (5-state model), not `exited`; a `[janitor-heartbeat]` cron exists for the session; the server continuity daemon reports active. If the janitor is NOT armed or the daemon is down, the fleet cannot run unsupervised → fix the cause before proceeding (Rule 4). Do NOT proceed by planning to nudge the agent yourself — that would invalidate the never-stop proof.

---

## Phase 1: ONE directive. Then stop driving.

> This is the load-bearing step. Everything after it is observation + verification + the four permitted
> user actions (sudo approval, answering a MANAGER question, read-only checks, final install). If the runner
> types into the AUTONOMOUS or MAINTAINER, the run is INVALID (Rule 6).

#### S006: Brief the MANAGER — the whole project, in one message
- **Action:** Select `scen031-manager` → **Chat** section (never the terminal) → type ONE directive and send, verbatim:
  *"Build me a command-line tool called **zipsearcher** that searches for files by name INSIDE zip archives
  WITHOUT decompressing them (read the zip central directory only). I want it developed properly: write the
  requirements first, create an autonomous developer agent and a maintainer agent to do the work, use GitHub
  with pull-request review, and ship a v1.0.0 release. Create the repo from the template `<template-repo>`.
  Tell me when it is done and I will install and test it myself."*
  (Substitute the real template repo name from S002.)
- **Goal:** The MANAGER holds the complete goal. From here it must plan and delegate on its own.
- **Creates:** the start of a TRDD + AMP/agent-creation chain (expected — observed, not driven)
- **Modifies:** nothing yet
- **Verify:** the directive appears in the MANAGER's chat. Screenshot.

---

## Phase 2: Requirements — does the MANAGER write a TRDD? (user spec step 2)

#### S007: STOP and observe — the MANAGER defines the requirements
- **Action:** Do nothing but watch (read-only) the MANAGER terminal + its workdir for up to 15 min. Screenshot at each state change. Do NOT prod, hint, or name a skill/tool.
- **Goal:** The MANAGER authors a requirements TRDD for zipsearcher on its own.
- **Creates:** nothing (runner)
- **Modifies:** nothing (runner)
- **Verify:** a TRDD file appears under the MANAGER's design tree (`~/agents/scen031-manager/design/` or the project design dir) describing zipsearcher's requirements (zip central-directory read, filename search, CLI). Read it. Classify: **written on its own → continue**; **stalled → FAIL** (fix the MANAGER role-plugin, Rule 4, rerun); **asks the user a genuine scoping question → answer it once, plainly, then resume observing.**

---

## Phase 3: The fleet — does the MANAGER create the two agents? (user spec step 3)

#### S008: Observe — the MANAGER creates an AUTONOMOUS developer and a MAINTAINER
- **Action:** Watch (read-only) the MANAGER terminal + poll the registry. The MANAGER must create two agents itself (via its `aimaestro-agent.sh`/creation tooling), naming them and installing any local-scope skills they need (e.g. a Python/testing skill for the developer). Approve any sudo/permission modal the UI raises (`aim_sudo_modal`).
- **Goal:** An AUTONOMOUS agent and a MAINTAINER agent now exist, created BY THE MANAGER.
- **Creates:** (by the MANAGER) 1 AUTONOMOUS + 1 MAINTAINER agent under `~/agents/<name>/` each
- **Modifies:** `registry.json`
- **Verify:** `GET /api/agents` shows two NEW agents whose `governanceTitle` is `autonomous` and `maintainer`, each with its role-plugin installed (R9.13). **Each new agent's continuity substrate must also come up** — on its first wake its janitor heartbeat arms and the server daemon covers it, so the AUTONOMOUS and MAINTAINER ALSO self-sustain unsupervised (they will be running long unattended stretches). Record their names (do NOT hardcode — the MANAGER chose them). If the MANAGER creates the wrong titles, a team (this is team-less), only one agent, OR an agent whose janitor heartbeat never arms → behavioural FAIL, fix the cause.

---

## Phase 4: Development handoff + TRDD approvals (user spec steps 4–5)

#### S009: Observe — the MANAGER hands the TRDD to the AUTONOMOUS and instructs it to build
- **Action:** Watch the MANAGER's + AUTONOMOUS's Messages tabs (read-only). The MANAGER must MESSAGE the AUTONOMOUS (R42: a directive is a message, never a keystroke) with the requirements TRDD and the instruction to develop zipsearcher.
- **Goal:** The AUTONOMOUS receives the TRDD as an AMP message it reads from its inbox and begins work.
- **Creates:** nothing (runner)
- **Modifies:** nothing (runner)
- **Verify:** an AMP message `from: <manager> to: <autonomous>` carrying the TRDD reference exists; the AUTONOMOUS transcript shows it READING its inbox then starting. A raw instruction typed into the AUTONOMOUS pane with no inbox read = injection = hard FAIL (R42).

#### S010: Observe — the MANAGER approves or refuses each TRDD the AUTONOMOUS writes
- **Action:** Watch (read-only) as the AUTONOMOUS authors implementation TRDDs and routes them to the MANAGER, and the MANAGER approves or refuses them (R41 APPROVAL protocol; R49 refusals must name a defect + a path forward, not a bare "no").
- **Goal:** The approval loop actually runs: proposals flow up, decisions flow down as messages, and a refusal (if any) is a guide, not a gate.
- **Creates:** nothing (runner)
- **Modifies:** nothing (runner)
- **Verify:** TRDD frontmatter shows `approved: true` (or a documented refusal with a named defect) via the MANAGER; the `## Approval log` records who decided and when. **DERIVED TRDDs are correct:** the AUTONOMOUS authors NPT/EHT children properly — each derived TRDD is DEPTH-1 (empty `npt:`/`eht:`, it spawns no derived TRDDs of its own), siblings are ordered via `blocked-by:` (NEVER by putting a sibling in `npt:`), and the parent stays out of `complete` until every EHT is terminal (the completion gate). A silent approval with no message chain, a bare refusal, or malformed/missing derived TRDDs is a behavioural finding.

---

## Phase 5: The repo — MAINTAINER creates zipsearcher from a template (user spec step 6)

#### S011: Observe — the MANAGER instructs the MAINTAINER to create, protect, add CI, and clone the repo
- **Action:** Watch (read-only) the MAINTAINER. On the MANAGER's message, the MAINTAINER must: create `Emasoft/zipsearcher` FROM the template (`gh repo create --template`), apply the baseline branch rulesets (no-force/no-delete/linear + PR + required-checks — the ratified baseline), **set up a CI workflow** (`.github/workflows/` GitHub Actions that runs zipsearcher's test suite on every PR), and clone it into its own workdir.
- **Goal:** A real, branch-protected `Emasoft/zipsearcher` repo WITH working CI exists, cloned locally by the MAINTAINER.
- **Creates:** (by the MAINTAINER) the GitHub repo + a CI workflow + a local clone under `~/agents/<maintainer>/`
- **Modifies:** GitHub (repo + rulesets + workflow)
- **Verify:** `gh repo view Emasoft/zipsearcher` succeeds and was generated from the template; `gh api repos/Emasoft/zipsearcher/rulesets` shows the baseline branch rules; a CI workflow exists under `.github/workflows/` and runs on PRs, and the ruleset's required status check references it; the local clone exists. If the MAINTAINER skips branch protection OR ships no CI → finding (both are the floor — PRs must be gated on green CI).

---

## Phase 6: AUTONOMOUS forks + clones (user spec step 7)

#### S012: Observe — the MANAGER asks the AUTONOMOUS to fork + clone zipsearcher
- **Action:** Watch (read-only). On the MANAGER's message, the AUTONOMOUS forks `Emasoft/zipsearcher` and clones its fork locally (the fork/clone-to-scratch flow, so it opens PRs from its fork).
- **Goal:** The AUTONOMOUS has its own fork + clone to develop in and PR from.
- **Creates:** (by the AUTONOMOUS) a fork + local clone
- **Modifies:** GitHub (fork)
- **Verify:** the fork exists under the AUTONOMOUS's control; a local clone is present in its workdir.

---

## Phase 7: Build → PR → review → iterate until done (user spec steps 8–10)

> This is the long haul and the real test of the review loop. It repeats: AUTONOMOUS implements a slice
> (a TRDD), writes tests, opens a PR; the MAINTAINER reviews it, and if it finds a bug it sends the PR BACK
> with a concrete request; the AUTONOMOUS fixes and re-pushes; the MAINTAINER merges only when it is genuinely
> ready. No self-merge; no MAINTAINER rubber-stamp. Observe multiple cycles.

#### S013: Observe — the AUTONOMOUS opens PRs with real progress
- **Action:** Watch (read-only) + poll `gh pr list --repo Emasoft/zipsearcher`. The AUTONOMOUS implements the zip-central-directory search + CLI incrementally and opens PRs.
- **Goal:** Real code lands as PRs, each self-identified per R22 (the shared @Emasoft identity).
- **Verify:** PRs appear from the AUTONOMOUS's fork; each contains real zipsearcher code + tests; each PR body begins with the agent self-identification line (R22). Read a diff to confirm it actually reads the zip central directory (no full decompression).

#### S014: Observe — the MAINTAINER reviews every PR and sends bugs back
- **Action:** Watch (read-only) + poll `gh pr view <n> --repo Emasoft/zipsearcher --comments`. The MAINTAINER reviews each PR; when it finds a defect it requests changes with a concrete finding (not "looks good"); it merges only when ready.
- **Goal:** A genuine review loop: at least one PR is sent back for a fix and improved before merge. No self-merge by the AUTONOMOUS; no empty approval by the MAINTAINER.
- **Verify:** review comments name concrete issues; a PR shows a request-changes → fix → re-review → merge cycle; merges are by the MAINTAINER, not the author. A PR merged with a known failing test, or approved with no substantive review, is a hard FAIL (the plugin-tests-are-the-plugin's-job discipline + R49).

#### S015: Observe — the AUTONOMOUS iterates to completion; the MANAGER monitors via scripts; nobody nudges
- **Action:** Watch (read-only) across the full cycle: approvals (MANAGER), tests green in CI, PRs opened, reviews (MAINTAINER), merges — repeated until the tool is complete. Throughout, the MANAGER MONITORS the two agents' status via the ai-maestro-plugin skills / `aimaestro-agent.sh` status verbs (read-only status polling — this is MONITORING, not driving; R42 forbids injection, not observation). The runner does NOTHING — no nudge, no resume, no keep-alive. Then the AUTONOMOUS messages the MANAGER that zipsearcher is done.
- **Goal:** The software reaches feature-complete via the governed loop; the MANAGER stays aware of both agents through the status scripts; and the whole long run self-sustains through interruptions via the continuity substrate, with ZERO runner intervention.
- **Verify:** the merged `main` of `Emasoft/zipsearcher` is a working zipsearcher (searches names inside a zip via the central directory, no decompression); its test suite passes in CI; the MANAGER's transcript shows it polling the two agents' status via the scripts/skills; an AMP message `from: <autonomous> to: <manager>` reports completion. **Never-stop check:** across the whole run, every agent that went quiet was brought back by the janitor cron / server continuity daemon, NOT by the runner — verify via cron-fire evidence + server continuity logs and the ABSENCE of any runner keep-alive action. An agent that stopped and stayed stopped, or that only continued because the runner poked it, is a hard FAIL.

---

## Phase 8: Release + MANAGER's own smoke test (user spec steps 11–12)

#### S016: Observe — the MANAGER asks the MAINTAINER to cut a v1.0.0 release
- **Action:** Watch (read-only). On the MANAGER's message, the MAINTAINER creates a GitHub release tagged `1.0.0` on `Emasoft/zipsearcher`.
- **Goal:** A published `v1.0.0` release exists.
- **Verify:** `gh release view 1.0.0 --repo Emasoft/zipsearcher` succeeds and is published (not draft).

#### S017: Observe — the MANAGER installs the release, smoke-tests it, and notifies the USER
- **Action:** Watch (read-only) as the MANAGER installs the released zipsearcher locally and runs it against a zip; on success it MESSAGES the user (the runner) that the project is complete.
- **Goal:** The MANAGER independently confirms the shipped artifact works before declaring done, and reports to the user.
- **Verify:** the MANAGER's transcript shows a real install + a successful search run; a completion message is delivered to the user surface. A "done" claim with no install/run evidence = truth failure = hard FAIL.

---

## Phase 9: The USER verifies (user spec steps 13–14)

#### S018: The runner (as USER) installs zipsearcher and verifies it on a sample zip
- **Action:** This IS a permitted user action. Install the published `1.0.0` release into a scratch dir (`/tmp`), then run zipsearcher against `tests/scenarios/fixtures/scen031-sample-zips/<sample>.zip` searching for the known file `needle.txt`.
- **Goal:** The finished software works for the user, on a real zip, finding a file inside without decompressing.
- **Creates:** a throwaway install in `/tmp`
- **Modifies:** nothing in the project
- **Verify:** zipsearcher reports `needle.txt` found inside the sample zip (and a non-existent name is reported not-found). If it works → **step 14 satisfied: the harness is READY — PROVIDED the never-stop condition ALSO held:** the fleet ran the ENTIRE build unsupervised, self-recovering from every interruption via the janitor cron + server continuity daemon, with ZERO runner keep-alive. If the tool works but any agent had to be nudged/resumed by the runner to get here, the harness is NOT ready — that is a FAIL. If the tool fails → the fleet shipped a broken 1.0.0 that its own smoke-test missed: a hard FAIL with the deepest finding of all.

---

## Phase CLEANUP: Restore Original State (Rule 1)

> Cleanup here also removes REAL GitHub artifacts. Order matters: delete the agents (kills sessions + local
> clones), then delete the GitHub repo (and the AUTONOMOUS's fork), then config restore.

#### S019: Delete the AUTONOMOUS and MAINTAINER agents (folders included)
- **Action:** For each (created by the MANAGER): profile → Advanced → Danger Zone → Delete Agent → `aim_sudo_modal` → check "Also delete agent folder" → type the name → Delete Forever.
- **Goal:** Both agents gone, sessions killed, workdirs (with the local clones) removed.
- **Removes:** the AUTONOMOUS + MAINTAINER agents + `~/agents/<each>/`
- **Verify:** neither is in the registry; neither folder exists.

#### S020: Delete the MANAGER (folder included)
- **Action:** MANAGER profile → Danger Zone → Delete Agent → `aim_sudo_modal` → "Also delete agent folder" → type `scen031-manager` → Delete Forever.
- **Goal:** MANAGER gone, folder gone.
- **Removes:** `scen031-manager` + `~/agents/scen031-manager/`
- **Verify:** absent from the registry; folder does not exist.

#### S021: Purge the cemetery
- **Action:** Settings → Cemetery → Purge each `scen031-*` / MANAGER-named / AUTONOMOUS-named / MAINTAINER-named entry from this run.
- **Goal:** No test residue in the graveyard.
- **Verify:** no entry from this run remains.

#### S022: Delete the real GitHub artifacts
- **Action:** `gh repo delete Emasoft/zipsearcher --yes` (removes the repo, its PRs, and the 1.0.0 release); then delete the AUTONOMOUS's fork if it survived agent deletion (`gh repo delete <fork> --yes`). Remove the `/tmp` throwaway install from S018.
- **Goal:** GitHub is back to its pre-test state; no `zipsearcher` repo, no fork, no release.
- **Removes:** the GitHub repo + fork + release; the `/tmp` install
- **Verify:** `gh repo view Emasoft/zipsearcher` 404s; the fork 404s.

#### S023: STATE-WIPE — restore configuration files
- **Action:** Compare each `rewipe-list` file against the S001 backup; restore any that still differ after the UI deletions.
- **Goal:** All config files match the pre-test state.
- **Removes:** nothing
- **Verify:** SHA256 match for every file in the manifest.

#### S024: Post-test screenshot
- **Action:** Screenshot the dashboard.
- **Goal:** UI identical to the S003 baseline.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** visual comparison with the baseline.
