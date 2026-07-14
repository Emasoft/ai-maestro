#!/usr/bin/env bash
# Per-scenario cleanup wrapper — delegates to shared scenario-restore.sh.
# Verifies the SHA256 MANIFEST and restores every file in the rewipe-list.
exec "$(dirname "$0")/scenario-restore.sh" 029 "$@"
