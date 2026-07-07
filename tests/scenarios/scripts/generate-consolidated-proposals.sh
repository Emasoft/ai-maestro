#!/usr/bin/env bash
# generate-consolidated-proposals.sh — emit the BATCH_SUMMARY index for a scenario batch.
#
# HISTORY / WHY THIS FILENAME: until TRDD-CJZRB57R (2026-07-07) this script
# consolidated every scenario_proposed-improvements_*.md monolith into one huge
# CONSOLIDATED_PROPOSALS_<batch_id>.md approval file. Rule 11 now writes every
# suggestion DIRECTLY as its own git-tracked TRDD-proposal file in
# design/proposals/ (column: proposal), so this script only emits a lightweight
# INDEX — reports/scenarios-runner/BATCH_SUMMARY_<batch_id>.md — over those
# TRDDs. The filename is KEPT UNCHANGED because master-cleanup.sh (step 4) and
# the Rule 13 cron prompt invoke it by name; renaming would break both callers
# and lose git history.
#
# Usage:
#   bash generate-consolidated-proposals.sh <batch_id>      # index proposals labeled batch-<batch_id>
#   bash generate-consolidated-proposals.sh --all-pending   # index every `column: proposal` TRDD
#   bash generate-consolidated-proposals.sh [...] --out p.md --quiet
#   bash generate-consolidated-proposals.sh                 # no arg: batch_id from the state file
#
# Reads design/proposals/*.md frontmatter ONLY (grep/sed — this script never
# writes inside design/). Adds a verdict/fix-commit table when the autonomous
# batch state file exists and jq is available.
#
# Idempotent: same inputs → same output. No API calls, no git mutations.

set -eu

# Repo-root-relative (never a hardcoded /Users path): tests/scenarios/scripts → root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PROPOSALS_DIR="$MAIN_ROOT/design/proposals"
STATE_FILE="$MAIN_ROOT/tests/scenarios/state/autonomous-batch-state.json"
REPORTS_DIR="$MAIN_ROOT/reports/scenarios-runner"

BATCH_ID=""
ALL_PENDING=0
OUT=""
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --all-pending) ALL_PENDING=1; shift ;;
    --out)   OUT="$2"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    --*) echo "ERROR unknown-arg-$1" >&2; exit 2 ;;
    *) BATCH_ID="$1"; shift ;;
  esac
done

# No explicit batch id: fall back to the state file's batch_id (the cron path).
if [ "$ALL_PENDING" -eq 0 ] && [ -z "$BATCH_ID" ]; then
  if [ -f "$STATE_FILE" ] && command -v jq >/dev/null 2>&1; then
    BATCH_ID="$(jq -r '.batch_id // empty' "$STATE_FILE")"
  fi
  [ -n "$BATCH_ID" ] || { echo "ERROR no-batch-id (pass <batch_id> or --all-pending)" >&2; exit 2; }
fi

if [ -z "$OUT" ]; then
  if [ "$ALL_PENDING" -eq 1 ]; then
    OUT="$REPORTS_DIR/BATCH_SUMMARY_all-pending.md"
  else
    OUT="$REPORTS_DIR/BATCH_SUMMARY_${BATCH_ID}.md"
  fi
fi
mkdir -p "$(dirname "$OUT")"

[ -d "$PROPOSALS_DIR" ] || { echo "ERROR proposals-dir-missing: $PROPOSALS_DIR" >&2; exit 2; }

# ---- Select + extract proposal frontmatter (bash-3.2-safe: temp files, no mapfile) ----
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TOTAL=0
for f in "$PROPOSALS_DIR"/TRDD-*.md; do
  [ -f "$f" ] || continue
  if [ "$ALL_PENDING" -eq 1 ]; then
    grep -q '^column: proposal$' "$f" || continue
  else
    grep -q "^labels:.*batch-${BATCH_ID}" "$f" || continue
  fi
  # Frontmatter is one-field-per-line flow-style (TRDD grep-first invariants),
  # so plain sed extraction is exact — no YAML parser needed.
  tid="$(sed -n 's/^trdd-id: //p' "$f" | head -1)"
  title="$(sed -n 's/^title: //p' "$f" | head -1)"
  prio="$(sed -n 's/^priority: //p' "$f" | head -1)"
  sev="$(sed -n 's/^severity: //p' "$f" | head -1)"
  scen="$(sed -n 's/^labels: //p' "$f" | head -1 | grep -o 'scen-[0-9][0-9]*' | head -1 || true)"
  case "$prio" in 0|1|2|3) : ;; *) prio=3 ;; esac
  [ -n "$sev" ]  || sev="—"
  [ -n "$scen" ] || scen="scen-?"
  [ -n "$tid" ]  || tid="?"
  rel="design/proposals/$(basename "$f")"
  printf -- '- **TRDD-%s** — %s (%s, %s) — `%s`\n' "$tid" "$title" "$scen" "$sev" "$rel" \
    >> "$TMP_DIR/p$prio.txt"
  TOTAL=$((TOTAL + 1))
done

# Count rows for one priority bucket (missing file = 0 — bucket never got a row).
count_p() {
  if [ -f "$TMP_DIR/p$1.txt" ]; then
    wc -l < "$TMP_DIR/p$1.txt" | tr -d ' '
  else
    echo 0
  fi
}
C0="$(count_p 0)"; C1="$(count_p 1)"; C2="$(count_p 2)"; C3="$(count_p 3)"

SCOPE_LABEL="batch ${BATCH_ID}"
[ "$ALL_PENDING" -eq 1 ] && SCOPE_LABEL="ALL pending proposals"

# ---- Emit the index ----
{
  echo "# Batch summary — ${SCOPE_LABEL}"
  echo
  echo "_INDEX ONLY (TRDD-CJZRB57R): the proposals themselves are individual git-tracked_"
  echo "_TRDD files in \`design/proposals/\` — this file is derived and gitignored._"
  echo
  echo "**Proposal TRDDs:** ${TOTAL} (P0: ${C0}, P1: ${C1}, P2: ${C2}, P3: ${C3})"
  echo

  # Optional Phase-1 table from the autonomous batch state file (only when it
  # describes THIS batch — a stale state file must not decorate another batch).
  if [ "$ALL_PENDING" -eq 0 ] && [ -f "$STATE_FILE" ] && command -v jq >/dev/null 2>&1 \
     && [ "$(jq -r '.batch_id // empty' "$STATE_FILE")" = "$BATCH_ID" ]; then
    echo "## Phase 1 — scenario verdicts + in-place bug fixes (already committed)"
    echo
    echo "| Scenario | Verdict | Bugs fixed | Fix commit SHAs |"
    echo "|----------|---------|------------|-----------------|"
    jq -r '.scenarios | to_entries[] | select(.value.status == "done")
      | "| \(.key) | \(.value.verdict // "?") | \(.value.bugs_fixed // 0) | \((.value.bug_fix_commit_shas // []) | join(", ")) |"' \
      "$STATE_FILE"
    echo
  fi

  for p in 0 1 2 3; do
    n="$(count_p "$p")"
    echo "## P${p} proposals (${n})"
    echo
    if [ "$n" = "0" ]; then
      echo "_(none)_"
    else
      cat "$TMP_DIR/p${p}.txt"
    fi
    echo
  done

  echo "---"
  echo
  echo "## Screening (Phase 2) — standard TRDD approval flow"
  echo
  echo "Each proposal above is a normal \`column: proposal\` TRDD. Approve/refuse via:"
  echo
  echo "1. The amama-proposal-approvals batch syntax — list the proposals (the tool"
  echo "   numbers them), then reply \`approved: n,n,…\` / \`refused: n,n,…\`; or"
  echo "2. Manually: set \`column: planned\`, append the \`## Approval log\` line, and"
  echo "   \`git mv\` the file from \`design/proposals/\` to \`design/tasks/\`."
  echo
  if [ "$ALL_PENDING" -eq 0 ]; then
    echo "Then implement the approved ones (Phase 3):"
    echo
    echo '```bash'
    echo "/run-scenarios-batch --improve ${BATCH_ID}"
    echo '```'
    echo
  fi
  echo "Unreviewed proposals simply stay PENDING in \`design/proposals/\`."
} > "$OUT"

if [ "$QUIET" -eq 0 ]; then
  echo "Wrote $OUT"
  echo "  proposals: $TOTAL | P0/P1/P2/P3: $C0/$C1/$C2/$C3"
fi
