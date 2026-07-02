# TRDD-c7a81642-66ca-4e4e-bef1-0bb81c184984 — Universal role-plugin-or-hibernate invariant (R9.13 extension)

**TRDD ID:** `c7a81642-66ca-4e4e-bef1-0bb81c184984`
**Filename:** `design/tasks/TRDD-c7a81642-66ca-4e4e-bef1-0bb81c184984-role-plugin-or-hibernate.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started
**Created:** 2026-04-20
**Owner:** TBD
**Priority:** P0 — a wake-able agent without a role-plugin violates R9.13 and produces undefined runtime behaviour. Today's enforcement (PG04 in ChangePlugin) covers uninstall → reinstall-default, but not the case where the default itself cannot be installed (missing from client marketplace, converter failure, etc.). This TRDD closes that gap.
**Depends on:** TRDD `eac02238` (ledger per-op entries) so hibernations triggered by this invariant are ledger-recorded.

## 1. Problem statement — verbatim user directive

> "uninstalling local scope role plugins is ok, but if we add the option to uninstall them, we must ensure that the agent fall back to a valid state or if impossible, hibernate (this is a universal rule of ai-maestro, see: all-in-one rules). this means that the agent either select another role-plugin (only among the default one, like those compatible with AUTONOMOUS for no-team or MEMBER for team) or if there is no role plugin for the client compatible with the title, then it goes hibernation, and cannot be wakeup until a compatible role plugin is assigned to it. the state of no-role-plugin can only exist while the agent is hibernated. And no agent can be woke up without first assigning a role plugin to it. agents are always assigned role-plugins when created or when imported. If agents at server load time are found to be without role plugins, must be put in hibernation. Attempt to wake them up must always cause a alert message informing the user that the agent needs a role plugin assigned from the profile panel config tab first, or it cannot be awakened."

## 2. Current-state inventory (verified)

### 2.1 ChangePlugin gates related to role-plugins

- **G08 (uninstall title-dependency check)** — `services/element-management-service.ts:2535-2549`. Today:
  ```
  if desired.action == 'uninstall' and agent has governanceTitle:
    if getRequiredPluginForTitle(title) == desired.name:
      REFUSE with "Cannot uninstall {name} — required by the agent's {title} title. Change the title first."
  ```
  **Flaw:** only blocks uninstall of the **default** plugin from `TITLE_PLUGIN_MAP`. If a second compatible plugin is installed, G08 lets you uninstall the default; PG04 then reinstalls the default (fine). If the default is the ONLY plugin and user tries to uninstall it, G08 correctly refuses. If an alternative plugin is installed and user uninstalls the default, G08 + PG04 leave the alternative intact — today's behaviour is acceptable, just not explicit.
- **PG04 (post-uninstall title-plugin repair)** — same file around line 819-858. Today:
  ```
  after uninstall, if agentHasTitle and lostRolePlugin:
    getDefaultPlugin(title) → call ChangeTitle(agentId, title) which installs default
    if ChangeTitle fails: log 'WARN' but proceed — agent is persisted with zero role-plugins
  ```
  **Flaw:** on ChangeTitle failure, agent is persisted with zero role-plugins. No hibernation, no alert, no ledger-emitted governance event. R9.13 violated silently.

### 2.2 Wake / hibernate routes

- `app/api/agents/[id]/wake/route.ts` — calls `wakeAgent()` in agents-core-service. No role-plugin precondition check.
- `app/api/agents/[id]/hibernate/route.ts` — calls `hibernateAgent()`. No symmetrical precondition.

### 2.3 TITLE_PLUGIN_MAP + PLUGIN_COMPATIBLE_TITLES

Both exist in `lib/ecosystem-constants.ts:289-310` covering all 8 predefined titles. **Currently 1:1** mapping in both directions (one default plugin per title; each plugin compatible with exactly one title). User-created custom plugins may change this (a custom MEMBER-compatible plugin already establishes a 2:1 case). The invariant must work for N:1.

### 2.4 Agent shape

`types/agent.ts` has no `roleMissing`, `rolePluginRequired`, or similar field today.

### 2.5 Server startup

`server.mjs` performs `ledger-startup.verifyAllLedgers()` + Manager-gated cascade (`blockAllTeams()` when no MANAGER). No scan for agents lacking role-plugins. Such agents, if they exist, can still be woken.

## 3. Scope — ADD vs PRESERVE vs NOT TOUCH

### ADD

**3.1 `Agent.roleMissing?: boolean`** — optional field. When `true`, the agent persists with no role-plugin because no compatible plugin could be installed. Default (absent): agent has a role-plugin installed.

**3.2 G08 extension (ChangePlugin uninstall)** — before refusing outright:
  1. Enumerate all installed plugins on the agent via `scanAgentLocalConfig(agentId)`.
  2. Remove `desired.name` from that list (simulating post-uninstall state).
  3. Filter by `PLUGIN_COMPATIBLE_TITLES[plugin].includes(agent.governanceTitle)`.
  4. If the remaining set is **non-empty**: PROCEED with uninstall, note "G08: Uninstalling non-exclusive role-plugin — fallback options remain: [...]".
  5. If the remaining set is **empty** and `TITLE_PLUGIN_MAP[title]` is installable on this client: PROCEED with uninstall, PG04 will install the default.
  6. If the remaining set is **empty** and `TITLE_PLUGIN_MAP[title]` CANNOT be installed (e.g. converter failure, plugin not present in any registered marketplace, `compatible-clients` mismatch): PROCEED with uninstall, PG04 will set `roleMissing=true` + hibernate.

**3.3 PG04 extension (post-uninstall repair)** — change the current "reinstall default or warn" logic:
  1. After uninstall, scan again. If any compatible plugin remains installed: DONE, log "PG04: compatible role-plugin `X` still installed, no repair needed".
  2. Else try to install default via `ChangeTitle(agentId, title)`.
  3. If `ChangeTitle` succeeds: DONE.
  4. If `ChangeTitle` fails (client incompatibility, converter error, missing marketplace): set `agent.roleMissing = true` via `updateAgent()`, then call `hibernateAgent(agentId, { reason: 'role_plugin_missing' })`. Emit ledger op `hibernate_role_missing` (per taxonomy in TRDD `eac02238`).
  5. Return success to the caller with a warning in `operations[]` so the UI can show it.

**3.4 Wake-route precondition** — `app/api/agents/[id]/wake/route.ts`:
  ```
  if agent.roleMissing:
    return 409 Conflict {
      error: 'role_plugin_required',
      message: 'Agent "<name>" cannot be awakened until a compatible role-plugin is assigned. Open Profile → Config tab and select a role-plugin from the list.',
      profileDeepLink: `/?agent=<id>&tab=config`,
      compatibleOptions: <list of plugin names compatible with (agent.governanceTitle, agent.client)>
    }
  ```
  Do NOT call `wakeAgent()`. The UI surfaces the alert and deep-links the user to Config tab.

**3.5 Server-startup scan** — add to `server.mjs` / `lib/startup.ts`:
  - After `verifyAllLedgers()` and MANAGER cascade, iterate all agents.
  - For each agent whose role-plugin (via `scanAgentLocalConfig(agentId).rolePlugin`) is empty:
    - If `agent.status !== 'hibernated'`: log warning, call `hibernateAgent(agentId, { reason: 'role_plugin_missing_at_boot' })`, set `roleMissing=true`, emit ledger op `hibernate_role_missing_at_boot`.
  - Summary: log "Startup scan: N agents auto-hibernated due to missing role-plugin."
  - Safety: if N > 50% of total agents, abort the scan (preserve current state) and log a CRITICAL error — something is broken at the marketplace/scan level, not at the agent level.

**3.6 Recovery affordance (Profile → Config tab)** — when viewing a `roleMissing=true` agent, the Config tab must show a prominent amber banner with:
  - Title: "This agent has no role-plugin installed."
  - Dropdown: compatible plugins for (title, client).
  - Action button: "Assign role-plugin" → triggers `ChangePlugin(install)` via pipeline, on success clears `roleMissing=true`, shows "Agent may now be awakened".
  - (UI implementation scope-covered by derived task — see §10.)

### PRESERVE

- TITLE_PLUGIN_MAP + PLUGIN_COMPATIBLE_TITLES — no schema change, no reshuffling.
- G08 refusal semantics when user tries to uninstall the only compatible plugin AND the default is unavailable (keep the "change the title first" error for that case; the user had already approved an outright refuse-state).
- All existing `ChangeTitle` pipeline gates.
- PG04's current "try default" path as a step in the new flow.
- `hibernateAgent(agentId)` / `wakeAgent(agentId)` function signatures and semantics.
- Existing `status: 'hibernated'` semantics in the registry.

### NOT TOUCH

- `types/governance.ts` governance titles.
- `services/role-plugin-service.ts` install/uninstall low-level.
- The comm-graph or sudo-mode.

## 4. Design

### 4.1 Agent.roleMissing field

```typescript
// types/agent.ts
export interface Agent {
  // ... existing fields
  roleMissing?: boolean       // true iff currently persisted with no role-plugin
}
```

- Persisted in `registry.json` only when `true`. Default: absent.
- Serialized on save, deserialized on load.
- Never set to `true` without simultaneous hibernate call.
- Cleared by the Config-tab "Assign role-plugin" flow on successful install.

### 4.2 G08 / PG04 pseudocode (new)

```typescript
// G08 (pre-mutation check, ChangePlugin uninstall)
async function g08_checkUninstallAllowed(agent, pluginName) {
  const installed = await listInstalledPlugins(agent)     // from scanAgentLocalConfig
  const afterUninstall = installed.filter(p => p !== pluginName)
  const compatible = afterUninstall.filter(p =>
    PLUGIN_COMPATIBLE_TITLES[p]?.includes(agent.governanceTitle)
  )
  if (compatible.length > 0) return OK   // fallback available
  const defaultPlugin = TITLE_PLUGIN_MAP[agent.governanceTitle]
  if (await isInstallableForClient(defaultPlugin, agent.client)) return OK   // PG04 will install default
  // Agent will be left with no role-plugin → hibernate path
  return OK_WITH_HIBERNATE_FLAG
}

// PG04 (post-mutation repair)
async function pg04_repair(agent) {
  const cfg = await scanAgentLocalConfig(agent.id)
  if (cfg.rolePlugin) return   // another compatible plugin survived
  const defaultPlugin = TITLE_PLUGIN_MAP[agent.governanceTitle]
  const titleResult = await ChangeTitle(agent.id, agent.governanceTitle, systemAuthContext)
  if (titleResult.success) return
  // Last resort: hibernate
  await updateAgent(agent.id, { roleMissing: true })
  await hibernateAgent(agent.id, { reason: 'role_plugin_missing' })
  ledger.append('hibernate_role_missing', 'agents/registry.json', diff, { authActor: 'system', authAction: 'hibernate_role_missing' })
}
```

### 4.3 Wake route

```typescript
// app/api/agents/[id]/wake/route.ts
const agent = getAgent(id)
if (agent.roleMissing) {
  return NextResponse.json({
    error: 'role_plugin_required',
    message: `Agent "${agent.label ?? agent.name}" cannot be awakened until a compatible role-plugin is assigned.`,
    profileDeepLink: `/?agent=${id}&tab=config`,
    compatibleOptions: getCompatiblePlugins(agent.governanceTitle, agent.client)
  }, { status: 409 })
}
return await wakeAgent(id, ...)  // unchanged
```

### 4.4 Startup scan

```typescript
// server.mjs (startup block)
const agents = loadAgents()
let scanned = 0, hibernated = 0
for (const agent of agents) {
  scanned++
  const cfg = await scanAgentLocalConfig(agent.id)
  if (!cfg.rolePlugin) {
    if (hibernated / agents.length > 0.5) {
      console.error('[startup] CRITICAL: >50% of agents lack role-plugin. Aborting auto-hibernate.')
      return
    }
    updateAgent(agent.id, { roleMissing: true, status: 'hibernated' })
    hibernated++
    ledger.append('hibernate_role_missing_at_boot', 'agents/registry.json', diff, {...})
  }
}
console.log(`[startup] role-plugin scan: ${hibernated}/${scanned} agents hibernated`)
```

## 5. Files to change

| File | Change |
|---|---|
| `types/agent.ts` | Add `roleMissing?: boolean` |
| `lib/agent-registry.ts` | Serialize/deserialize `roleMissing` |
| `services/element-management-service.ts` | Extend G08 + PG04 per §4.2; emit new ledger ops (depends on `eac02238`) |
| `services/agents-core-service.ts` | Add optional `reason` to `hibernateAgent()` signature (forward to ledger) |
| `app/api/agents/[id]/wake/route.ts` | Add `roleMissing` precondition |
| `server.mjs` (or new `lib/startup-role-plugin-scan.ts` imported from server.mjs) | Startup scan |
| `services/agent-local-config-service.ts` | (already returns `rolePlugin` field; no change) |
| `tests/role-plugin-invariant.test.ts` (new) | Unit + integration tests |
| `docs/GOVERNANCE-RULES.md` | Add R9.13-extension section referencing this TRDD |

Estimated LOC: ~350 added + ~40 modified.

## 6. Verification

1. **Unit tests** (`tests/role-plugin-invariant.test.ts`):
   - ChangePlugin uninstall with a fallback available → G08 permits, agent keeps rolePlugin.
   - ChangePlugin uninstall of the only plugin, default installable → PG04 installs default.
   - ChangePlugin uninstall of the only plugin, default NOT installable for client → PG04 sets `roleMissing=true` + hibernates; ledger entry `hibernate_role_missing` emitted.
   - Wake attempt on `roleMissing=true` agent → 409 with compatibleOptions list.
   - Assign role-plugin via pipeline → `roleMissing` cleared, wake permitted.
2. **Startup scan smoke** — set `roleMissing=true` on a test agent, restart server, confirm agent moved to `hibernated` and log shows scan count.
3. **Failsafe smoke** — stage a state where 80% of agents lack role-plugins, restart server, confirm scan aborts and logs CRITICAL (no mass hibernation).
4. **Scenario regression** — run SCEN-005 (blocking cascade) to confirm no regression in MANAGER-gate behaviour.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Startup scan mass-hibernates due to filesystem issue (e.g. ~/agents/ unmounted) | 50% abort threshold; CRITICAL log entry; no auto-recovery. |
| PG04 flips the agent between hibernate and awake on every uninstall | Emitted ledger event is `hibernate_role_missing` — distinct from user hibernate. Dashboard/alert surface distinguishes source. |
| User installs a 2nd compatible plugin, then uninstalls the 1st, then gets confused why agent is still healthy | UI in MarketplaceManager shows "Compatible — multiple options" badge to clarify. |
| Wake refused but user has no path to recover | Recovery affordance in Config tab (§3.6) — a derived task covers UI work. |
| `roleMissing` registry field drift from ledger | Subconscious self-change tracker (TRDD `7123d51a`) scans for drift. Belt-and-braces. |

## 8. Out of scope (each becomes a derived task — see §10)

- UI affordance on Profile → Config tab when `roleMissing=true` (banner + dropdown + Assign button).
- Startup-scan dashboard surface — a banner on Settings → Diagnostics showing "N agents auto-hibernated at last boot (reason: missing role-plugin)".
- Pre-deploy audit of Emasoft's machine — verify NO existing agents already lack role-plugins (otherwise first-boot mass-hibernation is a surprise).
- MarketplaceManager "Compatible — multiple options" badge.
- Cleanup of the ambiguous phrase "Change the title first" in G08 error — now split into multiple cases, each with tailored wording.

## 9. Dependencies

- **Blocked by:** TRDD `eac02238` (ledger per-op taxonomy) — the `hibernate_role_missing` + `hibernate_role_missing_at_boot` ledger ops must be accepted by the ledger before this TRDD emits them.
- **Blocks:** proposal #21 (local-marketplace uninstall UI) — cannot safely expose uninstall in MarketplaceManager until the fallback-or-hibernate invariant is enforced.

## 10. Derived tasks (created 2026-04-20)

- `#237` Phase 0.B-derived — UI: Config-tab banner + plugin picker when `agent.roleMissing=true` (covers §3.6 recovery affordance).
- `#238` Phase 0.B-derived — Dashboard surface: Settings → Diagnostics "Startup auto-hibernations" panel.
- `#239` Phase 0.B-derived — Pre-deploy audit: scan Emasoft's live registry BEFORE deploying 0.B startup scan; flag any agents that would be mass-hibernated.
- `#240` Phase 0.B-derived — MarketplaceManager: "Compatible — multiple options" badge.

## 11. Tracked in session todo list

Todo item `#207` (this task). UUID `c7a81642-66ca-4e4e-bef1-0bb81c184984` links back.
