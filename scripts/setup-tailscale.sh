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
    -h|--help)
      sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      # Fail fast on a typo rather than silently running with the default
      # behaviour — a mistyped --instal must not look like a successful check.
      echo "unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# --check advertises "no changes". Installing is the only thing this script can
# change, so the two are contradictory — refuse rather than silently letting one
# win. Previously --check was parsed and never read, so it promised a guarantee
# it did not provide.
if [[ "$CHECK_ONLY" == true && "$INSTALL" == true ]]; then
  echo "--check and --install are mutually exclusive: --check means make no changes." >&2
  exit 2
fi

echo ""
echo -e "${BOLD}AI Maestro — Tailscale VPN Setup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}1. Tailscale Installation${NC}"
# ═══════════════════════════════════════════════════════════════

if ! command -v tailscale &>/dev/null; then
  # CHECK_ONLY is re-asserted here rather than relying only on the
  # mutual-exclusion check above: this is the single point where the script can
  # change the machine, so the "no changes" promise is enforced AT the mutation,
  # not merely at argument parsing.
  if [[ "$INSTALL" == true && "$CHECK_ONLY" != true ]]; then
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

# Exit node + advertised subnet routes. Both widen what this host carries for the
# rest of the tailnet, which is why they belong in a script that certifies the
# network posture.
#
# TWO BUGS FIXED HERE, both of which made this section quietly say "fine":
#
#   1. It read `Self.ExitNode`, which means "this is the exit node I am USING" —
#      for Self that is essentially never true, so the check reported "not an
#      exit node" no matter what. The field that means "this node OFFERS itself
#      as an exit node" is `Self.ExitNodeOption`.
#   2. The header has always advertised check #5, "verifies no subnet routes are
#      exposing the host", and no such check existed anywhere in the body. A
#      security claim in the documentation with no code behind it is worse than
#      an absent check, because a reader stops looking.
#
# One python call emits both facts plus an explicit status token, so a missing
# python3 or unparseable JSON is REPORTED rather than silently skipped — the old
# code fell through to `unknown` and then printed nothing at all.
TS_SEC=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
try:
    s = json.load(sys.stdin).get('Self', {}) or {}
except Exception:
    print('status=unparseable'); sys.exit(0)
# PrimaryRoutes is absent/null unless this node advertises subnet routes.
routes = [r for r in (s.get('PrimaryRoutes') or []) if not r.endswith('/32') and not r.endswith('/128')]
print('status=ok')
print('exit_node=' + ('yes' if s.get('ExitNodeOption') else 'no'))
print('routes=' + (','.join(routes) if routes else 'none'))
" 2>/dev/null || echo "status=nopython")

ts_sec_field() { printf '%s\n' "$TS_SEC" | sed -n "s/^$1=//p" | head -1; }
TS_SEC_STATUS=$(ts_sec_field status)

case "$TS_SEC_STATUS" in
  ok)
    if [[ "$(ts_sec_field exit_node)" == "yes" ]]; then
      warn "This host ADVERTISES itself as a Tailscale exit node — other devices' traffic may route through it"
    else
      ok "Not advertising as an exit node"
    fi

    TS_ROUTES=$(ts_sec_field routes)
    if [[ "$TS_ROUTES" == "none" ]]; then
      ok "No subnet routes advertised (host is not bridging another network into the tailnet)"
    else
      warn "This host ADVERTISES subnet routes: $TS_ROUTES"
      info "A subnet router bridges those networks into the tailnet. AI Maestro's own filter still"
      info "admits only loopback + tailnet peers, but review whether this bridging is intended."
    fi
    ;;
  nopython)
    warn "python3 not available — could not check exit-node / subnet-route posture"
    ;;
  *)
    warn "Could not parse 'tailscale status --json' — exit-node / subnet-route posture UNKNOWN"
    ;;
esac

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

# The filter lives in lib/tailscale-detect.mjs and is WIRED by server.mjs. Both
# halves are asserted: a filter nothing imports protects nothing, and an import
# of a filter that lost its range check protects nothing either.
#
# grep is used with THREE outcomes, never two. `if grep -q …` collapses "no
# match" and "could not read the file" into the same branch, so a broken pattern
# or an unreadable file reports as "the guard is missing" — a false alarm that
# trains the reader to ignore this section. (That is not hypothetical: the
# previous pattern here was `100\.\(6\[4-9\]`, an unclosed BRE group. It exited
# 2 with "mismatched ( )" on every run, so this check warned unconditionally,
# whatever the file said.)
# 0 = found, 1 = absent, 2 = could not read/scan.
# Callers MUST use `scan …` (below) rather than calling this bare: under
# `set -e` a bare call that returns non-zero aborts the whole script.
grep_status() {
  local rc=0
  grep -Eq "$1" "$2" 2>/dev/null || rc=$?
  [[ $rc -gt 1 ]] && return 2
  return "$rc"
}

# Runs a check and reports it. $3=ok text, $4=absent text (err), $5=unreadable text (err).
scan() {
  local rc=0
  grep_status "$1" "$2" || rc=$?
  case $rc in
    0) ok "$3" ;;
    1) err "$4" ;;
    2) err "$5" ;;
  esac
}

FILTER_LIB="$PROJECT_ROOT/lib/tailscale-detect.mjs"

if [[ -f "$FILTER_LIB" ]]; then
  # Anchored on the opening paren: an unanchored 'isAllowedSource' is also
  # matched by isAllowedSourceAnything, so a rename would read as present.
  # (Caught by neutering this very check — it passed against a renamed export.)
  scan 'export function isAllowedSource\(' "$FILTER_LIB" \
    "IP filter isAllowedSource() defined in lib/tailscale-detect.mjs" \
    "isAllowedSource() NOT defined in lib/tailscale-detect.mjs — LAN access may be unprotected" \
    "could not scan lib/tailscale-detect.mjs — cannot confirm the IP filter"

  # 100.64.0.0/10 is 100.64.x - 100.127.x. Accept either the written-out
  # alternation the filter uses or a literal CIDR mention.
  #
  # The group is BALANCED on purpose. An earlier version ended with a bare `)`
  # and behaved differently per implementation: BSD grep accepted it (treating
  # the stray paren as a literal) while ugrep REJECTED it with "mismatched ( )"
  # and exited 2 — so the same check said "found" on one machine and "could not
  # scan" on the next. A pattern whose meaning depends on which grep is on PATH
  # is not a check.
  scan '(100\\\.\(6\[4-9\]|100\.64\.0\.0/10)' "$FILTER_LIB" \
    "CGNAT range check (100.64.0.0/10) found in the filter" \
    "CGNAT range check NOT found — isAllowedSource() must match 100.64.0.0/10" \
    "could not scan lib/tailscale-detect.mjs for the CGNAT range"
else
  err "lib/tailscale-detect.mjs not found at $PROJECT_ROOT — the IP filter is missing"
fi

if [[ -f "$PROJECT_ROOT/server.mjs" ]]; then
  # Must IMPORT it, not merely mention it: after the filter moved into its own
  # module, a bare name match was satisfied by a comment.
  scan 'import \{[^}]*isAllowedSource' "$PROJECT_ROOT/server.mjs" \
    "server.mjs imports the IP filter" \
    "server.mjs does NOT import isAllowedSource — the filter is not wired in" \
    "could not scan server.mjs — cannot confirm the filter is wired in"
else
  info "server.mjs not found at $PROJECT_ROOT (running from an installed copy?)"
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
