---
name: runtime-install-tree
description: "where does ai-maestro store data on a host / what is in ~/.aimaestro / what is in ~/agents / where are plugins installed vs where is plugin source / is ~/ai-maestro the install tree / where does claude code store chat transcripts / where are AMP messages stored on disk / where are role-plugins vs custom-plugins vs core-plugins / what is verified vs legacy in the state dir"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: architecture-and-runtime
---

# runtime-install-tree

This is the **runtime install tree**: where AI Maestro actually stores data on each host,
distinct from the source repo layout (see [[repo-file-structure]]). **Do not guess paths — look
them up here.** Paths tagged `(verified)` are created/used by current code (`statePath()` /
`getStateDir()` resolve to `~/.aimaestro`, `STATE_DIR_NAME='.aimaestro'`,
`lib/ecosystem-constants.ts`); `(legacy/unverified)` = present on disk but not referenced by
current code — confirm before relying on them.

> **Install-location independence (CRITICAL):** the **dev repo** `~/ai-maestro/` (see
> [[repo-file-structure]]) is NOT the install tree. When AI Maestro ships as a package, there is
> **no `~/ai-maestro/`** — the app code (`server.mjs`, `app/`, `services/`, `lib/`,
> `public/avatars/`, …) lives at whatever path the package manager installs to. The ONLY paths
> that stay at fixed absolute home locations across any install method are the **runtime data
> trees `~/.aimaestro/` and `~/agents/`** (plus the host-level `~/.claude/`,
> `~/.agent-messaging/`, and installer-placed `~/.local/bin/` that AI Maestro writes into but
> does not own). Never hardcode `~/ai-maestro/...` for runtime data — resolve app paths relative
> to the install dir, and data paths via `getStateDir()` (`~/.aimaestro`) and `~/agents/`.

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

## `~/.agent-messaging/` — AMP client storage (host-level + per-agent)

```
~/.agent-messaging/
├── config.json  IDENTITY.md  keys/  registrations/      # host-level AMP identity
├── messages/{inbox,sent}/                               # host-level mailbox
└── agents/<id-or-name>/messages/{inbox,sent,archived}/  # per-agent AMP mailboxes
```

## `~/.local/bin/` — installed CLI wrappers (on PATH; placed by install-messaging.sh)

- `aimaestro-agent.sh` (+ `agent-core/helper/session/plugin/skill/commands.sh` modules) — agent lifecycle CLI
- `amp-*.sh` (~28) — Agent Messaging Protocol CLI (send / inbox / read / reply / fetch / register / kanban / clone-repo …)
- `aid-*.sh` (5) — Agent Identity CLI (init / register / token / status / auth)
- `docs-*.sh`, `graph-*.sh`, `memory-*.sh` — docs search, graph query, memory tools

## See also

- [[repo-file-structure]] — the source repo layout, distinct from this install tree
- [[amp-messaging]] — the AMP protocol whose client storage lives at `~/.agent-messaging/` above

## Notes and lessons learned
