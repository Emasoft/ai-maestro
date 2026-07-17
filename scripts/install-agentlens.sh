#!/usr/bin/env bash
#
# install-agentlens.sh
#
# WHY (TRDD-WF0UE9BC, USER mandate 2026-07-16): make AgentlensPro an official
# ai-maestro dependency — the `agentlenspro` npm CLI, installed alongside the
# rest of the stack and available on PATH to every agent regardless of client.
#
# WHAT AgentlensPro IS: a machine-scope agent-observability CLI (~40 diagnostic
# tools — burn forensics, cost analytics, OTEL ingest), headless-safe, published
# to npm with SLSA provenance / OIDC trusted publishing. It is NOT a Claude Code
# plugin, so the `{plugin}--v{version}` git-tag mechanism does not apply — it is
# the same dependency tier as the code-analysis tooling (tldr/fastedit/distill).
# The janitor already consumes it (ai-maestro-janitor#78); the contract for the
# consumed CLI fields is locked in AgentlensPro's cliContract.janitor.test.ts.
#
# VERSION FLOOR: 2.8.0 — the STABLE janitor-consumed CLI-contract baseline. It is a
# minimum, not a pin: npm resolves `@>=FLOOR` to the NEWEST published version, so newer
# AgentlensPro releases arrive automatically. The floor is NOT bumped per feature —
# feature availability (e.g. the Analytics embed verifier) is detected at runtime.
#
# FAIL-SOFT: this script NEVER aborts and always exits 0. Idempotent: an
# `agentlenspro` already on PATH at >= the floor is left untouched. A missing
# npm, a registry hiccup, or an unpublished floor all warn and continue — an
# observability tool must never be able to brick the ai-maestro install.
#
# Usage: install-agentlens.sh [-y|--yes] [-h|--help]
#   -y, --yes   Non-interactive (assume yes; no prompts)
# Env equivalents (flags win): NONINTERACTIVE=1 | CI=1 -> -y

set -u

AGENTLENS_NPM_PKG="agentlenspro"
AGENTLENS_VERSION_FLOOR="2.8.0"

# --- source the single-source-of-truth overrides if present ---------------
_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$_SELF_DIR/ecosystem-config.sh" ]; then
    # shellcheck source=/dev/null
    . "$_SELF_DIR/ecosystem-config.sh" 2>/dev/null || true
fi

_info()  { printf '   %s\n' "$*"; }
_ok()    { printf '   \033[32m✓\033[0m %s\n' "$*"; }
_warn()  { printf '   \033[33m⚠\033[0m %s\n' "$*"; }

NONINTERACTIVE=false
[ "${NONINTERACTIVE:-}" = "1" ] && NONINTERACTIVE=true
[ "${CI:-}" = "1" ] && NONINTERACTIVE=true
while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes) NONINTERACTIVE=true; shift ;;
        -h|--help)
            sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) shift ;;
    esac
done

# semver >= compare: returns 0 (true) when $1 >= $2. Pure sort -V, no deps.
_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

# Launch the AgentlensPro background server via its OWN CLI. User-agnostic + cross-platform:
# the CLI resolves ~/.agentlens from the RUNNING user's HOME on any machine/OS and handles its
# own platform specifics (macOS/Linux; Windows via WSL2). Idempotent (`server start` is a ~0.04s
# no-op when already up) and fail-soft (a failed launch never aborts the install). Starting the
# server is ALSO what CREATES ~/.agentlens/embed-key (mode 0600), which the ai-maestro Analytics
# reverse proxy needs to sign the viewer-role assertion (TRDD-YY6M8Z16). Skipped under CI — a
# build box is not "a user's computer", and a lingering server there serves nobody.
_ensure_server_running() {
    command -v "$AGENTLENS_NPM_PKG" >/dev/null 2>&1 || return 0
    if [ "${CI:-}" = "1" ]; then
        _info "CI detected — not launching the server (start it with: $AGENTLENS_NPM_PKG server start)."
        return 0
    fi
    if "$AGENTLENS_NPM_PKG" server status >/dev/null 2>&1; then
        _ok "AgentlensPro server already running."
        return 0
    fi
    _info "Launching the AgentlensPro server (background)..."
    if "$AGENTLENS_NPM_PKG" server start >/dev/null 2>&1; then
        _ok "AgentlensPro server started (Analytics tab now renders; boot also creates ~/.agentlens/embed-key)."
    else
        _warn "Could not start the AgentlensPro server. Start it later with: $AGENTLENS_NPM_PKG server start"
    fi
}

echo ""
echo "📈 AgentlensPro (agent observability CLI) — official ai-maestro dependency"

# 1. Idempotency: already present at >= floor?
if command -v "$AGENTLENS_NPM_PKG" >/dev/null 2>&1; then
    CUR="$("$AGENTLENS_NPM_PKG" --version 2>/dev/null | tr -dc '0-9.' )"
    if [ -n "$CUR" ] && _ge "$CUR" "$AGENTLENS_VERSION_FLOOR"; then
        _ok "$AGENTLENS_NPM_PKG $CUR already installed (>= $AGENTLENS_VERSION_FLOOR)."
        _ensure_server_running
        exit 0
    fi
    _info "$AGENTLENS_NPM_PKG ${CUR:-?} present but below the $AGENTLENS_VERSION_FLOOR floor — upgrading."
fi

# 2. npm must exist.
if ! command -v npm >/dev/null 2>&1; then
    _warn "npm not found — cannot install $AGENTLENS_NPM_PKG. Install Node/npm, then re-run this script."
    exit 0
fi

# 3. Consent (interactive only).
if [ "$NONINTERACTIVE" != true ]; then
    printf '   Install %s (>= %s) globally via npm now? (y/N): ' "$AGENTLENS_NPM_PKG" "$AGENTLENS_VERSION_FLOOR"
    read -r ANS
    case "$ANS" in
        [Yy]*) : ;;
        *) _info "Skipping AgentlensPro (install later: scripts/install-agentlens.sh)"; exit 0 ;;
    esac
fi

# 4. Is the floor actually published? (owner-gated: 2.8.0 tag/publish.)
LATEST="$(npm view "$AGENTLENS_NPM_PKG" version 2>/dev/null | tr -dc '0-9.')"
if [ -n "$LATEST" ] && ! _ge "$LATEST" "$AGENTLENS_VERSION_FLOOR"; then
    _warn "npm latest for $AGENTLENS_NPM_PKG is $LATEST — below the $AGENTLENS_VERSION_FLOOR floor."
    _warn "The floor $AGENTLENS_VERSION_FLOOR (locked-contract release) is not published yet — owner must publish/tag it."
    _warn "Skipping for now; re-run scripts/install-agentlens.sh once $AGENTLENS_VERSION_FLOOR lands on npm."
    exit 0
fi

# 5. Install (pinned to the floor). Fail-soft.
_info "Installing $AGENTLENS_NPM_PKG@>=$AGENTLENS_VERSION_FLOOR globally..."
if npm install -g "${AGENTLENS_NPM_PKG}@>=${AGENTLENS_VERSION_FLOOR}" >/dev/null 2>&1; then
    NEW="$("$AGENTLENS_NPM_PKG" --version 2>/dev/null | tr -dc '0-9.')"
    if [ -n "$NEW" ] && _ge "$NEW" "$AGENTLENS_VERSION_FLOOR"; then
        _ok "AgentlensPro $NEW installed and on PATH."
        _ensure_server_running
    else
        _warn "npm reported success but $AGENTLENS_NPM_PKG is not resolvable at the floor — check your npm global bin on PATH."
    fi
else
    _warn "npm install of $AGENTLENS_NPM_PKG failed (registry/permissions?). Install later: scripts/install-agentlens.sh"
fi

exit 0
