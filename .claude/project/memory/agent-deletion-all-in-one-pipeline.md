---
name: agent-deletion-all-in-one-pipeline
description: "I deleted an agent but its folder keeps coming back / rm -rf the workdir and it reappears with a bare .claude/rules / leftover agent after cleanup / how do I fully delete an agent"
ocd: 2026-07-25
lmd: 2026-07-25
metadata:
  node_type: memory
  type: project
  tier: component
---

**An agent is not a folder.** Deleting one touches the registry record, the cemetery archive, team
slots (COS/orchestrator), the tmux session, the **PersistedSession row** in
`~/.aimaestro/sessions.json`, AMP API keys, AID governance tokens, pending governance requests and
transfers, and the Claude transcript dir under `~/.claude/projects/<workdir-slug>/`. That is why
the server exposes exactly ONE all-in-one operation — `DeleteAgent` in
`services/element-management-service.ts`, reached from the UI (Profile → Advanced → Danger Zone →
Delete Agent) or `DELETE /api/agents/[id]`.

**Why:** removing any single piece by hand leaves the others, and several of them are *live inputs*
to loops that will act on the agent afterwards. The folder is the one visible piece, so it is the
one people reach for — and it is the least load-bearing.

**How to apply:**
- Always delete through the pipeline. Check "Also delete agent folder"; then purge the Cemetery
  entry (Settings → Cemetery), or the artifact has merely moved.
- **HARD vs SOFT matters:** `deleteFolder` is honored only on a hard delete. On a soft delete the
  flag is silently inert and the pipeline still reports success — a soft delete leaves a tombstone
  (`deletedAt`) in the registry and the folder on disk, by design.
- The G03-SAFETY guard refuses folder deletion for a workdir outside `~/agents/`, so an **adopted**
  agent (`~/Code/<project>`, see [[folder-adoption-import]]) keeps its folder no matter what — that
  is deliberate, and it means adopted test agents need a separate decision.
- If the pipeline leaves something behind, fix **the pipeline**. Every caller then benefits, and the
  next person is not left doing archaeology with a shell.

Related: [[ui-test-cleanup-rule]] (the scenario-side obligation),
[[github-repo-deletion-and-scenario-repo-cleanup]] (the repo half), [[folder-adoption-import]].

## Notes and lessons learned

[^1]: [id:ATOM-4M7X-K2QP, status:valid, keywords:"agent_folder_keeps_coming_back workdir_recreated_after_rm_rf bare_claude_rules_reappears deleted_agent_not_in_registry", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT `rm -rf ~/agents/<name>/` to clean up an agent, BECAUSE it deletes the one visible piece
  and leaves every invisible one — and a surviving record makes the server legitimately RE-CREATE
  the folder, turning an incomplete cleanup into a self-healing loop that looks like a haunting.
  DO delete through the `DeleteAgent` pipeline (UI Danger Zone), which owns all of them.

[^2]: [id:ATOM-9RT3-B8LW, status:valid, keywords:"DeleteAgent_missing_unpersist PersistedSession_outlives_agent sessions_json_stale_row G05b dead_agent_classification", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT assume the all-in-one pipeline covers every store just because it is the all-in-one
  pipeline, BECAUSE `DeleteAgent` killed the tmux session (G05) but never removed the agent's
  `PersistedSession` row — so a deleted agent stayed "a session that ought to exist", was read as a
  DEAD agent by the liveness path, and its revival re-ran the wake invariants (`claude-dir` +
  `dep-rules`), re-creating `<workdir>/.claude/rules/` with the five `aimaestro-*.md` files. DO add
  the missing step as a gate (landed as **G05b**, both soft and hard delete, commit `496355e5`) and
  verify by absence across every store, not by the pipeline's own success line.

[^3]: [id:ATOM-6JQ8-V4ND, status:valid, keywords:"verify_deletion_by_absence cleanup_verification_commands registry_sessions_cemetery_tmux", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT treat "the pipeline returned OK" as proof an agent is gone, BECAUSE a soft delete reports
  success while leaving the folder, and a missing gate can leave a live record in a store nobody
  checked. DO verify by ABSENCE across all five: `ls ~/agents/`, `tmux list-sessions`,
  `jq -r '.[].name' ~/.aimaestro/agents/registry.json`, `jq -r '.[].id' ~/.aimaestro/sessions.json`,
  `ls ~/.aimaestro/cemetery/`.
