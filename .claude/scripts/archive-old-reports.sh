#!/usr/bin/env bash
# archive-old-reports.sh — automatically archive old agent reports
#
# Moves files older than ARCHIVE_THRESHOLD_DAYS (default 2 days = 48h)
# from reports/ (git-tracked recent reports) to reports_dev/ (gitignored
# archive per Rule 0.2 _dev convention). Preserves subdirectory
# structure (reports/kraken/foo.md → reports_dev/kraken/foo.md).
#
# Idempotent — safe to run any number of times.
# Throttled — runs at most once per day via state file mtime.
#
# Registered on the SessionStart hook so it fires automatically when
# a Claude Code session starts in this project.
#
# To override the threshold for a single run:
#   ARCHIVE_THRESHOLD_DAYS=7 bash .claude/scripts/archive-old-reports.sh
#
# To bypass the throttle (force run):
#   ARCHIVE_FORCE=1 bash .claude/scripts/archive-old-reports.sh

set -u

THRESHOLD_DAYS="${ARCHIVE_THRESHOLD_DAYS:-2}"  # 2 days = 48 hours
THROTTLE_SEC=86400  # 24 hours

# Resolve project root (must contain reports/ and be a git repo)
cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Sanity: reports/ must exist
[ -d reports ] || exit 0

# ---- Throttle ----
if [ "${ARCHIVE_FORCE:-0}" != "1" ]; then
  project_hash=$(pwd | shasum | awk '{print $1}' | cut -c1-8)
  state_file="/tmp/claude-archive-reports-${project_hash}.lock"
  if [ -f "$state_file" ]; then
    # Cross-platform mtime — GNU stat first, BSD stat fallback
    last_mtime=$(stat -c %Y "$state_file" 2>/dev/null \
              || stat -f %m "$state_file" 2>/dev/null \
              || echo 0)
    last_mtime="${last_mtime//[!0-9]/}"
    [ -z "$last_mtime" ] && last_mtime=0
    now=$(date +%s)
    elapsed=$((now - last_mtime))
    if [ "$elapsed" -lt "$THROTTLE_SEC" ]; then
      exit 0
    fi
  fi
  touch "$state_file"
fi

# ---- Archive ----
# `reports_dev/` and per-agent subfolders (reports_dev/<agent>/) are created
# on-demand via `mkdir -p "$dst_dir"` inside the loop — one `mkdir -p` creates
# BOTH the top-level `reports_dev/` AND the per-agent subdir in a single call.
# If no files age out, we create nothing (no empty dirs left on disk).

moved_count=0
while IFS= read -r -d '' src; do
  # Path relative to reports/ (e.g. kraken/foo.md → dst=reports_dev/kraken/foo.md)
  rel="${src#reports/}"
  dst="reports_dev/${rel}"
  dst_dir=$(dirname "$dst")

  # Creates reports_dev/ AND reports_dev/<agent>/ if either is missing.
  # -p is idempotent — no-op if both already exist.
  mkdir -p "$dst_dir" || {
    echo "[archive-old-reports] ERROR: mkdir -p '$dst_dir' failed — skipping $src" >&2
    continue
  }

  # Refuse to overwrite (preserves oldest copy if there is a collision)
  if [ -e "$dst" ]; then
    continue
  fi

  if mv "$src" "$dst" 2>/dev/null; then
    moved_count=$((moved_count + 1))
  fi
done < <(find reports -type f -mtime "+${THRESHOLD_DAYS}" -print0 2>/dev/null)

# Prune now-empty subdirectories under reports/ (keep reports/ itself)
find reports -mindepth 1 -type d -empty -delete 2>/dev/null

# Emit summary ONLY when something was moved (stays silent otherwise so
# the SessionStart hook output remains clean on the common case).
if [ "$moved_count" -gt 0 ]; then
  cat <<EOF
<reports-archived>
Archived $moved_count agent report(s) from reports/ → reports_dev/
(files older than ${THRESHOLD_DAYS} days, threshold set via ARCHIVE_THRESHOLD_DAYS)
</reports-archived>
EOF
fi

exit 0
