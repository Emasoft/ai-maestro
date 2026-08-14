---
name: trdd-d4-watchdog
description: "why does the server log [trdd-watchdog] sweep ran / what is the D3 objective floor / a MANDATE-FORGED or D3-FLOOR-UNDERCLASSIFIED finding raised my card's approval floor / where does the trdd governance sweep run and where is its report"
ocd: 2026-08-14
lmd: 2026-08-14
metadata:
  node_type: memory
  type: project
  tier: component
---

# trdd-d4-watchdog


^ATOM-I9YN-ZA5N [keywords: trdd-watchdog_log_line D3_objective_floor MANDATE-FORGED D3-FLOOR-UNDERCLASSIFIED approval_floor_raised_by_watchdog where_does_the_trdd_sweep_run reports/trdd-watchdog yarn_trdd:watchdog_exit_codes coverage_scanner_rule_cited_in_lib_marks_ENFORCED, ocd: 2026-08-14, lmd: 2026-08-14]

The §D4 approval-ladder watchdog (TRDD-AYBAMFN2/8F8PJEXI/TGNU1EP7, landed 80898e1e) splits across two engines: `lib/trdd-doctor.ts` owns §D4 steps 3-6 (mandate-vs-DECLARED-floor, platelet invariants via trdd-graph, completion/checklist gates, approval-record invariant); `lib/trdd-watchdog.ts` owns what nothing enforced — the D3 objective floor (unambiguous frontmatter signals like release-via error-tier; prose signals like a .github/ path warn-tier for the MANAGER queue), mandate-vs-COMPUTED-floor incl. the 3P-ZON-11 commit-diff tier (floor from `git show --name-only` on implementation-commits — the one evidence the author does not control; emits MANDATE-FORGED), and supersede authority (Agent: trailer vs T_new created-by; blind spots COUNTED in supersedeUnattributed/commitFloorUnresolved, never guessed). Surfaces: `yarn trdd:watchdog` (consolidated report, exit 0 clean / 1 error findings / 2 could-not-run — warns alone exit 0), and the ONE scheduled host `lib/trdd-watchdog-scheduler.ts` registered in server.mjs (6h, AIM_TRDD_WATCHDOG_INTERVAL_MS override, reporting-only, logs EVERY run to pm2 stderr — the run line is the liveness evidence — report to reports/trdd-watchdog/). Never add a second scheduled host (independent cooldowns defeat each other, ai-maestro#51). Gotcha: never cite a rule id like R-numbers in lib/ comments — the coverage scanner classifies any rule cited in lib/ as ENFORCED, and a reader is not an enforcer (that flip reddened enforcement-coverage once; fixed bcce6e97).

## Notes and lessons learned
