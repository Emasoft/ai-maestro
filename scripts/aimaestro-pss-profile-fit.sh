#!/usr/bin/env bash
# Thin wrapper around Perfect Skill Suggester's fast-mode agent profiling
# (surface 3 of TRDD-523V1N4I).
#
# WHAT THIS WRAPS: the `/pss-setup-agent <agent.md> --fast` command's own
# fast-mode pipeline, reproduced directly against the Rust binary (verified
# against v3.16.0, commands/pss-setup-agent/execution.md steps 6 and 8):
#   1. "${BINARY}" --agent "${AGENT_PATH}" --format json --top <N>
#      (writes <name>.agent.toml to the CURRENT DIRECTORY and prints the
#      written path on stdout — it is NOT raw JSON despite the TRDD card's
#      original description; this wrapper isolates the write in a private
#      tmp dir so it cannot pollute the caller's cwd)
#   2. pss_validate_agent_toml.py <toml> --check-index --verbose  (schema check)
#   3. pss_verify_profile.py <toml> --agent-def <agent.md> --json (anti-hallucination:
#      confirms every recommended element name actually exists in the index)
#
# VERIFIED BEHAVIOUR WORTH RECORDING: the Rust binary's own exit code is NOT a
# reliable failure signal. `--agent <bad-path>` still exits 0 and prints an
# unrelated hook-stub JSON on stdout (`{"hookSpecificOutput":...}`) while the
# real error goes to stderr and NO .agent.toml is written. So this wrapper
# cannot "pass through the binary's exit code" for that failure mode — there
# is nothing there to pass through. Instead it composes ONE exit code from
# the whole pipeline, documented below.
#
# ── EXIT CODES (this wrapper's OWN composition — see rationale above) ──────
#   0   binary produced a .agent.toml AND pss_verify_profile.py found no
#       unverifiable element names (its own exit 0)
#   1   binary produced a .agent.toml but pss_verify_profile.py found
#       unverifiable element names (its own exit 1 — the anti-hallucination
#       gate failed; this is the composite's PRIMARY failure signal)
#   2   binary ran (exit 0) but did NOT produce a .agent.toml at the path it
#       reported — a genuine could-not-complete for the PRIMARY step, kept
#       distinct from the wrapper's own 127 because the tool DID run
#   127 wrapper could not locate the tool at all (no cached PSS build, no
#       binary for this platform, the agent-def file does not exist, or
#       `uv` is missing for the verify step)
#
# stdout: one JSON object with every stage's exit code and output —
# never just the last tool's raw JSON, because three tools ran.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: aimaestro-pss-profile-fit.sh <agent-def.md> [--top N] [--output PATH]
       aimaestro-pss-profile-fit.sh -h|--help

Reproduces /pss-setup-agent <agent.md> --fast against the newest cached
Perfect Skill Suggester (PSS) build: scores the agent against the skill
index, writes a .agent.toml, schema-checks it, then anti-hallucination
verifies every recommended element name against the index. No LLM, no AI
agent spawn (that is what --fast means upstream too).

  --top N        candidates to consider (default: 30, matching the upstream
                 fast-mode default used by this wrapper)
  --output PATH  copy the generated .agent.toml to PATH before exiting
                 (default: left in a private tmp dir; the path is reported
                 in the JSON's "toml_path" field either way)

Exit codes (this wrapper's OWN composition of a 3-tool pipeline — see the
header comment for why the binary's own exit code cannot be used alone):
  0   profile generated and every recommended element verified against the index
  1   profile generated but pss_verify_profile.py found unverifiable elements
  2   the PSS binary ran but did not produce a .agent.toml (could-not-complete)
  127 wrapper could not locate the tool, the platform binary, uv, or the
      given agent-def file

Env overrides:
  PSS_CACHE_ROOT  plugin-cache root to search (default: ~/.claude/plugins/cache)
EOF
}

AGENT_PATH=""
TOP=30
OUTPUT_PATH=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --top) TOP="$2"; shift 2 ;;
    --output) OUTPUT_PATH="$2"; shift 2 ;;
    *)
      if [ -z "$AGENT_PATH" ]; then
        AGENT_PATH="$1"
      fi
      shift
      ;;
  esac
done

json_could_not_run() {
  printf '{"error":"could-not-run","reason":%s}\n' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
}

if [ -z "$AGENT_PATH" ]; then
  usage >&2
  exit 127
fi
if [ ! -f "$AGENT_PATH" ]; then
  json_could_not_run "agent-def file not found: $AGENT_PATH"
  exit 127
fi
# Absolutize BEFORE the `cd "$WORKDIR"` below: the binary resolves `--agent` relative to ITS
# cwd, so a relative path that passed the -f check above fails inside the temp dir with
# "Cannot resolve '<path>'" and exit 0 (measured 2026-09-05, TRDD-523V1N4I close). The
# cd/pwd form is bash-3.2-safe (no realpath dependency); the -- guards a dirname that starts
# with '-'.
AGENT_PATH="$(cd -- "$(dirname -- "$AGENT_PATH")" && pwd)/$(basename -- "$AGENT_PATH")"
if ! command -v uv >/dev/null 2>&1; then
  json_could_not_run "uv not found on PATH"
  exit 127
fi

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

# Platform binary detection — mirrors commands/pss-setup-agent/execution.md's
# PLATFORM_MAP verbatim (verified against v3.16.0).
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

VALIDATE_SCRIPT="$PSS_DIR/scripts/pss_validate_agent_toml.py"
VERIFY_SCRIPT="$PSS_DIR/scripts/pss_verify_profile.py"
if [ ! -f "$VALIDATE_SCRIPT" ] || [ ! -f "$VERIFY_SCRIPT" ]; then
  json_could_not_run "companion validator script(s) not found in newest cached build: $PSS_DIR"
  exit 127
fi

WORKDIR="$(mktemp -d)"
# shellcheck disable=SC2329  # invoked indirectly via `trap cleanup EXIT` below
cleanup() { rm -rf "$WORKDIR" 2>/dev/null || true; }
trap cleanup EXIT

BIN_STDOUT_FILE="$WORKDIR/.bin-stdout.txt"
BIN_STDERR_FILE="$WORKDIR/.bin-stderr.txt"
set +e
( cd "$WORKDIR" && "$BINARY" --agent "$AGENT_PATH" --format json --top "$TOP" ) \
  >"$BIN_STDOUT_FILE" 2>"$BIN_STDERR_FILE"
BIN_RC=$?
set -e

BIN_STDOUT="$(cat "$BIN_STDOUT_FILE" 2>/dev/null || true)"
BIN_STDERR="$(cat "$BIN_STDERR_FILE" 2>/dev/null || true)"
TOML_PATH="$(printf '%s' "$BIN_STDOUT" | head -1)"

if [ -z "$TOML_PATH" ] || [ ! -f "$TOML_PATH" ]; then
  python3 -c '
import json, sys
print(json.dumps({
    "agent_file": sys.argv[1],
    "binary_exit": int(sys.argv[2]),
    "binary_stdout": sys.argv[3],
    "binary_stderr": sys.argv[4],
    "toml_path": None,
    "toml_produced": False,
}, indent=2))
' "$AGENT_PATH" "$BIN_RC" "$BIN_STDOUT" "$BIN_STDERR"
  exit 2
fi

if [ -n "$OUTPUT_PATH" ]; then
  cp "$TOML_PATH" "$OUTPUT_PATH"
  TOML_PATH="$OUTPUT_PATH"
fi

set +e
VALIDATE_OUT="$(uv run "$VALIDATE_SCRIPT" "$TOML_PATH" --check-index --verbose 2>&1)"
VALIDATE_RC=$?
VERIFY_STDERR_FILE="$WORKDIR/.verify-stderr.txt"
VERIFY_OUT="$(uv run --script "$VERIFY_SCRIPT" "$TOML_PATH" --agent-def "$AGENT_PATH" --json 2>"$VERIFY_STDERR_FILE")"
VERIFY_RC=$?
VERIFY_STDERR="$(cat "$VERIFY_STDERR_FILE" 2>/dev/null || true)"
set -e

python3 -c '
import json, sys
agent_file, toml_path, bin_rc, bin_stdout, bin_stderr, validate_rc, validate_out, verify_rc, verify_out, verify_stderr = sys.argv[1:11]
try:
    verify_json = json.loads(verify_out)
except (json.JSONDecodeError, ValueError):
    verify_json = None
print(json.dumps({
    "agent_file": agent_file,
    "toml_path": toml_path,
    "toml_produced": True,
    "binary_exit": int(bin_rc),
    "binary_stdout": bin_stdout,
    "binary_stderr": bin_stderr,
    "validate_agent_toml": {"exit": int(validate_rc), "output": validate_out},
    "verify_profile": verify_json if verify_json is not None else {"raw": verify_out, "stderr": verify_stderr},
    "wrapper_exit": int(verify_rc),
}, indent=2))
' "$AGENT_PATH" "$TOML_PATH" "$BIN_RC" "$BIN_STDOUT" "$BIN_STDERR" "$VALIDATE_RC" "$VALIDATE_OUT" "$VERIFY_RC" "$VERIFY_OUT" "$VERIFY_STDERR"

exit "$VERIFY_RC"
