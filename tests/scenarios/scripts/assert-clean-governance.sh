#!/usr/bin/env bash
# Pre-flight audit: refuse to start a MANAGER-creating scenario while the
# per-host MANAGER singleton is already taken.  TRDD-Q6JM2RU3.
#
# The singleton is enforced in services/element-management-service.ts Gate 7
# (~:2697): ChangeTitle -> 'manager' is rejected whenever getManagerId() returns
# an id that is not the agent being retitled.  getManagerId() (lib/governance.ts)
# reads ~/.aimaestro/governance.json .managerId -- so that file, not the agent
# registry, is the authority this audit mirrors.
#
# READ-ONLY BY CONSTRUCTION.  It never demotes or deletes the incumbent: that is
# a state-mutating non-UI action, which SCENARIOS_TESTS_RULES.md Rule 6 forbids
# and which would invalidate the whole run.  Fail fast with guidance instead.
#
# Usage: assert-clean-governance.sh <NNN> <scenario-file>
#   exit 0  clear to run (prints GOVERNANCE_AUDIT_OK or GOVERNANCE_AUDIT_SKIP)
#   exit 1  SETUP_FAIL on stderr -- the caller must NOT start the scenario
set -euo pipefail

NNN="${1:?usage: assert-clean-governance.sh <NNN> <scenario-file>}"
SCEN_FILE="${2:?usage: assert-clean-governance.sh <NNN> <scenario-file>}"
[ -f "$SCEN_FILE" ] || { echo "SETUP_FAIL governance-audit: scenario file not found: $SCEN_FILE" >&2; exit 1; }

# HOME-scoped, NOT CLAUDE_PROJECT_DIR-scoped like the sibling scripts here, and that is
# deliberate: the ai-maestro store belongs to the host user, and getManagerId() reads exactly
# these paths. The tests depend on the property too -- they drive this script with a redirected
# HOME so no branch ever touches the developer's real state. Do not "fix" it to a project path.
GOV="${HOME}/.aimaestro/governance.json"
REG="${HOME}/.aimaestro/agents/registry.json"

# Does this scenario ASSIGN the MANAGER title?  A line naming MANAGER together
# with a title/create/assign/promote verb.
#
# Measured over all 40 scenario files (2026-08-27): fires on exactly the 20
# manager-creating ones and on none of the other 20.  Both frontmatter-based
# predicates were tried first and BOTH are wrong:
#   * a `data_produced:` grep UNDER-fires -- SCEN-005 declares "3 test agents"
#     and SCEN-024 declares "scen024-mgr-01"; neither string contains MANAGER,
#     yet both take the singleton.
#   * `subsystems:` containing governance OVER-fires on 8 scenarios that never
#     assign a title (SCEN-003/012/013/016/017/023/026/028) and at the same time
#     MISSES SCEN-022, which creates a MANAGER without declaring that subsystem.
# Whole-file and body-only (after the 2nd `---`) were measured identical across
# the corpus, so the file is grepped whole -- one less moving part.
MANAGER_VERB='\bMANAGER\b.*([Tt]itle|[Cc]reate|[Aa]ssign|[Pp]romote)|([Tt]itle|[Cc]reate|[Aa]ssign|[Pp]romote).*\bMANAGER\b'

# Resolve the incumbent; empty means the singleton is free.  ENOENT and CORRUPT
# are split deliberately: a pristine host simply has no governance.json and is
# free, while an unreadable one must FAIL the setup rather than read as "no
# manager" -- a lenient reader here would turn this into an audit that passes
# because it read nothing.
incumbent_id=""
if [ -f "$GOV" ]; then
  command -v jq >/dev/null 2>&1 || {
    echo "SETUP_FAIL governance-audit: 'jq' not on PATH (required to read $GOV)" >&2; exit 1; }
  if ! incumbent_id=$(jq -r '.managerId // empty' "$GOV" 2>&1); then
    echo "SETUP_FAIL governance-audit: cannot parse $GOV -- $incumbent_id" >&2
    exit 1
  fi
fi

incumbent_name=""
if [ -n "$incumbent_id" ] && [ -f "$REG" ]; then
  if ! incumbent_name=$(jq -r --arg id "$incumbent_id" \
        'map(select(.id == $id)) | .[0].name // empty' "$REG" 2>&1); then
    echo "SETUP_FAIL governance-audit: cannot parse $REG -- $incumbent_name" >&2
    exit 1
  fi
fi

# `grep -q` exits 1 on no-match, which under `set -e` would kill the script --
# hence the `if !` form rather than a bare call.
if ! grep -qE "$MANAGER_VERB" "$SCEN_FILE"; then
  if [ -n "$incumbent_id" ]; then
    # Name the incumbent even when skipping.  If a future scenario ever phrases
    # manager-creation in a way the predicate misses, this line is the evidence
    # in the run log that the singleton was taken while setup waved it through.
    echo "GOVERNANCE_AUDIT_SKIP SCEN-$NNN does not assign the MANAGER title (host MANAGER: ${incumbent_name:-<unregistered>} $incumbent_id)"
  else
    echo "GOVERNANCE_AUDIT_SKIP SCEN-$NNN does not assign the MANAGER title"
  fi
  exit 0
fi

if [ -z "$incumbent_id" ]; then
  echo "GOVERNANCE_AUDIT_OK SCEN-$NNN MANAGER singleton is free"
  exit 0
fi

# EVERY incumbent fails; only the guidance differs.
#
# TRDD-Q6JM2RU3 proposed allowlisting an incumbent named `scen<NNN>-*` on the
# theory that a leftover from this same scenario is harmless.  Measured against
# Gate 7, that is a FALSE PASS: the gate compares IDS and is blind to names, so
# a leftover `scen030-manager` has a different id than the agent SCEN-030 will
# create, and the run walls at the first title step exactly as it would with a
# foreign holder -- after setup printed OK.  Passing there would re-create the
# very failure this audit exists to remove, so the allowlist is deliberately not
# implemented (deviation recorded in the card body).
case "$(printf '%s' "$incumbent_name" | tr '[:upper:]' '[:lower:]')" in
  scen"${NNN}"*)
    echo "SETUP_FAIL pre-existing-MANAGER $incumbent_name ($incumbent_id) -- leftover from an interrupted SCEN-$NNN run. Gate 7 compares ids, so this still blocks the MANAGER this run will create. Delete it via the UI (Profile > Advanced > Danger Zone > Delete Agent, tick 'Also delete agent folder'), purge its cemetery entry, then re-run. See SCENARIOS_TESTS_RULES.md Rule 1." >&2
    ;;
  "")
    echo "SETUP_FAIL pre-existing-MANAGER <unregistered id> ($incumbent_id) -- governance.json names a MANAGER that no registry agent carries (a stale id from a broken delete). Gate 7 reads governance.json alone, so it still blocks. Clear the holder via the UI before running." >&2
    ;;
  *)
    echo "SETUP_FAIL pre-existing-MANAGER $incumbent_name ($incumbent_id) -- the per-host MANAGER singleton is taken; free it before running. List the holders with tests/scenarios/scripts/list-governance-litter.sh, then delete $incumbent_name via the UI." >&2
    ;;
esac
exit 1
