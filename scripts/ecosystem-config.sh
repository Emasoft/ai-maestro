#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# AI Maestro Ecosystem Constants — single source of truth for shell scripts
# TypeScript equivalent: lib/ecosystem-constants.ts
#
# Source this file at the top of every shell script that references
# marketplace repos, plugin names, or ecosystem identifiers:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/ecosystem-config.sh"   # or adjust path
# ──────────────────────────────────────────────────────────────

# ── Marketplace ──────────────────────────────────────────────
MARKETPLACE_REPO="Emasoft/ai-maestro-plugins"
MARKETPLACE_NAME="ai-maestro-plugins"
LOCAL_MARKETPLACE_NAME="ai-maestro-local-roles-marketplace"
# LOCAL_MARKETPLACE_DIR_NAME kept as an alias for backwards compatibility
# (deprecated per R20.1 — prefer ROLE_PLUGINS_CONTAINER_DIR_NAME)
LOCAL_MARKETPLACE_DIR_NAME="role-plugins"
CUSTOM_MARKETPLACE_NAME="ai-maestro-local-custom-marketplace"
# CUSTOM_MARKETPLACE_DIR_NAME kept as an alias for backwards compatibility
# (deprecated per R20.1 — prefer CUSTOM_PLUGINS_CONTAINER_DIR_NAME)
CUSTOM_MARKETPLACE_DIR_NAME="custom-plugins"

# ── R20 Container Model (v3.6.0+) ────────────────────────────
# role-plugins/, custom-plugins/, core-plugins/ are CONTAINERS,
# each holding per-client marketplace subfolders + a .abstract/ IR hub.
ROLE_PLUGINS_CONTAINER_DIR_NAME="role-plugins"
CUSTOM_PLUGINS_CONTAINER_DIR_NAME="custom-plugins"
CORE_PLUGINS_CONTAINER_DIR_NAME="core-plugins"
ABSTRACT_IR_DIR_NAME=".abstract"

# ── User-Scope Plugins ──────────────────────────────────────
MAIN_PLUGIN_NAME="ai-maestro-plugin"
AMP_PLUGIN_NAME="claude-plugin"
AMP_PLUGIN_REPO="https://github.com/Emasoft/claude-plugin.git"
AID_PLUGIN_NAME="agent-identity"
AID_PLUGIN_REPO="https://github.com/Emasoft/agent-identity.git"

# ── Role Plugins ─────────────────────────────────────────────
ROLE_PLUGIN_MANAGER="ai-maestro-assistant-manager-agent"
ROLE_PLUGIN_COS="ai-maestro-chief-of-staff"
ROLE_PLUGIN_ARCHITECT="ai-maestro-architect-agent"
ROLE_PLUGIN_INTEGRATOR="ai-maestro-integrator-agent"
ROLE_PLUGIN_ORCHESTRATOR="ai-maestro-orchestrator-agent"
ROLE_PLUGIN_PROGRAMMER="ai-maestro-programmer-agent"
ROLE_PLUGIN_MAINTAINER="ai-maestro-maintainer-agent"
ROLE_PLUGIN_AUTONOMOUS="ai-maestro-autonomous-agent"

# ── Repo URLs ────────────────────────────────────────────────
# Mirrors lib/ecosystem-constants.ts AI_MAESTRO_REPO constant (source of truth).
# If the project owner changes repos, update the TS file first, then this one.
AI_MAESTRO_REPO="https://github.com/23blocks-OS/ai-maestro"
MARKETPLACE_REPO_URL="https://github.com/${MARKETPLACE_REPO}"
