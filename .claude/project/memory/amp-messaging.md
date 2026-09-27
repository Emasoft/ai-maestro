---
name: amp-messaging
description: "how do agents send messages to each other / what is AMP / how to install AMP scripts / amp-send amp-inbox amp-read commands / agent messaging protocol architecture / local vs external provider / agent address format alice@default.local / push notification when a message arrives"
ocd: 2026-08-02
lmd: 2026-09-27
metadata:
  node_type: memory
  type: reference
  tier: hub
  topic: messaging
  globs: [scripts/amp-*.sh, app/api/v1/**]
publish-globally: false
---

# amp-messaging

^ZDMK4Y8X [desc: "AMP is like email for AI agents: local-first, Ed25519 signing, optional federation (CrabMail), provider-agnostic CLI, title-based directed communication graph (who can message whom).", keywords: what_is_AMP_agent_messaging_protocol how_do_agents_message_each_other amp_local_first_email_for_agents amp_ed25519_signing amp_federation_crabmail can_agents_talk_across_providers amp_title_based_communication_graph agent_to_agent_messaging_overview, ocd: 2026-08-02, lmd: 2026-09-27]
AI Maestro uses the Agent Messaging Protocol (AMP) for inter-agent communication. AMP is like
email for AI agents — it works locally by default and can optionally federate with external
providers.

**Key Features:**
- **Local-first**: Works immediately without external dependencies
- **Cryptographic signing**: Ed25519 signatures for message authenticity
- **Federation**: Connect to external providers (CrabMail, etc.) for global messaging
- **Provider-agnostic**: Same CLI works with any AMP provider
- **Title-based communication graph**: Directed graph enforcing which governance titles can
  message which — see [[amp-communication-graph]] for the full adjacency matrix and enforcement
  layers.

^6LSB1QBN [desc: "AMP install: ./install-messaging.sh puts amp-*.sh in ~/.local/bin + plugin (26 skills, 12 commands) from Emasoft/ai-maestro-plugins; roles at ~/agents/role-plugins/; storage ~/.agent-messaging/.", keywords: how_do_I_install_AMP install_messaging_sh_script amp_scripts_to_local_bin where_do_amp_scripts_get_installed what_does_amp_install_include ai_maestro_plugin_skill_count_26 amp_local_roles_marketplace_path message_storage_agent_messaging_dir which_marketplace_installs_amp, ocd: 2026-08-02, lmd: 2026-09-27]
## Installation

The AI Maestro plugins are installed from the marketplace `Emasoft/ai-maestro-plugins`.

```bash
# Install AMP scripts and skills
./install-messaging.sh

# Non-interactive installation
./install-messaging.sh -y

# Migrate existing messages only
./install-messaging.sh --migrate
```

**What gets installed:**
- AMP scripts (`amp-*.sh`) → `~/.local/bin/` (CLI tools on PATH)
- Deprecated `23blocks-OS/ai-maestro-plugins` marketplace removed (if present)
- `ai-maestro-plugin` → from marketplace `Emasoft/ai-maestro-plugins` (`--scope user`)
  - **Skills are auto-discovered from `skills/*/SKILL.md` — do not hand-maintain the list here.**
    Read the installed set with
    `find ~/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-plugin/*/skills -maxdepth 1 -mindepth 1 -type d -exec basename {} \;`.
    As of 2026-08-02 that is **26**, in four families: messaging/identity (`agent-messaging`,
    `agent-identity`), agent + repo ops (`ai-maestro-agents-management`, `agent-repo-workflow`,
    `ama-session`, `ama-panel`), the 3-pillars surface (`ama-trdd-*` ×5, `ama-prrd-*` ×4,
    `ama-proposal-approvals`, `ama-kanban-render`, `team-kanban`, `team-governance`), and
    search/diagnostics (`docs-search`, `graph-query`, `memory-search`, `mcp-discovery`,
    `debug-hooks`, `network-security`, `planning`)
  - 12 AMP slash commands: `/amp-send`, `/amp-inbox`, `/amp-read`, etc.
  - Hooks: session tracking + message notifications
- Local role-plugins marketplace → `~/agents/role-plugins/`
  - Creates `.claude-plugin/marketplace.json` (preserves existing plugins on reinstall)
  - Registers with Claude CLI: `claude plugin marketplace add ~/agents/role-plugins/`
  - Updates: `claude plugin marketplace update ai-maestro-local-roles-marketplace`
  - Marketplace name: `ai-maestro-local-roles-marketplace` (from `scripts/ecosystem-config.sh`)
- Message storage → `~/.agent-messaging/`

**Note:** All skills are bundled in the `ai-maestro-plugin` plugin. There are NO standalone
skills in `~/.claude/skills/` — everything is managed via the plugin system.

## Quick Start

```bash
# 1. Initialize your agent identity (first time only)
amp-init.sh --auto

# 2. Send a message
amp-send.sh alice "Hello" "How are you?"

# 3. Check your inbox
amp-inbox.sh

# 4. Read a message
amp-read.sh <message-id>
```

^PWAG3G2V [desc: "AMP has two components: plugin (client — keys, signing, storage ~/.agent-messaging/) and AI Maestro server (provider — /api/v1/register, /route, /messages/pending; relay queue, push).", keywords: amp_architecture_two_components what_is_the_amp_client_vs_provider amp_provider_endpoints_register_route_pending which_server_routes_amp_messages where_are_amp_keys_stored amp_relay_queue_offline_agents amp_key_generation_signing_location, ocd: 2026-08-02, lmd: 2026-09-27]
## Architecture

**Two Components:**

1. **AMP Plugin (Client)** - Installed on each agent machine
   - Location: marketplace `Emasoft/ai-maestro-plugins` → installed to `~/.claude/plugins/cache/`
   - Storage: `~/.agent-messaging/`
   - Commands: `amp-init`, `amp-send`, `amp-inbox`, `amp-read`, etc.
   - Handles: Key generation, message signing, local storage

2. **AI Maestro (Provider)** - Server that routes messages
   - Endpoints: `/api/v1/register`, `/api/v1/route`, `/api/v1/messages/pending`
   - Handles: Message routing, relay queue, push notifications
   - Optional: Agents can use external providers (CrabMail) instead

**Message Storage (Client-side):**
```
~/.agent-messaging/
├── config.json           # Agent configuration
├── keys/
│   ├── private.pem       # Ed25519 private key (never shared)
│   └── public.pem        # Ed25519 public key
├── messages/
│   ├── inbox/            # Received messages
│   └── sent/             # Sent messages
└── registrations/        # External provider registrations
```

^N21RX3Y7 [desc: "AMP CLI commands: amp-init.sh --auto, amp-send.sh <to> <subject> <msg>, amp-inbox.sh, amp-read.sh <id>, amp-reply.sh, amp-delete.sh, amp-status.sh, amp-register.sh --provider <url>, amp-fetch.sh.", keywords: amp_cli_command_list how_to_send_amp_message amp_init_send_inbox_read_reply commands amp_address_format_alice_default_local how_do_I_initialize_amp_identity amp_local_vs_external_address register_external_provider_amp amp_send_command_syntax, ocd: 2026-08-02, lmd: 2026-09-27]
## AMP CLI Commands

| Command | Description |
|---------|-------------|
| `amp-init.sh --auto` | Initialize agent identity |
| `amp-status.sh` | Show agent status and registrations |
| `amp-inbox.sh` | Check inbox for messages |
| `amp-read.sh <id>` | Read a specific message |
| `amp-send.sh <to> <subject> <message>` | Send a message |
| `amp-reply.sh <id> <message>` | Reply to a message |
| `amp-delete.sh <id>` | Delete a message |
| `amp-register.sh --provider <url>` | Register with external provider |
| `amp-fetch.sh` | Fetch messages from external providers |

## Address Formats

**Local addresses** (work immediately):
- `alice` → `alice@default.local`
- `bob@myteam.local` → Local delivery

**External addresses** (require registration):
- `alice@acme.crabmail.ai` → Via CrabMail provider
- `backend@company.otherprovider.com` → Via other provider

^D0858DJ1 [desc: "AI Maestro is an AMP provider (v0.20.0+): amp-register.sh --provider localhost:23000; /api/v1 health, info, register, route, pending. Push via tmux; NOTIFICATIONS_ENABLED + NOTIFICATION_FORMAT.", keywords: ai_maestro_as_amp_provider amp_provider_api_endpoints how_to_register_agent_with_provider amp_push_notification_tmux how_do_offline_agents_get_messages amp_register_provider_localhost_23000 notifications_enabled_env_var provider_api_v0_20_0, ocd: 2026-08-02, lmd: 2026-09-27]
## Provider API (v0.20.0+)

AI Maestro can act as an AMP provider. Agents register with AI Maestro and it handles routing.

**Endpoints:**
- `GET /api/v1/health` - Provider health status (no auth)
- `GET /api/v1/info` - Provider capabilities (no auth)
- `POST /api/v1/register` - Register agent, get API key
- `POST /api/v1/route` - Route a signed message
- `GET /api/v1/messages/pending` - Poll for offline messages
- `DELETE /api/v1/messages/pending?id=X` - Acknowledge message

**Registration flow:**
```bash
# Agent registers with local AI Maestro
amp-register.sh --provider localhost:23000 --tenant myorg
# Returns API key, stores in ~/.agent-messaging/registrations/
```

## Push Notifications

When a message is routed to a local agent, AI Maestro sends a push notification via tmux:

```
[MESSAGE] From: alice - Subject line - check your inbox
```

**Configuration (environment variables):**
- `NOTIFICATIONS_ENABLED=false` - Disable push notifications
- `NOTIFICATION_FORMAT` - Customize notification format

^P9XCA7UE [desc: "AMP messages live in ~/.agent-messaging/agents/<name>/messages/{inbox,sent}/, auto-created. Old ~/.aimaestro/messages/ retired. Check-my-messages → amp-inbox.sh; skills ship in ai-maestro-plugin.", keywords: where_are_amp_messages_stored amp_message_storage_per_agent_dirs is_aimaestro_messages_still_used amp_natural_language_skill check_my_messages_command are_there_standalone_amp_skills amp_inbox_directory_layout auto_created_agent_dirs, ocd: 2026-08-02, lmd: 2026-09-27]
## Message Storage
All messages are stored in AMP per-agent directories:
```
~/.agent-messaging/agents/<agentName>/messages/inbox/
~/.agent-messaging/agents/<agentName>/messages/sent/
```

Per-agent directories are auto-created when agents first use AMP commands.
The old `~/.aimaestro/messages/` system is no longer used.

## Claude Code Skill

The AMP skill (from `agent-messaging` plugin in the marketplace) provides natural language:

```
"Check my messages" → amp-inbox.sh
"Send a message to backend-api about deployment" → amp-send.sh backend-api "Deployment" "..."
"Reply to the last message" → amp-reply.sh <id> "..."
```

## Development Notes

- **Marketplace**: `Emasoft/ai-maestro-plugins` — update with `claude plugin marketplace update ai-maestro-plugins`
- **Protocol spec**: https://agentmessaging.org
- **Security**: Messages are signed with Ed25519; AI Maestro verifies signatures
- **Relay queue**: Offline agents get messages via polling (`/api/v1/messages/pending`)

## See also

- [[amp-communication-graph]] — the title-based directed communication graph, enforcement layers, and its v2/v3 update history
- [[runtime-install-tree]] — where AMP's client storage (`~/.agent-messaging/`) sits among every
  other on-disk store AI Maestro maintains.

## Notes and lessons learned
