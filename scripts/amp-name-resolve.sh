#!/usr/bin/env bash
# =============================================================================
# AMP Name Resolution — shared --name <agentName> -> --id <uuid> resolver
# (TRDD-VGTXJTZ3)
# =============================================================================
#
# Every amp-*.sh entry point already accepts an `--id <uuid>` identity flag,
# but per-agent homes are UUID-keyed (~/.agent-messaging/agents/<uuid>/) and
# a human operator (or a scenario author) cannot reasonably type or memorize
# a UUID. The name -> UUID map already exists on disk at
# ~/.agent-messaging/agents/.index.json — amp-helper.sh's own `_index_lookup`
# reads the same file for its CLAUDE_AGENT_NAME env-var resolution path
# (added by TRDD-5KKO25RO fix-1b for signature verification). This file
# exposes that same lookup as an explicit `--name` CLI flag.
#
# WHY a separate file instead of just reusing amp-helper.sh's _index_lookup:
# the flag has to be resolved in the PRE-SOURCE phase of each script — i.e.
# BEFORE amp-helper.sh itself is sourced, because the pre-source phase is
# what decides CLAUDE_AGENT_ID (which amp-helper.sh then reads). At that
# point amp-helper.sh's functions do not exist yet. Sourced on-demand (only
# when `--name` is actually present) so scripts that never use --name never
# pay the extra sourcing cost.
# =============================================================================

# _amp_resolve_name_to_id <name> — resolve an agent NAME to its UUID via
# .index.json. Prints the UUID on stdout and returns 0 on exactly one match;
# prints an actionable error (with candidate names) to stderr and returns 1
# on zero or ambiguous matches. Deliberately stricter than amp-helper.sh's
# own _index_lookup (which silently picks the first case-insensitive match)
# because --name is an EXPLICIT operator intent — silently picking the wrong
# agent's identity is worse than a loud, listed-candidates failure.
_amp_resolve_name_to_id() {
    local name="$1"
    local index_file="${HOME}/.agent-messaging/agents/.index.json"

    if [ ! -f "$index_file" ]; then
        echo "Error: --name '${name}' cannot be resolved — no agents index found at ${index_file}." >&2
        echo "Use --id <uuid> instead, or run amp-init.sh --name <your-agent-name> first." >&2
        return 1
    fi

    # Exact match first — the common case, and the only match jq's key
    # lookup needs (case-sensitive, byte-identical key).
    local uuid
    uuid=$(jq -r --arg name "$name" '.[$name] // empty' "$index_file" 2>/dev/null)
    if [ -n "$uuid" ]; then
        echo "$uuid"
        return 0
    fi

    # Case-insensitive fallback + ambiguity detection: collect EVERY key
    # whose lowercased form matches, so two differently-cased names (e.g.
    # "Alice" and "alice") are reported as ambiguous instead of silently
    # resolving to whichever happens to sort first.
    local lower_name matches match_count
    lower_name=$(echo "$name" | tr '[:upper:]' '[:lower:]')
    matches=$(jq -r --arg name "$lower_name" \
        'to_entries[] | select(.key | ascii_downcase == $name) | "\(.key)\t\(.value)"' \
        "$index_file" 2>/dev/null)
    match_count=$(printf '%s\n' "$matches" | grep -c . || true)

    if [ "$match_count" -eq 1 ]; then
        printf '%s\n' "$matches" | cut -f2
        return 0
    fi

    if [ "$match_count" -gt 1 ]; then
        echo "Error: --name '${name}' is ambiguous — ${match_count} agents match case-insensitively:" >&2
        printf '%s\n' "$matches" | while IFS=$'\t' read -r cand_name cand_uuid; do
            printf "  %-30s %s\n" "$cand_name" "$cand_uuid" >&2
        done
        echo "Use --id <uuid> to disambiguate." >&2
        return 1
    fi

    echo "Error: --name '${name}' not found." >&2
    local candidates
    candidates=$(jq -r 'keys[]' "$index_file" 2>/dev/null)
    if [ -n "$candidates" ]; then
        echo "" >&2
        echo "Available agents:" >&2
        printf '%s\n' "$candidates" | while IFS= read -r cand_name; do
            echo "  ${cand_name}" >&2
        done
    fi
    return 1
}
