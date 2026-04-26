#!/bin/bash
# =============================================================================
# AID Maestro Token — Request governance token from AI Maestro
# =============================================================================
#
# Exchanges an Ed25519 proof-of-possession for a short-lived governance
# token (aim_tk_*) from the local AI Maestro server.
#
# Usage:
#   aid-maestro-token.sh                    # Interactive output
#   aid-maestro-token.sh --quiet            # Token only (for piping)
#   TOKEN=$(aid-maestro-token.sh --quiet)   # Use in scripts
#   aid-maestro-token.sh --json             # Full JSON response
#   aid-maestro-token.sh --no-cache         # Force new token
#
# Prerequisites:
#   - Agent identity initialized (aid-init --auto)
#   - Agent registered with AI Maestro (amp-register.sh --provider localhost:23000)
#   - AI Maestro running on localhost:23000
#
# =============================================================================

set -e

# Source AID helper for identity, keys, and signing
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/aid-helper.sh"

# =============================================================================
# Arguments
# =============================================================================

MAESTRO_URL="${MAESTRO_URL:-http://localhost:${MAESTRO_PORT:-23000}}"
SCOPE="governance"
OUTPUT_FORMAT="text"
NO_CACHE=false

show_help() {
    echo "Usage: aid-maestro-token [options]"
    echo ""
    echo "Request an AI Maestro governance token using Agent Identity."
    echo ""
    echo "Options:"
    echo "  --url, -u URL           AI Maestro URL (default: http://localhost:23000)"
    echo "  --scope, -s SCOPE       Token scope (default: governance)"
    echo "  --json, -j              Output as JSON"
    echo "  --no-cache              Skip token cache, always request new token"
    echo "  --quiet, -q             Output only the access token (for piping)"
    echo "  --help, -h              Show this help"
    echo ""
    echo "Examples:"
    echo "  # Get token for governance API calls"
    echo "  aid-maestro-token"
    echo ""
    echo "  # Use in API calls"
    echo "  TOKEN=\$(aid-maestro-token -q)"
    echo "  curl -H \"Authorization: Bearer \$TOKEN\" http://localhost:23000/api/agents/..."
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --url|-u)
            MAESTRO_URL="$2"
            shift 2
            ;;
        --scope|-s)
            SCOPE="$2"
            shift 2
            ;;
        --json|-j)
            OUTPUT_FORMAT="json"
            shift
            ;;
        --no-cache)
            NO_CACHE=true
            shift
            ;;
        --quiet|-q)
            OUTPUT_FORMAT="quiet"
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Run 'aid-maestro-token --help' for usage." >&2
            exit 1
            ;;
    esac
done

# =============================================================================
# Load Agent Identity
# =============================================================================

if ! is_initialized; then
    echo "Error: Agent identity not initialized." >&2
    echo "Run: aid-init --auto" >&2
    exit 1
fi

load_config
require_openssl

PRIVATE_KEY="${AMP_KEYS_DIR}/private.pem"
PUBLIC_KEY="${AMP_KEYS_DIR}/public.pem"

if [ ! -f "$PRIVATE_KEY" ] || [ ! -f "$PUBLIC_KEY" ]; then
    echo "Error: Agent keys not found at ${AMP_KEYS_DIR}/" >&2
    exit 1
fi

# =============================================================================
# Token Cache
# =============================================================================

MAESTRO_CACHE_DIR="${AMP_DIR}/tokens"
mkdir -p "$MAESTRO_CACHE_DIR"

# Cache key derived from server URL
cache_key() {
    echo "maestro_$(echo "$MAESTRO_URL" | shasum -a 256 | cut -c1-16)"
}

check_cache() {
    local cache_file="${MAESTRO_CACHE_DIR}/$(cache_key).json"

    if [ ! -f "$cache_file" ]; then
        return 1
    fi

    local expires_at
    expires_at=$(jq -r '.expires_at // 0' "$cache_file" 2>/dev/null)
    local now
    now=$(date +%s)

    # Valid if not expired (with 60-second buffer)
    if [ "$expires_at" -gt $((now + 60)) ] 2>/dev/null; then
        cat "$cache_file"
        return 0
    fi

    # Expired
    rm -f "$cache_file"
    return 1
}

save_cache() {
    local response="$1"
    local cache_file="${MAESTRO_CACHE_DIR}/$(cache_key).json"

    local expires_in
    expires_in=$(echo "$response" | jq -r '.expires_in // 3600')
    local expires_at
    expires_at=$(( $(date +%s) + expires_in ))

    echo "$response" | jq --arg ea "$expires_at" --arg url "$MAESTRO_URL" \
        '. + {expires_at: ($ea | tonumber), maestro_url: $url}' \
        > "$cache_file"
    chmod 600 "$cache_file"
}

# =============================================================================
# Check cache first
# =============================================================================

if [ "$NO_CACHE" = false ]; then
    cached_response=$(check_cache 2>/dev/null) || true
    if [ -n "$cached_response" ]; then
        case "$OUTPUT_FORMAT" in
            json)
                echo "$cached_response"
                ;;
            quiet)
                echo "$cached_response" | jq -r '.access_token'
                ;;
            *)
                echo "Governance token (cached)"
                echo ""
                echo "  Server:     ${MAESTRO_URL}"
                echo "  Agent:      ${AMP_AGENT_NAME}"
                echo "  Title:      $(echo "$cached_response" | jq -r '.governance_title // "?"')"
                echo "  Team:       $(echo "$cached_response" | jq -r '.team_id // "none"')"
                echo "  Expires in: $(echo "$cached_response" | jq -r '.expires_in // "?"')s"
                echo ""
                echo "  Token: $(echo "$cached_response" | jq -r '.access_token' | cut -c1-20)..."
                ;;
        esac
        exit 0
    fi
fi

# =============================================================================
# Build Agent Identity Document
# =============================================================================

PUBLIC_KEY_PEM=$(cat "$PUBLIC_KEY")

AGENT_IDENTITY=$(jq -n \
    --arg version "1.0" \
    --arg address "$AMP_ADDRESS" \
    --arg alias "$AMP_AGENT_NAME" \
    --arg public_key "$PUBLIC_KEY_PEM" \
    --arg key_algorithm "Ed25519" \
    --arg fingerprint "$AMP_FINGERPRINT" \
    --arg issued_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
        aid_version: $version,
        address: $address,
        alias: $alias,
        public_key: $public_key,
        key_algorithm: $key_algorithm,
        fingerprint: $fingerprint,
        issued_at: $issued_at
    }')

# Sign the Agent Identity document
IDENTITY_SIGNATURE=$(sign_message "$AGENT_IDENTITY")
if [ -z "$IDENTITY_SIGNATURE" ]; then
    echo "Error: Failed to sign Agent Identity document" >&2
    exit 1
fi

# Add signature to identity
SIGNED_IDENTITY=$(echo "$AGENT_IDENTITY" | jq --arg sig "$IDENTITY_SIGNATURE" '. + {signature: $sig}')

# Base64url encode
AGENT_IDENTITY_B64=$(echo -n "$SIGNED_IDENTITY" | base64 | tr '+/' '-_' | tr -d '=\n')

# =============================================================================
# Build Proof of Possession
# =============================================================================

TIMESTAMP=$(date +%s)

SIGN_INPUT="aid-token-exchange
${TIMESTAMP}
${MAESTRO_URL}"

# Sign the proof
PROOF_SIGNATURE_B64=$(sign_message "$SIGN_INPUT")
if [ -z "$PROOF_SIGNATURE_B64" ]; then
    echo "Error: Failed to sign proof of possession" >&2
    exit 1
fi

# Proof = [signature bytes (64)][timestamp string], then base64url encode
PROOF_B64=$(
    {
        echo -n "$PROOF_SIGNATURE_B64" | base64 -d
        echo -n "$TIMESTAMP"
    } | base64 | tr '+/' '-_' | tr -d '=\n'
)

# =============================================================================
# Token Request
# =============================================================================

TOKEN_URL="${MAESTRO_URL}/api/v1/auth/token"

REQUEST_BODY=$(jq -n \
    --arg grant_type "urn:aid:agent-identity" \
    --arg agent_identity "$AGENT_IDENTITY_B64" \
    --arg proof "$PROOF_B64" \
    --arg scope "$SCOPE" \
    '{grant_type: $grant_type, agent_identity: $agent_identity, proof: $proof, scope: $scope}')

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$TOKEN_URL" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY" \
    --connect-timeout 10 \
    --max-time 30 \
    2>/dev/null) || {
    echo "Error: Failed to connect to AI Maestro at ${TOKEN_URL}" >&2
    exit 1
}

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -1)

# =============================================================================
# Handle Response
# =============================================================================

if [ "$HTTP_STATUS" = "200" ]; then
    save_cache "$HTTP_BODY"

    case "$OUTPUT_FORMAT" in
        json)
            echo "$HTTP_BODY"
            ;;
        quiet)
            echo "$HTTP_BODY" | jq -r '.access_token'
            ;;
        *)
            echo "Governance token issued"
            echo ""
            echo "  Server:     ${MAESTRO_URL}"
            echo "  Agent:      ${AMP_AGENT_NAME}"
            echo "  Title:      $(echo "$HTTP_BODY" | jq -r '.governance_title // "?"')"
            echo "  Team:       $(echo "$HTTP_BODY" | jq -r '.team_id // "none"')"
            echo "  Scope:      $(echo "$HTTP_BODY" | jq -r '.scope // "governance"')"
            echo "  Expires in: $(echo "$HTTP_BODY" | jq -r '.expires_in // "?"')s"
            echo ""
            echo "  Token: $(echo "$HTTP_BODY" | jq -r '.access_token' | cut -c1-20)..."
            ;;
    esac
    exit 0
else
    ERROR_MSG=$(echo "$HTTP_BODY" | jq -r '.message // .error // "Unknown error"' 2>/dev/null || echo "HTTP ${HTTP_STATUS}")
    echo "Error: Token exchange failed (${HTTP_STATUS}): ${ERROR_MSG}" >&2

    if [ "$OUTPUT_FORMAT" = "json" ]; then
        echo "$HTTP_BODY" >&2
    fi

    exit 1
fi
