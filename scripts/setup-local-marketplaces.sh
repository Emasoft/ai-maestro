#!/bin/bash
# Set up ALL local marketplaces (R20.3 v3.7.0 per-client layout; R20.28 folder patterns)
#
# Three containers, each with per-client marketplace dirs:
#   ~/agents/role-plugins/    → roles-marketplace/, codex-roles-marketplace/, ...
#   ~/agents/custom-plugins/  → custom-marketplace/, codex-custom-marketplace/, ...
#   ~/agents/core-plugins/    → codex-core-marketplace/, ...   (no Claude — R20.25)
# The role/custom containers each carry a .claude-plugin/marketplace.json manifest
# that Claude CLI reads. We register the CONTAINER (not each subfolder) because
# Claude CLI resolves source paths relative to the manifest.
#
# EXTRACTED FROM install-messaging.sh (2026-07-30) so R20.28 could be pinned by a
# test. The rule is a claim about what the installer PUTS ON DISK, so the only
# honest proof runs it and looks — and running the whole 1,386-line installer is
# neither fast nor 0-IMPACT (it shells out to `claude`, to cargo/npm via the
# code-analysis tooling installer, and copies into ~/.local/bin). Splitting the
# block out gives a subprocess-runnable seam whose ONLY inputs are $HOME and PATH.
# It also stops the citation from rotting: the guard is now a whole file, not a
# line range (the previous citation had drifted ~87 lines).
#
# This is the same delegation pattern the block already used twice, for
# migrate-r20-disk-layout.sh and install-code-analysis-tooling.sh.
#
# IDEMPOTENT — safe to run repeatedly; existing plugin arrays are preserved.
# Pinned by tests/governance/r20-installer-marketplace-layout.test.ts.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/ecosystem-config.sh" ]; then
    # shellcheck source=/dev/null
    source "$SCRIPT_DIR/ecosystem-config.sh"
fi

# Colors + icons + print helpers — same shapes install-messaging.sh uses, so the
# output reads identically whether this runs standalone or from the installer.
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
CHECK="✅"
INFO="ℹ️ "
WARN="⚠️ "

print_success() { echo -e "${GREEN}${CHECK} $1${NC}"; }
print_warning() { echo -e "${YELLOW}${WARN} $1${NC}"; }
print_info()    { echo -e "${BLUE}${INFO}$1${NC}"; }

echo ""
print_info "Setting up local marketplaces (R20.3 per-client layout)..."

# Step 0: Run R20 disk migration BEFORE creating the new layout.
# This migrates pre-R20 directories (custom-plugins/claude/, codex/,
# marketplace-<client>/, role-plugins/plugins/) into the new per-client
# <client>-custom-marketplace/ / <client>-roles-marketplace/ layout.
# IDEMPOTENT — running on an already-migrated layout is a no-op.
if [ -x "$SCRIPT_DIR/migrate-r20-disk-layout.sh" ]; then
    print_info "Running R20 disk-layout migration (idempotent)..."
    "$SCRIPT_DIR/migrate-r20-disk-layout.sh" 2>&1 | sed 's/^/  /' || \
        print_warning "R20 migration returned non-zero (continuing)"
elif [ -f "$SCRIPT_DIR/migrate-r20-disk-layout.sh" ]; then
    print_info "Running R20 disk-layout migration (idempotent)..."
    bash "$SCRIPT_DIR/migrate-r20-disk-layout.sh" 2>&1 | sed 's/^/  /' || \
        print_warning "R20 migration returned non-zero (continuing)"
else
    print_info "R20 migration script not found at $SCRIPT_DIR/migrate-r20-disk-layout.sh — skipping (fresh install)"
fi

# Helper: ensure a container has .claude-plugin/marketplace.json with correct name,
# preserving any existing plugins array.
setup_local_marketplace() {
    local MKT_DIR="$1"
    local MKT_NAME="$2"
    local MKT_DESC="$3"
    local MKT_META="$MKT_DIR/.claude-plugin"
    local MKT_JSON="$MKT_META/marketplace.json"

    mkdir -p "$MKT_META"

    # Preserve existing plugins
    local EXISTING_PLUGINS='[]'
    if [ -f "$MKT_JSON" ] && command -v jq &>/dev/null; then
        EXISTING_PLUGINS=$(jq -c 'if .plugins then .plugins elif type == "array" then . else [] end' "$MKT_JSON" 2>/dev/null || echo '[]')
        if ! echo "$EXISTING_PLUGINS" | jq 'type == "array"' 2>/dev/null | grep -q true; then
            EXISTING_PLUGINS='[]'
        fi
        local PLUGIN_COUNT
        PLUGIN_COUNT=$(echo "$EXISTING_PLUGINS" | jq 'length' 2>/dev/null || echo '0')
        if [ "$PLUGIN_COUNT" -gt 0 ] 2>/dev/null; then
            print_info "  $MKT_NAME: preserving $PLUGIN_COUNT existing plugin(s)"
        fi
    fi

    # Write manifest
    if command -v jq &>/dev/null; then
        jq -n \
            --arg name "$MKT_NAME" \
            --arg desc "$MKT_DESC" \
            --argjson plugins "$EXISTING_PLUGINS" \
            '{
                name: $name,
                version: "1.0.0",
                owner: { name: "local" },
                metadata: { description: $desc },
                plugins: $plugins
            }' > "$MKT_JSON"
    else
        if [ ! -f "$MKT_JSON" ]; then
            cat > "$MKT_JSON" <<MKEOF
{
  "name": "$MKT_NAME",
  "version": "1.0.0",
  "owner": { "name": "local" },
  "metadata": { "description": "$MKT_DESC" },
  "plugins": []
}
MKEOF
        fi
    fi

    # Ensure per-client marketplace subdirs + .abstract exist
    mkdir -p "$MKT_DIR/.abstract"

    # Register with Claude CLI
    claude plugin marketplace add "$MKT_DIR" 2>/dev/null && \
        print_success "  Registered: $MKT_NAME" || \
        print_info "  Already registered: $MKT_NAME"
    claude plugin marketplace update "$MKT_NAME" 2>/dev/null || true
}

# Helper: create empty per-client marketplace subdirs (with flat marketplace.json)
# for the 4 non-Claude clients. These are filesystem-only marketplaces — their
# respective clients (codex, gemini, opencode, kiro) register them themselves
# when needed, or the plugin-adapter copies files out of them directly.
create_per_client_marketplaces() {
    local CONTAINER="$1"       # role-plugins | custom-plugins | core-plugins
    local KIND="$2"            # roles | custom | core
    local PARENT="$HOME/agents/$CONTAINER"
    mkdir -p "$PARENT"
    for CLIENT in codex gemini kiro opencode; do
        local CLIENT_MKT="$PARENT/${CLIENT}-${KIND}-marketplace"
        mkdir -p "$CLIENT_MKT"
        local MF="$CLIENT_MKT/marketplace.json"
        if [ ! -f "$MF" ]; then
            local DISPLAY_KIND
            case "$KIND" in
                roles)  DISPLAY_KIND="Roles" ;;
                custom) DISPLAY_KIND="Custom" ;;
                core)   DISPLAY_KIND="Core" ;;
            esac
            local DISPLAY_CLIENT
            case "$CLIENT" in
                codex) DISPLAY_CLIENT="Codex" ;;
                gemini) DISPLAY_CLIENT="Gemini" ;;
                kiro) DISPLAY_CLIENT="Kiro" ;;
                opencode) DISPLAY_CLIENT="OpenCode" ;;
            esac
            cat > "$MF" <<MKEOF
{
  "name": "ai-maestro-local-${CLIENT}-${KIND}-marketplace",
  "interface": {
    "displayName": "AI Maestro Local $DISPLAY_KIND ($DISPLAY_CLIENT)"
  },
  "plugins": []
}
MKEOF
            print_info "  Created: ${CLIENT}-${KIND}-marketplace/"
        fi
    done
}

# 1. Role-plugins container (Claude marketplace at container level + per-client subdirs)
ROLES_DIR="$HOME/agents/${LOCAL_MARKETPLACE_DIR_NAME:-role-plugins}"
setup_local_marketplace \
    "$ROLES_DIR" \
    "${LOCAL_MARKETPLACE_NAME:-ai-maestro-local-roles-marketplace}" \
    "Local Claude role-plugin marketplace managed by AI Maestro"
# Ensure the Claude roles-marketplace subdir exists (listed in the container manifest)
mkdir -p "$ROLES_DIR/roles-marketplace"
create_per_client_marketplaces "role-plugins" "roles"

# 2. Custom-plugins container (Claude marketplace at container level + per-client subdirs)
CUSTOM_DIR="$HOME/agents/${CUSTOM_MARKETPLACE_DIR_NAME:-custom-plugins}"
setup_local_marketplace \
    "$CUSTOM_DIR" \
    "${CUSTOM_MARKETPLACE_NAME:-ai-maestro-local-custom-marketplace}" \
    "Local Claude custom-plugin marketplace managed by AI Maestro"
# Ensure the Claude custom-marketplace subdir exists (listed in the container manifest)
mkdir -p "$CUSTOM_DIR/custom-marketplace"
create_per_client_marketplaces "custom-plugins" "custom"

# 3. Core-plugins container
# R20.25 (clarified 2026-04-16): Claude installs the core ai-maestro-plugin
# from the REMOTE marketplace (Emasoft/ai-maestro-plugins). There is NO local
# Claude core-marketplace — only per-client converted copies for non-Claude
# clients (codex, gemini, kiro, opencode) that get the plugin via their
# respective client-plugin-adapter (not a marketplace registration).
CORE_DIR="$HOME/agents/${CORE_PLUGINS_CONTAINER_DIR_NAME:-core-plugins}"
mkdir -p "$CORE_DIR/.abstract"
# Cleanup: if an earlier version of this installer created a Claude marketplace
# manifest for core-plugins, remove it — Claude does not use this container.
if [ -f "$CORE_DIR/.claude-plugin/marketplace.json" ]; then
    print_info "  Removing stale Claude manifest at core-plugins/.claude-plugin/"
    rm -rf "$CORE_DIR/.claude-plugin"
fi
# If Claude CLI has registered ai-maestro-local-core-marketplace from an earlier
# run, unregister — Claude uses remote only.
if claude plugin marketplace list 2>/dev/null | grep -q "ai-maestro-local-core-marketplace"; then
    claude plugin marketplace remove "ai-maestro-local-core-marketplace" 2>/dev/null && \
        print_info "  Unregistered stale Claude marketplace: ai-maestro-local-core-marketplace"
fi
create_per_client_marketplaces "core-plugins" "core"

# Migrate: if the core plugin IR was in custom-plugins/.abstract/, move it to core-plugins/.abstract/
if [ -d "$CUSTOM_DIR/.abstract/ai-maestro-plugin" ] && [ ! -d "$CORE_DIR/.abstract/ai-maestro-plugin" ]; then
    mv "$CUSTOM_DIR/.abstract/ai-maestro-plugin" "$CORE_DIR/.abstract/ai-maestro-plugin" 2>/dev/null && \
        print_info "  Migrated core plugin IR from custom-plugins/.abstract/ to core-plugins/.abstract/"
fi

print_success "All local marketplaces ready (3 containers × 4 per-client + 2 Claude)"
