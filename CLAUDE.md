# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Claude Code Dashboard** - A browser-based terminal dashboard for managing multiple Claude Code agents running in tmux on macOS. The application auto-discovers agents from tmux sessions and provides a unified web interface with real-time terminal streaming.

**Current Phase:** v0.29+ — localhost + Tailscale bind, Agent Identity (AID / WebAuthn), team governance, AMP messaging, role-plugin marketplace, cross-client conversion, kanban boards, element management
**Tech Stack:** Next.js 14 (App Router), React 18, xterm.js, WebSocket, node-pty, Tailwind CSS, lucide-react
**Platform:** macOS 12.0+, Node.js 20+, tmux 3.0+
**Branding:** Space Grotesk font, titled "AI Maestro"
**Port:** Application runs on port 23000 (http://localhost:23000)

## Development Commands

```bash
# Development
yarn install             # Install all dependencies
yarn dev                 # Start dev server with hot reload (http://localhost:23000)

# Production
yarn build               # Build optimized production bundle
yarn start               # Start production server (http://localhost:23000)
pm2 restart ai-maestro   # Restart production server via PM2

# Testing
yarn test                # Run unit tests (vitest)
yarn test:watch          # Run tests in watch mode

# Testing tmux sessions (for development)
tmux new-session -s test-session     # Create test session
tmux list-sessions                   # List all sessions (what the app discovers)
tmux kill-session -t test-session    # Clean up test session
```

**Port Configuration:** The application is configured to run on port 23000. This is set in the PM2 configuration.

**Health Check:** Do NOT use `/api/health` to check if the site is live (it doesn't exist). Use `/api/sessions` instead - it returns the list of agents and confirms the server is running.

## Version Management

**IMPORTANT:** When bumping the version, ALWAYS use the centralized script:

```bash
./scripts/bump-version.sh patch    # 0.17.12 -> 0.17.13
./scripts/bump-version.sh minor    # 0.17.12 -> 0.18.0
./scripts/bump-version.sh major    # 0.17.12 -> 1.0.0
./scripts/bump-version.sh 1.0.0    # Set specific version
```

This script updates ALL version references across the codebase:
- `version.json` (source of truth)
- `package.json`
- `scripts/remote-install.sh`
- `README.md` (badge)
- `docs/index.html` (schema + display)
- `docs/ai-index.html`
- `docs/BACKLOG.md`

**DO NOT manually edit version numbers in individual files.** Always use the script to ensure consistency.

**CLI Script Versioning:** The `aimaestro-agent.sh` CLI tool uses an independent semver (`v1.x.x`) separate from the app version (`0.24.x`). The CLI is distributed via the plugin repo and has its own release cadence.

## Pre-PR Checklist (MANDATORY)

**⚠️ STOP! Before creating ANY Pull Request to main, complete this checklist:**

```
□ 1. TESTS PASS: yarn test
□ 2. BUMP VERSION: ./scripts/bump-version.sh patch
□ 3. BUILD PASSES: yarn build
□ 4. COMMIT version bump with your changes
```

**This is NON-NEGOTIABLE.** Every PR to main MUST include a version bump. No exceptions.

---

## Release & Marketing Workflow

### Pull Request Protocol

**IMPORTANT:** Every time you create a Pull Request to main, also draft an X (Twitter) post to announce the release.

**PR Creation Checklist:**
1. ✅ **VERSION BUMPED** (see Pre-PR Checklist above - this should already be done)
2. Create PR with comprehensive description (summary, features, bug fixes, breaking changes)
3. Draft X post highlighting key features and improvements
4. Include release notes or link to PR in the post
5. Use relevant hashtags: #AIcoding #DevTools #OpenSource
6. Consider adding screenshots/GIFs for visual features
7. Post during peak hours (9-11am or 1-3pm EST)

**X Post Template:**
```
[Emoji] Shipping [Feature Name] today!

Key improvements:
• [Feature 1]
• [Feature 2]
• [Feature 3]

[Call to action - Star/Try/Share]
[Link to PR or GitHub]

#AIcoding #DevTools
```

**Examples:**
- Major release: "Shipping AI Maestro v0.3.3! 🚀"
- Feature addition: "New feature: SSH configuration for tmux 🔐"
- Bug fixes: "Squashed bugs and improved stability 🐛"

Keep posts concise (<280 chars when possible), engaging, and focused on user benefits rather than technical implementation.

### Marketing Content Location

**IMPORTANT:** All marketing content files MUST be created in the `marketing/` folder:

```
marketing/
  medium-article.md      # Blog posts for Medium
  linkedin-post.md       # LinkedIn content
  x-post.md              # X/Twitter posts
  findings.md            # Research notes (planning skill)
  task_plan.md           # Task tracking (planning skill)
  progress.md            # Progress logs (planning skill)
```

- The `marketing/` folder is gitignored - content is deleted after publishing
- Never create these files in the project root
- When using the planning skill for marketing tasks, set the output directory to `marketing/`

## Agent Terminology (TITLE / ROLE / PERSONA) — READ FIRST

Every AI Maestro agent has exactly **three orthogonal layers**. Do NOT collapse or conflate them — they map to different pipelines, different UI tabs, and different governance rules.

| Layer | Answers | Example |
|---|---|---|
| **TITLE** | *What is it allowed to do?* (governance class — permissions) | `MEMBER` |
| **ROLE** | *What does it know how to do?* (behaviour — role-plugin main agent) | `ai-maestro-programmer-agent:programmer-main-agent@Emasoft/ai-maestro-plugins` |
| **PERSONA** | *Which specific running instance?* (identity — name + AID + avatar + workdir) | `peter-bot, <aid>, ~/avatars/peter.jpg, ~/agents/peter-bot/` |

**TITLE** is the access-control role — it determines who the agent can message (comm graph), whether it can wake/hibernate others, whether it can `gh pr merge`, whether it can create teams. Eight valid titles: `MANAGER`, `CHIEF-OF-STAFF`, `ARCHITECT`, `ORCHESTRATOR`, `INTEGRATOR`, `MEMBER`, `MAINTAINER`, `AUTONOMOUS`. Stored as `agent.governanceTitle` (lowercase kebab). Changing it runs the `ChangeTitle` pipeline.

**ROLE** is the role-plugin *main-agent* the PERSONA currently runs. Fully qualified as `<plugin>:<main-agent>@<marketplace>` — the `@marketplace` mirrors Claude Code's plugin syntax and the `:main-agent` segment selects which main-agent `.md` file inside the plugin is loaded via `claude --agent <name>`. Installed exactly like any normal plugin (`claude plugin install <name> <marketplace> --scope local` after `claude plugin marketplace add <path-or-owner/repo>`). A role-plugin is any plugin that additionally contains (a) a `<name>.agent.toml` with the two extra fields `compatible-titles` and `compatible-clients`, and (b) a main-agent `.md` whose persona carries the governance rules (inline, via `skills:` references, or via rule-file links). The two AI Maestro default role-plugin marketplaces are the remote `Emasoft/ai-maestro-plugins` and the local `ai-maestro-local-roles-marketplace`.

**PERSONA** is the concrete running instance — four attributes (name, AID key pair, avatar, workdir) that together identify a specific Claude Code tmux session. Only PERSONA has 1:1 cardinality with a session; TITLE and ROLE are swappable on a live PERSONA without losing identity. The workdir is at `~/agents/<name>/` and is the only place outside `/tmp` where the PERSONA may write.

**Key relationships and rules**
- TITLE and ROLE are **orthogonal but constrained** by `compatible-titles`. ChangeTitle rejects assigning a ROLE whose `.agent.toml` does not include the new TITLE.
- **N:1 model:** multiple ROLEs can satisfy one TITLE (UI shows a dropdown when ≥2 are compatible, a locked label when exactly 1 is). One ROLE can also be compatible with multiple TITLEs.
- **R9.13:** Every persisted agent MUST carry exactly one ROLE. The `CreateAgent` / `ChangeTitle` pipelines HARD REJECT any desired-state that would leave an agent with zero role-plugins. AUTONOMOUS resolves to the mandatory `ai-maestro-autonomous-agent` role-plugin.
- **Storage is NOT definitional** for a role-plugin. Folders may live anywhere as long as they are listed in a marketplace manifest's `source` field. `TITLE_PLUGIN_MAP` is an internal default-picker and is not a requirement of the role-plugin definition.
- **Haephestos is one path** to creating a role-plugin, not the definition. Any plugin matching the two conditions above is a valid role-plugin regardless of how it was authored.

**When writing code or docs**
- Use **TITLE** when talking about permissions, governance, comm graph, approvals.
- Use **ROLE** when talking about behaviour, skills, main-agent persona, available tools.
- Use **PERSONA** when talking about which specific agent (the one in the sidebar card, at that workdir, with that AID).
- Do not use "role" to mean "title" — the 2026-03-20 rename made `TitleBadge` / `TitleAssignmentDialog` authoritative. `agent.governanceTitle` is the TITLE; `agent.rolePlugin` (config) is the ROLE; `agent.name` + `agent.label` + `agent.aid` + `agent.workingDirectory` are the PERSONA.
- When the user says "change the agent's role", clarify whether they mean swap the role-plugin (ROLE) or re-assign the governance level (TITLE) — these are different pipelines (`ChangePlugin` with `rolePluginSwap` vs `ChangeTitle`).

## Architecture: Critical Design Patterns

### 1. Custom Server Architecture (server.mjs)

**Why it exists:** Next.js alone doesn't support WebSocket on the same port as HTTP. The custom server combines both.

```
HTTP Requests → Next.js handlers (API routes, pages)
WebSocket Upgrades → Custom WS server (terminal streaming)
Both on port 23000
```

**Key constraint:** The server must handle:
- HTTP/HTTPS for Next.js (pages, API routes)
- WebSocket upgrade requests for `/term?name=<sessionName>`
- Session discovery via `tmux ls` command execution

When modifying `server.mjs`:
- Preserve the upgrade handler that intercepts WebSocket requests
- Maintain the session pooling logic (multiple clients → one PTY)
- Never block the event loop during PTY operations

### 2. Agent-First Architecture (CRITICAL)

**AGENTS ARE THE CORE ENTITY.** Sessions are optional properties of agents.

```
Agent (core entity)
├── id (UUID)
├── name (agent identity, used as session name)
├── label (optional display override)
├── workingDirectory (stored property, NOT derived from tmux)
├── sessions[] (array of AgentSession, typically 0 or 1)
│   ├── index (0 for primary session)
│   ├── status ('online' | 'offline')
│   └── workingDirectory (optional override)
└── preferences.defaultWorkingDirectory
```

**Key principles:**
1. **Agents can exist without sessions** - An agent for querying repos/documents doesn't need a tmux session
2. **workingDirectory is STORED on the agent** - Set when agent is created or session is linked
3. **NEVER query tmux to derive agent properties** - All agent data comes from the registry
4. **Sessions are discovered and LINKED to existing agents** - Not the other way around

**Two agent systems:**
- **`lib/agent-registry.ts`** - File-based registry (`~/.aimaestro/agents/registry.json`) with full agent metadata
- **`lib/agent.ts`** - In-memory Agent class for runtime (database, subconscious)

When you need agent metadata (workingDirectory, etc.), use the file-based registry:
```typescript
import { getAgent, getAgentBySession } from '@/lib/agent-registry'
const agent = getAgent(agentId) || getAgentBySession(sessionName)
const workingDir = agent?.workingDirectory || agent?.sessions?.[0]?.workingDirectory
```

**DO NOT:**
- Query tmux to get working directories
- Derive agent properties from tmux session state
- Assume an agent always has a session
- Create runtime lookups for data that should be stored

**Subconscious runs LOCAL to the agent:**

The subconscious process runs on the **same machine where the agent lives**. This means it has direct access to:
- Local conversation files (`~/.claude/projects/`)
- The agent's CozoDB database (`~/.aimaestro/agents/<id>/`)
- The local file system (workingDirectory, repos, etc.)

The subconscious does NOT need remote API calls to access agent data - everything is local. This is why `index-delta` can read `.jsonl` files directly from disk.

**Subconscious timers (v0.29+ / post-RAG removal per TRDD-70a521d9):**
- `checkMessages()` - **DISABLED by default** (push notifications replace polling)

The RAG-based memory maintenance (`maintainMemory()` + nightly `triggerConsolidation()`) was removed in Phase 1 of TRDD-70a521d9 once Claude Code shipped first-class built-in memory. Only message polling remains, and it stays off by default. To re-enable polling (not recommended), set `messagePollingEnabled: true` in the subconscious config.

### 3. Session Discovery Pattern

Sessions are discovered from tmux and LINKED to agents:

```
/api/sessions → Execute `tmux ls` → Parse output → Link to registry agents → Return JSON
```

**Implementation details:**
- Agent metadata is persisted in `~/.aimaestro/agents/registry.json` (file-based registry) and survives dashboard restarts
- Tmux sessions are discovered and LINKED to registry agents — if a registry agent has no running session, it shows as hibernated
- The dashboard CREATES, RENAMES, HIBERNATES, AND DELETES agents via `CreateAgent` / `ChangeName` / `hibernate` / `DeleteAgent` pipelines in `services/element-management-service.ts`
- Session IDs must match tmux session names exactly (alphanumeric + hyphens/underscores only, plus `@` and `.` for `agentId@hostId` multi-host addressing)

When implementing agent-related features:
- Trust the registry as source of truth — it persists across restarts and across tmux crashes
- Handle `tmux ls` returning empty results gracefully (agents may be hibernated)
- Go through the `element-management-service` pipeline for any mutation (creation/deletion/rename/title change/plugin install) — never write directly to the registry

### 3. WebSocket-PTY Bridge

**Critical data flow:**
```
Browser (xterm.js)
  ↕ WebSocket messages (text/binary)
Server (node-pty)
  ↕ PTY (tmux attach-session -t <name>)
tmux session
  ↕ Claude Code CLI
```

**Important constraints:**
- PTY instances are pooled: Multiple WebSocket clients can connect to the same tmux session
- PTY is created on first client connect, destroyed when last client disconnects
- Terminal resize events must be propagated: Browser → WebSocket → PTY → tmux
- Input/output is binary-safe (supports ANSI escape codes, Unicode, etc.)

When working with terminal components:
- xterm.js handles rendering only - it doesn't know about tmux
- WebSocket is the only communication channel (no polling)
- PTY errors (session not found, tmux crashed) must close WebSocket gracefully
- Terminal dimensions (cols/rows) must sync on window resize

### 4. Single-Active-Agent Rendering (UI-CRIT-01 corrected, 2026-05-04)

**Actual pattern in `app/page.tsx`:** only the agent whose id matches
`activeAgentId` is mounted at any time. Switching agents unmounts the
previous `TerminalView` (and its WebSocket) and mounts a new one. There
are NO "virtual tabs", NO `visibility: hidden` toggling, NO simultaneous
mount of every agent.

The earlier version of this section claimed the opposite — describing
an aspirational tab-based architecture that was never implemented. A
2026-05-04 audit (UI-CRIT-01) caught the drift: the code carried
`const isActive = true` and an unreachable `!isActive` branch, while
this doc described a fully different design. The constant + the dead
branch have been removed; this paragraph now matches what the code does.

**Implementation:**
```tsx
// app/page.tsx — only the active agent is rendered
const agent = selectableAgents.find(a => a.id === activeAgentId)
if (!agent) return null
return (
  <div key={agent.id} className="absolute inset-0 flex flex-col">
    {/* tab bar (terminal/chat/messages/worktree/search/export/profile) */}
    {activeTab === 'terminal' ? (
      <TerminalView session={agentToSession(agent)} isVisible={activeTab === 'terminal'} />
    ) : activeTab === 'chat' ? (
      <AgentChat ... />
    ) : ...}
  </div>
)
```

**Consequences (state on switch):**
- `TerminalView` unmounts → its `useEffect` cleanup runs → WebSocket
  closes → tmux pane is detached but tmux session keeps running
- xterm scrollback held in JS memory is lost on unmount; the next mount
  re-attaches and re-captures via `tmux capture-pane`
- Agent notes are persisted to localStorage on every keystroke, so a
  switch does not lose them
- Multi-tab dashboards (multiple browser tabs, one per agent) are the
  recommended way to keep more than one agent live at once

**If you want to revisit the original aspirational design** (mount-all,
visibility:hidden, instant switch, no WebSocket churn): it is a real
refactor — terminal init lifecycle, WebSocket connection pooling, the
xterm dimension-vs-display gotcha (`visibility: hidden` keeps layout,
`display: none` returns 0×0). Do not assume the doc above describes
shipped behavior. It described a never-shipped design until 2026-05-04.

**Terminal initialization pattern (current):**
```typescript
// components/TerminalView.tsx — initializes on every mount,
// disposes on every unmount.
useEffect(() => {
  let cleanup: (() => void) | undefined
  const init = async () => {
    cleanup = await initializeTerminal(containerElement)
    setIsReady(true)
  }
  init()
  return () => { if (cleanup) cleanup() }
}, [])
```

The empty dependency array makes the effect run on every fresh mount
(once per `key={agent.id}` instance), and the cleanup runs when the
agent is switched away. With single-active rendering, "fresh mount on
every switch" IS the lifecycle — the empty deps array does not magically
make initialization happen-once-forever.

### 5. React State Management Pattern

**Deliberately minimal:** No Redux, Zustand, or complex state libraries.

```
App State:
- Active agent ID (localStorage persistence, drives visibility toggle)
- Agent list (fetched from /api/sessions every 10s)
- WebSocket connection state (per agent, persistent)

Component State:
- Terminal instance (xterm.js, created once per agent)
- Connection errors (transient, cleared on retry)
- Agent notes (loaded once, persist in component state)
```

**Key hooks:**
- `useSessions()` - Fetches session list, auto-refreshes
- `useTerminal()` - Manages xterm.js lifecycle (init once, resize, dispose)
- `useWebSocket()` - Handles WebSocket connection, reconnection, message routing
- `useActiveSession()` - Tracks selected agent with localStorage

When adding new state:
- Keep it in the nearest component that needs it
- Use Context only if 3+ components need the same state
- Never store terminal content in React state (xterm.js manages this)
- Consider if state needs to persist across agent switches (keep in component) vs. reload (use effect with session.id dependency)

### 6. UI Enhancement Patterns

**Hierarchical Agent Organization:**

Agents are organized in a 3-level hierarchy based on their names:
```
fluidmind/agents/backend-architect  →  Level 1: "fluidmind"
                                        Level 2: "agents"
                                        Agent: "backend-architect"
```

**Dynamic Color System:**
- Colors assigned via hash function (same category = same color)
- 8-color palette in `AgentList.tsx` (easily customizable)
- Supports localStorage overrides per category
- No hardcoded category names - works with ANY category

```typescript
const getCategoryColor = (category: string) => {
  // Hash-based color assignment from COLOR_PALETTE
  const hash = category.split('').reduce((acc, char) =>
    char.charCodeAt(0) + ((acc << 5) - acc), 0)
  const colorIndex = Math.abs(hash) % COLOR_PALETTE.length
  return COLOR_PALETTE[colorIndex]
}
```

**Icon System:**
- Uses lucide-react for consistent, accessible icons
- Default icon: `Layers` (can be customized per category)
- Icons for: folders, terminals, actions (edit, delete, create)

**Agent Notes Feature:**
- Collapsible textarea below terminal for per-agent notes
- Auto-saves to localStorage (`session-notes-${sessionId}`)
- Collapse state persisted (`session-notes-collapsed-${sessionId}`)
- Full copy/paste/edit support

**Agent Management:**
- Rename agents with validation (API call to backend)
- Delete agents with confirmation modal
- Create new agents with optional working directory
- All actions update UI optimistically with error handling

**Settings Page (`/settings`):**
- Sidebar labels: Hosts, Domains, Webhooks, Skills Explorer, Plugins Explorer, Experiments, Onboarding, Help, About
- "Skills Explorer" (`marketplace` tab) — marketplace skill browser for agent installation
- "Plugins Explorer" (`global-elements` tab) — plugin toggles, element listing, marketplace management

**UI Best Practices:**
- Avoid nested buttons (causes React hydration errors)
- Use `<div>` with `cursor-pointer` for clickable containers
- Always use `e.stopPropagation()` for nested interactive elements
- Keep hover states smooth with `transition-all duration-200`

### 7. Team Meeting Architecture (v0.20.19+)

**State machine pattern:** Team meetings use a `useReducer` with a `TeamMeetingState` that tracks meeting phase (`idle` → `selecting` → `ringing` → `active`), selected agents, and UI state (sidebar mode, right panel, kanban open).

**Task system:**
- Tasks stored per-team in `~/.aimaestro/teams/tasks-{teamId}.json`
- 5 statuses: `backlog` → `pending` → `in_progress` → `review` → `completed`
- Dependency chains: tasks can block other tasks, auto-unblock on completion
- `useTasks` hook polls every 5s for multi-tab sync

**Kanban board:**
- Full-screen overlay (`fixed inset-0 z-40`) matching agent picker overlay pattern
- Native HTML5 drag-and-drop (same pattern as AgentList.tsx)
- `KanbanCard`: `draggable={!task.isBlocked}`, stores taskId in `dataTransfer`
- `KanbanColumn`: `onDragOver`/`onDrop` handlers update task status
- Escape key closes modals in priority order: detail view → quick-add → board
- Blocked tasks show lock icon, not draggable

### 8. TypeScript Type System Organization

**Strict separation by domain:**

```
types/session.ts    - Session metadata, status enums
types/terminal.ts   - xterm.js configuration, dimensions
types/websocket.ts  - Message protocol, connection states
```

**WebSocket message protocol:**
```typescript
{ type: 'input', data: string }           // User typed in terminal
{ type: 'output', data: string }          // Terminal output from tmux
{ type: 'resize', cols: number, rows: number }  // Terminal resized
{ type: 'ping' / 'pong' }                 // Heartbeat
{ type: 'error', error: string }          // Protocol error
```

All WebSocket messages are JSON. Raw terminal output (ANSI codes) is wrapped in `{ type: 'output', data: ... }`.

### 9. Session Control Architecture (v0.27.1+)

**5-state agent status model** based on hook notifications and tmux pane detection:

| State | Color | Pulse | Source | Meaning |
|-------|-------|-------|--------|---------|
| Exited | gray-400 | no | `programRunning === false` | Claude process ended, shell prompt visible |
| Permission | orange-500 | yes | `notificationType === 'permission_prompt'` | Claude is blocked waiting for tool approval |
| Waiting | amber-500 | yes | `notificationType === 'idle_prompt'` | Claude finished, waiting for user input (safe state) |
| Active | green-500 | yes | `activityStatus === 'active'` | Claude is processing/generating |
| Idle | green-500 | no | Default when online | Between turns, no recent activity |

**Safe-state gate:** All control operations (Stop, Restart, Approve) require `idle_prompt` state. This is the only state where Claude has no subagents running, no permission prompts pending, and is genuinely waiting for input.

**Session control buttons (AgentProfile.tsx):**
- **Stop** (red): sends 3-command sequence: `C-c` (clear partial input) → `-l '/exit'` (literal text) → `Enter`. Enabled only at `idle_prompt`.
- **Restart** (orange): calls `POST /api/sessions/[id]/restart` — sends same 3-command stop sequence, polls `tmux display-message` until shell detected (max 15s), waits 1s, relaunches with same program args + `--name` persona injection.
- **Approve** (green): sends `y` to terminal. Visible only during `permission_prompt`.

**Auto-restart queue (`useRestartQueue` hook):** After plugin/skill changes, agents are queued for restart. The queue polls agent activity every 1s (polling chosen over reactive deps to avoid effect churn from `getSessionActivity` identity changes — SF-044). When a queued agent reaches `idle_prompt`, it fires the restart API automatically.

**API endpoints:**
- `POST /api/sessions/[id]/stop` — sends `C-c` + `/exit` + `Enter` to tmux session
- `POST /api/sessions/[id]/restart` — full restart cycle (exit → poll → wait → relaunch)
- `POST /api/sessions/[id]/kill` — immediate tmux kill for non-cooperative agents

**Data flow:** Hook (`ai-maestro-hook.cjs`) → state file (`~/.aimaestro/chat-state/`) → WebSocket broadcast → `useSessionActivity` → `AgentBadge`/`AgentProfile`

### 10. Manager-Gated Team Governance (v0.27.3+)

**MANAGER is required for teams to function.** Without a MANAGER on the host, all teams are blocked and team agents are hibernated.

**Blocking cascade (triggered when MANAGER removed or missing at startup):**
1. All teams get `blocked: true` in teams.json
2. All agents belonging to those teams have their tmux sessions killed (hibernated)
3. AUTONOMOUS agents are unaffected
4. Team creation, agent add/remove on teams are rejected with HTTP 400

**Unblocking (triggered when MANAGER assigned):**
1. All teams get `blocked: false`
2. Agents remain hibernated — user or MANAGER must wake them manually

**Agent lifecycle governance (wake/hibernate/restart):**

| Caller | Scope | Enforced at |
|--------|-------|-------------|
| User (web UI) | Any agent | Always allowed |
| MANAGER | Any agent | `auth.agentId === managerId` |
| CHIEF-OF-STAFF | Own team agents only | `team.chiefOfStaffId === auth.agentId && team.agentIds.includes(targetId)` |
| Any other agent | Denied | HTTP 403 |

Team agents cannot be woken when no MANAGER exists (even by the user — assign MANAGER first).

**Key files:**
- `lib/team-registry.ts` — `blockAllTeams()`, `unblockAllTeams()`, `isAgentInAnyTeam()`
- `services/element-management-service.ts` — ChangeTitle Gate 10 (block on manager removal), Gate 13 (unblock on manager assignment)
- `server.mjs` — Startup manager check
- `app/api/agents/[id]/wake/route.ts` — Auth + manager gate
- `app/api/agents/[id]/hibernate/route.ts` — Auth + manager gate
- `docs/GOVERNANCE-RULES.md` — Full governance rules (R9, R10, R11, and the full R1-R20 set)

## File Structure Conventions

**Directories already in use — follow existing patterns, do not duplicate:**
- `tests/` — Vitest unit tests + `tests/scenarios/` UI scenario tests (24 scenarios)
- `public/` — Static assets (avatars, favicons, logos)
- `styles/` — `transfer-animations.css` and other global CSS additions; most styling stays in Tailwind utilities + `app/globals.css`
- Do NOT create a `server/` directory — all server logic lives in root `server.mjs` (custom Next.js server)

**Current structure:**
```
app/
  page.tsx              - Main dashboard with footer (AgentList + TerminalView)
  layout.tsx            - Root layout, Space Grotesk font, app title "AI Maestro"
  globals.css           - Tailwind imports + terminal scrollbar styles
  api/sessions/route.ts - GET endpoint for tmux session discovery

components/
  AgentList.tsx         - Hierarchical sidebar with icons, colors, session management
  TerminalView.tsx      - Terminal display with collapsible notes area
  [Other components]    - Keep them small, single responsibility
  team-meeting/
    MeetingHeader.tsx         - Meeting header with status, controls, kanban toggle
    MeetingSidebar.tsx        - Agent list sidebar during meetings
    MeetingTerminalArea.tsx   - Terminal grid for active meeting agents
    MeetingRightPanel.tsx     - Right panel wrapper (tasks + chat tabs)
    MeetingChatPanel.tsx      - Meeting chat using AMP messages
    TaskPanel.tsx             - Task list panel with filtering and quick-add
    TaskCard.tsx              - Task card with status, assignee, dependencies
    TaskCreateForm.tsx        - Full task creation form with all fields
    TaskDetailView.tsx        - Detailed task view with edit capabilities
    TaskKanbanBoard.tsx       - Full-screen kanban overlay with 5 columns + drag-and-drop
    KanbanColumn.tsx          - Single kanban column with drop zone
    KanbanCard.tsx            - Compact draggable task card for kanban
    DependencyPicker.tsx      - Dependency selection for task relationships

hooks/
  useWebSocket.ts       - WebSocket connection (reconnection, heartbeat)
  useTerminal.ts        - xterm.js lifecycle (init, fit, dispose)
  useAgents.ts          - Agent list fetching + auto-refresh from registry
  useAgentLocalConfig.ts - Per-agent local config (plugins, skills, elements)
  useGovernance.ts      - Governance state (agentTitle, team membership, permissions)
  useTasks.ts           - Task CRUD with tasksByStatus, optimistic updates, 5s polling
  useMeetingMessages.ts - Meeting chat messages via AMP with 7s polling
  useSessionActivity.ts - Agent activity status via WebSocket (5-state model)
  useRestartQueue.ts    - Auto-restart queue triggered by element changes

lib/
  api.ts                - Fetch wrappers for /api/sessions
  websocket.ts          - WebSocket message creators
  terminal.ts           - Terminal utility functions
  utils.ts              - Shared utilities (date formatting, etc.)
  group-registry.ts     - File-based CRUD for groups (~/.aimaestro/teams/groups.json)
  ecosystem-constants.ts - Single source of truth for marketplace repos, plugin names, ecosystem IDs (TS)

types/
  session.ts            - Session metadata, status enums, hierarchical structure
  terminal.ts           - xterm.js configuration, dimensions
  websocket.ts          - Message protocol, connection states
  group.ts              - Group types (Group, GroupsFile)
  governance.ts         - GovernanceTitle, GovernanceConfig, transfer types

docs/
  images/               - Screenshots for README documentation
  REQUIREMENTS.md       - Installation prerequisites
  OPERATIONS-GUIDE.md   - Session management, troubleshooting

scripts/            - CLI scripts installed to ~/.local/bin/ (AMP, graph, docs, memory, agent management)

scripts/
  ecosystem-config.sh             - Single source of truth for marketplace repos, plugin names (shell)
  generate-social-logos.js        - Generate social media logos from SVG
  init-all-agents.mjs             - Initialize memory for all agents
  register-agent-from-session.mjs - Register agent(s) from tmux session(s)
  setup-tmux.sh                   - Setup tmux configuration

services/
  groups-service.ts             - Groups business logic (CRUD, subscribe, notify)
  role-plugin-service.ts        - Role-plugin install/uninstall via Claude CLI
  governance-service.ts         - Team governance (manager, COS, transfers)
  headless-router.ts            - Standalone HTTP router for headless mode

install-messaging.sh    - Installer for messaging system to user's environment

server.mjs              - Custom Next.js server (HTTP + WebSocket)
CLAUDE.md               - This file - guidance for Claude Code
```

## Runtime Install Tree (CANONICAL — verify a path HERE before assuming it)

The section above is the **source repo**. This section is the **runtime install
tree**: where AI Maestro actually stores data on each host. **Do not guess paths
— look them up here.** Paths tagged `(verified)` are created/used by current code
(`statePath()` / `getStateDir()` resolve to `~/.aimaestro`, `STATE_DIR_NAME='.aimaestro'`,
`lib/ecosystem-constants.ts`); `(legacy/unverified)` = present on disk but not
referenced by current code — confirm before relying on them.

> **Install-location independence (CRITICAL):** the **dev repo** `~/ai-maestro/`
> (the "File Structure Conventions" section above) is NOT the install tree. When
> AI Maestro ships as a package, there is **no `~/ai-maestro/`** — the app code
> (`server.mjs`, `app/`, `services/`, `lib/`, `public/avatars/`, …) lives at
> whatever path the package manager installs to. The ONLY paths that stay at
> fixed absolute home locations across any install method are the **runtime data
> trees `~/.aimaestro/` and `~/agents/`** (plus the host-level `~/.claude/`,
> `~/.agent-messaging/`, and installer-placed `~/.local/bin/` that AI Maestro
> writes into but does not own). Never hardcode `~/ai-maestro/...` for runtime
> data — resolve app paths relative to the install dir, and data paths via
> `getStateDir()` (`~/.aimaestro`) and `~/agents/`.

### `~/.aimaestro/` — global per-host server state (`getStateDir()`)

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
├── messages/                     #   AI-Maestro-native messages: inbox/ sent/ archived/ (per agent name)   (verified)
├── backups/                      # registry.json backups taken before mutations          (verified, lib/agent-registry)
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

### `~/agents/` — agent working directories + LOCAL marketplace SOURCE

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

### `~/.claude/` — Claude Code's OWN store (NOT AI Maestro; AI Maestro reads/installs INTO it)

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

### `~/.agent-messaging/` — AMP client storage (host-level + per-agent)

```
~/.agent-messaging/
├── config.json  IDENTITY.md  keys/  registrations/      # host-level AMP identity
├── messages/{inbox,sent}/                               # host-level mailbox
└── agents/<id-or-name>/messages/{inbox,sent,archived}/  # per-agent AMP mailboxes
```

### `~/.local/bin/` — installed CLI wrappers (on PATH; placed by install-messaging.sh)

- `aimaestro-agent.sh` (+ `agent-core/helper/session/plugin/skill/commands.sh` modules) — agent lifecycle CLI
- `amp-*.sh` (~28) — Agent Messaging Protocol CLI (send / inbox / read / reply / fetch / register / kanban / clone-repo …)
- `aid-*.sh` (5) — Agent Identity CLI (init / register / token / status / auth)
- `docs-*.sh`, `graph-*.sh`, `memory-*.sh` — docs search, graph query, memory tools

## Agent Messaging Protocol (AMP)

**Overview:** AI Maestro uses the Agent Messaging Protocol (AMP) for inter-agent communication. AMP is like email for AI agents - it works locally by default and can optionally federate with external providers.

**Key Features:**
- **Local-first**: Works immediately without external dependencies
- **Cryptographic signing**: Ed25519 signatures for message authenticity
- **Federation**: Connect to external providers (CrabMail, etc.) for global messaging
- **Provider-agnostic**: Same CLI works with any AMP provider
- **Title-based communication graph**: Directed graph enforcing which governance titles can message which (see below)

### Communication Rules

AMP messaging is governed by a title-based directed communication graph. Each governance title defines which other titles the agent can message. Missing connections are blocked with HTTP 403 and a routing suggestion.

**Adjacency matrix.** `Y` = allowed, blank = forbidden, `1` = reply-only (sender may send EXACTLY ONE reply to recipient if the recipient previously messaged the sender; without a prior inbound, it's equivalent to blank).

**2026-04-22 v2 update** — HUMAN USER (H) is now a first-class node. H has full outbound `Y` to every node including self (user-to-user). Team-agent edges to H are reply-only (`1`); governance-title edges to H (M/T/A) are `Y`.

**2026-05-04 v3 update** — MANAGER → in-team-non-COS edges (ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER) flipped from `Y` to blank. Real-world test showed great confusion when MANAGER bypassed COS to issue directives directly to team agents — COS or ORCHESTRATOR ended up uninformed or issued contradictory instructions. **The CHIEF-OF-STAFF is now the SOLE inbound/outbound gateway for closed-team agents.** MANAGER still freely reaches COS, peer MANAGERs, MAINTAINER (out-of-team), AUTONOMOUS (out-of-team), and the HUMAN user. The user (HUMAN) remains exempt — full `Y` to every node.

| Sender \ Recipient | HUMAN | MANAGER | COS | ORCHESTRATOR | ARCHITECT | INTEGRATOR | MEMBER | MAINTAINER | AUTONOMOUS |
|---------------------|:-----:|:-------:|:---:|:------------:|:---------:|:----------:|:------:|:----------:|:----------:|
| **HUMAN**           |   Y   |    Y    |  Y  |      Y       |     Y     |     Y      |   Y    |     Y      |     Y      |
| **MANAGER**         |   Y   |    Y    |  Y  |              |           |            |        |     Y      |     Y      |
| **CHIEF-OF-STAFF**  |   1   |    Y    |  Y  |      Y       |     Y     |     Y      |   Y    |            |            |
| **ORCHESTRATOR**    |   1   |         |  Y  |              |     Y     |     Y      |   Y    |            |            |
| **ARCHITECT**       |   1   |         |  Y  |      Y       |           |            |        |            |            |
| **INTEGRATOR**      |   1   |         |  Y  |      Y       |           |            |        |            |            |
| **MEMBER**          |   1   |         |  Y  |      Y       |           |            |        |            |            |
| **MAINTAINER**      |   Y   |    Y    |     |              |           |            |        |            |            |
| **AUTONOMOUS**      |   Y   |    Y    |     |              |           |            |        |            |     Y      |

**Three layers of enforcement:**
1. **API (server-side)**: `lib/communication-graph.ts` → `validateMessageRoute()` checks sender/recipient titles before delivery. Returns `403 title_communication_forbidden` with routing suggestion.
2. **Agent prompts (client-side)**: Each role-plugin's main-agent .md file lists allowed/forbidden recipients. Skills (`agent-messaging`, `team-governance`) include the full graph.
3. **Subagents**: Sub-agent .md files explicitly forbid AMP messaging. Subagents have no AMP identity and cannot authenticate.

**The user** is exempt from the graph — can message any agent and receive responses from all. Agents are discouraged from initiating messages to the user (only respond when contacted). The user must still be authenticated to prevent agents from sending messages on the user's behalf.

See `docs_dev/2026-04-03-communication-graph.md` for the full spec with graph definition, routing suggestions, and design rationale.

### Installation

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
  - 11 skills: agent-messaging, agent-identity, ai-maestro-agents-management, graph-query, memory-search, docs-search, planning, team-governance, team-kanban, debug-hooks, mcp-discovery
  - 12 AMP slash commands: `/amp-send`, `/amp-inbox`, `/amp-read`, etc.
  - Hooks: session tracking + message notifications
- Local role-plugins marketplace → `~/agents/role-plugins/`
  - Creates `.claude-plugin/marketplace.json` (preserves existing plugins on reinstall)
  - Registers with Claude CLI: `claude plugin marketplace add ~/agents/role-plugins/`
  - Updates: `claude plugin marketplace update ai-maestro-local-roles-marketplace`
  - Marketplace name: `ai-maestro-local-roles-marketplace` (from `scripts/ecosystem-config.sh`)
- Message storage → `~/.agent-messaging/`

**Note:** All skills are bundled in the `ai-maestro-plugin` plugin. There are NO standalone skills in `~/.claude/skills/` — everything is managed via the plugin system.

### Quick Start

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

### Architecture

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

### AMP CLI Commands

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

### Address Formats

**Local addresses** (work immediately):
- `alice` → `alice@default.local`
- `bob@myteam.local` → Local delivery

**External addresses** (require registration):
- `alice@acme.crabmail.ai` → Via CrabMail provider
- `backend@company.otherprovider.com` → Via other provider

### Provider API (v0.20.0+)

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

### Push Notifications

When a message is routed to a local agent, AI Maestro sends a push notification via tmux:

```
[MESSAGE] From: alice - Subject line - check your inbox
```

**Configuration (environment variables):**
- `NOTIFICATIONS_ENABLED=false` - Disable push notifications
- `NOTIFICATION_FORMAT` - Customize notification format

### Message Storage

All messages are stored in AMP per-agent directories:
```
~/.agent-messaging/agents/<agentName>/messages/inbox/
~/.agent-messaging/agents/<agentName>/messages/sent/
```

Per-agent directories are auto-created when agents first use AMP commands.
The old `~/.aimaestro/messages/` system is no longer used.

### Claude Code Skill

The AMP skill (from `agent-messaging` plugin in the marketplace) provides natural language:

```
"Check my messages" → amp-inbox.sh
"Send a message to backend-api about deployment" → amp-send.sh backend-api "Deployment" "..."
"Reply to the last message" → amp-reply.sh <id> "..."
```

### Development Notes

- **Marketplace**: `Emasoft/ai-maestro-plugins` — update with `claude plugin marketplace update ai-maestro-plugins`
- **Protocol spec**: https://agentmessaging.org
- **Security**: Messages are signed with Ed25519; AI Maestro verifies signatures
- **Relay queue**: Offline agents get messages via polling (`/api/v1/messages/pending`)

## Plugin Abstraction Principle (CRITICAL)

All AI Maestro functionality is exposed through two abstraction layers. External plugins MUST use these layers — never call the API directly. See [docs/PLUGIN-ABSTRACTION-PRINCIPLE.md](./docs/PLUGIN-ABSTRACTION-PRINCIPLE.md) for the full guide.

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
- `amp-send.sh`, `amp-inbox.sh`, `amp-read.sh`, etc. — Messaging CLI
- `aid-init.sh`, `aid-token.sh`, etc. — Agent Identity CLI

The same scripts are also bundled in the plugin (for slash commands). When the API changes, only these scripts need updating.

### Rules for External Plugins

1. **Plugin skills/commands/agents MUST NOT embed API syntax** (no curl commands, no endpoint URLs, no header patterns). They describe functionality and reference the global AI Maestro skill by name.
2. **Plugin hooks/scripts MUST NOT call the API directly.** They call globally-installed AI Maestro scripts (`aimaestro-agent.sh`, `amp-send.sh`, etc.).
3. **Governance rules are discovered at runtime** by reading the `team-governance` skill. Plugins MUST NOT hardcode governance rules, permission matrices, or role restrictions.
4. **AI Maestro's own plugin is the exception** — it IS the provider of these abstractions. Its skills contain the canonical syntax. Its scripts make the actual API calls.

### Benefits
- API change → update 1 skill/script → all plugins work
- New feature → add to skill → all agents discover it
- Governance rule change → update skill → all agents learn it automatically
- No "update hundreds of plugins" problem as the ecosystem grows

## Plugin Architecture (CRITICAL — Two Separate Worlds)

Plugins in AI Maestro are split into two completely separate categories with different lifecycles, storage locations, and management flows. **Never mix the two.**

### CRITICAL — source vs install target (clarified 2026-04-20, R20.29)

**The three AI Maestro local-marketplace containers under `~/agents/{role,custom,core}-plugins/…` are SOURCE STORAGE / publishing surfaces, NOT the installed location of any plugin.**

A plugin LIVES at its install target — the CLIENT'S own plugin cache (`~/.claude/plugins/cache/…`, `~/.codex/plugins/cache/…`, etc.) — reached via THAT CLIENT'S own install protocol. This invariant holds regardless of the plugin's source:

- a GitHub URL,
- a local folder,
- one of the 3 AI Maestro local marketplaces, OR
- a remote marketplace (`Emasoft/ai-maestro-plugins` or any third-party).

In all 4 cases AI Maestro invokes the client's protocol to install INTO the client:
- **Claude**: `claude plugin install <plugin> <marketplace> --scope local` (+ enable in `~/.claude/settings.local.json`).
- **Codex**: file-based — add entry to `~/.agents/plugins/marketplace.json`, flip `enabled=true` for `<name>@<marketplace>` in `~/.codex/config.toml`, reload Codex.
- Future clients: whatever their protocol is.

AI Maestro only WRITES into `~/agents/{role,custom,core}-plugins/…` when it is the AUTHOR or CONVERTER of the plugin (Haephestos-generated customs, Claude→non-Claude conversions, core-plugin emissions for non-Claude clients). In every other case the plugin's source stays where the user pointed and AI Maestro installs from there directly. Uninstall operates on the client target only — the AI Maestro source, when one exists, is preserved across uninstall/reinstall cycles so later reinstalls do not require re-emission. **AI Maestro NEVER deletes from the 3 source containers; removing a source folder is a manual user action, outside AI Maestro's scope** (R20.31).

**Scope + UI semantics of install / uninstall (R20.30):** Every plugin lives in exactly one scope on the target client — either LOCAL (per-agent, scoped to a single agent's working directory) or USER (global, visible to every agent on the same client). Not all clients support local scope; the per-client adapter declares this capability.

The UI has two distinct surfaces for the two scopes, and they MUST NOT overlap:

| UI surface | Scope shown | Uninstall semantics |
|---|---|---|
| Agent Profile → Config → Plugins section | LOCAL scope only (the plugins installed in THIS agent's workdir) | LOCAL uninstall for this agent only — other agents using the same plugin are unaffected |
| Settings → Plugins Explorer → `<client>` tab | USER scope only (the plugins installed globally on this client) | USER uninstall for this client — affects every agent on that client simultaneously |

An uninstall button NEVER touches the opposite scope, and NEVER touches the AI Maestro source containers. Cross-scope invisibility is R20.20; the scoped-uninstall semantics above are R20.30.

See R20.29-R20.31 in `docs/GOVERNANCE-RULES.md` for the canonical wording and SCEN-026 for the end-to-end test.

### 1. Role-Plugins (Agent Specializations)

Role-plugins define an agent's job specialization. They contain a `.agent.toml` profile with `compatible-titles` and `compatible-clients` fields.

**Source storage** (NOT installed state — see the source-vs-install-target block above): role-plugin SOURCES live in `~/agents/role-plugins/<marketplace>/<plugin-name>/` (Haephestos-authored or converted) or on GitHub `Emasoft/ai-maestro-plugins` (8 predefined defaults). The INSTALL target is always the client's own plugin cache, reached via that client's install protocol.

**Local marketplace:** `ai-maestro-local-roles-marketplace` (directory-based, registered with Claude CLI via `claude plugin marketplace add ~/agents/role-plugins/`).

**Two sources for role-plugins:**

| Source | Location | Created by |
|--------|----------|------------|
| **Predefined** (8 defaults) | GitHub `Emasoft/ai-maestro-plugins` → cached to `~/.claude/plugins/cache/` | Emasoft (project owner) |
| **Custom** | `~/agents/role-plugins/<name>/` | Haephestos (agent creation helper) |

**Predefined role-plugins:**

| Plugin Name | Prefix | Governance Title |
|-------------|--------|-----------------|
| `ai-maestro-assistant-manager-agent` | `amama-` | MANAGER |
| `ai-maestro-chief-of-staff` | `amcos-` | CHIEF-OF-STAFF |
| `ai-maestro-programmer-agent` | `ampa-` | MEMBER |
| `ai-maestro-orchestrator-agent` | `amoa-` | ORCHESTRATOR |
| `ai-maestro-integrator-agent` | `amia-` | INTEGRATOR |
| `ai-maestro-architect-agent` | `amaa-` | ARCHITECT |
| `ai-maestro-maintainer-agent` | `amma-` | MAINTAINER |
| `ai-maestro-autonomous-agent` | `amaua-` | AUTONOMOUS |

**Fourfold Identity Rule:** The canonical identity of a role-plugin is the `name` field in `.claude-plugin/plugin.json` (what Claude Code displays). All 4 must match:

1. **`plugin.json` `name`** = canonical identity (e.g., `pedro` or `ai-maestro-programmer-agent`)
2. **Folder name** = must equal plugin.json name
3. **`<name>.agent.toml`** must exist at plugin root AND `[agent].name` inside = plugin.json name
4. **`agents/<name>-main-agent.md`** must exist AND frontmatter `name:` = `<name>-main-agent`

If ANY of the 4 don't match → invalid role-plugin, rejected. Naming conventions:
- Predefined: `ai-maestro-<agent-name>` (in remote GitHub marketplace)
- Custom: `<agent-name>` — user-chosen, kebab-case (in local marketplace)

**Client determination:** The client a role-plugin belongs to is determined ONLY by the `compatible-clients` field in `.agent.toml`, NOT by the plugin name. The server reads `.agent.toml` to discover target clients.

**N:1 compatibility model:** Role-plugins declare which titles they're compatible with via `compatible-titles` in `.agent.toml`. Multiple plugins can serve the same title. Plugins also declare `compatible-clients` (e.g., `["claude-code"]`, `["claude-code", "codex"]`). The UI shows:
- **1 compatible plugin** → fixed label (no choice needed)
- **2+ compatible plugins** → dropdown to choose between them
- ALL titles (including COS, MANAGER) can swap between compatible plugins

**Haephestos creation flow (8 steps):**
1. Gather info (role description + project type)
2. Generate TOML profile via PSS binary
3. Prune and refine elements
4. User review in TOML preview panel
5. Build plugin via PSS make-plugin (into `~/agents/haephestos/build/`)
6. Add AI Maestro compat fields (`compatible-titles`, `compatible-clients`, verify quad-identity)
7. Validate with CPV (`/cpv-validate-plugin`, `/cpv-fix-validation`)
8. Publish via `POST /api/agents/creation-helper/publish-plugin` (copies to marketplace, runs `claude plugin marketplace update ai-maestro-local-roles-marketplace`)

**After publishing:** The plugin appears automatically in any UI that lists role-plugins (wizard step 5, Config tab dropdown, role-plugin status API).

### 2. Normal Plugins (General-Purpose Tools)

Normal plugins are general-purpose tools (skills, MCP servers, hooks, etc.) installed from GitHub marketplaces.

**Installation:**
- **User scope** (global): Settings page → Plugins Explorer tab → browse marketplace → install
- **Local scope** (per-agent): Agent Profile → Config tab → browse marketplace → install

**Marketplace management:**
- **Add marketplace:** Settings → Plugins Explorer → Marketplaces tab → add marketplace URL
- **Remove marketplace:** Same tab → remove button
- All marketplace operations use Claude CLI: `claude plugin marketplace add/remove/update <name>`

**Normal plugins are NEVER put in `~/agents/role-plugins/`.** They are managed entirely by Claude CLI's standard plugin system (`~/.claude/plugins/cache/`, `settings.json`, `settings.local.json`).

**Role-plugin conversion rules:**
- When converting a role-plugin from one client to another, the converter:
  - PRESERVES the original plugin name (no suffix)
  - CHANGES `compatible-clients` in `.agent.toml` to the target client
  - Enforces fourfold identity with the same name
  - Stores in `~/agents/role-plugins/` (same location)
  - NEVER overwrites an existing folder — conversion fails if folder exists
- When converting an ordinary (non-role) plugin, the converter:
  - ADDS `-<client>` suffix to the name for non-Claude targets (e.g., `my-formatter-codex`); Claude-targeted customs keep their original name
  - Stores under `~/agents/custom-plugins/<client>-custom-marketplace/<name>-<client>/` (per R20.28; use `custom-marketplace/` for Claude)
  - Registers in `ai-maestro-local-custom-marketplace`

### Title → Role-Plugin Auto-Assignment

When a governance title is assigned via the UI (Title Assignment Dialog), the ChangeTitle pipeline (Gates 15-16) automatically:
1. Finds compatible plugins for the new title + agent's client (`getCompatiblePluginsForTitle()`)
2. If the current plugin is already compatible → keeps it
3. If not → installs the first compatible plugin (uninstalls the old one)
4. If no native plugin for this client → auto-converts from Claude source via adapter system (`convertAndStorePlugin` + `emitForClient` + client adapter)

### Marketplace Names (Single Source of Truth)

| Constant | Value | Purpose |
|----------|-------|---------|
| `MARKETPLACE_NAME` / `GITHUB_MARKETPLACE_NAME` | `ai-maestro-plugins` | GitHub marketplace for predefined role-plugins |
| `LOCAL_MARKETPLACE_NAME` | `ai-maestro-local-roles-marketplace` | Local directory marketplace for role-plugins (custom + converted) |
| `LOCAL_MARKETPLACE_DIR_NAME` | `role-plugins` | Directory name under `~/agents/` |
| `CUSTOM_MARKETPLACE_NAME` | `ai-maestro-local-custom-marketplace` | Local marketplace for converted ordinary plugins |
| `CUSTOM_MARKETPLACE_DIR_NAME` | `custom-plugins` | Directory name under `~/agents/` |

Defined in `lib/ecosystem-constants.ts` (TypeScript) and `scripts/ecosystem-config.sh` (shell). `getLocalMarketplacePath()` returns the resolved absolute path.

**Deprecated marketplace names** (auto-removed by migration): `23blocks-OS/ai-maestro-plugins`, `ai-maestro-local-agents-marketplace`, `ai-maestro-local-marketplace`. Note: `role-plugins` is NOT a deprecated marketplace — it is the container directory name (`ROLE_PLUGINS_CONTAINER_DIR_NAME`) under `~/agents/` that holds the local role-plugin marketplace.

### Key Files

- `services/role-plugin-service.ts` — Core service: `generatePluginFromToml()`, `createPersona()`, `listRolePlugins()`, `getPluginsForTitle()`, `ensureMarketplace()`, `updateMarketplaceManifest()`
- `services/element-management-service.ts` — `ChangeTitle()` (Gates 15-16 handle plugin swap), `getCompatiblePluginsForTitle()`, `installPluginLocally()`
- `app/api/agents/role-plugins/` — List/install/uninstall/status API
- `app/api/agents/creation-helper/publish-plugin/` — Publishes Haephestos-built plugin to local marketplace
- `components/agent-profile/RoleTab.tsx` — Dynamic label vs dropdown based on compatible plugin count
- `components/AgentCreationWizard.tsx` — Step 5 filters by `compatible-titles` + `compatible-clients`
- `lib/ecosystem-constants.ts` — `LOCAL_MARKETPLACE_NAME`, `GITHUB_MARKETPLACE_NAME`, `getLocalMarketplacePath()`
- `agents/haephestos-creation-helper.md` — 8-step role-plugin creation protocol

### Editing Role-Plugins (CRITICAL — Never Edit Cache)

**NEVER edit files in `~/.claude/plugins/cache/`** — those are cached copies that get overwritten on every plugin update. All changes must go through the proper publish pipeline.

**Correct workflow to edit a role-plugin:**

```bash
# 1. Clone the plugin's own GitHub repo (NOT the marketplace, NOT the cache)
cd /tmp
git clone git@github.com:Emasoft/<plugin-name>.git
cd <plugin-name>

# 2. Make your edits to the actual source files
#    Main agent: agents/<plugin-name>-main-agent.md
#    Skills: skills/<skill-name>/SKILL.md
#    Plugin manifest: plugin.json
#    TOML profile: <plugin-name>.agent.toml

# 3. Publish using the unified publish pipeline (quality gate + version bump)
uv run python scripts/publish.py --patch
#    This runs: test → lint → validate → consistency-check → bump → commit → push
#    publish.py is STRICT (no skip flags, no env-var bypass). A pre-push git
#    hook refuses any push that isn't invoked from publish.py itself.
#
#    If CPV strict validation fails with MINOR/MAJOR/CRITICAL issues, spawn
#    the `claude-plugins-validation:plugin-fixer` agent — it reads the
#    validation report and applies fixes one by one from a deep knowledge
#    base in skills/fix-validation/references/. Example:
#      Agent(subagent_type="claude-plugins-validation:plugin-fixer",
#            prompt="Fix the CPV strict validation issues in <plugin-path>")
#    Then re-run publish.py. Do NOT hand-patch SKILL.md files by guessing
#    the CPV rules — the fixer agent knows them all.

# 4. The GitHub workflow in the plugin repo automatically triggers
#    Emasoft/ai-maestro-plugins marketplace to update its metadata
#    with the new version, so Claude Code auto-updates on next check.

# 5. Force update on the local machine (optional, for immediate testing):
claude plugin update <plugin-name>@ai-maestro-plugins
```

**The 7 role-plugin repos (each independent, NOT forked):**

| Plugin | Repo |
|--------|------|
| `ai-maestro-assistant-manager-agent` | `Emasoft/ai-maestro-assistant-manager-agent` |
| `ai-maestro-chief-of-staff` | `Emasoft/ai-maestro-chief-of-staff` |
| `ai-maestro-architect-agent` | `Emasoft/ai-maestro-architect-agent` |
| `ai-maestro-orchestrator-agent` | `Emasoft/ai-maestro-orchestrator-agent` |
| `ai-maestro-integrator-agent` | `Emasoft/ai-maestro-integrator-agent` |
| `ai-maestro-programmer-agent` | `Emasoft/ai-maestro-programmer-agent` |
| `ai-maestro-maintainer-agent` | `Emasoft/ai-maestro-maintainer-agent` |

**What NOT to do:**
- Do NOT edit `~/.claude/plugins/cache/<marketplace>/<plugin>/` — changes are lost on update
- Do NOT edit `~/agents/role-plugins/<plugin>/` for predefined plugins — that's for Haephestos-created custom plugins only
- Do NOT push directly to `Emasoft/ai-maestro-plugins` marketplace — plugin repos trigger marketplace updates automatically

## Groups Feature (v0.25+)

Groups are lightweight agent collections for broadcast messaging — replacing the removed "open teams" concept. Unlike teams, groups have no governance, no COS, no kanban — just a subscriber list.

### Types

- `types/group.ts` — `Group` interface (id, name, description, subscriberIds, timestamps)
- `types/group.ts` — `GroupsFile` (version + groups array)

### Storage

Groups persist in `~/.aimaestro/teams/groups.json` via `lib/group-registry.ts`.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | List all groups |
| POST | `/api/groups` | Create a group |
| GET | `/api/groups/{id}` | Get group by ID |
| PUT | `/api/groups/{id}` | Update group |
| DELETE | `/api/groups/{id}` | Delete group |
| POST | `/api/groups/{id}/subscribe` | Subscribe agent to group |
| POST | `/api/groups/{id}/unsubscribe` | Unsubscribe agent from group |
| POST | `/api/groups/{id}/notify` | Broadcast message to all subscribers |

### Key Files

- `types/group.ts` — Group type definitions
- `lib/group-registry.ts` — File-based CRUD with validation
- `services/groups-service.ts` — Business logic layer
- `services/headless-router.ts` — Groups routes for headless mode
- `app/api/groups/` — Next.js API routes

### Migration from Open Teams

Open teams were removed in the governance simplification (2026-03-27). All teams are now closed (isolated messaging with COS gateway). Groups replace the "open, unstructured collection of agents" use case that open teams served, but without governance overhead.

## Ecosystem Constants (Single Source of Truth)

All marketplace repos, plugin names, and ecosystem identifiers are centralized in two mirrored files:

- **TypeScript**: `lib/ecosystem-constants.ts` — used by all server-side services and API routes
- **Shell**: `scripts/ecosystem-config.sh` — sourced by all installer/updater shell scripts

When the project owner changes repos or orgs, only these two files need updating. All shell scripts use `${MARKETPLACE_REPO:-Emasoft/ai-maestro-plugins}` (with fallback) after sourcing the config. All TypeScript code imports constants from `lib/ecosystem-constants.ts`.

**Key constants defined:**
- `MARKETPLACE_REPO` / `MARKETPLACE_NAME` — GitHub marketplace org/repo
- `MAIN_PLUGIN_NAME` — Main AI Maestro plugin (`ai-maestro-plugin`)
- `ROLE_PLUGIN_*` — All 8 predefined role-plugin names (MANAGER, COS, ARCHITECT, INTEGRATOR, ORCHESTRATOR, PROGRAMMER, MAINTAINER, AUTONOMOUS)
- `PREDEFINED_ROLE_PLUGIN_NAMES` — The tuple of all 8 names used by consumer code
- `PLUGIN_COMPATIBLE_TITLES` — Map from plugin name to list of compatible governance titles
- `TITLE_PLUGIN_MAP` — Governance title to default role-plugin mapping
- `AI_MAESTRO_REPO` / `MARKETPLACE_REPO_URL` — Repo URLs

**Note:** The `Emasoft/ai-maestro-plugins` references in this CLAUDE.md are documentation values. The actual runtime values come from ecosystem-constants.

## GitHub Repos Architecture (3-Repo Split)

The AI Maestro ecosystem is split across three separate GitHub repos under the `Emasoft` org. Each has a distinct role:

### 1. `Emasoft/ai-maestro` — Main App (this repo)

The Next.js dashboard + server. Also the **canonical source** for all AMP and AID scripts:
- `scripts/amp-*.sh` (28 scripts) — Agent Messaging Protocol CLI
- `scripts/aid-*.sh` (5 scripts) — Agent Identity CLI
- `scripts/agent-*.sh`, `scripts/docs-*.sh`, `scripts/graph-*.sh`, `scripts/memory-*.sh` — Other CLI tools
- `install-messaging.sh` copies these scripts to `~/.local/bin/`

This repo's scripts are **more up to date** than the upstream marketplace — they include extra security fixes (e.g., MF-023 path traversal validation in `amp-send.sh`).

### 2. `Emasoft/ai-maestro-plugin` — Core Plugin (NOT a fork)

The main AI Maestro Claude Code plugin (v2.2.0+). Contains **only** skills, commands, hooks — **zero scripts** except the hook handler:
- **1 hook script**: `scripts/ai-maestro-hook.cjs` (session tracking + message notifications)
- **11 skills** (auto-discovered from `skills/*/SKILL.md`): agent-management, agent-messaging, agent-identity, debug-hooks, docs-search, graph-query, mcp-discovery, memory-search, planning, team-governance, team-kanban
- **12 AMP commands** (`commands/*.md`): `/amp-init`, `/amp-send`, `/amp-inbox`, etc. — reference scripts at `~/.local/bin/` (installed by main repo)
- **No regular scripts** — all scripts live in the main repo and are installed system-wide by the installers

### 3. `Emasoft/ai-maestro-plugins` — Marketplace (fork of 23blocks-OS)

Fork of `23blocks-OS/ai-maestro-plugins`. Lists the 8 predefined role-plugins in `.claude-plugin/marketplace.json` (the latest additions are `ai-maestro-maintainer-agent` on 2026-04-11 and `ai-maestro-autonomous-agent` for mandatory AUTONOMOUS role-plugin coverage per R9.13/R11.12).

**Do NOT merge upstream into this fork** — the main repo is the canonical source for AMP/AID scripts, and any upstream changes would overwrite the fork's extensions (extra scripts, security fixes, and marketplace entries added after divergence).

### 4. Role-Plugin Repos (8 repos, NOT forks)

Each is an independent Emasoft-owned repo (not forked from 23blocks-OS):

| Repo | compatible-titles |
|------|------------------|
| `Emasoft/ai-maestro-architect-agent` | `["ARCHITECT"]` |
| `Emasoft/ai-maestro-assistant-manager-agent` | `["MANAGER"]` |
| `Emasoft/ai-maestro-chief-of-staff` | `["CHIEF-OF-STAFF"]` |
| `Emasoft/ai-maestro-integrator-agent` | `["INTEGRATOR"]` |
| `Emasoft/ai-maestro-orchestrator-agent` | `["ORCHESTRATOR"]` |
| `Emasoft/ai-maestro-programmer-agent` | `["MEMBER"]` |
| `Emasoft/ai-maestro-maintainer-agent` | `["MAINTAINER"]` |
| `Emasoft/ai-maestro-autonomous-agent` | `["AUTONOMOUS"]` |

All have `compatible-titles` and `compatible-clients` fields in their `.agent.toml`. No upstream sync needed.

## Critical Implementation Details

### Terminal Rendering Performance

xterm.js uses **Canvas or WebGL** for rendering. The WebGL addon significantly improves performance for high-output scenarios (e.g., large file dumps).

```typescript
// In useTerminal hook
try {
  const webglAddon = new WebglAddon()
  terminal.loadAddon(webglAddon)
} catch (e) {
  // Fallback to canvas if WebGL unavailable
}
```

**Never** read terminal content via React state. Always use xterm.js APIs (`terminal.write()`, `terminal.onData()`).

### Critical Terminal Configuration for PTY/tmux

**IMPORTANT:** The following terminal settings are critical for proper Claude Code CLI behavior:

1. **`convertEol: false`** - PTY and tmux handle line endings correctly. Setting this to `true` causes character duplication and incorrect line breaks because xterm.js will convert `\n` to `\r\n`, but the PTY has already handled this.

2. **Alternate Screen Buffer Support** - Claude Code (like vim, less, etc.) uses tmux's alternate screen buffer. This means:
   - When Claude is active, it uses a separate screen that doesn't mix with your shell history
   - Scrollback must be captured from tmux's buffer, not just xterm.js's buffer
   - The `windowOptions: { setWinLines: true }` setting enables proper alternate buffer support

3. **Scrollback Capture Strategy** - On initial connection, capture both normal and alternate screen content:
   ```bash
   # Try to capture full history (50000 lines)
   tmux capture-pane -t <session> -p -S -50000 -e -1
   # Fallback to visible content only
   tmux capture-pane -t <session> -p
   ```

**Common Issues and Fixes:**

- **Every character creates a new line**: `convertEol` was set to `true` - must be `false` for PTY connections
- **Can't scroll back during Claude session**: Claude Code uses alternate screen buffer - use Shift+PageUp/Down to scroll xterm.js buffer, or tmux copy mode (Ctrl-b [) to access tmux's scrollback
- **Lost history after switching agents**: History capture timeout was too short or tmux session not fully initialized - increased timeout to 150ms

### WebSocket Reconnection Strategy

```typescript
const reconnect = {
  maxAttempts: 5,
  backoff: [100, 500, 1000, 2000, 5000], // Exponential backoff
  strategy: 'exponential'
}
```

After 5 failed reconnection attempts, show error to user. Do NOT retry indefinitely (would waste resources if tmux session truly ended).

### Session Naming Constraints

tmux session names are limited to: `^[a-zA-Z0-9_@.-]+$`

The extended character set (`@` and `.`) supports `agentId@hostId` format used for multi-host agent addressing. **Enforce this** in any UI that creates sessions (Phase 2+). Invalid characters will cause `tmux attach` to fail silently.

### Network Security Model

**Dual-bind with IP filter (v0.27.2+):**

The server binds to `::` (all interfaces, dual-stack IPv4+IPv6) when Tailscale is detected, but a TCP-level connection filter (`server.mjs:isAllowedSource()`) drops connections from non-allowed IPs before any HTTP/WebSocket processing:

| Source | Allowed | Why |
|--------|---------|-----|
| `127.0.0.1`, `::1` | Yes | Localhost |
| `100.64.0.0/10` (Tailscale CGNAT) | Yes | Tailscale VPN IPv4 |
| `fd7a:115c:a1e0:*` (Tailscale ULA) | Yes | Tailscale VPN IPv6 |
| `192.168.x.x` (LAN) | **No** | Dropped at TCP level |
| Any other IP | **No** | Dropped at TCP level |

Without Tailscale installed, the server falls back to `127.0.0.1`-only binding (pure localhost).

**Tailscale is required for any remote access.** The `isAllowedSource()` function in `server.mjs` is the security gate. When modifying it, only allow Tailscale CGNAT (`100.64.0.0/10`) and Tailscale ULA (`fd7a:115c:a1e0::/48`) ranges — never allow LAN or public IPs.

**Known limitations and behaviour notes:**
- **Human user authentication via governance password** — first-run setup via `POST /api/auth/setup-init` + `/setup-verify`; session cookies (`aim_session`) issued after login (see `lib/agent-auth.ts` and `docs_dev/2026-04-02-maestro-auth-design.md`). The old "SF-058 bypass" has been CLOSED — no auth headers AND no session cookie → request is rejected.
- **No CORS/CSRF protection yet** — all same-origin by design; reverse-proxy or cross-origin deployments need additional middleware.
- **MagicDNS does not work on iOS** — iPad/iPhone must use raw Tailscale IPv4 (e.g., `http://<tailscale-ip>:23000`), not `*.ts.net` hostnames. Run `tailscale ip -4` on the host to find the IP.
- **Tailscale IPv6 not routable from same host** — macOS Tailscale app doesn't loopback IPv6; works from remote devices but untested on iPad.
- **`tailscale serve` is NOT used** — it breaks Next.js static file serving; direct bind with IP filter is used instead.

**Key files:**
- `server.mjs:92-122` — Tailscale IP detection + `isAllowedSource()` filter
- `server.mjs:1383-1389` — TCP connection filter on `::` bind (inside `needsIpFilter` block)
- `lib/agent-auth.ts` — Agent auth bridge (current non-auth bypass for local development; confirm against active code before relying on specific line numbers)
- `docs_dev/2026-04-02-maestro-auth-design.md` — Full maestro auth design for Phase 2
- `docs_dev/2026-04-02-remote-host-deep-audit.md` — Deep security audit of all remote access paths

## Common Gotchas

### 0. Agent API Response Nesting — ALWAYS use `.agent.field`

**CRITICAL:** `GET /api/agents/{id}` returns `{ agent: { id, name, role, governanceTitle, ... } }` — the data is nested under `.agent`. NEVER read fields directly from the response object.

```typescript
// ✅ CORRECT
const data = await res.json()
const title = data.agent?.governanceTitle
const workDir = data.agent?.workingDirectory

// ❌ WRONG — silently returns undefined, causes fallback to defaults
const title = data?.governanceTitle  // ALWAYS undefined!
```

This caused a critical bug where `governanceTitle` was always null, making title changes appear to fail silently (the server saved the title correctly, but the UI never read it back).

### 1. Terminal Not Fitting Container

```typescript
// After terminal.open(container), ALWAYS call:
fitAddon.fit()

// And on window resize:
window.addEventListener('resize', () => fitAddon.fit())
```

Without this, terminal dimensions won't match the container, causing ugly scrollbars.

### 2. xterm dimension gotcha — `display: none` returns 0×0

**Future relevance only.** AI Maestro currently renders only the active
agent (see "Single-Active-Agent Rendering" earlier). This gotcha matters
the day someone implements the multi-agent mount design — at which
point inactive terminals MUST use `visibility: hidden` rather than
`display: none`:

- `display: none` removes element from layout → `getBoundingClientRect()`
  returns width/height = 0 → xterm initializes with minimum columns (2)
- `visibility: hidden` keeps element in layout → correct dimensions
- Pair with `pointerEvents: none` to prevent hidden tabs from stealing
  mouse events while keeping the layout intact

If you find yourself writing this pattern, also re-read the
"Single-Active-Agent Rendering" section — the rest of the codebase
(WebSocket lifecycle, init effects with empty deps) assumes single-mount
semantics, and a switch to mount-all needs coordinated changes.

### 3. WebSocket Lifecycle vs React Lifecycle

```typescript
useEffect(() => {
  const ws = new WebSocket(url)
  // ... setup handlers ...

  return () => {
    ws.close()  // CRITICAL: Clean up on unmount
  }
}, []) // Empty deps with tab architecture - WebSocket persists across visibility changes
```

**Tab-based architecture change (v0.3.0+):** WebSocket connections are no longer recreated on agent switch. They're created once on mount and persist until component unmounts (when agent is removed from the list).

### 4. tmux Session Name Parsing

`tmux list-sessions` output format:
```
session-name: 1 windows (created Tue Jan 10 14:23:45 2025)
```

Parsing must handle:
- Session names with hyphens/underscores
- Timestamps in various formats (locale-dependent)
- Multiple windows (number can be > 9)

Use robust regex: `/^([a-zA-Z0-9_@.-]+):/`

### 5. xterm.js Addon Loading Order

```typescript
terminal.loadAddon(fitAddon)       // 1. Load addons first
terminal.loadAddon(webLinksAddon)
terminal.open(container)           // 2. Then open
fitAddon.fit()                     // 3. Then fit
```

Wrong order causes crashes or non-functional addons.

## Environment Variables

All optional, with sensible defaults:

```bash
PORT=23000                           # Server port (default 23000, set in PM2 config)
NODE_ENV=development|production      # Next.js environment
HOSTNAME=127.0.0.1                   # Bind address (default 127.0.0.1; auto-upgraded to :: when Tailscale detected)
WS_RECONNECT_DELAY=3000              # WebSocket reconnect delay (ms)
WS_MAX_RECONNECT_ATTEMPTS=5          # Max reconnection attempts
TERMINAL_FONT_SIZE=14                # xterm.js font size
TERMINAL_SCROLLBACK=10000            # Terminal scrollback buffer
```

Set via `.env.local` (gitignored). Never commit `.env.local`.

## Server Modes

AI Maestro supports two server modes controlled by the `MAESTRO_MODE` environment variable:

### Full Mode (default)
```bash
yarn dev        # Development with hot reload
yarn start      # Production
```
- Uses Next.js for both UI pages and API routes
- All features available: dashboard, terminal WebSockets, API endpoints
- Startup: ~5s, Memory: ~300MB

### Headless Mode
```bash
yarn headless        # Development
yarn headless:prod   # Production
```
- API-only mode — no Next.js, no UI pages
- All ~100 API endpoints served via standalone HTTP router (`services/headless-router.ts`)
- WebSocket connections (terminal, AMP, status, companion) work identically
- Uses `tsx` for TypeScript support (resolves `@/*` paths via tsconfig.json)
- Startup: ~1s, Memory: ~100MB
- Ideal for worker nodes that only need the API surface

**Architecture:**
- `server.mjs` branches on `MAESTRO_MODE` at startup
- Full mode: `node server.mjs` → Next.js `app.prepare()` → `handle(req, res)`
- Headless mode: `tsx server.mjs` → `createHeadlessRouter()` → `router.handle(req, res)`
- All WebSocket servers, PTY handling, startup tasks, and graceful shutdown are shared between modes
- The `/api/internal/pty-sessions` endpoint is served directly from `server.mjs` in both modes

## Testing the Application

**Manual testing workflow:**

1. Start the dashboard: `npm run dev`
2. Create test tmux sessions:
   ```bash
   tmux new-session -s test1 -d
   tmux send-keys -t test1 'claude' C-m
   tmux new-session -s test2 -d
   tmux send-keys -t test2 'claude' C-m
   ```
3. Verify auto-discovery: Sessions appear in sidebar
4. Click sessions: Terminal content loads
5. Type in terminal: Input reaches Claude
6. Kill session: `tmux kill-session -t test1`
7. Verify: Session removed after refresh

### AMP Messaging Test Suites

Two test scripts exist for validating the Agent Messaging Protocol:

```bash
# Local routing tests (single host)
# Tests: health, registration, internal→internal, external polling, federation, acknowledgment
./scripts/test-amp-routing.sh

# Cross-host mesh tests (multi-host via Tailscale)
# Tests: host health, agent registration on each host, cross-host delivery, replies, inbox counts
./scripts/test-amp-cross-host.sh              # Auto-detect hosts from ~/.aimaestro/hosts.json
./scripts/test-amp-cross-host.sh --local-only  # Only test local→remote
./scripts/test-amp-cross-host.sh --skip-inbox  # Skip inbox verification
```

**Prerequisites:** AI Maestro running on localhost:23000, jq installed, AMP scripts installed (`./install-messaging.sh -y`).

### UI Scenario Tests

Browser-based UI scenario tests that verify end-to-end workflows through Chrome DevTools Protocol (CDP).

**Rules & Format:** `tests/scenarios/SCENARIOS_TESTS_RULES.md` — 12 mandatory rules: SAFE-SETUP, 0-IMPACT, STATE-WIPE, FIX-AS-YOU-GO, TRACK-AND-REPORT, STICK-TO-UI, CHROME-TOOL CDP, REPORT-FORMAT, PHOTOSTORY, 11th-HOUR analysis, SUDO-MODE.

> **Canonical vs loaded copy:** the rules file is git-tracked at `tests/scenarios/SCENARIOS_TESTS_RULES.md`. The Claude Code harness also auto-loads `.claude/rules/SCENARIOS_TESTS_RULES.md` on every session start, but that path is a **symlink** to the tracked file so the two CAN NOT drift. When updating the rules, edit only the tracked file; the symlink picks up changes automatically.

**Scenarios:**

Currently 24 scenarios live in `tests/scenarios/SCEN-NNN_*.scen.md` (SCEN-001 through SCEN-024). They are git-tracked. Reports and screenshots are gitignored (session-local test artifacts).

**Running a scenario — ALWAYS use the `run-scenario-test` skill.** Do NOT drive scenarios from the main conversation. The skill is installed at `~/.claude/skills/run-scenario-test/` and uses `context: fork`, `model: opus`, `agent: general-purpose` so a full ~150-step UI walkthrough runs in an isolated subagent context and returns only a 2-line summary to the orchestrator. Trigger phrases: "run scenario 16", "execute SCEN-018", "run the maintainer scenario", "rerun 1 and 19". For parallel runs of multiple scenarios, the orchestrator triggers the skill multiple times in the same turn — one forked agent per scenario.

The forked agent reads the scenario file, follows `SCENARIOS_TESTS_RULES.md`, drives the dashboard via Chrome DevTools MCP, applies Rule 4 fix-as-you-go for any bug it finds, writes its report to `tests/scenarios/reports/`, writes the 11th-HOUR proposals to `tests/scenarios/reports/scenario_proposed-improvements_<NNN>_<timestamp>.md`, and returns the 2-line summary.

**Prerequisites:** AI Maestro server running, Chrome browser open with DevTools accessible, governance password set. Any per-scenario prereqs (`which codex`, fake GitHub repos, etc.) are listed in the scenario's frontmatter.

### Element Management Service

All plugin/element/agent-property mutations go through `services/element-management-service.ts`. This is the centralized gateway — no other code may directly write to `enabledPlugins`, call `claude plugin` CLI, or delete element files.

**Key functions:**
- `ChangeTitle(agentId, newTitle)` — 23-gate pipeline for governance title lifecycle
- `ChangePlugin(agentId, desired)` — 13-gate pipeline for plugin install/uninstall/enable/disable
- `ChangeSkill`, `ChangeAgentDef`, `ChangeCommand`, `ChangeRule`, `ChangeOutputStyle`, `ChangeMCP`, `ChangeLSP`, `ChangeHook` — Element-specific pipelines
- `ChangeTeam(agentId, desired)` — Team membership with auto-title transitions
- `ChangeClient(agentId, newClient)` — Client change with full plugin re-emission (see R18 below)
- `ChangeName`, `ChangeFolder`, `ChangeAvatar`, `ChangeCLIArgs` — Agent property pipelines

The PATCH `/api/agents/{id}` route is a router that dispatches to the appropriate Change* function based on which fields are in the body.

### ChangeClient — Plugin Continuity (R18)

Changing an agent's client (e.g. `claude` → `codex`) is **NEVER** a simple field update. An agent's identity is defined by its installed plugins (role-plugin, core `ai-maestro-plugin`, optional user plugins), so `ChangeClient` **MUST** re-emit every installed plugin in the new client's format before touching the agent directory. R18 makes this mandatory — see `docs/GOVERNANCE-RULES.md`.

**The pipeline:**

1. **G04: Snapshot** — scan the agent's working directory via `scanAgentLocalConfig()` to get the full list of installed plugins (role-plugin + normal plugins, enabled and disabled). R17 safety net: `ai-maestro-plugin` is always added if missing from the scan.
2. **G05: Resolve conversion plan** — for each plugin, resolve a source in the **strict priority order (R18.3d)**:
   1. **Client-native plugin cache** (`~/.claude/plugins/cache/`, `~/.codex/plugins/cache/`, `~/.gemini/plugins/`, `~/.opencode/plugins/`, `~/.kiro/plugins/`) — authoritative, no conversion needed
   2. **Local role-plugins marketplace** (`~/agents/role-plugins/<name>/`) — use only if `compatible-clients` in `.agent.toml` includes the target client
   3. **Previously emitted custom-plugins** (`~/agents/custom-plugins/<client>/<name>/` or `<name>-<client>/`)
   4. **Emit from existing Universal IR** via `emitForClient(name, newClient)`
   5. **Fresh conversion** via `convertAndStorePlugin(name, sourceClient, [newClient])` — absolute last resort
   - **Never** convert/emit if any native version already exists (conversion is lossy).
   - **For Claude target specifically:** if no canonical Claude source is found (step 1 or 2), the operation aborts. X→Claude lossy conversion is forbidden (R18.3b).
   - If any plugin cannot be resolved → **abort before any uninstall** (no partial state).
3. **G06: Uninstall old-client plugins** — using the old client's adapter, remove all old-client plugin files. For Claude, a belt-and-braces `settings.local.json` strip ensures the key is removed even if the CLI uninstall fails silently.
4. **G07: Install new-client plugins** — using the new client's adapter, install the converted plugins into the agent directory. For Claude, a belt-and-braces `settings.local.json` write-back ensures the key is present even if the CLI install fails silently.
5. **G08: Update registry** — write `program: newClient` to the agent registry.
6. **G09: Mark restart needed** — the client binary must be relaunched.

**Critical invariants:**
- **Prefer native over converted (R18.3d)**: if a native version of the plugin exists for the target client (from GitHub marketplace, from Haephestos, or from user install), it is ALWAYS used. Conversion only happens when no native version exists anywhere.
- **Never X→Claude lossy (R18.3b)**: going to Claude requires the canonical Claude source. If it's missing, the operation refuses.
- **Plugins are never uninstalled without their replacement already being ready** (R18.4).
- The core `ai-maestro-plugin` (R17) is subject to the same conversion — it is treated as "just another plugin" by the pipeline, but R17 safety net guarantees it's always in the snapshot.
- Role-plugins (quad-match `.agent.toml`) preserve their name — no `-<client>` suffix. Their `.agent.toml` `compatible-clients` field is updated on conversion.
- If any plugin fails to convert, the entire `ChangeClient` operation aborts — no partial state.
- The agent's governance title remains unchanged — the role-plugin is converted (or reused if already compatible), not reassigned.

**Files:**
- `services/element-management-service.ts` — `ChangeClient()` pipeline
- `services/plugin-storage-service.ts` — `convertAndStorePlugin()`, `emitForClient()`, `getUniversalIR()`
- `lib/client-plugin-adapters/` — per-client adapters for install/uninstall
- `services/agent-local-config-service.ts` — `scanAgentLocalConfig()` for plugin enumeration

## Documentation References

- **[README.md](./README.md)** - Project overview, quick start, architecture
- **[docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)** - Installation prerequisites
- **[docs/OPERATIONS-GUIDE.md](./docs/OPERATIONS-GUIDE.md)** - Agent management, troubleshooting
- **[docs/CEREBELLUM.md](./docs/CEREBELLUM.md)** - Cerebellum subsystem architecture, voice pipeline, TTS providers
- **[docs/GOVERNANCE-RULES.md](./docs/GOVERNANCE-RULES.md)** - Team governance rules R1-R20 (semver v3.7.0+): titles, teams, messaging, composition, role boundaries, resilience, written orders, core plugin enforcement, client conversion (R18), marketplace governance (R20)
- **[docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md](./docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md)** - Per-version verdict for Claude Code 2.1.113-2.1.132 changelog entries; lists repo-by-repo follow-up for items that affect role-plugins / ai-maestro-plugin separately
- **[docs/API-CHANGES.md](./docs/API-CHANGES.md)** - Every API / governance surface change since the `governance-rules` branch was last synced. Plugins that fetch raw markdown from the fork should treat this as the change-log between branches

Refer to these when users ask about setup or usage.

## Cross-Client Conversion Reference Repos

The skill/plugin conversion feature is based on code from these two open-source repos:

- **https://github.com/TokenRollAI/acplugin** — Converts Claude Code plugins to Codex, OpenCode, and Cursor formats. Handles skills, agents, commands, hooks, MCP, instructions. TypeScript, MIT license.
- **https://github.com/sustinbebustin/crucible** — Bidirectional converter for 7 AI coding harnesses (Claude, Codex, OpenCode, Cursor, Gemini, GitHub Copilot, Kiro). Handles skills and agent configs with format-specific output (TOML for Codex, JSON for Kiro, markdown-yaml for the rest). TypeScript, MIT license.

The best features from both should be combined into `services/cross-client-skill-service.ts`. Prior analysis: `docs_dev/2026-03-31-crucible-integration-analysis.md`.

Additionally, **https://github.com/REPOZY/Hookbridge** — Universal hook compiler from YAML to Claude Code and Codex native formats. Handles the hook format differences (26 Claude events vs 5 Codex events, 4 hook types vs 1). Provides loss reports and shim mechanism for approximated features. Our `UniversalPluginIR` extends this pattern to all component types.

### Model Mapping Reference (2026-05)

Cross-client model conversion is in `lib/converter/rewrite/model.ts`.

**Family-based, version-proof.** Claude ships frontier models faster than a
static table can track — Opus went 4.6 → 4.7 → 4.8 inside one month (Claude
Code 2.1.142 → 2.1.154, Opus 4.8 GA on 2026-05-28). So the **Claude → X**
direction is keyed by *family alias* (`opus`/`sonnet`/`haiku`) and any concrete
id is normalized to its family before lookup via `claudeFamily()`:
`claude-opus-4-8`, the 1M variant `claude-opus-4-8[1m]`, and a hypothetical
`claude-opus-5` all collapse to `opus`. New Claude releases need **no edit** to
the table. The reverse (**X → Claude**) emits the family *alias*, never a pinned
version, so a converted agent always resolves to the current Claude model.

**Claude → Codex** (source: https://developers.openai.com/codex/models):

| Claude family (any version, incl. `[1m]`) | Codex Model | Notes |
|-------------|-------------|-------|
| `opus` | `gpt-5.4` | Flagship frontier model |
| `sonnet` | `gpt-5.3-codex` | Industry-leading coding model |
| `haiku` | `gpt-5.4-mini` | Fast, efficient for subagents |

**Codex → Claude** (reverse — emits the alias, which tracks the latest model):

| Codex Model | Claude alias |
|-------------|-------------|
| `gpt-5.4` | `opus` |
| `gpt-5.4-mini` | `haiku` |
| `gpt-5.3-codex` | `sonnet` |
| `gpt-5.3-codex-spark` | `sonnet` |
| `gpt-5.2` | `sonnet` |
| `o3` | `opus` |
| `o3-mini` | `sonnet` |

**Claude → Gemini**:

| Claude family | Gemini Model |
|-------------|-------------|
| `opus` | gemini-2-pro |
| `sonnet` | gemini-2-flash |
| `haiku` | gemini-3-flash |

Tests: `tests/unit/converter-model-mapping.test.ts` (14 cases incl. Opus 4.8 `[1m]`, future `claude-opus-5`, round-trip stability).

### Universal Plugin IR Architecture

Converted plugins use a universal intermediate representation stored at `~/agents/custom-plugins/.abstract/<name>/plugin-universal-ir.yaml`. This extends the Hookbridge pattern to all 16 component types (hooks, skills, agents, commands, MCP, LSP, output-styles, instructions, executables, apps, user-config, channels, resources, extensions, settings, interface).

Key files:
- `lib/converter/universal-ir.ts` — UniversalPluginIR types + bidirectional converters (ProjectIR ↔ UniversalPluginIR)
- `services/plugin-storage-service.ts` — `convertAndStorePlugin()`, `emitForClient()`, `getUniversalIR()`
- `lib/client-plugin-adapters/` — Per-client adapters (claude, codex, element-based for gemini/opencode/kiro)
- `lib/converter/emitters/shared.ts` — `transformPluginRootPaths()`, `scanMCPResourceFiles()`, `PLATFORM_PATHS`

## Roadmap Context

**Shipped (v0.29+):** Agent auto-discovery + creation, team governance (R1-R20), Groups, role-plugin marketplace, AMP messaging, kanban boards, agent profile panel, settings page, cross-client conversion (Claude/Codex/Gemini/OpenCode/Kiro/GitHub Copilot), Tailscale remote access with IP filter, Agent Identity (AID / Ed25519 + WebAuthn), sudo-mode for strict routes, IBCT, element management pipelines (ChangeTitle, ChangePlugin, ChangeClient, ChangeTeam, etc.).

**Planned:** Human user authentication (login page + session cookies), CORS/CSRF protection, remote SSH sessions, richer collaboration flows.

When implementing features:
- Check whether the capability already exists — most roadmap items have shipped; search `services/` and `app/api/` first.
- Don't over-engineer for hypothetical future needs.
- Document which release a feature shipped in (e.g. "v0.27.3+") so drift remains traceable.

## What NOT to Do

- **Don't query tmux to get agent properties** - workingDirectory, etc. are STORED on the agent in the registry, not derived from tmux. See "Agent-First Architecture" section.
- **Don't assume agents need sessions** - Agents are the core entity; sessions are optional. An agent can exist for querying repos/docs without a tmux session.
- **Don't write directly to the registry** - Go through `element-management-service.ts` pipelines (`CreateAgent`, `ChangeName`, `DeleteAgent`, etc.) so invariants and governance gates fire.
- **Don't bypass agent auth / sudo-mode** - Strict routes require `X-Sudo-Token`; agent calls require AID proof-of-possession. Don't add "Phase 1 bypass" logic for new routes.
- **Don't store terminal history** - xterm.js manages scrollback in-memory; persistent state belongs to tmux or the session activity stream.
- **Don't use polling** - WebSocket only for terminal I/O and status updates (session activity, AMP push notifications).
- **Don't add LAN IP access paths** - Network model is localhost + Tailscale only (`isAllowedSource()`). LAN/public IPs are dropped at TCP level.
- **Don't nest interactive elements** - Causes React hydration errors (use div with onClick instead).
- **Don't hardcode category colors** - Use the hash-based dynamic color system.
- **Don't assume agents stay mounted across tab switches.** AI Maestro renders only the active agent (UI-CRIT-01 corrected 2026-05-04). Switching tears down `TerminalView` + WebSocket and remounts the new agent. Plans built on "all agents mounted" semantics need to revisit the lifecycle first.
- **If you ever implement mount-all** (visibility:hidden style) — pair `visibility: hidden` with `pointerEvents: none` and audit every WebSocket-bearing effect for unmount safety. xterm needs non-zero layout (`display: none` returns 0×0 from `getBoundingClientRect`), so use `visibility`, not `display`.

## Key Files to Understand

**Must read to understand the system:**

1. `lib/agent-registry.ts` - **File-based agent registry** (stores agents in `~/.aimaestro/agents/registry.json`) - THE source of truth for agent metadata including workingDirectory
2. `lib/agent.ts` - **In-memory Agent class** for runtime operations (database, subconscious)
3. `server.mjs` - Custom server combining HTTP and WebSocket
4. `app/page.tsx` - Main UI composition with footer (AgentList + TerminalView)
5. `components/AgentList.tsx` - Hierarchical sidebar with dynamic colors, icons, agent management
6. `components/TerminalView.tsx` - Terminal display with collapsible notes feature
7. `hooks/useWebSocket.ts` - WebSocket connection management
8. `hooks/useTerminal.ts` - xterm.js lifecycle management
9. `app/api/sessions/route.ts` - tmux session discovery logic

**Team Meeting & Kanban (v0.20.19+):**
10. `app/team-meeting/page.tsx` - Team meeting page with reducer state machine
11. `components/team-meeting/TaskKanbanBoard.tsx` - Full-screen kanban overlay with 5 columns + drag-and-drop
12. `components/team-meeting/KanbanColumn.tsx` - Single kanban column with drop zone
13. `components/team-meeting/KanbanCard.tsx` - Compact draggable task card
14. `types/task.ts` - Task types with 5 statuses: backlog, pending, in_progress, review, completed
15. `lib/task-registry.ts` - File-based CRUD for team task persistence
16. `hooks/useTasks.ts` - Task hook with tasksByStatus, optimistic updates, polling

**Groups (v0.25+):**
17. `types/group.ts` - Group type definitions (lightweight agent collections)
18. `lib/group-registry.ts` - File-based CRUD for groups
19. `services/groups-service.ts` - Groups business logic

**Session Control (v0.27.1+):**
20. `hooks/useSessionActivity.ts` - WebSocket-based activity status with notificationType
21. `hooks/useRestartQueue.ts` - Queue-based auto-restart after element changes
22. `app/api/sessions/[id]/restart/route.ts` - Restart API (exit → poll → relaunch)
23. `app/api/sessions/[id]/stop/route.ts` - Graceful stop API

**Read these in order** to understand agents and data flow.

**Key UI patterns:**
- Single-active-agent rendering — only the agent matching `activeAgentId` is mounted; switch unmounts/remounts (UI-CRIT-01 corrected 2026-05-04)
- Dynamic color assignment (hash-based, no hardcoding)
- Hierarchical grouping (3-level: category/subcategory/agent)
- Agent notes (per-agent localStorage)
- Avoid nested buttons (use div with cursor-pointer)
- xterm: if/when mounting many terminals at once, use `visibility: hidden`, never `display: none` (the latter forces 0×0 layout)
