---
name: repo-file-structure
description: "where should I put a new component or hook in this repo / what is the source repo directory layout / why is there no server directory / where do api routes live / project folder conventions app components hooks lib types services scripts"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# repo-file-structure

This is the **source repo** layout — distinct from the runtime install tree (see
[[runtime-install-tree]], which explains that a packaged install has no `~/ai-maestro/` at all).

**Directories already in use — follow existing patterns, do not duplicate:**
- `tests/` — Vitest unit tests + `tests/scenarios/` UI scenario tests (24 scenarios)
- `public/` — Static assets (avatars, favicons, logos)
- `styles/` — `transfer-animations.css` and other global CSS additions; most styling stays in
  Tailwind utilities + `app/globals.css`
- Do NOT create a `server/` directory — all server logic lives in root `server.mjs` (custom
  Next.js server)

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
    TaskKanbanBoard.tsx       - Full-screen kanban overlay (17-column ratified config) + drag-and-drop
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
  terminal.ts            - xterm.js configuration, dimensions
  websocket.ts           - Message protocol, connection states
  group.ts               - Group types (Group, GroupsFile)
  governance.ts          - GovernanceTitle, GovernanceConfig, transfer types

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

## See also

- [[runtime-install-tree]] — the runtime data tree (`~/.aimaestro/`, `~/agents/`) this source
  repo is NOT part of once packaged

## Notes and lessons learned
