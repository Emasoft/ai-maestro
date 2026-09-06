---
name: janitor-chore-absorbability-ownership-and-liveness-signals
description: "a chore runs on both sides / the janitor still runs a chore the server absorbed / double-run marketplace-refresh / double-run version-update / which capability tokens does the janitor honour / a token it does not know claims nothing / publish the exact chore name / why are three chores deliberately not published / chore stamp frozen since July / which directory holds the janitor chore stamps / janitor-control vs global-state / does cache-prune log every run / cache-prune has no run line in the log / is cache-prune pending until the 6h tick / chore ownership flapped / server-liveness late beat warning / absence of a warn does not mean healthy"
ocd: 2026-09-05
lmd: 2026-09-06
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: reliability-patterns
publish-globally: false
split-lineage: 7381dedd309c4442890dc1bdf222dc3f
---

# janitor-chore-absorbability-ownership-and-liveness-signals

Three signals for whether a chore's ownership claim actually held: the capability-token
vocabulary that decides which claims mean anything, the on-disk stamp files that record an
attempted run, and the server-liveness late-beat warning that catches a stale claim before the
janitor's own 90s staleness check would. None of the three alone proves health — read them
together. Part of the [[janitor-chore-absorbability]] topic — see that page for the full map.

^ATOM-VXXQ-DM54 [desc: "a capability token the janitor does not know CLAIMS NOTHING — publish the exact GLOBAL_CHORES name or family-a, never a coarse token of our own; singleton-chores was one and marketplace-refresh / vers", keywords: janitor_still_runs_a_chore_the_server_absorbed chore_runs_on_both_sides double-run_marketplace-refresh double-run_version-update singleton-chores_token what_capabilities_does_the_server_publish server-liveness.json_capabilities_vocabulary claimed_chores_ignores_my_token which_chore_names_does_the_janitor_honour family-a_expands_to_what publishing_a_chore_we_do_not_run_makes_the_janitor_yield_it three_chores_deliberately_not_published cache-prune_fleet-plugins-update_github-config-audit_not_in_capabilities, trdd: TRDD-X9VLHBFZ, ocd: 2026-09-05, lmd: 2026-09-05]

**The janitor honours a capability token in exactly two forms** (v3.4.14 `harness_backend.py::claimed_chores`,
quoted by its maintainer session 2026-09-05): an EXACT name from its 15-name `GLOBAL_CHORES`, or the
coarse `family-a` which expands to ITS `SERVER_ABSORBED_TASKS`. **Any other token claims nothing**,
silently, "failing toward coverage". Our writer published `["family-a","singleton-chores"]`;
`singleton-chores` — our announcement that marketplace-refresh and version-update were absorbed — was
never a claim, so both chores ran on both sides whenever the server was up. Our docstring said the
janitor "never inspects token content"; true on 2026-08-02, false since the rev-8 contract of
2026-08-18 (`docs/claimed-chores-contract.md`).

Fixed `dc133c04`: `currentCapabilities` emits exact names, each gated by the predicate proving the
chore is live on this process. Live file after restart: `oauth-rotator-tick`, `oauth-rotator-supervisor`,
`marketplace-refresh`, `version-update`, plus whichever CONDITIONAL chores are armed; `family-a` kept
one release as alias. **Never publish a chore you cannot prove is running** — the daemon yields on our
word and the chore goes unrun fleet-wide. Three are deliberately unpublished until each scheduler
exports a liveness check (`cache-prune`, `fleet-plugins-update`, `github-config-audit`; TRDD-X9VLHBFZ).


^ATOM-2C2Q-R4RQ [desc: "BOTH writers stamp chores into ~/.claude/janitor-control/ (server janitorControlDir; janitor last_run_path); the four absorbed-chore *.last-run.ts under the plugin-data global-state/ dir are era-2 lef", keywords: chore_stamp_frozen_since_July marketplace-refresh_last-run_stamp_never_updates which_directory_holds_the_janitor_chore_stamps global-state_last-run.ts_stale janitor-control_vs_global-state server_stamp_mtime_does_not_match_the_log_line is_our_server_writing_the_github-config-audit_stamp stampChoreRun_path janitorControlDir JANITOR_CONTROL_DIR_override two_stamp_directories janitor_says_a_chore_we_run_is_frozen read_last_run_max_over_eras last_run_path_control_dir, trdd: TRDD-X9VLHBFZ, ocd: 2026-09-05, lmd: 2026-09-05]
`stampChoreRun(chore)` (lib/janitor-chore-stamp.ts:173) writes `${janitorControlDir()}/<chore>.last-run.ts`, and `janitorControlDir()` (lib/janitor-control.ts:65) is `$JANITOR_CONTROL_DIR` or `~/.claude/janitor-control/`. The janitor 3.4.14 stamps its GLOBAL chores into the SAME dir (`global_state.last_run_path` = `control_dir()/<task>.last-run.ts`, scripts/lib/global_state.py:300-310) and `read_last_run` (:313-328) takes the MAX over control_dir and the plugin-data `global-state/` path. Measured 2026-09-05: control-dir `github-config-audit.last-run.ts` = 1788595904 = 10:11:44+0200, identical to the second with the pm2 "[github-config-audit] 14 repos scanned" line. The plugin-data `global-state/` DIRECTORY is the daemon's canonical state dir and is live (memory-maint-* stamps land there daily; heartbeat and log too) — only its four absorbed-chore `*.last-run.ts` (github-config-audit and marketplace-refresh 2026-07-21, cache-prune 2026-07-25, fleet-plugins-update absent) are era-2 leftovers: the chore-stamp WRITER moved to control_dir, and those freezes PREDATE the server absorptions (github-config-audit 2026-08-05, cache-prune 2026-08-19), so "froze when yielded" is not the mechanism. A hand `ls` of that dir reports every absorbed chore frozen since July; `stat` BOTH paths with full dates before believing either "dead" or "healthy", and never dual-write to satisfy a reader looking at the wrong path. Cache-prune's silent-run stamp: see `^ATOM-RRSS-UUXB`.


^ATOM-RRSS-UUXB [desc: "cache-prune runs its FIRST beat immediately at scheduler start (void beat before setInterval) and logs a run line ONLY when it removed something — a silent attempt still writes the stamp, so 'schedule", keywords: cache-prune_has_no_run_line_in_the_log cache-prune_scheduled_but_never_ran is_cache-prune_pending_until_the_6h_tick cache-prune_stamp_one_second_after_scheduler_started silent_cache-prune_run first_beat_immediately_at_start void_beat_before_setInterval cache-prune_removed_N_stale_version_dirs_log_line does_cache-prune_log_every_run scheduler_started_is_not_a_run_line attempt-completion_stamp_semantics, trdd: TRDD-X9VLHBFZ, ocd: 2026-09-05, lmd: 2026-09-05]

`startCachePruneScheduler` (lib/cache-prune.ts:404-418) calls `void beat(log)` BEFORE arming `setInterval`, deliberately ("a bare interval would starve under a restart loop shorter than 6 h"), so the first prune runs at boot, not at the first 6 h tick. The run logs `[cache-prune] removed N stale version dir(s) …` ONLY when it removed something (last such line in pm2 out: 2026-08-29); a run that finds nothing to remove logs nothing but still stamps `cache-prune.last-run.ts`, per lib/janitor-chore-stamp.ts's attempt-completion contract (:26). Measured 2026-09-05: "[Startup] cache-prune scheduler started" at 10:10:54 and the control-dir stamp at 10:10:55 — the boot beat ran and removed nothing. Cost of reading it wrong: three successive messages to the janitor on one fact ("executes" → "pending" → "ran") because each was sent on the evidence for the previous claim. Measure the artifact the claim is about (the stamp, the scheduler body), not a neighbour of it (a log filter), BEFORE the sentence leaves the session.


^ATOM-RCG7-K54M [desc: "the liveness writer warns only on a late beat (gap>2x interval); silence never proves the reader saw it fresh", keywords: chore_ownership_flapped oauth-rotator-tick_ran_on_the_janitor_while_the_server_was_alive server-liveness_stale late_beat server-liveness_late_beat_warning gap_exceeds_2x_interval laptop_sleep_clock_jump 61_to_89_second_gap_invisible_to_reader absence_of_a_warn_does_not_mean_healthy janitor_daemon_treats_liveness_stale_at_90s startServerLiveness_injected_clock_for_tests pm2_error_log_late_beat_line, ocd: 2026-09-06, lmd: 2026-09-06]

`lib/server-liveness.ts` (commit aa961973) now logs ONE `console.warn` — `[server-liveness]
late beat: gap <ms>ms exceeds 2x interval <ms>ms` (stderr → pm2 error log) — only on the
TRANSITION where the gap since the previous 30s beat exceeds 2x the interval (60s); it stays
silent on every normal beat. `startServerLiveness()` also now accepts an injected `now` clock
so this is testable without real sleeps.

This pairs with, and does not replace, the janitor daemon's own read of
`~/.aimaestro/server-liveness.json`: the janitor polls it and calls it STALE at 90s. Our warn's
60s floor is stricter, so a late-beat line means the writer's wall-clock gap exceeded 60s — a
real stall OR a clock jump (laptop sleep) — and you disambiguate the two by cross-checking the
janitor's own daemon.log timestamps for a matching gap.

Two asymmetries to keep straight, not "the warn fully covers the reader's stale check":
- A 61-89s gap logs a warn here and NEVER trips the reader's 90s stale threshold — informational
  only, not an incident.
- The ABSENCE of a warn line does NOT exonerate the writer: a sub-60s internal gap between our
  own beats can still coincide with the reader's OWN poll timing (it polls independently, every
  60s) to make the file look stale to the reader even though our writer never logged anything.
  "No late-beat warning" is not proof the liveness file was fresh when the janitor checked it.

## Notes and lessons learned
