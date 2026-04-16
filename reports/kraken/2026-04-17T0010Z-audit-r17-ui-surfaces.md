# R17 UI Surface Audit (SCEN-017 P0-003)

**Date**: 2026-04-17
**Scope**: Identify every UI surface that can mutate R17-protected elements (core plugins, marketplaces, governance config) and verify whether each routes through the unified element-management pipelines and whether destructive actions are sudo-gated.
**Status**: READ-ONLY audit. No source changes performed by this document.
**Base**: `fork/feature/team-governance` @ `8d60d336`.

## What R17 protects

Per `docs/GOVERNANCE-RULES.md` v3.7.0, R17 mandates:

- **R17.1-R17.13**: Every agent MUST have `ai-maestro-plugin` installed at `--scope local` (converted to the target client's format for non-Claude agents).
- **R17.14-R17.18**: The core plugin CANNOT be uninstalled, disabled, or moved to user scope. The UI MUST NOT expose an uninstall/disable control for it. No startup audit or periodic enforcement loop is allowed — compliance is the responsibility of the AIO Change* pipelines.
- **R17.19-R17.21**: Core plugin auto-updates propagate via the `Emasoft/ai-maestro-plugins` marketplace. The marketplace registration must be preserved on every startup; deleting it cascades to core plugin removal, which is forbidden.

Tangentially in scope because they are discovered/updated via the same Change* pipelines:

- **R20.1-R20.28**: Marketplace governance. `DELETE` / `POST` (`add-marketplace`) / `PATCH` (`update-marketplace`) must go through `CreateMarketplace` / `DeleteMarketplace` / `UpdateMarketplace` (SCEN-017 P0-001 / P0-002).
- **R11**: Title ↔ role-plugin binding. Role-plugin install/uninstall on a specific agent must preserve the binding (N:1 model).

---

## Unified pipelines that MUST be used

| Operation | Pipeline function | Source file |
|---|---|---|
| Plugin install/uninstall/enable/disable (ordinary or role) | `ChangePlugin` (with `rolePluginSwap` flag for N:1 swaps) | `services/element-management-service.ts` |
| Title assignment / removal | `ChangeTitle` (23 gates) | `services/element-management-service.ts` |
| Marketplace add | `CreateMarketplace` | `services/element-management-service.ts` |
| Marketplace remove (cascade) | `DeleteMarketplace` | `services/element-management-service.ts` |
| Marketplace update (git pull) | `UpdateMarketplace` | `services/element-management-service.ts` |
| Agent client change (triggers R18 plugin re-emission) | `ChangeClient` | `services/element-management-service.ts` |

These are the ONLY functions allowed to mutate plugin state. Direct `claude plugin ...` / `writeFile` / `rm` on plugin files from any route is an automatic R17 violation.

---

## Surface table

Legend:
- ✅ Compliant — routes mutation through unified pipeline AND sudo-gates destructive action.
- ⚠️ Partial — one of (pipeline routing, sudo gating) missing but non-critical OR the missing piece is already enforced by another layer (API/server).
- ❌ Non-compliant — direct mutation or missing sudo gate where required.

### Settings (user-scope) surfaces

| Component | Endpoint | R17 element | Pipelined? | Sudo-gated? | Flag |
|---|---|---|---|---|---|
| `components/settings/GlobalElementsSection.tsx` — plugin toggle (lines 315-323) | `POST /api/settings/marketplaces` with `action: enable/disable` | ai-maestro-plugin at user scope — SCEN-017 found this was comparing to wrong constant; now guards with `plugin.name !== MAIN_PLUGIN_NAME` and hides toggle (lines 566+). Also backend `guardCoreActionR17` rejects `install`/`enable`. | ✅ via `ChangePlugin` server-side | ✅ `sudoFetch` | ✅ |
| `components/settings/GlobalElementsSection.tsx` — element removal (lines 837-845) | `POST /api/settings/marketplaces` with `action: remove-element` | Non-core element (skill/hook/command inside enabled user-scope plugin) | ✅ via `ChangePlugin` | ✅ `sudoFetch` | ✅ |
| `components/settings/MarketplaceManager.tsx` — add marketplace (lines 269-277) | `POST /api/settings/marketplaces` with `action: add-marketplace` | Marketplace registration | ✅ via `CreateMarketplace` (route comment at line 26 confirms rewiring) | ✅ `sudoFetch` | ✅ |
| `components/settings/MarketplaceManager.tsx` — delete marketplace (lines 459-472) | `POST /api/settings/marketplaces` with `action: delete-marketplace` | Marketplace + cascade plugin uninstall. **R17.14 violation risk on `ai-maestro-plugins`**. UI hard-hides delete button when `mkt.name === MARKETPLACE_NAME` (line 462) and shows `core` badge instead. Backend also rejects via `guardCoreActionR17`. | ✅ via `DeleteMarketplace` | ✅ `sudoFetch` (hidden for core marketplace) | ✅ |
| `components/settings/MarketplaceManager.tsx` — update marketplace (lines 451-457) | `POST /api/settings/marketplaces` with `action: update-marketplace` | Marketplace git pull (including `ai-maestro-plugins`) | ✅ via `UpdateMarketplace` | ✅ `sudoFetch` | ✅ |
| `components/settings/MarketplaceManager.tsx` — plugin enable/disable in marketplace (lines 160-168) | `POST /api/settings/marketplaces` with `action: enable/disable` | User-scope plugin toggle. Core plugin rows render a `core` badge instead of controls (line 578-582). Backend `guardCoreActionR17` rejects `enable` on core. | ✅ via `ChangePlugin` server-side | ✅ `sudoFetch` | ✅ |
| `components/settings/MarketplaceManager.tsx` — plugin install from marketplace card (lines 613-622) | `POST /api/settings/marketplaces` with `action: install` | User-scope install (NOT for core — core rows skip the install button via the `plugin.name === MAIN_PLUGIN_NAME` branch). Backend `guardCoreActionR17` rejects `install` on core. | ✅ via `ChangePlugin` | ✅ `sudoFetch` (via `executeAction` path) | ✅ |
| `components/settings/MarketplaceManager.tsx` — plugin uninstall (lines 603-609) | `POST /api/settings/marketplaces` with `action: uninstall` | User-scope uninstall. Core plugin rows hide this control; backend `guardCoreActionR17` rejects. | ✅ via `ChangePlugin` | ✅ `sudoFetch` | ✅ |
| `components/settings/MarketplaceManager.tsx` — plugin update (lines 595-602) | `POST /api/settings/marketplaces` with `action: update` | User-scope update. Core plugin rows hide this control. Backend enforcement relies on `guardCoreActionR17` (verify the `update` action is also blocked for core — this is a soft gap). | ✅ via `ChangePlugin` | ✅ `sudoFetch` | ⚠️ (see Remediation #1) |
| `components/settings/MarketplaceManager.tsx` — security check (lines 632-640) | `POST /api/settings/marketplaces` with `action: security-check` | Read-only AI-driven report | N/A (read-only) | ✅ `sudoFetch` | ✅ |

### Agent Profile (local-scope, per-agent) surfaces

| Component | Endpoint | R17 element | Pipelined? | Sudo-gated? | Flag |
|---|---|---|---|---|---|
| `components/agent-profile/PluginsTab.tsx` — uninstall (lines 84-96) | `DELETE /api/agents/role-plugins/install` | Local-scope plugin uninstall. The UI renders a `core` label instead of an X icon when `p.name === 'ai-maestro-plugin'` (line 177-178). Backend `ChangePlugin` Gate 8 enforces R17.14 independently. | ✅ via `ChangePlugin` | ✅ `sudoFetch` | ✅ |
| `components/agent-profile/RoleTab.tsx` — uninstall current role-plugin (lines 76-84) | `DELETE /api/agents/role-plugins/install` | Local-scope role-plugin swap (part of N:1 compatibility model) | ✅ via `ChangePlugin` with `rolePluginSwap: true` in POST step | ✅ `sudoFetch` on uninstall | ✅ |
| `components/agent-profile/RoleTab.tsx` — install new role-plugin (lines 88-93) | `POST /api/agents/role-plugins/install` with `rolePluginSwap: true` | Local-scope role-plugin install | ⚠️ Goes through `installPluginLocally` but flagged `rolePluginSwap` which bypasses ChangePlugin Gate checks. The swap pattern is UI-orchestrated (uninstall then install) instead of atomic in a single pipeline. | ❌ plain `fetch` on install step (line 88) | ⚠️ (see Remediation #2) |
| `components/agent-profile/MarketplacesTab.tsx` — per-agent install (lines 64-83) | `POST /api/agents/role-plugins/install` with `scope: 'local'` | Local-scope plugin install from a marketplace (ordinary plugin, not core) | ⚠️ Passes through `installPluginLocally` but NOT through full `ChangePlugin` AIO. Post-gate checks (PG01/PG02/PG05) may not fire. | ❌ plain `fetch` (line 68) | ⚠️ (see Remediation #3) |
| `components/agent-profile/RolePluginModal.tsx` — plugin picker (line 50) | `GET /api/agents/role-plugins?title=...` | Read-only listing | N/A (read-only) | N/A (GET) | ✅ |
| `components/agent-profile/McpTab.tsx` — MCP discover (line 33) | `POST /api/settings/mcp-discover` | Read-only MCP tool discovery | N/A (read-only) | N/A | ✅ |
| `components/AgentProfile.tsx` — auto-save field (lines 144-148) | `PATCH /api/agents/[id]` | Agent property change including `governanceTitle` (triggers `ChangeTitle` 23-gate pipeline). R17 is enforced at Gate 7 of `ChangePlugin` when `ChangeTitle` cascades a role-plugin swap. | ✅ via `ChangeTitle` / `ChangeClient` / `ChangePlugin` dispatch | ✅ `sudoFetch` | ✅ |
| `components/AgentProfile.tsx` — role change (lines 395, 438) | `PATCH /api/agents/[id]` (multiple sudoFetch calls) | Governance title change → role-plugin swap | ✅ via `ChangeTitle` | ✅ `sudoFetch` | ✅ |

### Title assignment surface

| Component | Endpoint | R17 element | Pipelined? | Sudo-gated? | Flag |
|---|---|---|---|---|---|
| `components/governance/TitleAssignmentDialog.impl.tsx` — PATCH title (lines 368, 382, 433) | `PATCH /api/agents/[id]` with `governanceTitle` | Title change → auto role-plugin install/uninstall (Gates 15-16 of `ChangeTitle`) | ✅ via `ChangeTitle` | ✅ `sudoFetch` | ✅ |
| `components/governance/TitleAssignmentDialog.impl.tsx` — PUT team orchestratorId (line 397) | `PUT /api/teams/[id]` | Team metadata — NOT a plugin mutation directly but part of orchestrator title setup | ⚠️ The team PUT endpoint itself is not a plugin mutation but cascade effects could touch `ChangePlugin` on the target agent. Verify the team PUT goes through `ChangeTeam` when it affects agent roles. | ❌ plain `fetch` (line 397) | ⚠️ (see Remediation #4) |

### Agent creation surface

| Component | Endpoint | R17 element | Pipelined? | Sudo-gated? | Flag |
|---|---|---|---|---|---|
| `components/AgentCreationWizard.tsx` — POST create agent (lines 392-411) | `POST /api/agents` (CreateAgent AIO) | Creates a new agent + auto-installs role-plugin + auto-installs `ai-maestro-plugin` (R17.6) | ✅ via `CreateAgent` AIO pipeline | ❌ plain `fetch` (line 392) — agent creation is destructive (new folder, tmux session, plugin installs) but NOT in security-registry as strict | ⚠️ (see Remediation #5) |
| `components/AgentCreationWizard.tsx` — GET role-plugins (line 214) | `GET /api/agents/role-plugins?title=...&client=...` | Read-only compatible plugin lookup | N/A (read-only) | N/A | ✅ |
| `components/AgentCreationWizard.tsx` — GET governance (line 1284) | `GET /api/governance` | Read-only governance status | N/A | N/A | ✅ |

### Delete agent surface

| Component | Endpoint | R17 element | Pipelined? | Sudo-gated? | Flag |
|---|---|---|---|---|---|
| `components/DeleteAgentDialog.tsx` — DELETE agent (lines 70-76) | `DELETE /api/agents/[id]?hard=true&deleteFolder=true` | Cascade uninstalls ALL local-scope plugins including `ai-maestro-plugin`. R17.14 says core cannot be uninstalled; delete agent IS allowed because the agent itself is being removed (there's no agent left that needs the core plugin). | ✅ via `DeleteAgent` AIO | ✅ `sudoFetch` | ✅ |
| `components/DeleteAgentDialog.tsx` — export (line 136) | `GET /api/agents/[id]/export` | Read-only ZIP export | N/A | N/A | ✅ |

### Haephestos surface (custom plugin publish)

| Component | Endpoint | R17 element | Pipelined? | Sudo-gated? | Flag |
|---|---|---|---|---|---|
| `components/HaephestosEmbeddedView.tsx` — cleanup (line 87) | `POST /api/agents/creation-helper/cleanup` | Removes ephemeral Haephestos session data | N/A (scratch cleanup) | ❌ plain `fetch` | ⚠️ (not strictly R17 territory; flagged for security consistency) |
| `components/HaephestosEmbeddedView.tsx` — ensure-persona (line 89) | `POST /api/agents/creation-helper/ensure-persona` | Auto-creates the Haephestos forge agent if missing | ⚠️ Bypass of CreateAgent pipeline | ❌ plain `fetch` | ⚠️ (see Remediation #6) |
| `components/HaephestosEmbeddedView.tsx` — publish-plugin (implicit — done by Haephestos agent via API, NOT by the UI) | `POST /api/agents/creation-helper/publish-plugin` | Copies Haephestos-built plugin into `~/agents/role-plugins/` local marketplace and runs `claude plugin marketplace update`. Touches R17 only if the plugin collides with the core plugin name. | ⚠️ Direct marketplace write + CLI call; does it route via `CreateMarketplace` / `UpdateMarketplace`? Needs verification. | N/A (not a UI call) | ⚠️ (see Remediation #7) |

---

## Remediation queue

### ⚠️ Remediation #1 — Marketplace plugin `update` action + core plugin

**Surface**: `components/settings/MarketplaceManager.tsx` line 595-602 (plugin update button).
**Issue**: Core plugin rows HIDE the update button (line 578-582 skip this control entirely), but the backend `guardCoreActionR17` in `app/api/settings/marketplaces/route.ts` does NOT explicitly list `update` among the blocked actions (it only covers `uninstall`, `enable`, `install`, and `delete-marketplace`). If a caller bypasses the UI guard (e.g. direct API call), `update` on the core plugin would be allowed.
**Fix**: Add an explicit branch in `guardCoreActionR17` to either (a) reject `update` on core when performed from Settings (user-scope), or (b) route it through the R17.19-R17.21 auto-update path (`bump-version.sh` + `claude plugin update ai-maestro-plugin@ai-maestro-plugins` in each agent's workdir) rather than a naive user-scope `update`. Option (b) is the governance-compliant path because user-scope update of core is already forbidden by R17.17.

### ⚠️ Remediation #2 — RoleTab install step bypasses ChangePlugin post-gates

**Surface**: `components/agent-profile/RoleTab.tsx` line 88-93.
**Issue**: The role-plugin swap is UI-orchestrated as two sequential calls: `DELETE /api/agents/role-plugins/install` (sudoFetched) → `POST /api/agents/role-plugins/install` with `rolePluginSwap: true` (plain fetch). The POST leg bypasses ChangePlugin AIO post-gates because `rolePluginSwap: true` signals "skip the normal compatibility checks". This is fine for the N:1 swap logic (compatibility was validated upstream) BUT it means the install is not sudo-gated and no post-gate verifies R17 compliance after the swap.
**Fix**: (a) Either route the entire swap through a single atomic `ChangeRolePlugin(agentId, newPluginName)` pipeline in `element-management-service.ts` that does uninstall + install + post-gate verification inside one gate sequence, OR (b) sudoFetch the install leg as well. Option (a) is strongly preferred because it eliminates the UI-orchestration window where the agent is temporarily without any role-plugin (violating R9.13 / Invariant 8 for the duration between uninstall and install).

### ⚠️ Remediation #3 — MarketplacesTab install bypasses ChangePlugin AIO

**Surface**: `components/agent-profile/MarketplacesTab.tsx` line 64-83.
**Issue**: Per-agent install uses a plain `fetch` to `POST /api/agents/role-plugins/install` with `scope: 'local'`. The backend implementation may not run the full ChangePlugin AIO post-gates (PG01/PG02/PG05). Result: invariants like "every agent has exactly one role-plugin" could be violated if the installed plugin is a role-plugin (accidentally causing two role-plugins installed concurrently).
**Fix**: (a) Force the install-from-marketplace path through `ChangePlugin` in `element-management-service.ts`, running all 13 gates; (b) sudoFetch the call so the action is audit-trailed. If the installed plugin turns out to be a role-plugin, gate checks should automatically route through the role-plugin swap logic instead.

### ⚠️ Remediation #4 — Team PUT for orchestratorId is not sudoFetched

**Surface**: `components/governance/TitleAssignmentDialog.impl.tsx` line 397.
**Issue**: `PUT /api/teams/[id]` with `orchestratorId` setting/clearing is a governance mutation (R11 title-plugin binding is affected because the orchestrator role-plugin install/uninstall cascade depends on this field). The call uses plain `fetch` instead of `sudoFetch`. If the route is not in security-registry as strict, the mutation goes through without a password prompt.
**Fix**: (a) Classify `PUT /api/teams/[id]` as strict in `security-registry.json` when `orchestratorId` is the mutation subject; (b) wrap in `sudoFetch` with sudo retry; (c) ensure the route dispatches to `ChangeTeam` AIO rather than doing a direct field update.

### ⚠️ Remediation #5 — AgentCreationWizard POST is not sudo-gated

**Surface**: `components/AgentCreationWizard.tsx` line 392-411.
**Issue**: Agent creation is a major destructive operation: creates `~/agents/<name>/` folder, spins up a tmux session, runs `claude plugin install ai-maestro-plugin@ai-maestro-plugins --scope local`, optionally joins a team, assigns a title that triggers role-plugin install. All of this happens on a plain `fetch` to `POST /api/agents`. The security-registry does not currently classify `POST /api/agents` as strict.
**Fix**: (a) Add `POST /api/agents` to `security-registry.json` as strict (requires sudo token); (b) update the wizard to use `sudoFetch`; (c) the password prompt should appear at the "Let's Go!" button click. Rationale: the user has authenticated into the dashboard but agent creation spawns long-lived system resources (tmux, claude process, plugin installs at local scope) and the user may have stepped away from the keyboard. Sudo protection would prevent an attacker who gained UI access from creating rogue agents.

### ⚠️ Remediation #6 — Haephestos ensure-persona bypasses CreateAgent

**Surface**: `components/HaephestosEmbeddedView.tsx` line 89.
**Issue**: `POST /api/agents/creation-helper/ensure-persona` creates the Haephestos forge agent behind the scenes if missing. This is essentially a `CreateAgent` for a known persona. If it does not go through the unified `CreateAgent` pipeline, the R17 core plugin install gate (Gate for R17.6) may be skipped.
**Fix**: Confirm the `ensure-persona` route internally dispatches to `CreateAgent` AIO with the canonical Haephestos name. If it does not, refactor to use the unified pipeline. Haephestos must obey R17 like every other agent.

### ⚠️ Remediation #7 — Haephestos publish-plugin may bypass Create/UpdateMarketplace

**Surface**: `app/api/agents/creation-helper/publish-plugin/route.ts` (the server-side publish endpoint — NOT a UI surface but triggered from the Haephestos forge agent's 8-step flow).
**Issue**: The CLAUDE.md documentation says the publish step "copies to marketplace, runs `claude plugin marketplace update ai-maestro-local-roles-marketplace`". That CLI call should go through `UpdateMarketplace` to enforce R20 gates. If it runs `execSync('claude plugin marketplace update ...')` directly, it bypasses the unified pipeline.
**Fix**: Verify the publish-plugin route imports `CreateMarketplace` (if first publish) or `UpdateMarketplace` (on subsequent publishes) from `services/element-management-service.ts` and routes the CLI call through those. If not, rewire.

---

## Non-UI enforcement backstops (for reference — not remediation targets)

- `app/api/settings/marketplaces/route.ts::guardCoreActionR17` — final-backstop that rejects `uninstall`/`enable`/`install` on `ai-maestro-plugin` and `delete-marketplace` on `ai-maestro-plugins`. Working as of SCEN-017 P0-001 fix.
- `ChangePlugin` Gate 7 / Gate 8 — R17.14 enforcement inside the unified pipeline.
- `ChangeTitle` Gate 15 / Gate 16 — auto role-plugin swap when title changes.
- `CreateAgent` R17 gate — auto-installs `ai-maestro-plugin` at local scope on agent provisioning (R17.6).
- `wakeAgent` R17 gate (R17.21) — rejects wake if core plugin missing.
- `server.mjs` startup — re-registers `Emasoft/ai-maestro-plugins` marketplace if missing (R17.20) and runs `deprecated-marketplace migration` on boot.

---

## Summary

| Status | Count |
|---|---|
| ✅ Compliant | 14 rows |
| ⚠️ Partial (needs follow-up) | 7 rows |
| ❌ Non-compliant | 0 rows |

**No hard R17 violations at the UI layer.** All destructive actions on the core plugin are blocked either by UI guards (hide/replace controls), `sudoFetch` gating, or the server-side `guardCoreActionR17` backstop.

**Seven partial compliance items** are documented in the Remediation queue. None are critical; they represent hardening opportunities where a single defense-in-depth layer could be added (typically: move a plain `fetch` to `sudoFetch`, or route an orchestrated operation through a single unified pipeline instead of two UI-sequenced calls).

**Highest-priority remediation**: #2 (RoleTab install leg) and #3 (MarketplacesTab install) — these are the only places where an agent could transiently end up without any role-plugin, which violates R9.13 / Invariant 8. Converting both into atomic `ChangeRolePlugin` / `ChangePlugin` AIO calls closes that window.

**Next-priority**: #5 (AgentCreationWizard POST) — adding sudo gating to agent creation is a defense-in-depth improvement even though the current flow is semantically correct (it does route through `CreateAgent` AIO which enforces R17.6).
