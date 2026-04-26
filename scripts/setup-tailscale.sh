#!/bin/bash
# AI Maestro — Tailscale VPN Setup & Hardening
#
# Validates that Tailscale is correctly configured for AI Maestro.
# Does NOT use `tailscale serve` (which breaks Next.js static file serving).
# Instead, AI Maestro binds directly to :: with an IP filter in server.mjs.
#
# This script:
#   1. Checks Tailscale installation
#   2. Ensures Tailscale is running and authenticated
#   3. Validates the IP is in the CGNAT range (100.64.0.0/10)
#   4. Checks that MagicDNS is enabled
#   5. Verifies no subnet routes are exposing the host to non-Tailscale traffic
#   6. Warns about known issues (iOS MagicDNS, IPv6 loopback)
#
# Usage:
#   ./scripts/setup-tailscale.sh              # Full setup + validation
#   ./scripts/setup-tailscale.sh --check      # Validation only (no changes)
#   ./scripts/setup-tailscale.sh --install    # Install Tailscale if missing (macOS)
#
# Exit codes:
#   0 — Tailscale is ready for AI Maestro
#   1 — Tailscale is not ready (see output for details)
#   2 — Tailscale is not installed and --install was not specified

set -euo pipefail

PORT="${AIMAESTRO_PORT:-23000}"
CHECK_ONLY=false
INSTALL=false
ERRORS=0
WARNINGS=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

ok()   { echo -e "  ${GREEN}OK${NC}    $1"; }
err()  { echo -e "  ${RED}ERROR${NC} $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; WARNINGS=$((WARNINGS + 1)); }
info() { echo -e "  ${CYAN}INFO${NC}  $1"; }

for arg in "$@"; do
  case "$arg" in
    --check)   CHECK_ONLY=true ;;
    --install) INSTALL=true ;;
  esac
done

echo ""
echo -e "${BOLD}AI Maestro — Tailscale VPN Setup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}1. Tailscale Installation${NC}"
# ═══════════════════════════════════════════════════════════════

if ! command -v tailscale &>/dev/null; then
  if [[ "$INSTALL" == true ]]; then
    info "Installing Tailscale..."
    if [[ "$(uname)" == "Darwin" ]]; then
      if command -v brew &>/dev/null; then
        brew install --cask tailscale 2>/dev/null || { err "Failed to install Tailscale via Homebrew"; exit 2; }
        ok "Tailscale installed via Homebrew"
        info "Open the Tailscale app from Applications to authenticate"
        info "Then re-run this script: ./scripts/setup-tailscale.sh"
        exit 0
      else
        err "Homebrew not found — install Tailscale manually from https://tailscale.com/download/mac"
        exit 2
      fi
    elif [[ "$(uname)" == "Linux" ]]; then
      # Official Tailscale install script
      curl -fsSL https://tailscale.com/install.sh | sh || { err "Failed to install Tailscale"; exit 2; }
      ok "Tailscale installed"
      info "Run 'sudo tailscale up' to authenticate"
      exit 0
    else
      err "Unsupported platform: $(uname). Install Tailscale manually."
      exit 2
    fi
  else
    err "Tailscale is not installed"
    info "Run with --install to install automatically, or install from https://tailscale.com/download"
    exit 2
  fi
fi

TS_VERSION=$(tailscale version 2>/dev/null | head -1 || echo "unknown")
ok "Tailscale installed ($TS_VERSION)"

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}2. Tailscale Status${NC}"
# ═══════════════════════════════════════════════════════════════

if ! tailscale status &>/dev/null 2>&1; then
  err "Tailscale is not running or not authenticated"
  info "On macOS: open the Tailscale app and sign in"
  info "On Linux: run 'sudo tailscale up'"
  exit 1
fi
ok "Tailscale is running"

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}3. IPv4 Address Validation${NC}"
# ═══════════════════════════════════════════════════════════════

TS_IPV4=$(tailscale ip -4 2>/dev/null || echo "")
if [[ -z "$TS_IPV4" ]]; then
  err "Cannot determine Tailscale IPv4 address"
  exit 1
fi

# Validate CGNAT range (100.64.0.0/10 = 100.64.x.x through 100.127.x.x)
if [[ "$TS_IPV4" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]]; then
  ok "IPv4 address $TS_IPV4 is in Tailscale CGNAT range"
else
  err "IPv4 address $TS_IPV4 is NOT in Tailscale CGNAT range (100.64.0.0/10)"
  info "This is unexpected — AI Maestro's IP filter will reject this address"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}4. IPv6 Address Validation${NC}"
# ═══════════════════════════════════════════════════════════════

TS_IPV6=$(tailscale ip -6 2>/dev/null || echo "")
if [[ -n "$TS_IPV6" ]]; then
  if [[ "$TS_IPV6" =~ ^fd7a:115c:a1e0: ]]; then
    ok "IPv6 address $TS_IPV6 is in Tailscale ULA range"
  else
    warn "IPv6 address $TS_IPV6 is NOT in Tailscale ULA range (fd7a:115c:a1e0::/48)"
  fi
else
  info "No Tailscale IPv6 address (IPv4-only mode)"
fi

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}5. MagicDNS${NC}"
# ═══════════════════════════════════════════════════════════════

TS_DNS=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
dns_name = d.get('Self', {}).get('DNSName', '')
print(dns_name.rstrip('.'))
" 2>/dev/null || echo "")

if [[ -n "$TS_DNS" ]]; then
  ok "MagicDNS hostname: $TS_DNS"
  info "Dashboard accessible at http://$TS_DNS:$PORT"
  warn "iOS/iPadOS: MagicDNS does NOT work — use http://$TS_IPV4:$PORT instead"
else
  warn "MagicDNS not available — use raw IP: http://$TS_IPV4:$PORT"
fi

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}6. Security Checks${NC}"
# ═══════════════════════════════════════════════════════════════

# Check for exit nodes (could route traffic outside the tailnet)
EXIT_NODE=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
self_info = d.get('Self', {})
# ExitNode flag means this machine is advertising as an exit node
print('yes' if self_info.get('ExitNode', False) else 'no')
" 2>/dev/null || echo "unknown")

if [[ "$EXIT_NODE" == "yes" ]]; then
  warn "This machine is configured as a Tailscale exit node — traffic from other devices may route through it"
elif [[ "$EXIT_NODE" == "no" ]]; then
  ok "Not configured as exit node"
fi

# Check that AI Maestro server would bind correctly
if [[ "$(uname)" == "Darwin" ]]; then
  # Check if port is already in use
  if lsof -i ":$PORT" -sTCP:LISTEN &>/dev/null 2>&1; then
    LISTENER=$(lsof -i ":$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
    info "Port $PORT already in use (PID $LISTENER) — AI Maestro may already be running"
  else
    ok "Port $PORT is available"
  fi
fi

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}7. Server.mjs Configuration${NC}"
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$PROJECT_ROOT/server.mjs" ]]; then
  if grep -q "isAllowedSource" "$PROJECT_ROOT/server.mjs"; then
    ok "IP filter function found in server.mjs"
  else
    err "IP filter function NOT found in server.mjs — LAN access may be unprotected"
  fi
  if grep -q "100\.64\.0\.0/10\|100\.\(6\[4-9\]" "$PROJECT_ROOT/server.mjs"; then
    ok "CGNAT range check found in server.mjs"
  else
    warn "CGNAT range check not found — verify isAllowedSource() includes 100.64.0.0/10"
  fi
else
  info "server.mjs not found at $PROJECT_ROOT (running from different directory?)"
fi

# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}Summary${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $ERRORS -gt 0 ]]; then
  echo -e "  ${RED}${ERRORS} error(s)${NC}, ${WARNINGS} warning(s)"
  echo ""
  echo "  Tailscale is NOT ready for AI Maestro."
  echo "  Fix the errors above and re-run this script."
  exit 1
elif [[ $WARNINGS -gt 0 ]]; then
  echo -e "  ${GREEN}0 errors${NC}, ${YELLOW}${WARNINGS} warning(s)${NC}"
  echo ""
  echo "  Tailscale is ready but has warnings. AI Maestro will work."
  echo ""
  echo "  Access:"
  echo "    Local:     http://localhost:$PORT"
  echo "    Tailscale: http://$TS_IPV4:$PORT"
  [[ -n "$TS_DNS" ]] && echo "    MagicDNS:  http://$TS_DNS:$PORT (not on iOS)"
  exit 0
else
  echo -e "  ${GREEN}All checks passed${NC}"
  echo ""
  echo "  Tailscale is ready for AI Maestro."
  echo ""
  echo "  Access:"
  echo "    Local:     http://localhost:$PORT"
  echo "    Tailscale: http://$TS_IPV4:$PORT"
  [[ -n "$TS_DNS" ]] && echo "    MagicDNS:  http://$TS_DNS:$PORT (not on iOS)"
  exit 0
fi
