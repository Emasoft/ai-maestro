---
spec: scenario-tests
spec-version: 1.1.0
status: normative
created: 2026-07-22T10:19:26+0200
updated: 2026-07-22T10:32:00+0200
maintainer: ai-maestro
project-id: ai-maestro
derived-from:
  - "tests/scenarios/SCENARIOS_TESTS_RULES.md — the 15-rule RULE FILE (Rule 0-14), loaded into the runner via the scenarios-rules skill; STAYS there, this SPEC captures it clause-for-clause"
  - ".claude/agents/scenario-runner.md — the single-scenario runner-agent definition"
  - ".claude/agents/scenario-improvement-implementer.md — the Phase-3 proposal implementer"
  - ".claude/agents/parallel-tester-agent.md, .claude/agents/parallel-worker-agent.md — the sibling-feature workflow agents"
implementations:
  - "Emasoft/ai-maestro-web-scenario-tester — its agents/skills/scripts/commands MUST validate against this spec (STS-VAL)"
  - "ai-maestro in-repo — tests/scenarios/, .claude/agents/scenario-runner.md, the run-scenarios-batch skill, tests/scenarios/scripts/"
validated-by:
  - "the web-scenario-tester plugin's self-validation (each STS-VAL-NN check)"
  - "the authoring-bug override (STS-VAL-08) — no forbidden mutation token in any scenario step"
---

# The scenario-tests conformance SPEC

**This file is the SPEC, not a rule.** It is the single, versioned, normative capture of the
scenario-test rules, the runner-agent contract, and the test procedures. The RULE FILE
`tests/scenarios/SCENARIOS_TESTS_RULES.md` (discursive prose, loaded into the runner's context
via the `scenarios-rules` skill) and the runner-agent definitions are the IMPLEMENTATIONS; this
file carries the testable clauses. On any disagreement the SPEC is the arbiter of the
machine-checkable shape; the RULE FILE is authoritative for rule MEANING.

Every one of the 15 rules (Rule 0-14) is captured with its atomic sub-requirements, plus the
runner-agent contract (STS-RUN), the test procedures (STS-PROC), the scenario-file format
(STS-FILE), and the self-validation checklist (STS-VAL). Its purpose is concrete: the
**ai-maestro-web-scenario-tester** plugin uses this file to VALIDATE its own agents, skills,
scripts, and commands — every STS-VAL clause is a check the plugin runs against itself.

## STS-GREP — how to grep this spec

```text
STS-GREP  all clauses of a family:   grep 'STS-RUN'   (or RULE RUN PROC FILE VAL META VER MNT)
STS-GREP  one rule with its subs:    grep '`STS-R6'   (the 15 rules map 1:1 to Rule 0..14)
STS-GREP  one clause by id:          grep '`STS-R6.5`'  /  grep '`STS-RUN-01`'
STS-GREP  the runner-agent contract: grep 'STS-RUN'
STS-GREP  the validation checklist:  grep 'STS-VAL'
STS-GREP  families: META=arbiter RULE=the-15-rules RUN=runner-agent PROC=procedures
STS-GREP            FILE=scenario-file-format VAL=plugin-self-validation VER=versioning MNT=maintenance
```

## STS-META — arbiter, derivation, purpose

`STS-META-01` **arbiter** — this file is the single versioned normative source for what a
scenario-test implementation MUST be; where an implementation and this spec disagree on SHAPE,
the spec wins; the RULE FILE is authoritative for rule MEANING.

`STS-META-02` **derived-not-moved** — `SCENARIOS_TESTS_RULES.md` is a Claude Code RULE FILE
loaded into the runner via the `scenarios-rules` skill; it STAYS at
`tests/scenarios/SCENARIOS_TESTS_RULES.md` (+ its auto-load symlink
`.claude/rules/SCENARIOS_TESTS_RULES.md`, which cannot drift). This SPEC captures it; it does not
replace or relocate it. A SPEC and a RULE FILE are different artefacts (`design/specs/README.md`).

`STS-META-03` **who-validates** — the ai-maestro-web-scenario-tester plugin drives agents on any
client and must prove its own runner-agent, scenario files, batch scripts, and report paths satisfy
this contract. STS-VAL is that checklist.

`STS-META-04` **self-contained** — cites sibling specs as DATA (the 22-column kanban vocabulary at
`design/specs/3-pillars-spec.md` `3P-KAN`; governance rules at `design/specs/governance-spec.md`),
never transcludes them.

## STS-VER — versioning & conformance

`STS-VER-01` **semver-bump** — MAJOR = a `MUST` changes (a rule meaning, a required frontmatter
field, the runner-model floor); MINOR = an added clause or non-breaking clarification; PATCH =
wording. `STS-VER-02` **conforms-to** — an implementation MAY declare `conforms-to-spec:
scenario-tests@<version>`; a mismatch is a detectable failure. `STS-VER-03` **clause-ids-stable** —
`STS-<FAMILY>-NN` ids are stable, never reused, append-only.

## STS-RULE — the 15 mandatory rules (Rule 0..14), captured atomically

### STS-R0 — WHO-YOU-ARE / OBSERVE-DON'T-DRIVE (the load-bearing rule)
`STS-R0.1` **human-user-not-agent** — the runner IS the human USER of AI Maestro (the "Emasoft
card"), NEVER an agent, not even partially. `STS-R0.2` **no-agent-identity** — it has no AID, no
governance title, no registry entry, no `~/agents/<you>/`; it never claims one and never registers.
`STS-R0.3` **chat-not-terminal** — it drives ONLY the web UI (buttons/forms/wizards and an agent's
**chat** section); it NEVER uses an agent's terminal section (a read-only stream it only observes).
`STS-R0.4` **no-agent-tooling** — it never shells out to agent-to-agent tooling
(`aimaestro-agent.sh`, `amp-*.sh`, `curl -X <mutation> /api/agents/…`) — those are for AGENTS.
`STS-R0.5` **observe-dont-drive** — the single most valuable measurement is whether agents invoke
their skills SPONTANEOUSLY; the runner gives the MANAGER one directive, then STOPS and watches.
`STS-R0.6` **repertoire-is-three-moves** — (1) the dashboard UI, (2) ONE directive to the MANAGER's
chat stating the GOAL not the method, (3) then STOP; the MANAGER cascades (MANAGER→COS→team) itself.
`STS-R0.7` **never-puppet** — while observing, the runner MUST NOT instruct a non-MANAGER agent
(unless the scenario explicitly tests a user↔agent path), nudge/remind/re-send to a quiet agent,
hint at or name a skill, do an agent's work, or restart/re-prompt for a nicer outcome. `STS-R0.8`
**misbehaviour-is-a-bug** — an agent that stalls / forgets a skill / mis-routes / skips its COS /
never delegates IS A BUG (as much as a 500), fixed in a committed FILE, never by talking to it.
`STS-R0.9` **false-pass-worse-than-fail** — a goal reached only by coaching an agent is a **FAIL**;
the intervention is the bug report. `STS-R0.10` **R0.b-and-R4-same-loop** — R0.b forbids fixing an
agent's behaviour at runtime by talking to it; R4 REQUIRES fixing the CAUSE in code/plugin/skill/
rules/API then retrying the same act — different things, never in conflict. `STS-R0.11`
**respond-to-only-two** — the runner may respond only to a permission prompt (a user does click
Approve) and a direct question addressed to it (answer once, no coaching); silence is not a
question — it is a bug to go fix. `STS-R0.12` **every-agent-in-~/agents** — every agent a scenario
creates/imports/touches lives under `~/agents/<name>/`; no title, mode, or import flow is exempt;
the Wizard is the enforcement surface (rejects any other target). `STS-R0.13` **blacklist-structural**
— agents whose workdir is outside `~/agents/` are BLACKLISTED (the user's real agents; legacy
`_aim-*` drift); they are identified STRUCTURALLY (workdir outside `~/agents/` AND no
governanceTitle/role-plugin — pre-fork agents), verified via `GET /api/agents`, never by a
name list; SCEN-004 is the sole legitimate `_aim-*` interaction. `STS-R0.14` **import-fixtures-under-~/agents**
— an import-from-folder source is prepared in advance under `~/agents/`, declared in `dir-fixtures`;
importing from outside `~/agents/` is forbidden. `STS-R0.15` **rewipe-no-~/.claude** — the default
rewipe-list covers only `~/.aimaestro/*` app-owned server state; `~/.claude/*` belongs to the human
user and is touched only when the scenario's purpose is user-scope plugin install/uninstall.

### STS-R1 — CLEAN-AFTER-YOURSELF
`STS-R1.1` **last-phase-reverts** — the last phase MUST revert the system to its exact pre-test state
(every team/title/plugin/agent/group/setting undone). `STS-R1.2` **undo-shortest-path** — undo by the
shortest path (delete the plugin, not un-pick 30 skills); reach the original state, don't reverse-replay.
`STS-R1.3` **cleanup-steps-numbered-verified** — cleanup steps are numbered + verified like test steps,
not optional; a failed cleanup step MUST be fixed. `STS-R1.4` **verify-vs-baseline** — after cleanup,
a post-test screenshot MUST match the pre-test baseline.

### STS-R2 — 0-IMPACT
`STS-R2.1` **no-mutate-existing** — never use existing user-created resources for testing. `STS-R2.2`
**create-test-prefixed** — create NEW test-prefixed elements (`scenNNN-*`). `STS-R2.3` **remove-in-cleanup**
— remove them completely in cleanup; the system is indistinguishable from one where the test never ran.
`STS-R2.4` **reads-allowed** — reading existing state is allowed; only MUTATION of existing resources is
forbidden.

### STS-R3 — STATE-WIPE
`STS-R3.1` **checkpoint-save** — before the run, back up every file in the scenario's `rewipe-list` to a
SHA256-manifested `state-backups/SCEN-NNN_<ts>/` dir via `scenario-setup.sh`. `STS-R3.2` **default-rewipe-list**
— the default safe list is app-owned server state only: `~/.aimaestro/{governance.json,
agents/registry.json, teams/teams.json, teams/groups.json}`. `STS-R3.3` **~/.claude-only-for-plugin-scope**
— `~/.claude/*` is added only when the scenario tests user-scope plugin install/uninstall, reverting every
mutation via UI before cleanup. `STS-R3.4` **checkpoint-restore-ui-first** — cleanup is UI-FIRST in this
order: delete teams → remove titles → delete agents → purge cemetery → verify via API → THEN restore config
files. `STS-R3.5` **restore-side-effect-config-only** — restore ONLY files a side-effect may have changed
(settings/governance); do NOT restore registry.json/teams.json (UI deletions already cleaned those; restoring
them leaves orphan tmux sessions + folders). `STS-R3.6` **fixtures** — `git-fixtures` (local clone at
`tests/scenarios/fixtures/git/<repo>/` + `scenario-start` tag) referenced `GITFIX[n]`; `dir-fixtures`
referenced `FOLDFIX[n]`; the shared setup resets them (never clones for you).

### STS-R4 — FIX-AS-YOU-GO
`STS-R4.1` **stop-diagnose-fix-rebuild-retry-loop** — on a BLOCKING bug: STOP → diagnose (read source
scoped, check MEMORY) → FIX the cause → rebuild/restart if needed → RETRY the same step → loop with NO
attempt cap → resume. `STS-R4.2` **phase1-in-place-current-branch** — Phase-1 fixes land IN PLACE on the
current branch, committed alongside the report; never a worktree, never a PR. `STS-R4.3` **fix-only-when-blocked**
— fix ONLY when you cannot go on; do not gold-plate; work too big for an in-place fix becomes a Rule-11
proposal, not a Phase-1 fix.

### STS-R5 — TRACK-AND-REPORT
`STS-R5.1` **per-step-record** — record every step (id, PASS/FAIL/FIXED, screenshot, timestamp). `STS-R5.2`
**per-bug-record** — every bug: step, symptom, root-cause, files modified, verifying step. `STS-R5.3`
**per-issue-record** — every non-blocking issue: step, severity WARN/INFO, impact, suggested fix. `STS-R5.4`
**report-header** — scenario+version, commit start/end, timestamps, step totals, cleanup + state-wipe verified.

### STS-R6 — STICK-TO-UI
`STS-R6.1` **mutations-via-ui** — every state-MUTATING action goes through the browser UI. `STS-R6.2`
**reads-allowed** — read-only verification (curl GET, file reads, `tmux capture-pane`, `git status` after a
UI action) is always allowed and encouraged. `STS-R6.3` **no-out-of-band-mutation** — no `curl -X <mutation>`,
no direct config-file edit, no CLI to achieve a UI task. `STS-R6.4` **ui-limit-is-rule4** — a UI limitation
is a Rule-4 trigger (fix the UI), never a bypass excuse. `STS-R6.5` **one-bypass-invalidates** — a single
state-mutating bypass INVALIDATES the run: stop, record `Rule 6 violation — run INVALIDATED`, cleanup, restart
from S001 (no partial credit; ledgers may detect + react to out-of-band mutations). `STS-R6.6`
**fixture-scripts-allowed** — pre/post fixture scripts (`setup-SCEN-NNN.sh`, `cleanup-SCEN-NNN.sh`) run
OUTSIDE the step sequence and are the sanctioned non-UI surface.

### STS-R7 — SAFE-SETUP
`STS-R7.1` **commit-record** — commit uncommitted changes, record `commit_start`. `STS-R7.2` **build** —
build the project. `STS-R7.3` **restart-verify** — restart the app, verify health. `STS-R7.4` **kill-orphans**
— kill orphan `scen-*`/`cos-scen-*` tmux sessions. `STS-R7.5` **setup-script-to-OK** — run the per-scenario
setup script to `SETUP_OK`; a `SETUP_FAIL` is never bypassed — fix the underlying fixture (missing clone,
missing `scenario-start` tag, missing dir, `yq`, rewipe-path typo) and re-run. `STS-R7.6` **auto-cos** — a
team created without a `chiefOfStaffId` auto-creates `cos-<teamslug>` (random robot persona) at
`~/agents/cos-<teamslug>/`; declare it in `data_produced`, clean it up, never hardcode its persona name
(look it up via `team.chiefOfStaffId`).

### STS-R8 — DEV-BROWSER
`STS-R8.1` **load-skill-first** — load `dev-browser:dev-browser` via the Skill tool BEFORE any browser call.
`STS-R8.2` **standard-flags** — every call uses `--browser ai-maestro-scenarios --headless --timeout 60`
(`-smartphone`/`-tablet` variants for device scenarios). `STS-R8.3` **chrome-devtools-deprecated** —
chrome-devtools MCP is deprecated (2026-04-15); a scenario listing `mcp__chrome-devtools__*` in
`required_tools` is an authoring bug. `STS-R8.4` **shared-named-instance** — all scenarios share ONE named
Chromium (persistent `dashboard` page logged in once at master setup). `STS-R8.5` **helpers** — reusable UI
sequences live in `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` (`aim_login`, `aim_sudo_modal`,
`aim_create_agent`, `aim_delete_agent`, …). `STS-R8.6` **daemon-master-level** — per-scenario runners NEVER
stop the daemon (no `daemon start/stop` subcommand; auto-spawns on first call; master cleanup runs
`dev-browser stop`). `STS-R8.7` **read-agent-history-via-jsonl** — read what an agent actually did from its
`~/.claude/projects/.../*.jsonl`, not terminal screenshots (Claude uses the alternate screen buffer).

### STS-R9 — REPORT-FORMAT
`STS-R9.1` **frontmatter** — YAML frontmatter: result, step counts, bug counts, `cleanup_verified`,
`state_wipe_verified`, `screenshots_purged`. `STS-R9.2` **sections** — Summary, Environment, per-step tables,
Bugs-Found-&-Fixed, Issues-Noticed, Cleanup-Verification, State-Wipe-Verification.

### STS-R10 — PHOTOSTORY
`STS-R10.1` **screenshot-every-step** — every step gets a screenshot (a 40-step scenario → 40 images).
`STS-R10.2` **jpeg-97** — screenshots are JPEG 97% (convert PNG immediately). `STS-R10.3` **timestamped-dir-and-file**
— saved under `reports/scenarios-runner/screenshots/SCEN-NNN_<RUN_ID>/S<NNN>_<RUN_ID>_<desc>.jpg` where
`RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)`; BOTH dir and file carry the timestamp. `STS-R10.4` **auto-purge-on-verified-pass**
— on verdict PASS with every bug fixed+verified AND an empty Issues-Noticed section, the per-run screenshot dir
is auto-purged (report the `screenshots_purged` flag). `STS-R10.5` **keep-otherwise** — kept on
FAIL/PARTIAL/STUCK, any unfixed bug, a non-empty Issues-Noticed (unless `keep_screenshots:false`), a smoke/baseline
run, or when no verification re-run ran.

### STS-R11 — 11th-HOUR (the PRIMARY deliverable)
`STS-R11.1` **proposals-are-the-product** — the deep post-run analysis → improvement proposals are the primary
deliverable; the test steps are the instrument. `STS-R11.2` **one-trdd-per-suggestion** — each suggestion is its
OWN git-tracked TRDD-proposal file in `design/proposals/` (`column: proposal`, never a monolithic report).
`STS-R11.3` **dedupe-first** — grep `design/proposals/` + `design/tasks/` for the symptom; if an open TRDD covers
it, note it there instead of duplicating. `STS-R11.4` **kanban-conformance** — a suggestion touching kanban
columns/statuses/GitHub-Projects/UI MUST conform to the ratified 22-column vocabulary (`3P-KAN`, cited as data);
never a divergent column set or parallel kanban. `STS-R11.5` **frontmatter** — id = 8-char base36 (collision-checked),
`column: proposal`, `approval-tier: 2` (or `3` for GOLDEN/owner-identity), `priority` 0-3, `labels:
[scenario-improvement, scen-NNN, batch-<id>]`, `current-owner: scenario-runner`, `external-refs:` = the report path.
`STS-R11.6` **body-sections** — mandatory: `## Problem`, `## Root cause`, `## Proposed fix` (file+line+current+proposed),
`## Verification`, `## Estimated risk`, `## Approval log` (empty). `STS-R11.7` **cron-authors-never-implements** — the
overnight cron ONLY authors proposals; implementation is Phase-3, user-triggered.

### STS-R12 — SUDO-MODE
`STS-R12.1` **strict-routes-need-fresh-token** — every route classified `strict` in `security-registry.json`
rejects requests lacking a fresh one-shot `X-Sudo-Token` earned by re-entering the governance password within 60s.
`STS-R12.2` **destructive-step-includes-sudo-substep** — any destructive step MUST include a password re-entry
sub-step; if the sudo modal does not appear, that is a bug (Rule 4). `STS-R12.3` **modal-recognition** — the modal is
`role="dialog" aria-modal="true"`; handle each via `aim_sudo_modal`. `STS-R12.4` **password-never-through-model** — the
governance password NEVER passes through a model: a scenario names the env var (`$AIM_GOVERNANCE_PASSWORD`), never the
literal; helpers take no password argument; a step never instructs typing it; unset env ⇒ fail fast. `STS-R12.5`
**strict-route-list** — the strict set is enumerated in `security-registry.json` (agent delete, team delete, cemetery
purge, governance password, marketplace/role-plugin uninstall, title change, session stop/restart, security settings,
team create, ensure-core). `STS-R12.6` **60s-one-shot-window** — only the first strict op in a 60s window pops the
modal; batched deletes = N modals (tokens are one-shot). `STS-R12.7` **team-delete-inline-password** — team delete is
the one exception (inline password in the dialog, no separate modal).

### STS-R13 — AUTONOMOUS-PROTOCOL
`STS-R13.1` **process-survives-rate-limit** — Claude Code does NOT exit on rate-limit/API errors; only the TURN dies;
the event loop, cron, daemon, and state persist. `STS-R13.2` **three-components** — a long batch uses (a) a passive
multi-token account switcher, (b) a durable recurring cron that fires fresh turns (the wake mechanism), (c) an
idempotent state file + one-scenario-per-fire prompt. `STS-R13.3` **two-phase-workflow** — Phase-1 execution (in-place
bug fixes + authored proposals only, no worktrees/PRs), Phase-2 user screening of `design/proposals/`, Phase-3
worktree implementation of APPROVED proposals. `STS-R13.4` **state-file** — `tests/scenarios/state/autonomous-batch-state.json`;
one cron fire = one atomic state-machine step; atomic write (`.tmp` + rename). `STS-R13.5` **state-machine-tick** —
`state-machine-tick.sh` is the SINGLE source of truth, emitting `RUN SCEN-NNN` / `WAIT SCEN-NNN` / `CLEANUP` / `DONE` /
`ERROR <reason>`; the cron only dispatches what it decided. `STS-R13.6` **heartbeat-recovery** — an `in_progress`
scenario with a FRESH heartbeat → `WAIT`; STALE (> 90 min) or none past `started_at`+threshold → reset to `pending`,
bump retries, log `recovery.log`, re-dispatch; a runner self-recovers on a stale prior heartbeat by restarting from
S001; a fresh prior heartbeat blocks a duplicate runner. `STS-R13.7` **cron-hard-rules** — the cron NEVER creates
branches/worktrees/PRs, never pushes, never auto-implements a proposal, never spawns the implementer, and stages files
by name; the cron is durable + off-minute. `STS-R13.8` **master-setup-and-cleanup-once** — master setup (clean-tree
check, backup, build, restart, dev-browser login, baseline screenshot) and master cleanup (`dev-browser stop`,
STATE-WIPE restore, batch summary) run ONCE per batch. `STS-R13.9` **batch-summary-index** — the batch summary is a
lightweight INDEX over `design/proposals/`, never a monolith. `STS-R13.10` **no-recursive-claude** — the cron prompt
runs INSIDE an existing session; it NEVER shells out to `claude --print`/`-p`.

### STS-R14 — REPORTS-TO-PROJECT-ROOT
`STS-R14.1` **canonical-path** — every report/proposal-index/screenshot/log resolves to
`<main-repo-root>/reports/<component>/<ts±tz>-<slug>.<ext>` (`<ts±tz>` = ISO 8601 with offset, compact). `STS-R14.2`
**resolve-main-from-worktree** — worktree agents resolve MAIN via `git rev-parse --git-common-dir`, never a
worktree-local `reports/`. `STS-R14.3` **gitignore-both** — `reports/` AND `reports_dev/` are gitignored (private
data). `STS-R14.4` **no-tmp-no-~/.claude** — never `/tmp`, never `~/.claude/`, never `.claude/` inside the project.
`STS-R14.5` **mcp-override** — a tool with its own default report path (e.g. LLM Externalizer) MUST have `output_dir`
overridden to the canonical path on every call. `STS-R14.6` **proposals-exception** — improvement PROPOSALS are the
exception: git-tracked TRDDs in `design/proposals/`, not reports.

## STS-RUN — the runner-agent contract (a conformant runner MUST satisfy every clause)

`STS-RUN-01` **model-floor** — pinned to a **1M-context** model (ai-maestro uses `opus[1m]`); a 200K-window model
CANNOT launch (the forked floor — project CLAUDE.md + global rules + the loaded rules doc + the dev-browser skill —
alone exceeds 200K). `STS-RUN-02` **no-mcp** — curated native tools only (`Bash, Read, Write, Edit, Glob, Grep, Skill`)
with ZERO MCP servers (MCP schemas cost ~80-120K re-read every turn). `STS-RUN-03` **skills** — declares the scenario
skills it loads: the rules skill (`scenarios-rules`), `dev-browser:dev-browser`, a region-capture skill, a step-batch
skill. `STS-RUN-04` **write-guard** — carries a `PreToolUse` hook
(`Write|Edit|MultiEdit|NotebookEdit|Bash`) restricting writes to the project + `/tmp` (project-scoped agent,
bare-name spawn — a plugin-shipped agent's `hooks:` field is ignored by the harness). `STS-RUN-05` **memory** — uses
`memory: project`; reads `MEMORY.md` at start, updates at each fix + end, keeps it bounded. `STS-RUN-06`
**no-agent-identity** — never claims an agent identity, registers, drives via a terminal, or shells out to
agent-to-agent tooling (it is the human USER). `STS-RUN-07` **phases** — executes fixed phases A read fixed inputs once
(fixed-first load order) · B safe-setup + heartbeat · C execute (batch deterministic step-groups into one turn) · D
fix-as-you-go · E sudo modals · F cleanup · G reports + proposals · H return. `STS-RUN-08` **token-discipline** — never
accumulate raw snapshots/screenshots (extract the fact, drop the blob); prefer the a11y tree over pixels; scope every
snapshot/screenshot to the region of interest, never the whole page; read source SCOPED (`tldr` + ranged `Read`),
never whole files/stylesheets. `STS-RUN-09` **heartbeat** — writes `tests/scenarios/state/runner-heartbeat-SCEN-NNN.txt`
(first line `epoch=`) at Phase-B start + every step boundary + before any >60s wait; clears it ONLY on a clean terminal
return (a leftover heartbeat is the crash signal). `STS-RUN-10` **return-contract** — the LAST output is exactly the
2-3 summary lines (`[PASS|FAIL|PARTIAL|STUCK] SCEN-NNN — <result>`, `Report: <path>`, `Proposals: <n> …`); no step
tables/screenshots/code blocks. `STS-RUN-11` **hard-rules** — never `git add -A`/`.`/`push` (stage by name), never
nested subagents, never touch the dev-browser daemon lifecycle. `STS-RUN-12` **implementer-separation** — proposal
IMPLEMENTATION is a DIFFERENT agent (`scenario-improvement-implementer`), Phase-3 only, in `isolation: worktree`, over
APPROVED (`column: planned` in `design/tasks/`) proposals, one commit per proposal citing `TRDD-<id8>`, sha appended
to `implementation-commits:`.

## STS-PROC — the scenario-test procedures (the operational method)

`STS-PROC-01` **the-loop** — for each step: (1) impersonate the USER with MAESTRO privileges, (2) ACT via the UI only,
(3) VERIFY by any READ-ONLY means, (4) if the expected result is absent AND blocks the next step, STOP and FIX the
cause then retry, (5) go to the next step (STS-R0.10 + STS-R4). `STS-PROC-02` **fix-locus** — a misbehaving agent is
fixed in a committed FILE (skill description, role-plugin main-agent `.md`, loaded rules, server enforcement, the app)
and proven by re-running the same step — never by typing the answer into its chat. `STS-PROC-03` **master-setup-once**
— a batch runs master setup once (STS-R13.8); per-scenario runners assume the daemon is up + the dashboard logged in.
`STS-PROC-04` **cleanup-order** — cleanup is UI-FIRST and ordered: delete agents → delete teams (cascade) → purge
cemetery → verify via API → THEN restore only side-effect config files (STS-R3.4/R3.5); never bash/CLI to delete
agent folders/kill sessions/edit registries. `STS-PROC-05` **sudo-modal-handling** — a strict op pops the sudo modal
(possibly N times per cleanup batch — one-shot tokens); each handled by `aim_sudo_modal` with the password from the
env var, never typed by the runner; team-delete uses an inline password (no modal). `STS-PROC-06` **commit-cadence** —
per scenario, exactly two commits: `fix(scen-NNN): …` (bug fixes) + `docs(scen-NNN): add improvement-proposal TRDDs`;
files staged BY NAME; the scenario report is gitignored and NEVER committed. `STS-PROC-07` **auto-cos-lifecycle** —
STS-R7.6 restated as procedure: creating a team auto-creates `cos-<teamslug>`; declare + clean it up; look up its
persona name via `team.chiefOfStaffId`.

## STS-FILE — the scenario-file format contract

`STS-FILE-01` **naming** — `SCEN-<NNN>_<name>.scen.md`, zero-padded unique NNN (never reused;
`tests/scenarios/NEXT_SCEN_NUMBER` tracks the next); the number also appears in frontmatter `number:`. `STS-FILE-02`
**frontmatter-required** — `number, name, version, description, client, interhosts, device, subsystems, ui_sections,
data_produced, rewipe-list, git-fixtures, dir-fixtures, browser_stack, prerequisites, governance_password, commit`
(`author` optional). `STS-FILE-03` **browser_stack** — MUST be `dev-browser`; the legacy `required_tools`
(chrome-devtools) list is deprecated and MUST NOT appear in a new scenario. `STS-FILE-04` **password-is-env-name** —
`governance_password` is the env var NAME (`"$AIM_GOVERNANCE_PASSWORD"`), NEVER the literal; no step Action instructs
typing it. `STS-FILE-05` **phase-format** — phases numbered from 0; Phase 0 = `SAFE-SETUP`; last = `CLEANUP`; `##`
headings; a `---` rule between phases. `STS-FILE-06` **step-format** — steps `S<NNN>` sequential across ALL phases
(never restarting per phase); a regular step has `Action, Goal, Creates, Modifies, Verify`; a cleanup step replaces
Creates/Modifies with `Removes`; no non-standard fields; the last cleanup step is STATE-WIPE, the final step a
post-test screenshot. `STS-FILE-07` **fixtures** — `git-fixtures` (GitHub URL, local clone + `scenario-start` tag,
`GITFIX[n]`) + `dir-fixtures` (absolute path, `FOLDFIX[n]`); the shared setup resets them. `STS-FILE-08`
**device-viewports** — `device` ∈ {`desktop` 1280×800, `tablet` 1024×768, `smartphone` 390×844}; selects the
width-driven component set.

## STS-VAL — how the web-scenario-tester plugin validates ITS OWN agents / skills / scripts

`STS-VAL-01` **runner-agent** — the plugin's scenario-runner agent satisfies every STS-RUN clause: 1M model
(STS-RUN-01), zero MCP (STS-RUN-02), the scenario skills (STS-RUN-03), the write-guard hook (STS-RUN-04),
`memory: project` (STS-RUN-05), the phase set (STS-RUN-07), the return contract (STS-RUN-10), the hard rules (STS-RUN-11).
`STS-VAL-02` **rules-coverage** — the plugin's loaded rules doc covers ALL 15 rules `STS-R0..STS-R14` topic-for-topic.
`STS-VAL-03` **scenario-files** — every scenario file conforms to STS-FILE (naming, every required frontmatter field,
`browser_stack: dev-browser` with no chrome-devtools `required_tools`, env-name password, phase/step format).
`STS-VAL-04` **scripts** — the batch scripts implement STS-PROC/STS-R13: a single-source state machine (STS-R13.5),
heartbeat recovery (STS-R13.6), setup/cleanup with a SHA256 manifest (STS-R3/R7), the sudo-modal helper (STS-PROC-05),
the two-commit cadence (STS-PROC-06). `STS-VAL-05` **reports-location** — every path resolves under
`<main-root>/reports/<component>/<ts±tz>-<slug>` (STS-R14) with screenshots as JPEG 97% in the timestamped per-run dir
(STS-R10); no worktree-local/`/tmp` report path. `STS-VAL-06` **password-safety** — NO scenario file, script, agent
prompt, or report contains the governance-password LITERAL; only the env var name (STS-FILE-04 / STS-R12.4); a grep
for the literal returns nothing. `STS-VAL-07` **kanban-conformance** — any proposal/status handling uses the ratified
22-column vocabulary (`3P-KAN`, cited as data); no divergent column set or parallel kanban. `STS-VAL-08`
**no-bypass-tokens** — no step `Action` contains a forbidden MUTATION token (` rm `, `rm -`, ` mv `, `tmux
kill-session`, `curl -X POST|PUT|DELETE|PATCH`, `echo … >`, `cat … >`); such a token is an authoring bug the runner
rewrites to a UI-only action or marks DEFERRED. `STS-VAL-09` **implementer-agent** — a shipped proposal implementer
satisfies STS-RUN-12 (`isolation: worktree`, one commit per proposal citing `TRDD-<id8>`, sha appended, operates only
on approved `design/tasks/` proposals). `STS-VAL-10` **governance-compat** — the plugin's own agents obey the
governance SPEC where they touch the fleet (e.g. STS-R0 keeps the runner a NON-agent, so it is exempt from the R6 comm
graph; a plugin agent that IS a fleet agent conforms to `design/specs/governance-spec.md`).

## STS-MNT — maintenance

`STS-MNT-01` **living** — MAINTAINED and NON-archived; it tracks the RULE FILE + runner-agent definition it derives
from. `STS-MNT-02` **change-authority** — a change to `SCENARIOS_TESTS_RULES.md` or the runner-agent definition that
alters a `MUST` here bumps `spec-version` (STS-VER-01); the SPEC and its source update together. `STS-MNT-03`
**keep-it-greppable** — every clause keeps its `` `STS-<FAMILY>-NN` `` anchor + a bold key-phrase; a new clause takes
the next free NN in its family (never reused); STS-GREP lists every family.
