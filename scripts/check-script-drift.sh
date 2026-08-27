#!/usr/bin/env bash
# Is the installed Tier-A CLI the one this repo ships? (TRDD-GFX57106)
#
# Tier A is the manifest's frozen, plugin-facing contract; Tier B is sourced, Tier C is
# explicitly "not a plugin API". So only Tier A drift is a contract violation, and only
# Tier A is checked here — a check that reddened on Tier C would be routed around.
#
# Exit 0 = no Tier A drift (the reason TRDD-GFX57106 stays parked still holds).
# Exit 1 = drift; re-run the installers (`./install-agent-cli.sh`, `./install-messaging.sh`).
# Exit 2 = could not run (no manifest / no repo) — never conflated with "clean", per the
#          grep trichotomy this repo's tooling uses everywhere.
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "check-script-drift: cannot reach repo root" >&2; exit 2; }
MANIFEST=docs/SCRIPT-MANIFEST.md
[ -r "$MANIFEST" ] || { echo "check-script-drift: $MANIFEST unreadable" >&2; exit 2; }

# Tier A names, from the manifest's §2 only (§3/§4 are Tier B/C).
tier_a=$(awk '/^## 2\. /{s=1} /^## 3\. /{s=0} s' "$MANIFEST" \
         | grep -oE '[a-z0-9][a-zA-Z0-9._-]*\.sh' | sort -u)
[ -n "$tier_a" ] || { echo "check-script-drift: parsed 0 Tier A names — manifest shape changed" >&2; exit 2; }

drift=0
while IFS= read -r name; do
    [ -f "scripts/$name" ] || continue          # named but not shipped: Tier D, not our business
    installed="$HOME/.local/bin/$name"
    if [ ! -f "$installed" ]; then
        echo "MISSING  $name"; drift=$((drift + 1))
    elif ! cmp -s "scripts/$name" "$installed"; then
        echo "STALE    $name"; drift=$((drift + 1))
    fi
done <<< "$tier_a"

if [ "$drift" -gt 0 ]; then
    echo "check-script-drift: $drift Tier-A script(s) drifted — agents are invoking a CLI this repo does not ship." >&2
    exit 1
fi
echo "check-script-drift: Tier A clean ($(wc -l <<< "$tier_a" | tr -d ' ') names checked)"
