# TRDD-7123d51a-9da8-4886-a000-af6359f08e1e — Subconscious self-change tracker (registry + ledger sync)

**TRDD ID:** `7123d51a-9da8-4886-a000-af6359f08e1e`
**Filename:** `design/tasks/TRDD-7123d51a-9da8-4886-a000-af6359f08e1e-subconscious-self-change-tracker.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started
**Created:** 2026-04-20
**Owner:** TBD
**Priority:** P1 — closes the durability gap for agent-initiated config changes (Claude Code's own plugin install/uninstall / skill edits / MCP changes) that today bypass the ai-maestro API entirely.
**Depends on:** TRDD `eac02238` (ledger per-op taxonomy) — the tracker emits ledger entries of the new `op` values.

## 1. Problem statement — verbatim user directive

> "subconscious agents now that are not busy with consolidating memory, must now help the system silently updating the registry and the ledger with the changes that happens to the agents settings and configurations. those changes happening via the UI or the ai-maestro api can be recorded directly without the need of subconscious agents, but the changes that the agents do themselves to themselves (because each agent can install/uninstall plugins, skills, hooks, mcp, output styles, rules, commands, etc. freely after all, by its own client internal tools) must be regularly checked by the subagents heartbeat and the changes recorded in registry and in the ledger. the registry is always secondary compared to the actual configuration files, so it is nothing but a transient buffer (even the API functions must check the actual client configurations files before making changes, since they can be changed at any time), but the ledger is permanent and it must track the whole history of the changes, created and destroyed agents, converted plugins, title changes, team changes, enabled disabled plugins, marketplaces, client version updates, etc. practically every json file or toml file of the clients of the agents must be scanned for changes. Make sure the subconscious agents take care of this."

## 2. Current-state inventory (verified)

### 2.1 Subconscious state post-RAG-removal

- `lib/agent.ts::AgentSubconscious` — class is intact (start/stop/activity-state/writeStatusFile), memory timers removed per TRDD-70a521d9.
- `services/agents-subconscious-service.ts` — 74 lines; exposes `getSubconsciousStatus()` and a stub `triggerSubconsciousAction()`.
- `messageTimer` (5-min interval) — disabled by default; gate on `messagePollingEnabled=true`.
- Stagger offset based on hashed agent id to avoid thundering herd.
- `status.json` written to `~/.aimaestro/agents/<uuid>/status.json` on lifecycle events.

### 2.2 Reusable config scanner

`scanAgentLocalConfig(agentId)` in `services/agent-local-config-service.ts` (~900 lines). Returns an `AgentLocalConfig` with:

- `skills` — from `.claude/skills/*.md`
- `agents` — from `.claude/agents/*.md`
- `hooks` — from `.claude/hooks/hooks.json`
- `rules` — from `.claude/rules/*.md`
- `commands` — from `.claude/commands/*.md`
- `outputStyles` — from `.claude/output-styles/*.md`
- `mcpServers` — from `~/.claude.json` `projects[workDir].mcpServers`
- `plugins` — from `.claude/plugins/*/plugin.json`
- `rolePlugin` — from quad-match detection
- `settings` — from `.claude/settings.local.json`
- Per-plugin `.mcp.json` / `.lsp.json` / `<name>.agent.toml`

**Gap:** does NOT read:
- `~/.claude/settings.json` (user-global project settings) — some plugin enables live here.
- `.claude/keybindings.json` (if present).

### 2.3 API-side ledger emission

TRDD `eac02238` adds per-op ledger emission inside element-management-service. API-path mutations already acquire per-file locks and will emit ledger entries with `authActor: 'user' | 'agent' | 'system'` + 10-second-fresh timestamps.

The tracker's job is to catch changes that were made OUTSIDE the API — e.g. the agent's own Claude Code session ran `/plugin install foo` and modified `.claude/settings.local.json` directly.

## 3. Scope — ADD vs PRESERVE vs NOT TOUCH

### ADD

**3.1 Subconscious config-change tracker**

- New optional field in `SubconsciousConfig`: `configTrackerInterval?: number` (default: `30000` ms = 30 s).
- New method `AgentSubconscious.startConfigChangeTracker()` called during `start()`.
- New method `AgentSubconscious.stopConfigChangeTracker()` called during `stop()`.
- On each tick:
  1. Call `scanAgentLocalConfig(agentId)` → current snapshot.
  2. Compare against `lastConfigSnapshot` (stored in-memory on the AgentSubconscious instance, persisted to status.json across restarts for first-tick continuity).
  3. For each changed sub-tree (skills / plugins / hooks / etc.):
     - Compute JSON Patch diff (per-sub-tree, not the entire config).
     - Check recent ledger entries for the 4 registries: if any same-host same-path entry exists with ts < 10s ago, that change is API-originated → skip.
     - Otherwise, append a ledger entry: `op='change_<element>' (update)`, `path='agents/<uuid>/.claude/<subpath>'`, `diff=<computed patch>`, `authActor='agent'`, `authAgentId=<this agent id>`.
  4. Update `lastConfigSnapshot` to the current snapshot.
  5. Write `lastConfigScanAt` + `lastConfigChangeCount` to status.json for observability.

**3.2 Scanner extension** — `scanAgentLocalConfig()` also reads:
  - `~/.claude/settings.json` if present (add sub-tree `userGlobalSettings`).
  - `.claude/keybindings.json` if present (add sub-tree `keybindings`).

**3.3 Dedup filter implementation**

```typescript
// Loose pseudocode; real impl will sharpen the matcher
function wasRecentlyRecordedByApi(pathFragment, since10sAgo): boolean {
  const entries = ledger.getEntriesForPath('agents/registry.json')
    .slice(-50)  // only most recent
  for (const e of entries) {
    if (new Date(e.ts).getTime() < since10sAgo) continue
    if (e.signerHostId !== getSelfHostId()) continue
    if (e.authActor === 'user' || e.authActor === 'system') {
      // Check if the e.diff touches the same agent+path
      if (diffTouches(e.diff, pathFragment)) return true
    }
  }
  return false
}
```

Mis-fires of this dedup (false positive → missed tracker entry; false negative → duplicate entry) are acceptable. Duplicates don't corrupt the chain; missed entries eventually get caught by the next tick if the change persists.

**3.4 Status-file drift reporting**

Extend `status.json` with:
```json
{
  "configTracker": {
    "lastScanAt": "...",
    "intervalMs": 30000,
    "driftCountSinceStart": 0,
    "lastDriftAt": "...",
    "lastDriftPaths": ["skills/foo.md", "plugins/bar/settings"]
  }
}
```

Dashboard can render this for debugging.

**3.5 Registry reconciliation (LIMITED SCOPE)**

The user said: "registry is always secondary compared to the actual configuration files, so it is nothing but a transient buffer (even the API functions must check the actual client configurations files before making changes, since they can be changed at any time)."

This is a bigger architectural statement than what the tracker can ship. The tracker only:
- Records drift in the ledger.
- Updates `agent.rolePlugin` in the registry if scan shows a different rolePlugin than recorded (the one field the registry caches that directly derives from client config).

It does NOT re-derive every registry field on every scan — that's out of scope (see §9 derived tasks for a follow-up TRDD on full "registry-as-cache" refactor).

### PRESERVE

- All existing subconscious timers, status-file writes, activity tracking, message polling (disabled by default).
- `scanAgentLocalConfig()` existing output shape (fields added are additive; no renames).
- Ledger infrastructure — the tracker is a consumer of `ledger.append`.
- Element-management-service — the tracker never calls into it. It only reads + ledger-appends.

### NOT TOUCH

- `types/subconscious.ts` beyond adding `configTrackerInterval`.
- All existing API routes — unchanged.
- The CLI tools the agent uses inside its Claude Code session — the tracker is purely read-only on the filesystem.

## 4. Design details

### 4.1 Integration point

The agent's `Cerebellum` subsystem already owns the AgentSubconscious lifecycle. The tracker timer is a sibling to messageTimer — same lifecycle, same stagger.

```typescript
// lib/agent.ts (AgentSubconscious)
start() {
  this.writeStatusFile()
  if (this.config.messagePollingEnabled) this.startMessagePolling()
  this.startConfigChangeTracker()   // NEW
}

stop() {
  this.stopMessagePolling()
  this.stopConfigChangeTracker()    // NEW
  this.writeStatusFile()
}
```

### 4.2 Multi-host safety

When the tracker emits `authActor='agent'` entries, the `signerHostId` is `this host`. A remote host running a remote agent generates entries with THAT host's key. The ledger verify chain handles mixed-host signatures via `verifyWithCurrentOrPrevious` in `lib/key-rotation.ts`.

### 4.3 Cadence rationale

- **10s** — too frequent; ~6 scans/min × 30 agents = 180 scans/min = noticeable I/O.
- **30s (recommended)** — 2 scans/min × 30 agents = 60 scans/min. File reads are cached by OS FS cache; marginal cost.
- **60s** — acceptable, but worst-case drift-to-ledger lag is 1 minute.
- Configurable per-agent via `configTrackerInterval` so noisy agents can be dialed back.

### 4.4 First-boot snapshot

On very first `start()`, `lastConfigSnapshot` is `null`. The tracker sets it to the first scan result without emitting ledger entries (treat first scan as baseline). Subsequent ticks detect drift.

## 5. Files to change

| File | Change |
|---|---|
| `lib/agent.ts::AgentSubconscious` | Add tracker timer + start/stop methods |
| `types/subconscious.ts` | Add `configTrackerInterval` + `configTracker` status sub-shape |
| `services/agent-local-config-service.ts` | Extend scanner to include `userGlobalSettings` + `keybindings` sub-trees |
| `services/agents-subconscious-service.ts` | Expose tracker status in `getSubconsciousStatus()` |
| `lib/signed-ledger.ts` | No change (consumer only) |
| `tests/subconscious-tracker.test.ts` (new) | Unit + integration tests |
| `docs/CEREBELLUM.md` | Add section "Config change tracker" |

Estimated LOC: ~400 added + ~20 modified.

## 6. Verification

1. **Unit tests** (`tests/subconscious-tracker.test.ts`):
   - Tracker detects a plugin install done via direct filesystem mutation (not API) within 30s.
   - API-path plugin install (with 10s-fresh same-host ledger entry) is NOT double-logged.
   - First tick sets baseline without emitting ledger entries.
   - Scanner extension reads `~/.claude/settings.json` correctly; handles missing file gracefully.
2. **Integration smoke** — spin up a test agent, manually edit `.claude/skills/test.md`, wait 35s, confirm ledger entry appears with `authActor='agent'`.
3. **Performance smoke** — 30 agents × 30s cadence; measure aggregate CPU over 5 minutes. Target: < 1% on an M-class laptop.
4. **Dedup accuracy** — run an automated test that performs 10 API-path changes + 10 filesystem-direct changes back-to-back, confirm ledger contains exactly 20 entries (no duplicates, no misses).
5. **Scenario regression** — SCEN-001 + SCEN-005 pass without new failures.

## 7. Dependencies

- **Blocked by:** TRDD `eac02238` (ledger per-op taxonomy) — the tracker emits `update` or `change_*` ops. Until that TRDD ships, emit ops fall back to generic `update`.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 30s scan of 30 agents becomes I/O-bound | Configurable cadence per agent; cap concurrency; OS FS cache |
| Scanner reads while plugin installer writes mid-file (race) | Plugin installers write via temp-file+rename (atomic) — scanner either sees pre-state or post-state, not partial. Next tick catches up. |
| Ledger double-logging API + tracker | 10s fresh-same-host-entry dedup filter |
| Ledger silent-fail masks drift | Ledger-health endpoint + Diagnostics banner (derived from TRDD `eac02238` §10 §11, already task #234) |
| Snapshot persistence across server restart | First tick after restart re-sets baseline without emitting diff — known behaviour, documented |
| "Registry as cache" directive is bigger than this TRDD | Scoped: tracker only updates `rolePlugin` field. Full refactor is a follow-up TRDD (§9). |

## 9. Out of scope (each becomes a derived task — see §10)

- **Full "registry as cache" refactor.** Every API function that currently reads `registry.json` should instead `scanAgentLocalConfig()` first and reconcile. Non-trivial; deferred.
- **Subconscious per-plugin-marketplace diff.** Marketplaces live in `~/.claude.json` and aren't per-agent — the tracker ignores them. A separate "system-level" tracker is a follow-up.
- **Client-binary version tracking.** The user mentioned "client version updates" — detecting `claude --version` changes and emitting a ledger op. Not in this TRDD.
- **Remote-host subconscious.** When an agent runs on a remote host via Tailscale, each host's subconscious runs locally and emits to its own ledger. Reconciling into a unified view is a dashboard task, not a tracker task.

## 10. Derived tasks (created 2026-04-20)

- `#241` Phase 0.C-derived — Full "registry as cache" refactor TRDD (every API read path goes through scanAgentLocalConfig first, registry.json becomes a write-back cache only).
- `#242` Phase 0.C-derived — System-level tracker: marketplaces + client-binary versions + user-global settings drift.
- `#243` Phase 0.C-derived — Dashboard: tracker status surface (per-agent `driftCountSinceStart` + `lastDriftPaths` in Profile → Overview or a new Diagnostics tab).

## 11. Tracked in session todo list

Todo item `#208`. UUID `7123d51a-9da8-4886-a000-af6359f08e1e` links back.
