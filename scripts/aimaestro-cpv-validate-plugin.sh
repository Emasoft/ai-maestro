#!/usr/bin/env bash
# Thin wrapper around CPV's installed-artifact health check (surface 2 of TRDD-523V1N4I).
#
# WHAT THIS WRAPS: `validate_plugin.py <cache-dir> --json` from the newest
# claude-plugins-validation (CPV) build — but invoked through CPV's OWN
# canonical remote launcher, `remote_validation.py`. Verified live (v5.17.0):
# running validate_plugin.py directly (not via CLAUDE_PLUGIN_ROOT, not as a
# slash command) refuses with "being run from a remote location without the
# environment isolation launcher" and tells the caller to use
# remote_validation.py instead — this wrapper follows that instruction rather
# than fighting it.
#
# `remote_validation.py plugin <target> --json` forwards unknown flags
# (`parse_known_args`) straight to validate_plugin.py's own argv, so `--json`
# reaches the real validator unchanged.
#
# CPV's own caveat (recorded on the TRDD card, still true): a finding here
# means the INSTALLED CACHE COPY is broken — not necessarily the plugin's
# source repo.
#
# ── EXIT CODES ──────────────────────────────────────────────────────────────
#   The wrapped tool's own contract (verified against v5.17.0 source,
#   cpv_validation_common.py EXIT_* constants, non-strict mode — the mode this
#   wrapper always uses, matching the TRDD's documented four-value contract):
#     0 = OK (no CRITICAL/MAJOR/MINOR findings)
#     1 = CRITICAL findings present
#     2 = MAJOR findings present
#     3 = MINOR findings present
#   NOTE (verified, not fixed here — preserving semantics means preserving
#   this ambiguity too): validate_plugin.py ALSO returns bare `1` from several
#   early usage/path-not-found branches that never reach the report, so an
#   exit-1 with EMPTY/absent JSON on stdout is a usage error, not a CRITICAL
#   finding. Callers that care about the distinction must check for JSON on
#   stdout, not exit code 1 alone. This is a property of the wrapped tool.
#   127 = WRAPPER could not locate the tool at all (no cached CPV build found,
#         remote_validation.py missing, or `uv` not on PATH). This is the
#         wrapper's OWN code — it never collides with CPV's 0-3.
#
# stdout: the wrapped tool's JSON, byte-for-byte, on success. On a 127 (could
# not locate the tool), a one-line JSON error object instead.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: aimaestro-cpv-validate-plugin.sh <plugin-cache-dir> [extra cpv flags...]
       aimaestro-cpv-validate-plugin.sh -h|--help

Wraps the newest cached claude-plugins-validation (CPV) build's
validate_plugin.py --json, run through CPV's own remote_validation.py
launcher (required outside CLAUDE_PLUGIN_ROOT — verified against v5.17.0;
running the target script directly refuses with an environment-isolation
error). <plugin-cache-dir> is the INSTALLED cache copy of the plugin to
check (what the runtime actually loads), e.g.
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>.

Always adds --json (idempotent if you also pass it). Any extra arguments
(e.g. --marketplace-only) are forwarded verbatim to the wrapped tool.

Exit codes (non-strict mode — NIT never blocks):
  0   OK (from CPV)
  1   CRITICAL findings (from CPV) — ALSO used by several of CPV's own
      early usage/path errors; check for JSON on stdout to tell them apart
  2   MAJOR findings (from CPV)
  3   MINOR findings (from CPV)
  127 wrapper could not locate CPV or its launcher (uv missing, no cached
      build found, or remote_validation.py is absent from the newest build)

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

resolve_newest_cpv() {
  # `|| true`: see aimaestro-cpv-pre-install-scan.sh for why this is
  # load-bearing under `set -e -o pipefail` on a nonexistent CACHE_ROOT.
  [ -d "$CACHE_ROOT" ] || return 0
  find "$CACHE_ROOT" -mindepth 3 -maxdepth 3 -type d -path '*/claude-plugins-validation/*' 2>/dev/null \
    | sort -V | tail -1 || true
}

json_could_not_run() {
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

LAUNCHER="$CPV_DIR/scripts/remote_validation.py"
if [ ! -f "$LAUNCHER" ]; then
  json_could_not_run "remote_validation.py not found in newest cached build: $CPV_DIR"
  exit 127
fi

HAS_JSON=0
for a in "$@"; do
  [ "$a" = "--json" ] && HAS_JSON=1
done
EXTRA_JSON=()
[ "$HAS_JSON" -eq 0 ] && EXTRA_JSON=(--json)

# CLAUDE_PRIVATE_USERNAMES is remote_validation.py's own documented isolation
# knob (its --help / module docstring names it) — pass the caller's username
# so path-redaction checks don't false-positive on the caller's own home dir.
set +e
CLAUDE_PRIVATE_USERNAMES="$(whoami)" uv run --with pyyaml python "$LAUNCHER" plugin "$1" \
  ${EXTRA_JSON[@]+"${EXTRA_JSON[@]}"} "${@:2}"
RC=$?
set -e
exit "$RC"
