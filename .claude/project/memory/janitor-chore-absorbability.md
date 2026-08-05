---
name: janitor-chore-absorbability
description: "can the ai-maestro server take over this janitor chore / should we absorb chore X / I added a name to SERVER_ABSORBED_TASKS and nothing changed / why is the janitor daemon not running while the server is up / who guards the non-harness claude sessions / the janitor reports a chore dark but we ARE running it / is a hibernated agent broken"
ocd: 2026-08-05
lmd: 2026-08-05
metadata:
  node_type: memory
  type: project
  tier: aspect
---

# janitor-chore-absorbability


^ATOM-42IZ-Z6VI [desc:"A chore is absorbable IFF its population is DATA the server already holds — never processes or sessions on the host", keywords: can_the_server_absorb_this_chore which_janitor_chores_are_absorbable should_ai-maestro_take_over_chore_X absorb_all_eleven_chores, ocd: 2026-08-05, lmd: 2026-08-05]

**THE TEST, and it decides every case: a janitor chore is absorbable by the ai-maestro server IFF
its POPULATION is DATA the server holds. It is NOT absorbable when the population is
PROCESSES or SESSIONS on the host** — the server has no view of those and cannot acquire one
without becoming the daemon.

Verdicts for the six unabsorbed chores, read from the janitor's task implementations in
`daemon.py`, not from the chore names:

| chore | its population | absorbable? |
|---|---|---|
| `session-liveness` | SPLIT — harness agents (ours) + every other claude instance (TTY-reached) | half |
| `fleet-stop` | every running claude session, via `fleet_scan` + `fleet_inject` | no |
| `memory-guard` | janitor-owned processes machine-wide — and it SIGKILLs them | no |
| `cache-prune` | the plugin cache dir, but its safety cutoff comes from the oldest LIVE claude session | no |
| `rules-cleanup` | the janitor's own rule files, only once it is fully uninstalled | no (structurally) |
| `github-config-audit` | an enumerable list of GitHub repos — the server already holds it (`lib/ecosystem-constants.ts`) and has an authenticated `gh` | **yes** |

`cache-prune` is the instructive row: the cache is just a directory, so it LOOKS absorbable — until
you read what makes it safe. Its cutoff comes from the oldest live `claude` process, and absorbing
the prune without the cutoff takes the one chore whose failure mode is pulling a plugin out from
under a running session.


^ATOM-052B-G6FG [desc:"The daemon EXITS wholesale while a server is up, so SERVER_ABSORBED_TASKS is inert and there is no per-chore handover", keywords: SERVER_ABSORBED_TASKS_did_nothing added_a_chore_to_the_absorbed_list_and_nothing_changed why_is_the_janitor_daemon_not_running daemon_exits_when_the_server_is_up who_guards_the_non-harness_claude_sessions, ocd: 2026-08-05, lmd: 2026-08-05]

**There is no per-chore handover. The daemon EXITS.** `global_state.py::ensure_daemon_running` is
`if _server_owns_host(): return False` — unconditional, no per-chore granularity — so while an
ai-maestro server is alive the janitor daemon never spawns at all.

So **`SERVER_ABSORBED_TASKS` is INERT in normal operation** and adding a name to it changes nothing;
the janitor's own PORT NOTE (`scripts/daemon.py`, at `_SERVER_ABSORBED_TASK_NAMES`) says the binary
exit happens *"BEFORE this per-chore yield is ever evaluated … so this yield yields nothing"*. The
list governs only the env-override and maintenance-keepalive paths.

**The honest statement of the gap is therefore not "5 of 11 absorbed"** but: **the suppression is
BINARY and the absorption is PARTIAL — whatever the server does not do, nobody does.** That is why
the 5-vs-11 arithmetic never balanced.

Tracked on `Emasoft/ai-maestro-janitor#196`. See also [[family-a-continuity-absorption-plan]], which
owns the SEPARATE Family-A (oauth/continuity) absorption. [^2]


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

## Notes and lessons learned

[^1]: [id:ATOM-W713-40TF, status:valid, desc:"The gate that blocks your tool is usually the security boundary, not an obstacle", keywords:"check_api_running_blocks_my_tool the_janitor_daemon_has_no_AID_AUTH build_an_auth-free_CLI works_with_the_server_down_is_a_feature agent_roster_without_authentication", ocd:2026-08-05, lmd:2026-08-05] DO NOT route around `aimaestro-agent.sh`'s `check_api_running || exit 1` + `$AID_AUTH` bearer by building a side-door CLI that reads `~/.aimaestro` directly, BECAUSE that gate IS the security boundary: agent status is not public data (a roster names every agent, its uuid and its tmux session name), and with no server running there is nothing to validate signatures against, so nothing may execute. Shipped exactly that — an unauthenticated roster dump that "worked with the server down", documented as a FEATURE in both the module header and the commit message — and it was reverted (`3f069c22`). The premise was false anyway: the janitor never needs to call in, because the daemon PUBLISHES to it. DO put the surface behind the existing authenticated script (inheriting the boundary rather than duplicating it) and let the in-server daemon publish to `<project>/.janitor/daemon_responses/` for anything that cannot authenticate.
[^2]: [id:ATOM-6U79-6OHD, status:valid, desc:"Never stamp a chore you only partly perform — it tells the other owner to stop covering the rest", keywords:"stamp_a_chore_we_only_half_do last-run_stamp_for_a_partially_covered_chore reporting_a_chore_as_owned absorbed_chore_stamp", ocd:2026-08-05, lmd:2026-08-05] DO NOT write a `<chore>.last-run.ts` stamp for a chore you only PARTLY perform, BECAUSE a stamp asserts "this chore is being done on cadence" and the janitor reads it as permission to stop — so a half-covered stamp silently disowns the half nobody else can see. Nearly stamped `session-liveness` on the strength of running the harness half, which would have told the janitor to drop the host-wide half it was already declining. DO answer "can the server even SEE this population?" FIRST, and stamp only a chore you cover completely; a chore reported healthy while half of it happens is the same defect as one reported healthy while none of it happens.
[^3]: [id:ATOM-ZOTD-QPTN, status:valid, desc:"A zero-findings audit cannot distinguish a clean fleet from a blind probe", keywords:"zero_findings_on_a_live_corpus my_audit_found_nothing_is_that_good clean_result_or_blind_probe audit_reports_no_findings is_the_scan_actually_seeing_anything", ocd:2026-08-05, lmd:2026-08-05] DO NOT report an audit's ZERO FINDINGS as a clean result, BECAUSE zero is exactly what a blind probe returns too — this classifier is silent on every unprovable answer by design, so a missing `gh`, a revoked token, or a non-admin repo yields the same empty findings list as a fully compliant fleet. DO prove the zero is REAL before believing it: check the probe returns live data for at least one repo and hand-trace that repo's verdict, then confirm every repo was actually VISIBLE (here: 14/14 admin, since a non-admin repo is silently skipped). Measured 2026-08-05 — the first live run read 14 repos / 0 findings, and only those two checks separated "the fleet is compliant" from "the sweep saw nothing".

[^4]: [id:ATOM-8QK2-M5XV, status:valid, desc:"An enum quoted from memory in a comment makes the correct argument it supports look wrong", keywords:"comment_lists_the_wrong_enum_values docstring_disagrees_with_the_type Agent_status_enum_missing_idle copied_comment_repeated_across_files stale_enum_in_a_docstring", ocd:2026-08-05, lmd:2026-08-05] DO NOT quote an enum's values from memory into prose that ARGUES from them, BECAUSE the argument then fails its own reader's check: this page, `lib/agent-hibernation.ts`, `app/api/agents/hibernation/route.ts`, `scripts/agent-commands.sh` and a test docstring ALL said `Agent['status']` is `active | offline | deleted`, omitting `idle` — five copies of one sentence, propagated by copy-paste, while the real type (`types/agent.ts:465`) has four values. The CLAIM built on it ("hibernated, crashed and never-woken all read `offline`") was always TRUE and stayed true, which is what made the error survive: nothing behavioural could ever redden, and a reader who verified the enum against the type found a mismatch that discredits a correct argument. Found by ai-maestro#114, fixed 2026-08-05 in four places; the fifth is an archived TRDD, deliberately left because a terminal card is frozen and is the historical record of what was believed then. DO cite the definition site (`types/agent.ts:465`) instead of restating the values, so the reader checks the source rather than a copy — and when a sentence must list them, grep for that sentence before assuming yours is the only copy.
