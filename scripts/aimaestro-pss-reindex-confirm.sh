#!/usr/bin/env bash
# Thin wrapper that CONFIRMS a Perfect Skill Suggester reindex actually ran
# (surface 4 of TRDD-523V1N4I) — closes the "sent, not confirmed" gap that
# /amcos-reindex-skills documents about itself (it is fire-and-forget: it
# reports the reindex REQUEST was sent, never the reindex OUTCOME).
#
# WHAT THIS WRAPS: `pss scan-log --format json` + `pss changes-in-batch
# <scan_id> --format json` from the newest cached PSS build (verified live
# against v3.16.0's Rust binary --help).
#
# THE "FLAT STAMP FILE" — RE-VERIFIED, NOT FOUND (report this honestly):
# the design decision on TRDD-523V1N4I says this wrapper should also read
# "PSS's flat stamp file when present" because it is supposedly cheaper than
# exec'ing the binary. A repo-wide grep of PSS v3.16.0 for a completion-stamp
# file (reindex_complete / last_reindex / stamp_file / etc.) found no such
# artifact — the only place a "last reindex" timestamp is recorded is inside
# the CozoDB itself (scan_runs table, read via `pss scan-log` / `pss stats`).
# This wrapper still CHECKS the two candidate paths below (best-effort, "when
# present" per the design decision), and falls back to the exec path when
# neither exists — which, as of this build, is always. The JSON output names
# which source actually answered, so a future PSS release that adds the file
# is picked up automatically with no wrapper change.
#
# VERIFIED BEHAVIOUR WORTH RECORDING: neither `pss scan-log` nor `pss
# changes-in-batch` documents a distinct failure exit code. A NONEXISTENT
# scan_id returns exit 0 and an EMPTY JSON array `[]` — indistinguishable
# from "this scan really had zero events". This wrapper preserves that
# ambiguity (it is the wrapped tool's own contract) rather than inventing a
# distinction the tool does not make.
#
# ── EXIT CODES ──────────────────────────────────────────────────────────────
#   0   `pss scan-log` (and, when a scan_id was resolved, `pss
#       changes-in-batch`) ran successfully — their own exit code, verified
#       always 0 for both subcommands regardless of whether any rows matched
#   127 wrapper could not locate the tool at all (no cached PSS build, no
#       binary for this platform)
#   Any other value: passed through unchanged from the PSS binary itself,
#   should the binary ever add a distinct failure code for these subcommands.
#
# stdout: one JSON object combining the stamp-file check (if any), the recent
# scan-log rows, and (when a scan_id is known) the batch's changed elements.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: aimaestro-pss-reindex-confirm.sh [<scan_id>] [--limit N] [--changes-limit N]
       aimaestro-pss-reindex-confirm.sh -h|--help

Confirms a Perfect Skill Suggester (PSS) reindex actually ran, against the
newest cached PSS build. Checks PSS's flat stamp file first (best-effort —
see the header comment: as of PSS v3.16.0 no such file exists, so this is
future-proofing, not a live path), then falls back to `pss scan-log` +
`pss changes-in-batch`.

  <scan_id>          ULID scan id to confirm. Omit to use the most recent
                      scan from `pss scan-log`.
  --limit N          rows to request from `pss scan-log` (default: 5)
  --changes-limit N  rows to request from `pss changes-in-batch` (default: 100)

Exit codes:
  0   scan-log (and changes-in-batch, when a scan_id was used) ran — NOTE:
      the wrapped tool exits 0 even for an unknown scan_id (empty array);
      that ambiguity is the wrapped tool's own contract, preserved here
  127 wrapper could not locate the tool, or no binary for this platform
  *   any other value is passed through unchanged from the PSS binary

Env overrides:
  PSS_CACHE_ROOT  plugin-cache root to search (default: ~/.claude/plugins/cache)
EOF
}

SCAN_ID=""
LIMIT=5
CHANGES_LIMIT=100
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --changes-limit) CHANGES_LIMIT="$2"; shift 2 ;;
    *)
      if [ -z "$SCAN_ID" ]; then
        SCAN_ID="$1"
      fi
      shift
      ;;
  esac
done

json_could_not_run() {
  printf '{"error":"could-not-run","reason":%s}\n' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
}

CACHE_ROOT="${PSS_CACHE_ROOT:-$HOME/.claude/plugins/cache}"

resolve_newest_pss() {
  # `|| true`: see aimaestro-cpv-pre-install-scan.sh for why this is
  # load-bearing under `set -e -o pipefail` on a nonexistent CACHE_ROOT.
  [ -d "$CACHE_ROOT" ] || return 0
  find "$CACHE_ROOT" -mindepth 3 -maxdepth 3 -type d -path '*/perfect-skill-suggester/*' 2>/dev/null \
    | sort -V | tail -1 || true
}

PSS_DIR="$(resolve_newest_pss)"
if [ -z "$PSS_DIR" ]; then
  json_could_not_run "no cached perfect-skill-suggester build found under $CACHE_ROOT"
  exit 127
fi

UNAME_S="$(uname -s)"
UNAME_M="$(uname -m)"
BINARY_NAME=""
case "$UNAME_S-$UNAME_M" in
  Darwin-arm64)  BINARY_NAME="pss-darwin-arm64" ;;
  Darwin-x86_64) BINARY_NAME="pss-darwin-x86_64" ;;
  Linux-x86_64)  BINARY_NAME="pss-linux-x86_64" ;;
  Linux-aarch64) BINARY_NAME="pss-linux-arm64" ;;
  *)
    json_could_not_run "unsupported platform: $UNAME_S/$UNAME_M"
    exit 127
    ;;
esac
BINARY="$PSS_DIR/bin/$BINARY_NAME"
if [ ! -x "$BINARY" ]; then
  json_could_not_run "PSS binary not found or not executable: $BINARY"
  exit 127
fi

# Best-effort flat-stamp-file check — "when present" per the design decision.
# Not verified to exist in any shipped PSS build (see header comment); kept
# so a future PSS release adding one is picked up with no wrapper change.
STAMP_JSON="null"
STAMP_SOURCE="none"
for candidate in \
  "${CLAUDE_PLUGIN_DATA:-}/pss-last-reindex.json" \
  "$HOME/.claude/cache/pss-last-reindex.json"
do
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    STAMP_JSON="$(cat "$candidate")"
    STAMP_SOURCE="stamp-file:$candidate"
    break
  fi
done

WORKDIR="$(mktemp -d)"
# shellcheck disable=SC2329  # invoked indirectly via `trap cleanup EXIT` below
cleanup() { rm -rf "$WORKDIR" 2>/dev/null || true; }
trap cleanup EXIT

set +e
SCAN_LOG_OUT="$("$BINARY" scan-log --format json --limit "$LIMIT" 2>"$WORKDIR/.scanlog-stderr.txt")"
SCAN_LOG_RC=$?
set -e
if [ "$SCAN_LOG_RC" -ne 0 ]; then
  cat "$WORKDIR/.scanlog-stderr.txt" >&2 2>/dev/null || true
  exit "$SCAN_LOG_RC"
fi

# Resolve scan_id from the most recent row when the caller didn't give one.
if [ -z "$SCAN_ID" ]; then
  SCAN_ID="$(printf '%s' "$SCAN_LOG_OUT" | python3 -c 'import json,sys
rows=json.load(sys.stdin)
print(rows[0]["scan_id"] if rows else "")')"
fi

CHANGES_OUT="[]"
CHANGES_SOURCE="none"
if [ -n "$SCAN_ID" ]; then
  set +e
  CHANGES_OUT="$("$BINARY" changes-in-batch "$SCAN_ID" --format json --limit "$CHANGES_LIMIT" 2>"$WORKDIR/.changes-stderr.txt")"
  CHANGES_RC=$?
  set -e
  if [ "$CHANGES_RC" -ne 0 ]; then
    cat "$WORKDIR/.changes-stderr.txt" >&2 2>/dev/null || true
    exit "$CHANGES_RC"
  fi
  CHANGES_SOURCE="exec:changes-in-batch"
fi

python3 -c '
import json, sys
scan_id, scan_log, changes, stamp_json, stamp_source, changes_source = sys.argv[1:7]
print(json.dumps({
    "scan_id": scan_id or None,
    "source_used": stamp_source if stamp_source != "none" else "exec:scan-log",
    "stamp_file": json.loads(stamp_json) if stamp_json != "null" else None,
    "stamp_source": stamp_source,
    "scan_log": json.loads(scan_log),
    "changes_source": changes_source,
    "changes": json.loads(changes),
}, indent=2))
' "$SCAN_ID" "$SCAN_LOG_OUT" "$CHANGES_OUT" "$STAMP_JSON" "$STAMP_SOURCE" "$CHANGES_SOURCE"

exit 0
