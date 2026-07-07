---
trdd-id: 4TKDCKD5
title: Support publisher-prefixed fixture paths in scenario-setup.sh to avoid basename collisions
column: planned
created: 2026-07-07T12:41:00+0200
updated: 2026-07-07T13:51:02+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-026, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md"]
---

# TRDD-4TKDCKD5 — Support publisher-prefixed fixture paths in scenario-setup.sh to avoid basename collisions

## Problem

Verified at HEAD (2026-07-07):
`tests/scenarios/scripts/scenario-setup.sh:120` derives the local clone
path for each `git-fixtures` URL via:

```bash
repo_name=$(basename "$url" .git)
local_path="$FIXTURE_GIT_ROOT/$repo_name"
```

i.e. `tests/scenarios/fixtures/git/$repo_name/`. SCEN-026's
`git-fixtures` list includes two URLs that collide on this basename:
`https://github.com/remotion-dev/codex-plugin` and
`https://github.com/supabase-community/codex-plugin` both resolve to
`repo_name=codex-plugin`, so only one of the two fixtures can exist
locally at a time — the second clone would either be refused or
silently overwrite the first, and the setup script cannot verify both
independently.

The scenario's own prose (SCEN-026, around the fixture-preparation
notes) already anticipates this and prescribes publisher-prefixed local
paths using `__` as the publisher/repo delimiter (e.g.
`tests/scenarios/fixtures/git/openai__plugins/`,
`tests/scenarios/fixtures/git/remotion-dev__codex-plugin/`,
`tests/scenarios/fixtures/git/supabase-community__codex-plugin/`), but
`scenario-setup.sh` was never updated to derive paths that way — it
still uses bare `basename`.

## Root cause

`scenario-setup.sh`'s git-fixture verification loop
(`tests/scenarios/scripts/scenario-setup.sh:114-135`) was written
before any scenario needed two fixtures with the same repo basename
from different publishers/orgs, so `basename "$url" .git` was
sufficient at the time. SCEN-026 is the first scenario to need
disambiguation and its authoring prose got ahead of the shared script.

## Proposed fix

Update the git-fixture loop in
`tests/scenarios/scripts/scenario-setup.sh` (currently lines 114-135)
to derive `repo_name` as `<owner>__<repo>` when the URL matches a
`github.com/<owner>/<repo>` shape, falling back to plain `basename` for
any URL that doesn't match (keeps existing fixtures backward
compatible without a migration):

```bash
while IFS= read -r url; do
  [ -z "$url" ] && continue
  if [[ "$url" =~ github\.com/([^/]+)/([^/]+)$ ]]; then
    owner="${BASH_REMATCH[1]}"
    repo="${BASH_REMATCH[2]%.git}"
    repo_name="${owner}__${repo}"
  else
    repo_name=$(basename "$url" .git)
  fi
  local_path="$FIXTURE_GIT_ROOT/$repo_name"
  if [ ! -d "$local_path/.git" ]; then
    echo "SETUP_FAIL git-fixture[$idx] $url — expected local clone at $local_path; scenario author must prepare the fork in advance" >&2
    exit 1
  fi
  # ... rest of the loop body (scenario-start tag check, reset --hard,
  # clean -fdx, GITFIX[$idx]= echo, idx increment) is unchanged
done <<< "$GITFIX"
```

Do NOT auto-migrate existing single-fixture scenarios to the
publisher-prefixed layout — the fallback branch keeps their plain
`basename` paths working unchanged. Only NEW fixtures that need
disambiguation (like SCEN-026's two `codex-plugin` repos) require the
publisher-prefixed clone path going forward.

## Verification

Run `setup-SCEN-026.sh` after cloning SCEN-026's fixtures into
`tests/scenarios/fixtures/git/openai__plugins/`,
`tests/scenarios/fixtures/git/hashgraph-online__awesome-codex-plugins/`,
`tests/scenarios/fixtures/git/remotion-dev__codex-plugin/`, and
`tests/scenarios/fixtures/git/supabase-community__codex-plugin/` (each
tagged `scenario-start`). Expect `SETUP_OK SCEN-026` (or the
setup script's equivalent success line) instead of a `SETUP_FAIL`
caused by a basename collision. Confirm a pre-existing single-fixture
scenario (any scenario with exactly one `git-fixtures` entry from a
`github.com/<owner>/<repo>` URL) still resolves to its existing
`tests/scenarios/fixtures/git/<repo>/` path unless it is re-cloned
under the new `<owner>__<repo>` convention — the two forms should not
coexist for the same fixture; pick one path per fixture and keep the
`git-fixtures` entry and the on-disk clone in sync.

## Estimated risk

LOW. The change is confined to fixture-path derivation and only takes
effect for URLs that don't already have a resolvable clone at the old
basename path — it doesn't touch state-wipe, backups, or any
already-passing scenario's fixture resolution.

**Dependencies:** None. Blocks SCEN-026 from reaching `SETUP_OK` for
its git-fixtures list, but the fixture forks themselves (four repos:
`openai/plugins` or similar canonical source, plus the three publisher
repos named above) still need to be forked and cloned locally by the
scenario author before this fix is useful — this TRDD only fixes the
path-derivation logic, not the fixture-preparation gap itself (see
the "Pattern observations" note in the source report about fixture
preparation being human-only today).

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T13:51:02+0200 — IMPLEMENTED (wave W2): scenario-setup.sh git-fixture loop now derives <owner>__<repo> for github.com URLs, falling back to plain basename; bash -n and shellcheck --severity=error clean. Also propagated the same derivation into state-machine-tick.sh's new preflight_scenario() (TRDD-QE1J5C91) to keep the two checks consistent.
