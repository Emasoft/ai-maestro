---
name: runtime-install-tree
description: "where does ai-maestro store data on a host / what is in ~/.aimaestro / what is inside the ~/agents folder / where are plugins installed vs where is plugin source / is ~/ai-maestro the install tree / where does claude code store chat transcripts / where are AMP messages stored on disk / where are role-plugins vs custom-plugins vs core-plugins / what is verified vs legacy in the state dir"
ocd: 2026-08-02
lmd: 2026-09-13
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: architecture-and-runtime
publish-globally: false
---

# runtime-install-tree

^BT8PGTZP [desc:"Runtime install tree is distinct from the source repo layout; verified paths are used by current code, legacy/unverified paths are present on disk but unconfirmed", keywords:"where_does_ai-maestro_store_data_on_a_host runtime_install_tree_vs_source_repo verified_vs_legacy_paths in_the_state_dir getStateDir_resolves_to_tilde_dot_aimaestro STATE_DIR_NAME_dot_aimaestro do_not_guess_paths_look_them_up confirm_before_relying_on_a_legacy_path ecosystem-constants_dot_ts", ocd:2026-08-02, lmd:2026-09-13]
This is the **runtime install tree**: where AI Maestro actually stores data on each host,
distinct from the source repo layout (see [[repo-file-structure]]). **Do not guess paths — look
them up here.** Paths tagged `(verified)` are created/used by current code (`statePath()` /
`getStateDir()` resolve to `~/.aimaestro`, `STATE_DIR_NAME='.aimaestro'`,
`lib/ecosystem-constants.ts`); `(legacy/unverified)` = present on disk but not referenced by
current code — confirm before relying on them.

^I7SZR6CS [desc:"the ai-maestro dev repo is NOT the install tree; a packaged install has no tilde ai-maestro at all, only tilde .aimaestro and tilde agents stay at fixed home paths across any install method", keywords:"is_tilde_ai-maestro_the_install_tree no_tilde_ai-maestro_when_packaged fixed_home_paths_across_install_methods never_hardcode_tilde_ai-maestro_for_runtime_data resolve_app_paths_relative_to_install_dir getStateDir_tilde_dot_aimaestro tilde_agents_fixed_path host-level_tilde_dot_claude tilde_dot_agent-messaging tilde_dot_local_bin install-location_independence", ocd:2026-08-02, lmd:2026-09-13]
> **Install-location independence (CRITICAL):** the **dev repo** `~/ai-maestro/` (see
> [[repo-file-structure]]) is NOT the install tree. When AI Maestro ships as a package, there is
> **no `~/ai-maestro/`** — the app code (`server.mjs`, `app/`, `services/`, `lib/`,
> `public/avatars/`, …) lives at whatever path the package manager installs to. The ONLY paths
> that stay at fixed absolute home locations across any install method are the **runtime data
> trees `~/.aimaestro/` and `~/agents/`** (plus the host-level `~/.claude/`,
> `~/.agent-messaging/`, and installer-placed `~/.local/bin/` that AI Maestro writes into but
> does not own). Never hardcode `~/ai-maestro/...` for runtime data — resolve app paths relative
> to the install dir, and data paths via `getStateDir()` (`~/.aimaestro`) and `~/agents/`.

^C9HJYF57 [desc:"full layout of tilde .aimaestro/: registry.json, cemetery, sessions.json, governance.json, kanban-index, pillar-index, agent-shell-guard.sh, plus legacy/unverified paths", keywords:"what_is_in_tilde_dot_aimaestro where_is_registry_json_stored where_are_agent_sessions_stored where_is_governance_json_stored cemetery_soft-deleted_agent_archive kanban-index_derived_cache_safe_to_delete pillar-index_derived_cache_safe_to_delete agent-shell-guard_dot_sh_write_guard legacy_messages_dir_not_used_amp_lives_elsewhere where_are_amp_messages_stored_on_disk agents_never_hard-deleted_by_default", ocd:2026-08-02, lmd:2026-09-13]
## `~/.aimaestro/` — global per-host server state (`getStateDir()`)

```
~/.aimaestro/
├── agents/                       # per-host agent store                                   (verified)
│   ├── registry.json             #   SOURCE OF TRUTH: array of every Agent record (id, name, label,
│   │                             #   status, governanceTitle, sessions[], workingDirectory, hostId,
│   │                             #   ampIdentity, hooks map, deletedAt…). Soft-deleted agents STAY
│   │                             #   here with deletedAt set (tombstone) — they are never removed on soft-delete.
│   └── <agent-uuid>/             #   per-agent private state dir (one per agent, INCLUDING deleted ones)
│       ├── status.json           #     live status snapshot                              (config-service)
│       ├── agent.db              #     CozoDB database (subconscious / memory)
│       ├── keys/                 #     Ed25519 AMP identity: private.pem + public.pem
│       ├── registrations/        #     external AMP provider registrations (<provider>.json)
│       ├── skills/<name>/         #     custom (non-marketplace) skill content
│       ├── hooks/                #     per-agent hook scripts (paths referenced in registry hooks field)
│       └── skill-settings.json   #     per-agent skill enable/disable          (agents-skills-service)
├── cemetery/                     # THE GRAVEYARD: soft-deleted agents archived as <name>-export-<ts>.zip.
│                                 #   Written by DeleteAgent gate G03 BEFORE cleanup. Restorable via
│                                 #   /api/agents/cemetery. AGENTS ARE NEVER HARD-DELETED by default.   (verified)
├── chat-state/                   # <cwdHash>.json — per-workdir chat activity/notification state,
│                                 #   written by ai-maestro-hook.cjs + agents-chat-service             (verified)
├── sessions.json                 # PersistedSession[] {id,name,workingDirectory,createdAt,lastSavedAt,
│                                 #   agentId}. Sessions started via wake/createSession, removed on
│                                 #   hibernate. OVERCOMPLETE after an unclean shutdown.  (verified, lib/session-persistence.ts)
├── session-history.json          # append-only tmux-session→agent pairing log (workingDirectory, program,
│                                 #   programArgs, governanceTitle, rolePlugin…). The revivable-orphan dataset. (verified, lib/session-history.ts)
├── governance.json               # global governance config: owner title + hashed governance password    (verified)
├── governance-requests.json      # queued governance requests awaiting MANAGER approval                   (verified)
├── governance-tokens/            #   active-tokens.json — one-shot AID/sudo governance tokens   (verified, lib/aid-token.ts)
├── governance-peers/             # cross-host governance peer records       (verified lib/governance-peers.ts; created on demand)
├── hosts.json                    # self + remote host config (Tailscale URLs)               (verified, lib/hosts-config.ts)
├── host-keys/                    #   private.hex + public.hex — THIS host's Ed25519 identity   (verified, lib/host-keys.ts)
├── manager-trust.json            # cross-host trusted-MANAGER table                        (verified, lib/manager-trust.ts)
├── agent-directory.json          # cross-host directory of PEER agents (local agents live in agents/registry.json, NOT here) (verified, lib/agent-directory.ts)
├── amp-api-keys.json             # AMP provider API keys issued to registered agents         (verified, lib/amp-auth.ts)
├── teams/                        #   teams.json, groups.json, meetings.json, teams.ledger.json (append-only
│                                 #   team ledger), tasks-<teamId>.json, documents       (verified — task/group/document registries)
├── messages/                     #   LEGACY inbox/ sent/ archived/. The live store is ~/.agent-messaging/agents/<id>/messages/
│                                 #   (lib/messageQueue.ts). agent-registry.ts calls this dir "legacy" and only BACKS IT UP on
│                                 #   agent delete — nothing writes here. Corrected 2026-08-02: it was marked "(verified)", which
│                                 #   contradicted the AMP section two screens away saying it is no longer used.   (legacy)
├── backups/                      # registry.json backups taken before mutations          (verified, lib/agent-registry)
├── kanban-index/                 #   DERIVED CACHE — <hash>.json per design-dir board index. SAFE TO DELETE:
│                                 #   rebuilt from the TRDD markdown on next read   (verified, lib/kanban-index.ts)
├── pillar-index/                 #   DERIVED CACHE — <slug>-<hash>.sqlite (+ -wal/-shm + .heal.json) per corpus,
│                                 #   keyed by a realpath hash. SAFE TO DELETE, rebuilt from markdown. N agents on
│                                 #   one host share it, so a `busy` fault is CONTENTION, never damage — do not
│                                 #   delete one to "fix" it, that is the bug TRDD-YN8EQWYP closed
│                                 #                                              (verified, lib/pillar/index-db.ts)
├── agent-shell-guard.sh          # RUNTIME WRITE GUARD sourced into every agent tmux pane: overrides cd/pushd,
│                                 #   allowlist = $AGENT_WORK_DIR + /tmp + /private/tmp + /var/folders   (verified, lib/agent-shell-guard.ts)
├── bin/aimaestro-daemon.sh       # installer-placed background daemon                       (install-messaging.sh)
├── lib/                          # installer-placed shell helpers sourced by hooks/scripts: activity-tracker.sh,
│                                 #   pane-capture.sh, safe-inject.sh, logger.sh, message-logger.sh, detect-menu.sh
├── logs/                         # runtime logs
├── tmp/                          # scratch
├── user-presence.json            # AMAMA human-user presence timestamps     (verified lib/user-presence.ts; created on demand)
│   ───────────── present on disk but NOT referenced by current code (confirm before relying) ─────────────
├── system-settings.json          #                                                          (legacy/unverified)
├── config-undo.db (+-wal/-shm)   #   former config-undo SQLite                              (legacy/unverified)
├── captures/                     #   likely old pane captures                               (legacy/unverified)
├── inbox/                        #   predates messages/                                     (legacy/unverified)
├── state/last_seen/              #                                                          (legacy/unverified)
└── messages.backup.<date>/       #   one-time migration backup of messages/
```

^HBA7GFNG [desc:"layout of tilde agents/: per-agent working dirs plus role-plugins/custom-plugins/core-plugins SOURCE containers, distinct from the installed plugin cache", keywords:"what_is_inside_the_tilde_agents_folder agent_working_directory_location role-plugins_vs_custom-plugins_vs_core-plugins where_are_plugins_installed_vs_where_is_plugin_source R20.29_source_publishing_containers not_installed_plugins claude_local_scope_settings_local_json managed_gitignore_info_exclude reports_dev_docs_dev_scratch_folders is_tilde_agents_the_marketplace", ocd:2026-08-02, lmd:2026-09-13]
## `~/agents/` — agent working directories + LOCAL marketplace SOURCE

> **R20.29:** the three `*-plugins/` dirs are plugin **SOURCE / publishing**
> containers, NOT installed plugins. A plugin is **installed** in the client's
> own cache (`~/.claude/plugins/cache/…`), never here. AI Maestro only writes
> here when it AUTHORS/CONVERTS a plugin.

```
~/agents/
├── <agent-name>/                 # a persona's working directory — its ONLY writable home outside /tmp
│   ├── .claude/                  #   Claude Code local config for this agent
│   │   ├── settings.local.json   #     enabled plugins at LOCAL scope — written by InstallElement
│   │   ├── plugins/              #     locally-installed plugin cache (if any local-scope installs)
│   │   └── agents/ rules/ commands/ skills/   # local elements
│   ├── CLAUDE.md                 #   role/agent instructions (provided by the role-plugin)
│   ├── .git/                     #   most agent workdirs are git repos
│   │   └── info/exclude          #     managed ignore block (marker `ai-maestro:managed-gitignore`) —
│   │                             #     seeded at CreateAgent G05c + self-healed on wake; covers
│   │                             #     .claude/settings.local.json, .claude/rules/aimaestro-*.md,
│   │                             #     .mcp.json, runtime artifacts (.janitor/, reports*/, *_dev/, …).
│   │                             #     Lives in info/exclude (NOT .gitignore — repos TRACK .gitignore,
│   │                             #     writing there dirties the very tree the seeder protects).
│   ├── reports_dev/ docs_dev/    #   gitignored per-project dev scratch (_dev folders)
│   └── .aimaestro/               #   FUTURE — TRDD-1ee4a3c1 Phase 2 portable per-agent mirror. NOT present yet.
├── role-plugins/                 # ai-maestro-local-roles-marketplace SOURCE
│   ├── .claude-plugin/marketplace.json     #   Claude roles marketplace manifest
│   ├── roles-marketplace/        #   Claude role-plugin sources (<plugin>/…)
│   ├── codex-roles-marketplace/  gemini-roles-marketplace/  kiro-roles-marketplace/  opencode-roles-marketplace/   # per-client emitted variants
│   └── .abstract/<name>/plugin-universal-ir.yaml   #   Universal IR for cross-client conversion
├── custom-plugins/               # ai-maestro-local-custom-marketplace SOURCE (Haephestos customs + converted
│                                 #   ordinary plugins) — same per-client + .abstract/ + .claude-plugin/ layout
├── core-plugins/                 # core ai-maestro-plugin SOURCE emitted for non-Claude clients:
│                                 #   <client>-core-marketplace/ai-maestro-plugin-<client>/ + marketplace.json + .abstract/
└── _dev/                         # dev scratch (gitignored)
```

^71E2O25U [desc:"Claude Code's own store: chat transcripts under projects/<slug>, the plugin install target plugins/cache, and settings.json", keywords:"where_does_claude_code_store_chat_transcripts tilde_dot_claude_projects_slug_jsonl session-uuid_jsonl_transcript claude_resume_reads_the_transcript where_are_plugins_installed_for_claude plugins_cache_marketplace_plugin_path settings_json_user_scope_config chat_history_not_portable_today", ocd:2026-08-02, lmd:2026-09-13]
## `~/.claude/` — Claude Code's OWN store (NOT AI Maestro; AI Maestro reads/installs INTO it)

```
~/.claude/
├── projects/<slug>/              # Claude Code chat storage. <slug> = agent's absolute workdir with '/'→'-'
│   │                             #   (e.g. -Users-me-agents-alexandre). Path-bound → chat history is NOT
│   │                             #   portable today (TRDD-1ee4a3c1 Phase 4).
│   ├── <session-uuid>.jsonl      #     the transcript `claude --resume` reads
│   ├── <session-uuid>/subagents/*.jsonl   # subagent sidecar transcripts
│   └── memory/                   #     agent file-based memory (MEMORY.md + topic files)
├── plugins/cache/<marketplace>/<plugin>/  # WHERE PLUGINS ARE INSTALLED for Claude (the install TARGET, R20.29)
├── settings.json                 # user-scope (global) plugin enablement + config
└── settings.local.json           # (per-dir) — for an agent workdir this lives at <workdir>/.claude/settings.local.json
```

^QXT7HB1H [desc:"AMP client storage: host-level identity/config plus per-agent inbox/sent/archived mailboxes under tilde .agent-messaging/agents/<id>/messages/", keywords:"where_are_amp_messages_stored_on_disk tilde_dot_agent-messaging_layout host-level_amp_identity per-agent_amp_mailbox inbox_sent_archived_folders amp_config_json_identity_md_keys agent-messaging_registrations", ocd:2026-08-02, lmd:2026-09-13]
## `~/.agent-messaging/` — AMP client storage (host-level + per-agent)

```
~/.agent-messaging/
├── config.json  IDENTITY.md  keys/  registrations/      # host-level AMP identity
├── messages/{inbox,sent}/                               # host-level mailbox
└── agents/<id-or-name>/messages/{inbox,sent,archived}/  # per-agent AMP mailboxes
```

^PD81BUST [desc:"installed CLI wrappers on PATH: aimaestro-agent.sh, ~28 amp-*.sh scripts, 5 aid-*.sh scripts, plus docs/graph/memory tools", keywords:"installed_cli_wrappers_location tilde_dot_local_bin aimaestro-agent_dot_sh_lifecycle_cli amp_star_dot_sh_messaging_cli aid_star_dot_sh_identity_cli docs_graph_memory_tools_cli install-messaging_dot_sh_places_these_scripts", ocd:2026-08-02, lmd:2026-09-13]
## `~/.local/bin/` — installed CLI wrappers (on PATH; placed by install-messaging.sh)

- `aimaestro-agent.sh` (+ `agent-core/helper/session/plugin/skill/commands.sh` modules) — agent lifecycle CLI
- `amp-*.sh` (~28) — Agent Messaging Protocol CLI (send / inbox / read / reply / fetch / register / kanban / clone-repo …)
- `aid-*.sh` (5) — Agent Identity CLI (init / register / token / status / auth)
- `docs-*.sh`, `graph-*.sh`, `memory-*.sh` — docs search, graph query, memory tools

## See also

- [[repo-file-structure]] — the source repo layout, distinct from this install tree
- [[amp-messaging]] — the AMP protocol whose client storage lives at `~/.agent-messaging/` above

## Notes and lessons learned
