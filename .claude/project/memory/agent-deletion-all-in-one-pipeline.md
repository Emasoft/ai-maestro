---
name: agent-deletion-all-in-one-pipeline
description: "I deleted an agent but its folder keeps coming back / rm -rf the workdir and it reappears with a bare .claude/rules / leftover agent after cleanup / how do I fully delete an agent / can I just call the service function from a script instead of the UI"
ocd: 2026-07-25
lmd: 2026-07-26
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
- **Through the UI button, or through the same API endpoint with a valid signed token — nothing
  else.** Calling `DeleteAgent` (or any pipeline) in-process from a script is FORBIDDEN under
  **R50.4**, not a shortcut: it performs the operation with no authorization proof and outside the
  audit path. If no authenticated non-UI path exists, that is a blocking gap to fix (ai-maestro#55),
  never a licence to bypass. [^4]
- Check "Also delete agent folder"; then purge the Cemetery entry (Settings → Cemetery), or the
  artifact has merely moved.
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

[^4]: [id:ATOM-3PX9-H7VK, status:valid, keywords:"call_the_service_function_from_a_script sudo_gated_route_no_cli_path in_process_pipeline_invocation ledger_hole forbidden_bypass R50.4", ocd:2026-07-26, lmd:2026-07-26]
  DO NOT invoke a pipeline in-process from a script because the HTTP route is sudo-gated and the
  script layer has no human auth path, BECAUSE that is not "the same operation minus a permission
  check" — it performs a privileged mutation with no proof of authority and outside the audit path,
  and the record that would show who did it is the same one skipped. I did this for 29 agent
  deletions and 69 direct `unpersistSession` calls; the agent ops happened to reach the ledger, the
  session-store mutations left no trace at all. DO use the UI button, or the same endpoint with a
  valid signed token; if no authenticated path exists, treat it as a BLOCKING gap (ai-maestro#55).

[^5]: [id:ATOM-5QW2-M8BT, status:valid, keywords:"emitAgentOp_not_awaited ledger_append_fire_and_forget process_exit_drops_audit_entry short_lived_cli", ocd:2026-07-26, lmd:2026-07-26]
  DO NOT assume an operation that "emits to the ledger" is durably recorded when you run it from a
  short-lived process, BECAUSE `emitAgentOp` calls `registryLedger.append(...)` WITHOUT awaiting it
  (only a `.catch()` is attached), so a script that reaches `process.exit(0)` can drop an in-flight
  append and the audit entry is simply never written. DO run the operation inside the long-lived
  server via its endpoint — which is the same conclusion R50.4 reaches from the security side, and
  the two together are why the CLI path is unsafe in principle, not only by policy.
