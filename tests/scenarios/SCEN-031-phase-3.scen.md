---
number: 31
phase: 3
phase-of: SCEN-031
name: portfolio C — release, USER verification, and full cleanup, for THREE projects
version: "2.0"
description: >
  PHASE 3 of 3 (1 → 2 → 3, run in order, NO state reset between them). Phase 3 starts on the LIVE
  seven-agent fleet and the (up to) three built repos phase 2 left behind. For EACH project, the
  MANAGER has that project's maintainer cut a v1.0.0 release, then installs and smoke-tests it itself
  before telling the user it is done. The runner — as the USER — then installs each published release
  and verifies it does its job on a real input. phase 3 OWNS CLEANUP for the whole 3-phase run: it
  deletes all seven agents and their folders, purges the cemetery, deletes all three real GitHub repos
  + their forks + releases, and restores every config file backed up in phase 1.
client: claude
interhosts: false
device: desktop
subsystems:
  - agent-registry
  - element-management-service
  - agent-messaging
  - governance
ui_sections:
  - Agent view -> Terminal section (READ-ONLY observation)
  - Agent Profile -> Advanced -> Danger Zone (agent deletion)
  - Settings -> Cemetery
data_produced:
  - Throwaway installs of zipsearcher, tarot-reader, weather-reporter in /tmp (removed in S022)
  - "NOTHING NEW that survives: this phase is net-destructive by design"
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
  - "PHASE 2 COMPLETED, and its report read — this phase consumes phase 2's EXIT STATE as its entry contract"
  - "The seven agents are HIBERNATED (phase 2 parked them). This phase WAKES them in S015w before observing."
  - "The ai-maestro server was NOT restarted between phases"
  - The seven agents from phase 1 are still present
  - "For each project that reached feature-complete in phase 2, its repo has a feature-complete `main` and green CI"
  - The phase 1 state-backup dir (with `MANIFEST.sha256`) is intact for the STATE-WIPE
  - GitHub `gh` CLI authenticated as the shared @Emasoft identity
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 phase 3 — release, verify, and clean up THREE projects

> **PHASE 3 of 3.** Run order is **1 → 2 → 3**. There is **NO state reset between phases** — phase 3
> starts exactly where phase 2 ended and does **NOT** re-run setup.
> **Phase 3 OWNS CLEANUP for the entire run.** Nothing before it deletes anything.

## THE THREE PROJECTS

| # | Project | What it does | Repo (expected) | Pair |
|---|---|---|---|---|
| P1 | **zipsearcher** | search files by name INSIDE a zip via the central directory, no decompression | `Emasoft/zipsearcher` | dev₁ + maint₁ |
| P2 | **tarot-reader** | draw tarot cards; render each as ASCII / Unicode art | `Emasoft/tarot-reader` | dev₂ + maint₂ |
| P3 | **weather-reporter** | report the local weather when called (a free, no-key source) | `Emasoft/weather-reporter` | dev₃ + maint₃ |

## ENTRY STATE — verify, do NOT create

Read phase 2's report FIRST. Take from it, never guess:

- [ ] All seven agent names (MANAGER `scen031-manager`, plus the three dev + three maintainer names
      the MANAGER chose, mapped to P1/P2/P3)
- [ ] **All THREE fork full names** (S022 must delete each one)
- [ ] The phase 1 **baseline screenshot path** (S024 compares against it)
- [ ] The phase 1 **state-backup dir** path + `MANIFEST.sha256` (S023 restores from it)
- [ ] For each project, whether it reached feature-complete with green CI (per-project honest verdict from 2d)

#### S015w: WAKE the whole fleet before observing anything
- **Action:** Via the UI, wake all seven agents (names from phase 2's report).
- **Goal:** The parked fleet resumes exactly where phase 2 left it, so releases can proceed for whichever project(s) reached feature-complete.
- **Verify:** all seven show waiting/idle (not `exited`). An agent that will not wake IS a continuity-substrate bug — Rule 4, fix the cause.

> **A per-agent `[janitor-heartbeat]` cron is NOT expected, and its absence is NOT a failure**
> (phase 1 ISSUE-001). The core plugin does not self-arm it; phase 1 saw no `scheduled_tasks.json` in
> any agent while all seven worked unattended and woke unaided. Do not stop to "fix" a missing cron.

> **This wake is SETUP, not a nudge.** Phase 2 deliberately parked the fleet so it could not work
> unobserved. The never-stop proof resumes the moment the fleet is awake: from here on, an agent that
> stalls must be revived by the janitor cron / continuity daemon, **never** by you.

If a project did NOT reach feature-complete in phase 2, **still run phase 3 for that project** — the
cleanup must happen regardless of verdict. Record its release/verify steps as BLOCKED with the reason,
then clean up fully. Leaving a parked fleet and real GitHub repos behind is never acceptable, whether
zero, one, two, or all three projects shipped.

## EXIT STATE

- [ ] Release + USER verification carried out for each project (or explicitly recorded BLOCKED with the reason)
- [ ] All seven agents deleted, folders included; cemetery purged
- [ ] All three repos and their forks both 404; every `/tmp` install removed
- [ ] Every `rewipe-list` file SHA256-matches the phase 1 backup
- [ ] Dashboard visually matches the phase 1 baseline screenshot

---

## TOKEN DISCIPLINE — mandatory

1. **NEVER dump a full-page snapshot or screenshot to check progress** — use the cheapest probe
   (`gh release view`, `gh repo view`, `tmux capture-pane -p | tail -30`). Reserve `snapshotForAI()`
   for locating an element you are about to CLICK — which in this phase is genuinely needed for the
   deletion dialogs, so use it there and drop it after.
2. **Extract the fact, then DROP the blob.**
3. **Batch the per-project checks into ONE bash call each**, looping P1/P2/P3, stopping at the first
   failed assertion per project. Never structure this phase around a wait — verify what has already
   happened, per project, per Rule 15.
4. **Batch deterministic checks into ONE bash call**, stopping at the first failure. The cleanup
   verifications (S019–S023) batch well across all three repos.
5. **Read fixed inputs ONCE** (this file, phase 2's report). Never re-read.
6. **Screenshot per STEP (Rule 10), not per project.**
7. **Report your screenshot count at the end.**

---

## Stage 8: Release + each MANAGER's own smoke test — FOR EACH PROJECT

> **RULE 15 — YOU NEVER WAIT.** Both steps below verify something that has **already
> happened**, per project. Check the precondition in one cheap call before either:
>
> ```bash
> for repo in zipsearcher tarot-reader weather-reporter; do
>   echo "$repo: $(gh release view 1.0.0 --repo Emasoft/$repo --json isDraft,publishedAt 2>/dev/null || echo NONE)"
> done
> ```
>
> No release yet for a project → record `BLOCKED: no v1.0.0 release` for S016+S017 **for that
> project only**, and continue checking the others. If NONE of the three have a release, skip straight
> to the CLEANUP stage and let the orchestrator decide whether to re-spawn later. Cleanup must run
> regardless of verdict — never leave a live fleet and real GitHub repos behind because no release
> appeared.

#### S016: For EACH project — verify the v1.0.0 release exists and is published
- **Action:** For every one of the three repos, confirm that project's maintainer cut a release tagged `1.0.0` on the MANAGER's message.
- **Goal:** A published `v1.0.0` release exists for each project that finished (record BLOCKED per project for the rest).
- **Verify (per project):** `gh release view 1.0.0 --repo Emasoft/<repo>` succeeds and is published (**not** a draft).

#### S017: For EACH project — verify the MANAGER installed and smoke-tested the release before declaring it done
- **Action:** Read the MANAGER's transcript and the user-facing message surface for each project's completion claim and the evidence behind it.
- **Goal:** The MANAGER independently confirmed each shipped artifact works before saying it was done — per project.
- **Verify (per project):** the transcript shows a **real install and a successful run** of that project's tool; a completion message reached the user surface. **A "done" claim with no install/run evidence is a truth failure = hard FAIL for that project** — the single most important thing this step catches, because it is the difference between shipping software and reporting that you did.

---

## Stage 9: The USER verifies EACH of the three tools

#### S018: The runner (as USER) installs and verifies EACH of the three tools on a real input
- **Action:** This IS a permitted user action. For each project with a published release, install it into a scratch dir (`/tmp`), then:
  - **zipsearcher** — run it against `tests/scenarios/fixtures/scen031-sample-zips/<sample>.zip` searching for the known file `needle.txt`; also search a name that does NOT exist.
  - **tarot-reader** — draw N cards and print each as ASCII/Unicode art.
  - **weather-reporter** — invoke it and confirm it prints the current local weather from a live, no-key source.
- **Goal:** Each finished tool works for the user, on a real input, doing its stated job.
- **Creates:** throwaway installs in `/tmp`, one per project
- **Modifies:** nothing in the project
- **Verify (per project):** zipsearcher reports `needle.txt` found and not-found for the absent name; tarot-reader prints N cards' worth of art; weather-reporter prints a plausible current weather reading. If all installed tools work → **the harness is READY, PROVIDED the never-stop condition ALSO held** across phases 1–2 for every project: the fleet self-recovered from every interruption via the janitor cron + continuity daemon, with ZERO runner keep-alive. If a tool works but any agent had to be nudged to get here, the harness is NOT ready — that is a FAIL. If any tool fails → that project's fleet shipped a broken 1.0.0 its own smoke-test missed: a hard FAIL with the deepest finding of all, for that project.

---

## Stage CLEANUP: Restore Original State (Rule 1)

> Cleanup removes REAL GitHub artifacts across all three projects. **Order matters:** delete the
> agents first (kills sessions + local clones), then the GitHub repos and forks, then restore config.
> Use the UI for agent deletion (Rule 6) — never `rm -rf` an agent folder.

#### S019: Delete all six dev + maintainer agents (folders included)
- **Action:** For each of the six (names from phase 2's report, mapped to P1/P2/P3): profile → Advanced → Danger Zone → Delete Agent → `aim_sudo_modal` → check "Also delete agent folder" → type the name → Delete Forever.
- **Goal:** All six gone, sessions killed, workdirs (with local clones) removed.
- **Removes:** the three devs + three maintainers + their `~/agents/<each>/`
- **Verify:** none of the six is in the registry; none of the six folders exist. Expect a sudo modal per deletion — sudo tokens are one-shot.

#### S020: Delete the MANAGER (folder included)
- **Action:** MANAGER profile → Danger Zone → Delete Agent → `aim_sudo_modal` → "Also delete agent folder" → type `scen031-manager` → Delete Forever.
- **Goal:** MANAGER gone, folder gone.
- **Removes:** `scen031-manager` + `~/agents/scen031-manager/`
- **Verify:** absent from the registry; folder does not exist.

#### S021: Purge the cemetery
- **Action:** Settings → Cemetery → Purge each entry from this run (`scen031-*` and all six MANAGER-chosen names).
- **Goal:** No test residue in the graveyard.
- **Verify:** no entry from this run remains.

#### S022: Delete all THREE real GitHub artifacts (repos + forks)
- **Action:** For each of the three repos: `gh repo delete Emasoft/<repo> --yes` (removes the repo, its PRs, and its 1.0.0 release, if any); then delete that project's fork by the **full name recorded in phase 2's report** (`gh repo delete <fork> --yes`). Remove all three `/tmp` throwaway installs from S018.
- **Goal:** GitHub back to its pre-test state, for all three projects.
- **Removes:** three repos + three forks + their releases; the three `/tmp` installs
- **Verify:** `gh repo view Emasoft/<repo>` 404s for all three; all three forks 404. **Double-check each delete target before running it** — these are irreversible and use the shared @Emasoft identity.

#### S023: STATE-WIPE — restore configuration files
- **Action:** Compare each `rewipe-list` file against the **phase 1** backup; restore any that still differ after the UI deletions.
- **Goal:** All config files match the pre-test state.
- **Removes:** nothing
- **Verify:** SHA256 match for every file in the manifest.

#### S024: Post-test screenshot
- **Action:** Screenshot the dashboard.
- **Goal:** UI identical to the **phase 1 S003** baseline.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** visual comparison with that baseline.

---

## PHASE 3 END — the whole-run PORTFOLIO verdict

#### S024z: Write the consolidated verdict + Rule-11 individual proposals
- **Action:** Write the phase report to `reports/scenarios-runner/`, and state the **verdict for the ENTIRE 3-phase, THREE-project run**, not just phase 3. It is a PASS only if: the fleet self-organized THREE projects from one directive (phase 1), ran them CONCURRENTLY with no project starved (phase 2), shipped working reviewed software for all three, released and verified all three (phase 3), **and** never needed a runner nudge at any point for any project. Cite the three phase reports and the concurrency evidence recorded throughout. Then, for every phase-3 finding, author it as its OWN `design/proposals/TRDD-*.md` file (`column: proposal`, `labels: [scenario-improvement, scen-031, phase-3]`). **ONE finding = ONE file. NEVER a monolithic report of proposals.**
- **Goal:** One answer to the question the scenario exists to ask: *given three real software goals in one directive, does an AI Maestro fleet organize itself and ship all three, concurrently, unsupervised?*
- **Verify:** the verdict names which phase and which project each finding came from; the EXIT STATE of all three phases is accounted for; `grep -l 'phase-3' design/proposals/*.md` lists a matching TRDD per phase-3 finding.
