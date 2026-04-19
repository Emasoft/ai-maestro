#!/usr/bin/env bash
# Per-scenario cleanup wrapper — delegates to shared scenario-restore.sh.
# Restores files backed up by setup-SCEN-003.sh with SHA256 integrity checks.
exec "$(dirname "$0")/scenario-restore.sh" 003 "$@"
