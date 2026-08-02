---
name: amp-messaging
description: "how do agents send messages to each other / what is AMP / how to install AMP scripts / amp-send amp-inbox amp-read commands / agent messaging protocol architecture / local vs external provider / agent address format alice@default.local / push notification when a message arrives"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: hub
  globs: [scripts/amp-*.sh, app/api/v1/**]
---

# amp-messaging

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

## Notes and lessons learned
