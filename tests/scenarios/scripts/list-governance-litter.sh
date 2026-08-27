#!/usr/bin/env bash
# List every ai-maestro agent that lives under ~/agents/ AND carries a
# governance title -- the operator's remediation view for the SETUP_FAIL that
# assert-clean-governance.sh emits.  TRDD-Q6JM2RU3.
#
# This is the STRUCTURAL litter test from SCENARIOS_TESTS_RULES.md, not a name
# list: a name list is a snapshot of what someone believed once, and the file
# that carried one had it wrong in both directions for weeks (it preserved test
# debris forever AND taught runners to identify user agents by name, which fails
# silently for any user agent nobody added).  The user's own agents live OUTSIDE
# ~/agents/ and carry no title, so the two facts below separate them for good.
#
# READ-ONLY.  Delete what it lists through the dashboard UI, never with rm -rf:
# an agent is a registry row plus a cemetery archive, a team slot, a tmux
# session, a persisted session, AMP keys and an AID token, and rm -rf removes
# only the visible piece -- the server then legitimately re-creates the folder.
set -euo pipefail

REG="${HOME}/.aimaestro/agents/registry.json"
GOV="${HOME}/.aimaestro/governance.json"

command -v jq >/dev/null 2>&1 || { echo "jq not on PATH -- cannot read the registry" >&2; exit 2; }
[ -f "$REG" ] || { echo "no registry at $REG -- nothing to list"; exit 0; }

mgr=""
if [ -f "$GOV" ]; then
  mgr=$(jq -r '.managerId // empty' "$GOV")
fi

rows=$(jq -r --arg home "$HOME" --arg mgr "$mgr" '
  map(select((.workingDirectory // "") | startswith($home + "/agents/")))
  | map(select((.governanceTitle // "") != ""))
  | map(select((.status // "") != "deleted"))
  | .[]
  | "\(.governanceTitle)\(if .id == $mgr then "*" else "" end)\t\(.name)\t\(.id)\t\(.workingDirectory)"
' "$REG")

if [ -z "$rows" ]; then
  echo "no governance litter -- no titled agent under $HOME/agents/"
  exit 0
fi

TAB=$(printf '\t')
table=$(printf 'TITLE\tNAME\tID\tWORKDIR\n%s\n' "$rows")
printf '%s\n' "$table" | column -t -s "$TAB" 2>/dev/null || printf '%s\n' "$table"
echo
echo "* = holds the per-host MANAGER singleton (governance.json .managerId)"
echo "Delete via the UI: Profile > Advanced > Danger Zone > Delete Agent, tick 'Also delete agent folder', then purge the cemetery entry in Settings > Cemetery."
