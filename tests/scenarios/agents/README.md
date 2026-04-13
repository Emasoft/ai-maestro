# tests/scenarios/agents/ — spec docs for scenario-driving agents

This folder contains historical architecture notes for the agents the AI Maestro scenario harness uses. **The executable definitions now ship as a Claude Code plugin.**

## Canonical source: `scenarios-autorunner` plugin

As of 2026-04-13, the scenario runner + conductor + improvement implementer are distributed as a universal Claude Code plugin:

- **Repo:** https://github.com/Emasoft/scenarios-autorunner
- **Marketplace:** `Emasoft/emasoft-plugins`
- **Install:**
  ```bash
  claude plugin marketplace add Emasoft/emasoft-plugins
  claude plugin install scenarios-autorunner@emasoft-plugins
  ```

The plugin ships 5 skills (`run-scenarios-batch`, `create-scenario`, `edit-scenario`, `improve-scenario`, `implement-scenarios-proposals`), 2 subagents (`scenario-runner` with `memory: project`, `scenario-improvement-implementer` with `isolation: worktree` + `memory: project`), 2 hooks (`Stop` auto-continue, `StopFailure` rate-limit breadcrumb), a genericized `SCENARIOS_TESTS_RULES.md`, and an `init-scenarios-folder.sh` scaffolder.

The ai-maestro copy of `tests/scenarios/SCENARIOS_TESTS_RULES.md` is the project-level override that takes precedence when both the plugin-bundled and project-level rules files exist. Any ai-maestro-specific sections (manager-gated team governance, AMP messaging, device-emulation component names) stay in the project-level copy. The plugin's bundled copy is universal.

## Invocation from the main Claude Code session

```text
/run-scenarios-batch 16-20                    # via the plugin's skill (preferred)
/run-scenarios-batch 16-20 --improve          # run + auto-implement P0 in worktree
"Create a new scenario for <feature>"         # triggers create-scenario skill
"Edit SCEN-018 to add a cleanup step"         # triggers edit-scenario skill
"Improve SCEN-016"                            # triggers improve-scenario skill
"Implement proposals from scenario 18"        # triggers implement-scenarios-proposals
```

Sub-agents are spawned via the Agent tool (not `claude -p`), inheriting the parent Pro Max subscription. Per-scenario setup/cleanup scripts at `tests/scenarios/scripts/setup-SCEN-NNN.sh` + `cleanup-SCEN-NNN.sh` are still called by the plugin's conductor via the optional `tests/scenarios/scenarios-autorunner.config.json` config file — see the plugin's `references/SCENARIOS_TESTS_RULES.md` for details.

## Per-project fixture scripts (ai-maestro specific)

The ai-maestro project provides its own set of per-scenario bash scripts at `tests/scenarios/scripts/`:

| Script | Purpose |
|--------|---------|
| `fixture-helpers.sh` | Shared functions (fixture_github_repo, fixture_delete_agents_by_prefix, fixture_kill_tmux_by_prefix, fixture_snapshot_aim_state) |
| `kill-orphans.sh` | One-shot cleanup of stale `scen*` tmux sessions and registry entries |
| `setup-SCEN-NNN.sh` | Per-scenario fixture provisioning (one per scenario that needs fixtures) |
| `cleanup-SCEN-NNN.sh` | Per-scenario cleanup safety net |

These are pre-approved in `~/.claude/settings.json` `permissions.allow` so the scenario runner can invoke them without interactive approval. The scripts themselves are AI-Maestro-specific (they call the AI Maestro API, manipulate tmux, etc.) and stay in the ai-maestro repo. The plugin's skills call them via `${CLAUDE_PROJECT_DIR}/tests/scenarios/scripts/setup-SCEN-<padded-id>.sh` if the file exists.

## Related documents

- `tests/scenarios/SCENARIOS_TESTS_RULES.md` — the project-specific rules (extends the plugin's bundled rules)
- `tests/scenarios/scripts/README.md` — fixture script architecture and per-scenario pattern
- `docs_dev/2026-04-13-*.md` — session notes from when the plugin was split out from the ai-maestro monorepo
- https://github.com/Emasoft/scenarios-autorunner — plugin source
