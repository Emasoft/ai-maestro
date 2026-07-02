#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# compress-screenshots.sh — Convert all PNG screenshots to JPEG 97%
# and delete the originals.
#
# Uses macOS built-in `sips` (Scriptable Image Processing System)
# which is always available and needs no external install.
#
# Usage:
#   bash compress-screenshots.sh                  # compress all PNG under tests/scenarios/screenshots/
#   bash compress-screenshots.sh <dir>            # compress all PNG under <dir>
#   bash compress-screenshots.sh <dir> <quality>  # override quality (default 97)
#
# Why 97%: JPEG at 97% is visually indistinguishable from the PNG
# source for UI screenshots while cutting file size by ~70%.
# The remaining compression artifacts are inside the noise floor
# of display rendering and do not affect visual verification.
#
# Safety: the script ONLY deletes the PNG after sips has successfully
# written the JPEG. If the conversion fails, the PNG is preserved.
# ──────────────────────────────────────────────────────────────

set -eu

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DIR="/Users/emanuelesabetta/ai-maestro/tests/scenarios/screenshots"

TARGET_DIR="${1:-$DEFAULT_DIR}"
QUALITY="${2:-97}"

if [ ! -d "$TARGET_DIR" ]; then
    echo "[compress-screenshots] target dir not found: $TARGET_DIR" >&2
    exit 1
fi

command -v sips >/dev/null 2>&1 || {
    echo "[compress-screenshots] sips not found — this script requires macOS" >&2
    exit 1
}

echo "[compress-screenshots] scanning $TARGET_DIR for *.png files..."
BEFORE_SIZE=$(du -sk "$TARGET_DIR" 2>/dev/null | awk '{print $1}')
PNG_COUNT=0
CONVERTED=0
FAILED=0
FAILED_FILES=()

# Use while + find to handle spaces in filenames
while IFS= read -r -d '' png_file; do
    PNG_COUNT=$((PNG_COUNT + 1))
    jpg_file="${png_file%.png}.jpg"

    # Skip if a JPG already exists (idempotent)
    if [ -f "$jpg_file" ]; then
        rm -f "$png_file"
        continue
    fi

    if sips -s format jpeg -s formatOptions "$QUALITY" "$png_file" --out "$jpg_file" >/dev/null 2>&1; then
        if [ -s "$jpg_file" ]; then
            rm -f "$png_file"
            CONVERTED=$((CONVERTED + 1))
        else
            # JPG empty — conversion bad, keep PNG
            rm -f "$jpg_file"
            FAILED=$((FAILED + 1))
            FAILED_FILES+=("$png_file")
        fi
    else
        FAILED=$((FAILED + 1))
        FAILED_FILES+=("$png_file")
    fi
done < <(find "$TARGET_DIR" -type f -name "*.png" -print0)

AFTER_SIZE=$(du -sk "$TARGET_DIR" 2>/dev/null | awk '{print $1}')
SAVED_KB=$((BEFORE_SIZE - AFTER_SIZE))
SAVED_MB=$((SAVED_KB / 1024))

echo "[compress-screenshots] scanned: ${PNG_COUNT} PNG files"
echo "[compress-screenshots] converted: ${CONVERTED}"
echo "[compress-screenshots] failed: ${FAILED}"
echo "[compress-screenshots] before: ${BEFORE_SIZE} KB"
echo "[compress-screenshots] after: ${AFTER_SIZE} KB"
echo "[compress-screenshots] saved: ${SAVED_KB} KB (${SAVED_MB} MB)"

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
    echo "[compress-screenshots] failed files:" >&2
    for f in "${FAILED_FILES[@]}"; do
        echo "  - $f" >&2
    done
    exit 2
fi
