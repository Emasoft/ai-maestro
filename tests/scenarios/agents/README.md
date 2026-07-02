# tests/scenarios/agents/ — spec docs for scenario-driving agents

This folder contains architecture notes for the agents the AI Maestro scenario harness uses. **The executable definitions live directly in the project under `.claude/`** and are git-tracked, so they ship with every clone of the repo — no plugin install required.

## Canonical source: project-scoped `.claude/` definitions

The scenario runner, improvement implementer, and their supporting skills/scripts/rules are all project-scope artifacts under `.claude/`, shared across all developers via git:

| Component | Path |
|-----------|------|
| **Agents** (2) | `.claude/agents/scenario-runner.md`, `.claude/agents/scenario-improvement-implementer.md` |
| **Skills** (6) | `.claude/skills/run-scenarios-batch/`, `create-scenario/`, `edit-scenario/`, `improve-scenario/`, `implement-scenarios-proposals/`, `scenarios-rules/` |
| **Scripts** (2) | `.claude/scripts/subagent-write-guard.sh`, `.claude/scripts/test-subagent-write-guard.sh` |
| **Rules** (2) | `.claude/rules/prevent-subagents-to-write-outside.md`, `.claude/rules/SCENARIOS_TESTS_RULES.md` (symlink → `tests/scenarios/SCENARIOS_TESTS_RULES.md`) |
| **Settings** | `.claude/settings.json` (project-scope permissions + `$schema`) |

Project-scope placement means: any developer who clones ai-maestro gets the full scenario harness automatically, and Claude Code auto-loads these definitions when invoked inside the repo.

## Invocation from the main Claude Code session

```text
/run-scenarios-batch 16-20                    # via the skill (preferred)
/run-scenarios-batch 16-20 --improve          # run + auto-implement P0 in worktree
"Create a new scenario for <feature>"         # triggers create-scenario skill
"Edit SCEN-018 to add a cleanup step"         # triggers edit-scenario skill
"Improve SCEN-016"                            # triggers improve-scenario skill
"Implement proposals from scenario 18"        # triggers implement-scenarios-proposals skill
```

Sub-agents are spawned via the Agent tool (not `claude -p`), inheriting the parent Claude Code session. Hooks (PreToolUse write-guard) live in each agent's frontmatter — see `.claude/rules/prevent-subagents-to-write-outside.md` for why this placement is mandatory for security.

## Per-project fixture scripts

The project provides per-scenario fixture scripts at `tests/scenarios/scripts/`:

| Script | Purpose |
|--------|---------|
| `fixture-helpers.sh` | Shared functions (`fixture_github_repo`, `fixture_delete_agents_by_prefix`, `fixture_kill_tmux_by_prefix`, `fixture_snapshot_aim_state`) |
| `kill-orphans.sh` | One-shot cleanup of stale `scen*` tmux sessions and registry entries |
| `setup-SCEN-NNN.sh` | Per-scenario fixture provisioning (one per scenario that needs fixtures) |
| `cleanup-SCEN-NNN.sh` | Per-scenario cleanup safety net |
| `setup-overnight-batch.sh` / `cleanup-overnight-batch.sh` | Master batch bookends |

These are pre-approved in `.claude/settings.json` `permissions.allow` so the scenario runner can invoke them without interactive approval. The skills call them via relative paths (`./tests/scenarios/scripts/setup-SCEN-<padded-id>.sh`) when the file exists.

## Related documents

- `tests/scenarios/SCENARIOS_TESTS_RULES.md` — the 13 scenario execution rules (Rule 6 STICK-TO-UI, Rule 13 AUTONOMOUS-PROTOCOL, etc.)
- `tests/scenarios/scripts/README.md` — fixture script architecture and per-scenario pattern
- `.claude/rules/prevent-subagents-to-write-outside.md` — why hooks live in agent frontmatter, not `settings.json`
