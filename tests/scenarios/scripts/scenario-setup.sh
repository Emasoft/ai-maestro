#!/usr/bin/env bash
# Shared scenario setup — invoked by per-scenario wrapper setup-SCEN-<NNN>.sh.
# Reads the scenario file's YAML frontmatter and:
#   1. Backs up every path in `rewipe-list` to state-backups/SCEN-<NNN>_<timestamp>/
#      with MANIFEST.sha256 for integrity.
#   2. Verifies every repo in `git-fixtures` exists locally at
#      tests/scenarios/fixtures/git/<repo-name>/ and resets it to tag `scenario-start`.
#   3. Verifies every path in `dir-fixtures` exists. If the path is a git repo with
#      tag `scenario-start`, resets it to that tag.
#
# Exits 0 on full success. Exits 1 with SETUP_FAIL <reason> on any failure.
# Fixtures are NEVER auto-created by this script — the scenario author must prepare
# them in advance (clone forks, create the scenario-start tag, populate dir fixtures).

set -euo pipefail

NNN="${1:?usage: scenario-setup.sh <NNN>}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$PROJECT_DIR"

SCEN_FILE=$(ls "tests/scenarios/SCEN-${NNN}_"*.scen.md 2>/dev/null | head -1)
[ -f "$SCEN_FILE" ] || { echo "SETUP_FAIL scenario file not found for SCEN-$NNN" >&2; exit 1; }

command -v yq >/dev/null 2>&1 || { echo "SETUP_FAIL 'yq' not on PATH (required for frontmatter parsing)" >&2; exit 1; }

FM=$(awk '/^---$/{c++; if(c==2) exit; next} c==1' "$SCEN_FILE")

REWIPE=$(echo "$FM"  | yq e '.["rewipe-list"][]?  // ""' - 2>/dev/null || true)
GITFIX=$(echo "$FM"  | yq e '.["git-fixtures"][]? // ""' - 2>/dev/null || true)
FOLDFIX=$(echo "$FM" | yq e '.["dir-fixtures"][]? // ""' - 2>/dev/null || true)

TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$PROJECT_DIR/tests/scenarios/state-backups/SCEN-${NNN}_${TS}"
mkdir -p "$BACKUP_DIR"
MANIFEST="$BACKUP_DIR/MANIFEST.sha256"
: > "$MANIFEST"

echo "SETUP_BEGIN SCEN-$NNN ts=$TS"

if [ -n "$REWIPE" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    f_exp=$(eval echo "$f")
    if [ -f "$f_exp" ]; then
      if [[ "$f_exp" == "$HOME"* ]]; then
        rel="HOME${f_exp#$HOME}"
      else
        rel="ROOT${f_exp}"
      fi
      mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
      cp -p "$f_exp" "$BACKUP_DIR/$rel"
      sha=$(shasum -a 256 "$f_exp" | awk '{print $1}')
      echo "$sha  $f_exp  $rel" >> "$MANIFEST"
      echo "BACKUP $f_exp"
    else
      echo "BACKUP_SKIP $f_exp (not present)"
    fi
  done <<< "$REWIPE"
fi

FIXTURE_GIT_ROOT="$PROJECT_DIR/tests/scenarios/fixtures/git"
if [ -n "$GITFIX" ]; then
  mkdir -p "$FIXTURE_GIT_ROOT"
  idx=0
  while IFS= read -r url; do
    [ -z "$url" ] && continue
    repo_name=$(basename "$url" .git)
    local_path="$FIXTURE_GIT_ROOT/$repo_name"
    if [ ! -d "$local_path/.git" ]; then
      echo "SETUP_FAIL git-fixture[$idx] $url — expected local clone at $local_path; scenario author must prepare the fork in advance" >&2
      exit 1
    fi
    if ! git -C "$local_path" rev-parse --verify scenario-start >/dev/null 2>&1; then
      echo "SETUP_FAIL git-fixture[$idx] $local_path missing tag 'scenario-start'" >&2
      exit 1
    fi
    git -C "$local_path" reset --hard scenario-start >/dev/null
    git -C "$local_path" clean -fdx >/dev/null
    echo "GITFIX[$idx]=$local_path (reset to scenario-start)"
    idx=$((idx+1))
  done <<< "$GITFIX"
fi

if [ -n "$FOLDFIX" ]; then
  idx=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    p_exp=$(eval echo "$p")
    if [ ! -d "$p_exp" ]; then
      echo "SETUP_FAIL dir-fixture[$idx] $p_exp missing — scenario author must prepare fixture in advance" >&2
      exit 1
    fi
    if [ -d "$p_exp/.git" ] && git -C "$p_exp" rev-parse --verify scenario-start >/dev/null 2>&1; then
      git -C "$p_exp" reset --hard scenario-start >/dev/null
      git -C "$p_exp" clean -fdx >/dev/null
      echo "FOLDFIX[$idx]=$p_exp (reset to scenario-start)"
    else
      echo "FOLDFIX[$idx]=$p_exp (no git reset — not a repo or no tag)"
    fi
    idx=$((idx+1))
  done <<< "$FOLDFIX"
fi

echo "SETUP_OK SCEN-$NNN"
echo "BACKUP_DIR=$BACKUP_DIR"
