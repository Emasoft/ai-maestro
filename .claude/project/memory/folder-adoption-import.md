---
name: folder-adoption-import
description: "wizard 'Browse existing project folder' 400s / adopting a git repo as an agent workdir dirties git status / folder shows as 'taken' after the agent was deleted / where does the managed ignore block live / does delete remove the agent folder — the allowExternalFolder adoption flow (TRDD-57EBNB72)"
ocd: 2026-07-08
lmd: 2026-07-08
metadata:
  node_type: memory
  type: project
  tier: component
  topic: agents
---

# Folder adoption — `allowExternalFolder` (TRDD-57EBNB72)

`POST /api/agents` accepts `allowExternalFolder: true` (zod schema extracted to
`lib/create-agent-schema.ts` — Next.js forbids extra route exports, so the schema cannot
live in the route file) to ADOPT an existing folder in place instead of creating
`~/agents/<name>/`.

**Pipeline facts (all verified live in the WS1b dummy protocol):**

- **G03-CLAMP**: the flag is honored only for folders under `$HOME`; outside it the flag is
  ignored (ops line `G03-CLAMP`) and the workdir is forced back to `~/agents/<name>/`.
  Team titles remain force-pathed; G03-SAFETY unchanged.
- **G05c**: git-repo workdirs get a managed ignore block (markers
  `# >>> ai-maestro:managed-gitignore …` / `# <<< …`) seeded into **`.git/info/exclude`**
  via `lib/workdir-gitignore-seed.ts`, and self-healed on wake
  (`ensureCorePluginInstalled`). It is deliberately NOT `.gitignore` — plugin repos TRACK
  their `.gitignore`, so writing there dirties the very tree the seeder protects (caught
  live: ` M .gitignore` on the first dummy adoption).[^1] The resolver handles all three
  `.git` shapes: directory, submodule gitdir-file, linked-worktree `commondir`.
- **Folders route** (`GET /api/agents/folders`): soft-deleted agents' folders are
  selectable again (tombstone filter `!a.deletedAt`), and the browsed path is enriched
  with `githubRepo` (pure-fs read of `.git/config`, no exec).
- **Maintainer wizard order**: `title → folder → github-repo → summary`, with `githubRepo`
  PREFILLED from the browsed folder's origin (Gate 9a requires it for MAINTAINER, R19.3).
- **Delete semantics**: SOFT delete keeps the folder AND the registry tombstone
  (re-adoption over a tombstone works — returns 201). HARD delete
  (`?hard=true&deleteFolder=true`) removes both; folder removal only ever applies under
  `~/agents/` (G03-SAFETY guard). `?deleteFolder=true` on a SOFT delete does NOT remove
  the folder.
- **Cemetery purge API**: `DELETE /api/agents/cemetery` takes a JSON body
  `{"filename": "<name>.zip"}` (NOT a query param), needs a FRESH one-shot sudo token per
  call, and only accepts basename-`.zip`/`.json` filenames.

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
