---
number: 31
phase: 3
phase-of: SCEN-031
name: zipsearcher C — release, USER verification, and full cleanup
version: "1.0"
description: >
  PHASE 3 of 3 (1 → 2 → 3, run in order, NO state reset between them). Phase 3 starts on the LIVE
  fleet and built repo phase 2 left behind. The MANAGER has the MAINTAINER cut a v1.0.0 release, then
  installs and smoke-tests it itself before telling the user it is done. The runner — as the USER —
  then installs the published release and verifies it finds a known file inside a real sample zip
  without decompressing. phase 3 OWNS CLEANUP for the whole 3-phase run: it deletes all three agents
  and their folders, purges the cemetery, deletes the real GitHub repo + fork + release, and restores
  every config file backed up in phase 1.
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
  - A throwaway install of zipsearcher in /tmp (removed in S022)
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
  - "The three agents are HIBERNATED (phase 2 parked them). This phase WAKES them in S015w before observing."
  - "The ai-maestro server was NOT restarted between phases"
  - The three agents from phase 1 are still present and live
  - "`Emasoft/zipsearcher` exists with a feature-complete `main` and green CI"
  - The phase 1 state-backup dir (with `MANIFEST.sha256`) is intact for the STATE-WIPE
  - GitHub `gh` CLI authenticated as the shared @Emasoft identity
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 phase 3 — release, verify, and clean up

> **PHASE 3 of 3.** Run order is **1 → 2 → 3**. There is **NO state reset between phases** — phase 3
> starts exactly where phase 2 ended and does **NOT** re-run setup.
> **Phase 3 OWNS CLEANUP for the entire run.** Nothing before it deletes anything.

## ENTRY STATE — verify, do NOT create

Read phase 2's report FIRST. Take from it, never guess:

- [ ] The three agent names (MANAGER `scen031-manager`, plus the AUTONOMOUS and MAINTAINER names the
      MANAGER chose)
- [ ] **The AUTONOMOUS's fork full name** (S022 must delete it)
- [ ] The phase 1 **baseline screenshot path** (S024 compares against it)
- [ ] The phase 1 **state-backup dir** path + `MANIFEST.sha256` (S023 restores from it)
- [ ] `Emasoft/zipsearcher` exists with feature-complete `main` and green CI

#### S015w: WAKE the fleet before observing anything
- **Action:** Via the UI, wake all three agents (names from phase 2's report). Wait for each to reach an idle prompt and confirm its janitor heartbeat is armed.
- **Goal:** The parked fleet resumes exactly where phase 2 left it, so the release can proceed.
- **Verify:** all three show waiting/idle (not `exited`); a `[janitor-heartbeat]` cron exists per session. An agent that will not wake, or wakes without its heartbeat, is a **continuity-substrate bug** — Rule 4, fix the cause.

> **This wake is SETUP, not a nudge.** Phase 2 deliberately parked the fleet so it could not work
> unobserved. The never-stop proof resumes the moment the fleet is awake: from here on, an agent that
> stalls must be revived by the janitor cron / continuity daemon, **never** by you.

If the fleet did NOT reach feature-complete in phase 2, **still run phase 3** — the cleanup must happen
regardless of verdict. Record the release/verify steps as BLOCKED with the reason, then clean up fully.
Leaving a parked fleet and a real GitHub repo behind is never acceptable.

## EXIT STATE

- [ ] Release + USER verification carried out (or explicitly recorded BLOCKED with the reason)
- [ ] All three agents deleted, folders included; cemetery purged
- [ ] `Emasoft/zipsearcher` and the fork both 404; the `/tmp` install removed
- [ ] Every `rewipe-list` file SHA256-matches the phase 1 backup
- [ ] Dashboard visually matches the phase 1 baseline screenshot

---

## TOKEN DISCIPLINE — mandatory

1. **NEVER dump a full-page snapshot or screenshot to check progress** — use the cheapest probe
   (`gh release view`, `gh repo view`, `tmux capture-pane -p | tail -30`). Reserve `snapshotForAI()`
   for locating an element you are about to CLICK — which in this phase is genuinely needed for the
   deletion dialogs, so use it there and drop it after.
2. **Extract the fact, then DROP the blob.**
3. **Poll on a timer, not in a spin** (120–300s while waiting on the release).
4. **Batch deterministic checks into ONE bash call**, stopping at the first failure. The cleanup
   verifications (S019–S023) batch well.
5. **Read fixed inputs ONCE** (this file, phase 2's report). Never re-read.
6. **Screenshot per STEP (Rule 10), not per poll.**
7. **Report your screenshot and poll counts at the end.**

---

## Stage 8: Release + the MANAGER's own smoke test

#### S016: Observe — the MANAGER asks the MAINTAINER to cut a v1.0.0 release
- **Action:** Watch (read-only). On the MANAGER's message the MAINTAINER creates a GitHub release tagged `1.0.0` on `Emasoft/zipsearcher`.
- **Goal:** A published `v1.0.0` release exists.
- **Verify:** `gh release view 1.0.0 --repo Emasoft/zipsearcher` succeeds and is published (not draft).

#### S017: Observe — the MANAGER installs the release, smoke-tests it, and notifies the USER
- **Action:** Watch (read-only) as the MANAGER installs the released zipsearcher locally and runs it against a zip; on success it MESSAGES the user (the runner) that the project is complete.
- **Goal:** The MANAGER independently confirms the shipped artifact works before declaring done.
- **Verify:** the MANAGER's transcript shows a real install + a successful search run; a completion message reaches the user surface. **A "done" claim with no install/run evidence is a truth failure = hard FAIL** — and it is the single most important thing this step catches.

---

## Stage 9: The USER verifies

#### S018: The runner (as USER) installs zipsearcher and verifies it on a sample zip
- **Action:** This IS a permitted user action. Install the published `1.0.0` release into a scratch dir (`/tmp`), then run zipsearcher against `tests/scenarios/fixtures/scen031-sample-zips/<sample>.zip` searching for the known file `needle.txt`. Also search a name that does NOT exist.
- **Goal:** The finished software works for the user, on a real zip, finding a file inside without decompressing.
- **Creates:** a throwaway install in `/tmp`
- **Modifies:** nothing in the project
- **Verify:** zipsearcher reports `needle.txt` found, and reports not-found for the absent name. If it works → **the harness is READY, PROVIDED the never-stop condition ALSO held** across A and B: the fleet self-recovered from every interruption via the janitor cron + continuity daemon, with ZERO runner keep-alive. If the tool works but any agent had to be nudged to get here, the harness is NOT ready — that is a FAIL. If the tool fails → the fleet shipped a broken 1.0.0 its own smoke-test missed: a hard FAIL with the deepest finding of all.

---

## Stage CLEANUP: Restore Original State (Rule 1)

> Cleanup removes REAL GitHub artifacts. **Order matters:** delete the agents first (kills sessions +
> local clones), then the GitHub repo and fork, then restore config. Use the UI for agent deletion
> (Rule 6) — never `rm -rf` an agent folder.

#### S019: Delete the AUTONOMOUS and MAINTAINER agents (folders included)
- **Action:** For each (names from phase 2's report): profile → Advanced → Danger Zone → Delete Agent → `aim_sudo_modal` → check "Also delete agent folder" → type the name → Delete Forever.
- **Goal:** Both agents gone, sessions killed, workdirs (with local clones) removed.
- **Removes:** the AUTONOMOUS + MAINTAINER + `~/agents/<each>/`
- **Verify:** neither is in the registry; neither folder exists. Expect a sudo modal per deletion — sudo tokens are one-shot.

#### S020: Delete the MANAGER (folder included)
- **Action:** MANAGER profile → Danger Zone → Delete Agent → `aim_sudo_modal` → "Also delete agent folder" → type `scen031-manager` → Delete Forever.
- **Goal:** MANAGER gone, folder gone.
- **Removes:** `scen031-manager` + `~/agents/scen031-manager/`
- **Verify:** absent from the registry; folder does not exist.

#### S021: Purge the cemetery
- **Action:** Settings → Cemetery → Purge each entry from this run (`scen031-*` and the two MANAGER-chosen names).
- **Goal:** No test residue in the graveyard.
- **Verify:** no entry from this run remains.

#### S022: Delete the real GitHub artifacts
- **Action:** `gh repo delete Emasoft/zipsearcher --yes` (removes the repo, its PRs, and the 1.0.0 release); then delete the AUTONOMOUS's fork by the **full name recorded in phase 2's report** (`gh repo delete <fork> --yes`). Remove the `/tmp` throwaway install from S018.
- **Goal:** GitHub back to its pre-test state.
- **Removes:** the repo + fork + release; the `/tmp` install
- **Verify:** `gh repo view Emasoft/zipsearcher` 404s; the fork 404s. **Double-check each delete target before running it** — these are irreversible and use the shared @Emasoft identity.

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

## PHASE 3 END — the whole-run verdict

#### S024z: Write the consolidated verdict
- **Action:** Write the phase report to `reports/scenarios-runner/`, and state the **verdict for the ENTIRE 3-phase run**, not just phase 3. It is a PASS only if: the fleet self-organized from one directive (A), shipped working reviewed software (B), released and verified it (C), **and** never needed a runner nudge at any point. Cite the three phase reports.
- **Goal:** One answer to the question the scenario exists to ask: *given a real software goal, does an AI Maestro fleet organize itself and ship it?*
- **Verify:** the verdict names which phase each finding came from, and the EXIT STATE of all three phases is accounted for.
