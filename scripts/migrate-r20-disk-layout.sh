#!/bin/bash
# R20 Disk Migration — Enforce per-client marketplace directories
#
# FINAL LAYOUT:
#   ~/agents/custom-plugins/
#     .abstract/<plugin>/                      Shared IR hub
#     custom-marketplace/<plugin>/             Claude custom plugins (no client prefix)
#     codex-custom-marketplace/<plugin-codex>/ Codex custom plugins
#     gemini-custom-marketplace/<plugin-gemini>/ Gemini custom plugins
#
#   ~/agents/role-plugins/
#     .abstract/<plugin>/                      Shared IR hub
#     .claude-plugin/marketplace.json          Claude CLI marketplace manifest
#     roles-marketplace/<plugin>/              Claude role plugins (no client prefix)
#     codex-roles-marketplace/<plugin-codex>/  Codex role plugins
#
#   ~/agents/core-plugins/
#     .abstract/ai-maestro-plugin/             Shared IR hub for the core plugin
#     codex-core-marketplace/ai-maestro-plugin-codex/  Codex core plugin
#     gemini-core-marketplace/ai-maestro-plugin-gemini/ Gemini core plugin
#     (Claude has NO local core marketplace — installs from remote)
#
# RULES:
#   - .abstract/ stays as .abstract/ (hidden dir, dot prefix kept)
#   - Claude plugins have NO client suffix (just <plugin-name>)
#   - Non-Claude plugins have client suffix (<plugin-name>-<client>)
#   - Old flat dirs (claude/, codex/, marketplace-codex/, plugins/) are
#     emptied and removed
#   - Only marketplace dirs + .abstract + .claude-plugin remain
#
# This script is IDEMPOTENT — safe to run multiple times.
# It only MOVES, never DELETES content (only removes empty dirs).

set -euo pipefail

AGENTS_DIR="${HOME}/agents"
CUSTOM="${AGENTS_DIR}/custom-plugins"
ROLES="${AGENTS_DIR}/role-plugins"
CORE="${AGENTS_DIR}/core-plugins"
DRY_RUN=false
MOVED=0
ERRORS=0

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

log()  { echo "  [R20] $1"; }
warn() { echo "  [R20] ⚠ $1"; ERRORS=$((ERRORS + 1)); }

move_plugin() {
  local src="$1" dst="$2"
  if [[ ! -d "$src" ]]; then return; fi
  if [[ -d "$dst" ]]; then
    log "SKIP $(basename "$src") → $(basename "$dst") (target exists)"
    return
  fi
  if $DRY_RUN; then
    log "WOULD MOVE $(basename "$src") → $dst"
  else
    mkdir -p "$(dirname "$dst")"
    mv "$src" "$dst"
    log "MOVED $(basename "$src") → $dst"
  fi
  MOVED=$((MOVED + 1))
}

remove_empty_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    # Only remove if truly empty (no files, no subdirs)
    if [[ -z "$(ls -A "$dir" 2>/dev/null)" ]]; then
      if $DRY_RUN; then
        log "WOULD REMOVE empty dir: $dir"
      else
        rmdir "$dir" && log "Removed empty: $dir"
      fi
    else
      warn "Cannot remove non-empty dir: $dir ($(ls "$dir" | wc -l | tr -d ' ') items remain)"
    fi
  fi
}

# Detect client for a plugin directory.
#
# Role-plugins have a *.agent.toml with compatible-clients — use that.
# Custom plugins do NOT have .agent.toml — detect client from name suffix:
#   <name>-codex → codex, <name>-gemini → gemini, <name> (no suffix) → claude
detect_client() {
  local plugin_dir="$1"
  local name=$(basename "$plugin_dir")

  # Role-plugins: check .agent.toml compatible-clients
  local toml_file=""
  for f in "${plugin_dir}"/*.agent.toml; do
    [[ -f "$f" ]] && toml_file="$f" && break
  done
  if [[ -n "$toml_file" ]]; then
    # Extract first quoted string after compatible-clients
    local raw_client=$(grep 'compatible-clients' "$toml_file" 2>/dev/null | grep -oP '"[^"]+"' | head -1 | tr -d '"')
    # Normalize to short directory name
    case "$raw_client" in
      claude-code|claude) echo "claude"; return ;;
      codex)  echo "codex"; return ;;
      gemini) echo "gemini"; return ;;
      kiro|kiro-cli) echo "kiro"; return ;;
      opencode) echo "opencode"; return ;;
    esac
  fi

  # Custom plugins (no .agent.toml): detect from name suffix
  case "$name" in
    *-codex)  echo "codex" ;;
    *-gemini) echo "gemini" ;;
    *-kiro)   echo "kiro" ;;
    *-opencode) echo "opencode" ;;
    *)        echo "claude" ;;
  esac
}

echo "R20 Disk Layout Migration"
echo "========================="
echo ""

# ═══════════════════════════════════════════════════════════════
# 1. CUSTOM PLUGINS
# ═══════════════════════════════════════════════════════════════

echo "1. Custom Plugins (${CUSTOM})"

# Ensure target marketplace dirs exist
$DRY_RUN || mkdir -p "${CUSTOM}/custom-marketplace"
$DRY_RUN || mkdir -p "${CUSTOM}/.abstract"

# 1a. Move plugins from old flat claude/ dir into custom-marketplace/
if [[ -d "${CUSTOM}/claude" ]]; then
  for plugin in "${CUSTOM}/claude"/*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    move_plugin "$plugin" "${CUSTOM}/custom-marketplace/${name}"
  done
  remove_empty_dir "${CUSTOM}/claude"
fi

# 1b. Move plugins from old codex/ dir into codex-custom-marketplace/
if [[ -d "${CUSTOM}/codex" ]]; then
  $DRY_RUN || mkdir -p "${CUSTOM}/codex-custom-marketplace"
  for plugin in "${CUSTOM}/codex"/*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    move_plugin "$plugin" "${CUSTOM}/codex-custom-marketplace/${name}"
  done
  remove_empty_dir "${CUSTOM}/codex"
fi

# 1c. Rename old marketplace-codex/ → codex-custom-marketplace/
if [[ -d "${CUSTOM}/marketplace-codex" ]]; then
  $DRY_RUN || mkdir -p "${CUSTOM}/codex-custom-marketplace"
  for plugin in "${CUSTOM}/marketplace-codex"/*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    [[ "$name" == ".claude-plugin" ]] && continue
    move_plugin "$plugin" "${CUSTOM}/codex-custom-marketplace/${name}"
  done
  # Also move marketplace.json if present
  if [[ -f "${CUSTOM}/marketplace-codex/marketplace.json" ]]; then
    if $DRY_RUN; then
      log "WOULD MOVE marketplace.json → codex-custom-marketplace/"
    else
      mv "${CUSTOM}/marketplace-codex/marketplace.json" "${CUSTOM}/codex-custom-marketplace/" 2>/dev/null || true
    fi
  fi
  # Move .claude-plugin if present
  if [[ -d "${CUSTOM}/marketplace-codex/.claude-plugin" ]]; then
    move_plugin "${CUSTOM}/marketplace-codex/.claude-plugin" "${CUSTOM}/codex-custom-marketplace/.claude-plugin"
  fi
  remove_empty_dir "${CUSTOM}/marketplace-codex"
fi

# 1d. Rename old marketplace-gemini/ → gemini-custom-marketplace/
if [[ -d "${CUSTOM}/marketplace-gemini" ]]; then
  $DRY_RUN || mkdir -p "${CUSTOM}/gemini-custom-marketplace"
  for plugin in "${CUSTOM}/marketplace-gemini"/*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    [[ "$name" == ".claude-plugin" ]] && continue
    move_plugin "$plugin" "${CUSTOM}/gemini-custom-marketplace/${name}"
  done
  if [[ -d "${CUSTOM}/marketplace-gemini/.claude-plugin" ]]; then
    move_plugin "${CUSTOM}/marketplace-gemini/.claude-plugin" "${CUSTOM}/gemini-custom-marketplace/.claude-plugin"
  fi
  remove_empty_dir "${CUSTOM}/marketplace-gemini"
fi

# 1e. Move any top-level plugin dirs that shouldn't be at root
for item in "${CUSTOM}"/*/; do
  [[ -d "$item" ]] || continue
  name=$(basename "$item")
  case "$name" in
    custom-marketplace|*-custom-marketplace|.abstract|.claude-plugin) continue ;;
    claude|codex|gemini|kiro|opencode) continue ;;  # Already processed above
    marketplace-*) continue ;;                       # Already processed above
  esac
  # This is a stray plugin at the root — detect client and move
  client=$(detect_client "$item")
  if [[ "$client" == "claude" ]]; then
    move_plugin "$item" "${CUSTOM}/custom-marketplace/${name}"
  else
    $DRY_RUN || mkdir -p "${CUSTOM}/${client}-custom-marketplace"
    move_plugin "$item" "${CUSTOM}/${client}-custom-marketplace/${name}"
  fi
done

# ═══════════════════════════════════════════════════════════════
# 2. ROLE PLUGINS
# ═══════════════════════════════════════════════════════════════

echo ""
echo "2. Role Plugins (${ROLES})"

# Ensure target dirs exist
$DRY_RUN || mkdir -p "${ROLES}/roles-marketplace"
$DRY_RUN || mkdir -p "${ROLES}/.abstract"

# 2a. Move plugins from old plugins/ subfolder into roles-marketplace/
if [[ -d "${ROLES}/plugins" ]]; then
  for plugin in "${ROLES}/plugins"/*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    move_plugin "$plugin" "${ROLES}/roles-marketplace/${name}"
  done
  remove_empty_dir "${ROLES}/plugins"
fi

# 2b. Move any top-level role-plugin dirs into the right marketplace
for item in "${ROLES}"/*/; do
  [[ -d "$item" ]] || continue
  name=$(basename "$item")
  case "$name" in
    roles-marketplace|*-roles-marketplace|.abstract|.claude-plugin|plugins) continue ;;
  esac
  # Detect which client this role-plugin belongs to
  client=$(detect_client "$item")
  if [[ "$client" == "claude" ]]; then
    move_plugin "$item" "${ROLES}/roles-marketplace/${name}"
  else
    $DRY_RUN || mkdir -p "${ROLES}/${client}-roles-marketplace"
    move_plugin "$item" "${ROLES}/${client}-roles-marketplace/${name}"
  fi
done

# ═══════════════════════════════════════════════════════════════
# 3. Update marketplace.json manifests
# ═══════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════
# 3. CORE PLUGINS (ai-maestro-plugin conversions for non-Claude clients)
# ═══════════════════════════════════════════════════════════════

echo ""
echo "3. Core Plugins (${CORE})"

$DRY_RUN || mkdir -p "${CORE}/.abstract"

# 3a. Migrate core plugin IR from custom-plugins/.abstract/ → core-plugins/.abstract/
if [[ -d "${CUSTOM}/.abstract/ai-maestro-plugin" && ! -d "${CORE}/.abstract/ai-maestro-plugin" ]]; then
  move_plugin "${CUSTOM}/.abstract/ai-maestro-plugin" "${CORE}/.abstract/ai-maestro-plugin"
fi

# 3b. Move converted core plugins from custom-plugins marketplaces → core-plugins marketplaces
# The ai-maestro-plugin and ai-maestro-plugin-<client> in each custom-marketplace are the CORE plugin.
for mkt_dir in "${CUSTOM}"/*-custom-marketplace/; do
  [[ -d "$mkt_dir" ]] || continue
  mkt_name=$(basename "$mkt_dir")
  # Extract client from dir name: codex-custom-marketplace → codex
  client="${mkt_name%-custom-marketplace}"
  [[ -z "$client" || "$client" == "$mkt_name" ]] && continue

  core_mkt="${CORE}/${client}-core-marketplace"
  $DRY_RUN || mkdir -p "$core_mkt"

  for plugin in "${mkt_dir}"ai-maestro-plugin*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    move_plugin "$plugin" "${core_mkt}/${name}"
  done
done

# 3c. Also move from Claude custom-marketplace (ai-maestro-plugin is the core)
if [[ -d "${CUSTOM}/custom-marketplace/ai-maestro-plugin" ]]; then
  # Claude's core plugin should NOT be in custom-plugins — it comes from the remote marketplace.
  # Move it to core-plugins/.abstract/ as the IR source if not already there.
  if [[ ! -d "${CORE}/.abstract/ai-maestro-plugin" ]]; then
    move_plugin "${CUSTOM}/custom-marketplace/ai-maestro-plugin" "${CORE}/.abstract/ai-maestro-plugin"
  else
    log "SKIP: Claude core plugin in custom-marketplace/ — IR already in core-plugins/.abstract/"
    log "  You can remove ~/agents/custom-plugins/custom-marketplace/ai-maestro-plugin/ manually"
  fi
fi

# ═══════════════════════════════════════════════════════════════
# 4. Marketplace manifests
# ═══════════════════════════════════════════════════════════════

echo ""
echo "4. Marketplace manifests"

ROLES_MANIFEST="${ROLES}/.claude-plugin/marketplace.json"
if [[ -f "$ROLES_MANIFEST" ]] && ! $DRY_RUN; then
  python3 -c "
import json, os
with open('$ROLES_MANIFEST') as f:
    data = json.load(f)
changed = False
for p in data.get('plugins', []):
    src = p.get('source', '')
    base = os.path.basename(src.rstrip('/'))
    # Fix any path not under roles-marketplace/
    if '/roles-marketplace/' not in src:
        p['source'] = 'roles-marketplace/' + base
        changed = True
if changed:
    with open('$ROLES_MANIFEST', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('  [R20] Updated source paths in marketplace.json')
else:
    print('  [R20] marketplace.json paths already correct')
  " 2>/dev/null || warn "Could not update marketplace manifest"
else
  log "Marketplace manifest: $(if $DRY_RUN; then echo 'skipped (dry-run)'; else echo 'not found'; fi)"
fi

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary: ${MOVED} moves, ${ERRORS} warnings"
if $DRY_RUN; then
  echo "(DRY RUN — no changes made)"
fi
echo ""
echo "Final layout:"
for container_label in "custom-plugins" "role-plugins" "core-plugins"; do
  dir="${AGENTS_DIR}/${container_label}"
  echo "  ~/agents/${container_label}/"
  if [[ -d "$dir" ]]; then
    for d in "${dir}"/*/; do
      [[ -d "$d" ]] || continue
      name=$(basename "$d")
      count=$(find "$d" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
      echo "    ${name}/ (${count} plugins)"
    done
  else
    echo "    (not created yet)"
  fi
done
