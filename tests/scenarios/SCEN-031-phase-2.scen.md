---
number: 31
phase: 2
phase-of: SCEN-031
name: zipsearcher B — build: handoff, approvals, repo, and the PR review loop to feature-complete
version: "1.0"
description: >
  PHASE 2 of 3 (1 → 2 → 3, run in order, NO state reset between them). Phase 2 starts on the LIVE
  fleet phase 1 left running and proves the governed development loop: the MANAGER hands the
  requirements TRDD to the AUTONOMOUS as an AMP message, approves/refuses each TRDD it writes, has
  the MAINTAINER create a branch-protected `Emasoft/zipsearcher` from a template WITH CI, has the
  AUTONOMOUS fork+clone and open PRs, and has the MAINTAINER genuinely review — sending at least one
  PR back — until zipsearcher is feature-complete on `main` with green CI. phase 2 performs NO
  cleanup and deletes nothing; it hands a LIVE fleet and a built repo to phase 3.
client: claude
interhosts: false
device: desktop
subsystems:
  - agent-messaging
  - kanban
  - governance
  - sessions-service
  - fleet-continuity
ui_sections:
  - Agent view -> Terminal section (READ-ONLY observation)
  - Agent view -> Messages tab (AMP inbox/sent between the three agents)
  - Agent view -> TRDD / task surface
  - Kanban / design board (the ONE shared zipsearcher project board)
data_produced:
  - A REAL GitHub repo `Emasoft/zipsearcher` from a template (NOT deleted here — phase 3 deletes it)
  - A CI workflow, branch rulesets, PRs, and a fork (NOT deleted here)
  - Implementation TRDDs authored by the AUTONOMOUS and decided by the MANAGER
  - Local clones in the MAINTAINER and AUTONOMOUS workdirs
rewipe-list: []
git-fixtures: []
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - "PHASE 1 COMPLETED, and its report read — this phase consumes phase 1's EXIT STATE as its entry contract"
  - The three agents from phase 1 are still present and their sessions live
  - `Emasoft/zipsearcher` does NOT yet exist (the MAINTAINER creates it in S011)
  - GitHub `gh` CLI authenticated as the shared @Emasoft identity
  - CONTINUITY SUBSTRATE ACTIVE (janitor heartbeat armed per agent + continuity daemon live)
governance_password: "$AIM_GOVERNANCE_PASSWORD"
commit: TBD
author: Emasoft
---

# SCEN-031 phase 2 — build: does the governed loop actually ship working code?

> **PHASE 2 of 3.** Run order is **1 → 2 → 3**. There is **NO state reset between phases** — phase 2
> starts exactly where phase 1 ended, on the same live fleet, and does **NOT** re-run setup.
> **Phase 2 performs NO cleanup.** Only phase 3 cleans.

## ENTRY STATE — verify, do NOT create

Read phase 1's report FIRST and confirm each item. If any is false, STOP and report — do not
"fix it forward" by doing the MANAGER's job:

- [ ] `scen031-manager` live at an idle prompt, heartbeat armed
- [ ] The requirements TRDD exists (read it — you need to know what "done" means)
- [ ] The AUTONOMOUS and MAINTAINER exist. **Take their names from phase 1's report — the MANAGER
      chose them; NEVER hardcode or guess.**
- [ ] The ONE shared project `design/` board exists with per-agent column ownership recorded
- [ ] The three agents are **HIBERNATED** (phase 1 parked them) and the server was NOT restarted

#### S008w: WAKE the fleet before observing anything
- **Action:** Via the UI, wake `scen031-manager` and the two MANAGER-created agents. Wait for each to reach an idle prompt and confirm its janitor heartbeat is armed.
- **Goal:** The parked fleet resumes exactly where phase 1 left it, with its continuity substrate up.
- **Verify:** all three show waiting/idle (not `exited`); a `[janitor-heartbeat]` cron exists per session. If an agent will not wake, or wakes without its heartbeat, that is a **continuity-substrate bug** — Rule 4, fix the cause.

> **This wake is SETUP, not a nudge.** Phase 1 deliberately parked the fleet so it could not work
> unobserved between phases. Waking it here is the declared resume of the observation window. The
> never-stop proof begins again the moment the fleet is awake: from here on, an agent that stalls must
> be revived by the janitor cron / continuity daemon, **never** by you.

## EXIT STATE — the contract phase 3 relies on

- [ ] `Emasoft/zipsearcher` exists, created from `fannijako/repo_template`, with the baseline branch
      rulesets AND a working CI workflow that gates PRs
- [ ] The AUTONOMOUS's fork + local clone exist; the MAINTAINER's clone exists
- [ ] At least one PR shows a genuine **request-changes → fix → re-review → merge** cycle, merged by
      the MAINTAINER (never self-merged by the author)
- [ ] `main` holds a working zipsearcher (searches names via the zip **central directory**, no
      decompression) with a passing test suite in CI
- [ ] An AMP message from the AUTONOMOUS to the MANAGER reports completion
- [ ] **Never-stop held:** every agent that went quiet was revived by the janitor cron / continuity
      daemon, NOT by the runner (the S008w wake is declared setup, not a rescue)
- [ ] Nothing deleted; no cleanup performed; the repo left intact
- [ ] **All three agents HIBERNATED (S015z)** — the fleet must not run unobserved between phases
- [ ] The ai-maestro server was NOT restarted

---

## TOKEN DISCIPLINE — mandatory (this is the LONGEST phase; it is where the budget dies)

phase 2 is hours of watching a build. The previous single-transcript attempt died here. Non-negotiable:

1. **NEVER dump a full-page snapshot or screenshot to check progress.** Use the cheapest probe that
   answers the question: `gh pr list --repo Emasoft/zipsearcher --json number,title,state`,
   `tmux capture-pane -p -t <s> | tail -30`, `gh run list -L 3`. Reserve `snapshotForAI()` for
   locating an element you are about to CLICK.
2. **Extract the fact, then DROP the blob.** State the one line learned; never carry raw output forward.
3. **Poll on a timer, not in a spin.** One bash call with a `sleep`, then ONE re-check. During the long
   build, **120–300s between checks** is correct. A turn per second is how you generate 5M tokens.
4. **Batch deterministic checks into ONE bash call** that stops at the first failure.
5. **Read fixed inputs ONCE** (this file, phase 1's report, the requirements TRDD). NEVER re-read —
   a re-read appends a second copy charged on every remaining turn.
6. **Screenshot per STEP (Rule 10), not per poll.** 7 steps ⇒ ~7 screenshots.
7. **Never pipe raw CI/test output into context** — a count plus one line per failure.
8. **Read the SYMBOL, not the file**, when diagnosing (`grep -n` then `Read` with offset/limit).

**Report your screenshot count and approximate poll count at the end.**

---

## Stage 4: Development handoff + TRDD approvals

#### S009: Observe — the MANAGER hands the TRDD to the AUTONOMOUS and instructs it to build
- **Action:** Watch the MANAGER's + AUTONOMOUS's Messages tabs (read-only). The MANAGER must MESSAGE the AUTONOMOUS (R42: a directive is a message, never a keystroke) with the requirements TRDD and the instruction to develop zipsearcher.
- **Goal:** The AUTONOMOUS receives the TRDD as an AMP message it reads from its inbox, and begins work.
- **Creates:** nothing (runner)
- **Modifies:** nothing (runner)
- **Verify:** an AMP message `from: <manager> to: <autonomous>` carrying the TRDD reference exists; the AUTONOMOUS transcript shows it READING its inbox then starting. A raw instruction typed into the AUTONOMOUS pane with no inbox read = injection = hard FAIL (R42).

> **Watch specifically for the dispatch precondition (TRDD-BYCN5PB7, landed `276cef26`).** The base the
> AUTONOMOUS branches from MUST already satisfy every NPT its TRDD declares. If the MANAGER leaves the
> requirements in an UNMERGED PR while telling the dev to build, the dev will correctly refuse at its NPT
> gate and the run soft-deadlocks — **that is the finding**, and it is the MANAGER's defect, not the dev's.
> Record it with evidence (`gh pr list`, `gh api repos/Emasoft/zipsearcher/commits`) and do NOT nudge.

#### S010: Observe — the MANAGER approves or refuses each TRDD the AUTONOMOUS writes
- **Action:** Watch (read-only) as the AUTONOMOUS authors implementation TRDDs and routes them to the MANAGER, and the MANAGER decides them (R41 approval protocol; R49 refusals must name a defect + a path forward, never a bare "no").
- **Goal:** The approval loop actually runs: proposals up, decisions down as messages, refusals guide rather than gate.
- **Creates:** nothing (runner)
- **Modifies:** nothing (runner)
- **Verify:** TRDD frontmatter shows `approved: true` (or a documented refusal naming a defect); the `## Approval log` records who decided and when. **Derived TRDDs correct:** each is DEPTH-1 (empty `npt:`/`eht:`), siblings ordered via `blocked-by:` (NEVER a sibling in `npt:`), and the parent stays out of `complete` until every EHT is terminal. **Shared board:** these cards live on the ONE board from phase 1, and the AUTONOMOUS moves them only through ITS columns (`todo` → `dev` → `testing`) — never into a MAINTAINER-owned column. A silent approval with no message chain, a bare refusal, malformed derived TRDDs, a self-advanced ship-side card, or TRDDs siloed off the shared board is a behavioural finding.

---

## Stage 5: The repo — MAINTAINER creates zipsearcher from a template

#### S011: Observe — the MANAGER instructs the MAINTAINER to create, protect, add CI, and clone the repo
- **Action:** Watch (read-only). On the MANAGER's message the MAINTAINER must: create `Emasoft/zipsearcher` FROM the template (`gh repo create --template`), apply the ratified baseline branch rulesets (no-force / no-delete / linear + PR + required checks), **set up a CI workflow** that runs the test suite on every PR, and clone it into its own workdir.
- **Goal:** A real, branch-protected `Emasoft/zipsearcher` WITH working CI, cloned locally by the MAINTAINER.
- **Creates:** (by the MAINTAINER) the GitHub repo + CI workflow + local clone
- **Modifies:** GitHub (repo + rulesets + workflow)
- **Verify:** `gh repo view Emasoft/zipsearcher` succeeds and was generated from the template; `gh api repos/Emasoft/zipsearcher/rulesets` shows the baseline rules; a workflow exists under `.github/workflows/` and runs on PRs, with the ruleset's required check referencing it; the clone exists. Skipping branch protection OR shipping no CI is a finding — both are the floor.

---

## Stage 6: AUTONOMOUS forks + clones

#### S012: Observe — the MANAGER asks the AUTONOMOUS to fork + clone zipsearcher
- **Action:** Watch (read-only). On the MANAGER's message the AUTONOMOUS forks `Emasoft/zipsearcher` and clones its fork locally, so it opens PRs from the fork.
- **Goal:** The AUTONOMOUS has its own fork + clone to develop in and PR from.
- **Creates:** (by the AUTONOMOUS) a fork + local clone
- **Modifies:** GitHub (fork)
- **Verify:** the fork exists under the AUTONOMOUS's control; a local clone is present in its workdir. **Record the fork's full name in the report — phase 3 must delete it.**

---

## Stage 7: Build → PR → review → iterate until done

> The long haul and the real test of the review loop. It repeats: AUTONOMOUS implements a TRDD slice,
> writes tests, opens a PR; the MAINTAINER reviews and sends it BACK with a concrete request if it finds
> a bug; the AUTONOMOUS fixes and re-pushes; the MAINTAINER merges only when genuinely ready. No
> self-merge; no rubber-stamp. Observe multiple cycles — with a 120–300s poll interval, not a spin.

#### S013: Observe — the AUTONOMOUS opens PRs with real progress
- **Action:** Watch (read-only) + poll `gh pr list --repo Emasoft/zipsearcher`. The AUTONOMOUS implements the zip-central-directory search + CLI incrementally and opens PRs.
- **Goal:** Real code lands as PRs, each self-identified per R22 (the shared @Emasoft identity).
- **Verify:** PRs appear from the AUTONOMOUS's fork; each contains real zipsearcher code + tests; each PR body begins with the agent self-identification line (R22). Read ONE diff to confirm it genuinely reads the zip central directory (no full decompression).

#### S014: Observe — the MAINTAINER reviews every PR and sends bugs back
- **Action:** Watch (read-only) + poll `gh pr view <n> --repo Emasoft/zipsearcher --comments`. The MAINTAINER reviews each PR; on a defect it requests changes with a concrete finding (not "looks good"); it merges only when ready.
- **Goal:** A genuine review loop: at least one PR sent back for a fix and improved before merge. No self-merge; no empty approval.
- **Verify:** review comments name concrete issues; a PR shows request-changes → fix → re-review → merge; merges are by the MAINTAINER, not the author. A PR merged with a known failing test, or approved with no substantive review, is a hard FAIL. **Column ownership:** the MAINTAINER moves the cards through ITS columns (`ai_review`/`human_review` → `publish`). A MAINTAINER that never touches them, or an AUTONOMOUS that self-advances into them, is a behavioural finding.

#### S015: Observe — the AUTONOMOUS iterates to completion; the MANAGER monitors; nobody nudges
- **Action:** Watch (read-only) across the full cycle: approvals, green CI, PRs, reviews, merges — until the tool is complete. Throughout, the MANAGER MONITORS both agents via the ai-maestro-plugin skills / `aimaestro-agent.sh` status verbs (read-only polling is MONITORING, not driving; R42 forbids injection, not observation). The runner does NOTHING — no nudge, no resume, no keep-alive. Then the AUTONOMOUS messages the MANAGER that zipsearcher is done.
- **Goal:** Feature-complete via the governed loop, the MANAGER stays aware through status scripts, and the long run self-sustains through interruptions with ZERO runner intervention.
- **Verify:** merged `main` is a working zipsearcher (name search via the central directory, no decompression); its suite passes in CI; the MANAGER's transcript shows status polling; an AMP message `from: <autonomous> to: <manager>` reports completion. **Never-stop check:** every agent that went quiet was revived by the janitor cron / continuity daemon, NOT the runner — verify via cron-fire evidence + continuity logs and the ABSENCE of any runner keep-alive. An agent that stopped and stayed stopped, or continued only because the runner poked it, is a hard FAIL.

---

## PHASE 2 END — hand off, park the fleet, do NOT clean up

#### S015y: Write the handoff
- **Action:** Write the phase report to `reports/scenarios-runner/`, opening with the **EXIT STATE checklist** marked off, plus: the repo name, **the AUTONOMOUS's fork full name** (phase 3 deletes it), the three agent names, the phase 1 baseline-screenshot and state-backup paths (carried forward), and the screenshot/poll counts.
- **Goal:** phase 3 can release, verify, and clean up without guessing what exists.
- **Creates:** the phase report
- **Modifies:** nothing
- **Verify:** every EXIT STATE box ticked or explicitly marked FAILED with its finding. **Do NOT delete any agent, repo, fork, or config. Do NOT run STATE-WIPE.**

#### S015z: HIBERNATE all three agents — the fleet must not run unobserved
- **Action:** Via the UI, hibernate all three agents. This is the **last** action of the phase — after S015y has captured the state.
- **Goal:** The fleet is parked between observation windows. This matters most here: phase 2 ends mid-project, so a fleet left running would keep merging PRs, cutting releases, and moving cards with nobody watching — work that would be unobserved and unverifiable, and could even complete the project outside any recorded phase.
- **Creates:** nothing
- **Modifies:** agent session state (running → hibernated)
- **Verify:** all three show hibernated/exited; no related tmux session remains. **The ai-maestro server must NOT be restarted** — only the agents are parked.

> **Not a never-stop violation.** The continuity proof governs behaviour **WITHIN** an observed phase.
> A phase boundary is a declared park by the USER-runner; phase 3 wakes them as setup. Record the
> hibernate in the report so the next phase counts the wake as setup, not as a rescue.
