---
name: janitor-chore-absorbability-github-audit-and-autoupdate-monitoring
description: "which repos does the github-config-audit scan / does the audit population differ from ecosystem-constants / where do the github-config findings go / can I write into the janitor state dir / server publishes janitor consumes / auto-update says enabled false and lastRunAt null but something is making hundreds of calls / lastRunSummary shows 38 failed plugin updates that no longer happen / the same plugin appears both failed and updated / is the absorbed lane running at all / restart delayed the absorbed chore for hours / chore-stale alarm but the lane is alive / user-plugins-update late after reboot"
ocd: 2026-08-05
lmd: 2026-09-06
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: reliability-patterns
publish-globally: false
split-lineage: 7381dedd309c4442890dc1bdf222dc3f
---

# janitor-chore-absorbability-github-audit-and-autoupdate-monitoring

`github-config-audit`'s population source and findings-publishing boundary, plus how to read the
absorbed auto-update lane's observability signals (`lastAbsorbedRunAt`, the rolling
`lastRunSummary` trail, and the 15-min poll's phase-skew behaviour) without mistaking stale
reporting for a dead lane. Part of the [[janitor-chore-absorbability]] topic — see that page for
the full map.

^ATOM-A3SZ-S4BB [desc:"github-config-audit IS absorbed (4h) — but its population must come from the marketplace catalog, never from lib/ecosystem-constants.ts", keywords: which_repos_does_the_github-config-audit_scan audit_population_differs_from_ecosystem-constants my_audit_covers_only_some_repos absorbed_a_chore_but_it_audits_the_wrong_set where_does_the_janitor_get_its_fleet_repo_list, ocd: 2026-08-05, lmd: 2026-08-05]

**`github-config-audit` is ABSORBED as of 2026-08-05** (USER go-ahead, 4-hour cadence — tighter
than the janitor's own 6 h). It is the only one of the six formerly-unowned chores that could be,
per the absorbability test above. `lib/github-config-audit.ts`, read-only `gh api` GETs, wired in
`server.mjs`, stamping `github-config-audit.last-run.ts`.

**THE POPULATION COMES FROM THE MARKETPLACE CATALOG, NEVER FROM `lib/ecosystem-constants.ts`.**
The janitor derives it from each plugin's `source.url` in
`~/.claude/plugins/marketplaces/ai-maestro-plugins/.claude-plugin/marketplace.json`
(`github_config_audit.fleet_repo_slugs`). Measured, that set and what our constants can enumerate
differ in BOTH directions:

| | count |
|---|---|
| overlap | 10 |
| **it audits, our constants cannot name** | **4** (`ai-maestro-janitor`, `-visual-communicator-plugin`, `-web-scenario-tester`, `-webdesign`) |
| we hold, it never audits | 5 (the app upstream, `agent-identity`, `AgentlensPro`, the marketplace, `claude-plugin`) |

So a constants-driven audit covers **10 of 14** — and because it also STAMPS, it would tell the
janitor to stop covering the other four, which would then be audited by nobody. Reading the same
file makes both populations identical BY CONSTRUCTION rather than by a coincidence that drifts the
next time a plugin is published.

Where the findings go, and why not into the janitor's own directory: see `^ATOM-GC1D-F6ZS`. [^3]


^ATOM-GC1D-F6ZS [desc:"The findings file is wire-identical to the janitor's but lives in ~/.aimaestro — we publish, they consume", keywords: where_do_the_github-config_findings_go can_I_write_into_the_janitor_state_dir server_publishes_janitor_consumes findings_file_path write_boundary_only_aimaestro_and_agents, ocd: 2026-08-05, lmd: 2026-08-05]

The audit's findings go to **`~/.aimaestro/github-config-findings.json`**, deliberately
wire-identical to the janitor's own: same `FINDING_CODES`, same `FINDING_BLURB` text, same
`{generated_at, repos_scanned, findings:[{slug, code, detail}]}` shape, and the same tri-state
silence rules (a probe that could not determine an answer never becomes a finding).

**Same basename, different directory, and the directory is not negotiable.**
`lib/write-boundary.ts` carries a standing USER directive — *"the only writings should be into
`~/.aimaestro` and into `~/agents`"* — with a build-gate detector enforcing it. So writing into the
janitor's `<global-state>/` to feed their near-free per-session detector directly would breach it,
however convenient. Asked them to read our path instead on `ai-maestro-janitor#197`.

That is the established direction of travel in this ecosystem and worth generalising: **the server
PUBLISHES, the janitor CONSUMES** — the same shape as `server-liveness.json`,
`agent-directory.json` and `<project>/.janitor/daemon_responses/`. When a cross-project handoff
needs a file, the question is never "may I write into their tree" but "where do I publish so they
can read it".


^ATOM-AL7D-5VUY [desc:"The absorbed auto-update lane is NOT gated on enabled, so the settings file can read enabled:false lastRunAt:null while it is making hundreds of calls — read lastAbsorbedRunAt, and group lastRunSummar", keywords: auto-update_reports_failures_but_plugins_are_current lastRunSummary_shows_38_failed absorbed_lane_observability is_anything_running lastAbsorbedRunAt enabled_false_but_network_calls github_rate_limit_investigation, ocd: 2026-08-06, lmd: 2026-08-06]

`services/auto-update-service.ts` runs **two lanes** against
`~/.aimaestro/auto-update-settings.json`, and only one of them obeys the master
toggle:

| lane | gated on `enabled`? | its timestamp |
|---|---|---|
| the user-facing scheduler | **yes** | `lastRunAt` |
| the **absorbed-duty** lane (TRDD-PE54D95Q AC5) | **NO — always runs** | `lastAbsorbedRunAt` |

So the file can honestly report `enabled: false` and `lastRunAt: null` while the
absorbed lane ran an hour ago and made hundreds of network calls. Every field is
true on its own and the document as a whole misleads — this is what made a
GitHub rate-limit investigation take six wrong hypotheses before anyone looked
here. `lastAbsorbedRunAt` exists so "is anything running?" is answerable by
READING the file rather than inferring from a summary.


^ATOM-5PRK-83BU [desc:"lastRunSummary is a CROSS-TICK rolling trail capped at 200 rows spanning ~3 ticks — counting statuses across the whole array reports failures a clean lane no longer has; group rows by 'at' first", keywords: lastRunSummary_shows_failures_that_no_longer_happen 38_failed_but_the_lane_is_clean same_plugin_both_failed_and_updated auto-update_summary_lies rolling_trail_not_this_run group_by_at, ocd: 2026-08-06, lmd: 2026-08-06]

**`lastRunSummary` is a CROSS-TICK rolling trail, not this run's results**,
despite the name. `appendRunEntry` PREPENDS and caps at 200, so the array spans
however many recent ticks fit in 200 rows — three, at the ~80 targets/tick this
host sees.

Counting statuses across the whole array reports failures for a lane that
currently has none, and the SAME target legitimately appears as both `failed`
and `updated` at different timestamps. **Group rows by `at` before drawing any
conclusion.**

Measured 2026-08-06: 200 rows over 80 distinct targets = one PRE-fix tick (38
failed) plus two POST-fix ticks (80 updated / 0 failed each). The misread
happened three times in one afternoon — twice by hand and once by a monitoring
script — before anyone grouped by `at`. The name is kept because it is a
PERSISTED field and renaming it needs a migration; the docstring in
`lib/auto-update-settings.ts` is the cheaper half of that fix.


^ATOM-VBE2-CV24 [desc:"Absorbed lane polls every 15min gated on the persisted stamp (db6cf8f8) — restarts no longer re-phase; stale alarm during a long tick is normal", keywords: restart_delayed_absorbed_chore_hours chore-stale_alarm_but_lane_alive absorbed_lane_tick_timing_after_pm2_restart user-plugins-update_late_after_reboot phase_skew_boot_anchored_interval, ocd: 2026-08-08, lmd: 2026-08-08]

Since db6cf8f8 (2026-08-08) the absorbed lane's repeating timer is a 15-min POLL gated on the persisted lastAbsorbedRunAt stamp (runAbsorbedDutyPoll in services/auto-update-service.ts) — the tick grid anchors on the STAMP, never on boot. Before that, setInterval(cadence) anchored on BOOT, so a restart re-phased the lane and a due chore waited up to a full 4h interval (measured live: due 22:43, ran 01:03:50 = boot 21:03:50 + 4h). The 4h CADENCE constant is unchanged, still enforced by absorbedDutyIsOverdue; the poll does no network work (one local settings read). A chore-stale alarm during one long tick is expected: per-chore stamps write at chore COMPLETION, and a marketplace sweep alone can run 25+ minutes.


## Notes and lessons learned
[^3]: [id:ATOM-ZOTD-QPTN, status:valid, desc:"A zero-findings audit cannot distinguish a clean fleet from a blind probe", keywords:"zero_findings_on_a_live_corpus my_audit_found_nothing_is_that_good clean_result_or_blind_probe audit_reports_no_findings is_the_scan_actually_seeing_anything", ocd:2026-08-05, lmd:2026-08-05] DO NOT report an audit's ZERO FINDINGS as a clean result, BECAUSE zero is exactly what a blind probe returns too — this classifier is silent on every unprovable answer by design, so a missing `gh`, a revoked token, or a non-admin repo yields the same empty findings list as a fully compliant fleet. DO prove the zero is REAL before believing it: check the probe returns live data for at least one repo and hand-trace that repo's verdict, then confirm every repo was actually VISIBLE (here: 14/14 admin, since a non-admin repo is silently skipped). Measured 2026-08-05 — the first live run read 14 repos / 0 findings, and only those two checks separated "the fleet is compliant" from "the sweep saw nothing".
