<div align="center">

<img src="./docs/logo-constellation.svg" alt="AI Maestro Logo" width="120"/>

# AI Maestro

*I was running 35 AI agents across multiple terminals and became the human mailman between them. So I built AI Maestro.*

**Orchestrate your AI coding agents from one dashboard — with persistent memory, agent-to-agent messaging, and multi-machine support.**

[![Version](https://img.shields.io/badge/version-0.27.3-blue)](https://github.com/Emasoft/ai-maestro/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows%20(WSL2)-lightgrey)](https://github.com/Emasoft/ai-maestro)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Emasoft/ai-maestro?style=social)](https://github.com/Emasoft/ai-maestro)

![AI Maestro Dashboard](./docs/images/aiteam-web.png)

### Governance & Communication Rules

<img src="./docs/images/ai-maestro-governance-infographic.jpg" alt="AI Maestro Governance — Communication Hierarchy & Rules" width="100%"/>

[Quick Start](#-quick-start) · [Features](#-features) · [Documentation](#-documentation) · [Contributing](./CONTRIBUTING.md)

</div>

---

## The Story

I gave an AI agent a real task — not autocomplete, a real engineering problem. It checked the code, read the logs, queried the database, and came back with the answer. That was the moment. *This thing can actually work.*

Within a week I was running 35 agents across terminals. They were productive, but they couldn't talk to each other. I became the human message bus — copying context from one terminal, pasting into another. I was the bottleneck in my own AI team.

**So I built AI Maestro** — one dashboard to see every agent, on every machine, with persistent memory and direct agent-to-agent communication. Today I run 80+ agents across multiple computers, building real companies with them every day.

**What makes this different:**
- **Works with any AI agent** — Claude Code, Aider, Cursor, Copilot, your own scripts. We don't lock you in.
- **Multi-machine from day one** — Peer mesh network with no central server. Nobody else does this.
- **Agents that communicate** — The Agent Messaging Protocol (AMP) lets agents coordinate directly. You orchestrate, they collaborate.

---

## Understanding AI Maestro Terms

Every AI Maestro **agent** has exactly three orthogonal layers. Keeping them distinct is essential — they answer different questions and are managed by different pipelines.

| Layer | Answers | Format | Example |
|---|---|---|---|
| **TITLE** | *What is it allowed to do?* (permissions / governance class) | ALL-CAPS kebab | `MEMBER` |
| **ROLE** | *What does it know how to do?* (behaviour — the role-plugin main agent loaded from a marketplace) | `<plugin>:<main-agent>@<marketplace>` | `ai-maestro-programmer-agent:programmer-main-agent@Emasoft/ai-maestro-plugins` |
| **PERSONA** | *Which specific running instance is this?* (identity — name, AID, avatar, workdir) | `<name>, <aid>, <avatar>, <workdir>` | `peter-bot, <aid>, ~/avatars/peter.jpg, ~/agents/peter-bot/` |

**TITLE** and **ROLE** are independent but constrained: a ROLE declares which TITLEs it is designed to serve via `compatible-titles` in its `.agent.toml`. Multiple ROLEs can satisfy the same TITLE (N:1 model), and one ROLE can be compatible with several TITLEs. **PERSONA** is the only layer with 1:1 cardinality to a running tmux session — TITLE and ROLE are swappable on a live PERSONA.

An OOP analogy: **TITLE = access-control role**, **ROLE = class definition** (behaviour + skills + instructions), **PERSONA = instance** (state + identity).

### TITLE — the governance class

The title determines what an agent is authorized to do within the AI Maestro governance system. There are exactly eight titles:

- **AUTONOMOUS** — Not assigned to any team. Operates independently under a mandatory `ai-maestro-autonomous-agent` role-plugin whose persona enforces workspace isolation and forbids cross-agent mutation. Can freely message MANAGER, MAINTAINERs, and other AUTONOMOUS agents.
- **MANAGER** — Global singleton (at most one per host). Manages agents and approves GovernanceRequests. Cannot create/delete teams or assign COS (those are USER-only operations requiring governance password).
- **CHIEF-OF-STAFF** — Leads exactly one closed team. Scoped to own team only. Destructive operations require a GovernanceRequest approved by the MANAGER.
- **ARCHITECT** — Senior technical authority within a team. Proposes and approves architecture decisions.
- **ORCHESTRATOR** — Primary kanban manager for a team. Coordinates task assignment and pipeline flow.
- **INTEGRATOR** — System integrator. Responsible for cross-service wiring and deployment coordination.
- **MEMBER** — Standard team member with no special governance privileges.
- **MAINTAINER** — Host-level repo maintainer (not in any team). Bound to a single `owner/repo` GitHub repository. Polls issues every 5 minutes via `gh issue list`, auto-triages bugs, and only accepts feature requests from the locally-authenticated `gh` user. See R19 in [GOVERNANCE-RULES.md](./docs/GOVERNANCE-RULES.md).

Changing a TITLE requires the governance password. The **USER** (human operator) is the only one who can: create/delete teams, assign/remove COS, assign/remove MANAGER, switch team type open/closed.

### ROLE — the role-plugin main agent

The ROLE is the **role-plugin main agent** the PERSONA is currently running. It is referenced in fully-qualified form: `<plugin-name>:<main-agent-name>@<marketplace>`. The `@<marketplace>` suffix mirrors Claude Code's standard plugin syntax; the `:<main-agent>` segment selects which main-agent file inside the plugin to launch via `claude --agent <main-agent>`.

A **role-plugin** is a Claude Code plugin that additionally contains:
1. A `<name>.agent.toml` at the plugin root with two mandatory extra fields: `compatible-titles` and `compatible-clients`.
2. A main-agent `.md` file whose persona carries the governance rules (inline, via `skills:` references, or via rule-file links).

Role-plugins are installed exactly like normal plugins — `claude plugin install <name> <marketplace> --scope local` after registering the marketplace via `claude plugin marketplace add <path-or-owner/repo>`. AI Maestro ships two default role-plugin marketplaces: the remote `Emasoft/ai-maestro-plugins` (GitHub) and the local `ai-maestro-local-roles-marketplace` (at `~/agents/role-plugins/marketplace/`). A role-plugin folder may live anywhere as long as it is listed in a marketplace manifest's `source` field.

An agent can change its ROLE at any time through the Profile panel → Role tab — the old plugin is uninstalled, the new one is installed, and Claude Code is gracefully restarted in the same tmux session (preserving chat history). The Role tab shows a locked label when exactly one role-plugin is compatible with the current TITLE, and a dropdown when two or more are.

### PERSONA — the running instance

The PERSONA is the concrete agent: four attributes that together identify a specific running Claude Code tmux session.

- **Name** — a unique kebab identifier (e.g. `peter-bot`, `sammy`, `frank-potter`). Input is case-insensitive; internally normalized to lowercase. The UI displays it capitalized for readability.
- **AID** — the Agent Identity: an Ed25519 key pair used for AMP message signing and cross-host authentication. Provisioned once per PERSONA and stored in `~/.agent-messaging/agents/<name>/keys/`.
- **Avatar** — image file displayed on the sidebar card.
- **Workdir** — a project folder at `~/agents/<name>/` where Claude Code runs. All `--scope local` plugins live here, and this is the only location outside `/tmp` that the PERSONA may write to.

PERSONA is the only layer with cardinality 1:1 to a tmux session. TITLE and ROLE can be swapped on a live PERSONA without losing identity, AID, avatar, or workdir.

### Full agent example

| Layer | Value |
|---|---|
| TITLE | `MEMBER` |
| ROLE | `ai-maestro-programmer-agent:programmer-main-agent@Emasoft/ai-maestro-plugins` |
| PERSONA | `peter-bot, <aid>, ~/avatars/peter.jpg, ~/agents/peter-bot/` |

---

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/Emasoft/ai-maestro/main/scripts/remote-install.sh | sh
```

This installs everything you need:
- AI Maestro dashboard and service
- Agent messaging system (AMP)
- Claude Code plugin with 9 skills and 32 CLI scripts

**Time:** 5-10 minutes · **Requires:** Node.js 20+, tmux

<details>
<summary>Windows (WSL2) / Linux notes</summary>

**Windows:** Install WSL2 first, then run the curl command inside Ubuntu:

```powershell
wsl --install
```

[Full Windows guide](./docs/WINDOWS-INSTALLATION.md)

**Linux:** Ensure build tools are installed: `sudo apt install tmux build-essential`
</details>

<details>
<summary>Manual install</summary>

```bash
git clone https://github.com/Emasoft/ai-maestro.git
cd ai-maestro
yarn install
yarn dev
```

See [QUICKSTART.md](./docs/QUICKSTART.md) for detailed setup options.
</details>

Dashboard opens at `http://localhost:23000`

Then initialize your agent messaging identity (first time only):
```bash
amp-init.sh --auto
```

### Remote Access (iPad, Phone, Laptop)

AI Maestro is accessible from any device on your [Tailscale](https://tailscale.com/) VPN. Tailscale is free for personal use and takes 2 minutes to set up.

**1. Install [Tailscale](https://tailscale.com/) on the machine running AI Maestro:**

| Platform | Install |
|----------|---------|
| macOS | [Download](https://tailscale.com/download/mac) or `brew install --cask tailscale` |
| Linux | `curl -fsSL https://tailscale.com/install.sh \| sh && sudo tailscale up` |
| Windows | [Download](https://tailscale.com/download/windows) |

**2. Install Tailscale on your mobile device and activate the VPN:**

Mobile devices access AI Maestro via the browser (Safari, Chrome) — there is no native app. But the Tailscale VPN app **must** be installed and connected on the device for the browser to reach the AI Maestro host.

[<img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="App Store" height="40">](https://apps.apple.com/app/tailscale/id1470499037)&nbsp;&nbsp;[<img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" alt="Google Play" height="40">](https://play.google.com/store/apps/details?id=com.tailscale.ipn)

**3. Sign in with the same account** on all devices. Then open a browser on your mobile device:

```
http://<your-tailscale-ip>:23000
```

Find your host's Tailscale IP: run `tailscale ip -4` on the host machine (e.g., `100.x.x.x`).

**4. Verify the setup:**

```bash
./scripts/test-tailscale-access.sh
```

> AI Maestro auto-detects Tailscale at startup and only accepts connections from localhost and Tailscale VPN IPs. LAN and internet connections are blocked at the TCP level. See the [network-security](https://github.com/Emasoft/ai-maestro-plugin) skill for details.

---

## Features

Every feature was born from a real problem. We built them in the order we needed them.

### One Dashboard

*I had 35 terminals and couldn't tell which was which.*

See and manage all your AI agents in one place. Create agents from the UI, organize them with smart naming (`project-backend-api` becomes a 3-level tree with auto-coloring), and switch between any agent with a click. Auto-discovers your existing tmux sessions.

### Any Machine

*My Mac Mini was sitting there idle. What if I ran agents on that too?*

A peer mesh network where every machine is equal. Add a computer, it joins the mesh. Every agent on every machine, visible from one dashboard. Use each machine for what it's best at — Mac for iOS builds, Linux for Docker, cloud for heavy compute. **No central server required.**

### Agent Messaging

*I was the mailman — copying messages between agents because they couldn't talk to each other.*

The [Agent Messaging Protocol (AMP)](https://agentmessaging.org) gives your agents email-like communication. Priority levels, message types, cryptographic signatures, and push notifications. Tell your agent *"send a message to backend about the deployment"* — it just works. Agents coordinate directly while you manage the big picture.

**Before AMP:** You copy research from one terminal, paste into another, repeat 50 times a day.
**With AMP:** *"Research agent, send your findings to the writing agent."* Done.

### Gateways

*A friend in Singapore wanted his agents to talk to mine. But I didn't want to give him access to my network.*

Connect your AI agents to [Slack](https://github.com/Emasoft/aimaestro-gateways), Discord, Email, and WhatsApp through organizational gateways. Smart routing (`@AIM:agent-name`), thread-aware responses, and content security with 34 prompt injection patterns detected at the gateway — before any agent sees the message.

### Persistent Memory

*Every morning, my agents woke up with amnesia.*

Three layers of intelligence that grow over time: **Memory** (agents remember past conversations and decisions), **Code Graph** (interactive visualization of your entire codebase with delta indexing), and **Documentation** (auto-generated, searchable docs from your code). Agents get smarter the longer they work with you.

### Work Coordination

*Talking isn't working. I needed agents to coordinate on actual deliverables.*

Assemble agents into teams, run meetings in split-pane war rooms, and track tasks on a full Kanban board with drag-and-drop, dependencies, and 5 status columns. Cross-machine teams work seamlessly. This is project management for your AI workforce.

### Agent Identity

*At 80 agents, they all looked the same.*

Custom avatars, personality profiles, and visual presence for every agent. When an agent has a face and a role, you instinctively assign it the right work — just like a real team.

### Plugin Builder

*Every agent needs a different skill set. Installing the right skills by hand was tedious.*

A visual, browser-based tool for composing custom Claude Code plugins without touching any config files. Pick skills from core AI Maestro skills, your local marketplace, or any public GitHub repository. Combine them, set a name and version, and build — the plugin is assembled and ready to install in seconds. Available at `http://localhost:23000/plugin-builder`.

### Plugin Ecosystem

AI Maestro uses three categories of plugins:

- **3 user-scope plugins** (installed globally per user): `ai-maestro`, `agent-messaging`, `agent-identity` — from the `Emasoft/ai-maestro-plugins` marketplace
- **7 local-scope role-plugins** (installed on-demand per agent): `architect-agent`, `orchestrator-agent`, `integrator-agent`, `programmer-agent`, `chief-of-staff`, `assistant-manager-agent`, `maintainer-agent` — from the local roles marketplace
- **External dependencies** from the `Emasoft/emasoft-plugins` marketplace: `claude-plugins-validation`, `perfect-skill-suggester`, `code-auditor-agent`, `llm-externalizer-plugin`

---

## Who Is This For

**Developers running multiple AI agents.** If you have 3+ agents and you're switching between terminals, losing context, and playing messenger — this is for you. Works with Claude Code, Aider, Cursor, GitHub Copilot, or any terminal-based AI.

**Teams coordinating AI-assisted work.** Multiple developers, multiple agents, multiple machines. One dashboard. Agent-to-agent messaging replaces you as the bottleneck.

**Creators and operators** who want to connect AI agents to the outside world through Slack, Discord, or Email — without exposing their infrastructure.

---

<details>
<summary><b>Screenshots</b></summary>

<div align="center">
<img src="./docs/images/aimaestro-mobile.png" alt="Mobile View" width="280"/>
<img src="./docs/images/aimaestro-sidebar.png" alt="Sidebar" width="280"/>
</div>

**Code Graph** — Interactive codebase visualization

![Code Graph](./docs/images/code_graph01.png)

**Agent Inbox** — Direct agent-to-agent messaging

![Agent Messaging](./docs/images/agent-inbox.png)

</details>

---

## Documentation

**New here?**
- [Quick Start Guide](./docs/QUICKSTART.md) — Get up and running
- [Core Concepts](./docs/CONCEPTS.md) — Understand how it works
- [Use Cases](./docs/USE-CASES.md) — Real examples of what people build

**Going deeper:**
- [Multi-Machine Setup](./docs/SETUP-TUTORIAL.md) · [Network Access](./docs/NETWORK-ACCESS.md)
- [Agent Messaging Guide](./docs/AGENT-MESSAGING-GUIDE.md) · [Architecture](./docs/AGENT-COMMUNICATION-ARCHITECTURE.md)
- [Intelligence Guide](./docs/AGENT-INTELLIGENCE.md) · [Code Graph Visualization](./docs/images/code_graph01.png)
- [Operations Guide](./docs/OPERATIONS-GUIDE.md)
- [Team Governance Rules](./docs/GOVERNANCE-RULES.md) — R1-R15: titles, teams, messaging, composition, role boundaries, resilience

**Troubleshooting:**
- [Common Issues](./docs/TROUBLESHOOTING.md) · [Security](./SECURITY.md) · [Windows Installation](./docs/WINDOWS-INSTALLATION.md)

**Extending:**
- [Plugin Development](./plugin/README.md)

---

## Agent Skills

AI Maestro installs 9 skills that teach agents how to use the platform. Each skill is use-case oriented — it lists what you want to do and shows the command to do it.

| Skill | What It Teaches | Trigger Phrases |
|-------|----------------|-----------------|
| **agent-messaging** | Send/receive messages between agents via AMP | "send a message", "check inbox", "reply to" |
| **ai-maestro-agents-management** | Create, manage, hibernate, export agents | "create agent", "list agents", "hibernate", "wake" |
| **team-governance** | Create teams, assign agents, manage roles | "create team", "assign agent", "chief of staff" |
| **team-kanban** | Manage kanban boards, tasks, GitHub sync | "create task", "move task", "show kanban", "sync GitHub" |
| **docs-search** | Search auto-generated code documentation | "search docs", "find function", "check API" |
| **graph-query** | Query code structure (callers, callees, paths) | "who calls X", "what does X call", "find path" |
| **memory-search** | Search past conversations and decisions | "search memory", "what did we discuss", "recall" |
| **planning** | Create persistent task plans in markdown | "create a plan", "track progress" |
| **debug-hooks** | Debug Claude Code hooks that aren't working | "hook not firing", "debug hook", "hook broken" |

Skills are installed automatically with the AI Maestro plugin. Agents discover them via Claude Code's `/skills` command.

---

## CLI Reference

The `aimaestro-agent.sh` CLI manages agents from the terminal. All commands support `--help`.

### Agent Lifecycle

```bash
# Create an agent with a working directory
aimaestro-agent.sh create my-agent -d ~/Code/my-project

# List all agents (filter by status)
aimaestro-agent.sh list --status online

# Show agent details
aimaestro-agent.sh show my-agent

# Hibernate and wake
aimaestro-agent.sh hibernate my-agent
aimaestro-agent.sh wake my-agent --attach

# Export/import for backup or migration
aimaestro-agent.sh export my-agent
aimaestro-agent.sh import agent-backup.zip
```

### Agent Messaging (AMP)

```bash
# Initialize identity (first time)
amp-init.sh --auto

# Send a message
amp-send.sh backend-api "Deploy ready" "Frontend build passed all tests"

# Check inbox and read
amp-inbox.sh
amp-read.sh <message-id>

# Reply and manage
amp-reply.sh <message-id> "Acknowledged, deploying now"
amp-delete.sh <message-id>
```

### Plugin Management

```bash
# List installed plugins
aimaestro-agent.sh plugin list

# Install/uninstall a plugin
aimaestro-agent.sh plugin install my-plugin --scope local
aimaestro-agent.sh plugin uninstall my-plugin --scope local
```

Run `aimaestro-agent.sh help` for the full command list.

---

## What's Next

- Agent search and filtering across the entire mesh
- Agent playback — time-travel through agent sessions
- Performance analytics dashboard

See the full [roadmap](https://github.com/Emasoft/ai-maestro/issues) and [join the discussion](https://github.com/Emasoft/ai-maestro/discussions).

---

## Contributing

We love contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

- [Report a bug](https://github.com/Emasoft/ai-maestro/issues)
- [Request a feature](https://github.com/Emasoft/ai-maestro/issues/new?labels=enhancement)

<details>
<summary><b>Acknowledgments</b></summary>

Built with [Next.js](https://nextjs.org/), [xterm.js](https://xtermjs.org/), [CozoDB](https://www.cozodb.org/), [ts-morph](https://ts-morph.com/), [tmux](https://github.com/tmux/tmux), and [Claude Code](https://claude.ai).

</details>

---

## License

MIT — see [LICENSE](./LICENSE). Free for any purpose, including commercial.

---

<div align="center">

**Made with love in Boulder (USA), Roma (Italy), and many other cool places**

[Juan Pelaez](https://x.com/jkpelaez) · [23blocks](https://23blocks.com)

*Built by AI Agents with Humans in the driver seat — for AI-first organizations, AI-enabled humans, and autonomous agents*

[Star us on GitHub](https://github.com/Emasoft/ai-maestro)

</div>
