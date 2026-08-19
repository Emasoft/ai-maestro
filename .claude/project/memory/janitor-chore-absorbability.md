---
name: janitor-chore-absorbability
description: "can the ai-maestro server take over this janitor chore / should we absorb chore X / I added a name to SERVER_ABSORBED_TASKS and nothing changed / why is the janitor daemon not running while the server is up / who guards the non-harness claude sessions / the janitor reports a chore dark but we ARE running it / is a hibernated agent broken / auto-update says enabled false and lastRunAt null but something is making hundreds of calls / lastRunSummary shows 38 failed plugin updates that no longer happen / the same plugin appears both failed and updated / is the absorbed lane running at all / is cache-prune absorbed now or does the table still say no / is there a per-chore handover now or does the daemon still exit wholesale / which chores does the janitor still run while the server is up / is the absorbability table out of date / is memory-guard absorbed or armed / why does the liveness beat not claim memory-guard / detect-only memory guard would kill / AIM_MEMORY_GUARD claim follows arming activeAbsorbedChores CONDITIONAL_CHORES / is rules-cleanup absorbed or does the row still say no / orphaned janitor rules never removed — fixed / AIM_RULES_CLEANUP dark-shipped lib rules-cleanup / is fleet-stop absorbed or does the row still say no / who delivers janitor-disarm on the kill-switch / AIM_FLEET_STOP"
ocd: 2026-08-05
lmd: 2026-08-19
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: reliability-patterns
publish-globally: false
---

# janitor-chore-absorbability


^ATOM-42IZ-Z6VI [desc:"A chore is absorbable IFF its population is DATA the server holds, or a host observation the server can make with the daemon's own instrument AND safety cutoff (cache-prune absorbed 2026-08-19 on exactly that basis)", keywords: can_the_server_absorb_this_chore which_janitor_chores_are_absorbable should_ai-maestro_take_over_chore_X absorb_all_eleven_chores is_cache-prune_absorbed absorbability_table_out_of_date, ocd: 2026-08-05, lmd: 2026-08-19]

**THE TEST, and it decides every case: a janitor chore is absorbable by the ai-maestro server IFF
its POPULATION is DATA the server holds. It is NOT absorbable when the population is
PROCESSES or SESSIONS on the host** — the server has no view of those and cannot acquire one
without becoming the daemon.

Verdicts for the six unabsorbed chores, read from the janitor's task implementations in
`daemon.py`, not from the chore names:

| chore | its population | absorbable? |
|---|---|---|
| `session-liveness` | SPLIT — harness agents (ours) + every other claude instance (TTY-reached) | half |
| `fleet-stop` | every running claude session — 99LV0U4I's scan enumerates the non-agent half; ported into `lib/fleet-stop.ts` (TRDD-9FW92242); DEFAULT-OFF, the claim appears only under `AIM_FLEET_STOP=1` | **ported 2026-08-20 — claimed only when ARMED** [^9] |
| `memory-guard` | janitor-owned RUNAWAY processes machine-wide (signature allowlist), SIGTERM→SIGKILL — ported verbatim into `lib/memory-guard.ts` (TRDD-4QOWVSLU); DEFAULT-OFF, the claim appears only under `AIM_MEMORY_GUARD=1` | **ported 2026-08-19 — claimed only when ARMED** [^7] |
| `cache-prune` | the plugin cache dir; its safety cutoff comes from the oldest LIVE claude session — ported verbatim into `lib/cache-prune.ts` (TRDD-B8B6D56P) | **yes — absorbed 2026-08-19** |
| `rules-cleanup` | the janitor's own rule files, only once it is fully uninstalled — sweep ported verbatim into `lib/rules-cleanup.ts` (TRDD-5II83KK4); DEFAULT-OFF, the claim appears only under `AIM_RULES_CLEANUP=1` | **ported 2026-08-20 — claimed only when ARMED** [^8] |
| `github-config-audit` | an enumerable list of GitHub repos — the server already holds it (`lib/ecosystem-constants.ts`) and has an authenticated `gh` | **yes** |

`cache-prune` is the instructive row in BOTH directions: the cache is just a directory, so it LOOKS
absorbable — and the 2026-08-05 "no" was an objection to absorbing it WITHOUT the cutoff that makes
it safe (the oldest live `claude` process). The 2026-08-19 absorption ported that cutoff
(`pruneCutoff` = min(now−minAge, oldestSessionStart−margin), pinned set, basename-exact `claude`
match, ps snapshot to file): the population test therefore reads "DATA the server holds, OR a host
observation the server can make with the SAME instrument and the SAME safety cutoff the daemon
uses" — the server snapshots ps exactly as the daemon does. The live claim set is
`lib/janitor-chore-stamp.ts::ABSORBED_CHORES`, never this table; the remaining rows each have an
absorption NPT under KCRMSNL7 (JBFM8XR0 fleet-plugins-update, 5II83KK4 rules-cleanup, 4QOWVSLU
memory-guard, 99LV0U4I fleet-scan population → 9FW92242 fleet-stop). [^5] [^7] [^8] [^9]


^ATOM-052B-G6FG [desc:"The handover is PER CHORE (janitor yields what the server claims in absorbed_chores) and the daemon exits only when the server claims EVERY global chore — the wholesale exit / inert SERVER_ABSORBED_TASKS is superseded", keywords: SERVER_ABSORBED_TASKS_did_nothing added_a_chore_to_the_absorbed_list_and_nothing_changed why_is_the_janitor_daemon_not_running daemon_exits_when_the_server_is_up who_guards_the_non-harness_claude_sessions is_there_a_per-chore_handover which_chores_does_the_janitor_still_run server_owns_every_chore, ocd: 2026-08-05, lmd: 2026-08-19]

**The handover is PER CHORE now (since ai-maestro#111 / janitor#134; verified in the installed
janitor 3.3.16 on 2026-08-19).** `global_state._server_owns_host` delegates to
`harness_backend.server_owns_every_chore` — the daemon EXITS only when the server's claim covers
EVERY `GLOBAL_CHORES` entry (13 today) — and `daemon._task_yielded_to_server` yields ANY chore in
`harness_backend.claimed_chores()`, which reads the per-chore tokens the server publishes in
`~/.aimaestro/server-liveness.json` `absorbed_chores` (6 today). A claim is added in
`lib/janitor-chore-stamp.ts::ABSORBED_CHORES` ONLY in the commit that makes the lane live — a
claim-ahead is the #111 blackout shape (the janitor yields, nobody performs). Completion is
stamped at `~/.claude/janitor-control/<chore>.last-run.ts` on ATTEMPT; the janitor's stale bound is
max(3×cadence, cadence+600) of ITS roster cadence, so a slower server cadence must be negotiated
with the owner, not declared.

The BINARY suppression this atom used to describe (`if _server_owns_host(): return False` with no
per-chore granularity) is the SUPERSEDED state — see [^6] for the old body. The end state per the
owner ruling (janitor#134) is the server claiming ALL chores, at which point the one-daemon-per-host
exit fires; until then the janitor runs exactly the unclaimed remainder, so "whatever the server
does not do, nobody does" no longer holds.

Tracked on `Emasoft/ai-maestro-janitor#196` (history) and in KCRMSNL7's DESIGN RESOLVED section.
See also [[family-a-continuity-absorption-plan]], which owns the SEPARATE Family-A
(oauth/continuity) absorption. [^2] [^6]


^ATOM-VN7A-LW2R [desc:"Hibernation is DERIVED, not stored: Agent['status'] collapses hibernated/crashed/never-woken all into 'offline'", keywords: is_this_agent_hibernated_or_crashed agent_status_says_offline_for_everything hibernated_vs_crashed_vs_never_woken agent_shows_offline_but_is_it_broken Agent_status_enum_has_no_hibernated, ocd: 2026-08-05, lmd: 2026-08-05]

**There is no stored hibernation fact.** `Agent['status']` is `active | idle | offline | deleted`
(`types/agent.ts:465`) — four values, **none of them `hibernated`** — so a hibernated agent, a
crashed one, and one never woken **all read `offline`**. Anything reporting from `status` alone
cannot tell a deliberate sleep from an outage. [^4]

The derivation is `lib/agent-hibernation.ts` (shared with the fleet-liveness watchdog so the CLI,
the route and the running server cannot disagree):

- `!hasSession` → **never_woken**
- `exists` (a live tmux session) → **running**
- `!exists && isPersisted` → **crashed**
- `!exists && !isPersisted` → **hibernated**

**What makes `crashed` honest:** `hibernateAgent` calls `unpersistSession`, so a clean hibernate
ALWAYS removes the persistence record. A record that SURVIVES while tmux is gone therefore proves
the clean path never ran (a reboot, an outside kill, an OOM). **If that unpersist call is ever
removed, `crashed` inverts into a false positive on every hibernated agent.**

Two rules for consumers: **`hibernated` is HEALTHY** and must never be reported as a fault (only
`crashed` is unhealthy — a guardian that calls a deliberate sleep an outage manufactures alarms
nobody can act on); and an **UNKNOWN persistence reading must read `hibernated`, never `crashed`**,
because inventing an outage out of missing information is the alarming direction. [^1]


^ATOM-NQZ0-YO0S [desc:"Two measured consequences of the binary suppression: non-harness sessions are unguarded, and rules-cleanup is unreachable", keywords: nobody_guards_my_terminal_claude_session orphaned_rules_never_removed rules-cleanup_never_runs uninstalled_plugin_rules_persist non-harness_sessions_unguarded, ocd: 2026-08-05, lmd: 2026-08-05]

Two consequences of the binary suppression ([[janitor-chore-absorbability]] atom `052B-G6FG`),
both measured on this project rather than reasoned about:

- **Nobody guards the non-harness claude sessions** — plain terminal instances, zombies, legacy —
  while a server runs. The server cannot see them; the daemon that could is not running.
- **`rules-cleanup` becomes UNREACHABLE.** It runs only from the janitor's ORPHANED cache after a
  full uninstall, during the window before Claude Code GCs that cache — but the daemon never spawns
  while a server owns the host, so orphaned `~/.claude/rules/` files persist indefinitely. Not
  hypothetical: the janitor's shipped `janitor-footprint.md` opens by telling a reader what to do
  when it finds itself orphaned.


^ATOM-P2SS-RTUE [desc:"The three surfaces serving hibernation state, and who is allowed to use each", keywords: where_do_I_get_the_hibernation_state hibernation_API_endpoint aimaestro-agent.sh_hibernation how_does_the_janitor_get_agent_status daemon_responses_hibernation_json, ocd: 2026-08-05, lmd: 2026-08-05]

Three surfaces serve the hibernation state, and **which one you use is decided by whether you can
authenticate**:

| caller | surface |
|---|---|
| an authenticated agent or human | `aimaestro-agent.sh hibernation` (inherits that script's `check_api_running` + `AID_AUTH` bearer) |
| the dashboard / an authenticated client | `GET /api/agents/hibernation` |
| **a janitor process** | reads `<project>/.janitor/daemon_responses/hibernation.json` — it calls NOTHING |

The route is **authenticated on purpose**: a roster names every agent, its uuid and its tmux session
name — the same metadata class `/api/agents` gates ("prevent metadata leaks via Tailscale"). Agent
status is not public data.

An agent workdir receives only its OWN record plus fleet-wide COUNTS, never the roster: the full map
in every workdir would mean compromising any one agent yields the whole fleet.


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

[^1]: [id:ATOM-W713-40TF, status:valid, desc:"The gate that blocks your tool is usually the security boundary, not an obstacle", keywords:"check_api_running_blocks_my_tool the_janitor_daemon_has_no_AID_AUTH build_an_auth-free_CLI works_with_the_server_down_is_a_feature agent_roster_without_authentication", ocd:2026-08-05, lmd:2026-08-05] DO NOT route around `aimaestro-agent.sh`'s `check_api_running || exit 1` + `$AID_AUTH` bearer by building a side-door CLI that reads `~/.aimaestro` directly, BECAUSE that gate IS the security boundary: agent status is not public data (a roster names every agent, its uuid and its tmux session name), and with no server running there is nothing to validate signatures against, so nothing may execute. Shipped exactly that — an unauthenticated roster dump that "worked with the server down", documented as a FEATURE in both the module header and the commit message — and it was reverted (`3f069c22`). The premise was false anyway: the janitor never needs to call in, because the daemon PUBLISHES to it. DO put the surface behind the existing authenticated script (inheriting the boundary rather than duplicating it) and let the in-server daemon publish to `<project>/.janitor/daemon_responses/` for anything that cannot authenticate.
[^2]: [id:ATOM-6U79-6OHD, status:valid, desc:"Never stamp a chore you only partly perform — it tells the other owner to stop covering the rest", keywords:"stamp_a_chore_we_only_half_do last-run_stamp_for_a_partially_covered_chore reporting_a_chore_as_owned absorbed_chore_stamp", ocd:2026-08-05, lmd:2026-08-05] DO NOT write a `<chore>.last-run.ts` stamp for a chore you only PARTLY perform, BECAUSE a stamp asserts "this chore is being done on cadence" and the janitor reads it as permission to stop — so a half-covered stamp silently disowns the half nobody else can see. Nearly stamped `session-liveness` on the strength of running the harness half, which would have told the janitor to drop the host-wide half it was already declining. DO answer "can the server even SEE this population?" FIRST, and stamp only a chore you cover completely; a chore reported healthy while half of it happens is the same defect as one reported healthy while none of it happens.
[^3]: [id:ATOM-ZOTD-QPTN, status:valid, desc:"A zero-findings audit cannot distinguish a clean fleet from a blind probe", keywords:"zero_findings_on_a_live_corpus my_audit_found_nothing_is_that_good clean_result_or_blind_probe audit_reports_no_findings is_the_scan_actually_seeing_anything", ocd:2026-08-05, lmd:2026-08-05] DO NOT report an audit's ZERO FINDINGS as a clean result, BECAUSE zero is exactly what a blind probe returns too — this classifier is silent on every unprovable answer by design, so a missing `gh`, a revoked token, or a non-admin repo yields the same empty findings list as a fully compliant fleet. DO prove the zero is REAL before believing it: check the probe returns live data for at least one repo and hand-trace that repo's verdict, then confirm every repo was actually VISIBLE (here: 14/14 admin, since a non-admin repo is silently skipped). Measured 2026-08-05 — the first live run read 14 repos / 0 findings, and only those two checks separated "the fleet is compliant" from "the sweep saw nothing".

[^4]: [id:ATOM-8QK2-M5XV, status:valid, desc:"An enum quoted from memory in a comment makes the correct argument it supports look wrong", keywords:"comment_lists_the_wrong_enum_values docstring_disagrees_with_the_type Agent_status_enum_missing_idle copied_comment_repeated_across_files stale_enum_in_a_docstring", ocd:2026-08-05, lmd:2026-08-05] DO NOT quote an enum's values from memory into prose that ARGUES from them, BECAUSE the argument then fails its own reader's check: this page, `lib/agent-hibernation.ts`, `app/api/agents/hibernation/route.ts`, `scripts/agent-commands.sh` and a test docstring ALL said `Agent['status']` is `active | offline | deleted`, omitting `idle` — five copies of one sentence, propagated by copy-paste, while the real type (`types/agent.ts:465`) has four values. The CLAIM built on it ("hibernated, crashed and never-woken all read `offline`") was always TRUE and stayed true, which is what made the error survive: nothing behavioural could ever redden, and a reader who verified the enum against the type found a mismatch that discredits a correct argument. Found by ai-maestro#114, fixed 2026-08-05 in four places; the fifth is an archived TRDD, deliberately left because a terminal card is frozen and is the historical record of what was believed then. DO cite the definition site (`types/agent.ts:465`) instead of restating the values, so the reader checks the source rather than a copy — and when a sentence must list them, grep for that sentence before assuming yours is the only copy.
[^5]: [id: ATOM-R7EO-1EU4, status: valid, supersedes: ATOM-42IZ-Z6VI, desc: "The cache-prune 'no' row was a 2026-08-05 objection to absorbing WITHOUT the cutoff — lib/cache-prune.ts ports the cutoff, so the row is superseded", keywords: "cache-prune_is_absorbed_now cache-prune_row_says_no can_the_server_prune_the_plugin_cache oldest-live-session_cutoff_ported absorbability_table_out_of_date cache-prune_absorbed_2026-08-19 lib/cache-prune.ts", ocd: 2026-08-19, lmd: 2026-08-19] DO NOT read the `cache-prune | no` row of the absorbability table as current, BECAUSE it was an objection to absorbing the prune WITHOUT its oldest-live-session cutoff, and on 2026-08-19 (TRDD-B8B6D56P, parent KCRMSNL7) `lib/cache-prune.ts` ported that cutoff verbatim (`pruneCutoff` = min(now−minAge, oldestSessionStart−margin), pinned versions as a SET, basename-exact `claude` matching, ps snapshot to a file) and `cache-prune` joined `ABSORBED_CHORES` in the same commit as its scheduler — the server snapshots ps exactly as the daemon does (userland), so "processes we cannot see" never applied to this chore. DO treat the population test as "DATA the server holds OR a host observation the server can make with the same instrument and the same safety cutoff", and check `lib/janitor-chore-stamp.ts::ABSORBED_CHORES` + the liveness beat's `absorbed_chores` for what is absorbed TODAY rather than this table. SUPERSEDED BODY: **THE TEST, and it decides every case: a janitor chore is absorbable by the ai-maestro server IFF its POPULATION is DATA the server holds. It is NOT absorbable when the population is PROCESSES or SESSIONS on the host** — the server has no view of those and cannot acquire one without becoming the daemon. Verdicts for the six unabsorbed chores, read from the janitor's task implementations in `daemon.py`, not from the chore names: | chore | its population | absorbable? | |---|---|---| | `session-liveness` | SPLIT — harness agents (ours) + every other claude instance (TTY-reached) | half | | `fleet-stop` | every running claude session — 99LV0U4I's scan enumerates the non-agent half; ported into `lib/fleet-stop.ts` (TRDD-9FW92242); DEFAULT-OFF, the claim appears only under `AIM_FLEET_STOP=1` | **ported 2026-08-20 — claimed only when ARMED** [^9] | | `memory-guard` | janitor-owned processes machine-wide — and it SIGKILLs them | no | | `cache-prune` | the plugin cache dir, but its safety cutoff comes from the oldest LIVE claude session | no | | `rules-cleanup` | the janitor's own rule files, only once it is fully uninstalled — sweep ported verbatim into `lib/rules-cleanup.ts` (TRDD-5II83KK4); DEFAULT-OFF, the claim appears only under `AIM_RULES_CLEANUP=1` | **ported 2026-08-20 — claimed only when ARMED** [^8] | | `github-config-audit` | an enumerable list of GitHub repos — the server already holds it (`lib/ecosystem-constants.ts`) and has an authenticated `gh` | **yes** | `cache-prune` is the instructive row: the cache is just a directory, so it LOOKS absorbable — until you read what makes it safe. Its cutoff comes from the oldest live `claude` process, and absorbing the prune without the cutoff takes the one chore whose failure mode is pulling a plugin out from under a running session.
[^6]: [id: ATOM-E247-QB1U, status: valid, supersedes: ATOM-052B-G6FG, desc: "Superseded: since janitor#111/#134 the daemon yields PER CHORE from the server's absorbed_chores claim and exits only when the server claims every GLOBAL chore", keywords: "is_there_a_per-chore_handover_now daemon_exits_wholesale SERVER_ABSORBED_TASKS_inert janitor_yields_claimed_chores server_owns_every_chore absorbed_chores_in_server-liveness one-daemon-per-host_exit which_chores_does_the_janitor_still_run", ocd: 2026-08-19, lmd: 2026-08-19] DO NOT rely on "the daemon EXITS wholesale while a server is up, so SERVER_ABSORBED_TASKS is inert", BECAUSE that described the binary suppression BEFORE ai-maestro#111: verified in the installed janitor 3.3.16 on 2026-08-19, `global_state._server_owns_host` → `harness_backend.server_owns_every_chore` (full exit only when the server's `absorbed_chores` claim ⊇ GLOBAL_CHORES, 13 today), and `daemon._task_yielded_to_server` yields ANY chore in `harness_backend.claimed_chores()` — the per-chore tokens the server publishes in `~/.aimaestro/server-liveness.json` `absorbed_chores` (6 today: marketplace-refresh, version-update, oauth-rotator-supervisor, oauth-rotator-tick, github-config-audit, cache-prune). Owner ruling janitor#134: the end state is the server claiming ALL chores, at which point the one-daemon-per-host exit fires and sessions' `ensure_daemon_running` respawns nothing. DO read `lib/janitor-chore-stamp.ts::ABSORBED_CHORES` for the live claim set, remember a claim is added ONLY in the commit that makes the lane live (claim-ahead = the #111 blackout shape), and see KCRMSNL7's DESIGN RESOLVED section + its NPT flock (JBFM8XR0, 5II83KK4, 4QOWVSLU, 99LV0U4I, 9FW92242) for the remaining chores. SUPERSEDED BODY: **There is no per-chore handover. The daemon EXITS.** `global_state.py::ensure_daemon_running` is `if _server_owns_host(): return False` — unconditional, no per-chore granularity — so while an ai-maestro server is alive the janitor daemon never spawns at all. So **`SERVER_ABSORBED_TASKS` is INERT in normal operation** and adding a name to it changes nothing; the janitor's own PORT NOTE (`scripts/daemon.py`, at `_SERVER_ABSORBED_TASK_NAMES`) says the binary exit happens *"BEFORE this per-chore yield is ever evaluated … so this yield yields nothing"*. The list governs only the env-override and maintenance-keepalive paths. **The honest statement of the gap is therefore not "5 of 11 absorbed"** but: **the suppression is BINARY and the absorption is PARTIAL — whatever the server does not do, nobody does.** That is why the 5-vs-11 arithmetic never balanced. Tracked on `Emasoft/ai-maestro-janitor#196`. See also [[family-a-continuity-absorption-plan]], which owns the SEPARATE Family-A (oauth/continuity) absorption.
[^7]: [id: ATOM-6O9Y-JFLZ, status: valid, desc: "memory-guard was absorbed 2026-08-19 (TRDD-4QOWVSLU) as a DEFAULT-OFF lane: lib/memory-guard.ts ports the Tier-1 truth table verbatim; the claim is a runtime function of AIM_MEMORY_GUARD=1", keywords: "memory-guard_is_absorbed_now memory-guard_row_says_no can_the_server_kill_runaway_janitor_processes is_memory-guard_armed AIM_MEMORY_GUARD why_does_the_liveness_beat_not_claim_memory-guard detect-only_memory_guard claim_follows_arming activeAbsorbedChores CONDITIONAL_CHORES two_guards_killing the_janitor_still_kills_runaways_while_the_server_runs", ocd: 2026-08-19, lmd: 2026-08-19] DO NOT read the `memory-guard | no` row as current, and DO NOT conclude from `absorbed_chores` lacking `memory-guard` that the lane is missing, BECAUSE on 2026-08-19 (TRDD-4QOWVSLU, parent KCRMSNL7) `lib/memory-guard.ts` ported the janitor's Tier-1 truth table verbatim (signature allowlist, claude-session safelist, protected pids, 3600 s age gate, ONE kill per beat, NO-OP on an unknown reading, Tier 2 absent) but the lane is DESTRUCTIVE and ships default-OFF: unarmed it probes, snapshots ps to a file and logs `would kill … [detect-only: AIM_MEMORY_GUARD not set]`, never kills, never stamps, never claims. DO check `AIM_MEMORY_GUARD`: `=1` in the server env arms the kill AND marks the chore live (`janitor-chore-stamp.ts::markChoreLive`), so `activeAbsorbedChores()` — what the liveness beat publishes — carries `memory-guard` only while an armed scheduler runs; the janitor yields it in that same instant and keeps killing until then. `ABSORBED_CHORES` (the unconditional list) deliberately never contains it; `CONDITIONAL_CHORES` does.
[^8]: [id: ATOM-FRVI-1RD5, status: valid, desc: "The rules-cleanup 'no (structurally)' row is superseded — lib/rules-cleanup.ts absorbed the sweep 2026-08-20, dark-shipped behind AIM_RULES_CLEANUP", keywords: "rules-cleanup_is_absorbed_now rules-cleanup_row_says_no can_the_server_remove_orphaned_janitor_rules orphaned_rules_never_removed_fixed rules-cleanup_dark_shipped AIM_RULES_CLEANUP_flag lib/rules-cleanup.ts", ocd: 2026-08-19, lmd: 2026-08-19] DO NOT read the `rules-cleanup | no (structurally)` row as current, BECAUSE the "structural" objection (it runs only from the janitor's orphaned cache post-uninstall, which never spawns while a server owns the host) is exactly what the server absorption REMOVES — on 2026-08-20 (TRDD-5II83KK4, parent KCRMSNL7) `lib/rules-cleanup.ts` ported the marker-gated sweep + the BOTH-signals uninstalled predicate verbatim, dark-shipped (detect-only until AIM_RULES_CLEANUP=1; claim appears in absorbed_chores only when armed). DO check `activeAbsorbedChores()` for what is claimed TODAY; the server covers the post-uninstall window indefinitely where the orphaned daemon covered <=7 days.
[^9]: [id: ATOM-D69Y-B3RR, status: valid, desc: "The fleet-stop 'no' row is superseded — lib/fleet-stop.ts absorbed the kill-switch fan-out 2026-08-20, dark-shipped behind AIM_FLEET_STOP", keywords: "fleet-stop_is_absorbed_now fleet-stop_row_says_no can_the_server_stop_the_fleet kill-switch_fan-out_server_side AIM_FLEET_STOP_flag who_delivers_janitor-disarm_to_sessions", ocd: 2026-08-19, lmd: 2026-08-19] DO NOT read the `fleet-stop | no` row as current, BECAUSE the "population is every running claude session" objection was answered by TRDD-99LV0U4I (the scan now enumerates janitor-armed non-agent sessions with their tmux panes) and on 2026-08-20 (TRDD-9FW92242, parent KCRMSNL7) `lib/fleet-stop.ts` ported the kill-switch fan-out with the janitor's three gates verbatim, dark-shipped (detect-only until AIM_FLEET_STOP=1; claim appears only when armed). DO check `activeAbsorbedChores()` for what is claimed TODAY; registered agents route via the command queue, non-agent sessions via soft tmux send-keys, dedupe stamps in the server's own state root.
