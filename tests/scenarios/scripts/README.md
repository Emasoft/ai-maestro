# Scenario Bash Scripts

This folder holds **pre-approved bash scripts** that the AI Maestro UI scenario tests use to set up fixtures (GitHub repos, fake source files, test agents) and clean up state after each run.

## How they fit into the architecture

The overnight scenario runner is a single forked agent (defined at `tests/scenarios/agents/scenario-batch-runner.md`) spawned by the parent Claude Code session via the Agent tool. That single agent has TWO roles:

1. **Bash-tool role:** calls scripts in this folder for fixture setup/cleanup. The scripts are pre-approved in `~/.claude/settings.json` `permissions.allow`, so Claude Code does not inspect their contents — they can write to `~/.claude/`, run `gh repo create`, install plugins, kill tmux sessions, etc., without further prompts.

2. **Chrome-CDP role:** drives the dashboard UI for the actual scenario steps via `mcp__chrome-devtools__*` tools, per Rule 6 STICK-TO-UI.

Both roles belong to the same forked agent in one continuous context. **No `claude -p` subprocesses, no nested Agent spawns** — that would burn API credits instead of using the user's subscription.

## File pattern

For each scenario `SCEN-NNN`:

| File | Purpose |
|------|---------|
| `setup-SCEN-NNN.sh` | Provisions fixtures the scenario needs. Idempotent. Called BEFORE the agent drives Chrome. |
| `cleanup-SCEN-NNN.sh` | Reverts fixtures. Safety net for the scenario's in-UI cleanup. Called AFTER the agent finishes. |

Both scripts source `fixture-helpers.sh` which provides reusable functions: `fixture_github_repo`, `fixture_delete_agents_by_prefix`, `fixture_kill_tmux_by_prefix`, `fixture_snapshot_aim_state`, `fixture_github_repo_delete`.

## Pre-approval

Every script is registered in `~/.claude/settings.json` `permissions.allow` with both absolute and relative path forms:

```
"Bash(bash /Users/emanuelesabetta/ai-maestro/tests/scenarios/scripts/setup-SCEN-018.sh)"
"Bash(./tests/scenarios/scripts/setup-SCEN-018.sh)"
"Bash(tests/scenarios/scripts/setup-SCEN-018.sh)"
```

When the forked agent invokes one of these via the Bash tool, Claude Code allows it without prompting. The script's internal commands (write `~/.claude/settings.json`, run `gh`, `tmux`, `claude plugin install`, etc.) are NOT subject to Claude Code's permission system because they happen inside a child process.

This is the pattern the user explicitly requested:

> "you may easily bypass permissions writing a bash scripts that does the operations for you and are run from another non protected folder. no need for special permissions. … those scripts are already been pre-approved (and once approved, claude should not check the inside code)"

## Adding a new scenario script

1. Create `setup-SCEN-NNN.sh` and `cleanup-SCEN-NNN.sh` in this folder
2. `chmod +x` both
3. Add the matching allow-list entries to `~/.claude/settings.json` (or run the helper Python snippet at the bottom of this README)
4. Reference helper functions from `fixture-helpers.sh` for common tasks

## Helper Python snippet for adding a new scenario to allow-list

```python
import json
from pathlib import Path
SCEN = "023"  # change this
p = Path.home() / ".claude" / "settings.json"
with p.open() as f: d = json.load(f)
allow = set(d["permissions"]["allow"])
for kind in ["setup", "cleanup"]:
    for prefix in ["bash /Users/emanuelesabetta/ai-maestro/", "./", ""]:
        allow.add(f"Bash({prefix}tests/scenarios/scripts/{kind}-SCEN-{SCEN}.sh)")
d["permissions"]["allow"] = sorted(allow)
with p.open("w") as f: json.dump(d, f, indent=2); f.write("\n")
```

## State and snapshots

- `tests/scenarios/state/SCEN-NNN.snapshot` — pointer file written by setup scripts containing the path to the most recent state-backup directory for that scenario
- `tests/scenarios/state/batch-progress.log` — append-only progress log for resume-after-interrupt
- `tests/scenarios/state-backups/SCEN-NNN_<timestamp>/` — per-run snapshots of `~/.aimaestro/` and `~/.claude/settings.json` for Rule 3 STATE-WIPE restoration

## Currently implemented setup/cleanup pairs

| Scenario | Status |
|----------|--------|
| SCEN-018 | DONE (creates 2 buggy GitHub fixture repos, kills orphan tmux + agents, snapshots state) |
| SCEN-001..017, 019..022 | TODO — to be added incrementally |

`fixture-helpers.sh` already provides everything needed; new scripts are typically 20–50 lines each and just call the helper functions with scenario-specific parameters.
