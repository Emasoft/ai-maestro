---
name: folder-adoption-import
description: "wizard 'Browse existing project folder' 400s / adopting a git repo as an agent workdir dirties git status / folder shows as 'taken' after the agent was deleted / where does the managed ignore block live / does delete remove the agent folder — the allowExternalFolder adoption flow (TRDD-57EBNB72)"
ocd: 2026-07-08
lmd: 2026-10-01
metadata:
  node_type: memory
  type: project
  tier: component
  topic: agents
publish-globally: false
---

# Folder adoption — `allowExternalFolder` (TRDD-57EBNB72)

^KVK2RZX5 [desc: "POST /api/agents accepts allowExternalFolder:true (schema in lib/create-agent-schema.ts; Next.js forbids extra route exports) to ADOPT an existing folder in place, not create ~/agents/<name>", keywords: allowExternalFolder adopt_existing_folder wizard_browse_existing_project_folder_400s adopt_instead_of_create create_agent_schema_extracted nextjs_forbids_extra_route_exports TRDD-57EBNB72, ocd: 2026-07-08, lmd: 2026-10-01, trdd: 57EBNB72]
`POST /api/agents` accepts `allowExternalFolder: true` (zod schema extracted to
`lib/create-agent-schema.ts` — Next.js forbids extra route exports, so the schema cannot
live in the route file) to ADOPT an existing folder in place instead of creating
`~/agents/<name>/`.

**Pipeline facts (all verified live in the WS1b dummy protocol):**

^X79CT4Y7 [desc: "G03-CLAMP: allowExternalFolder is honored only for folders under $HOME; outside it the flag is ignored and the workdir is forced back to ~/agents/<name>. Team titles stay force-pathed", keywords: G03_CLAMP_home_limit allowExternalFolder_ignored_outside_home folder_outside_home_flag_ignored workdir_forced_back_to_agents team_titles_force_pathed, ocd: 2026-07-08, lmd: 2026-10-01]
- **G03-CLAMP**: the flag is honored only for folders under `$HOME`; outside it the flag is
  ignored (ops line `G03-CLAMP`) and the workdir is forced back to `~/agents/<name>/`.
  Team titles remain force-pathed; G03-SAFETY unchanged.
^Z2JYBKY3 [desc: "G05c: adopted git-repo workdirs get a managed ignore block in .git/info/exclude via lib/workdir-gitignore-seed.ts, self-healed on wake; NOT .gitignore (plugin repos track it)", keywords: managed_ignore_block_location adopt_dirties_git_status git_info_exclude_not_gitignore why_did_adoption_dirty_git workdir_gitignore_seed_ts self_healed_on_wake three_git_shapes_directory_submodule_worktree, ocd: 2026-07-08, lmd: 2026-10-01]
- **G05c**: git-repo workdirs get a managed ignore block (markers
  `# >>> ai-maestro:managed-gitignore …` / `# <<< …`) seeded into **`.git/info/exclude`**
  via `lib/workdir-gitignore-seed.ts`, and self-healed on wake
  (`ensureCorePluginInstalled`). It is deliberately NOT `.gitignore` — plugin repos TRACK
  their `.gitignore`, so writing there dirties the very tree the seeder protects (caught
  live: ` M .gitignore` on the first dummy adoption).[^1] The resolver handles all three
  `.git` shapes: directory, submodule gitdir-file, linked-worktree `commondir`.
^2WNYL2CH [desc: "Folders route (GET /api/agents/folders): soft-deleted agents' folders are selectable again (tombstone filter !a.deletedAt); browsed path enriched with githubRepo read pure-fs from .git/config", keywords: folder_shows_as_taken_after_delete tombstone_filter_deletedAt folders_route_github_repo_enrichment browse_folder_again_after_soft_delete git_config_read_no_exec, ocd: 2026-07-08, lmd: 2026-10-01]
- **Folders route** (`GET /api/agents/folders`): soft-deleted agents' folders are
  selectable again (tombstone filter `!a.deletedAt`), and the browsed path is enriched
  with `githubRepo` (pure-fs read of `.git/config`, no exec).
^51DI90IW [desc: "Maintainer wizard order is title, folder, github-repo, summary, with githubRepo prefilled from the browsed folder's origin (Gate 9a requires it for MAINTAINER, R19.3)", keywords: maintainer_wizard_field_order githubRepo_prefilled_from_folder gate_9a_maintainer_requires_repo wizard_title_folder_github_summary, ocd: 2026-07-08, lmd: 2026-10-01]
- **Maintainer wizard order**: `title → folder → github-repo → summary`, with `githubRepo`
  PREFILLED from the browsed folder's origin (Gate 9a requires it for MAINTAINER, R19.3).
^REV8SDX9 [desc: "Delete semantics: SOFT keeps folder and registry tombstone (re-adoption returns 201); HARD (hard=true + deleteFolder=true) removes both, only under ~/agents; deleteFolder=true on SOFT removes nothing", keywords: does_delete_remove_agent_folder soft_vs_hard_delete_folder tombstone_readoption_201 folder_removal_only_under_agents deleteFolder_on_soft_delete_does_nothing, ocd: 2026-07-08, lmd: 2026-10-01]
- **Delete semantics**: SOFT delete keeps the folder AND the registry tombstone
  (re-adoption over a tombstone works — returns 201). HARD delete
  (`?hard=true&deleteFolder=true`) removes both; folder removal only ever applies under
  `~/agents/` (G03-SAFETY guard). `?deleteFolder=true` on a SOFT delete does NOT remove
  the folder.
^TKLLUTUV [desc: "Cemetery purge API (DELETE /api/agents/cemetery) takes a JSON body {filename: <name>.zip}, NOT a query param, needs a fresh one-shot sudo token per call, accepts only basename .zip/.json names", keywords: cemetery_purge_api_body_format purge_takes_json_body_not_query_param one_shot_sudo_token_per_purge purge_only_accepts_zip_json, ocd: 2026-07-08, lmd: 2026-10-01]
- **Cemetery purge API**: `DELETE /api/agents/cemetery` takes a JSON body
  `{"filename": "<name>.zip"}` (NOT a query param), needs a FRESH one-shot sudo token per
  call, and only accepts basename-`.zip`/`.json` filenames.

^CJJ14LLT [desc: "Regression coverage for the adoption flow: SCEN-028 (19 steps) plus unit/integration suites; the flow broke silently at the API boundary precisely because no scenario covered it", keywords: folder_adoption_regression_coverage SCEN-028_no_scenario_covered_it broke_silently_at_api_boundary workdir_gitignore_seed_test adoption_test_suites, ocd: 2026-07-08, lmd: 2026-10-01]
**Regression coverage**: `tests/scenarios/SCEN-028_folder-adoption-wizard.scen.md` (19
steps) + unit/integration suites `tests/unit/workdir-gitignore-seed.test.ts`,
`tests/integration/createagent-g05c-gitignore.test.ts`,
`tests/unit/agents-route-schema.test.ts`. The flow broke silently at the API boundary
precisely because no scenario covered it.

Docs: CLAUDE.md §"Folder adoption — allowExternalFolder" + `docs/API-CHANGES.md` entry.
See also [[session-control-subagent-gate]] (same campaign, same fleet-readiness gate).

## Notes and lessons learned

[^1]: [id:ATOM-ADOPT-GITIGNORE-DIRTY, status:valid, keywords:"adopted_repo_shows_M_gitignore synthetic_test_repo_missed_it real_cloned_repo_tracks_gitignore live_dummy_adoption_rehearsal import_path_change_verification", ocd:2026-07-08, lmd:2026-07-08] The original WS1 design wrote the managed block to
  `.gitignore`; the live dummy adoption of a real plugin repo immediately showed
  ` M .gitignore` because real repos track that file. Lesson: unit tests with synthetic
  repos missed it (they never tracked `.gitignore`); a live rehearsal against a REAL
  cloned repo caught it in the first run — always do the dummy live protocol before
  trusting an import-path change.

## See also

- [[agent-deletion-all-in-one-pipeline]] — deleting an adopted agent: G03-SAFETY refuses folder removal outside `~/agents/`, so an adopted workdir always survives the pipeline (by design).
