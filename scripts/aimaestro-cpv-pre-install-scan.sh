#!/usr/bin/env bash
# Thin wrapper around CPV's pre-install security scanner (surface 1 of TRDD-523V1N4I).
#
# WHAT THIS WRAPS: `cpv_pre_install_scan.py <path|url> --json` from the newest
# claude-plugins-validation (CPV) build in the plugin cache. Read the source
# (scripts/cpv_pre_install_scan.py::main, v5.17.0) before trusting this comment —
# it is what was actually verified, not the (stale) exit-code claims recorded on
# the TRDD card itself.
#
# WHY A WRAPPER: per the plugin-abstraction rule, nothing in the ai-maestro
# script layer may hardcode a plugin-cache path or a plugin version — this
# script resolves the NEWEST cached CPV build at run time (`sort -V | tail -1`,
# never `find | head -1`, which returns the alphabetically-first version and
# was the exact trap the TRDD's own re-verification note walked into).
#
# R27 NOTE (design decision, 2026-09-05): this wrapper does NOT stamp a verdict
# into the R27 install path. It only REPORTS. Stamping a security verdict into
# the server's install path changes enforcement posture and is its own,
# separately-approved card — see TRDD-523V1N4I "Design decisions".
#
# ── EXIT CODES ──────────────────────────────────────────────────────────────
#   The wrapped tool's own contract (verified against v5.17.0 source):
#     0 = clean (safe to install)
#     1 = DO NOT INSTALL (CRITICAL or MAJOR findings)
#     2 = scan error (fetch/stage failure, or the internal validate_plugin.py
#         sub-invocation produced no JSON — e.g. a missing dependency)
#   This wrapper preserves that exit code UNCHANGED.
#   127 = WRAPPER could not locate the tool at all (no cached CPV build found,
#         its cpv_pre_install_scan.py script missing, or `uv` not on PATH).
#         This is the wrapper's OWN code — it never collides with CPV's 0/1/2.
#
# stdout: the wrapped tool's JSON, byte-for-byte, on success. On a 127 (could
# not locate the tool), a one-line JSON error object instead.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: aimaestro-cpv-pre-install-scan.sh <local-path|github-url|owner/repo|archive> [extra cpv flags...]
       aimaestro-cpv-pre-install-scan.sh -h|--help

Wraps the newest cached claude-plugins-validation (CPV) build's
cpv_pre_install_scan.py --json. Scans a skill/plugin/marketplace target
BEFORE installing it (sandboxed, static-only).

Always adds --json (idempotent if you also pass it). Any extra arguments
(e.g. --keep-sandbox) are forwarded verbatim to the wrapped tool.

Exit codes:
  0   clean — safe to install (from CPV)
  1   DO NOT INSTALL — findings present (from CPV)
  2   scan error — could not complete the scan (from CPV)
  127 wrapper could not locate CPV or its script (uv missing, no cached
      build found, or the script is absent from the newest build)

Env overrides:
  CPV_CACHE_ROOT   plugin-cache root to search (default: ~/.claude/plugins/cache)
EOF
}

for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
  esac
done

if [ "$#" -lt 1 ]; then
  usage >&2
  exit 127
fi

CACHE_ROOT="${CPV_CACHE_ROOT:-$HOME/.claude/plugins/cache}"

# Resolve the NEWEST cached claude-plugins-validation build. The cache layout
# is <root>/<marketplace>/<plugin-name>/<version>/ — three levels deep from
# CACHE_ROOT. `find` (not `ls <glob>`) so an empty/absent tree yields an empty
# result instead of a literal unmatched glob (never-count-files-with-ls-glob).
resolve_newest_cpv() {
  # `|| true` on the find is load-bearing under `set -e -o pipefail`: a
  # nonexistent CACHE_ROOT makes `find` exit non-zero, and pipefail would
  # otherwise propagate that through the pipeline and abort the whole
  # script here instead of letting the caller report a clean 127.
  [ -d "$CACHE_ROOT" ] || return 0
  find "$CACHE_ROOT" -mindepth 3 -maxdepth 3 -type d -path '*/claude-plugins-validation/*' 2>/dev/null \
    | sort -V | tail -1 || true
}

json_could_not_run() {
  # $1 = human reason. Emitted on stdout so a caller parsing JSON never has
  # to branch on where the error text landed.
  printf '{"error":"could-not-run","reason":%s}\n' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
}

if ! command -v uv >/dev/null 2>&1; then
  json_could_not_run "uv not found on PATH"
  exit 127
fi

CPV_DIR="$(resolve_newest_cpv)"
if [ -z "$CPV_DIR" ]; then
  json_could_not_run "no cached claude-plugins-validation build found under $CACHE_ROOT"
  exit 127
fi

SCAN_SCRIPT="$CPV_DIR/scripts/cpv_pre_install_scan.py"
if [ ! -f "$SCAN_SCRIPT" ]; then
  json_could_not_run "cpv_pre_install_scan.py not found in newest cached build: $CPV_DIR"
  exit 127
fi

# Forward every CLI argument verbatim (target + any extra flags), and add
# --json ourselves if the caller did not — the flag is store_true so a
# duplicate is harmless. set +e around the call: we need ITS exit code, not
# one collapsed by `set -e` aborting the script before we can read $?.
HAS_JSON=0
for a in "$@"; do
  [ "$a" = "--json" ] && HAS_JSON=1
done
EXTRA_JSON=()
[ "$HAS_JSON" -eq 0 ] && EXTRA_JSON=(--json)

set +e
uv run "$SCAN_SCRIPT" "$@" ${EXTRA_JSON[@]+"${EXTRA_JSON[@]}"}
RC=$?
set -e
exit "$RC"
