---
name: janitor-chore-absorbability-hibernation-and-guard-gaps
description: "is a hibernated agent broken / hibernated vs crashed vs never-woken / agent status says offline for everything / does Agent status enum have hibernated / where do I get the hibernation state / hibernation API endpoint / how does the janitor get agent status / daemon responses hibernation json / who guards the non-harness claude sessions / orphaned janitor rules never removed / rules-cleanup never runs / nobody guards my terminal claude session / uninstalled plugin rules persist"
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

# janitor-chore-absorbability-hibernation-and-guard-gaps

Hibernation is a DERIVED agent state, not a stored one — and the same binary claim/no-claim
suppression that makes `session-liveness` half-absorbable leaves non-harness sessions unguarded
and `rules-cleanup` unreachable. Part of the [[janitor-chore-absorbability]] topic — see that
page for the full map.

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


## Notes and lessons learned
[^1]: [id:ATOM-W713-40TF, status:valid, desc:"The gate that blocks your tool is usually the security boundary, not an obstacle", keywords:"check_api_running_blocks_my_tool the_janitor_daemon_has_no_AID_AUTH build_an_auth-free_CLI works_with_the_server_down_is_a_feature agent_roster_without_authentication", ocd:2026-08-05, lmd:2026-08-05] DO NOT route around `aimaestro-agent.sh`'s `check_api_running || exit 1` + `$AID_AUTH` bearer by building a side-door CLI that reads `~/.aimaestro` directly, BECAUSE that gate IS the security boundary: agent status is not public data (a roster names every agent, its uuid and its tmux session name), and with no server running there is nothing to validate signatures against, so nothing may execute. Shipped exactly that — an unauthenticated roster dump that "worked with the server down", documented as a FEATURE in both the module header and the commit message — and it was reverted (`3f069c22`). The premise was false anyway: the janitor never needs to call in, because the daemon PUBLISHES to it. DO put the surface behind the existing authenticated script (inheriting the boundary rather than duplicating it) and let the in-server daemon publish to `<project>/.janitor/daemon_responses/` for anything that cannot authenticate.
[^4]: [id:ATOM-8QK2-M5XV, status:valid, desc:"An enum quoted from memory in a comment makes the correct argument it supports look wrong", keywords:"comment_lists_the_wrong_enum_values docstring_disagrees_with_the_type Agent_status_enum_missing_idle copied_comment_repeated_across_files stale_enum_in_a_docstring", ocd:2026-08-05, lmd:2026-08-05] DO NOT quote an enum's values from memory into prose that ARGUES from them, BECAUSE the argument then fails its own reader's check: this page, `lib/agent-hibernation.ts`, `app/api/agents/hibernation/route.ts`, `scripts/agent-commands.sh` and a test docstring ALL said `Agent['status']` is `active | offline | deleted`, omitting `idle` — five copies of one sentence, propagated by copy-paste, while the real type (`types/agent.ts:465`) has four values. The CLAIM built on it ("hibernated, crashed and never-woken all read `offline`") was always TRUE and stayed true, which is what made the error survive: nothing behavioural could ever redden, and a reader who verified the enum against the type found a mismatch that discredits a correct argument. Found by ai-maestro#114, fixed 2026-08-05 in four places; the fifth is an archived TRDD, deliberately left because a terminal card is frozen and is the historical record of what was believed then. DO cite the definition site (`types/agent.ts:465`) instead of restating the values, so the reader checks the source rather than a copy — and when a sentence must list them, grep for that sentence before assuming yours is the only copy.
