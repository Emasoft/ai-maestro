---
trdd-id: 9Z2P2SDA
status: tasked
title: Phase-3 scenario — dashboard MAINTAINER creation observes ChangeTitle G15/G16 report installed
column: blocked
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-18T20:19:21+0200
updated: 2026-09-29T22:11:24+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: user
derived: false
npt: []
eht: []
blocked-by: [TRDD-JT3U4ZVM]
release-via: none
priority: 1
severity: medium
effort: S
labels: [scenario, phase-3, fleet, role-plugins, TRDD-BRRJK57P]
external-refs: [TRDD-BRRJK57P, TRDD-JT3U4ZVM]
pre-block-column: dev
blocker-probe: sh -c 'f=$(find design -iname "*jt3u4zvm*" 2>/dev/null | head -1); git -C . log --oneline -5 -- "$f" 2>/dev/null | grep -q "G16 emit" && echo FIX-LANDED || echo FIX-NOT-LANDED'
blocker-holds-if: not-match:FIX-NOT-LANDED
---

# Phase-3 scenario — MAINTAINER title creation observes G15/G16 `installed`

## Problem

TRDD-JT3U4ZVM closed 8 of 9 acceptance boxes; the ninth is the ONLY evidence class the whole
fix never produced: a live observation of the ChangeTitle pipeline reporting
`G16: installed` (not `WARN — Failed to install`) when a MAINTAINER title is assigned through
the dashboard. Tags on the repos and a successful CLI install are necessary and not
sufficient — the pipeline's own gate line is what the card promised. The live server was DOWN
(curl 000, 2026-08-18) whenever a runner could have observed it.

This is the first Phase-3 scenario under the USER mandate (TRDD-BRRJK57P goal 3): short,
multi-phase, run against the live ai-maestro server, covering a fixed bug.

## Proposed scenario (author per SCENARIOS_TESTS_RULES.md — this card tracks it, the .scen.md
file is the deliverable)

Phases: (0) SAFE-SETUP + server up + baseline screenshot · (1) create a test agent via the
wizard (`scen-` prefix, workdir under ~/agents/) · (2) assign the MAINTAINER title through the
UI, sudo modal per Rule 12 (env var NAME only, never the literal) · (3) VERIFY: the ChangeTitle
ops trace reports `G15/G16: installed` — read-only, from the pipeline result the UI surfaces
and/or the agent's registry entry; screenshot · (CLEANUP) delete the agent via the UI with
folder deletion, purge cemetery, STATE-WIPE.

## Acceptance

- [ ] A `SCEN-XXX_maintainer-title-g16.scen.md` exists, conforms to the 15 rules, and names this
      card.
      **⚠ VERIFY THE PREMISE BEFORE WRITING IT — measured 2026-08-22, and it does not hold as
      stated.** This card's title says *"dashboard MAINTAINER **creation** observes **ChangeTitle**
      G15/G16"*, and those are two different pipelines. `G15`/`G16` are emitted **inside
      `ChangeTitle`** (`services/element-management-service.ts`: `ChangeTitle` at :2481, the gates
      at :3851-3881). Wizard **creation** runs `CreateAgent`, which has its own gate series; the
      only creation-side route into `ChangeTitle` I found is **`PG04`** (:1488), a *repair* for a
      titled agent that LOST its role-plugin — not the normal path. **So a scenario that merely
      CREATES a MAINTAINER through the wizard may observe nothing, and would pin nothing** — the
      exact "test that passes for an unknown reason" failure. Settle it first: either drive a
      title CHANGE (SCEN-001's shape) so `ChangeTitle` genuinely runs, or prove that creation
      reaches G15/G16 and record the file:line that shows it.
      **And do NOT author a new fixture blindly:** `SCEN-018_maintainer-lifecycle` ALREADY stands
      up a MANAGER plus a MAINTAINER with `ai-maestro-maintainer-agent` through the wizard, and
      `SCEN-001_title-change-lifecycle` already drives title changes and verifies role-plugin
      installs via the Config tab. If the observation can be added as a step to one of those, that
      is a far smaller change than a 41st scenario file — this box's "a new SCEN file exists" was
      written before either was checked.
      **PREMISE SETTLED (2026-08-26, hub): drive a title CHANGE, and verify from the SERVER LOG.**
      Two measurements close the box's open questions: (1) the observation target — `ChangeTitle`
      logs its whole outcome durably: the summary line at
      `services/element-management-service.ts:4532` (`[ChangeTitle] Agent <id> "<name>": <old> ->
      <new> (N gates, restart=...)`) and `logDegradedOps('ChangeTitle', ...)` right after it, which
      is LOUD for any WARN gate — VERIFIED at the body, not the name (`logDegradedOps` at :353-358:
      the predicate `/\b(WARN|FAIL|DENIED|VIOLATION|MISMATCH)\b/` includes WARN, so no silent
      filter) — and it writes via **`console.warn`, i.e. STDERR, i.e. the pm2 ERROR log**, while
      the summary line is `console.log` → the OUT log. The verify step must therefore grep BOTH
      files (Rule 6 allows read-only verification): the `[ChangeTitle]` summary in the out log
      (positive control for stdout capture) AND the absence of `[ChangeTitle] ... DEGRADED` lines
      naming G15/G16 in the ERROR log — grepping only the out log would report "no WARN" forever,
      healthy or not (the vacuous-negative shape). Re-derive both paths from
      `pm2 jlist` (`pm_out_log_path` / `pm_err_log_path`) at run time; never hardcode them. No
      dependency on whether the HTTP response surfaces `ops`. (2) the vehicle — extend
      `SCEN-001_title-change-lifecycle` (which already drives a title change through the UI with
      the Rule-12 sudo modal) with that one verify step; do NOT author a 41st file and do NOT use
      wizard CREATION, which runs `CreateAgent`, not `ChangeTitle`.
      **NEXT ACTION:** add the verify step to SCEN-001 and dispatch a scenario-runner against the
      live server (a scheduled run — Rule 15: the orchestrator owns the clock; not improvised at
      the tail of another card).
- [x] The scenario has RUN against the live server; the G15/G16 `installed` observation is
      recorded (report + screenshot), or the failure is a bug card.
- [ ] TRDD-JT3U4ZVM's last box is ticked citing that run, and that card leaves `blocked`.
- [x] **(box 2, resolved 2026-09-28)** The scenario HAS RUN against the live server — the G15/G16 observation is recorded, and it is a FAILING observation (BUG-001 in the report): the err-log WARN fired while the plugin landed async. Box ticked as MET with a negative result; the fix work belongs to JT3U4ZVM, not here.
- Evidence-form note for box 2 (review round): the letter says 'report + screenshot'; the actual evidence is the report's verbatim log quotes only — S034d has no screenshot (log-grep evidence cannot be meaningfully screenshotted, and the run's own step table shows '—'). The failure arm ('bug card') is satisfied by reference to the EXISTING owner card TRDD-JT3U4ZVM (dedupe — a second card would violate it), which now carries the dated reproduction line. Read 'recorded' under that form.

## Approval log

- 2026-08-18T20:19:21+0200 — MANDATE under the USER's recorded delegation (TRDD-BRRJK57P
  Approval log). Tier 0 in-repo scenario authoring.
- 2026-09-28T21:30:00+0200 — column → dev by main-agent@ai-maestro (delegated autonomy, 'do it all'). Box 1 was already landed (S034c/S034d, commit 3e56caec9). Dispatching scenario-runner for box 2 — live run against the RUNNING server; server.mjs hold honored (no build, no restart).
- 2026-09-28T22:40:00+0200 — box 2 RESOLVED NEGATIVE by the live run (SCEN-001 20260928T191659Z, PARTIAL): S034d FAILED — pm2 err log carries the G16 WARN — Failed to install degraded line for the 21:56:49 autonomous→maintainer transition (35 gates, restart=true, out-log summary present as positive control) while the plugin verifiably lands in settings.local.json ~8s later. The JT3U4ZVM regression signature REPRODUCED, not fixed (coordinator constraint during the hold). Bug recorded in the run report; JT3U4ZVM's live-observation box stays unticked — the observation is now measured and it is a FAILING observation. Report: reports/scenarios-runner/SCEN-001_20260928T191659Z.report.md
- 2026-09-28T22:13:04+0200 — column → blocked by main-agent@ai-maestro. Box 2 resolved (negative: G16 WARN reproduced live). Remaining work = the G16 emit-condition fix, owned by TRDD-JT3U4ZVM's unticked live-observation box; this card blocks on it.
- 2026-09-28T23:35:00+0200 — blocked-by CLEARED to break the ring the re-set created (validate GRAPH-ORDER-CYCLE: nothing in a 2-cycle can ever start, and the linter is right — a mutual wait where each side needs the OTHER to move first is a deadlock by definition, whatever the Approval-log prose says). The honest shape: THIS card's remaining box 3 is work ON THIS CARD — it cannot be done today (the fix hasn't landed) but it is not a WAIT on JT3U4ZVM's column; it is a wait on the emit-condition fix landing, which happens on JT3U4ZVM's side. blocked-by empty + the blocker-probe field repurposed below to watch for the FIX landing (JT3U4ZVM reaching ai_review with implementation-commits naming the G16 emit condition) is the machine-checkable form.
- 2026-09-29T00:10:00+0200 — CORRECTION of the 316d505b commit-message diagnosis: the PII-gate trip was NOT a transient race. json-io's lock is a DIRECTORY at <file>.lock (lib/json-io.ts:165, mkdir-based), and the F1 amendment's isDirectory() guard pushed live lockDIRS into the counted set while descending into them — a lockdir alive at the teardown instant trips deterministically, not probabilistically. Fixed in the watcher (skip by NAME from the push, descent preserved) + two pinning tests. Retry-success was sampling, not proof.
- 2026-09-29T00:50:00+0200 — RED LEG EXECUTED (closes the 4daf7ce6 commit-message gap): the mid-run lockdir test run against the pre-c6b8a875f helper FAILS (1 failed) and against the landed helper PASSES (1 passed) — a true red-green pair, replacing the earlier 11/12 count-delta mischaracterization. Method: direct file swap of the helper (git stash push of a file identical to HEAD no-ops — the first two attempts measured nothing), pre-c6b8a875f parent's helper verified by grep before the run. Also repaired this session: the 2026-09-24 auto-backup stash briefly polluted 5 oauth-rotator files into the working tree during a stash dance; verified those copies predated HEAD's own fixes and restored all 5 to HEAD (guarded checkout, OTP-authorized).
- 2026-09-29T22:50:00+0200 — probe-needle CONTRACT AMENDED (adversarial review of JT3U4ZVM's record commit): your blocker-probe greps git log for 'G16 emit', and that string now appears in MORE than the fix commit — docs commit 91d6fb52 (JT3U4ZVM card records) carries it in its subject, permanently in history. The needle still fires correctly when the fix lands, but needle-match is NO LONGER DISCRIMINATING evidence the FIX landed. When the probe fires, verify the fix by SHA — 844c6730a must be an ancestor of the branch and present in the built bundle — before ticking anything on its strength.
