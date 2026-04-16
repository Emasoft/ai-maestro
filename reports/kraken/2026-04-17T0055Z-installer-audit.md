# Installer + R20 Migration Audit — 2026-04-17

**Branch:** `feature/team-governance`
**Head commit:** `b1126d96` (chore(scenarios): Phase C SCEN-001..007 alignment)
**Auditor:** kraken agent in worktree `agent-a30633a1`
**Scope:** `install-messaging.sh`, `scripts/ecosystem-config.sh`, `scripts/migrate-r20-disk-layout.sh` + cross-installer consistency with `install.sh`, `install-agent-cli.sh`, `install-doc-tools.sh`, `install-graph-tools.sh`, `install-memory-tools.sh`, `scripts/remote-install.sh`, `scripts/bump-version.sh`.

**Legend:** ✅ PASS · ⚠️ WARNING · ❌ FAIL

---

## Section 1: `install-messaging.sh`

### 1.1 Marketplace registration per R20.28 (role + custom, NOT core for Claude)

| Check | Status | Reference | Notes |
|---|---|---|---|
| Registers `ai-maestro-local-roles-marketplace` (role-plugins container) | ✅ | L865-872 | `setup_local_marketplace "$ROLES_DIR" "${LOCAL_MARKETPLACE_NAME:-ai-maestro-local-roles-marketplace}"` calls `claude plugin marketplace add "$MKT_DIR"` at L818. |
| Registers `ai-maestro-local-custom-marketplace` (custom-plugins container) | ✅ | L875-883 | Same `setup_local_marketplace` helper used with `CUSTOM_MARKETPLACE_NAME`. |
| Does NOT register a local Claude core marketplace (R20.25) | ✅ | L885-904 | Comment + code explicitly remove any legacy Claude core marketplace manifest (L895-898) and unregister stale Claude CLI entry (L899-904). Only per-client (codex/gemini/kiro/opencode) core marketplace subdirs are created. |
| Creates per-client marketplace subdirs for 4 non-Claude clients per R20.28 | ✅ | L824-863 | `create_per_client_marketplaces` iterates `codex gemini kiro opencode` for each of the 3 kinds (roles, custom, core). Creates 3×4 = 12 per-client marketplace directories with minimal `marketplace.json`. |

### 1.2 R20.25 stale core marketplace removal

| Check | Status | Reference | Notes |
|---|---|---|---|
| Removes stale `$HOME/agents/core-plugins/.claude-plugin/marketplace.json` file | ✅ | L895-898 | `if [ -f "$CORE_DIR/.claude-plugin/marketplace.json" ]; then rm -rf "$CORE_DIR/.claude-plugin"` |
| Unregisters `ai-maestro-local-core-marketplace` from Claude CLI | ✅ | L899-904 | `claude plugin marketplace list` grep + `claude plugin marketplace remove`. |
| Idempotent — running twice does not error | ✅ | L895, L901 | Both checks are conditional on existence before acting. |

### 1.3 AMP script installation to `~/.local/bin/`

| Check | Status | Reference | Notes |
|---|---|---|---|
| Copies `amp-*.sh` scripts from `$SCRIPTS_DIR` | ✅ | L567-583 | Loops `for script in "$SCRIPTS_DIR"/amp-*.sh` and `cp "$script" ~/.local/bin/` + `chmod +x`. |
| Creates `.sh`-less symlinks for convenience | ✅ | L574-578 | `ln -sf "$SCRIPT_NAME" ~/.local/bin/"$LINK_NAME"` — idempotent (uses `-f`). |
| Installs everything else in `scripts/*.sh` (aid-, agent-, graph-, memory-, docs-) | ✅ | L629-644 | Second loop copies all non-amp, non-obsolete `*.sh`. This catches `aid-*.sh` scripts **by side effect** — they are not named explicitly. |
| Removes 11 legacy old-style messaging scripts only if they carry `AI Maestro` header | ✅ | L591-617 | Safe — does not blindly delete. |

### 1.4 AID script installation

| Check | Status | Reference | Notes |
|---|---|---|---|
| AID scripts installed to `~/.local/bin/` | ✅ | L629-644 | Caught by the generic `*.sh` loop — 7 `aid-*.sh` scripts exist in branch (`aid-auth`, `aid-helper`, `aid-init`, `aid-maestro-token`, `aid-register`, `aid-status`, `aid-token`). |
| ⚠️ AID scripts NOT listed by name | ⚠️ | L923 | The verification block enumerates only `AMP_SCRIPTS=("amp-init.sh" …)` — if an `aid-*.sh` fails to install, the final verification pass does NOT flag it. Low risk (relies on generic loop) but a regression in that loop could silently drop all AID scripts. |

### 1.5 Core plugin installation via `claude plugin install`

| Check | Status | Reference | Notes |
|---|---|---|---|
| Registers `Emasoft/ai-maestro-plugins` marketplace | ✅ | L710 | `claude plugin marketplace add "$MARKETPLACE_REPO"` with fallback to the correct repo. |
| Removes deprecated `23blocks-OS/ai-maestro-plugins` marketplace | ✅ | L702-704 | Two remove calls (org/repo and full URL) — idempotent. |
| Installs `ai-maestro-plugin` with `--scope user` | ✅ | L719 | `claude plugin install "$PLUGIN_NAME" --scope user` — correct per CLAUDE.md. |
| Falls back to `claude plugin update` on duplicate install | ✅ | L722-725 | Correct fail-soft behaviour. |
| Migrates old standalone skills to `.legacy-<timestamp>` backups | ✅ | L728-745 | 7 legacy skills renamed, never deleted. |

### 1.6 Idempotency

| Check | Status | Reference | Notes |
|---|---|---|---|
| Can be run twice without duplicating entries | ✅ | Multiple | `mkdir -p`, `ln -sf`, conditional `claude plugin marketplace remove`, grep-guarded PATH exports (L664, L678). |
| Preserves user's plugins in existing marketplace manifests | ✅ | L773-785 | `setup_local_marketplace` reads existing `plugins` array via `jq` and replays it into the new manifest. |
| Migrates core IR from `custom-plugins/.abstract/` to `core-plugins/.abstract/` without loss | ✅ | L907-911 | `mv` only when source exists AND destination does not. |

### 1.7 R20 container creation (`~/agents/{role,custom,core}-plugins/`)

| Check | Status | Reference | Notes |
|---|---|---|---|
| Creates `~/agents/role-plugins/` + `.abstract/` + Claude + 4 per-client subdirs | ✅ | L815, L832, L872 | Explicit `mkdir -p`. |
| Creates `~/agents/custom-plugins/` + `.abstract/` + Claude + 4 per-client subdirs | ✅ | L815, L832, L882 | Explicit `mkdir -p`. |
| Creates `~/agents/core-plugins/` + `.abstract/` + 4 per-client subdirs (NO Claude) | ✅ | L892, L905 | `mkdir -p "$CORE_DIR/.abstract"` + `create_per_client_marketplaces "core-plugins" "core"`. |

### 1.8 Summary for `install-messaging.sh`

| Status | Count |
|---|---|
| ✅ PASS | 17 |
| ⚠️ WARNING | 1 |
| ❌ FAIL | 0 |

The installer is **structurally sound and R20-compliant**. The only warning is the optional-but-nice-to-have listing of AID scripts in the verification block.

---

## Section 2: `scripts/ecosystem-config.sh`

### 2.1 Consistency with `lib/ecosystem-constants.ts`

| Shell constant | TS equivalent | Status | Notes |
|---|---|---|---|
| `MARKETPLACE_REPO="Emasoft/ai-maestro-plugins"` | `MARKETPLACE_REPO = 'Emasoft/ai-maestro-plugins'` | ✅ | Identical. |
| `MARKETPLACE_NAME="ai-maestro-plugins"` | `MARKETPLACE_NAME = 'ai-maestro-plugins'` | ✅ | Identical. |
| `LOCAL_MARKETPLACE_NAME="ai-maestro-local-roles-marketplace"` | `LOCAL_MARKETPLACE_NAME = 'ai-maestro-local-roles-marketplace'` | ✅ | Identical. |
| `LOCAL_MARKETPLACE_DIR_NAME="role-plugins"` | `ROLE_PLUGINS_CONTAINER_DIR_NAME = 'role-plugins'` (alias `LOCAL_MARKETPLACE_DIR_NAME`) | ✅ | Same value via alias. |
| `MAIN_PLUGIN_NAME="ai-maestro-plugin"` | `MAIN_PLUGIN_NAME = 'ai-maestro-plugin'` | ✅ | Identical. |
| `AMP_PLUGIN_NAME="claude-plugin"` | `AMP_PLUGIN_NAME = 'claude-plugin'` | ✅ | Identical. |
| `AMP_PLUGIN_REPO="https://github.com/Emasoft/claude-plugin.git"` | Same | ✅ | Identical. |
| `AID_PLUGIN_NAME="agent-identity"` | Same | ✅ | Identical. |
| `AID_PLUGIN_REPO="https://github.com/Emasoft/agent-identity.git"` | Same | ✅ | Identical. |
| `ROLE_PLUGIN_*` (8 entries) | Same | ✅ | All 8 role-plugin names match. |
| `AI_MAESTRO_REPO="https://github.com/Emasoft/ai-maestro"` | `AI_MAESTRO_REPO = 'https://github.com/23blocks-OS/ai-maestro'` | ❌ | **MISMATCH.** TS still points to the `23blocks-OS` org; shell points to `Emasoft`. |
| `MARKETPLACE_REPO_URL` | `MARKETPLACE_REPO_URL` | ✅ | Derived identically. |

### 2.2 Fallback values in `install-messaging.sh` that are NOT defined in `ecosystem-config.sh`

| Fallback variable | Used in installer | Defined in `ecosystem-config.sh`? | Status | Notes |
|---|---|---|---|---|
| `CUSTOM_MARKETPLACE_NAME` | L879 `${CUSTOM_MARKETPLACE_NAME:-ai-maestro-local-custom-marketplace}` | ❌ Missing | ⚠️ | Works only by hardcoded fallback. |
| `CUSTOM_MARKETPLACE_DIR_NAME` | L876 `${CUSTOM_MARKETPLACE_DIR_NAME:-custom-plugins}` | ❌ Missing | ⚠️ | Works only by hardcoded fallback. |
| `CORE_PLUGINS_CONTAINER_DIR_NAME` | L891 `${CORE_PLUGINS_CONTAINER_DIR_NAME:-core-plugins}` | ❌ Missing | ⚠️ | Works only by hardcoded fallback. |
| `ABSTRACT_IR_DIR_NAME` | Not referenced by installer, but exists in TS | — | — | Informational. |
| `ROLE_PLUGINS_CONTAINER_DIR_NAME` | Not referenced (installer uses `LOCAL_MARKETPLACE_DIR_NAME`) | ❌ Missing | — | Not a functional break. |

### 2.3 Stale references to removed marketplaces

| Check | Status | Notes |
|---|---|---|
| `23blocks-OS/ai-maestro-plugins` | ✅ | Not present in `ecosystem-config.sh`. |
| `ai-maestro-local-core-marketplace` | ✅ | Not present. |
| `ai-maestro-local-agents-marketplace` (deprecated per CLAUDE.md) | ✅ | Not present. |
| `ai-maestro-local-marketplace` (deprecated) | ✅ | Not present. |
| `role-plugins` (deprecated as marketplace name) | ✅ | Not present. |

### 2.4 Summary for `scripts/ecosystem-config.sh`

| Status | Count |
|---|---|
| ✅ PASS | 16 |
| ⚠️ WARNING | 3 |
| ❌ FAIL | 1 |

The file lags behind `lib/ecosystem-constants.ts` by one migration cycle. The installer works because of hardcoded fallbacks, but the contract "shell-config is the authoritative shell mirror of the TS file" is broken on 4 constants (`CUSTOM_MARKETPLACE_NAME`, `CUSTOM_MARKETPLACE_DIR_NAME`, `CORE_PLUGINS_CONTAINER_DIR_NAME`, `ABSTRACT_IR_DIR_NAME`) plus the `AI_MAESTRO_REPO` URL divergence.

---

## Section 3: `scripts/migrate-r20-disk-layout.sh`

The task described the file as `scripts/r20-migration.sh` but the actual branch file is `scripts/migrate-r20-disk-layout.sh`. Both refer to the same R20 migration work. This audit uses the branch filename.

### 3.1 Migration to R20.28 six canonical folder patterns

R20.28 canonical layout:
1. `~/agents/role-plugins/roles-marketplace/` (Claude)
2. `~/agents/role-plugins/<client>-roles-marketplace/` (non-Claude)
3. `~/agents/custom-plugins/custom-marketplace/` (Claude)
4. `~/agents/custom-plugins/<client>-custom-marketplace/` (non-Claude)
5. `~/agents/core-plugins/<client>-core-marketplace/` (non-Claude only; no Claude core)
6. `~/agents/{role,custom,core}-plugins/.abstract/<plugin>/` (shared IR hub)

| Check | Status | Reference | Notes |
|---|---|---|---|
| Migrates legacy `custom-plugins/claude/` → `custom-plugins/custom-marketplace/` | ✅ | L134-141 | Loops every plugin dir. |
| Migrates legacy `custom-plugins/codex/` → `custom-plugins/codex-custom-marketplace/` | ✅ | L144-152 | |
| Migrates legacy `custom-plugins/marketplace-codex/` → `codex-custom-marketplace/` | ✅ | L154-176 | Also moves `marketplace.json` + `.claude-plugin/`. |
| Migrates legacy `custom-plugins/marketplace-gemini/` → `gemini-custom-marketplace/` | ✅ | L178-191 | |
| Migrates `marketplace-kiro/` → `kiro-custom-marketplace/` | ❌ | L200 | The catch-all `marketplace-*) continue ;;` at L200 SKIPS `marketplace-kiro` instead of migrating it. Only `marketplace-codex` and `marketplace-gemini` have explicit blocks (L155, L179). If a user has legacy `marketplace-kiro/` on disk, its contents stay put. |
| Migrates `marketplace-opencode/` → `opencode-custom-marketplace/` | ❌ | L200 | Same gap as `marketplace-kiro`. |
| Migrates legacy `role-plugins/plugins/` → `role-plugins/roles-marketplace/` | ✅ | L224-231 | |
| Migrates legacy `role-plugins/marketplace-codex/` → `codex-roles-marketplace/` | ❌ | Missing | Unlike the custom-plugins block, role-plugins has NO explicit `marketplace-<client>/` migration code. Any legacy role-plugins stored in `marketplace-codex` style would be skipped by the top-level `*-roles-marketplace` and `marketplace-*`-free catch-all (actually the role block only has the catch-all at L237-239 which does not include `marketplace-*`). Stray dirs get iterated by L234 and detected via `detect_client`. |
| Migrates top-level strays via `detect_client` | ✅ | L193-210, L233-248 | Parses `<name>.agent.toml` for `compatible-clients` or falls back to name suffix (`-codex`, `-gemini`, `-kiro`, `-opencode`). |
| Creates `core-plugins/.abstract/` | ✅ | L261 | |
| Migrates `custom-plugins/.abstract/ai-maestro-plugin/` → `core-plugins/.abstract/ai-maestro-plugin/` | ✅ | L264-266 | Guarded by existence of source AND absence of destination. |
| Moves converted core plugins from `custom-plugins/*-custom-marketplace/ai-maestro-plugin*/` → `core-plugins/<client>-core-marketplace/` | ✅ | L270-285 | |
| Handles Claude's core plugin correctly (moves to `core-plugins/.abstract/` IR hub, not to a Claude core marketplace) | ✅ | L288-297 | R20.25 compliant. |

### 3.2 Idempotency

| Check | Status | Reference | Notes |
|---|---|---|---|
| `move_plugin` skips when destination exists | ✅ | L52-54 | `if [[ -d "$dst" ]]; then log SKIP; return; fi` |
| `remove_empty_dir` skips non-empty dirs with a warning | ✅ | L66-80 | Never destroys user data. |
| Re-running on an already-migrated layout is a no-op | ✅ | L194-210, L234-248 | The top-level loops skip `custom-marketplace`, `*-custom-marketplace`, `.abstract`, `.claude-plugin`, `marketplace-*`. Everything else is a stray to migrate. |
| `set -euo pipefail` + `DRY_RUN` flag | ✅ | L34, L40-44 | |
| Dry-run mode prints intended actions without moving | ✅ | L56-62 | |

### 3.3 Preserves user's Haephestos-created custom plugins

| Check | Status | Reference | Notes |
|---|---|---|---|
| Custom plugins at the top level of `custom-plugins/` are migrated via `detect_client` | ✅ | L193-210 | If Haephestos left them at `~/agents/custom-plugins/<name>/` (old layout), they get moved to the correct per-client marketplace based on either `.agent.toml` `compatible-clients` (if present, unlikely for custom) or name suffix (else Claude default). |
| Never deletes plugin contents | ✅ | L60-61, L66-80 | Only `mv` (move) — contents preserved in new location. |
| Empty source dirs removed with `rmdir` only when truly empty | ✅ | L69-78 | Plus an explicit warning. |

### 3.4 `.abstract/` IR directories handled correctly

| Check | Status | Reference | Notes |
|---|---|---|---|
| `custom-plugins/.abstract/` explicitly created | ✅ | L131 | |
| `role-plugins/.abstract/` explicitly created | ✅ | L221 | |
| `core-plugins/.abstract/` explicitly created | ✅ | L261 | |
| `.abstract/` survives top-level loops (not iterated as a plugin) | ✅ | L198, L238 | Case clause skips `.abstract`. |
| `.abstract/ai-maestro-plugin/` migrates from `custom-plugins/.abstract/` → `core-plugins/.abstract/` | ✅ | L264-266 | |

### 3.5 R20.25 — Does NOT create a local Claude core marketplace

| Check | Status | Reference | Notes |
|---|---|---|---|
| Only `<client>-core-marketplace` dirs are created (no plain `core-marketplace`) | ✅ | L277-278 | `core_mkt="${CORE}/${client}-core-marketplace"` and `client` is never `"claude"` (L274-275). |
| Claude's core plugin is only referenced as IR, never as a local marketplace | ✅ | L288-297 | Moves to `.abstract/` IR hub. |
| No `mkdir -p "${CORE}/.claude-plugin"` anywhere in the script | ✅ | (verified) | Grep-confirmed. |

### 3.6 Not invoked by any installer

| Check | Status | Reference | Notes |
|---|---|---|---|
| `install-messaging.sh`, `install.sh`, `install-agent-cli.sh`, `install-*-tools.sh`, `scripts/remote-install.sh` call the R20 migration | ❌ | — | Grep confirms NO installer invokes `migrate-r20-disk-layout.sh`. It is a standalone one-off that the operator must run manually. Users upgrading from a pre-R20 layout will NOT have their disk automatically migrated by any of the standard installer entry points. |

### 3.7 Summary for `scripts/migrate-r20-disk-layout.sh`

| Status | Count |
|---|---|
| ✅ PASS | 17 |
| ⚠️ WARNING | 0 |
| ❌ FAIL | 3 |

**Three gaps:** (1) legacy `custom-plugins/marketplace-kiro/` and (2) legacy `custom-plugins/marketplace-opencode/` are SKIPPED by the `marketplace-*) continue` catch-all; (3) no installer invokes the migration script, so pre-R20 disks don't get migrated on upgrade.

---

## Section 4: Cross-installer Consistency

### 4.1 Marketplace names across all installers

| File | `ai-maestro-plugins` (remote GitHub) | `ai-maestro-local-roles-marketplace` | `ai-maestro-local-custom-marketplace` | Status |
|---|---|---|---|---|
| `install-messaging.sh` | L698, L710, L953 | L866-872 | L875-882 | ✅ |
| `install.sh` | L1081 | — (delegates to install-messaging) | — | ✅ |
| `install-agent-cli.sh` | — (comment only L366) | — | — | ✅ (does not register any marketplace; defers) |
| `install-doc-tools.sh` | — | — | — | ✅ (defers) |
| `install-graph-tools.sh` | — | — | — | ✅ (defers) |
| `install-memory-tools.sh` | — | — | — | ✅ (defers) |
| `scripts/remote-install.sh` | L18 fallback, L446 | — | — | ✅ (delegates to install.sh which delegates to install-messaging.sh) |
| `scripts/bump-version.sh` | L218 hardcoded `Emasoft/ai-maestro-plugins` | — | — | ⚠️ Hardcoded, does NOT source `ecosystem-config.sh`. If `MARKETPLACE_REPO` ever changes, this script diverges. |

### 4.2 Path conventions

| Convention | Used by all installers? | Status |
|---|---|---|
| `~/.local/bin/` for scripts | ✅ all (install-messaging L560, install-agent-cli L47, install-doc-tools L8, install-graph-tools L8, install-memory-tools L8) | ✅ |
| `~/.local/share/aimaestro/shell-helpers/` for helpers | ✅ all (install-messaging L652, install-agent-cli L48, install-doc-tools L9, install-graph-tools L9, install-memory-tools L9) | ✅ |
| `~/agents/role-plugins/` for R20 role container | ✅ install-messaging only (L866) | ✅ |
| `~/agents/custom-plugins/` for R20 custom container | ✅ install-messaging only (L876) | ✅ |
| `~/agents/core-plugins/` for R20 core container | ✅ install-messaging only (L891) | ✅ |
| `~/.claude/plugins/cache/` | Never created by installers (managed by Claude CLI) | ✅ |

No installer uses the inconsistent alternatives (`~/.agents/`, `~/ai-maestro/agents/`, etc.). All paths are under `~/agents/…` per R20.

### 4.3 Environment variable names

| Variable | Referenced by | Consistent? |
|---|---|---|
| `$MARKETPLACE_REPO` | install-messaging L698, install.sh L1081, remote-install.sh L18, bump-version.sh (hardcoded) | ⚠️ bump-version.sh hardcodes the literal value instead of using the variable. |
| `$MARKETPLACE_NAME` | install-messaging L953, remote-install.sh L446 | ✅ |
| `$MAIN_PLUGIN_NAME` | install-messaging L699, install-messaging L953, remote-install.sh L445 | ✅ |
| `$LOCAL_MARKETPLACE_NAME` | install-messaging L869 | ✅ |
| `$LOCAL_MARKETPLACE_DIR_NAME` | install-messaging L866 | ✅ |
| `$CUSTOM_MARKETPLACE_NAME` | install-messaging L879 (fallback only — NOT defined in ecosystem-config.sh) | ⚠️ |
| `$CUSTOM_MARKETPLACE_DIR_NAME` | install-messaging L876 (fallback only — NOT defined in ecosystem-config.sh) | ⚠️ |
| `$CORE_PLUGINS_CONTAINER_DIR_NAME` | install-messaging L891 (fallback only — NOT defined in ecosystem-config.sh) | ⚠️ |
| `AIM_*` prefix | None found in any installer | — |
| `CLAUDE_*` prefix | `CLAUDE_PROJECT_DIR` used per CLAUDE.md | ✅ (governed by Claude Code runtime, not our installers) |

### 4.4 Ordering (install scripts → register marketplaces → install core plugin)

All paths through `install.sh` or `install-messaging.sh` directly follow this order:

1. **Install scripts to `~/.local/bin/`** — `install-messaging.sh` L555-647 (AMP + AID + other tools)
2. **Register marketplaces** — `install-messaging.sh` L700-716 (remote) + L748-913 (local containers)
3. **Install core `ai-maestro-plugin`** — `install-messaging.sh` L717-726

Entry points:
- `install.sh` → delegates to `install-messaging.sh` (L938-947) first, THEN `install-memory-tools.sh`, `install-graph-tools.sh`, `install-doc-tools.sh`, `install-agent-cli.sh`. The tool installers only copy scripts to `~/.local/bin/` — they register nothing.
- `scripts/remote-install.sh` → clones repo, runs `install.sh`.

| Check | Status | Notes |
|---|---|---|
| `install-messaging.sh` runs before any plugin-registration tool | ✅ | `install.sh` L938. |
| `install.sh` runs the R20 migration | ❌ | No call to `migrate-r20-disk-layout.sh` found. |
| `scripts/remote-install.sh` runs the R20 migration | ❌ | Same. |

### 4.5 Summary for cross-installer consistency

| Status | Count |
|---|---|
| ✅ PASS | 16 |
| ⚠️ WARNING | 5 |
| ❌ FAIL | 2 |

---

## Section 5: Remediation queue

### ❌ FAILS (must fix)

- **[ECO-001]** `scripts/ecosystem-config.sh` `AI_MAESTRO_REPO` points to `Emasoft/ai-maestro`, but `lib/ecosystem-constants.ts` still says `23blocks-OS/ai-maestro`. Reconcile (pick one) and sync both files.
- **[ECO-002]** Add missing shell constants to `scripts/ecosystem-config.sh`: `CUSTOM_MARKETPLACE_NAME`, `CUSTOM_MARKETPLACE_DIR_NAME`, `CORE_PLUGINS_CONTAINER_DIR_NAME`, `ABSTRACT_IR_DIR_NAME`, `ROLE_PLUGINS_CONTAINER_DIR_NAME`. Installer currently relies on hardcoded fallbacks.
- **[MIG-001]** `scripts/migrate-r20-disk-layout.sh` skips legacy `custom-plugins/marketplace-kiro/`. Add an explicit `1e` block (mirroring the `marketplace-codex` / `marketplace-gemini` blocks) that renames `marketplace-kiro/` → `kiro-custom-marketplace/`.
- **[MIG-002]** Same gap for `custom-plugins/marketplace-opencode/` → add `1f` block renaming it to `opencode-custom-marketplace/`.
- **[MIG-003]** `scripts/migrate-r20-disk-layout.sh` has NO explicit `marketplace-<client>/` handling for the `role-plugins` container. Add a symmetric `2a'` block that migrates `role-plugins/marketplace-codex/` → `role-plugins/codex-roles-marketplace/` and the equivalents for `-gemini`, `-kiro`, `-opencode` (role-plugins historically lived under `plugins/` and mass-custom installations may have placed them in `marketplace-*/`).
- **[INT-001]** No installer invokes `migrate-r20-disk-layout.sh`. Add a call to the migration script near the start of `install-messaging.sh` (before any `mkdir -p` of the new layout) so upgraders from pre-R20 disks get automatic migration. Pass `--dry-run` first in CI but run live in interactive mode.

### ⚠️ WARNINGS (should fix)

- **[AID-001]** `install-messaging.sh` verification block (L923) lists only `AMP_SCRIPTS=(…)`. Add an `AID_SCRIPTS=(aid-init.sh aid-auth.sh aid-token.sh aid-register.sh aid-status.sh aid-maestro-token.sh aid-helper.sh)` array and iterate it for explicit verification.
- **[BUMP-001]** `scripts/bump-version.sh` hardcodes `Emasoft/ai-maestro-plugins` at L218. Replace with `source "$SCRIPT_DIR/ecosystem-config.sh"` at the top and use `$MARKETPLACE_REPO`.
- **[ECO-003]** (derivative of ECO-002) — once the missing shell constants are added, the fallback `${VAR:-default}` pattern in `install-messaging.sh` can remain for belt-and-suspenders, but warn loudly if the source-guard didn't load.

---

## Cross-reference Map

| File on disk (branch) | Lines read | Outcome |
|---|---|---|
| `install-messaging.sh` | 1-200, 560-910, 905-1032 | 17 PASS / 1 WARN / 0 FAIL |
| `scripts/ecosystem-config.sh` | 1-37 (full) | 16 PASS / 3 WARN / 1 FAIL |
| `scripts/migrate-r20-disk-layout.sh` | 1-358 (full) | 17 PASS / 0 WARN / 3 FAIL |
| `lib/ecosystem-constants.ts` | 1-323 (full) | (reference for consistency) |
| `install.sh`, `install-agent-cli.sh`, `install-*-tools.sh`, `scripts/remote-install.sh`, `scripts/bump-version.sh` | grep + targeted reads | Cross-check: 16 PASS / 5 WARN / 2 FAIL |

---

## Overall verdict

**PASS with caveats.** The installer architecture is coherent and R20-compliant for a fresh install on a clean machine. The three real risks are:

1. Pre-R20 disks from returning users are never auto-migrated (INT-001, MIG-001, MIG-002, MIG-003).
2. `scripts/ecosystem-config.sh` is missing 5 constants that the installer silently relies on via fallbacks (ECO-002).
3. `AI_MAESTRO_REPO` points to two different orgs depending on which language file you read (ECO-001).

None of these break a clean install, but all three will surface as confusing bugs the next time the marketplace org changes or the installer encounters a disk with `marketplace-kiro/` or `marketplace-opencode/` legacy directories.
