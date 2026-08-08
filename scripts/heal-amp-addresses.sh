#!/usr/bin/env bash
# heal-amp-addresses.sh — batch repair of stale AMP config addresses.
#
# Context (TRDD-17K0SHDQ, W-A): a registrar bug once stamped
# `.agent.address` with the REGISTRAR's own cwd-derived name instead of
# the agent's own registered name, leaving many configs sharing one
# byte-identical, wrong address. scripts/amp-helper.sh::load_config()
# self-heals this per-agent, but only when that agent is actually used.
# This sweep applies the same repair in batch, across every registered
# agent config, without requiring each one to run first.
#
# Repair contract (mirrors amp-helper.sh's self-heal OUTCOME, not its
# code path — see save_config()'s `address = "${name}@${tenant}.${domain}"`):
#   - The authoritative name for a config is looked up by INVERTING
#     .index.json (uuid -> name), never trusted from the config's own
#     .agent.name field, so an index/config disagreement is still caught.
#   - Only .agent.address's LOCAL PART (before the first '@') is
#     rewritten to the authoritative name. Everything after the first
#     '@' (tenant + domain) is preserved verbatim — we are not
#     re-deriving the domain, only correcting who's-address-is-this.
#   - EVERY OTHER FIELD in the config — most importantly .agent.id and
#     .agent.createdAt — is preserved byte-for-byte. This is the fix for
#     the 6c6b75b4 regression: a repair that rebuilds the agent object
#     from scratch and forgets to pass `id`/`createdAt` back in silently
#     de-registers the agent (its uuid IS its identity in .index.json and
#     every message envelope) and resets its age to now. We never rebuild
#     the object — we do a single `jq '.agent.address = $new'` in place.
#   - A uuid directory whose uuid is NOT present in .index.json is an
#     ORPHAN. Orphan GC is explicitly out of scope for this sweep: we
#     report it and touch NOTHING (no repair, no delete).
#   - Every write is atomic: jq output goes to a tmp file in the SAME
#     directory as the target, then `mv` replaces the target. A crash or
#     interruption mid-run can never leave a config half-written.
#
# Modes:
#   --dry-run   report what WOULD change; write nothing (safe to run any time)
#   (default)   apply the repairs described above
#
# Idempotent: a second run (in either mode) reports 0 repairs, because the
# first run already brought every non-orphan config's address local-part
# in line with its authoritative name.
#
# Exit codes (three-way, findings are not errors):
#   0 — sweep completed (repairs/clean/orphans are all normal outcomes)
#   2 — could not run (e.g. .index.json missing or unreadable — this is
#       a setup failure, distinct from "the sweep ran and found nothing")

set -euo pipefail

AGENTS_DIR="${AMP_ADDRESS_HEAL_AGENTS_DIR:-$HOME/.agent-messaging/agents}"
INDEX_FILE="${AGENTS_DIR}/.index.json"

DRY_RUN=false
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        -h|--help)
            echo "Usage: $0 [--dry-run]"
            echo "  --dry-run   report what would change; write nothing"
            echo "  (default)   apply the repairs"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--dry-run]" >&2
            exit 2
            ;;
    esac
done

if ! command -v jq >/dev/null 2>&1; then
    echo "amp-address-heal-sweep: jq is required but not on PATH" >&2
    exit 2
fi

if [ ! -f "$INDEX_FILE" ]; then
    echo "amp-address-heal-sweep: index not found or unreadable: $INDEX_FILE" >&2
    exit 2
fi

if ! jq -e 'type == "object"' "$INDEX_FILE" >/dev/null 2>&1; then
    echo "amp-address-heal-sweep: index is not valid JSON: $INDEX_FILE" >&2
    exit 2
fi

if [ ! -d "$AGENTS_DIR" ]; then
    echo "amp-address-heal-sweep: agents dir not found: $AGENTS_DIR" >&2
    exit 2
fi

UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

n_scanned=0
n_repair=0
n_clean=0
n_orphan=0
n_skip_not_uuid=0
n_skip_unreadable=0

# Iterate every immediate subdirectory that carries a config.json. -print0/
# read -r -d '' keeps this safe against directory names containing spaces.
while IFS= read -r -d '' cfg; do
    dir=$(dirname "$cfg")
    uuid=$(basename "$dir")
    n_scanned=$((n_scanned + 1))

    if [[ ! "$uuid" =~ $UUID_RE ]]; then
        # Not a uuid-named agent directory — outside this sweep's scope
        # (the modern layout keys agents by uuid; anything else is a
        # legacy/manual dir this repair contract was not written for).
        echo "SKIP-NOT-UUID  $cfg"
        n_skip_not_uuid=$((n_skip_not_uuid + 1))
        continue
    fi

    if ! jq -e '.' "$cfg" >/dev/null 2>&1; then
        echo "SKIP-UNREADABLE  $cfg"
        n_skip_unreadable=$((n_skip_unreadable + 1))
        continue
    fi

    # Invert .index.json (name -> uuid) to find the authoritative name for
    # THIS uuid. We do this per-config via jq rather than trusting the
    # config's own .agent.name, so a config/index disagreement is still
    # surfaced (it would show up as ORPHAN if the uuid isn't indexed, or
    # as a repair target if the index name differs from the current
    # address local-part).
    # Hard-fail on an ambiguous index (two names claiming one uuid) instead
    # of silently picking the first — silent first-match-wins is the exact
    # defect class TRDD-17K0SHDQ exists to remove; an ambiguous index is a
    # registry anomaly to surface, never to guess through.
    name_matches=$(jq -r --arg uuid "$uuid" \
        '[to_entries[] | select(.value == $uuid) | .key] | length' \
        "$INDEX_FILE")
    if [ "$name_matches" -gt 1 ]; then
        echo "AMBIGUOUS-INDEX  $cfg  uuid=${uuid} has ${name_matches} index names — SKIPPED, not touched"
        n_skip_unreadable=$((n_skip_unreadable + 1))
        continue
    fi
    expected_name=$(jq -r --arg uuid "$uuid" \
        'to_entries | map(select(.value == $uuid)) | .[0].key // empty' \
        "$INDEX_FILE")

    if [ -z "$expected_name" ]; then
        addr=$(jq -r '.agent.address // "(missing)"' "$cfg")
        echo "ORPHAN  $cfg  uuid=${uuid} address=${addr}  (not in .index.json — SKIPPED, not touched)"
        n_orphan=$((n_orphan + 1))
        continue
    fi

    current_addr=$(jq -r '.agent.address // empty' "$cfg")
    if [ -z "$current_addr" ]; then
        echo "SKIP-UNREADABLE  $cfg  (no .agent.address field)"
        n_skip_unreadable=$((n_skip_unreadable + 1))
        continue
    fi

    current_local="${current_addr%%@*}"
    current_domain="${current_addr#*@}"

    if [ "$current_local" = "$expected_name" ]; then
        echo "CLEAN  $cfg  address=${current_addr}"
        n_clean=$((n_clean + 1))
        continue
    fi

    new_addr="${expected_name}@${current_domain}"

    if [ "$DRY_RUN" = true ]; then
        echo "REPAIR  $cfg  ${current_addr} -> ${new_addr}  (dry-run, not written)"
        n_repair=$((n_repair + 1))
        continue
    fi

    # Atomic write: modify ONLY .agent.address, every other field passes
    # through byte-for-byte (including .agent.id and .agent.createdAt —
    # the 6c6b75b4 regression this sweep must not repeat). Write to a tmp
    # file in the SAME directory (so the final `mv` is same-filesystem and
    # atomic), then replace the target.
    tmp="${dir}/.config.json.heal-tmp.$$"
    if jq --arg addr "$new_addr" '.agent.address = $addr' "$cfg" > "$tmp"; then
        mv -f "$tmp" "$cfg"
        echo "REPAIR  $cfg  ${current_addr} -> ${new_addr}"
        n_repair=$((n_repair + 1))
    else
        rm -f "$tmp"
        echo "SKIP-UNREADABLE  $cfg  (jq rewrite failed)"
        n_skip_unreadable=$((n_skip_unreadable + 1))
    fi
done < <(find "$AGENTS_DIR" -mindepth 2 -maxdepth 2 -name config.json -print0)

echo ""
echo "=== amp-address-heal-sweep summary ==="
if [ "$DRY_RUN" = true ]; then
    echo "mode: DRY-RUN (nothing written)"
else
    echo "mode: APPLY"
fi
echo "configs scanned:     $n_scanned"
echo "repaired:             $n_repair"
echo "already clean:        $n_clean"
echo "orphans (skipped):    $n_orphan"
echo "skipped (not uuid):   $n_skip_not_uuid"
echo "skipped (unreadable): $n_skip_unreadable"

exit 0
