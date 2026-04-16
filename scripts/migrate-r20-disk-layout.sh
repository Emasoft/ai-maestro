#!/bin/bash
# R20 Disk Migration — Enforce per-client marketplace directories
#
# OLD layout:
#   ~/agents/custom-plugins/claude/<plugin>/
#   ~/agents/custom-plugins/codex/<plugin>/
#   ~/agents/custom-plugins/marketplace-codex/<plugin>/
#   ~/agents/custom-plugins/.abstract/<plugin>/
#   ~/agents/role-plugins/<plugin>/                   (flat, all clients mixed)
#   ~/agents/role-plugins/plugins/<plugin>/            (legacy subfolder)
#   ~/agents/role-plugins/.abstract/<plugin>/
#
# NEW layout (R20.3):
#   ~/agents/custom-plugins/custom-marketplace/<plugin>/        Claude (no prefix)
#   ~/agents/custom-plugins/codex-custom-marketplace/<plugin>/  Codex
#   ~/agents/custom-plugins/gemini-custom-marketplace/<plugin>/ Gemini
#   ~/agents/custom-plugins/abstract/<plugin>/                  Shared IR
#   ~/agents/role-plugins/roles-marketplace/<plugin>/            Claude roles
#   ~/agents/role-plugins/codex-roles-marketplace/<plugin>/     Codex roles
#   ~/agents/role-plugins/abstract/<plugin>/                    Shared IR
#
# This script is IDEMPOTENT — safe to run multiple times.
# It only MOVES, never DELETES (except empty dirs).

set -euo pipefail

AGENTS_DIR="${HOME}/agents"
CUSTOM="${AGENTS_DIR}/custom-plugins"
ROLES="${AGENTS_DIR}/role-plugins"
DRY_RUN=false
MOVED=0

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

log()  { echo "  [R20] $1"; }
move() {
  local src="$1" dst="$2"
  if [[ -d "$src" ]]; then
    if [[ -d "$dst" ]]; then
      log "SKIP $src → $dst (target exists)"
      return
    fi
    if $DRY_RUN; then
      log "WOULD MOVE $src → $dst"
    else
      mkdir -p "$(dirname "$dst")"
      mv "$src" "$dst"
      log "MOVED $src → $dst"
    fi
    MOVED=$((MOVED + 1))
  fi
}

echo "R20 Disk Layout Migration"
echo "========================="
echo ""

# ═══════════════════════════════════════════════════════════════
# 1. CUSTOM PLUGINS
# ═══════════════════════════════════════════════════════════════

echo "1. Custom Plugins"

# Move .abstract/ → abstract/ (drop the dot prefix)
if [[ -d "${CUSTOM}/.abstract" ]]; then
  move "${CUSTOM}/.abstract" "${CUSTOM}/abstract"
fi

# Move claude/ → custom-marketplace/ (Claude has no prefix)
if [[ -d "${CUSTOM}/claude" ]]; then
  move "${CUSTOM}/claude" "${CUSTOM}/custom-marketplace"
fi

# Move marketplace-codex/ → codex-custom-marketplace/
if [[ -d "${CUSTOM}/marketplace-codex" ]]; then
  move "${CUSTOM}/marketplace-codex" "${CUSTOM}/codex-custom-marketplace"
fi

# Move codex/ → codex-custom-marketplace/ (if marketplace-codex didn't exist)
if [[ -d "${CUSTOM}/codex" && ! -d "${CUSTOM}/codex-custom-marketplace" ]]; then
  move "${CUSTOM}/codex" "${CUSTOM}/codex-custom-marketplace"
elif [[ -d "${CUSTOM}/codex" ]]; then
  # Both exist — move individual plugins from codex/ into codex-custom-marketplace/
  for plugin in "${CUSTOM}/codex"/*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    move "$plugin" "${CUSTOM}/codex-custom-marketplace/${name}"
  done
  # Remove empty source dir
  rmdir "${CUSTOM}/codex" 2>/dev/null && log "Removed empty ${CUSTOM}/codex" || true
fi

# Move marketplace-gemini/ → gemini-custom-marketplace/
if [[ -d "${CUSTOM}/marketplace-gemini" ]]; then
  move "${CUSTOM}/marketplace-gemini" "${CUSTOM}/gemini-custom-marketplace"
fi

# ═══════════════════════════════════════════════════════════════
# 2. ROLE PLUGINS
# ═══════════════════════════════════════════════════════════════

echo ""
echo "2. Role Plugins"

# Move .abstract/ → abstract/
if [[ -d "${ROLES}/.abstract" ]]; then
  move "${ROLES}/.abstract" "${ROLES}/abstract"
fi

# Ensure roles-marketplace/ exists for Claude role plugins
mkdir -p "${ROLES}/roles-marketplace"

# Move plugins/ subfolder contents → roles-marketplace/
if [[ -d "${ROLES}/plugins" ]]; then
  for plugin in "${ROLES}/plugins"/*/; do
    [[ -d "$plugin" ]] || continue
    name=$(basename "$plugin")
    move "$plugin" "${ROLES}/roles-marketplace/${name}"
  done
  rmdir "${ROLES}/plugins" 2>/dev/null && log "Removed empty ${ROLES}/plugins" || true
fi

# Move any top-level role-plugin dirs (not marketplace dirs, not .claude-plugin)
for item in "${ROLES}"/*/; do
  [[ -d "$item" ]] || continue
  name=$(basename "$item")
  # Skip known non-plugin dirs
  case "$name" in
    roles-marketplace|*-roles-marketplace|abstract|.abstract|.claude-plugin|plugins) continue ;;
  esac
  # Check if it's a role-plugin (has .agent.toml)
  if [[ -f "${item}/${name}.agent.toml" || -f "${item}/plugin.json" ]]; then
    move "$item" "${ROLES}/roles-marketplace/${name}"
  fi
done

# ═══════════════════════════════════════════════════════════════
# 3. Update marketplace.json manifests
# ═══════════════════════════════════════════════════════════════

echo ""
echo "3. Marketplace manifests"

# Update role-plugins marketplace.json source paths
ROLES_MANIFEST="${ROLES}/.claude-plugin/marketplace.json"
if [[ -f "$ROLES_MANIFEST" ]]; then
  if python3 -c "
import json, sys, os
with open('$ROLES_MANIFEST') as f:
    data = json.load(f)
changed = False
for p in data.get('plugins', []):
    src = p.get('source', '')
    # Update paths that point to old locations
    if '/plugins/' in src:
        p['source'] = src.replace('/plugins/', '/roles-marketplace/')
        changed = True
    elif not '/roles-marketplace/' in src and not '/-' in src:
        # Top-level plugin — prefix with roles-marketplace/
        basename = os.path.basename(src.rstrip('/'))
        p['source'] = os.path.join(os.path.dirname(src), 'roles-marketplace', basename)
        changed = True
if changed:
    with open('$ROLES_MANIFEST', 'w') as f:
        json.dump(data, f, indent=2)
    print('Updated source paths in marketplace.json')
else:
    print('marketplace.json paths already correct')
  " 2>/dev/null; then
    log "Marketplace manifest checked"
  else
    log "WARN: Could not update marketplace manifest (python3 error)"
  fi
fi

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════

echo ""
echo "Summary: ${MOVED} moves performed"
if $DRY_RUN; then
  echo "(DRY RUN — no changes made. Run without --dry-run to apply.)"
fi
echo ""
echo "New layout:"
echo "  ~/agents/custom-plugins/"
ls -d "${CUSTOM}"/*/ 2>/dev/null | sed 's|.*/agents/custom-plugins/|    |' | sed 's|/$||'
echo "  ~/agents/role-plugins/"
ls -d "${ROLES}"/*/ 2>/dev/null | sed 's|.*/agents/role-plugins/|    |' | sed 's|/$||'
