#!/bin/bash
# =============================================================================
# maestro-auth.sh — Get the best available auth token for AI Maestro API calls
# =============================================================================
#
# Usage:
#   TOKEN=$(maestro-auth.sh)
#   curl -H "Authorization: Bearer $TOKEN" http://localhost:23000/api/...
#
# Priority:
#   1. MAESTRO_AUTH env var (session secret, set by AI Maestro at launch)
#   2. aid-maestro-token.sh (AID proof-of-possession, for remote agents)
#   3. AMP API key from config (legacy fallback)
#
# =============================================================================

# 1. Session secret (fastest — no network call, set by server at launch)
if [ -n "${MAESTRO_AUTH:-}" ]; then
  echo "$MAESTRO_AUTH"
  exit 0
fi

# 2. AID token (for remote agents — requires Ed25519 proof)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -x "${SCRIPT_DIR}/aid-maestro-token.sh" ]; then
  TOKEN=$("${SCRIPT_DIR}/aid-maestro-token.sh" --quiet 2>/dev/null)
  if [ -n "$TOKEN" ]; then
    echo "$TOKEN"
    exit 0
  fi
fi

# Also check PATH
if command -v aid-maestro-token.sh &>/dev/null; then
  TOKEN=$(aid-maestro-token.sh --quiet 2>/dev/null)
  if [ -n "$TOKEN" ]; then
    echo "$TOKEN"
    exit 0
  fi
fi

# 3. AMP API key (legacy fallback)
if [ -n "${AMP_DIR:-}" ] && [ -f "${AMP_DIR}/api-key" ]; then
  cat "${AMP_DIR}/api-key"
  exit 0
fi

# No auth available
echo "ERROR: No authentication method available. Set MAESTRO_AUTH env var or run aid-init." >&2
exit 1
