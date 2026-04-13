# tests/scenarios/agents/ — spec docs for scenario-driving agents

This folder contains human-readable architecture specs for the agents the AI Maestro scenario harness uses. **The executable Claude Code definitions live elsewhere.**

| What | Spec doc (here) | Executable definition | Frontmatter type | Why |
|------|-----------------|----------------------|-------------------|-----|
| **Scenario batch runner** | `scenario-batch-runner.md` | `.claude/skills/run-scenarios-batch/SKILL.md` | Skill | Needs slash-command invocation with `$ARGUMENTS` → `/run-scenarios-batch 16-20`. `context: fork` gives it its own context without a worktree. |
| **Improvement implementer** | (TBD — add when needed) | `.claude/agents/scenario-improvement-implementer.md` | Subagent | Needs `isolation: worktree` — a direct subagent frontmatter field. Invoked by the main Claude via the Agent tool (no slash command needed). |

## Architecture decisions (from Claude Code docs study)

- **Skills** (`.claude/skills/<name>/SKILL.md`) support `context: fork` to run in an isolated context, `$ARGUMENTS` substitution, slash-command invocation, and pre-approved tools. **Skills do NOT directly support `isolation: worktree`** — they can only get worktree indirectly by setting `context: fork` + `agent: <subagent-with-isolation>`.

- **Subagents** (`.claude/agents/<name>.md`) always run in their own context window. They support `isolation: worktree` as a direct frontmatter field, plus `tools`/`disallowedTools`, `permissionMode`, `memory`, `hooks`, `skills`. Subagents are invoked via the Agent tool with `subagent_type`, @-mention, or automatic delegation — no slash command.

- **Why the runner is a skill and the implementer is a subagent:** the runner needs `/run-scenarios-batch <range>` ergonomic + no worktree (it only reads scenarios and drives Chrome). The implementer needs worktree isolation (it modifies source code) and is triggered by the main Claude programmatically, not by the user typing a command.

## Bash-script escape hatch

Both the runner and the implementer call pre-approved bash scripts at `tests/scenarios/scripts/*.sh` for fixture setup, cleanup, and state manipulation. Those scripts are listed in `~/.claude/settings.json` `permissions.allow` so Claude Code does not inspect them or prompt — they run as child processes that can write to `~/.claude/`, call `gh`, manipulate tmux state, etc., without further approval.

This means:
1. The Claude-Code–side work (driving Chrome, writing reports, parsing scenario files) happens inside one forked agent
2. The dirty privileged work (creating fake GitHub repos, installing plugins, killing tmux, restoring settings backups) happens in bash subprocesses that Claude Code does not audit
3. No `claude -p` subprocess invocations — everything inherits the parent session's Pro Max subscription

## Invocation

**Run a batch of scenarios** (from the main Claude Code session):
```
/run-scenarios-batch 16-20
```

Or via the Skill tool directly:
```
Skill(skill: "run-scenarios-batch", args: "16-20")
```

**Implement improvements** (after a batch run):
```
Agent(
  description: "Implement P0 improvements from last batch",
  subagent_type: "scenario-improvement-implementer",
  prompt: "Process improvements from timestamp 20260413_134400..."
)
```

## Related documents

- `tests/scenarios/SCENARIOS_TESTS_RULES.md` — the 12 rules every scenario run must follow
- `tests/scenarios/scripts/README.md` — bash-script architecture and per-scenario setup/cleanup pattern
- `scripts_dev/overnight-harness-v1-claude-p-WRONG/DO-NOT-USE.md` — the prior wrong approach (kept for historical reference per RULE 0.2)
