#!/bin/bash
# AI Maestro - Installation Verification Script
# Run this after installation to verify everything works
#
# v0.21.26: Updated to check AMP scripts (post-migration) instead of
#           old messaging scripts that were removed by install-messaging.sh.
#           Added planning skill check. Fixed runtime tests.

# Don't use set -e - we want to continue on failures

# Source ecosystem constants (single source of truth for marketplace/plugin names)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/scripts/ecosystem-config.sh" ]; then
    source "$SCRIPT_DIR/scripts/ecosystem-config.sh"
elif [ -f "$SCRIPT_DIR/ecosystem-config.sh" ]; then
    source "$SCRIPT_DIR/ecosystem-config.sh"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() {
    echo -e "${GREEN}✓${NC} $1"
    PASS=$((PASS + 1))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    FAIL=$((FAIL + 1))
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    WARN=$((WARN + 1))
}

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           AI Maestro - Installation Verification               ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 1. Check shell helpers are installed
echo "1. Checking shell helpers..."
if [ -f "$HOME/.local/share/aimaestro/shell-helpers/common.sh" ]; then
    pass "common.sh installed"
else
    fail "common.sh NOT installed - run install-messaging.sh"
fi

if [ -f "$HOME/.local/share/aimaestro/shell-helpers/agent-helper.sh" ]; then
    pass "agent-helper.sh installed (share dir)"
else
    warn "agent-helper.sh not in share dir - run install-agent-cli.sh"
fi

# 2. Check AMP messaging scripts (post-AMP migration)
echo ""
echo "2. Checking AMP messaging scripts..."
AMP_SCRIPTS=(
    "amp-init.sh"
    "amp-send.sh"
    "amp-inbox.sh"
    "amp-read.sh"
    "amp-reply.sh"
    "amp-status.sh"
    "amp-register.sh"
    "amp-fetch.sh"
    "amp-delete.sh"
    "amp-identity.sh"
    "amp-helper.sh"
    "amp-security.sh"
)

for script in "${AMP_SCRIPTS[@]}"; do
    if [ -x "$HOME/.local/bin/$script" ]; then
        pass "$script"
    else
        fail "$script NOT installed - run install-messaging.sh"
    fi
done

# 3. Check agent CLI
echo ""
echo "3. Checking agent CLI..."
if [ -x "$HOME/.local/bin/aimaestro-agent.sh" ]; then
    pass "aimaestro-agent.sh"
else
    fail "aimaestro-agent.sh NOT installed - run install-agent-cli.sh"
fi

if [ -f "$HOME/.local/share/aimaestro/shell-helpers/agent-helper.sh" ]; then
    pass "agent-helper.sh (helpers dir)"
else
    fail "agent-helper.sh NOT in helpers dir - run install-agent-cli.sh"
fi

# 4. Check AI Maestro plugin (skills are bundled in the plugin, not standalone)
echo ""
echo "4. Checking AI Maestro plugin..."
if claude plugin list 2>/dev/null | grep -q "ai-maestro-plugin"; then
    pass "ai-maestro-plugin installed"
else
    warn "ai-maestro-plugin not installed — install from marketplace ${MARKETPLACE_REPO:-Emasoft/ai-maestro-plugins}"
fi

# Also check for legacy standalone skills that should have been cleaned up
LEGACY_SKILLS=(
    "agent-messaging"
    "ai-maestro-agents-management"
    "planning"
    "team-governance"
)

for skill in "${LEGACY_SKILLS[@]}"; do
    if [ -d "$HOME/.claude/skills/$skill" ]; then
        warn "Legacy standalone skill '$skill' still exists — should be removed (now bundled in plugin)"
    fi
done

# 5. Check PATH
echo ""
echo "5. Checking PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
    pass "~/.local/bin is in PATH"
else
    warn "~/.local/bin is NOT in PATH - add to ~/.zshrc or ~/.bashrc"
fi

# 6. Test script syntax (bash -n)
echo ""
echo "6. Testing script syntax..."

# Helpers in share dir
for helper in common.sh agent-helper.sh; do
    local_path="$HOME/.local/share/aimaestro/shell-helpers/$helper"
    if [ -f "$local_path" ]; then
        if bash -n "$local_path" 2>/dev/null; then
            pass "$helper syntax OK"
        else
            fail "$helper has syntax errors"
        fi
    fi
done

# Key scripts in bin
for script in aimaestro-agent.sh; do
    local_path="$HOME/.local/bin/$script"
    if [ -f "$local_path" ]; then
        if bash -n "$local_path" 2>/dev/null; then
            pass "$script syntax OK"
        else
            fail "$script has syntax errors"
        fi
    fi
done

# 7. Runtime tests (only inside tmux with API running)
echo ""
echo "7. Testing script execution..."

if [ -n "$TMUX" ]; then
    # Test agent CLI
    if [ -x "$HOME/.local/bin/aimaestro-agent.sh" ]; then
        if "$HOME/.local/bin/aimaestro-agent.sh" list >/dev/null 2>&1; then
            pass "aimaestro-agent.sh runs"
        else
            warn "aimaestro-agent.sh failed (may need API running at localhost:23000)"
        fi
    fi

    # Test AMP inbox
    if [ -x "$HOME/.local/bin/amp-inbox.sh" ]; then
        if "$HOME/.local/bin/amp-inbox.sh" >/dev/null 2>&1; then
            pass "amp-inbox.sh runs"
        else
            warn "amp-inbox.sh failed (may need AMP initialized)"
        fi
    fi
else
    warn "Not in tmux session - skipping runtime tests"
fi

# Summary
echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}"
echo ""

if [ $FAIL -gt 0 ]; then
    echo -e "${RED}Some checks failed. Run the appropriate installer:${NC}"
    echo "  ./install-messaging.sh    - AMP scripts + skills"
    echo "  ./install-agent-cli.sh    - Agent management CLI"
    echo ""
    echo "Or run the full updater to fix everything at once:"
    echo "  ./update-aimaestro.sh"
    exit 1
elif [ $WARN -gt 0 ]; then
    echo -e "${YELLOW}Some optional features are missing.${NC}"
    exit 0
else
    echo -e "${GREEN}All checks passed!${NC}"
    exit 0
fi
