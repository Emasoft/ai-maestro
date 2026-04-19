#!/usr/bin/env bash
# Per-scenario setup wrapper — delegates to shared scenario-setup.sh.
# Reads frontmatter fields rewipe-list / git-fixtures / dir-fixtures from
# tests/scenarios/SCEN-015_*.scen.md and executes the shared setup logic.
exec "$(dirname "$0")/scenario-setup.sh" 015 "$@"
