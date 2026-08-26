---
name: plugin-abstraction-and-script-layer
description: "why can't a plugin call the ai-maestro API directly / a hook is calling fetch('/api/...') and breaking on updates / what is the script layer / aimaestro-*.sh amp-*.sh aid-*.sh boundary / decoupling invariant / a plugin element hardcodes an endpoint URL / the CLI says the API is not reachable but my command is simply wrong / a typo'd argument or an unknown verb is blamed on the server / --help asks for a credential / the API returns 401 auth_required with the server online / is auth broken or the server down / my agent cannot call the server / how do agents authenticate / where do the AMP and AID scripts live now / did the AMP AID transition into ai-maestro complete / are claude-plugin and agent-identity still separate plugins / who installs a new amp or aid script / do I have to register a new script anywhere / the drift checker says every script is identical but a family is missing / a scan set omission reports as clean / an inline regex predicate is pinned by no test / the compared count is smaller than the real count / where is the abstraction-layer diagram / a new CLI is stale on PATH or exits 127 after shipping / which installer deploys a script — the INSTALLED_FILES list or the glob"
ocd: 2026-08-02
lmd: 2026-08-26
metadata:
  node_type: memory
  type: reference
  tier: aspect
  topic: plugins-and-marketplaces
publish-globally: false
---

# plugin-abstraction-and-script-layer

All AI Maestro functionality is exposed through two abstraction layers. External plugins MUST use these layers — never call the API directly. See [docs/PLUGIN-ABSTRACTION-PRINCIPLE.md](../../docs/PLUGIN-ABSTRACTION-PRINCIPLE.md) for the full guide.

### Layer 1: Skills (for agents)

All AI Maestro skills are bundled in the `ai-maestro` plugin (marketplace: `Emasoft/ai-maestro-plugins`). Key skills:

| Skill | Covers |
|-------|--------|
| `team-governance` | Team CRUD, COS assignment, governance requests, transfers, auth headers |
| `ai-maestro-agents-management` | Agent lifecycle via `aimaestro-agent.sh` CLI |
| `agent-messaging` | Inter-agent messaging via `amp-*` scripts + governance messaging rules |
| `agent-identity` | AID protocol — Ed25519 identity, proof of possession, OAuth token exchange |
| `team-kanban` | Team task boards, dependencies, status tracking, GitHub sync |
| `mcp-discovery` | Discover MCP server tools without installing plugins |

These skills ARE the authoritative reference. When the API changes, only these skill files need updating. The plugin also includes 12 AMP slash commands (`/amp-send`, `/amp-inbox`, etc.).

### Layer 2: Scripts (for hooks)

AI Maestro installs CLI scripts to `~/.local/bin/` that wrap API calls:
- `aimaestro-agent.sh` — Agent lifecycle CLI (delegates to `agent-*.sh` modules)
- `aimaestro-session.sh` — Terminal control: `inject`, `slash`, `state`, `read-prompt`, `answer`, `queue*`
- `aimaestro-panel.sh` — HTML side panel: `set`, `open`, `close`, `refresh`, `status`, `feedback`
- `aimaestro-trdd.sh` — 3-pillars task API: `search`, `read`, `edit`, `approve`, `refuse`, `promote`, `archive`
- `aimaestro-teams.sh`, `aimaestro-governance.sh`, `aimaestro-hook.sh` — teams, governance, the hook shim
- `amp-send.sh`, `amp-inbox.sh`, `amp-read.sh`, `amp-kanban-*.sh`, etc. — Messaging + kanban CLI
- `aid-init.sh`, `aid-token.sh`, etc. — Agent Identity CLI

The same scripts are also bundled in the plugin (for slash commands). When the API changes, only these scripts need updating.

**Hibernated agents are never waited on.** A command addressed to a hibernated
agent is *enqueued*, not blocked on — `aimaestro-session.sh queue <agent>
--command-key <key> [--wake-first]` persists server-side and fires when that
agent next reaches a safe idle prompt. So an enqueued `/janitor-arm` always
succeeds: live agents run it now, hibernated agents run it on wake. Delivery is
eventual, never conditional. The queue does not widen authorization — `queue`
maps to `send-command`, which **R42 makes self-only for every title**: an agent
may enqueue on itself and on nobody else, MANAGER and COS included. Fanning out
across the fleet is the human USER's alone — and the USER *can* now call it:
`get_auth_args` resolves `$AID_AUTH` → `$AIMAESTRO_SESSION` →
`~/.aimaestro/cli-session` (the token `aimaestro-governance.sh login` writes), so
an agent sends a bearer and a human sends an `aim_session` cookie. (This
paragraph said the opposite — *"no USER auth path yet, so today it has no working
caller at all"* — for 19 days after `bc177864` built it, ai-maestro#55.)

`/janitor-arm` is per-project (it arms the heartbeat of the project whose session
runs it), which is why it must be delivered into each agent's own session. It is
NOT `/janitor-global-arm` — that one clears the machine-wide kill-switch and
pause flags and arms no heartbeat. No fleet-wide arm command exists today. See
[docs/SCRIPT-LAYER.md](../../docs/SCRIPT-LAYER.md) § *a hibernated agent is never
waited on*.

**Full reference: [docs/SCRIPT-LAYER.md](../../docs/SCRIPT-LAYER.md)** — every subcommand and the
authorization rules that apply to an agent caller. `install-messaging.sh` copies
`scripts/*.sh` by glob, so a new wrapper needs no installer edit.

This sentence used to end *"and the two things that are not true yet
(`aimaestro-trdd.sh`'s write verbs 403 for agents; the scripts have no USER auth
path)"*. **Both were fixed and the sentence was not.** The write verbs work for
agents under the `manage-trdd` action since `d7531e53` (TRDD-K2WJH7RF), and the
USER auth path landed in `bc177864` (ai-maestro#55). A "not true yet" list is a
promise to delete an entry when it comes true; **when you close one, delete its
line in the same commit** — a doc that says a capability is MISSING is worse than
one that omits it, because the reader stops looking. Two of these lived in the
file loaded into every session of this project.

### The decoupling invariant (the WHY — derive every rule below from THIS)

**Every plugin element MUST be decoupled from the AI Maestro server API.** The
API changes constantly; plugins must not. The immutable CLI script layer
(`~/.local/bin/aimaestro-*.sh`, `amp-*.sh`, `aid-*.sh`) is the ONLY boundary
that touches the API — it is the UI that shields every plugin from the
ever-changing API behind it. Any plugin element that names a `/api/...`
endpoint, a `:23000` URL, or issues an HTTP call to the server has coupled
itself to the API and WILL break on the next API change. **This applies to
EVERY element type — hooks and MCP servers included — not just the ones named
below. Derive the consequence for each element type; do not wait to be told.**

### Rules for External Plugins

1. **Prompt-elements (skills / commands / agents / rules / output-styles) MUST NOT embed API syntax** (no curl, no endpoint URLs, no headers). They describe functionality and reference the global AI Maestro skill by name.
2. **Executable elements — hooks, MCP servers, bundled scripts, and ANY other code a plugin ships — MUST NOT call the API directly.** They shell out to the globally-installed AI Maestro CLI scripts (`aimaestro-agent.sh`, `aimaestro-governance.sh`, `aimaestro-teams.sh`, `aimaestro-hook.sh`, `amp-*.sh`, …). A hook STAYS in its plugin but becomes a thin shim that calls the intermediary script (see `aimaestro-hook.sh`); an MCP server that needs server data calls the script layer, never `fetch('/api/...')`. If the layer lacks a needed call, ADD a script to ai-maestro — never reach past it.
3. **Governance rules are discovered at runtime** by reading the `team-governance` skill. Plugins MUST NOT hardcode governance rules, permission matrices, or role restrictions.
4. **No element-level exception — not even the core `ai-maestro-plugin`** (this SUPERSEDES the former "AI Maestro's own plugin is the exception"). The boundary is the **script layer**, not a plugin: the `aimaestro-*` / `amp-*` / `aid-*` scripts are the intermediary and the ONLY code allowed to call the API — and those scripts are **owned by and shipped from the ai-maestro project** (this repo), not bundled in any plugin. The core plugin's hook (`ai-maestro-hook.cjs`) goes through `aimaestro-hook.sh` exactly like every other plugin's elements. Any script that internally depends on the API lives in ai-maestro, OUT of the plugins.

### Benefits
- API change → update 1 skill/script → all plugins work
- New feature → add to skill → all agents discover it
- Governance rule change → update skill → all agents learn it automatically
- No "update hundreds of plugins" problem as the ecosystem grows


^ATOM-K0K8-5AR7 [desc:"A gate placed BEFORE recognition answers for questions it cannot answer — an unknown verb, a bad argument and --help are all decidable offline, so gating them on the server returns a FALSE cause", keywords: the_CLI_says_the_API_is_not_reachable_but_my_command_is_just_wrong unknown_verb_reported_as_a_server_error typo_in_an_argument_blamed_on_the_network --help_needs_a_credential gate_runs_before_the_verb_is_recognised offline_operation_gated_on_check_api_running, ocd: 2026-08-06, lmd: 2026-08-06]

**A gate must not run before the thing it gates is recognised.** In
`aimaestro-agent.sh`, `check_api_running` sat ahead of verb dispatch and argument
validation, so three operations that are decidable with **no network at all**
were answered with *"the API is not reachable"* — a false cause that aims the
caller at the wrong thing:

| operation | decidable offline? | what it used to say |
|---|---|---|
| `--help` | yes | needs a credential (29 of 50 CLIs) |
| an unknown verb | yes | the API is not reachable |
| `list --status hibernated` (invalid) | yes | the API is not reachable |

Same defect, three sightings, found one at a time over days — which is the tell
that it is positional, not per-verb. `docs/SCRIPT-MANIFEST.md` §6.4 now states
it: a LOCAL, OFFLINE operation must not be gated on the server.

**The fix is ONE verb list consulted in several MODES, never a second `case`
above the gate.** `dispatch()` takes a mode — `check` (is this a verb?),
`validate` (is its grammar legal?), `run` — and all three read the same arms. A
duplicated list is two statements of one fact and drifts the first time someone
adds a verb to only one: then either a real verb is rejected as unknown, or an
unknown one reaches the gate and gets the misleading message back.

Fixed in `51db1b8a` (verb half) + `f2abd10d` (argument half) under
`TRDD-T3FXA0Y0`. Cited by FUNCTION, not line — the fix moved the arms.


^ATOM-QGN4-YC69 [desc: "A 401 auth_required from the API with the server online means missing credentials, not a fault; the fix is AID_AUTH for agents / governance login for humans", keywords: 401 auth_required the_API_returns_401 my_agent_cannot_call_the_server is_auth_broken server_is_up_but_every_request_is_refused aimaestro-trdd.sh_401 how_do_agents_authenticate AID_AUTH check_registry.json_for_aid_field, type: reference, ocd: 2026-08-20, lmd: 2026-08-20]

`GET /api/sessions` (and every other route) returns **HTTP 401** with `{"error":"auth_required", ...}` when the caller presents no credentials — this is the API working correctly, not an auth malfunction or a broken server. `pm2` reporting the process `online` and the route responding at all are proof the server is fine; only the request lacked a credential. The 401 body itself names the fix: an AGENT exports `AID_AUTH="$(aid-auth.sh)"` before calling the API or a wrapper script like `aimaestro-trdd.sh`; a HUMAN runs `aimaestro-governance.sh login` once (needs the governance password, so this step can never be done by a model). Strict/destructive routes additionally need `AIMAESTRO_SUDO_TOKEN` (see the sudo-mode page).

Do not try to diagnose an agent's AID by grepping `~/.aimaestro/agents/registry.json` for an `aid`/`aidToken`-shaped key — that record has no such field (checked: none of its ~29 keys name an identity/token concept), so any such grep returns a false "no AID" for every agent regardless of the truth. The AID recovery store is `~/.aimaestro/aid-recovery-cache.json`; active governance tokens are in `~/.aimaestro/governance-tokens/active-tokens.json`.


^ATOM-DGJ6-1OJE [desc: "AMP and AID were ABSORBED into this repo (scripts + API) with their skills moved to the core plugin; the installer picks new scripts up BY GLOB, so nothing per-script is registered", keywords: where_do_the_amp_and_aid_scripts_live_now did_the_AMP_AID_transition_complete claude-plugin_agent-identity_repos_superseded who_installs_the_amp_aid_aimaestro_scripts scripts_in_repo_skills_in_plugin is_a_new_script_installed_automatically script-manifest_frozen_CLI_contract abstraction_layer_diagram_in_the_README, ocd: 2026-08-22, lmd: 2026-08-22]

THE ABSORPTION (verified complete 2026-08-22). AMP messaging and AID identity are no longer
separate plugins to integrate with: their **scripts and API endpoints live in THIS repo**, and
their **skills moved into the core plugin** (`ai-maestro-plugin`). That is the general rule stated
sharply — **ai-maestro installs the SCRIPTS, plugins install the SKILLS** — and it holds in both
directions, checked both ways rather than assumed.

The reason scripts belong here and not in a plugin: they are the ABSTRACTION LAYER, and a layer
only absorbs API churn if it ships from the same repo as the API it wraps. A script in a plugin
repo drifts the moment an endpoint changes. The full chain is diagrammed in the README
(`docs/img/abstraction-layer.svg`): **SERVER (functions) ↔ API (endpoints) ↔ SCRIPTS (symlinked to
PATH) ↔ PLUGINS (skills, hooks, agents)**. Plugins call the scripts; they never call the API.

INSTALLATION IS BY GLOB, NOT BY NAME (`install-messaging.sh:630`, `:755`). A new `amp-*` / `aid-*`
/ `aimaestro-*` script is installed with no registration step — which is why a survey that counts
QUOTED script names in the installer reports a large false "not installed" set. Measure the
DEPLOYED SURFACE instead of reading the installer.

`scripts/script-manifest.json` is the separate, frozen-CLI CONTRACT — 50 skill-facing entries
(amp 28 · aimaestro 16 · aid 6). Note there are TWO manifests and they answer different questions:
that JSON is the machine contract, `docs/SCRIPT-MANIFEST.md` is the human doc with its own tier
table and counts, and a new script must be announced in BOTH.

CONSEQUENCE ALREADY BANKED: the `AMP_PLUGIN_NAME` / `AMP_PLUGIN_REPO` / `AID_PLUGIN_NAME` /
`AID_PLUGIN_REPO` constants were DELETED from `lib/ecosystem-constants.ts` and its shell mirror.
They had zero consumers — not because they were dead weight, but because the architecture change
superseded them. `SKILL_PLUGIN_REPO` stays. [^1] [^2]

## See also

- [[role-plugins]] — role-plugins are one of the two plugin categories this script-layer boundary governs
- [[project-long-form-docs]] — `docs/PLUGIN-ABSTRACTION-PRINCIPLE.md` is the full long-form guide
  behind this page; go there for detail beyond what fits here.

## Notes and lessons learned

[^1]: [id: ATOM-NO2U-IWA5, status: valid, keywords: "drift_checker_reports_clean_but_a_whole_family_is_missing scan_set_omission_reports_as_clean inline_regex_predicate_pinned_by_no_test aid_scripts_invisible_to_the_checker detector_population_is_wrong compared_count_smaller_than_the_real_count", ocd: 2026-08-22, lmd: 2026-08-22] DO NOT inline the predicate that BUILDS a detector's scan set, BECAUSE an omission there reports as CLEAN and no test can see it: `check-script-drift.mjs` filtered on an inline `/^(amp|aimaestro)-.*\.sh$/`, so all six `aid-*` scripts were never in the compared population — it said "identical" about a set that silently excluded them, and went 47 → 54 compared the moment the family was admitted. A wrong POPULATION is invisible because every verdict it prints is true of the files it did look at. DO export the predicate (`isTrackedScriptName`, `lib/installed-script-drift.ts`), import it at the call site, and pin it with a test whose neuter drops one family and reddens.
[^2]: [id: ATOM-CTFP-3AWL, status: valid, desc: "two installers, only one is glob-based", keywords: "which_installer_deploys_a_cli INSTALLED_FILES_explicit_list_vs_glob new_cli_stale_on_PATH_exit_127 install-agent-cli_vs_install-messaging auto-installed_by_glob_was_false", ocd: 2026-08-26, lmd: 2026-08-26] DO NOT assume one installer with one mechanism: install-messaging.sh copies ALL scripts/*.sh by GLOB (:630/:755), BUT install-agent-cli.sh deploys the agent/governance CLI layer from an EXPLICIT INSTALLED_FILES list with no glob, BECAUSE TRDD-DXJZM3BW recorded 'auto-installed by the scripts/*.sh glob' as if it covered every installer and aimaestro-continuity.sh then sat 5 weeks stale on PATH (exit 127) until named in the list (20f44bad). DO check BOTH installers before claiming a new CLI deploys automatically.
